/** @typedef {import('../flags/ticTacToe.js').GameState} GameState */
/** @typedef {import('../flags/ticTacToe.js').Player} Player */

import { t } from '../i18n.js';

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

const PLAYER_ID_KEY = 'gridgame.player.id';

/**
 * Returns the browser's stable playerId, generating + persisting one on the
 * first call. Used as the identity the server keys roles by, so refreshes
 * keep the same X/O assignment instead of getting shuffled.
 *
 * @param {{ getItem(key: string): string | null, setItem(key: string, value: string): void }} store
 * @param {() => string} [generate]
 * @returns {string}
 */
export function getOrCreatePlayerId(store, generate = defaultGeneratePlayerId) {
  const existing = store.getItem(PLAYER_ID_KEY);
  if (existing) return existing;
  const fresh = generate();
  store.setItem(PLAYER_ID_KEY, fresh);
  return fresh;
}

function defaultGeneratePlayerId() {
  if (typeof globalThis.crypto !== 'undefined' && typeof globalThis.crypto.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  // Very-old-browser fallback: timestamp + random tail. Not RFC-4122 but
  // unique enough for room identity.
  return `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Production hostnames that should hit the deployed PartyKit. */
const PROD_HOSTNAMES = new Set([
  'jgrzegrzolka.github.io',
  'yetanotherquiz.com',
  'www.yetanotherquiz.com',
]);

/**
 * Which WebSocket URL the client should connect to.
 * The deployed site (GitHub Pages or the custom domain) goes to the
 * Cloudflare-hosted PartyKit. Anywhere else (localhost, 127.0.0.1, LAN IPs
 * like 192.168.x.x when you open the dev server from another device)
 * connects to a partykit dev server running on port 1999 on the same host.
 *
 * @param {string} hostname
 * @returns {string}
 */
export function serverUrlFor(hostname) {
  if (PROD_HOSTNAMES.has(hostname)) {
    return 'wss://gridgame-ttt.jgrzegrzolka.partykit.dev/parties/main/';
  }
  return `ws://${hostname}:1999/parties/main/`;
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
      return { state: { ...state, peerPresent: true }, effects: [] };
    }
    case 'peer-left': {
      return { state: { ...state, peerPresent: false }, effects: [] };
    }
    case 'rejected': {
      const mapped = REJECT_MESSAGES[message.reason];
      const reason = mapped
        ? t(mapped.key, mapped.fallback)
        : t('ttt.reject.fallback', 'Rejected: {reason}').replace('{reason}', message.reason);
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
