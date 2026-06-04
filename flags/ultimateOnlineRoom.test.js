import { test } from 'node:test';
import assert from 'node:assert/strict';
import { continent, hasColor } from './grid.js';
import {
  createUltimateRoom,
  applyUltimateHello,
  applyUltimateClaim,
  applyUltimateRoomGiveUp,
  applyUltimateDisconnect,
  applyUltimateStartRematch,
  serializeUltimateRoom,
  deserializeUltimateRoom,
} from './ultimateOnlineRoom.js';

/** @typedef {import('./group.js').Country} Country */

/**
 * @param {Partial<Country> & { code: string, name: string }} fields
 * @returns {Country}
 */
function country(fields) {
  return {
    category: 'country',
    continent: 'Europe',
    statehood: 'un_member',
    ...fields,
  };
}

const PUZZLE = {
  rows: [continent('Europe'), continent('Asia'), continent('Africa')],
  cols: [hasColor('red'), hasColor('blue'), hasColor('green')],
};

// Country pool large enough for the 9×9 give-up reveal: every (row × col)
// intersection wants distinct fresh countries, and the global pool needs
// to keep some headroom.
function makePool() {
  /** @type {Country[]} */
  const pool = [];
  const continents = /** @type {const} */ (['Europe', 'Asia', 'Africa']);
  const colors = /** @type {const} */ (['red', 'blue', 'green']);
  let codeCounter = 0;
  for (const c of continents) {
    for (const col of colors) {
      // 3 distinct countries per (continent × color) so the 3×3 small board
      // has enough fresh choices.
      for (let i = 0; i < 3; i++) {
        const code = String(codeCounter++).padStart(2, '0');
        pool.push(country({
          code,
          name: `${c}-${col}-${i}`,
          continent: c,
          colors: [col],
        }));
      }
    }
  }
  return pool;
}

const POOL = makePool();
const FR = /** @type {Country} */ (POOL.find((c) => c.continent === 'Europe' && c.colors?.includes('red')));
const JP = /** @type {Country} */ (POOL.find((c) => c.continent === 'Asia' && c.colors?.includes('red')));

// ---- createUltimateRoom ----

test('createUltimateRoom: empty hostId/roles/present, O to move, 3×3 of empty small boards', () => {
  const room = createUltimateRoom(PUZZLE);
  assert.equal(room.hostId, null);
  assert.equal(room.roles.size, 0);
  assert.equal(room.present.size, 0);
  assert.equal(room.game.currentPlayer, 'O');
  assert.equal(room.game.winner, null);
  assert.equal(room.game.boards.length, 3);
  assert.equal(room.game.boards[0].length, 3);
  for (const row of room.game.boards) for (const b of row) assert.equal(b.winner, null);
});

// ---- applyUltimateHello ----

test('applyUltimateHello: first player becomes host and is assigned X', () => {
  const room = createUltimateRoom(PUZZLE);
  const r = applyUltimateHello(room, 'alice');
  assert.equal(r.room.hostId, 'alice');
  assert.equal(r.room.roles.get('alice'), 'X');
  assert.equal(r.room.present.has('alice'), true);
  const msg = /** @type {any} */ (r.broadcasts[0].message);
  assert.equal(msg.type, 'welcome');
  assert.equal(msg.you, 'X');
  assert.equal(msg.peerPresent, false);
});

test('applyUltimateHello: second player is assigned O and both sides learn the peer arrived', () => {
  let room = createUltimateRoom(PUZZLE);
  room = applyUltimateHello(room, 'alice').room;
  const r = applyUltimateHello(room, 'bob');
  assert.equal(r.room.roles.get('bob'), 'O');
  assert.equal(r.room.hostId, 'alice');
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

test('applyUltimateHello: third stranger is rejected as room-full', () => {
  let room = createUltimateRoom(PUZZLE);
  room = applyUltimateHello(room, 'alice').room;
  room = applyUltimateHello(room, 'bob').room;
  const r = applyUltimateHello(room, 'eve');
  assert.equal(r.rejectConnection, true);
  const msg = /** @type {any} */ (r.broadcasts[0].message);
  assert.equal(msg.type, 'rejected');
  assert.equal(msg.reason, 'room-full');
});

test('applyUltimateHello: known playerId reconnecting keeps the same role', () => {
  let room = createUltimateRoom(PUZZLE);
  room = applyUltimateHello(room, 'alice').room;
  room = applyUltimateHello(room, 'bob').room;
  room = applyUltimateDisconnect(room, 'alice').room;
  const r = applyUltimateHello(room, 'alice');
  assert.equal(r.room.roles.get('alice'), 'X');
  assert.equal(r.room.present.has('alice'), true);
});

// ---- applyUltimateClaim ----

test('applyUltimateClaim: silently ignored when playerId has no role', () => {
  const room = createUltimateRoom(PUZZLE);
  const r = applyUltimateClaim(room, 'stranger', 0, 0, 0, 0, FR, POOL);
  assert.equal(r.broadcasts.length, 0);
  assert.equal(r.room, room);
});

test('applyUltimateClaim: silently ignored when only one player is present', () => {
  let room = createUltimateRoom(PUZZLE);
  room = applyUltimateHello(room, 'alice').room;
  const r = applyUltimateClaim(room, 'alice', 0, 0, 0, 0, FR, POOL);
  assert.equal(r.broadcasts.length, 0);
  assert.equal(r.room.game.boards[0][0].cells[0][0].owner, null);
});

test('applyUltimateClaim: silently ignored when it is not your turn', () => {
  let room = createUltimateRoom(PUZZLE);
  room = applyUltimateHello(room, 'alice').room; // X
  room = applyUltimateHello(room, 'bob').room;   // O — moves first
  const r = applyUltimateClaim(room, 'alice', 0, 0, 0, 0, FR, POOL);
  assert.equal(r.broadcasts.length, 0);
});

test('applyUltimateClaim: valid claim broadcasts state with all four coords', () => {
  let room = createUltimateRoom(PUZZLE);
  room = applyUltimateHello(room, 'alice').room;
  room = applyUltimateHello(room, 'bob').room;
  const r = applyUltimateClaim(room, 'bob', 0, 0, 1, 2, FR, POOL);
  assert.equal(r.broadcasts.length, 1);
  assert.equal(r.broadcasts[0].to, 'all');
  const msg = /** @type {any} */ (r.broadcasts[0].message);
  assert.equal(msg.type, 'state');
  assert.equal(msg.kind, 'claimed');
  assert.equal(msg.bigRow, 0);
  assert.equal(msg.bigCol, 0);
  assert.equal(msg.smallRow, 1);
  assert.equal(msg.smallCol, 2);
  assert.equal(msg.game.boards[0][0].cells[1][2].owner, 'O');
});

test('applyUltimateClaim: miss-invalid flips the turn so both clients can shake', () => {
  let room = createUltimateRoom(PUZZLE);
  room = applyUltimateHello(room, 'alice').room;
  room = applyUltimateHello(room, 'bob').room;
  // JP is Asia + red — fails the Europe row at bigRow=0.
  const r = applyUltimateClaim(room, 'bob', 0, 0, 0, 0, JP, POOL);
  const msg = /** @type {any} */ (r.broadcasts[0].message);
  assert.equal(msg.kind, 'miss-invalid');
  assert.equal(msg.game.boards[0][0].cells[0][0].owner, null);
  assert.equal(msg.game.currentPlayer, 'X');
});

test('applyUltimateClaim: ignored once the meta game is over', () => {
  let room = createUltimateRoom(PUZZLE);
  room = applyUltimateHello(room, 'alice').room;
  room = applyUltimateHello(room, 'bob').room;
  room.game.winner = 'O';
  const r = applyUltimateClaim(room, 'bob', 0, 0, 0, 0, FR, POOL);
  assert.equal(r.broadcasts.length, 0);
});

// ---- applyUltimateRoomGiveUp ----

test('applyUltimateRoomGiveUp: ignored when sender is not in the room', () => {
  let room = createUltimateRoom(PUZZLE);
  room = applyUltimateHello(room, 'alice').room;
  room = applyUltimateHello(room, 'bob').room;
  const r = applyUltimateRoomGiveUp(room, 'stranger', POOL);
  assert.equal(r.broadcasts.length, 0);
  assert.equal(r.room, room);
});

test('applyUltimateRoomGiveUp: ignored when the game is already over', () => {
  let room = createUltimateRoom(PUZZLE);
  room = applyUltimateHello(room, 'alice').room;
  room = applyUltimateHello(room, 'bob').room;
  room.game.winner = 'X';
  const r = applyUltimateRoomGiveUp(room, 'alice', POOL);
  assert.equal(r.broadcasts.length, 0);
  assert.equal(r.room, room);
});

test('applyUltimateRoomGiveUp: marks gaveUp, broadcasts give-up with who=role, freezes board', () => {
  let room = createUltimateRoom(PUZZLE);
  room = applyUltimateHello(room, 'alice').room; // X
  room = applyUltimateHello(room, 'bob').room;   // O
  const r = applyUltimateRoomGiveUp(room, 'bob', POOL);
  assert.equal(r.broadcasts.length, 1);
  const msg = /** @type {any} */ (r.broadcasts[0].message);
  assert.equal(msg.type, 'state');
  assert.equal(msg.kind, 'give-up');
  assert.equal(msg.who, 'O');
  assert.equal(msg.game.gaveUp, true);
  // Subsequent claim is a no-op.
  const claim = applyUltimateClaim(r.room, 'alice', 0, 0, 0, 0, FR, POOL);
  assert.equal(claim.broadcasts.length, 0);
});

// ---- applyUltimateDisconnect ----

test('applyUltimateDisconnect: removes from present and broadcasts peer-left', () => {
  let room = createUltimateRoom(PUZZLE);
  room = applyUltimateHello(room, 'alice').room;
  room = applyUltimateHello(room, 'bob').room;
  const r = applyUltimateDisconnect(room, 'alice');
  assert.equal(r.room.present.has('alice'), false);
  assert.equal(r.room.present.has('bob'), true);
  assert.equal(r.broadcasts.length, 1);
  assert.equal(r.broadcasts[0].to, 'bob');
  const msg = /** @type {any} */ (r.broadcasts[0].message);
  assert.equal(msg.type, 'peer-left');
});

test('applyUltimateDisconnect: roles survive', () => {
  let room = createUltimateRoom(PUZZLE);
  room = applyUltimateHello(room, 'alice').room;
  room = applyUltimateHello(room, 'bob').room;
  const r = applyUltimateDisconnect(room, 'alice');
  assert.equal(r.room.roles.get('alice'), 'X');
  assert.equal(r.room.hostId, 'alice');
});

// ---- applyUltimateStartRematch ----

const PUZZLE2 = {
  rows: [continent('Africa'), continent('Asia'), continent('Europe')],
  cols: [hasColor('blue'), hasColor('green'), hasColor('red')],
};

test('applyUltimateStartRematch: ignored mid-game', () => {
  let room = createUltimateRoom(PUZZLE);
  room = applyUltimateHello(room, 'alice').room;
  room = applyUltimateHello(room, 'bob').room;
  const r = applyUltimateStartRematch(room, 'alice', PUZZLE2);
  assert.equal(r.broadcasts.length, 0);
  assert.equal(r.room, room);
});

test('applyUltimateStartRematch: starts fresh game on new puzzle after game ends', () => {
  let room = createUltimateRoom(PUZZLE);
  room = applyUltimateHello(room, 'alice').room;
  room = applyUltimateHello(room, 'bob').room;
  room.game.winner = 'O';
  const r = applyUltimateStartRematch(room, 'alice', PUZZLE2);
  assert.equal(r.broadcasts.length, 1);
  const msg = /** @type {any} */ (r.broadcasts[0].message);
  assert.equal(msg.kind, 'rematch');
  assert.equal(msg.game.winner, null);
  assert.deepEqual(
    msg.game.puzzle.rows.map((/** @type {any} */ c) => c.id),
    PUZZLE2.rows.map((c) => c.id),
  );
});

test('applyUltimateStartRematch: alternates the first mover across rematches', () => {
  let room = createUltimateRoom(PUZZLE);
  room = applyUltimateHello(room, 'alice').room;
  room = applyUltimateHello(room, 'bob').room;
  room.game.winner = 'X';
  const r1 = applyUltimateStartRematch(room, 'alice', PUZZLE2);
  assert.equal(r1.room.game.currentPlayer, 'X');
  assert.equal(r1.room.lastFirstPlayer, 'X');
  r1.room.game.winner = 'X';
  const r2 = applyUltimateStartRematch(r1.room, 'bob', PUZZLE);
  assert.equal(r2.room.game.currentPlayer, 'O');
});

// ---- serialize / deserialize ----

test('serializeUltimateRoom + deserializeUltimateRoom round-trip game/roles/hostId', () => {
  let room = createUltimateRoom(PUZZLE);
  room = applyUltimateHello(room, 'alice').room;
  room = applyUltimateHello(room, 'bob').room;
  const snapshot = serializeUltimateRoom(room);
  const restored = deserializeUltimateRoom(JSON.parse(JSON.stringify(snapshot)));
  assert.equal(restored.hostId, 'alice');
  assert.equal(restored.roles.get('alice'), 'X');
  assert.equal(restored.roles.get('bob'), 'O');
  assert.equal(restored.present.size, 0);
  assert.deepEqual(
    restored.game.puzzle.rows.map((c) => c.id),
    room.game.puzzle.rows.map((c) => c.id),
  );
});

test('serializeUltimateRoom strips puzzle category predicates', () => {
  const room = createUltimateRoom(PUZZLE);
  const snapshot = /** @type {any} */ (serializeUltimateRoom(room));
  for (const c of snapshot.game.puzzle.rows) {
    assert.equal(c.predicate, undefined);
  }
});

test('deserializeUltimateRoom rebuilds puzzle predicates so the game stays playable', () => {
  let room = createUltimateRoom(PUZZLE);
  room = applyUltimateHello(room, 'alice').room;
  room = applyUltimateHello(room, 'bob').room;
  const snapshot = JSON.parse(JSON.stringify(serializeUltimateRoom(room)));
  let restored = deserializeUltimateRoom(snapshot);
  for (const cat of [...restored.game.puzzle.rows, ...restored.game.puzzle.cols]) {
    assert.equal(typeof cat.predicate, 'function');
  }
  restored = applyUltimateHello(restored, 'alice').room;
  restored = applyUltimateHello(restored, 'bob').room;
  const r = applyUltimateClaim(restored, 'bob', 0, 0, 0, 0, FR, POOL);
  assert.equal(r.broadcasts.length, 1);
  const msg = /** @type {any} */ (r.broadcasts[0].message);
  assert.equal(msg.kind, 'claimed');
});
