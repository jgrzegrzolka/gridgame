/**
 * The device's memory of the room it is in, so a player who loses the page can
 * get back without knowing the code.
 *
 * The problem this solves is not reconnecting — that already worked. A room code
 * lives in the URL, the seat is sticky server-side (`flags/partyRoom.js`), and
 * reloading rejoins silently with the score intact. What was missing is the way
 * BACK: close the tab, or tap Home, and the URL is gone, the code with it. The
 * code is not written down anywhere else, so the only recovery was asking
 * another player to read it off their screen.
 *
 * One key, not one per game, because a player is in at most one room at a time.
 * The `game` field says which page the entry belongs to, so each start screen
 * offers only its own room.
 *
 * Pure over an injected `Storage`-like, so it unit-tests without a DOM and so a
 * browser that throws on storage access (private mode with a zero quota, an
 * iframe with third-party cookies blocked) degrades to "no memory" rather than
 * breaking the page.
 */

/** @typedef {{ getItem(k: string): string | null, setItem(k: string, v: string): void, removeItem(k: string): void }} StoreLike */
/** @typedef {'party' | 'ttt'} RoomGame */
/** @typedef {{ game: RoomGame, code: string, at: number }} ActiveRoomEntry */

/** Keeps the `gridgame.*` convention: code and storage keys stay `gridgame`
 *  even though the product is yetanotherquiz (see CLAUDE.md). */
export const ACTIVE_ROOM_KEY = 'gridgame.activeRoom';

/**
 * How long a remembered room stays offerable.
 *
 * Six hours is deliberately generous, because the two ways of being wrong are
 * not symmetric. Offer a room that has since died and the player taps once, the
 * server says it is gone, and the entry is cleared — the cost is one tap. Fail
 * to offer a room that is still live and the player is back to having no way in
 * at all, which is the entire bug. So the window errs long.
 *
 * It is a client-side rule with no server counterpart: rooms are persisted in
 * Durable Object storage and never expire, so without this a month-old abandoned
 * game would still be offered as "you are still playing".
 */
export const ACTIVE_ROOM_MAX_AGE_MS = 6 * 60 * 60 * 1000;

/** @param {StoreLike | null | undefined} store */
function safeGet(store, /** @type {string} */ key) {
  try {
    return store ? store.getItem(key) : null;
  } catch {
    return null;
  }
}

/**
 * Remember the room this device just entered, replacing any previous one.
 *
 * @param {StoreLike | null | undefined} store
 * @param {{ game: RoomGame, code: string, at: number }} entry
 */
export function rememberActiveRoom(store, entry) {
  try {
    if (!store) return;
    store.setItem(ACTIVE_ROOM_KEY, JSON.stringify({ game: entry.game, code: entry.code, at: entry.at }));
  } catch {
    // A device that cannot remember simply never offers a way back. Everything
    // else on the page still works, so this is not worth surfacing.
  }
}

/** @param {StoreLike | null | undefined} store */
export function forgetActiveRoom(store) {
  try {
    if (store) store.removeItem(ACTIVE_ROOM_KEY);
  } catch {
    // As above.
  }
}

/**
 * The room this device should be offered a way back into, or null.
 *
 * Everything about the stored value is re-validated rather than trusted: it is
 * hand-editable, it can be left over from an older build with a different shape,
 * and a malformed entry must read as "no room" instead of putting a broken code
 * in front of the player.
 *
 * @param {StoreLike | null | undefined} store
 * @param {RoomGame} game  only entries for this page's own game are returned
 * @param {number} now
 * @param {(code: string) => boolean} isValidCode  the game's own code validator,
 *   injected so this module stays free of room-code rules
 * @returns {ActiveRoomEntry | null}
 */
export function readActiveRoom(store, game, now, isValidCode) {
  const raw = safeGet(store, ACTIVE_ROOM_KEY);
  if (!raw) return null;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  if (parsed.game !== game) return null;
  if (typeof parsed.code !== 'string' || !isValidCode(parsed.code)) return null;
  if (typeof parsed.at !== 'number' || !Number.isFinite(parsed.at)) return null;
  // A clock that moved backwards (timezone change, a corrected system clock)
  // leaves `at` in the future. Treat that as fresh rather than as expired: the
  // player is far more likely to still be in the room than to have been sent an
  // entry from the future.
  if (now - parsed.at > ACTIVE_ROOM_MAX_AGE_MS) return null;
  return { game, code: parsed.code, at: parsed.at };
}
