/** @typedef {import('../../flags/ticTacToe.js').GameState} GameState */
/** @typedef {import('../../flags/ticTacToe.js').Player} Player */

/** Alphabet for room codes — no ambiguous characters (no I/O/L/0/1). */
export const ROOM_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const ROOM_LEN = 5;

const ROOM_CODE_RE = /^[A-Z0-9]{5}$/;

/**
 * @param {() => number} [rng]
 * @returns {string}
 */
export function generateCode(rng = Math.random) {
  let code = '';
  for (let i = 0; i < ROOM_LEN; i++) {
    code += ROOM_ALPHABET[Math.floor(rng() * ROOM_ALPHABET.length)];
  }
  return code;
}

/**
 * Cheap surface check — the server is the real authority on whether a code
 * corresponds to an existing room. This just keeps the lobby UI from sending
 * garbage and gives a friendlier error than waiting for a connection failure.
 *
 * @param {string} code
 * @returns {boolean}
 */
export function isValidRoomCode(code) {
  return ROOM_CODE_RE.test(code);
}

/**
 * Which WebSocket URL the client should connect to.
 * Local hostnames go to the partykit dev server; anywhere else (including
 * the live GitHub Pages domain) goes to the deployed Cloudflare server.
 *
 * @param {string} hostname
 * @returns {string}
 */
export function serverUrlFor(hostname) {
  const isLocal = hostname === 'localhost' || hostname === '127.0.0.1';
  return isLocal
    ? `ws://${hostname}:1999/parties/main/`
    : 'wss://gridgame-ttt.jgrzegrzolka.partykit.dev/parties/main/';
}

/**
 * @typedef {Object} ClientState
 * @property {GameState | null} game
 * @property {Player | null} myRole
 * @property {boolean} peerPresent
 * @property {string | null} statusOverride  - non-null when the server sent a 'rejected' or the socket died; takes precedence over the derived status.
 */

/** @returns {ClientState} */
export function initialClientState() {
  return { game: null, myRole: null, peerPresent: false, statusOverride: null };
}

/**
 * @typedef {{ type: 'shake', row: number, col: number }
 *   | { type: 'finished' }
 *   | { type: 'close' }
 * } Effect
 */

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
      return {
        state: {
          ...state,
          myRole: message.you,
          game: message.game,
          peerPresent: message.peerPresent,
        },
        effects: [],
      };
    }
    case 'state': {
      /** @type {Effect[]} */
      const effects = [];
      if (message.kind === 'miss-invalid' || message.kind === 'miss-duplicate') {
        effects.push({ type: 'shake', row: message.row, col: message.col });
      }
      if (message.game && (message.game.winner || message.game.draw)) {
        effects.push({ type: 'finished' });
      }
      return { state: { ...state, game: message.game }, effects };
    }
    case 'peer-joined': {
      return { state: { ...state, peerPresent: true }, effects: [] };
    }
    case 'peer-left': {
      return { state: { ...state, peerPresent: false }, effects: [] };
    }
    case 'rejected': {
      const reason = message.reason === 'room-full' ? 'Room is full' : 'Rejected: ' + message.reason;
      return {
        state: { ...state, statusOverride: reason },
        effects: [{ type: 'close' }],
      };
    }
    default: {
      return { state, effects: [] };
    }
  }
}
