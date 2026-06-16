const { app } = require('@azure/functions');
const { validateDeviceIdParam } = require('../lib/validate');
const { queryDocs } = require('../lib/cosmos');
const { createRateLimiter, clientIp } = require('../lib/rateLimit');

const DB_NAME = 'yetanotherquiz';
const CONTAINER_NAME = 'profiles';

// 30 reads/min/IP. The sync page calls this once on every boot when the
// user lands without an `identityId` locally, so a tab-thrasher could
// in theory burn through; 30 leaves room for normal navigation without
// being an enumeration vector.
const limiter = createRateLimiter({ limit: 30, windowMs: 60_000 });

app.http('syncLink', {
  route: 'v1/sync/link',
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

    const v = validateDeviceIdParam(req.query.get('deviceId'), 'invalid_deviceId');
    if (!v.ok) return { status: 400, jsonBody: { error: v.error } };
    const deviceId = v.value;

    const conn = process.env.COSMOS_CONN;
    if (!conn) {
      context.error('COSMOS_CONN env var is not set');
      return { status: 500, jsonBody: { error: 'server_error' } };
    }

    // Project only `linkedAt` — the sync page doesn't need anything
    // else to decide whether to flip into the linked state, and the
    // smaller projection means the cross-row migration (when we
    // eventually add `linkedAt` to existing rows) doesn't have to
    // backfill anything else for this endpoint to start returning.
    let queryRes;
    try {
      queryRes = await queryDocs({
        connString: conn,
        dbName: DB_NAME,
        containerName: CONTAINER_NAME,
        query: 'SELECT c.linkedAt FROM c WHERE c.id = @id',
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

    const row = queryRes.docs[0];
    const linkedAt = row && typeof row.linkedAt === 'number' ? row.linkedAt : null;
    return {
      status: 200,
      jsonBody: { linked: linkedAt !== null, linkedAt },
    };
  },
});
