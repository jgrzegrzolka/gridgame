const { app } = require('@azure/functions');
const { validateProfileDeletionBody } = require('../lib/validate');
const { insertDoc, queryDocs } = require('../lib/cosmos');
const { createRateLimiter, clientIp } = require('../lib/rateLimit');
const { verifyTurnstile } = require('../lib/turnstile');
const { buildProfileDoc } = require('../lib/profileDoc');

const DB_NAME = 'yetanotherquiz';
const CONTAINER_NAME = 'profiles';

// Same 5/min/IP as the nickname PUT — deletion requests are even rarer
// than nickname edits in the legitimate case, so the bound costs nothing
// and shuts down "spam the button" abuse.
const limiter = createRateLimiter({ limit: 5, windowMs: 60_000 });

app.http('profileDeletion', {
  route: 'v1/profile/requestDeletion',
  // POST (not DELETE): the row stays in Cosmos, we're just flagging
  // it for the manual purge run. The user's data isn't gone yet —
  // calling it DELETE would lie about what actually happened.
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
    const v = validateProfileDeletionBody(body);
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

    // Read the existing profile row so the upsert preserves createdAt
    // and keeps the existing nickname (if any). A device with NO profile
    // row yet (they played but never set a nickname) gets a fresh row
    // with nickname=null + deletionRequestedAt=now — same shape as a
    // first-time nickname write, just inverted on which fields fire.
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
      nickname: existing && typeof existing.nickname !== 'undefined' ? existing.nickname : null,
      now: Date.now(),
      requestDeletion: true,
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
