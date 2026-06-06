import { test } from 'node:test';
import assert from 'node:assert/strict';
import { continent, hasColor } from './engine.js';
import {
  createRoom,
  applyHello,
  applyClaim,
  applyGiveUp,
  applyDisconnect,
  applyStartRematch,
  serializeRoom,
  deserializeRoom,
} from './onlineRoom.js';
import { createCountry } from './group.js';

/** @typedef {import('./group.js').Country} Country */

/**
 * @param {Partial<Country> & { code: string, name: string }} fields
 * @returns {Country}
 */
function country(fields) {
  return createCountry({
    category: 'country',
    continent: 'Europe',
    statehood: 'un_member',
    ...fields,
  });
}

const PUZZLE = {
  rows: [continent('Europe'), continent('Asia'), continent('Africa')],
  cols: [hasColor('red'), hasColor('blue'), hasColor('green')],
};

const FR = country({ code: '00', name: 'France', continent: 'Europe', primaryColors: ['red'] });
const DE = country({ code: '01', name: 'Germany', continent: 'Europe', primaryColors: ['blue'] });
const IT = country({ code: '02', name: 'Italy', continent: 'Europe', primaryColors: ['green'] });
const JP = country({ code: '10', name: 'Japan', continent: 'Asia', primaryColors: ['red'] });
const KR = country({ code: '11', name: 'Korea', continent: 'Asia', primaryColors: ['blue'] });

// ---- createRoom ----

test('createRoom: starts empty with no host, no roles, no present, O to move', () => {
  const room = createRoom(PUZZLE);
  assert.equal(room.hostId, null);
  assert.equal(room.roles.size, 0);
  assert.equal(room.present.size, 0);
  assert.equal(room.game.currentPlayer, 'O');
  assert.equal(room.game.winner, null);
});

// ---- applyHello ----

test('applyHello: first player becomes host and is assigned X', () => {
  const room = createRoom(PUZZLE);
  const r = applyHello(room, 'alice');
  assert.equal(r.room.hostId, 'alice');
  assert.equal(r.room.roles.get('alice'), 'X');
  assert.equal(r.room.present.has('alice'), true);
  assert.equal(r.broadcasts.length, 1);
  const msg = /** @type {any} */ (r.broadcasts[0].message);
  assert.equal(msg.type, 'welcome');
  assert.equal(msg.you, 'X');
  assert.equal(msg.peerPresent, false);
});

test('applyHello: second player is assigned O and both sides learn the peer arrived', () => {
  let room = createRoom(PUZZLE);
  room = applyHello(room, 'alice').room;
  const r = applyHello(room, 'bob');
  assert.equal(r.room.roles.get('bob'), 'O');
  assert.equal(r.room.hostId, 'alice', 'host does not change');
  assert.equal(r.room.present.size, 2);
  assert.equal(r.broadcasts.length, 2);
  const welcomeBc = r.broadcasts.find((b) => b.to === 'bob');
  const peerJoinedBc = r.broadcasts.find((b) => b.to === 'alice');
  if (!welcomeBc || !peerJoinedBc) throw new Error('expected both broadcasts');
  const welcome = /** @type {any} */ (welcomeBc.message);
  assert.equal(welcome.you, 'O');
  assert.equal(welcome.peerPresent, true);
  const peerJoined = /** @type {any} */ (peerJoinedBc.message);
  assert.equal(peerJoined.type, 'peer-joined');
});

test('applyHello: stranger arrives when room has two distinct players — rejected', () => {
  let room = createRoom(PUZZLE);
  room = applyHello(room, 'alice').room;
  room = applyHello(room, 'bob').room;
  const r = applyHello(room, 'eve');
  assert.equal(r.room.roles.size, 2);
  assert.equal(r.rejectConnection, true);
  assert.equal(r.broadcasts.length, 1);
  const msg = /** @type {any} */ (r.broadcasts[0].message);
  assert.equal(msg.type, 'rejected');
  assert.equal(msg.reason, 'room-full');
});

test('applyHello: known playerId reconnecting keeps the same role (idempotent)', () => {
  let room = createRoom(PUZZLE);
  room = applyHello(room, 'alice').room; // X (host)
  room = applyHello(room, 'bob').room;   // O
  room = applyDisconnect(room, 'alice').room;
  assert.equal(room.present.has('alice'), false);
  const r = applyHello(room, 'alice');
  assert.equal(r.room.roles.get('alice'), 'X', 'role survives a disconnect');
  assert.equal(r.room.present.has('alice'), true, 'marked present again');
  const welcomeBc = r.broadcasts.find((b) => b.to === 'alice');
  if (!welcomeBc) throw new Error('expected welcome');
  const welcome = /** @type {any} */ (welcomeBc.message);
  assert.equal(welcome.you, 'X');
  assert.equal(welcome.peerPresent, true);
});

test('applyHello: reconnect also pings the still-present peer with peer-joined', () => {
  let room = createRoom(PUZZLE);
  room = applyHello(room, 'alice').room;
  room = applyHello(room, 'bob').room;
  room = applyDisconnect(room, 'alice').room;
  const r = applyHello(room, 'alice');
  const peerJoinedBc = r.broadcasts.find((b) => b.to === 'bob');
  if (!peerJoinedBc) throw new Error('expected bob to get peer-joined');
  const msg = /** @type {any} */ (peerJoinedBc.message);
  assert.equal(msg.type, 'peer-joined');
});

test('applyHello: host can refresh repeatedly without losing the X role', () => {
  let room = createRoom(PUZZLE);
  room = applyHello(room, 'alice').room;
  room = applyDisconnect(room, 'alice').room;
  room = applyHello(room, 'alice').room;
  room = applyDisconnect(room, 'alice').room;
  room = applyHello(room, 'alice').room;
  assert.equal(room.roles.get('alice'), 'X');
  assert.equal(room.hostId, 'alice');
});

test('applyHello: when both refresh in opposite order, host is still X', () => {
  let room = createRoom(PUZZLE);
  room = applyHello(room, 'alice').room; // X (host)
  room = applyHello(room, 'bob').room;   // O
  room = applyDisconnect(room, 'alice').room;
  room = applyDisconnect(room, 'bob').room;
  // Bob reconnects first, then Alice.
  room = applyHello(room, 'bob').room;
  room = applyHello(room, 'alice').room;
  assert.equal(room.roles.get('alice'), 'X', 'host keeps X regardless of reconnect order');
  assert.equal(room.roles.get('bob'), 'O');
});

// ---- applyClaim ----

test('applyClaim: silently ignored when playerId has no role', () => {
  const room = createRoom(PUZZLE);
  const r = applyClaim(room, 'stranger', 0, 0, FR);
  assert.equal(r.broadcasts.length, 0);
  assert.equal(r.room, room);
});

test('applyClaim: silently ignored when only one player is present', () => {
  let room = createRoom(PUZZLE);
  room = applyHello(room, 'alice').room; // alice = X, no peer
  // Even though alice has a role, the opponent isn't connected yet.
  // The game starts on O's turn, so alice (X) wouldn't move first anyway,
  // but the deeper rule is "don't accept moves until both sides are present".
  const r = applyClaim(room, 'alice', 0, 0, FR);
  assert.equal(r.broadcasts.length, 0);
  assert.equal(r.room.game.cells[0][0].owner, null);
});

test('applyClaim: silently ignored when the peer is in roles but disconnected', () => {
  let room = createRoom(PUZZLE);
  room = applyHello(room, 'alice').room;
  room = applyHello(room, 'bob').room;
  room = applyDisconnect(room, 'bob').room; // bob role sticks, but he's not present
  // It's O's turn (bob), but bob is gone. Alice can't sneak in a move
  // for X just because the room has two roles — needs two LIVE connections.
  const r = applyClaim(room, 'alice', 0, 0, FR);
  assert.equal(r.broadcasts.length, 0);
});

test('applyClaim: silently ignored when it is not your turn', () => {
  let room = createRoom(PUZZLE);
  room = applyHello(room, 'alice').room; // X (host)
  room = applyHello(room, 'bob').room;   // O — O moves first
  const r = applyClaim(room, 'alice', 0, 0, FR);
  assert.equal(r.broadcasts.length, 0);
  assert.equal(r.room.game.cells[0][0].owner, null);
});

test('applyClaim: valid claim broadcasts new state with row/col to all', () => {
  let room = createRoom(PUZZLE);
  room = applyHello(room, 'alice').room; // X
  room = applyHello(room, 'bob').room;   // O — moves first
  const r = applyClaim(room, 'bob', 0, 0, FR);
  assert.equal(r.broadcasts.length, 1);
  assert.equal(r.broadcasts[0].to, 'all');
  const msg = /** @type {any} */ (r.broadcasts[0].message);
  assert.equal(msg.type, 'state');
  assert.equal(msg.kind, 'claimed');
  assert.equal(msg.row, 0);
  assert.equal(msg.col, 0);
  assert.equal(msg.game.cells[0][0].owner, 'O');
  assert.equal(msg.game.currentPlayer, 'X');
});

test('applyClaim: miss-invalid broadcasts state (turn flips) so both clients can shake', () => {
  let room = createRoom(PUZZLE);
  room = applyHello(room, 'alice').room; // X
  room = applyHello(room, 'bob').room;   // O
  const r = applyClaim(room, 'bob', 0, 0, JP); // JP is Asia + red, fails Europe row
  assert.equal(r.broadcasts.length, 1);
  const msg = /** @type {any} */ (r.broadcasts[0].message);
  assert.equal(msg.kind, 'miss-invalid');
  assert.equal(msg.game.cells[0][0].owner, null);
  assert.equal(msg.game.currentPlayer, 'X', 'turn flips on miss');
});

test('applyClaim: detects a winning move and the broadcast carries the win', () => {
  let room = createRoom(PUZZLE);
  room = applyHello(room, 'alice').room; // X (host)
  room = applyHello(room, 'bob').room;   // O — moves first
  const seq = [
    ['bob',   0, 0, FR],  // O at (0,0)
    ['alice', 1, 0, JP],  // X at (1,0)
    ['bob',   0, 1, DE],  // O at (0,1)
    ['alice', 1, 1, KR],  // X at (1,1)
  ];
  for (const [who, r, c, country] of seq) {
    const out = applyClaim(
      room,
      /** @type {string} */ (who),
      /** @type {number} */ (r),
      /** @type {number} */ (c),
      /** @type {Country} */ (country),
    );
    room = out.room;
  }
  const winning = applyClaim(room, 'bob', 0, 2, IT); // O wins row 0
  assert.equal(winning.broadcasts.length, 1);
  const msg = /** @type {any} */ (winning.broadcasts[0].message);
  assert.equal(msg.game.winner, 'O');
  assert.deepEqual(msg.game.winningLine, [[0, 0], [0, 1], [0, 2]]);
});

test('applyClaim: ignored once the game is over', () => {
  let room = createRoom(PUZZLE);
  room = applyHello(room, 'alice').room;
  room = applyHello(room, 'bob').room;
  room.game.winner = 'O';
  const r = applyClaim(room, 'bob', 1, 1, KR);
  assert.equal(r.broadcasts.length, 0);
});

// ---- applyGiveUp ----

const PK = country({ code: '12', name: 'Pakistan', continent: 'Asia', primaryColors: ['green'] });
const KE = country({ code: '20', name: 'Kenya', continent: 'Africa', primaryColors: ['red'] });
const NA = country({ code: '21', name: 'Namibia', continent: 'Africa', primaryColors: ['blue'] });
const NG = country({ code: '22', name: 'Nigeria', continent: 'Africa', primaryColors: ['green'] });

const TTT_POOL = [FR, DE, IT, JP, KR, PK, KE, NA, NG];

test('applyGiveUp: silently ignored when sender is not in the room', () => {
  let room = createRoom(PUZZLE);
  room = applyHello(room, 'alice').room;
  room = applyHello(room, 'bob').room;
  const r = applyGiveUp(room, 'stranger', TTT_POOL);
  assert.equal(r.broadcasts.length, 0);
  assert.equal(r.room, room);
});

test('applyGiveUp: silently ignored when the game is already over', () => {
  let room = createRoom(PUZZLE);
  room = applyHello(room, 'alice').room;
  room = applyHello(room, 'bob').room;
  room.game.winner = 'X';
  const r = applyGiveUp(room, 'alice', TTT_POOL);
  assert.equal(r.broadcasts.length, 0);
  assert.equal(r.room, room);
});

test('applyGiveUp: fills empties, marks state gaveUp, and broadcasts state to all with who=role', () => {
  let room = createRoom(PUZZLE);
  room = applyHello(room, 'alice').room; // X (host)
  room = applyHello(room, 'bob').room;   // O
  const r = applyGiveUp(room, 'bob', TTT_POOL);
  assert.equal(r.broadcasts.length, 1);
  assert.equal(r.broadcasts[0].to, 'all');
  const msg = /** @type {any} */ (r.broadcasts[0].message);
  assert.equal(msg.type, 'state');
  assert.equal(msg.kind, 'give-up');
  assert.equal(msg.who, 'O', 'who carries the resigning role so each client can phrase the result');
  assert.equal(msg.game.gaveUp, true);
  // Every cell should be filled by the engine.
  for (let rr = 0; rr < 3; rr++) {
    for (let cc = 0; cc < 3; cc++) {
      assert.ok(msg.game.cells[rr][cc].country, `(${rr},${cc}) was filled`);
    }
  }
  assert.equal(r.room.game.gaveUp, true);
});

test('applyGiveUp: subsequent claim attempts are no-ops once the room has gaveUp', () => {
  let room = createRoom(PUZZLE);
  room = applyHello(room, 'alice').room;
  room = applyHello(room, 'bob').room;
  room = applyGiveUp(room, 'alice', TTT_POOL).room;
  // Even though bob would be next in normal play, the room is frozen.
  const r = applyClaim(room, 'bob', 0, 0, FR);
  assert.equal(r.broadcasts.length, 0, 'claim ignored after give-up');
});

test('applyGiveUp: enables Play Again — applyStartRematch accepts the room as terminal', () => {
  let room = createRoom(PUZZLE);
  room = applyHello(room, 'alice').room;
  room = applyHello(room, 'bob').room;
  room = applyGiveUp(room, 'bob', TTT_POOL).room;
  // The fresh-puzzle param here is just a placeholder for the rematch.
  const r = applyStartRematch(room, 'alice', PUZZLE);
  assert.equal(r.broadcasts.length, 1, 'rematch is allowed after a give-up');
  const msg = /** @type {any} */ (r.broadcasts[0].message);
  assert.equal(msg.game.gaveUp, false, 'fresh game starts without gaveUp');
});

// ---- applyDisconnect ----

test('applyDisconnect: removes from present and broadcasts peer-left to the survivor', () => {
  let room = createRoom(PUZZLE);
  room = applyHello(room, 'alice').room;
  room = applyHello(room, 'bob').room;
  const r = applyDisconnect(room, 'alice');
  assert.equal(r.room.present.has('alice'), false);
  assert.equal(r.room.present.has('bob'), true);
  assert.equal(r.broadcasts.length, 1);
  assert.equal(r.broadcasts[0].to, 'bob');
  const msg = /** @type {any} */ (r.broadcasts[0].message);
  assert.equal(msg.type, 'peer-left');
});

test('applyDisconnect: roles survive a disconnect (so the player can reconnect as the same role)', () => {
  let room = createRoom(PUZZLE);
  room = applyHello(room, 'alice').room;
  room = applyHello(room, 'bob').room;
  const r = applyDisconnect(room, 'alice');
  assert.equal(r.room.roles.get('alice'), 'X', 'role is sticky');
  assert.equal(r.room.hostId, 'alice', 'host is sticky');
});

test('applyDisconnect: unknown playerId is a no-op', () => {
  let room = createRoom(PUZZLE);
  room = applyHello(room, 'alice').room;
  const r = applyDisconnect(room, 'stranger');
  assert.equal(r.broadcasts.length, 0);
  assert.equal(r.room, room);
});

// ---- applyStartRematch ----

const PUZZLE2 = {
  rows: [continent('Africa'), continent('Asia'), continent('Europe')],
  cols: [hasColor('blue'), hasColor('green'), hasColor('red')],
};

test('applyStartRematch: silently ignored when the sender is not in the room', () => {
  let room = createRoom(PUZZLE);
  room = applyHello(room, 'alice').room;
  room = applyHello(room, 'bob').room;
  room.game.winner = 'X';
  const r = applyStartRematch(room, 'stranger', PUZZLE2);
  assert.equal(r.broadcasts.length, 0);
  assert.equal(r.room, room);
});

test('applyStartRematch: silently ignored while the current game is still in progress', () => {
  let room = createRoom(PUZZLE);
  room = applyHello(room, 'alice').room;
  room = applyHello(room, 'bob').room;
  // game.winner is null and no draw → not over
  const r = applyStartRematch(room, 'alice', PUZZLE2);
  assert.equal(r.broadcasts.length, 0);
  assert.equal(r.room, room);
});

test('applyStartRematch: starts a fresh game with the new puzzle when the previous one is over', () => {
  let room = createRoom(PUZZLE);
  room = applyHello(room, 'alice').room;
  room = applyHello(room, 'bob').room;
  room.game.winner = 'O';
  const r = applyStartRematch(room, 'alice', PUZZLE2);
  assert.equal(r.broadcasts.length, 1);
  assert.equal(r.broadcasts[0].to, 'all');
  const msg = /** @type {any} */ (r.broadcasts[0].message);
  assert.equal(msg.type, 'state');
  assert.equal(msg.kind, 'rematch');
  assert.equal(msg.game.winner, null);
  assert.deepEqual(
    msg.game.puzzle.rows.map((/** @type {any} */ c) => c.id),
    PUZZLE2.rows.map((c) => c.id),
  );
});

test('applyStartRematch: flips the first-mover so each game alternates who starts', () => {
  let room = createRoom(PUZZLE); // lastFirstPlayer = 'O'
  room = applyHello(room, 'alice').room;
  room = applyHello(room, 'bob').room;
  room.game.winner = 'X';
  const r1 = applyStartRematch(room, 'alice', PUZZLE2);
  assert.equal(r1.room.game.currentPlayer, 'X', 'X starts after an O-started game');
  assert.equal(r1.room.lastFirstPlayer, 'X');
  // Finish that game and rematch again.
  r1.room.game.winner = 'X';
  const r2 = applyStartRematch(r1.room, 'bob', PUZZLE);
  assert.equal(r2.room.game.currentPlayer, 'O', 'O starts after an X-started game');
  assert.equal(r2.room.lastFirstPlayer, 'O');
});

test('applyStartRematch: roles (host=X, joiner=O) are preserved across rematches', () => {
  let room = createRoom(PUZZLE);
  room = applyHello(room, 'alice').room;
  room = applyHello(room, 'bob').room;
  room.game.winner = 'O';
  const r = applyStartRematch(room, 'alice', PUZZLE2);
  assert.equal(r.room.roles.get('alice'), 'X');
  assert.equal(r.room.roles.get('bob'), 'O');
  assert.equal(r.room.hostId, 'alice');
});

// ---- serialize / deserialize ----

test('serializeRoom + deserializeRoom round-trips game, roles, and hostId', () => {
  let room = createRoom(PUZZLE);
  room = applyHello(room, 'alice').room;
  room = applyHello(room, 'bob').room;
  const snapshot = serializeRoom(room);
  const restored = deserializeRoom(snapshot);
  assert.equal(restored.hostId, 'alice');
  assert.equal(restored.roles.get('alice'), 'X');
  assert.equal(restored.roles.get('bob'), 'O');
  assert.equal(restored.game.currentPlayer, room.game.currentPlayer);
  assert.deepEqual(restored.game.cells, room.game.cells);
  assert.deepEqual(
    restored.game.puzzle.rows.map((c) => c.id),
    room.game.puzzle.rows.map((c) => c.id),
  );
});

test('serializeRoom + deserializeRoom round-trip preserves lastFirstPlayer across eviction', () => {
  let room = createRoom(PUZZLE);
  room = applyHello(room, 'alice').room;
  room = applyHello(room, 'bob').room;
  room.game.winner = 'X';
  // First rematch flips lastFirstPlayer from 'O' to 'X'.
  room = applyStartRematch(room, 'alice', PUZZLE).room;
  assert.equal(room.lastFirstPlayer, 'X');
  // Eviction round-trip via JSON (what party.storage actually does).
  const restored = deserializeRoom(JSON.parse(JSON.stringify(serializeRoom(room))));
  assert.equal(restored.lastFirstPlayer, 'X', 'eviction must not reset the alternation');
});

test('serializeRoom omits the present set (live connections do not survive eviction)', () => {
  let room = createRoom(PUZZLE);
  room = applyHello(room, 'alice').room;
  const snapshot = /** @type {any} */ (serializeRoom(room));
  assert.equal(snapshot.present, undefined);
  const restored = deserializeRoom(snapshot);
  assert.equal(restored.present.size, 0);
});

test('serializeRoom strips puzzle category predicates (functions cannot be structured-cloned)', () => {
  const room = createRoom(PUZZLE);
  const snapshot = /** @type {any} */ (serializeRoom(room));
  for (const c of snapshot.game.puzzle.rows) {
    assert.equal(c.predicate, undefined, `row "${c.id}" must not carry a predicate function`);
    assert.equal(typeof c.id, 'string');
    assert.equal(typeof c.label, 'string');
  }
  for (const c of snapshot.game.puzzle.cols) {
    assert.equal(c.predicate, undefined);
  }
});

test('serializeRoom output round-trips through JSON without losing fields', () => {
  let room = createRoom(PUZZLE);
  room = applyHello(room, 'alice').room;
  const snapshot = serializeRoom(room);
  const json = JSON.parse(JSON.stringify(snapshot));
  const restored = deserializeRoom(json);
  assert.equal(restored.hostId, 'alice');
  assert.equal(restored.roles.get('alice'), 'X');
});

test('deserializeRoom rebuilds puzzle predicates so the game stays playable', () => {
  let room = createRoom(PUZZLE);
  room = applyHello(room, 'alice').room;
  room = applyHello(room, 'bob').room;
  // Round-trip through JSON.parse/stringify like party.storage would, then
  // re-mark both players as present (a fresh DO has no live connections).
  const snapshot = JSON.parse(JSON.stringify(serializeRoom(room)));
  let restored = deserializeRoom(snapshot);
  for (const cat of [...restored.game.puzzle.rows, ...restored.game.puzzle.cols]) {
    assert.equal(typeof cat.predicate, 'function', `rebuilt "${cat.id}" must have a predicate`);
  }
  restored = applyHello(restored, 'alice').room;
  restored = applyHello(restored, 'bob').room;
  // FR is Europe + red; cell (0,0) is Europe × red. Should validate ONLY if
  // the predicates rebuilt correctly from the stored ids.
  const r = applyClaim(restored, 'bob', 0, 0, FR);
  assert.equal(r.broadcasts.length, 1, 'restored predicates accept a valid claim');
  const msg = /** @type {any} */ (r.broadcasts[0].message);
  assert.equal(msg.kind, 'claimed');
});
