const { app } = require('@azure/functions');
const { validateDeviceIdParam, validatePuzzleIdParam } = require('../lib/validate');
const { queryDocs } = require('../lib/cosmos');
const { createTtlCache } = require('../lib/ttlCache');
const { createRateLimiter, clientIp } = require('../lib/rateLimit');
const { readFreshFlag } = require('../lib/queryParams');
const { statsCacheHeaders } = require('../lib/cacheHeaders');
const { computeStreak } = require('../lib/streakCompute');

const DB_NAME = 'yetanotherquiz';
const CONTAINER_NAME = 'dailyResults';
const CACHE_TTL_MS = 60_000;

// Per-deviceId cache. Same warm-instance / cold-start tradeoff as the
// dailyStats cache — the deviceId selectivity means cache entries don't
// stomp on each other across players.
const cache = createTtlCache({ ttlMs: CACHE_TTL_MS });

// 60 reads/min/IP — matches getProfile. Loose enough to handle a
// player who lands on /profile/ and immediately finishes a puzzle
// (two reads), tight enough to slow a script enumerating deviceIds.
const limiter = createRateLimiter({ limit: 60, windowMs: 60_000 });

app.http('dailyMe', {
  route: 'v1/daily/me',
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

    // `latestPuzzleId` is optional. When present, it tells computeStreak
    // "what's today's puzzle id" so a player whose most recent row is
    // older returns currentStreak=0 instead of yesterday's stale value.
    // The client knows it (the daily page already has the puzzle
    // loaded); the server doesn't, and asking Cosmos for max(puzzleId)
    // would add a second cross-partition query per request.
    let latestPuzzleId;
    const rawLatest = req.query.get('latestPuzzleId');
    if (rawLatest !== null) {
      const lp = validatePuzzleIdParam(rawLatest);
      if (!lp.ok) return { status: 400, jsonBody: { error: 'invalid_latestPuzzleId' } };
      latestPuzzleId = lp.value;
    }

    const now = Date.now();
    const fresh = readFreshFlag(req);
    // Cache key folds latestPuzzleId in: the same deviceId with two
    // different "today" values produces two different currentStreak
    // results, so they must not share a cache slot.
    const cacheKey = `${deviceId}|${latestPuzzleId ?? ''}`;
    if (!fresh) {
      const cached = cache.get(cacheKey, now);
      if (cached) {
        return {
          status: 200,
          headers: statsCacheHeaders({ fresh, ttlMs: CACHE_TTL_MS }),
          jsonBody: cached,
        };
      }
    }

    const conn = process.env.COSMOS_CONN;
    if (!conn) {
      context.error('COSMOS_CONN env var is not set');
      return { status: 500, jsonBody: { error: 'server_error' } };
    }

    // Cross-partition scan filtered to one deviceId. At current scale
    // (~50 puzzles × ~50 results/puzzle = ~2.5K docs / partition fan-out)
    // this is well below the cross-partition pain threshold. If it
    // grows we'll cache a per-device `streak:{deviceId}` doc updated
    // on each dailyResult.js write (Feature N's tail-cost mitigation).
    //
    // local:true rows are included — for the player's own streak, the
    // owner's localhost plays are their own plays, same as the daily
    // aggregator's policy. Cleanup uses the dev-reset toolbar.
    let queryRes;
    try {
      queryRes = await queryDocs({
        connString: conn,
        dbName: DB_NAME,
        containerName: CONTAINER_NAME,
        query: 'SELECT c.puzzleId FROM c WHERE c.deviceId = @did',
        parameters: [{ name: '@did', value: deviceId }],
        enableCrossPartition: true,
      });
    } catch (err) {
      context.error('cosmos query threw', err);
      return { status: 500, jsonBody: { error: 'server_error' } };
    }
    if (!queryRes.ok) {
      context.error('cosmos query failed', queryRes);
      return { status: 500, jsonBody: { error: 'server_error' } };
    }

    // Every row in dailyResults is a finished submission today, so
    // every row maps to completed:true. The shape stays open for a
    // future Feature M start-event signal where some rows are
    // started-but-not-finished.
    const rows = queryRes.docs
      .filter((d) => Number.isInteger(d.puzzleId))
      .map((d) => ({ puzzleId: d.puzzleId, completed: true }));

    const result = computeStreak({ rows, latestPuzzleId });
    cache.set(cacheKey, result, now);
    return {
      status: 200,
      headers: statsCacheHeaders({ fresh, ttlMs: CACHE_TTL_MS }),
      jsonBody: result,
    };
  },
});
