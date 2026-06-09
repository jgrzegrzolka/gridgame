const { app } = require('@azure/functions');
const { CosmosClient } = require('@azure/cosmos');
const { validateResult } = require('../../lib/validate');

// Cached across warm invocations on the same Function instance — the
// CosmosClient holds a connection pool, recreating it per request would
// negate the warm path. On cold start it's null and we create one.
let containerCache = null;

function getContainer() {
  if (containerCache) return containerCache;
  const conn = process.env.COSMOS_CONN;
  if (!conn) throw new Error('COSMOS_CONN env var is not set');
  const client = new CosmosClient(conn);
  containerCache = client.database('yetanotherquiz').container('dailyResults');
  return containerCache;
}

app.http('dailyResult', {
  route: 'v1/daily/result',
  methods: ['POST'],
  authLevel: 'anonymous',
  handler: async (req, context) => {
    let body;
    try {
      body = await req.json();
    } catch {
      return { status: 400, jsonBody: { error: 'invalid_json' } };
    }
    const v = validateResult(body);
    if (!v.ok) return { status: 400, jsonBody: { error: v.error } };

    const doc = {
      id: `${body.puzzleId}:${body.deviceId}`,
      puzzleId: body.puzzleId,
      deviceId: body.deviceId,
      foundCodes: body.foundCodes,
      totalCount: body.totalCount,
      durationMs: body.durationMs,
      submittedAt: Date.now(),
    };
    try {
      await getContainer().items.create(doc);
      return { status: 204 };
    } catch (err) {
      // Cosmos throws on UNIQUE-key violation with .code === 409.
      if (err && err.code === 409) {
        return { status: 409, jsonBody: { error: 'already_submitted' } };
      }
      context.error('cosmos insert failed', err);
      return { status: 500, jsonBody: { error: 'server_error' } };
    }
  },
});
