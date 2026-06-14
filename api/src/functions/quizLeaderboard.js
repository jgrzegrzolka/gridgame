const { app } = require('@azure/functions');
const {
  validateConfigKeyParam,
  validateDeviceIdParam,
} = require('../lib/validate');
const { lowerWinsFromConfigKey } = require('../lib/quizRecordKey');
const { todayDateKey, makePk } = require('../lib/dailyLeaderboardDoc');
const { queryDocs } = require('../lib/cosmos');
const { createRateLimiter, clientIp } = require('../lib/rateLimit');
const { createTtlCache } = require('../lib/ttlCache');
const { readFreshFlag } = require('../lib/queryParams');
const { statsCacheHeaders } = require('../lib/cacheHeaders');
const { rankCmpClause, findMineInTop, computeYou, qualifiesForLeaderboard } = require('../lib/leaderboardRank');
const { isLocalRequestUrl } = require('../lib/requestHost');

const DB_NAME = 'yetanotherquiz';
const CONTAINER_NAME = 'dailyLeaderboards';
const CACHE_TTL_MS = 60_000;
// Must equal TOP_N in flags/dailyLeaderboardRender.js — server/client mismatch
// would silently drop visible rows or fall short of the rendered slot count.
const TOP_N = 10;

const limiter = createRateLimiter({ limit: 60, windowMs: 60_000 });

// Cached top-N keyed by (pk, order). Order is included so a future
// `?order=` override or third mode can't serve a wrong-direction list.
const topCache = createTtlCache({ ttlMs: CACHE_TTL_MS });

app.http('quizLeaderboard', {
  route: 'v1/quiz/leaderboard/{configKey}',
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

    const v = validateConfigKeyParam(req.params.configKey);
    if (!v.ok) return { status: 400, jsonBody: { error: v.error } };
    const configKey = v.value;

    const lowerWins = lowerWinsFromConfigKey(configKey);
    if (lowerWins === null) {
      return { status: 400, jsonBody: { error: 'unknown_mode' } };
    }

    const dv = validateDeviceIdParam(req.query.get('deviceId'), 'invalid_deviceId');
    if (!dv.ok) return { status: 400, jsonBody: { error: dv.error } };
    const deviceId = dv.value;

    const dateKey = todayDateKey(Date.now());
    const pk = makePk(configKey, dateKey);
    const order = lowerWins ? 'ASC' : 'DESC';
    // Localhost-served requests include `local: true` rows so a dev can
    // play locally and see their own submission appear on the
    // leaderboard. Prod requests still filter them out via the same
    // server-trusted host check used by dailyResult.js. The flag is
    // part of the cache key so a localhost-served response can't leak
    // into prod through the shared module-scope cache.
    const includeLocal = isLocalRequestUrl(req.url);
    const cacheKey = `${pk}|${order}|${includeLocal ? 'L' : 'P'}`;
    const fresh = readFreshFlag(req);

    const conn = process.env.COSMOS_CONN;
    if (!conn) {
      context.error('COSMOS_CONN env var is not set');
      return { status: 500, jsonBody: { error: 'server_error' } };
    }

    const now = Date.now();
    let top = fresh ? undefined : topCache.get(cacheKey, now);

    // Build the WHERE clauses from two independent gates:
    //   - `NOT IS_DEFINED(c.local)` excludes local-dev rows from prod
    //     responses. Localhost callers skip this so a dev playing
    //     locally sees their own submission in the rendered list.
    //   - `c.score > 0` only fires in timed (higher-wins) mode — see
    //     qualifiesForLeaderboard for the rationale. Endurance
    //     (lower-wins) lets a perfect round through.
    // Both the top query and the rank-count query need the same gates,
    // so factor them once.
    const filters = [];
    if (!includeLocal) filters.push('NOT IS_DEFINED(c.local)');
    if (!lowerWins) filters.push('c.score > 0');
    const whereCommon = filters.length ? `WHERE ${filters.join(' AND ')} ` : '';
    const andCommon = filters.length ? ` AND ${filters.join(' AND ')}` : '';

    if (!top) {
      // Composite index on (score, durationMs) provisioned at create time.
      const topQuery =
        `SELECT TOP ${TOP_N} c.deviceId, c.nickname, c.score, c.durationMs, c.submittedAt ` +
        'FROM c ' +
        whereCommon +
        `ORDER BY c.score ${order}, c.durationMs ASC`;
      let topRes;
      try {
        topRes = await queryDocs({
          connString: conn,
          dbName: DB_NAME,
          containerName: CONTAINER_NAME,
          query: topQuery,
          parameters: [],
          partitionKey: pk,
        });
      } catch (err) {
        context.error('cosmos top query threw', err);
        return { status: 500, jsonBody: { error: 'server_error' } };
      }
      if (!topRes.ok) {
        context.error('cosmos top query failed', topRes);
        return { status: 500, jsonBody: { error: 'server_error' } };
      }
      top = topRes.docs;
      topCache.set(cacheKey, top, now);
    }

    // Cached top may already hold the caller's row — avoids an extra read.
    let mine = findMineInTop(top, deviceId);
    if (!mine) {
      try {
        const meRes = await queryDocs({
          connString: conn,
          dbName: DB_NAME,
          containerName: CONTAINER_NAME,
          query: 'SELECT c.score, c.durationMs FROM c WHERE c.id = @id',
          parameters: [{ name: '@id', value: deviceId }],
          partitionKey: pk,
        });
        if (meRes.ok) mine = meRes.docs[0] || null;
      } catch (err) {
        context.warn('cosmos me query threw (rank skipped)', err);
      }
    }

    // Gate the caller too: a timed-mode score=0 caller doesn't get
    // computed in/out of the rank — they're excluded from the board and
    // `you` will be null, so the renderer doesn't append a "…N. You" row.
    const mineQualifies =
      mine !== null && qualifiesForLeaderboard({ score: mine.score, lowerWins });

    let ahead = null;
    if (mine && mineQualifies) {
      const rankQuery =
        'SELECT VALUE COUNT(1) FROM c ' +
        `WHERE ${rankCmpClause(lowerWins)}${andCommon}`;
      try {
        const rankRes = await queryDocs({
          connString: conn,
          dbName: DB_NAME,
          containerName: CONTAINER_NAME,
          query: rankQuery,
          parameters: [
            { name: '@s', value: mine.score },
            { name: '@d', value: mine.durationMs },
          ],
          partitionKey: pk,
        });
        if (rankRes.ok) ahead = rankRes.docs[0] ?? 0;
      } catch (err) {
        context.warn('cosmos rank query threw (rank skipped)', err);
      }
    }

    return {
      status: 200,
      headers: statsCacheHeaders({ fresh, ttlMs: CACHE_TTL_MS }),
      jsonBody: {
        configKey,
        date: dateKey,
        top: top.map((r) => ({
          deviceId: r.deviceId,
          nickname: typeof r.nickname === 'string' ? r.nickname : null,
          score: r.score,
          durationMs: r.durationMs,
          submittedAt: r.submittedAt,
        })),
        // Pass `mine` only if the caller qualifies — a disqualified caller
        // (timed mode + score=0) gets `you: null` so the renderer doesn't
        // append a trailing self-row.
        you: computeYou({ mine: mineQualifies ? mine : null, ahead }),
      },
    };
  },
});
