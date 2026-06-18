const { app } = require('@azure/functions');
const { validateDeviceIdParam } = require('../lib/validate');
const { queryDocs } = require('../lib/cosmos');
const { createTtlCache } = require('../lib/ttlCache');
const { createRateLimiter, clientIp } = require('../lib/rateLimit');
const { readFreshFlag } = require('../lib/queryParams');
const { statsCacheHeaders } = require('../lib/cacheHeaders');
const { computeStreak, submissionsToStreakRows } = require('../lib/streakCompute');
const { computeMastery } = require('../lib/masteryCompute');
const { warsawDayNumber } = require('../lib/warsawDay');

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

    const now = Date.now();
    const fresh = readFreshFlag(req);
    if (!fresh) {
      const cached = cache.get(deviceId, now);
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
    // We select `submittedAt` for streak math, plus `foundCodes`,
    // `wrongCodes`, and `totalCount` for Feature O mastery counters
    // (clean sweeps, flawless sweeps, zero-score finishes). Streaks
    // count consecutive *Warsaw days* the player submitted something,
    // not consecutive puzzleIds. Doing archive puzzles #1, #2, #3 in
    // one sitting today gives streak = 1 (one day with plays), not
    // streak = 3.
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
        query: 'SELECT c.submittedAt, c.foundCodes, c.wrongCodes, c.totalCount FROM c WHERE c.deviceId = @did',
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

    const rows = submissionsToStreakRows(queryRes.docs, warsawDayNumber);
    // Compute "today" server-side so currentStreak resets to 0 when
    // the player's most recent submission is older than today (they
    // skipped at least today). Defends the profile-page revisit case
    // — without it, a player who hasn't shown up in three days would
    // still see their old streak count.
    const today = warsawDayNumber(now);
    const streak = computeStreak({ rows, latestId: today ?? undefined });
    const mastery = computeMastery(queryRes.docs);
    const result = { ...streak, ...mastery };
    cache.set(deviceId, result, now);
    return {
      status: 200,
      headers: statsCacheHeaders({ fresh, ttlMs: CACHE_TTL_MS }),
      jsonBody: result,
    };
  },
});
