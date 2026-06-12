/**
 * Pure builder + merge logic for the Cosmos document we keep in the
 * `dailyLeaderboards` container — one row per (device, configKey, day)
 * holding the player's today-PB for that quiz config.
 *
 * Document shape (Feature K):
 *   {
 *     id:          string,    // == deviceId — unique within the partition
 *     pk:          string,    // == "<configKey>|<YYYY-MM-DD>" — the composite
 *                             //   partition key. Picked this shape so the
 *                             //   "today" filter is the partition itself —
 *                             //   no WHERE clause on date, every leaderboard
 *                             //   query is single-partition and trivially
 *                             //   cheap. Combined with DefaultTtl=172_800
 *                             //   (48h) on the container, yesterday's rows
 *                             //   auto-purge and storage stays bounded.
 *     deviceId:    string,
 *     configKey:   string,
 *     date:        string,    // "YYYY-MM-DD" UTC — duplicated from pk for read-side ergonomics
 *     nickname:    string|null, // snapshotted at write time from `profiles`. See note below.
 *     score:       number,    // best score this device has posted today for this configKey
 *     durationMs:  number,    // duration tiebreak — same semantics as quizRecordDoc
 *     submittedAt: number,    // unix ms — when today's best was set
 *     v:           1,         // schema version (per infra/operations.md migration policy)
 *   }
 *
 * Why denormalize the nickname instead of joining at read time:
 *   The leaderboard GET is a single-partition query — adding a fanout to
 *   `profiles` for N rows would defeat the cheap-partition design. The
 *   trade-off (a nickname change after submitting today doesn't update
 *   today's row) is acceptable for an ephemeral surface that resets nightly.
 *
 * Why the today-PB check reuses `quizRecordDoc.isPersonalBest`:
 *   Same comparator semantics (higher-or-lower wins, tiebreak on faster
 *   duration). Keeps "what counts as a better score" in one place; if the
 *   tiebreak rule ever changes, both surfaces flip together.
 */

const { isPersonalBest } = require('./quizRecordDoc');

/**
 * UTC date key for "today" relative to `now` (unix ms). Format YYYY-MM-DD.
 * Server-side cutoff so every player sees the same leaderboard regardless
 * of their local clock.
 *
 * @param {number} now
 * @returns {string}
 */
function todayDateKey(now) {
  return new Date(now).toISOString().slice(0, 10);
}

/**
 * Compose the partition key from (configKey, dateKey). Caller is
 * responsible for handing in a valid configKey — the server-side gate
 * lives in `validate.js`.
 *
 * @param {string} configKey
 * @param {string} dateKey
 * @returns {string}
 */
function makePk(configKey, dateKey) {
  return `${configKey}|${dateKey}`;
}

/**
 * Build a fresh leaderboard doc. Used by `mergeDailyLeaderboard` when the
 * candidate finish replaces the incumbent, and directly when the device
 * has no row for today yet.
 *
 * @param {{
 *   deviceId: string,
 *   configKey: string,
 *   dateKey: string,
 *   nickname: string|null,
 *   entry: { score: number, durationMs: number },
 *   now: number,
 * }} input
 */
function buildDailyLeaderboardDoc({ deviceId, configKey, dateKey, nickname, entry, now }) {
  return {
    id: deviceId,
    pk: makePk(configKey, dateKey),
    deviceId,
    configKey,
    date: dateKey,
    nickname: typeof nickname === 'string' ? nickname : null,
    score: entry.score,
    durationMs: entry.durationMs,
    submittedAt: now,
    v: 1,
  };
}

/**
 * Decide whether the candidate finish should replace this device's row in
 * today's leaderboard for `configKey`. Returns either
 *   { changed: true, doc }   — caller upserts `doc` into dailyLeaderboards
 *   { changed: false }       — caller skips the write; today's row stands
 *
 * Pre-condition: `existing` is the leaderboard row for *this* (device,
 * configKey, today) — the caller addressed the partition by composite pk
 * + id, so any returned row is already scoped to today.
 *
 * @param {{
 *   existing: { score: number, durationMs: number } | null,
 *   deviceId: string,
 *   configKey: string,
 *   dateKey: string,
 *   nickname: string|null,
 *   entry: { score: number, durationMs: number },
 *   lowerWins: boolean,
 *   now: number,
 * }} args
 */
function mergeDailyLeaderboard({ existing, deviceId, configKey, dateKey, nickname, entry, lowerWins, now }) {
  const incumbent = existing
    ? { score: existing.score, durationMs: existing.durationMs }
    : null;
  if (!isPersonalBest(incumbent, entry, lowerWins)) {
    return { changed: false };
  }
  return {
    changed: true,
    doc: buildDailyLeaderboardDoc({ deviceId, configKey, dateKey, nickname, entry, now }),
  };
}

module.exports = {
  todayDateKey,
  makePk,
  buildDailyLeaderboardDoc,
  mergeDailyLeaderboard,
};
