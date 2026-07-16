/** @typedef {import('../flags/ticTacToe.js').GameState} GameState */
/** @typedef {import('../flags/ticTacToe.js').Player} Player */

// Room-lobby primitives (code + validation + server URL) live in the shared
// flags/roomNet.js now that Flag Party consumes them too. Re-exported here so
// this module's existing callers — ticTacToe/page.js — keep
// importing them from './onlineClient.js' unchanged.
export { ROOM_ALPHABET, ROOM_LEN, generateCode, isValidRoomCode, serverUrlFor } from '../flags/roomNet.js';

/**
 * Reject-reason payload: an i18n key + English fallback, plus optional
 * template params for the `{reason}` substitution used by the generic
 * fallback. Stored unresolved so the page can re-translate on a soft
 * language switch instead of carrying a frozen boot-time string.
 *
 * @typedef {{ key: string, fallback: string, params?: Record<string, string> }} StatusOverride
 */

/**
 * @typedef {Object} ClientState
 * @property {GameState | null} game
 * @property {Player | null} myRole
 * @property {boolean} peerPresent
 * @property {string | null} peerId  - opponent's playerId once known. Welcome / peer-joined fill it in. Used by the Feature G head-to-head row that keys writes by both deviceIds.
 * @property {StatusOverride | null} statusOverride  - non-null when the server sent a 'rejected' or the socket died; takes precedence over the derived status. Stored as `{ key, fallback, params? }` so the page can re-translate on a soft language switch.
 */

/** @returns {ClientState} */
export function initialClientState() {
  return { game: null, myRole: null, peerPresent: false, peerId: null, statusOverride: null };
}

/**
 * Whether the local player can currently click "Give up" in the online room.
 * Requires a known role (we're past the lobby), a present opponent (no
 * solo-giveup), and a live game (not won, not drawn, not already conceded).
 *
 * @param {ClientState} state
 * @returns {boolean}
 */
export function canGiveUpOnline(state) {
  const { game, myRole, peerPresent } = state;
  if (!myRole || !peerPresent || !game) return false;
  if (game.winner || game.draw || game.gaveUp) return false;
  return true;
}

/**
 * @typedef {{ type: 'shake', row: number, col: number }
 *   | { type: 'finished' }
 *   | { type: 'gave-up', byMe: boolean }
 *   | { type: 'close' }
 *   | { type: 'rematch-started' }
 * } Effect
 */

/**
 * Reject reasons keyed by the wire-protocol code. Each entry holds the i18n
 * key plus its English fallback — translation happens at use time in the
 * reducer below, because the strings cache may not be loaded yet when this
 * module is imported.
 *
 * @type {Record<string, { key: string, fallback: string }>}
 */
const REJECT_MESSAGES = {
  'room-full': { key: 'ttt.reject.roomFull', fallback: 'Room is full' },
  'room-not-found': { key: 'ttt.reject.roomNotFound', fallback: 'Room not found — ask your friend for the code or create a new room' },
  'code-collision': { key: 'ttt.reject.codeCollision', fallback: 'That code is already taken — try creating a new one' },
  'missing-player-id': { key: 'ttt.reject.missingPlayerId', fallback: 'Connection error — please reload the page' },
};

/**
 * Pure reducer over server-sent messages. State transitions on the left,
 * side effects collected on the right — DOM updates and socket close are
 * left to the caller so this module stays unit-testable.
 *
 * @param {ClientState} state
 * @param {any} message
 * @returns {{ state: ClientState, effects: Effect[] }}
 */
export function reduceServerMessage(state, message) {
  switch (message.type) {
    case 'welcome': {
      /** @type {Effect[]} */
      const effects = [];
      // Refresh-restore: if the server replays an already-finished game
      // via welcome, the page needs `finishRound` to unhide #result and
      // show the action links — same condition the `state` case below
      // checks. Without this, refreshing after give-up / win / draw
      // leaves the user staring at a frozen grid with no links.
      // Also recover `gave-up` so the result line picks the right
      // "You gave up" vs "Opponent gave up" string — the persisted
      // `game.gaveUpBy` tells us who resigned.
      if (message.game && message.game.gaveUp && message.game.gaveUpBy) {
        effects.push({ type: 'gave-up', byMe: message.game.gaveUpBy === message.you });
      }
      if (message.game && (message.game.winner || message.game.draw || message.game.gaveUp)) {
        effects.push({ type: 'finished' });
      }
      return {
        state: {
          ...state,
          myRole: message.you,
          game: message.game,
          peerPresent: message.peerPresent,
          peerId: typeof message.peerId === 'string' ? message.peerId : null,
        },
        effects,
      };
    }
    case 'state': {
      /** @type {Effect[]} */
      const effects = [];
      if (message.kind === 'miss-invalid' || message.kind === 'miss-duplicate') {
        effects.push({ type: 'shake', row: message.row, col: message.col });
      }
      if (message.kind === 'rematch') {
        // The grid headers depend on the puzzle, which changes on rematch,
        // so the page needs to rebuild them. Result UI also needs hiding.
        effects.push({ type: 'rematch-started' });
      }
      if (message.kind === 'give-up') {
        // Surface "who" so the result UI can pick "You gave up" vs
        // "Opponent gave up". Server stamps `who` with the resigner's role.
        effects.push({ type: 'gave-up', byMe: message.who === state.myRole });
      }
      if (message.game && (message.game.winner || message.game.draw || message.game.gaveUp)) {
        effects.push({ type: 'finished' });
      }
      return { state: { ...state, game: message.game }, effects };
    }
    case 'peer-joined': {
      // peerId arrives on the first peer-joined (when the room learns who
      // the second player is) — earlier we only knew our own role. Keep
      // any prior value if the server omitted it (shouldn't happen post-G).
      const peerId = typeof message.peerId === 'string' ? message.peerId : state.peerId;
      return { state: { ...state, peerPresent: true, peerId }, effects: [] };
    }
    case 'peer-left': {
      // peerId is sticky — the opponent's identity doesn't change when
      // their socket drops; only `peerPresent` flips. Keeping `peerId`
      // means a result that lands a moment later still knows who to
      // attribute the head-to-head row to.
      return { state: { ...state, peerPresent: false }, effects: [] };
    }
    case 'rejected': {
      const mapped = REJECT_MESSAGES[message.reason];
      /** @type {StatusOverride} */
      const statusOverride = mapped
        ? { key: mapped.key, fallback: mapped.fallback }
        : { key: 'ttt.reject.fallback', fallback: 'Rejected: {reason}', params: { reason: String(message.reason) } };
      return {
        state: { ...state, statusOverride },
        effects: [{ type: 'close' }],
      };
    }
    default: {
      return { state, effects: [] };
    }
  }
}
