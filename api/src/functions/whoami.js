const { app } = require('@azure/functions');
const { createRateLimiter, clientIp } = require('../lib/rateLimit');
const { validateDeviceIdParam } = require('../lib/validate');
const { deviceCookieHeader, parseDeviceCookie } = require('../lib/deviceCookie');

// 30 reads/min/IP. A browser calls this at most once per boot, and only when
// its localStorage deviceId is missing (i.e. right after an eviction / on a
// fresh browser) — so the legitimate rate is ~1/lifetime. Loose enough for a
// shared-NAT office, tight enough to slow a script probing the endpoint.
const limiter = createRateLimiter({ limit: 30, windowMs: 60_000 });

/**
 * GET /api/v1/whoami
 *
 * Reads the durable `gg_did` deviceId cookie (Feature W) and hands it back to
 * the browser so a client whose localStorage was evicted can restore its
 * *original* identity instead of minting a fresh UUID and orphaning all of
 * the player's Cosmos history.
 *
 *   - cookie present + shape-valid → 200 { deviceId } and re-Set-Cookie to
 *     roll the 2-year expiry forward for an active player.
 *   - cookie absent / malformed    → 200 { deviceId: null }; the client mints
 *     a new id and the next write plants a fresh cookie.
 *
 * No body, no query, no Cosmos — the cookie is the whole input. All of the
 * parse/build logic lives in lib/deviceCookie.js (unit-tested); this handler
 * is a thin wire.
 */
app.http('whoami', {
  route: 'v1/whoami',
  methods: ['GET'],
  authLevel: 'anonymous',
  handler: async (req) => {
    const rl = limiter.check(clientIp(req), Date.now());
    if (!rl.allowed) {
      return {
        status: 429,
        headers: { 'Retry-After': String(Math.ceil(rl.retryAfterMs / 1000)) },
        jsonBody: { error: 'rate_limited' },
      };
    }

    // Read the raw Cookie header, tolerating both the Headers object and a
    // plain object — same defensive shape as rateLimit.clientIp.
    const headers = req.headers;
    const rawCookie = headers && typeof headers.get === 'function'
      ? headers.get('cookie')
      : (headers ? headers['cookie'] : null);

    const cookieValue = parseDeviceCookie(rawCookie);
    const v = validateDeviceIdParam(cookieValue, 'invalid_deviceId');
    if (!v.ok) {
      return { status: 200, jsonBody: { deviceId: null } };
    }

    // Re-stamp so an active player's cookie never ages out.
    return {
      status: 200,
      headers: { 'Set-Cookie': deviceCookieHeader(v.value) },
      jsonBody: { deviceId: v.value },
    };
  },
});
