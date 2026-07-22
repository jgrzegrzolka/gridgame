const { app } = require('@azure/functions');
const { validateResult } = require('../lib/validate');
const { insertDoc } = require('../lib/cosmos');
const { createRateLimiter, clientIp } = require('../lib/rateLimit');
const { verifyTurnstile } = require('../lib/turnstile');
const { buildDailyResultDoc } = require('../lib/dailyResultDoc');
const { isLocalRequestUrl } = require('../lib/requestHost');
const { isReleased } = require('../lib/puzzleDate');
const { warsawToday } = require('../lib/warsawTime');
const { deviceCookieHeader } = require('../lib/deviceCookie');

const DB_NAME = 'yetanotherquiz';
const CONTAINER_NAME = 'dailyResults';

const limiter = createRateLimiter({ limit: 5, windowMs: 60_000 });

app.http('dailyResult', {
  route: 'v1/daily/result',
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
    const v = validateResult(body);
    if (!v.ok) return { status: 400, jsonBody: { error: v.error } };

    // Feature R: the dated catalog is public-read, so a client could
    // POST a result for a future puzzleId and pollute its aggregate
    // before it's even released. Reject submissions for puzzles whose
    // Warsaw release date hasn't arrived yet.
    if (!isReleased(body.puzzleId, warsawToday())) {
      return { status: 400, jsonBody: { error: 'not_released' } };
    }

    const ts = await verifyTurnstile({
      secret: process.env.TURNSTILE_SECRET,
      token: body.turnstileToken,
      remoteIp: clientIp(req),
    });
    if (!ts.ok) {
      if (ts.reason === 'missing_secret') {
        context.warn('TURNSTILE_SECRET not set — skipping verification (dev mode)');
      } else {
        context.warn('turnstile verification failed', { reason: ts.reason });
        return { status: 403, jsonBody: { error: 'turnstile_failed' } };
      }
    }

    const conn = process.env.COSMOS_CONN;
    if (!conn) {
      context.error('COSMOS_CONN env var is not set');
      return { status: 500, jsonBody: { error: 'server_error' } };
    }

    // Server-trusted local-dev marker. Reading the host from req.url
    // (not a body field) so a malicious client can't spoof it to opt
    // their submissions out of community stats. Prod traffic never
    // hits a localhost host — see api/src/lib/requestHost.js.
    const local = isLocalRequestUrl(req.url);

    const doc = buildDailyResultDoc({
      puzzleId: body.puzzleId,
      deviceId: body.deviceId,
      foundCodes: body.foundCodes,
      wrongCodes: body.wrongCodes,
      totalCount: body.totalCount,
      durationMs: body.durationMs,
      local,
      now: Date.now(),
    });

    let result;
    try {
      result = await insertDoc({
        connString: conn,
        dbName: DB_NAME,
        containerName: CONTAINER_NAME,
        partitionKey: body.puzzleId,
        doc,
      });
    } catch (err) {
      context.error('cosmos request threw', err);
      return { status: 500, jsonBody: { error: 'server_error' } };
    }

    // Feature W: both a fresh insert (204) and an already-submitted row (409)
    // mean this is a real device with data worth restoring, so stamp the
    // durable deviceId cookie on each.
    const cookie = { 'Set-Cookie': deviceCookieHeader(body.deviceId) };
    if (result.ok) return { status: 204, headers: cookie };
    if (result.error === 'conflict') {
      return { status: 409, headers: cookie, jsonBody: { error: 'already_submitted' } };
    }
    context.error('cosmos insert failed', result);
    return { status: 500, jsonBody: { error: 'server_error' } };
  },
});
