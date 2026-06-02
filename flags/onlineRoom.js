import { newGame, attemptClaim, isGameOver } from './ticTacToe.js';
import { categoryFromId } from './grid.js';

/** @typedef {import('./ticTacToe.js').GameState} GameState */
/** @typedef {import('./ticTacToe.js').Player} Player */
/** @typedef {import('./group.js').Country} Country */
/** @typedef {import('./grid.js').Puzzle} Puzzle */
/** @typedef {import('./grid.js').Category} Category */

/**
 * Room state. `roles` is sticky (a playerId keeps its role across refreshes
 * and even after a Durable Object eviction, since the room is persisted to
 * party storage). `present` only tracks who currently has a live WebSocket —
 * it is reset to empty on every DO load and is what drives the "peer-joined"
 * / "peer-left" notifications.
 *
 * @typedef {Object} Room
 * @property {GameState} game
 * @property {string | null} hostId  - playerId of the room creator; always X
 * @property {Map<string, Player>} roles  - playerId -> X/O assignment
 * @property {Set<string>} present  - playerIds currently connected
 * @property {Player} lastFirstPlayer  - who started the current game; the
 *   rematch flips this so games alternate which side moves first
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
  return {
    game: newGame(puzzle, 'O'),
    hostId: null,
    roles: new Map(),
    present: new Set(),
    lastFirstPlayer: 'O',
  };
}

/**
 * A playerId connects (or reconnects) to the room.
 *
 * Rules:
 *   - Empty room: this player becomes the host and is assigned X.
 *   - Room with one player: this player joins as O.
 *   - Returning playerId already in roles: idempotent, just re-send welcome
 *     and mark them present again (no role change, no role re-shuffle).
 *   - Room with two distinct playerIds and a third stranger arrives: reject
 *     with 'room-full'.
 *
 * @param {Room} room
 * @param {string} playerId
 * @returns {ApplyResult}
 */
export function applyHello(room, playerId) {
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
  /** @type {Broadcast[]} */
  const broadcasts = [welcomeFor(nextRoom, playerId)];
  // Tell the OTHER present player(s) that the peer is here. We notify on
  // every fresh connect AND reconnect, since the other side cares about
  // "peer's socket is live" — they don't know it's a refresh.
  for (const id of present) {
    if (id !== playerId) {
      broadcasts.push({ to: id, message: { type: 'peer-joined' } });
    }
  }
  return { room: nextRoom, broadcasts };
}

/**
 * A playerId claims a cell. Silently ignored if the player has no role,
 * the opponent isn't connected, it isn't their turn, or the game is over.
 *
 * @param {Room} room
 * @param {string} playerId
 * @param {number} row
 * @param {number} col
 * @param {Country} country
 * @returns {ApplyResult}
 */
export function applyClaim(room, playerId, row, col, country) {
  const role = room.roles.get(playerId);
  if (!role) return { room, broadcasts: [] };
  if (room.present.size < 2) return { room, broadcasts: [] };
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
 * A playerId's WebSocket drops. Roles stay sticky (so the player can
 * reconnect with the same role), but they're removed from `present` and
 * the remaining player(s) get a peer-left notification.
 *
 * @param {Room} room
 * @param {string} playerId
 * @returns {ApplyResult}
 */
export function applyDisconnect(room, playerId) {
  if (!room.present.has(playerId)) return { room, broadcasts: [] };
  const present = new Set(room.present);
  present.delete(playerId);
  const nextRoom = { ...room, present };
  /** @type {Broadcast[]} */
  const broadcasts = [];
  for (const id of present) {
    broadcasts.push({ to: id, message: { type: 'peer-left' } });
  }
  return { room: nextRoom, broadcasts };
}

/**
 * Start a fresh game in the same room with the same players. Triggered when
 * either player clicks "Play again" after the current game finishes.
 *
 *   - Silently ignored if the sender isn't a player in the room.
 *   - Silently ignored while the current game is still in progress (you
 *     can't restart mid-match by accident).
 *   - The first-mover alternates between games. If O started the game that
 *     just ended, X starts the rematch.
 *   - Roles (host=X, joiner=O) are preserved across rematches.
 *
 * @param {Room} room
 * @param {string} playerId
 * @param {Puzzle} newPuzzle
 * @returns {ApplyResult}
 */
export function applyStartRematch(room, playerId, newPuzzle) {
  if (!room.roles.has(playerId)) return { room, broadcasts: [] };
  if (!isGameOver(room.game)) return { room, broadcasts: [] };
  /** @type {Player} */
  const nextFirst = room.lastFirstPlayer === 'O' ? 'X' : 'O';
  const newGameState = newGame(newPuzzle, nextFirst);
  const nextRoom = { ...room, game: newGameState, lastFirstPlayer: nextFirst };
  return {
    room: nextRoom,
    broadcasts: [{ to: 'all', message: { type: 'state', kind: 'rematch', game: newGameState } }],
  };
}

/**
 * Structured-clone-safe snapshot of the room for persistence.
 *
 *   - `present` is omitted: it represents live WebSocket connections, which
 *     are gone after a Durable Object eviction.
 *   - Puzzle category predicates (`(c) => c.continent === name` etc.) are
 *     stripped because Cloudflare's storage uses structured clone, which
 *     refuses to serialize functions. The predicates are rebuilt on load by
 *     re-running the category factories via `categoryFromId(id)`.
 *
 * @param {Room} room
 */
export function serializeRoom(room) {
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
 * @returns {Room}
 */
export function deserializeRoom(snapshot) {
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
  // Unknown id (shouldn't happen with current factories) — keep the bare
  // shape so the page can at least render the labels, even without
  // working predicates.
  return /** @type {Category} */ ({ id: c.id, label: c.label, predicate: () => false });
}

/**
 * @param {Room} room
 * @param {string} playerId
 * @returns {Broadcast}
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
