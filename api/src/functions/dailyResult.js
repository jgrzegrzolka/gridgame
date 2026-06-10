const { app } = require('@azure/functions');
const { validateResult } = require('../lib/validate');
const { insertDoc } = require('../lib/cosmos');
const { createRateLimiter, clientIp } = require('../lib/rateLimit');
const { verifyTurnstile } = require('../lib/turnstile');
const { buildDailyResultDoc } = require('../lib/dailyResultDoc');

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

    const doc = buildDailyResultDoc({
      puzzleId: body.puzzleId,
      deviceId: body.deviceId,
      foundCodes: body.foundCodes,
      wrongCodes: body.wrongCodes,
      totalCount: body.totalCount,
      durationMs: body.durationMs,
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

    if (result.ok) return { status: 204 };
    if (result.error === 'conflict') {
      return { status: 409, jsonBody: { error: 'already_submitted' } };
    }
    context.error('cosmos insert failed', result);
    return { status: 500, jsonBody: { error: 'server_error' } };
  },
});
