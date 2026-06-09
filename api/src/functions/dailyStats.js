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
    // `?fresh=1` is set by the client immediately after a POST so the
    // player sees their own just-submitted result reflected. Skips the
    // cache lookup, then writes the fresh result back so subsequent
    // GETs (other players, this player's revisits) get the new data
    // without their own bypass.
    const fresh = readFreshFlag(req);
    if (!fresh) {
      const cached = cache.get(id, now);
      if (cached) {
        return { status: 200, headers: cacheHeaders(fresh), jsonBody: cached };
      }
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
    return { status: 200, headers: cacheHeaders(fresh), jsonBody: stats };
  },
});

/**
 * Read `?fresh=1` from the request URL. Returns true only on the
 * exact string "1" to avoid surprises (no truthy URL params, no
 * accidental cache-busting from typos). Exported for unit tests.
 */
function readFreshFlag(req) {
  try {
    return new URL(req.url).searchParams.get('fresh') === '1';
  } catch {
    return false;
  }
}

module.exports = { readFreshFlag };

/**
 * Tell the browser / edge to cache the response for the same window
 * the server caches it. When the request is `?fresh=1` we don't want
 * the browser to remember this response (it's a one-off bypass), so
 * we send `no-store` instead.
 */
function cacheHeaders(fresh) {
  return fresh
    ? { 'Cache-Control': 'no-store' }
    : { 'Cache-Control': `public, max-age=${CACHE_TTL_MS / 1000}` };
}
