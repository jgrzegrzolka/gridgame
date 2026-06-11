const { app } = require('@azure/functions');
const { validateDeviceIdParam } = require('../lib/validate');
const { queryDocs } = require('../lib/cosmos');
const { createRateLimiter, clientIp } = require('../lib/rateLimit');

const DB_NAME = 'yetanotherquiz';
const CONTAINER_NAME = 'profiles';

// 60 reads/min/IP — generous because every TTT room render fetches the
// opponent's profile, and a busy session can run several rematches per
// minute. Tight enough to stop a script enumerating every deviceId in
// the wild.
const limiter = createRateLimiter({ limit: 60, windowMs: 60_000 });

app.http('getProfile', {
  route: 'v1/profile',
  methods: ['GET'],
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

    const v = validateDeviceIdParam(req.query.get('id'), 'invalid_id');
    if (!v.ok) return { status: 400, jsonBody: { error: v.error } };
    const id = v.value;

    const conn = process.env.COSMOS_CONN;
    if (!conn) {
      context.error('COSMOS_CONN env var is not set');
      return { status: 500, jsonBody: { error: 'server_error' } };
    }

    // Single-doc point read by id+pk. Missing row is a normal state —
    // it just means the device never set a nickname, and the client
    // will fall back to the deterministic default via `displayNickname`.
    let queryRes;
    try {
      queryRes = await queryDocs({
        connString: conn,
        dbName: DB_NAME,
        containerName: CONTAINER_NAME,
        query: 'SELECT c.deviceId, c.nickname FROM c WHERE c.id = @id',
        parameters: [{ name: '@id', value: id }],
        partitionKey: id,
      });
    } catch (err) {
      context.error('cosmos query threw', err);
      return { status: 500, jsonBody: { error: 'server_error' } };
    }
    if (!queryRes.ok) {
      context.error('cosmos query failed', queryRes);
      return { status: 500, jsonBody: { error: 'server_error' } };
    }

    const row = queryRes.docs[0];
    return {
      status: 200,
      jsonBody: {
        deviceId: id,
        nickname: row && typeof row.nickname === 'string' ? row.nickname : null,
      },
    };
  },
});
