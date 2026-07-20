const { app } = require('@azure/functions');
const { validateDeviceIdParam } = require('../lib/validate');
const { queryDocs } = require('../lib/cosmos');
const { createRateLimiter, clientIp } = require('../lib/rateLimit');

const DB_NAME = 'yetanotherquiz';

// 10 reads/min/IP. Each call fans out across two containers (cross-
// partition on dailyResults) so we don't want the same IP hammering
// this endpoint. The sync page calls it at most once per visit.
const limiter = createRateLimiter({ limit: 10, windowMs: 60_000 });

/**
 * Hand the requesting browser everything it needs to rebuild its
 * per-device localStorage caches after a link:
 *
 *   - daily: every dailyResult row for this deviceId (puzzleId +
 *     foundCodes + totalCount), to rebuild `daily.scores` so the
 *     archive shows every puzzle ever played by any browser sharing
 *     this deviceId, not just the ones this particular browser
 *     played locally.
 *   - quiz: the records map from quizRecords[deviceId], to rebuild
 *     each `flagquiz.best.<variant>.<mode>[.v2][.all]` localStorage
 *     entry so the quiz picker shows the merged personal-best, not
 *     this browser's pre-link local best.
 *   - nickname: the saved nickname from profiles[deviceId], so the
 *     /profile/ page shows the chosen name on a freshly-linked
 *     browser instead of falling back to the deterministic default
 *     ("Pensive Dolphin"-style adjective+animal pair).
 *   - syncBlob: the client-owned roaming state JSON (achievement
 *     counters, 60s-streak day log, etc.) added in Feature S Phase 2.
 *     Returned as-is — the client knows how to unpack it. Null on
 *     devices that have never written one (matches the legacy
 *     pre-Phase-2 path where the field didn't exist).
 *
 * Read-only; safe to call repeatedly. The "linked" gate (only the
 * source browser ever holds source's local data; the target browser
 * only ever sees post-merge data) is enforced by the rest of the
 * sync flow stamping linkedAt + the client only calling this after
 * identityId is set.
 */
app.http('syncHydrate', {
  route: 'v1/sync/hydrate',
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

    const conn = process.env.COSMOS_CONN;
    if (!conn) {
      context.error('COSMOS_CONN env var is not set');
      return { status: 500, jsonBody: { error: 'server_error' } };
    }

    let dailyRes, quizRes, profileRes;
    try {
      [dailyRes, quizRes, profileRes] = await Promise.all([
        queryDocs({
          connString: conn, dbName: DB_NAME, containerName: 'dailyResults',
          query: 'SELECT c.puzzleId, c.foundCodes, c.wrongCodes, c.totalCount FROM c WHERE c.deviceId = @did',
          parameters: [{ name: '@did', value: deviceId }],
          enableCrossPartition: true,
        }),
        queryDocs({
          connString: conn, dbName: DB_NAME, containerName: 'quizRecords',
          query: 'SELECT c.records FROM c WHERE c.id = @id',
          parameters: [{ name: '@id', value: deviceId }],
          partitionKey: deviceId,
        }),
        queryDocs({
          connString: conn, dbName: DB_NAME, containerName: 'profiles',
          query: 'SELECT c.nickname, c.syncBlob FROM c WHERE c.id = @id',
          parameters: [{ name: '@id', value: deviceId }],
          partitionKey: deviceId,
        }),
      ]);
    } catch (err) {
      context.error('cosmos query threw', err);
      return { status: 500, jsonBody: { error: 'server_error' } };
    }
    if (!dailyRes.ok || !quizRes.ok || !profileRes.ok) {
      context.error('cosmos query failed', dailyRes, quizRes, profileRes);
      return { status: 500, jsonBody: { error: 'server_error' } };
    }

    /** @type {Array<{ puzzleId: number, foundCodes: string[], wrongCodes: string[], totalCount: number }>} */
    const daily = [];
    for (const row of dailyRes.docs) {
      if (typeof row.puzzleId !== 'number') continue;
      const foundCodes = Array.isArray(row.foundCodes)
        ? row.foundCodes.filter((/** @type {unknown} */ x) => typeof x === 'string')
        : [];
      const totalCount = typeof row.totalCount === 'number' ? row.totalCount : foundCodes.length;
      // wrongCodes rides along so a device that receives this row can rebuild
      // the revisit "your wrong guesses" section and the daily heart row,
      // which derives spent hearts from it. Omitting it made a hydrated
      // record look like a flawless run.
      const wrongCodes = Array.isArray(row.wrongCodes)
        ? row.wrongCodes.filter((/** @type {unknown} */ x) => typeof x === 'string')
        : [];
      daily.push({ puzzleId: row.puzzleId, foundCodes, wrongCodes, totalCount });
    }

    const quizRow = quizRes.docs[0];
    const records = (quizRow && typeof quizRow.records === 'object' && quizRow.records) || {};

    const profileRow = profileRes.docs[0];
    const nickname = profileRow && typeof profileRow.nickname === 'string' ? profileRow.nickname : null;
    // Pass syncBlob through as-is when it's a real object; null otherwise.
    // Arrays / primitives get nulled rather than returned — the server's
    // own write endpoint rejects non-object blobs, but a hand-edited row
    // could carry junk and we don't want the renderer choking on it.
    const syncBlob = (
      profileRow
      && profileRow.syncBlob !== null
      && typeof profileRow.syncBlob === 'object'
      && !Array.isArray(profileRow.syncBlob)
    ) ? profileRow.syncBlob : null;

    return {
      status: 200,
      jsonBody: { daily, records, nickname, syncBlob },
    };
  },
});
