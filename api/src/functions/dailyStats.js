const { app } = require('@azure/functions');
const { LIMITS } = require('../lib/validate');
const { queryDocs } = require('../lib/cosmos');
const { aggregate } = require('../lib/aggregate');
const { createTtlCache } = require('../lib/ttlCache');

const DB_NAME = 'yetanotherquiz';
const CONTAINER_NAME = 'dailyResults';
const CACHE_TTL_MS = 60_000;

// Module-scope cache: shared across invocations on the same warm
// Function instance. Cold start resets it — same tradeoff as the
// rate limiter. The 60s TTL also matches the Cache-Control we set
// on the response so browser + edge cache the same window.
const cache = createTtlCache({ ttlMs: CACHE_TTL_MS });

app.http('dailyStats', {
  route: 'v1/daily/stats/{puzzleId}',
  methods: ['GET'],
  authLevel: 'anonymous',
  handler: async (req, context) => {
    const id = Number(req.params.puzzleId);
    if (!Number.isInteger(id) || id < LIMITS.PUZZLE_ID_MIN || id > LIMITS.PUZZLE_ID_MAX) {
      return { status: 400, jsonBody: { error: 'invalid_puzzleId' } };
    }

    const now = Date.now();
    const cached = cache.get(id, now);
    if (cached) {
      return { status: 200, headers: cacheHeaders(), jsonBody: cached };
    }

    const conn = process.env.COSMOS_CONN;
    if (!conn) {
      context.error('COSMOS_CONN env var is not set');
      return { status: 500, jsonBody: { error: 'server_error' } };
    }

    let result;
    try {
      result = await queryDocs({
        connString: conn,
        dbName: DB_NAME,
        containerName: CONTAINER_NAME,
        query: 'SELECT c.foundCodes, c.totalCount FROM c WHERE c.puzzleId = @pid',
        parameters: [{ name: '@pid', value: id }],
        partitionKey: id,
      });
    } catch (err) {
      context.error('cosmos query threw', err);
      return { status: 500, jsonBody: { error: 'server_error' } };
    }

    if (!result.ok) {
      context.error('cosmos query failed', result);
      return { status: 500, jsonBody: { error: 'server_error' } };
    }

    const stats = aggregate(result.docs);
    cache.set(id, stats, now);
    return { status: 200, headers: cacheHeaders(), jsonBody: stats };
  },
});

function cacheHeaders() {
  return { 'Cache-Control': `public, max-age=${CACHE_TTL_MS / 1000}` };
}
