/**
 * Pure helper for "what outcome did this client's player just see in this
 * game?" — used by both `ticTacToe/page.js` (3×3) and
 * `ticTacToe/9x9/page.js` (9×9) before they POST a head-to-head row
 * update via `flags/tttResultSubmit.js`.
 *
 * Why this is its own module:
 *   - The previous inline branch chain (`if (game.draw) ... else if
 *     (game.winner === myRole) ... else if (game.winner)`) silently
 *     fell through on `game.gaveUp` because `applyGiveUp` never sets
 *     `winner`. Result: give-up games never ticked the head-to-head
 *     record. Caught visually by Jan; pinning the corrected logic in a
 *     pure helper + tests so the regression can't sneak back.
 *   - 3×3 and 9×9 disagree on where the resigner role lives. 3×3 has
 *     it on `game.gaveUpBy` (server-stamped in `flags/onlineRoom.js`'s
 *     `applyGiveUp`). 9×9's `UltimateGameState` doesn't carry that
 *     field — its page tracks the resigner via a `lastGaveUpByMe`
 *     local set off the `'gave-up'` effect. The helper accepts both
 *     and prefers the server-stamped value when present.
 *
 * Returns `null` when the game state isn't actually finished (the
 * caller treats null as "nothing to report" — no POST, no optimistic
 * bump).
 *
 * Types are loosened (`string | null | undefined` instead of the
 * strict `'X' | 'O'`) so callers — and tests — can pass plain
 * literals without TS narrowing complaints; the value compare against
 * `myRole` still picks up bad inputs at runtime by returning `null`.
 *
 * @typedef {{
 *   draw?: boolean,
 *   winner?: string | null,
 *   gaveUp?: boolean,
 *   gaveUpBy?: string | null,
 * }} OutcomeGame
 *
 * @param {OutcomeGame} game
 * @param {string | null} myRole
 * @param {boolean | null} [lastGaveUpByMe]
 * @returns {'win' | 'loss' | 'draw' | null}
 */
export function deriveTttOutcome(game, myRole, lastGaveUpByMe = null) {
  if (!game || !myRole) return null;
  if (game.draw) return 'draw';
  if (game.winner === myRole) return 'win';
  if (game.winner) return 'loss';
  if (game.gaveUp) {
    if (game.gaveUpBy === 'X' || game.gaveUpBy === 'O') {
      return game.gaveUpBy === myRole ? 'loss' : 'win';
    }
    if (lastGaveUpByMe !== null) {
      return lastGaveUpByMe ? 'loss' : 'win';
    }
  }
  return null;
}
