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
 * 4 partitions for a 72h window.
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
 * `nicknameAuto` denormalises the same flag from the writer's `profiles` row
 * (Feature S Phase 1a) onto each leaderboard entry — same denormalisation
 * pattern `nickname` already uses, for the same reason: the reader doesn't
 * have to join back to the profiles container at render time. The
 * leaderboard renderer paints a small "auto-generated name" hint next to
 * entries where this is true.
 *
 * When the caller omits it, we fall back to the same nickname-derived rule
 * `profileDoc.buildProfileDoc` uses — null/empty nickname = auto, real
 * string = customised. Keeps the merge consistent for legacy callers that
 * haven't been updated yet, and means a future read of this doc has the
 * same `nicknameAuto` semantics as a fresh profile write would have
 * produced.
 *
 * @param {{
 *   deviceId: string,
 *   configKey: string,
 *   dateKey: string,
 *   nickname: string|null,
 *   nicknameAuto?: boolean,
 *   entry: { score: number, durationMs: number },
 *   now: number,
 * }} input
 */
function buildDailyLeaderboardDoc({ deviceId, configKey, dateKey, nickname, nicknameAuto, entry, now }) {
  const cleanNickname = typeof nickname === 'string' ? nickname : null;
  const resolvedAuto = typeof nicknameAuto === 'boolean'
    ? nicknameAuto
    : (cleanNickname === null || cleanNickname.length === 0);
  return {
    id: deviceId,
    pk: makePk(configKey, dateKey),
    deviceId,
    configKey,
    date: dateKey,
    nickname: cleanNickname,
    nicknameAuto: resolvedAuto,
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
 *   nicknameAuto?: boolean,
 *   entry: { score: number, durationMs: number },
 *   lowerWins: boolean,
 *   now: number,
 * }} args
 */
function mergeDailyLeaderboard({ existing, deviceId, configKey, dateKey, nickname, nicknameAuto, entry, lowerWins, now }) {
  const incumbent = existing
    ? { score: existing.score, durationMs: existing.durationMs }
    : null;
  if (!isPersonalBest(incumbent, entry, lowerWins)) {
    return { changed: false };
  }
  return {
    changed: true,
    doc: buildDailyLeaderboardDoc({ deviceId, configKey, dateKey, nickname, nicknameAuto, entry, now }),
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
