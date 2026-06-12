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
const { rankCmpClause, findMineInTop, computeYou } = require('../lib/leaderboardRank');

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
    const cacheKey = `${pk}|${order}`;
    const fresh = readFreshFlag(req);

    const conn = process.env.COSMOS_CONN;
    if (!conn) {
      context.error('COSMOS_CONN env var is not set');
      return { status: 500, jsonBody: { error: 'server_error' } };
    }

    const now = Date.now();
    let top = fresh ? undefined : topCache.get(cacheKey, now);

    if (!top) {
      // Composite index on (score, durationMs) provisioned at create time.
      // `NOT IS_DEFINED(c.local)` rejects any local row regardless of value
      // — writer only sets `true`, never `false`, so a future stray `false`
      // shouldn't sneak past.
      const topQuery =
        `SELECT TOP ${TOP_N} c.deviceId, c.nickname, c.score, c.durationMs, c.submittedAt ` +
        'FROM c ' +
        'WHERE NOT IS_DEFINED(c.local) ' +
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

    let ahead = null;
    if (mine) {
      const rankQuery =
        'SELECT VALUE COUNT(1) FROM c ' +
        `WHERE ${rankCmpClause(lowerWins)} AND NOT IS_DEFINED(c.local)`;
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
        you: computeYou({ mine, ahead }),
      },
    };
  },
});
