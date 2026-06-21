/**
 * Remember whether this browser session created the TTT room currently
 * carried in `?room=...` on the URL. Used by `ticTacToe/page.js` and
 * `ticTacToe/9x9/page.js` to decide whether the local client should POST
 * the head-to-head result on game finish.
 *
 * Why this isn't just a module-scoped `let isHost = false` (regression
 * caught when Majkel's deviceId was missing from `tttPairs` after a
 * real session): on a full page reload, the URL still carries
 * `?room=XYZ`, the auto-join branch treats it as `intent: 'join'`, and
 * `isHost` reinitialises to `false`. If the original room creator
 * refreshed mid-game (or after the finish but before the POST flushed),
 * neither side POSTed and the pair row was never created. The
 * optimistic local bump still painted the score during the game so the
 * symptom was "score visible during play, gone afterwards".
 *
 * Fix: stash the room code in `sessionStorage` when the user clicks
 * Create. On page load, if the URL room code matches the stored one,
 * the client treats itself as host even though the URL intent reads
 * 'join'. `sessionStorage` is per-tab, so a fresh tab opening the same
 * shared link is correctly a joiner.
 */

const STORAGE_KEY = 'gridgame.ttt.hostRoom';

/**
 * Just the three `Storage` methods this helper actually touches. The
 * page passes in `window.sessionStorage` (full Storage), tests pass in
 * a minimal in-memory stub — both shapes satisfy this typedef.
 *
 * @typedef {{
 *   getItem(key: string): string | null,
 *   setItem(key: string, value: string): void,
 *   removeItem(key: string): void,
 * }} StorageLike
 */

/**
 * @param {StorageLike} storage
 * @param {string} code
 */
export function rememberHostRoom(storage, code) {
  try { storage.setItem(STORAGE_KEY, code); } catch { /* quota / disabled */ }
}

/** @param {StorageLike} storage */
export function forgetHostRoom(storage) {
  try { storage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
}

/**
 * Decide whether this client should treat itself as the room host.
 * The `urlIntent === 'create'` branch covers a fresh Create click;
 * the storage branch covers the post-reload case where the URL says
 * 'join' but this tab previously created the same room code.
 *
 * @param {{
 *   storage: StorageLike,
 *   roomCode: string,
 *   urlIntent: 'create' | 'join',
 * }} args
 * @returns {boolean}
 */
export function decideIsHost({ storage, roomCode, urlIntent }) {
  if (urlIntent === 'create') return true;
  let stored = null;
  try { stored = storage.getItem(STORAGE_KEY); } catch { return false; }
  return stored !== null && stored === roomCode;
}
