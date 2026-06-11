const { app } = require('@azure/functions');
const { validateProfileBody } = require('../lib/validate');
const { insertDoc, queryDocs } = require('../lib/cosmos');
const { createRateLimiter, clientIp } = require('../lib/rateLimit');
const { verifyTurnstile } = require('../lib/turnstile');
const { buildProfileDoc } = require('../lib/profileDoc');

const DB_NAME = 'yetanotherquiz';
const CONTAINER_NAME = 'profiles';

// 5 writes/min/IP — matches dailyResult's discipline. Nickname changes
// are rare in the legitimate case (set once, edit occasionally) so a
// tight bound costs nothing and stops automated abuse.
const limiter = createRateLimiter({ limit: 5, windowMs: 60_000 });

app.http('profile', {
  route: 'v1/profile',
  // PUT semantics: idempotent upsert of the device's nickname. Same
  // body twice = same row state. Per FEATURE.md Feature H2.
  methods: ['PUT'],
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
    const v = validateProfileBody(body);
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

    // Read the device's existing profile row (one row per device, partitioned
    // by deviceId — same single-partition pattern as quizRecord). We need
    // the existing row so `buildProfileDoc` can preserve createdAt across
    // the upsert (so the first-write timestamp survives every nickname edit).
    let queryRes;
    try {
      queryRes = await queryDocs({
        connString: conn,
        dbName: DB_NAME,
        containerName: CONTAINER_NAME,
        query: 'SELECT * FROM c WHERE c.id = @id',
        parameters: [{ name: '@id', value: v.value.deviceId }],
        partitionKey: v.value.deviceId,
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

    const doc = buildProfileDoc({
      existing,
      deviceId: v.value.deviceId,
      nickname: v.value.nickname,
      now: Date.now(),
    });

    let upsertRes;
    try {
      upsertRes = await insertDoc({
        connString: conn,
        dbName: DB_NAME,
        containerName: CONTAINER_NAME,
        partitionKey: v.value.deviceId,
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
