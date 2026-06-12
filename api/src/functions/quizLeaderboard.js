const { app } = require('@azure/functions');
const {
  validateConfigKeyParam,
  validateDateKeyParam,
  validateDeviceIdParam,
} = require('../lib/validate');
const { lowerWinsFromConfigKey } = require('../lib/quizRecordKey');
const { todayDateKey, makePk } = require('../lib/dailyLeaderboardDoc');
const { queryDocs } = require('../lib/cosmos');
const { createRateLimiter, clientIp } = require('../lib/rateLimit');
const { createTtlCache } = require('../lib/ttlCache');
const { readFreshFlag } = require('../lib/queryParams');
const { statsCacheHeaders } = require('../lib/cacheHeaders');

const DB_NAME = 'yetanotherquiz';
const CONTAINER_NAME = 'dailyLeaderboards';
const CACHE_TTL_MS = 60_000;
const TOP_N = 10;

// 60 reads/min/IP — same envelope as getProfile. A player viewing the
// finish screen does one read; quick replay → one more. Tight enough to
// stop an enumeration script reading every (configKey, date) combo in
// the wild.
const limiter = createRateLimiter({ limit: 60, windowMs: 60_000 });

// Top-N is cached by partition (configKey + date). The caller's rank is
// per-deviceId and always recomputed — it's a single COUNT(1), cheap.
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

    // Derived server-side from the configKey's mode token. Refused as a
    // client field because flipping it would let a caller invert the
    // ranking direction and distort competitors' positions.
    const lowerWins = lowerWinsFromConfigKey(configKey);
    if (lowerWins === null) {
      return { status: 400, jsonBody: { error: 'unknown_mode' } };
    }

    // Optional ?date=YYYY-MM-DD — defaults to today UTC. Same UTC cutoff
    // as the writer so caller and writer always agree on "today".
    const rawDate = req.query.get('date');
    let dateKey;
    if (rawDate === null || rawDate === undefined) {
      dateKey = todayDateKey(Date.now());
    } else {
      const dv = validateDateKeyParam(rawDate);
      if (!dv.ok) return { status: 400, jsonBody: { error: dv.error } };
      dateKey = dv.value;
    }

    // Optional ?deviceId=… — when supplied, the response includes the
    // caller's row and rank. When omitted, the endpoint still returns
    // the top-N (e.g. for a non-player viewer or a server-side renderer).
    const rawDevice = req.query.get('deviceId');
    let deviceId = null;
    if (rawDevice !== null && rawDevice !== undefined && rawDevice !== '') {
      const dv = validateDeviceIdParam(rawDevice, 'invalid_deviceId');
      if (!dv.ok) return { status: 400, jsonBody: { error: dv.error } };
      deviceId = dv.value;
    }

    const pk = makePk(configKey, dateKey);
    const fresh = readFreshFlag(req);

    const conn = process.env.COSMOS_CONN;
    if (!conn) {
      context.error('COSMOS_CONN env var is not set');
      return { status: 500, jsonBody: { error: 'server_error' } };
    }

    const now = Date.now();
    let top = fresh ? undefined : topCache.get(pk, now);

    if (!top) {
      // Multi-field ORDER BY requires a composite index on (score,
      // durationMs) — provisioned at container-create time. The local
      // exclusion uses `NOT IS_DEFINED(c.local)` so prod rows (no flag)
      // pass and dev rows (`local: true`) are filtered out.
      const order = lowerWins ? 'ASC' : 'DESC';
      const topQuery =
        `SELECT TOP ${TOP_N} c.deviceId, c.nickname, c.score, c.durationMs, c.submittedAt ` +
        'FROM c ' +
        'WHERE (NOT IS_DEFINED(c.local) OR c.local = false) ' +
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
      topCache.set(pk, top, now);
    }

    // Caller's row + rank — only computed when deviceId is supplied.
    let you = null;
    if (deviceId !== null) {
      // Re-use the cached top-N if the caller is already in it; avoids
      // an extra Cosmos read for the common "I made the top 10" case.
      let mine = top.find((r) => r.deviceId === deviceId) || null;
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

      if (mine) {
        // Players ahead = strictly better score, or equal score + faster
        // duration. Equal score + equal duration share the same rank (we
        // don't fractionally rank).
        const cmp = lowerWins
          ? '(c.score < @s OR (c.score = @s AND c.durationMs < @d))'
          : '(c.score > @s OR (c.score = @s AND c.durationMs < @d))';
        const rankQuery =
          'SELECT VALUE COUNT(1) FROM c ' +
          `WHERE ${cmp} AND (NOT IS_DEFINED(c.local) OR c.local = false)`;
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
          if (rankRes.ok) {
            const ahead = rankRes.docs[0] ?? 0;
            you = {
              rank: ahead + 1,
              score: mine.score,
              durationMs: mine.durationMs,
            };
          }
        } catch (err) {
          context.warn('cosmos rank query threw (rank skipped)', err);
        }
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
        you,
      },
    };
  },
});
