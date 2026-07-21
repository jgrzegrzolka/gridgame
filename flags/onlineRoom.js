import { newGame, attemptClaim, isGameOver, applyGiveUp as applyGiveUpEngine, boardIsUntouched } from './ticTacToe.js';
import { categoryFromId } from './engine.js';

/** @typedef {import('./ticTacToe.js').GameState} GameState */
/** @typedef {import('./ticTacToe.js').Player} Player */
/** @typedef {import('./group.js').Country} Country */
/** @typedef {import('./engine.js').Puzzle} Puzzle */
/** @typedef {import('./engine.js').Category} Category */

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
 * @property {boolean} advanced  - also deal world-metric categories. A room
 *   property, not a player one: the server deals one board for two people, so
 *   there is only one answer. The host seeds it at create time from their own
 *   preference and may change it via `applySetAdvanced` while the board is
 *   untouched; the joiner sees it and cannot change it. Persisted, so a
 *   rematch stays in the same mode.
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
 * @param {{ advanced?: boolean }} [options] - `advanced` records which pool
 *   `puzzle` was dealt from. It is the caller's job to keep the two consistent:
 *   this function stores the flag, it does not generate the board.
 * @returns {Room}
 */
export function createRoom(puzzle, options = {}) {
  return {
    game: newGame(puzzle, 'O'),
    hostId: null,
    roles: new Map(),
    present: new Set(),
    lastFirstPlayer: 'O',
    advanced: options.advanced === true,
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
  // "peer's socket is live" — they don't know it's a refresh. The peer's
  // playerId rides along so the receiver can address Cosmos writes to
  // them (head-to-head score row keyed by both deviceIds) without an
  // extra round-trip.
  for (const id of present) {
    if (id !== playerId) {
      broadcasts.push({ to: id, message: { type: 'peer-joined', peerId: playerId } });
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
 * A playerId concedes — fill empty cells with valid revealed countries and
 * freeze the board. Both players see the reveal so the answers are useful
 * to everyone in the room.
 *
 *   - Silently ignored if the sender is not in the room.
 *   - Silently ignored if the current game is already over.
 *   - The `who` field on the broadcast lets each client distinguish "you
 *     gave up" from "your opponent gave up" without an extra round-trip.
 *
 * @param {Room} room
 * @param {string} playerId
 * @param {Country[]} countries
 * @returns {ApplyResult}
 */
export function applyGiveUp(room, playerId, countries) {
  const role = room.roles.get(playerId);
  if (!role) return { room, broadcasts: [] };
  if (isGameOver(room.game)) return { room, broadcasts: [] };
  // Stamp `gaveUpBy: role` onto the game so a refresh-restore (welcome
  // replays the persisted game) can recover who gave up. The engine itself
  // doesn't know about roles — that's a room-layer concern.
  const nextGame = { ...applyGiveUpEngine(room.game, countries), gaveUpBy: role };
  const nextRoom = { ...room, game: nextGame };
  return {
    room: nextRoom,
    broadcasts: [{ to: 'all', message: { type: 'state', kind: 'give-up', game: nextGame, who: role } }],
  };
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
 * The host changes the room's Advanced mode, which re-deals the board.
 *
 * Refuses unless **all** of:
 *   - the sender is the room's host. One board, two players, so somebody has to
 *     own the setting, and the creator is the only one who has it before the
 *     joiner exists.
 *   - the board is untouched. Re-dealing throws away every move on it, and here
 *     those moves are partly the *opponent's* — a settings switch must never
 *     destroy someone else's progress to apply a preference. In practice this
 *     leaves the host a create-to-first-move window, which is mostly the wait
 *     for an opponent to arrive.
 *   - the mode actually changes. A no-op flip re-dealing the board would let a
 *     host reroll a disliked board by toggling twice, which is a different
 *     feature (and one nobody asked for).
 *
 * A refusal returns zero broadcasts, so the caller can leave the room untouched
 * rather than persist and re-send an unchanged state. The client disables the
 * control in exactly these cases; this is the server-side half of that rule,
 * because a disabled input is a UI convenience, not an authority.
 *
 * @param {Room} room
 * @param {string} playerId
 * @param {boolean} advanced
 * @param {Puzzle} newPuzzle - dealt from the pool matching `advanced`
 * @returns {ApplyResult}
 */
export function applySetAdvanced(room, playerId, advanced, newPuzzle) {
  if (room.hostId !== playerId) return { room, broadcasts: [] };
  if (!boardIsUntouched(room.game)) return { room, broadcasts: [] };
  if (room.advanced === advanced) return { room, broadcasts: [] };
  // Keep whoever was due to move first: nothing has happened yet, so this is
  // the same round with a different board, not a new one. `lastFirstPlayer` is
  // the rematch's business.
  const newGameState = newGame(newPuzzle, room.lastFirstPlayer);
  const nextRoom = { ...room, game: newGameState, advanced };
  return {
    room: nextRoom,
    broadcasts: [{ to: 'all', message: { type: 'state', kind: 'advanced-changed', game: newGameState, advanced } }],
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
    advanced: room.advanced,
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
      puzzle: rehydratePuzzle(snapshot.game.puzzle),
    },
    hostId: snapshot.hostId,
    roles: new Map(snapshot.roles),
    present: new Set(),
    lastFirstPlayer: snapshot.lastFirstPlayer ?? 'O',
    // Rooms outlive deploys — a durable object holds one until it is evicted,
    // so the first snapshots this build loads were written by older ones. Read
    // whichever field is there, and answer for the board that room was actually
    // dealt:
    //   - has `advanced`  → this build wrote it, trust it.
    //   - has `easy`      → #931 wrote it. `easy` was the near-opposite flag, so
    //                       easy:true means a flag-pool board (not advanced) and
    //                       easy:false means the full pool (advanced).
    //   - has neither     → pre-#931, when every room was dealt the full pool.
    // Getting this wrong would relabel a live room's chip and, worse, hand its
    // rematch the other pool.
    advanced: snapshot.advanced ?? snapshot.easy !== true,
  };
}

/**
 * Restore a stripped puzzle (categories as `{ id, label }`, predicates dropped
 * by structured-clone / JSON) into one with working `.predicate`s. Used both
 * server-side on snapshot load AND client-side on every received game — the
 * WebSocket serializes the server's live puzzle to JSON, which drops the
 * predicate functions, so a client that renders the board straight off the wire
 * has no way to run `validateCell` (the match sheet's `matchingCountriesForCell`
 * needs it). Re-running the factories via `categoryFromId` is the one decode
 * path, total over the pool.
 *
 * @param {{ rows: any[], cols: any[] }} puzzle
 * @returns {{ rows: Category[], cols: Category[] }}
 */
export function rehydratePuzzle(puzzle) {
  return {
    ...puzzle,
    rows: puzzle.rows.map(rehydrateCategory),
    cols: puzzle.cols.map(rehydrateCategory),
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
  /** @type {string | null} */
  let peerId = null;
  for (const id of room.roles.keys()) {
    if (id !== playerId) {
      peerId = id;
      if (room.present.has(id)) peerPresent = true;
      break;
    }
  }
  return {
    to: playerId,
    message: {
      type: 'welcome',
      you,
      game: room.game,
      peerPresent,
      peerId,
      // Carried explicitly rather than inferred from the puzzle's categories.
      // The predicate that splits the two pools has already been re-cut once
      // (eu-member moved across it in #928), and an inferred badge would have
      // silently re-labelled every live room that day. It also tells the joiner
      // the *host's choice*, which a metric-free full-pool board can imitate but
      // not actually be.
      advanced: room.advanced,
      isHost: room.hostId === playerId,
    },
  };
}
