/**
 * Pure helpers for deriving the caller's rank in a leaderboard partition.
 * Lifted out of the `quizLeaderboard` handler so the cmp-direction flip
 * and the COUNT-result fallback can be unit-tested without spinning up
 * Cosmos. The handler stays a thin shell that wires these to its queries.
 */

/**
 * Cosmos SQL fragment for "rows that strictly beat the caller". Direction
 * flips on `lowerWins` so an endurance leaderboard (fewer mistakes wins)
 * ranks against `score < @s` and a timed leaderboard ranks against
 * `score > @s`. Ties on (score, durationMs) share the caller's rank.
 *
 * @param {boolean} lowerWins
 * @returns {string}
 */
function rankCmpClause(lowerWins) {
  return lowerWins
    ? '(c.score < @s OR (c.score = @s AND c.durationMs < @d))'
    : '(c.score > @s OR (c.score = @s AND c.durationMs < @d))';
}

/**
 * Look up the caller's row inside an already-fetched top-N. Saves a Cosmos
 * read when the caller is already visible above the cut. Returns null when
 * `deviceId` is missing or the caller isn't on the list.
 *
 * @param {Array<{ deviceId: string, score: number, durationMs: number }>} top
 * @param {string | null} deviceId
 */
function findMineInTop(top, deviceId) {
  if (!deviceId) return null;
  return top.find((r) => r.deviceId === deviceId) || null;
}

/**
 * Build the `you` slice of the response from the count of players ahead
 * and the caller's row. `ahead ?? 0` covers the case where the COUNT
 * query failed silently or returned undefined; rank is `ahead + 1`.
 *
 * @param {{
 *   mine: { score: number, durationMs: number } | null,
 *   ahead: number | null | undefined,
 * }} args
 * @returns {{ rank: number, score: number, durationMs: number } | null}
 */
function computeYou({ mine, ahead }) {
  if (!mine) return null;
  return {
    rank: (ahead ?? 0) + 1,
    score: mine.score,
    durationMs: mine.durationMs,
  };
}

module.exports = { rankCmpClause, findMineInTop, computeYou };
