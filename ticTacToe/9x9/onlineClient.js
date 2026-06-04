/** @typedef {import('../../flags/ultimateTicTacToe.js').UltimateGameState} UltimateGameState */
/** @typedef {import('../../flags/ticTacToe.js').Player} Player */

import { t } from '../../i18n.js';

// Generic identity / lobby helpers are domain-agnostic — re-export from the
// 3×3 client so the 9×9 lobby uses the same room-code alphabet, validation,
// player-id persistence, and server URL routing (just with party='ultimate').
export {
  ROOM_ALPHABET,
  ROOM_LEN,
  generateCode,
  isValidRoomCode,
  serverUrlFor,
  getOrCreatePlayerId,
} from '../onlineClient.js';

/**
 * @typedef {Object} UltimateClientState
 * @property {UltimateGameState | null} game
 * @property {Player | null} myRole
 * @property {boolean} peerPresent
 * @property {string | null} statusOverride
 */

/** @returns {UltimateClientState} */
export function initialUltimateClientState() {
  return { game: null, myRole: null, peerPresent: false, statusOverride: null };
}

/**
 * @param {UltimateClientState} state
 * @returns {boolean}
 */
export function canGiveUpUltimateOnline(state) {
  const { game, myRole, peerPresent } = state;
  if (!myRole || !peerPresent || !game) return false;
  if (game.winner || game.draw || game.gaveUp) return false;
  return true;
}

/**
 * @typedef {{ type: 'shake', bigRow: number, bigCol: number, smallRow: number, smallCol: number }
 *   | { type: 'finished' }
 *   | { type: 'gave-up', byMe: boolean }
 *   | { type: 'close' }
 *   | { type: 'rematch-started' }
 * } UltimateEffect
 */

/** @type {Record<string, { key: string, fallback: string }>} */
const REJECT_MESSAGES = {
  'room-full': { key: 'ttt.reject.roomFull', fallback: 'Room is full' },
  'room-not-found': { key: 'ttt.reject.roomNotFound', fallback: 'Room not found — ask your friend for the code or create a new room' },
  'code-collision': { key: 'ttt.reject.codeCollision', fallback: 'That code is already taken — try creating a new one' },
  'missing-player-id': { key: 'ttt.reject.missingPlayerId', fallback: 'Connection error — please reload the page' },
};

/**
 * Pure reducer over server-sent messages for the 9×9 wire protocol. Mirrors
 * reduceServerMessage in ../onlineClient.js but the shake effect carries the
 * full 4-tuple (bigRow, bigCol, smallRow, smallCol) instead of just (row, col).
 *
 * @param {UltimateClientState} state
 * @param {any} message
 * @returns {{ state: UltimateClientState, effects: UltimateEffect[] }}
 */
export function reduceUltimateServerMessage(state, message) {
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
      /** @type {UltimateEffect[]} */
      const effects = [];
      if (message.kind === 'miss-invalid' || message.kind === 'miss-duplicate') {
        effects.push({
          type: 'shake',
          bigRow: message.bigRow,
          bigCol: message.bigCol,
          smallRow: message.smallRow,
          smallCol: message.smallCol,
        });
      }
      if (message.kind === 'rematch') {
        effects.push({ type: 'rematch-started' });
      }
      if (message.kind === 'give-up') {
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
