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

/**
 * Whether a finish with `score` should appear on the leaderboard at all.
 * In higher-wins (timed/60s) mode, `score === 0` means the player didn't
 * get a single flag right in 60s — worst-possible result, and the most
 * common griefing/garbage-bottom case. We exclude it so the leaderboard
 * reads as "this is how the players who actually played did."
 *
 * In lower-wins (endurance/count) mode, `score === 0` means zero
 * mistakes — a perfect round, the IDEAL result. Absolutely belongs on
 * the board.
 *
 * Apply this gate in two places: the leaderboard SQL filter (top + rank
 * queries) so excluded rows don't appear in the top-10 or inflate the
 * "ahead of me" count, AND when deciding whether to populate `you` for
 * the caller — a timed-mode-zero caller doesn't get a "…N. You" suffix.
 *
 * @param {{ score: number, lowerWins: boolean }} args
 * @returns {boolean}
 */
function qualifiesForLeaderboard({ score, lowerWins }) {
  if (lowerWins) return true;
  return score > 0;
}

/**
 * Does row `a` strictly beat row `b` under the same comparator the SQL
 * ORDER BY uses? Tie-break by `durationMs ASC` in both modes (faster
 * round wins on equal score). Used by the cross-partition merge step
 * to keep each device's better entry across today + yesterday.
 *
 * @param {{ score: number, durationMs: number }} a
 * @param {{ score: number, durationMs: number }} b
 * @param {boolean} lowerWins
 * @returns {boolean}
 */
function beats(a, b, lowerWins) {
  if (lowerWins) {
    if (a.score < b.score) return true;
    if (a.score > b.score) return false;
  } else {
    if (a.score > b.score) return true;
    if (a.score < b.score) return false;
  }
  return a.durationMs < b.durationMs;
}

/**
 * Comparator suitable for `Array.prototype.sort`. Negative when `a`
 * should come first, positive when `b` should.
 *
 * @param {{ score: number, durationMs: number }} a
 * @param {{ score: number, durationMs: number }} b
 * @param {boolean} lowerWins
 * @returns {number}
 */
function cmpEntries(a, b, lowerWins) {
  if (beats(a, b, lowerWins)) return -1;
  if (beats(b, a, lowerWins)) return 1;
  return 0;
}

/**
 * Collapse entries to one row per `deviceId`, keeping the better
 * one per `beats(…, lowerWins)`. Insertion order of the original
 * Map preserves the better row's relative position; callers sort
 * afterwards.
 *
 * @template {{ deviceId: string, score: number, durationMs: number }} T
 * @param {T[]} entries
 * @param {boolean} lowerWins
 * @returns {T[]}
 */
function dedupByDevice(entries, lowerWins) {
  /** @type {Map<string, T>} */
  const byDevice = new Map();
  for (const row of entries) {
    const existing = byDevice.get(row.deviceId);
    if (!existing || beats(row, existing, lowerWins)) {
      byDevice.set(row.deviceId, row);
    }
  }
  return [...byDevice.values()];
}

/**
 * 1-based rank of `deviceId` in a sorted array, or `null` when the
 * caller isn't in the slice we fetched. The handler uses this to fill
 * `you.rank` without a separate COUNT query — the merged + sorted
 * list already encodes the rank as the array index.
 *
 * @param {Array<{ deviceId: string }>} sorted
 * @param {string} deviceId
 * @returns {number | null}
 */
function rankInSorted(sorted, deviceId) {
  const idx = sorted.findIndex((r) => r.deviceId === deviceId);
  return idx === -1 ? null : idx + 1;
}

module.exports = {
  rankCmpClause,
  findMineInTop,
  computeYou,
  qualifiesForLeaderboard,
  beats,
  cmpEntries,
  dedupByDevice,
  rankInSorted,
};
