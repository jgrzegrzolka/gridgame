const { app } = require('@azure/functions');
const { validateTttResultBody } = require('../lib/validate');
const { insertDoc, queryDocs } = require('../lib/cosmos');
const { createRateLimiter, clientIp } = require('../lib/rateLimit');
const { verifyTurnstile } = require('../lib/turnstile');
const { mergePairResult } = require('../lib/tttPairDoc');

const DB_NAME = 'yetanotherquiz';
const CONTAINER_NAME = 'tttPairs';

// 10 writes/min/IP — a single online TTT game lasts ~30s minimum, so
// ten reports per minute already covers a rapid-rematch session. Higher
// values let one IP grief the head-to-head row of any pair they've ever
// played; tighter values would block normal play.
const limiter = createRateLimiter({ limit: 10, windowMs: 60_000 });

app.http('tttResult', {
  route: 'v1/ttt/result',
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
    const v = validateTttResultBody(body);
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

    const { deviceId, opponentId, mode, outcome } = v.value;
    const docId = `${deviceId}:${opponentId}`;

    // Read existing head-to-head row (one row per pair, partitioned by THIS
    // device's id, so single-partition). Merge increments the right counter
    // and upserts. Same read-then-upsert pattern as quizRecord / profile.
    let queryRes;
    try {
      queryRes = await queryDocs({
        connString: conn,
        dbName: DB_NAME,
        containerName: CONTAINER_NAME,
        query: 'SELECT * FROM c WHERE c.id = @id',
        parameters: [{ name: '@id', value: docId }],
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
    const existing = queryRes.docs[0] || null;

    const doc = mergePairResult({
      existing,
      deviceId,
      opponentId,
      mode,
      outcome,
      now: Date.now(),
    });

    let upsertRes;
    try {
      upsertRes = await insertDoc({
        connString: conn,
        dbName: DB_NAME,
        containerName: CONTAINER_NAME,
        partitionKey: deviceId,
        doc,
        upsert: true,
      });
    } catch (err) {
      context.error('cosmos upsert threw', err);
      return { status: 500, jsonBody: { error: 'server_error' } };
    }
    if (upsertRes.ok) return { status: 204 };
    context.error('cosmos upsert failed', upsertRes);
    return { status: 500, jsonBody: { error: 'server_error' } };
  },
});
