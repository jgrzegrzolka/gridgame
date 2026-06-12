const { app } = require('@azure/functions');
const { validateQuizRecord } = require('../lib/validate');
const { insertDoc, queryDocs } = require('../lib/cosmos');
const { createRateLimiter, clientIp } = require('../lib/rateLimit');
const { mergeQuizRecord } = require('../lib/quizRecordDoc');
const {
  todayDateKey,
  makePk,
  mergeDailyLeaderboard,
} = require('../lib/dailyLeaderboardDoc');
const { isLocalRequestUrl } = require('../lib/requestHost');

const DB_NAME = 'yetanotherquiz';
const CONTAINER_NAME = 'quizRecords';
const PROFILES_CONTAINER = 'profiles';
const LEADERBOARD_CONTAINER = 'dailyLeaderboards';

// 10 writes/min/IP is plenty: a 60s round caps at one finish per ~60s,
// the endurance "all" mode runs slower, and a player switching between
// variants/modes still finishes well under 10/min. Tight enough to keep
// runaway scripts from filling the container.
const limiter = createRateLimiter({ limit: 10, windowMs: 60_000 });

app.http('quizRecord', {
  route: 'v1/quiz/record',
  methods: ['POST'],
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

    let body;
    try {
      body = await req.json();
    } catch {
      return { status: 400, jsonBody: { error: 'invalid_json' } };
    }
    const v = validateQuizRecord(body);
    if (!v.ok) return { status: 400, jsonBody: { error: v.error } };

    const conn = process.env.COSMOS_CONN;
    if (!conn) {
      context.error('COSMOS_CONN env var is not set');
      return { status: 500, jsonBody: { error: 'server_error' } };
    }

    // Read the device's existing record doc (one row per device, partitioned
    // by deviceId — so the query is cheap and single-partition).
    let queryRes;
    try {
      queryRes = await queryDocs({
        connString: conn,
        dbName: DB_NAME,
        containerName: CONTAINER_NAME,
        query: 'SELECT * FROM c WHERE c.id = @id',
        parameters: [{ name: '@id', value: body.deviceId }],
        partitionKey: body.deviceId,
      });
    } catch (err) {
      context.error('cosmos query threw', err);
      return { status: 500, jsonBody: { error: 'server_error' } };
    }
    if (!queryRes.ok) {
      context.error('cosmos query failed', queryRes);
      return { status: 500, jsonBody: { error: 'server_error' } };
    }

    const existing = queryRes.docs[0] || null;
    const now = Date.now();

    const merge = mergeQuizRecord({
      existing,
      deviceId: body.deviceId,
      configKey: body.configKey,
      entry: { score: body.score, durationMs: body.durationMs },
      lowerWins: body.lowerWins,
      now,
    });

    // F5 — every finish writes: attempts + lastPlayedAt change on every
    // call, PB-or-not, so the prior "skip on non-PB" short-circuit is
    // gone. The 204 contract for the client is unchanged: it always
    // fires after every round and never has to interpret the response.
    let insertRes;
    try {
      insertRes = await insertDoc({
        connString: conn,
        dbName: DB_NAME,
        containerName: CONTAINER_NAME,
        partitionKey: body.deviceId,
        doc: merge.doc,
        upsert: true,
      });
    } catch (err) {
      context.error('cosmos upsert threw', err);
      return { status: 500, jsonBody: { error: 'server_error' } };
    }

    if (!insertRes.ok) {
      context.error('cosmos upsert failed', insertRes);
      return { status: 500, jsonBody: { error: 'server_error' } };
    }

    // Feature K: best-effort daily-leaderboard write. Only happens when
    // the finish is a today-PB for this (device, configKey), so a player
    // spamming replays writes at most once per day per configKey. Failures
    // here are logged and swallowed — the player's personal record was
    // already saved above, the leaderboard is the extra surface. The
    // `local` flag mirrors the dailyResult convention so dev rows never
    // appear in the public top-10 (the reader filters them out).
    try {
      await writeDailyLeaderboardIfPb({
        conn,
        deviceId: body.deviceId,
        configKey: body.configKey,
        entry: { score: body.score, durationMs: body.durationMs },
        lowerWins: body.lowerWins,
        now,
        local: isLocalRequestUrl(req.url),
      });
    } catch (err) {
      context.warn('daily leaderboard write threw (non-fatal)', err);
    }

    return { status: 204 };
  },
});

/**
 * Side-effect helper: read this device's profile (for nickname denorm)
 * and today's leaderboard row for (configKey, today) in parallel, decide
 * if the finish is a today-PB via `mergeDailyLeaderboard`, and upsert
 * only on PB. All Cosmos failures inside are best-effort: caller swallows
 * any thrown error and the main response stays 204.
 */
async function writeDailyLeaderboardIfPb({ conn, deviceId, configKey, entry, lowerWins, now, local }) {
  const dateKey = todayDateKey(now);
  const pk = makePk(configKey, dateKey);

  // Two cheap point-reads in parallel:
  //  - profile by id+pk (deviceId is both)
  //  - today's leaderboard row by id+pk (id=deviceId, pk=configKey|date)
  const [profileRes, leaderboardRes] = await Promise.all([
    queryDocs({
      connString: conn,
      dbName: DB_NAME,
      containerName: PROFILES_CONTAINER,
      query: 'SELECT c.nickname FROM c WHERE c.id = @id',
      parameters: [{ name: '@id', value: deviceId }],
      partitionKey: deviceId,
    }),
    queryDocs({
      connString: conn,
      dbName: DB_NAME,
      containerName: LEADERBOARD_CONTAINER,
      query: 'SELECT c.score, c.durationMs FROM c WHERE c.id = @id',
      parameters: [{ name: '@id', value: deviceId }],
      partitionKey: pk,
    }),
  ]);

  // If either read failed (e.g. container missing in a dev run), skip the
  // PB-or-not decision entirely — we'd rather drop the leaderboard write
  // than misclassify the row.
  if (!profileRes.ok || !leaderboardRes.ok) return;

  const profile = profileRes.docs[0];
  const nickname = profile && typeof profile.nickname === 'string' ? profile.nickname : null;
  const existing = leaderboardRes.docs[0] || null;

  const merge = mergeDailyLeaderboard({
    existing, deviceId, configKey, dateKey, nickname, entry, lowerWins, now,
  });
  if (!merge.changed) return;

  // Stamp the `local` flag so the read-side aggregator can exclude dev
  // submissions from the public top-10 — same convention as dailyResult.js.
  const doc = local ? { ...merge.doc, local: true } : merge.doc;

  await insertDoc({
    connString: conn,
    dbName: DB_NAME,
    containerName: LEADERBOARD_CONTAINER,
    partitionKey: pk,
    doc,
    upsert: true,
  });
}
