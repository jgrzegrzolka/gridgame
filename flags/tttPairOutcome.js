/**
 * Pure helper for "what outcome did this client's player just see in this
 * game?" — used by `ticTacToe/page.js` before it POSTs a head-to-head row
 * update via `flags/tttResultSubmit.js`.
 *
 * Why this is its own module: the previous inline branch chain (`if
 * (game.draw) ... else if (game.winner === myRole) ... else if
 * (game.winner)`) silently fell through on `game.gaveUp` because
 * `applyGiveUp` never sets `winner`. Result: give-up games never ticked
 * the head-to-head record. Caught visually by Jan; pinning the corrected
 * logic in a pure helper + tests so the regression can't sneak back.
 *
 * The resigner's role comes from `game.gaveUpBy`, server-stamped in
 * `flags/onlineRoom.js`'s `applyGiveUp`. A legacy persisted room can carry
 * `gaveUp` with no `gaveUpBy`; that returns null rather than guessing, which
 * matches `onlineClient.js` refusing to attribute an unattributable resign.
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
 * @returns {'win' | 'loss' | 'draw' | null}
 */
export function deriveTttOutcome(game, myRole) {
  if (!game || !myRole) return null;
  if (game.draw) return 'draw';
  if (game.winner === myRole) return 'win';
  if (game.winner) return 'loss';
  if (game.gaveUp && (game.gaveUpBy === 'X' || game.gaveUpBy === 'O')) {
    return game.gaveUpBy === myRole ? 'loss' : 'win';
  }
  return null;
}
