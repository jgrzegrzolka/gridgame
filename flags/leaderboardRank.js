/**
 * The ordering rule for a quiz leaderboard: score first, finish time as
 * the tiebreak.
 *
 * Mirrors `api/src/lib/leaderboardRank.js#beats`, which is the ORDER BY the
 * server actually ranks with. It is duplicated rather than imported because
 * `api/` is CommonJS and `flags/` is ESM, and we have no build step to
 * bridge them — see the module note in `api/src/lib/`. Duplicated once,
 * here: this file is the client's single copy, so a change to the rule is
 * two edits (here and the server), never five.
 */

/**
 * Does `a` rank above `b`?
 *
 * `lowerWins` flips the score comparison for endurance mode, which stores a
 * wrong-count. The time tiebreak does not flip: a faster finish wins in
 * both modes.
 *
 * @param {{ score: number, durationMs: number }} a
 * @param {{ score: number, durationMs: number }} b
 * @param {boolean} lowerWins
 * @returns {boolean}
 */
export function beats(a, b, lowerWins) {
  if (lowerWins) {
    if (a.score < b.score) return true;
    if (a.score > b.score) return false;
  } else {
    if (a.score > b.score) return true;
    if (a.score < b.score) return false;
  }
  return a.durationMs < b.durationMs;
}
