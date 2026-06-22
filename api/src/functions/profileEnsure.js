const { app } = require('@azure/functions');
const { validateDeviceIdParam } = require('../lib/validate');
const { insertDoc, queryDocs } = require('../lib/cosmos');
const { createRateLimiter, clientIp } = require('../lib/rateLimit');
const { buildProfileDoc } = require('../lib/profileDoc');

const DB_NAME = 'yetanotherquiz';
const CONTAINER_NAME = 'profiles';

// 10 writes/min/IP. Background call fired once per device (the client-side
// localStorage sentinel in flags/autoProfile.js dedupes), so the legitimate
// per-IP rate is ~1/lifetime — generous limit just covers a shared-NAT
// office of new players landing at once.
const limiter = createRateLimiter({ limit: 10, windowMs: 60_000 });

/**
 * POST /api/v1/profile/ensure
 *
 * Idempotent "make sure this device has a profile row" call. Fired once per
 * device on first non-trivial action (Feature S Phase 1a) — daily submit,
 * quiz finish, TTT match completed, share click, coffee click. The row
 * exists to anchor sync blob, attempt counters, and other per-device server
 * state that arrives in later phases; until then it carries just the
 * `nicknameAuto: true` marker so the UI knows the user hasn't picked a
 * name yet.
 *
 * Why this is its own endpoint (vs. extending PUT /api/v1/profile):
 *  - No turnstile — background call, no user-supplied input to abuse.
 *  - No nickname in the body — the row is created with `nickname: null` so
 *    `buildProfileDoc` derives `nicknameAuto: true`. The deterministic display
 *    name is computed client-side via `flags/nickname.js#defaultNickname`,
 *    so we don't need to store it.
 *  - Idempotent by contract: if the row already exists, return 200 without
 *    touching it. Avoids re-stamping `createdAt`, clobbering a customised
 *    nickname, or churning `updatedAt` on every page navigation.
 */
app.http('profileEnsure', {
  route: 'v1/profile/ensure',
  methods: ['POST'],
  authLevel: 'anonymous',
  handler: async (req, context) => {
    const rl = limiter.check(clientIp(req), Date.now());
    if (!rl.allowed) {
      return {
        status: 429,
        headers: { 'Retry-After': String(Math.ceil(rl.retryAfterMs / 1000)) },
        jsonBody: { error: 'rate_limited' },
      };
    }

    let body;
    try {
      body = await req.json();
    } catch {
      return { status: 400, jsonBody: { error: 'invalid_json' } };
    }
    if (!body || typeof body !== 'object') {
      return { status: 400, jsonBody: { error: 'invalid_body' } };
    }

    const v = validateDeviceIdParam(body.deviceId, 'invalid_deviceId');
    if (!v.ok) return { status: 400, jsonBody: { error: v.error } };
    const deviceId = v.value;

    const conn = process.env.COSMOS_CONN;
    if (!conn) {
      context.error('COSMOS_CONN env var is not set');
      return { status: 500, jsonBody: { error: 'server_error' } };
    }

    // Existence check first. A point-read by id+pk costs ~1 RU; the
    // insertDoc with `upsert: false` would also 409 on conflict, but
    // checking first keeps `created: true`/`false` cheap to report and
    // means we never accidentally overwrite a row whose schema we
    // haven't loaded into the builder (e.g. a future field).
    let queryRes;
    try {
      queryRes = await queryDocs({
        connString: conn,
        dbName: DB_NAME,
        containerName: CONTAINER_NAME,
        query: 'SELECT c.id FROM c WHERE c.id = @id',
        parameters: [{ name: '@id', value: deviceId }],
        partitionKey: deviceId,
      });
    } catch (err) {
      context.error('cosmos query threw', err);
      return { status: 500, jsonBody: { error: 'server_error' } };
    }
    if (!queryRes.ok) {
      context.error('cosmos query failed', queryRes);
      return { status: 500, jsonBody: { error: 'server_error' } };
    }
    if (queryRes.docs.length > 0) {
      return { status: 200, jsonBody: { ok: true, created: false } };
    }

    const doc = buildProfileDoc({
      existing: null,
      deviceId,
      nickname: null,
      now: Date.now(),
    });

    let insertRes;
    try {
      insertRes = await insertDoc({
        connString: conn,
        dbName: DB_NAME,
        containerName: CONTAINER_NAME,
        partitionKey: deviceId,
        doc,
      });
    } catch (err) {
      context.error('cosmos insert threw', err);
      return { status: 500, jsonBody: { error: 'server_error' } };
    }

    if (insertRes.ok) {
      return { status: 201, jsonBody: { ok: true, created: true } };
    }
    if (insertRes.error === 'conflict') {
      // Race between two devices firing ensureProfile simultaneously (e.g.
      // a player who opens two tabs and both fire on their first action).
      // 409 is success — the row exists, that's the postcondition we
      // promised the caller.
      return { status: 200, jsonBody: { ok: true, created: false } };
    }
    context.error('cosmos insert failed', insertRes);
    return { status: 500, jsonBody: { error: 'server_error' } };
  },
});
