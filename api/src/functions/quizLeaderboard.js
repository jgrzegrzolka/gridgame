const { app } = require('@azure/functions');
const {
  validateConfigKeyParam,
  validateDeviceIdParam,
} = require('../lib/validate');
const { lowerWinsFromConfigKey } = require('../lib/quizRecordKey');
const { dateKeyDaysAgo, makePk } = require('../lib/dailyLeaderboardDoc');
const { queryDocs } = require('../lib/cosmos');
const { createRateLimiter, clientIp } = require('../lib/rateLimit');
const { createTtlCache } = require('../lib/ttlCache');
const { readFreshFlag } = require('../lib/queryParams');
const { statsCacheHeaders } = require('../lib/cacheHeaders');
const {
  findMineInTop,
  computeYou,
  qualifiesForLeaderboard,
  cmpEntries,
  dedupByDevice,
  rankInSorted,
} = require('../lib/leaderboardRank');
const { isLocalRequestUrl } = require('../lib/requestHost');

const DB_NAME = 'yetanotherquiz';
const CONTAINER_NAME = 'dailyLeaderboards';
const CACHE_TTL_MS = 60_000;
const ROLLING_WINDOW_MS = 72 * 60 * 60 * 1000;
// Number of UTC-date partitions we fan out across. A 72h rolling
// window can straddle 4 UTC days regardless of the hour we're called
// (e.g. at 23:59 UTC, the cutoff lands at 23:59 three days back —
// still day-3, so 4 distinct date keys: today, yesterday, -2, -3).
// The container TTL must cover this — currently 96h to give one day
// of buffer over the read window.
const WINDOW_DAYS = 4;
// Generous per-partition slice — 50 entries per UTC day, four days
// unioned, dedup yields at most 200 unique devices. Enough headroom
// that the caller's rank can be derived from the deduped + sorted
// list without a second COUNT round-trip. Bump if active devices per
// config grows past ~150 (currently we have ~5).
const PER_PARTITION_LIMIT = 50;
// Must equal TOP_N in flags/dailyLeaderboardRender.js — server/client mismatch
// would silently drop visible rows or fall short of the rendered slot count.
const TOP_N = 10;

const limiter = createRateLimiter({ limit: 60, windowMs: 60_000 });

// Cached top-N keyed by (configKey, order, includeLocal). Date is no
// longer in the key — the rolling 72h window has no per-date
// bucket. The 60 s TTL means a player whose entry just expired (or just
// landed) might see the old list for up to a minute, which is well
// inside the noise floor of a 24 h window.
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

    const now = Date.now();
    const cutoff = now - ROLLING_WINDOW_MS;
    const partitionKeys = Array.from({ length: WINDOW_DAYS }, (_, i) =>
      makePk(configKey, dateKeyDaysAgo(now, i)),
    );
    const order = lowerWins ? 'ASC' : 'DESC';
    // Localhost-served requests include `local: true` rows so a dev can
    // play locally and see their own submission appear on the
    // leaderboard. Prod requests still filter them out via the same
    // server-trusted host check used by dailyResult.js. The flag is
    // part of the cache key so a localhost-served response can't leak
    // into prod through the shared module-scope cache.
    const includeLocal = isLocalRequestUrl(req.url);
    const cacheKey = `${configKey}|${order}|${includeLocal ? 'L' : 'P'}`;
    const fresh = readFreshFlag(req);

    const conn = process.env.COSMOS_CONN;
    if (!conn) {
      context.error('COSMOS_CONN env var is not set');
      return { status: 500, jsonBody: { error: 'server_error' } };
    }

    let cached = fresh ? undefined : topCache.get(cacheKey, now);

    // Build the WHERE clauses from three independent gates:
    //   - `c.submittedAt > @cutoff` is the rolling-window cut: anything
    //     older than 72 h falls off the board even if the row still
    //     lives in Cosmos (TTL keeps rows around for 96 h so the
    //     oldest partition we read still has its data).
    //   - `NOT IS_DEFINED(c.local)` excludes local-dev rows from prod
    //     responses. Localhost callers skip this so a dev playing
    //     locally sees their own submission in the rendered list.
    //   - `c.score > 0` only fires in timed (higher-wins) mode — see
    //     qualifiesForLeaderboard for the rationale. Endurance
    //     (lower-wins) lets a perfect round through.
    // Same gates apply to every partition; query is built once.
    const filters = ['c.submittedAt > @cutoff'];
    if (!includeLocal) filters.push('NOT IS_DEFINED(c.local)');
    if (!lowerWins) filters.push('c.score > 0');
    const where = `WHERE ${filters.join(' AND ')} `;
    const queryText =
      `SELECT TOP ${PER_PARTITION_LIMIT} c.deviceId, c.nickname, c.score, c.durationMs, c.submittedAt ` +
      'FROM c ' +
      where +
      `ORDER BY c.score ${order}, c.durationMs ASC`;
    const parameters = [{ name: '@cutoff', value: cutoff }];

    /** @type {{ top: Array<any>, sorted: Array<any> } | null} */
    let cachedShape = cached || null;

    if (!cachedShape) {
      // Fan out to every partition in parallel. Composite index on
      // (score, durationMs) inside each partition supports the ORDER BY.
      let partitionResults;
      try {
        partitionResults = await Promise.all(
          partitionKeys.map((partitionKey) =>
            queryDocs({
              connString: conn, dbName: DB_NAME, containerName: CONTAINER_NAME,
              query: queryText, parameters, partitionKey,
            }),
          ),
        );
      } catch (err) {
        context.error('cosmos leaderboard fan-out threw', err);
        return { status: 500, jsonBody: { error: 'server_error' } };
      }
      if (partitionResults.some((r) => !r.ok)) {
        context.error('cosmos leaderboard fan-out failed', { partitionResults });
        return { status: 500, jsonBody: { error: 'server_error' } };
      }

      // Merge → dedup → sort → slice. Dedup keeps each device's best
      // entry across the partitions (the same player can have a row in
      // multiple per-day PB buckets; we surface the best of those as
      // their representative score).
      const merged = partitionResults.flatMap((r) => r.docs);
      const deduped = dedupByDevice(merged, lowerWins);
      deduped.sort((a, b) => cmpEntries(a, b, lowerWins));
      const top = deduped.slice(0, TOP_N);
      cachedShape = { top, sorted: deduped };
      topCache.set(cacheKey, cachedShape, now);
    }

    const { top, sorted } = cachedShape;

    // Cached top may already hold the caller's row — avoids deriving rank.
    let mine = findMineInTop(top, deviceId);
    if (!mine) {
      // Caller might be outside top-N but still inside our deduped
      // window. Searching `sorted` (up to ~100 entries) is cheap and
      // gives the exact rank without a Cosmos round-trip. If they're
      // not in `sorted` either, they're past the slice — `you` stays
      // null, same shape as a caller with no row at all.
      mine = sorted.find((r) => r.deviceId === deviceId) || null;
    }

    // Gate the caller too: a timed-mode score=0 caller doesn't get
    // computed in/out of the rank — they're excluded from the board and
    // `you` will be null, so the renderer doesn't append a "…N. You" row.
    const mineQualifies =
      mine !== null && qualifiesForLeaderboard({ score: mine.score, lowerWins });

    const ahead = mineQualifies ? (rankInSorted(sorted, deviceId) || 1) - 1 : null;

    return {
      status: 200,
      headers: statsCacheHeaders({ fresh, ttlMs: CACHE_TTL_MS }),
      jsonBody: {
        configKey,
        // Surface the window semantics so a client that wants to render
        // a "last 24 h" subtitle has the data without computing it.
        windowMs: ROLLING_WINDOW_MS,
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
