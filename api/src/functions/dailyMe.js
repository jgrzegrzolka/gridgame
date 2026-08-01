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

// Sovereign pool sizes per quiz variant. Source of truth for the
// "Cleared <variant>" achievements — a 60s PB that meets or exceeds the
// variant's pool size counts as a clear. The numbers must match what
// `poolFor(key, countries)` produces against `flags/countries.json`; the
// drift detector `flags/countries.test.js` pins them so a country added or
// removed without updating this map fails CI loudly.
//
// **`weird` is deliberately absent and must stay absent.** Two reasons; the
// second is the durable one:
//   1. A variant with no entry here can never clear (see quizCompute), which
//      keeps the 54-flag territory deck from satisfying released continent
//      badges that claim "you know the countries of <continent>".
//   2. Its pool GROWS. The sovereign count is politically stable (195 for
//      years), but the non-sovereign pool is a curation decision that gains
//      entries whenever flag data lands (gb-eng, gb-sct, es-ct, sh-ac all
//      arrived in #724). A "cleared" threshold anchored to a moving number is
//      broken by construction: clear it at 54, silently un-clear at 56, and
//      every data addition forces a threshold bump that retroactively changes
//      what an already-earned badge claims.
// Personal bests on `weird` are kept and are fine — "your best is 22" doesn't
// depend on pool size. It's threshold-and-count stats that can't be.
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
    // ---- one wave, four reads ----
    //
    // All four reads below depend only on `deviceId`; not one of them consumes
    // another's result. They used to run in THREE sequential awaits (dailies,
    // then quiz, then profile+ttt in parallel), so the handler paid three
    // round trips of Cosmos latency end to end. That made `dailyMe` the site's
    // slowest meaningful endpoint (p50 ~1.7s, p95 ~3.5s against 200-700ms for
    // everything else) while also being its most-called one — roughly one call
    // per two page views — and it showed: 12 requests in a week returned 499,
    // the client having given up and closed the connection mid-answer.
    //
    // Issuing them together makes the wait the slowest single read instead of
    // the sum. The cost is that a request which is going to 500 on the dailies
    // read now also spends the RU for three reads it will throw away; at this
    // traffic that is noise, and the failure path is rare by construction.
    //
    // `allSettled`, not `all`: three of the four are SOFT dependencies that
    // must degrade rather than fail the snapshot, and `all` would reject the
    // whole wave on the first soft failure.
    const [dailiesSettled, quizSettled, profileSettled, tttSettled] = await Promise.allSettled([
      queryDocs({
        connString: conn,
        dbName: DB_NAME,
        containerName: CONTAINER_NAME,
        query: 'SELECT c.submittedAt, c.foundCodes, c.wrongCodes, c.totalCount FROM c WHERE c.deviceId = @did',
        parameters: [{ name: '@did', value: deviceId }],
        enableCrossPartition: true,
      }),
      // Quiz aggregates: single-partition query against the player's
      // `quizRecords` doc (id == pk == deviceId). At most one row; returns
      // empty quiz counters if the player has never finished a round.
      queryDocs({
        connString: conn,
        dbName: DB_NAME,
        containerName: QUIZ_RECORDS_CONTAINER,
        query: 'SELECT * FROM c WHERE c.id = @did',
        parameters: [{ name: '@did', value: deviceId }],
        partitionKey: deviceId,
      }),
      // Cross-game engagement signals: profile point-read. Pre-Phase-4 this
      // also did a cross-partition scan of `engagementEvents`; Feature S
      // Phase 4 moved that data into `profile.syncBlob.engagement` so a single
      // point-read covers nickname, linkedAt and the engagement counters.
      queryDocs({
        connString: conn,
        dbName: DB_NAME,
        containerName: PROFILES_CONTAINER,
        query: 'SELECT c.nickname, c.linkedAt, c.syncBlob FROM c WHERE c.id = @did',
        parameters: [{ name: '@did', value: deviceId }],
        partitionKey: deviceId,
      }),
      // Win/loss/draw counters from the player's `tttPairs` partition. One row
      // per opponent; counters are summed in JS for `hasPlayedTtt` (any row
      // exists), `hasWonTtt` (Σ wins ≥ 1), `hasLostTtt` (Σ losses ≥ 1).
      // Single-partition query; result size is O(distinct opponents) — small.
      queryDocs({
        connString: conn,
        dbName: DB_NAME,
        containerName: TTT_PAIRS_CONTAINER,
        query: 'SELECT c.m3x3 FROM c',
        parameters: [],
        partitionKey: deviceId,
      }),
    ]);

    // The dailies read is the only HARD dependency: without it there is no
    // streak and no mastery, which is most of what this endpoint is for.
    if (dailiesSettled.status === 'rejected') {
      context.error('cosmos query threw', dailiesSettled.reason);
      return { status: 500, jsonBody: { error: 'server_error' } };
    }
    const queryRes = dailiesSettled.value;
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

    // Soft dependency: a Cosmos blip here degrades to zero quiz counters
    // rather than 500'ing the whole snapshot — the streak and mastery fields
    // are still worth returning.
    let quizDoc = null;
    if (quizSettled.status === 'rejected') {
      context.warn('cosmos quizRecords read failed (soft-degraded to zero quiz counters)', quizSettled.reason);
    } else if (quizSettled.value.ok && quizSettled.value.docs.length > 0) {
      quizDoc = quizSettled.value.docs[0];
    }
    const quiz = computeQuiz(quizDoc, SOV_POOL_SIZES);

    // Also soft, and deliberately still treated as ONE unit: these two were a
    // single `Promise.all`, so either one throwing degraded BOTH to "no
    // signal". Keeping that grouping means this change is a latency change and
    // nothing else — splitting them into independent failures would be a
    // behaviour change smuggled in under a performance fix.
    let profileDoc = null;
    /** @type {Array<{ m3x3?: { wins?: number, losses?: number, draws?: number } }>} */
    let tttPairs = [];
    if (profileSettled.status === 'rejected' || tttSettled.status === 'rejected') {
      context.warn(
        'cosmos engagement reads failed (soft-degraded to no signal)',
        profileSettled.status === 'rejected' ? profileSettled.reason : tttSettled.reason,
      );
    } else {
      if (profileSettled.value.ok && profileSettled.value.docs.length > 0) {
        profileDoc = profileSettled.value.docs[0];
      }
      if (tttSettled.value.ok) tttPairs = tttSettled.value.docs;
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
