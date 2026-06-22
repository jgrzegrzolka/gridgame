const { app } = require('@azure/functions');
const { validateDeviceIdParam } = require('../lib/validate');
const { queryDocs } = require('../lib/cosmos');
const { createTtlCache } = require('../lib/ttlCache');
const { createRateLimiter, clientIp } = require('../lib/rateLimit');
const { readFreshFlag } = require('../lib/queryParams');
const { statsCacheHeaders } = require('../lib/cacheHeaders');
const { computeStreak, submissionsToStreakRows, dayLogToStreakRows } = require('../lib/streakCompute');
const { computeMastery } = require('../lib/masteryCompute');
const { computeQuiz } = require('../lib/quizCompute');
const { computeEngagement } = require('../lib/engagementCompute');
const { computeTttSignals } = require('../lib/tttCompute');
const { warsawDayNumber } = require('../lib/warsawDay');

const DB_NAME = 'yetanotherquiz';
const CONTAINER_NAME = 'dailyResults';
const QUIZ_RECORDS_CONTAINER = 'quizRecords';
const PROFILES_CONTAINER = 'profiles';
const TTT_PAIRS_CONTAINER = 'tttPairs';
const CACHE_TTL_MS = 60_000;

// Sovereign-only ("sov") pool sizes per quiz variant. Source of truth
// for the "Cleared <variant>" achievements — a 60s PB that meets or
// exceeds the variant's sov pool size counts as a clear (across either
// includeAll value). The numbers must match what `flagsGamePool(c,
// false)` produces against `flags/countries.json`; the drift detector
// `flags/countries.test.js` pins them so a country added or removed
// without updating this map fails CI loudly.
const SOV_POOL_SIZES = {
  countries: 195,
  europe: 45,
  asia: 47,
  africa: 54,
  'north-america': 23,
  'south-america': 12,
  oceania: 14,
};

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

    // Quiz aggregates: single-partition query against the player's
    // `quizRecords` doc (id == pk == deviceId). At most one row;
    // returns empty quiz counters if the player has never finished a
    // round. Treated as a soft dependency — a Cosmos blip on this
    // query degrades to zero quiz counters rather than 500'ing the
    // whole snapshot (the streak + mastery fields are still useful).
    let quizDoc = null;
    try {
      const quizRes = await queryDocs({
        connString: conn,
        dbName: DB_NAME,
        containerName: QUIZ_RECORDS_CONTAINER,
        query: 'SELECT * FROM c WHERE c.id = @did',
        parameters: [{ name: '@did', value: deviceId }],
        partitionKey: deviceId,
      });
      if (quizRes.ok && quizRes.docs.length > 0) quizDoc = quizRes.docs[0];
    } catch (err) {
      context.warn('cosmos quizRecords read failed (soft-degraded to zero quiz counters)', err);
    }
    const quiz = computeQuiz(quizDoc, SOV_POOL_SIZES);

    // Cross-game engagement signals: profile point-read + TTT pair
    // read, in parallel. Pre-Phase-4 this also did a cross-partition
    // scan of `engagementEvents`; Feature S Phase 4 moved that data
    // into `profile.syncBlob.engagement` so a single profile point-
    // read covers nickname, linkedAt, and the engagement counters at
    // once. Both reads are soft dependencies — a Cosmos blip degrades
    // to "no signal" rather than 500'ing the whole snapshot.
    let profileDoc = null;
    /** @type {Array<{ m3x3?: { wins?: number, losses?: number, draws?: number }, m9x9?: { wins?: number, losses?: number, draws?: number } }>} */
    let tttPairs = [];
    try {
      const [profileRes, tttRes] = await Promise.all([
        queryDocs({
          connString: conn,
          dbName: DB_NAME,
          containerName: PROFILES_CONTAINER,
          query: 'SELECT c.nickname, c.linkedAt, c.syncBlob FROM c WHERE c.id = @did',
          parameters: [{ name: '@did', value: deviceId }],
          partitionKey: deviceId,
        }),
        // Fetch the win/loss/draw counters from the player's
        // `tttPairs` partition. One row per opponent; counters are
        // summed in JS for `hasPlayedTtt` (any row exists),
        // `hasWonTtt` (Σ wins ≥ 1), `hasLostTtt` (Σ losses ≥ 1).
        // Single-partition query; result size is O(distinct
        // opponents) — small.
        queryDocs({
          connString: conn,
          dbName: DB_NAME,
          containerName: TTT_PAIRS_CONTAINER,
          query: 'SELECT c.m3x3, c.m9x9 FROM c',
          parameters: [],
          partitionKey: deviceId,
        }),
      ]);
      if (profileRes.ok && profileRes.docs.length > 0) profileDoc = profileRes.docs[0];
      if (tttRes.ok) tttPairs = tttRes.docs;
    } catch (err) {
      context.warn('cosmos engagement reads failed (soft-degraded to no signal)', err);
    }

    // Extract the engagement section from the syncBlob defensively —
    // a profile from before Feature S Phase 2 (or one whose blob got
    // hand-edited) might not have it, in which case engagement signals
    // read as zeros and `coffeeClicked` reads as false. Same shape the
    // pre-Phase-4 path returned when a device had no engagementEvents
    // rows, so the client achievement evaluator sees no change.
    const blob = profileDoc && typeof profileDoc.syncBlob === 'object' ? profileDoc.syncBlob : null;
    const blobEngagement = blob && typeof blob.engagement === 'object' ? blob.engagement : null;

    const engagement = computeEngagement(profileDoc, blobEngagement);
    const ttt = computeTttSignals(tttPairs);

    // 60s quiz streak: derive from the day log on the syncBlob (one
    // entry per Warsaw day the player finished a 60s round, populated
    // by flags/engagementCounters.js#bumpQuiz60sDay). Same streak math
    // as the daily-puzzle streak; the only difference is the axis
    // source (syncBlob day log rather than dailyResults submissions).
    // Today is supplied so currentStreak resets to 0 if the most
    // recent play is older than today.
    const quiz60sLog = blobEngagement && Array.isArray(blobEngagement.quiz60sDayLog)
      ? blobEngagement.quiz60sDayLog
      : [];
    const quiz60sStreakRows = dayLogToStreakRows(quiz60sLog);
    const quiz60sStreak = computeStreak({ rows: quiz60sStreakRows, latestId: today ?? undefined });
    const quiz60sStreakSnapshot = {
      quiz60sCurrentStreak: quiz60sStreak.currentStreak,
      quiz60sMaxStreak: quiz60sStreak.maxStreak,
      quiz60sDistinctDays: quiz60sStreak.totalPlayed,
    };

    const result = { ...streak, ...mastery, ...quiz, ...engagement, ...quiz60sStreakSnapshot, ...ttt };
    cache.set(deviceId, result, now);
    return {
      status: 200,
      headers: statsCacheHeaders({ fresh, ttlMs: CACHE_TTL_MS }),
      jsonBody: result,
    };
  },
});
