import { newGame, attemptClaim, isGameOver } from './ticTacToe.js';

/** @typedef {import('./ticTacToe.js').GameState} GameState */
/** @typedef {import('./ticTacToe.js').Player} Player */
/** @typedef {import('./group.js').Country} Country */
/** @typedef {import('./grid.js').Puzzle} Puzzle */

/**
 * @typedef {Object} Room
 * @property {GameState} game
 * @property {Map<string, Player>} roles
 */

/**
 * @typedef {{ to: string | 'all', message: object }} Broadcast
 */

/**
 * @typedef {Object} ApplyResult
 * @property {Room} room
 * @property {Broadcast[]} broadcasts
 * @property {boolean} [rejectConnection]
 */

/**
 * @param {Puzzle} puzzle
 * @returns {Room}
 */
export function createRoom(puzzle) {
  return { game: newGame(puzzle, 'O'), roles: new Map() };
}

/**
 * Connection joins the room. First connection gets X or O at random; second gets the other.
 * Idempotent: a known connId just receives a fresh welcome.
 * If the room already has two players (and this is a stranger), the connection is rejected.
 *
 * @param {Room} room
 * @param {string} connId
 * @param {() => number} [rng]
 * @returns {ApplyResult}
 */
export function applyHello(room, connId, rng = Math.random) {
  if (room.roles.has(connId)) {
    return { room, broadcasts: [welcomeFor(room, connId)] };
  }
  if (room.roles.size >= 2) {
    return {
      room,
      broadcasts: [{ to: connId, message: { type: 'rejected', reason: 'room-full' } }],
      rejectConnection: true,
    };
  }
  const roles = new Map(room.roles);
  /** @type {Player} */
  let role;
  if (roles.size === 0) {
    role = rng() < 0.5 ? 'X' : 'O';
  } else {
    const taken = /** @type {Player} */ (roles.values().next().value);
    role = taken === 'X' ? 'O' : 'X';
  }
  roles.set(connId, role);
  const nextRoom = { ...room, roles };
  /** @type {Broadcast[]} */
  const broadcasts = [welcomeFor(nextRoom, connId)];
  if (roles.size === 2) {
    // Notify the other player that their opponent has arrived.
    for (const [id] of roles) {
      if (id !== connId) broadcasts.push({ to: id, message: { type: 'peer-joined' } });
    }
  }
  return { room: nextRoom, broadcasts };
}

/**
 * Connection sends a claim. Silently ignored if connection has no role or it isn't their turn.
 *
 * @param {Room} room
 * @param {string} connId
 * @param {number} row
 * @param {number} col
 * @param {Country} country
 * @returns {ApplyResult}
 */
export function applyClaim(room, connId, row, col, country) {
  const role = room.roles.get(connId);
  if (!role) return { room, broadcasts: [] };
  if (room.roles.size < 2) return { room, broadcasts: [] };
  if (isGameOver(room.game)) return { room, broadcasts: [] };
  if (room.game.currentPlayer !== role) return { room, broadcasts: [] };

  const outcome = attemptClaim(room.game, row, col, country);
  if (outcome.kind === 'miss-taken') {
    return { room, broadcasts: [] };
  }
  const nextRoom = { ...room, game: outcome.nextState };
  return {
    room: nextRoom,
    broadcasts: [{ to: 'all', message: { type: 'state', game: outcome.nextState, kind: outcome.kind, row, col } }],
  };
}

/**
 * Connection drops. Remove their role and notify the remaining player (if any).
 *
 * @param {Room} room
 * @param {string} connId
 * @returns {ApplyResult}
 */
export function applyDisconnect(room, connId) {
  if (!room.roles.has(connId)) return { room, broadcasts: [] };
  const roles = new Map(room.roles);
  roles.delete(connId);
  return {
    room: { ...room, roles },
    broadcasts: [{ to: 'all', message: { type: 'peer-left' } }],
  };
}

/**
 * @param {Room} room
 * @param {string} connId
 * @returns {Broadcast}
 */
function welcomeFor(room, connId) {
  const you = room.roles.get(connId);
  const peerPresent = room.roles.size === 2;
  return {
    to: connId,
    message: { type: 'welcome', you, game: room.game, peerPresent },
  };
}
