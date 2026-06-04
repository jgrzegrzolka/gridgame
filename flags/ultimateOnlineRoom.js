import {
  newUltimateGame,
  attemptUltimateClaim,
  isUltimateGameOver,
  applyUltimateGiveUp,
} from './ultimateTicTacToe.js';
import { categoryFromId } from './engine.js';

/** @typedef {import('./ultimateTicTacToe.js').UltimateGameState} UltimateGameState */
/** @typedef {import('./ticTacToe.js').Player} Player */
/** @typedef {import('./group.js').Country} Country */
/** @typedef {import('./engine.js').Puzzle} Puzzle */
/** @typedef {import('./engine.js').Category} Category */

/**
 * 9×9 room state. Mirrors the 3×3 Room shape from onlineRoom.js — same
 * sticky-role semantics, same present-set + lastFirstPlayer accounting —
 * but holds an UltimateGameState instead of the 3×3 GameState.
 *
 * @typedef {Object} UltimateRoom
 * @property {UltimateGameState} game
 * @property {string | null} hostId
 * @property {Map<string, Player>} roles
 * @property {Set<string>} present
 * @property {Player} lastFirstPlayer
 */

/**
 * @typedef {{ to: string | 'all', message: object }} UltimateBroadcast
 */

/**
 * @typedef {Object} UltimateApplyResult
 * @property {UltimateRoom} room
 * @property {UltimateBroadcast[]} broadcasts
 * @property {boolean} [rejectConnection]
 */

/**
 * @param {Puzzle} puzzle
 * @returns {UltimateRoom}
 */
export function createUltimateRoom(puzzle) {
  return {
    game: newUltimateGame(puzzle, 'O'),
    hostId: null,
    roles: new Map(),
    present: new Set(),
    lastFirstPlayer: 'O',
  };
}

/**
 * @param {UltimateRoom} room
 * @param {string} playerId
 * @returns {UltimateApplyResult}
 */
export function applyUltimateHello(room, playerId) {
  const isReconnect = room.roles.has(playerId);

  if (!isReconnect && room.roles.size >= 2) {
    return {
      room,
      broadcasts: [{ to: playerId, message: { type: 'rejected', reason: 'room-full' } }],
      rejectConnection: true,
    };
  }

  const roles = new Map(room.roles);
  const present = new Set(room.present);
  let hostId = room.hostId;

  if (!isReconnect) {
    /** @type {Player} */
    let role;
    if (roles.size === 0) {
      role = 'X';
      hostId = playerId;
    } else {
      role = 'O';
    }
    roles.set(playerId, role);
  }
  present.add(playerId);

  const nextRoom = { ...room, hostId, roles, present };
  /** @type {UltimateBroadcast[]} */
  const broadcasts = [welcomeFor(nextRoom, playerId)];
  for (const id of present) {
    if (id !== playerId) {
      broadcasts.push({ to: id, message: { type: 'peer-joined' } });
    }
  }
  return { room: nextRoom, broadcasts };
}

/**
 * A playerId claims a sub-cell at (bigRow, bigCol, smallRow, smallCol).
 * Silently ignored if the player has no role, the opponent isn't connected,
 * it isn't their turn, the small board is locked, or the game is over.
 *
 * @param {UltimateRoom} room
 * @param {string} playerId
 * @param {number} bigRow
 * @param {number} bigCol
 * @param {number} smallRow
 * @param {number} smallCol
 * @param {Country} country
 * @param {Country[]} countries
 * @returns {UltimateApplyResult}
 */
export function applyUltimateClaim(room, playerId, bigRow, bigCol, smallRow, smallCol, country, countries) {
  const role = room.roles.get(playerId);
  if (!role) return { room, broadcasts: [] };
  if (room.present.size < 2) return { room, broadcasts: [] };
  if (isUltimateGameOver(room.game)) return { room, broadcasts: [] };
  if (room.game.currentPlayer !== role) return { room, broadcasts: [] };

  const outcome = attemptUltimateClaim(room.game, bigRow, bigCol, smallRow, smallCol, country, countries);
  if (outcome.kind === 'miss-taken') {
    return { room, broadcasts: [] };
  }
  const nextRoom = { ...room, game: outcome.nextState };
  return {
    room: nextRoom,
    broadcasts: [{
      to: 'all',
      message: {
        type: 'state',
        game: outcome.nextState,
        kind: outcome.kind,
        bigRow, bigCol, smallRow, smallCol,
      },
    }],
  };
}

/**
 * @param {UltimateRoom} room
 * @param {string} playerId
 * @returns {UltimateApplyResult}
 */
export function applyUltimateDisconnect(room, playerId) {
  if (!room.present.has(playerId)) return { room, broadcasts: [] };
  const present = new Set(room.present);
  present.delete(playerId);
  const nextRoom = { ...room, present };
  /** @type {UltimateBroadcast[]} */
  const broadcasts = [];
  for (const id of present) {
    broadcasts.push({ to: id, message: { type: 'peer-left' } });
  }
  return { room: nextRoom, broadcasts };
}

/**
 * @param {UltimateRoom} room
 * @param {string} playerId
 * @param {Country[]} countries
 * @returns {UltimateApplyResult}
 */
export function applyUltimateRoomGiveUp(room, playerId, countries) {
  const role = room.roles.get(playerId);
  if (!role) return { room, broadcasts: [] };
  if (isUltimateGameOver(room.game)) return { room, broadcasts: [] };
  const nextGame = applyUltimateGiveUp(room.game, countries);
  const nextRoom = { ...room, game: nextGame };
  return {
    room: nextRoom,
    broadcasts: [{ to: 'all', message: { type: 'state', kind: 'give-up', game: nextGame, who: role } }],
  };
}

/**
 * @param {UltimateRoom} room
 * @param {string} playerId
 * @param {Puzzle} newPuzzle
 * @returns {UltimateApplyResult}
 */
export function applyUltimateStartRematch(room, playerId, newPuzzle) {
  if (!room.roles.has(playerId)) return { room, broadcasts: [] };
  if (!isUltimateGameOver(room.game)) return { room, broadcasts: [] };
  /** @type {Player} */
  const nextFirst = room.lastFirstPlayer === 'O' ? 'X' : 'O';
  const newGameState = newUltimateGame(newPuzzle, nextFirst);
  const nextRoom = { ...room, game: newGameState, lastFirstPlayer: nextFirst };
  return {
    room: nextRoom,
    broadcasts: [{ to: 'all', message: { type: 'state', kind: 'rematch', game: newGameState } }],
  };
}

/**
 * @param {UltimateRoom} room
 */
export function serializeUltimateRoom(room) {
  return {
    game: {
      ...room.game,
      puzzle: {
        rows: room.game.puzzle.rows.map(stripCategory),
        cols: room.game.puzzle.cols.map(stripCategory),
      },
    },
    hostId: room.hostId,
    roles: [...room.roles.entries()],
    lastFirstPlayer: room.lastFirstPlayer,
  };
}

/**
 * @param {any} snapshot
 * @returns {UltimateRoom}
 */
export function deserializeUltimateRoom(snapshot) {
  return {
    game: {
      ...snapshot.game,
      puzzle: {
        rows: snapshot.game.puzzle.rows.map(rehydrateCategory),
        cols: snapshot.game.puzzle.cols.map(rehydrateCategory),
      },
    },
    hostId: snapshot.hostId,
    roles: new Map(snapshot.roles),
    present: new Set(),
    lastFirstPlayer: snapshot.lastFirstPlayer ?? 'O',
  };
}

/**
 * @param {Category} c
 * @returns {{ id: string, label: string }}
 */
function stripCategory(c) {
  return { id: c.id, label: c.label };
}

/**
 * @param {{ id: string, label: string }} c
 * @returns {Category}
 */
function rehydrateCategory(c) {
  const rebuilt = categoryFromId(c.id);
  if (rebuilt) return rebuilt;
  return /** @type {Category} */ ({ id: c.id, label: c.label, predicate: () => false });
}

/**
 * @param {UltimateRoom} room
 * @param {string} playerId
 * @returns {UltimateBroadcast}
 */
function welcomeFor(room, playerId) {
  const you = room.roles.get(playerId);
  let peerPresent = false;
  for (const id of room.present) {
    if (id !== playerId) { peerPresent = true; break; }
  }
  return {
    to: playerId,
    message: { type: 'welcome', you, game: room.game, peerPresent },
  };
}
