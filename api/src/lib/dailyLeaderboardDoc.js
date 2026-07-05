/**
 * Pure builder + merge for the `dailyLeaderboards` Cosmos container.
 * One row per (device, configKey, day); see FEATURE.md Feature K for
 * partition shape (`pk = configKey|date`), TTL, and the denormalised
 * nickname rationale.
 */

const { isPersonalBest } = require('./quizRecordDoc');

/**
 * UTC YYYY-MM-DD for `now` (unix ms). Server-side cutoff so every player
 * sees the same leaderboard regardless of local clock.
 *
 * @param {number} now
 * @returns {string}
 */
function todayDateKey(now) {
  return new Date(now).toISOString().slice(0, 10);
}

/**
 * UTC YYYY-MM-DD for the day before `now`. Thin shim over
 * `dateKeyDaysAgo(now, 1)` for callers that only need yesterday.
 *
 * @param {number} now
 * @returns {string}
 */
function yesterdayDateKey(now) {
  return dateKeyDaysAgo(now, 1);
}

/**
 * UTC YYYY-MM-DD for the day `n` days before `now` (n=0 = today,
 * n=1 = yesterday, etc.). The leaderboard read uses this to fan out
 * across as many partitions as the rolling window spans — currently
 * 8 partitions for a 168h (7-day) window.
 *
 * @param {number} now
 * @param {number} n
 * @returns {string}
 */
function dateKeyDaysAgo(now, n) {
  return new Date(now - n * 86_400_000).toISOString().slice(0, 10);
}

/**
 * @param {string} configKey
 * @param {string} dateKey
 * @returns {string}
 */
function makePk(configKey, dateKey) {
  return `${configKey}|${dateKey}`;
}

/**
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
 * `existing` is the *today* row for this (device, configKey) — the caller
 * addressed the partition by (pk, id), so any returned row is already
 * scoped to today. Returns `{ changed: false }` on no-op so callers can
 * skip the upsert when the incumbent stands.
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
  yesterdayDateKey,
  dateKeyDaysAgo,
  makePk,
  buildDailyLeaderboardDoc,
  mergeDailyLeaderboard,
};
