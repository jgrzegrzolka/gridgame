import { test } from 'node:test';
import assert from 'node:assert/strict';
import { continent, hasColor } from './grid.js';
import { createRoom, applyHello, applyClaim, applyDisconnect } from './onlineRoom.js';

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

const FR = country({ code: '00', name: 'France', continent: 'Europe', colors: ['red'] });
const DE = country({ code: '01', name: 'Germany', continent: 'Europe', colors: ['blue'] });
const IT = country({ code: '02', name: 'Italy', continent: 'Europe', colors: ['green'] });
const JP = country({ code: '10', name: 'Japan', continent: 'Asia', colors: ['red'] });
const KR = country({ code: '11', name: 'Korea', continent: 'Asia', colors: ['blue'] });

const rngLow = () => 0; // first-joiner gets 'X'
const rngHigh = () => 0.9; // first-joiner gets 'O'

test('createRoom: fresh room with no players and O to move', () => {
  const room = createRoom(PUZZLE);
  assert.equal(room.roles.size, 0);
  assert.equal(room.game.currentPlayer, 'O');
  assert.equal(room.game.winner, null);
});

test('applyHello: first player assigned X when rng is low', () => {
  const room = createRoom(PUZZLE);
  const r = applyHello(room, 'alice', rngLow);
  assert.equal(r.room.roles.get('alice'), 'X');
  assert.equal(r.broadcasts.length, 1);
  assert.equal(r.broadcasts[0].to, 'alice');
  const msg = /** @type {any} */ (r.broadcasts[0].message);
  assert.equal(msg.type, 'welcome');
  assert.equal(msg.you, 'X');
  assert.equal(msg.peerPresent, false);
});

test('applyHello: first player assigned O when rng is high', () => {
  const room = createRoom(PUZZLE);
  const r = applyHello(room, 'alice', rngHigh);
  assert.equal(r.room.roles.get('alice'), 'O');
});

test('applyHello: second player gets the opposite role and both get notified', () => {
  let room = createRoom(PUZZLE);
  room = applyHello(room, 'alice', rngLow).room; // X
  const r = applyHello(room, 'bob', rngLow); // rng is moot here
  assert.equal(r.room.roles.get('bob'), 'O');
  assert.equal(r.room.roles.size, 2);
  assert.equal(r.broadcasts.length, 2);
  const welcomeBc = r.broadcasts.find((b) => b.to === 'bob');
  const peerJoinedBc = r.broadcasts.find((b) => b.to === 'alice');
  if (!welcomeBc || !peerJoinedBc) throw new Error('expected both broadcasts');
  const welcome = /** @type {any} */ (welcomeBc.message);
  assert.equal(welcome.type, 'welcome');
  assert.equal(welcome.you, 'O');
  assert.equal(welcome.peerPresent, true);
  const peerJoined = /** @type {any} */ (peerJoinedBc.message);
  assert.equal(peerJoined.type, 'peer-joined');
});

test('applyHello: third player is rejected and not assigned a role', () => {
  let room = createRoom(PUZZLE);
  room = applyHello(room, 'alice', rngLow).room;
  room = applyHello(room, 'bob', rngLow).room;
  const r = applyHello(room, 'eve', rngLow);
  assert.equal(r.room.roles.size, 2);
  assert.equal(r.rejectConnection, true);
  assert.equal(r.broadcasts.length, 1);
  const msg = /** @type {any} */ (r.broadcasts[0].message);
  assert.equal(msg.type, 'rejected');
  assert.equal(msg.reason, 'room-full');
});

test('applyHello: idempotent for a known connId — re-sends welcome, no role change', () => {
  let room = createRoom(PUZZLE);
  const first = applyHello(room, 'alice', rngLow);
  room = first.room;
  const second = applyHello(room, 'alice', rngHigh); // different rng must not matter
  assert.equal(second.room.roles.get('alice'), 'X');
  assert.equal(second.broadcasts.length, 1);
  const msg = /** @type {any} */ (second.broadcasts[0].message);
  assert.equal(msg.type, 'welcome');
  assert.equal(msg.you, 'X');
});

test('applyClaim: silently ignored when connId has no role', () => {
  const room = createRoom(PUZZLE);
  const r = applyClaim(room, 'stranger', 0, 0, FR);
  assert.equal(r.broadcasts.length, 0);
  assert.equal(r.room, room);
});

test('applyClaim: silently ignored when it is not your turn', () => {
  let room = createRoom(PUZZLE);
  room = applyHello(room, 'alice', rngLow).room; // alice = X
  room = applyHello(room, 'bob', rngLow).room; // bob = O, O moves first
  // It's O's turn, but X (alice) tries to claim.
  const r = applyClaim(room, 'alice', 0, 0, FR);
  assert.equal(r.broadcasts.length, 0);
  assert.equal(r.room.game.cells[0][0].owner, null);
});

test('applyClaim: valid claim broadcasts new state to all', () => {
  let room = createRoom(PUZZLE);
  room = applyHello(room, 'alice', rngHigh).room; // alice = O, moves first
  room = applyHello(room, 'bob', rngHigh).room;   // bob = X
  const r = applyClaim(room, 'alice', 0, 0, FR);
  assert.equal(r.broadcasts.length, 1);
  assert.equal(r.broadcasts[0].to, 'all');
  const msg = /** @type {any} */ (r.broadcasts[0].message);
  assert.equal(msg.type, 'state');
  assert.equal(msg.kind, 'claimed');
  assert.equal(msg.game.cells[0][0].owner, 'O');
  assert.equal(msg.game.currentPlayer, 'X');
});

test('applyClaim: miss-invalid broadcasts state (turn flips) so both clients can shake', () => {
  let room = createRoom(PUZZLE);
  room = applyHello(room, 'alice', rngHigh).room; // O
  room = applyHello(room, 'bob', rngHigh).room;
  // JP is Asian + red → fails Europe row predicate at (0,0).
  const r = applyClaim(room, 'alice', 0, 0, JP);
  assert.equal(r.broadcasts.length, 1);
  const msg = /** @type {any} */ (r.broadcasts[0].message);
  assert.equal(msg.kind, 'miss-invalid');
  assert.equal(msg.game.cells[0][0].owner, null);
  assert.equal(msg.game.currentPlayer, 'X', 'turn flips on miss');
});

test('applyClaim: detects a winning move and the broadcast carries the win', () => {
  let room = createRoom(PUZZLE);
  room = applyHello(room, 'alice', rngHigh).room; // O — moves first
  room = applyHello(room, 'bob', rngLow).room;    // bob is X (after alice took O)
  let game = room.game;
  // O,X,O,X,O across row 0 — sequence that lets O win row 0.
  const seq = [
    ['alice', 0, 0, FR],  // O at (0,0)
    ['bob',   1, 0, JP],  // X at (1,0)
    ['alice', 0, 1, DE],  // O at (0,1)
    ['bob',   1, 1, KR],  // X at (1,1)
  ];
  for (const [who, r, c, country] of seq) {
    const out = applyClaim(room, /** @type {string} */ (who), /** @type {number} */ (r), /** @type {number} */ (c), /** @type {Country} */ (country));
    room = out.room;
  }
  const winning = applyClaim(room, 'alice', 0, 2, IT); // O wins row 0
  assert.equal(winning.broadcasts.length, 1);
  const msg = /** @type {any} */ (winning.broadcasts[0].message);
  assert.equal(msg.game.winner, 'O');
  assert.deepEqual(msg.game.winningLine, [[0, 0], [0, 1], [0, 2]]);
});

test('applyClaim: ignored once the game is over', () => {
  let room = createRoom(PUZZLE);
  room = applyHello(room, 'alice', rngHigh).room;
  room = applyHello(room, 'bob', rngLow).room;
  // Force a finished game by direct mutation — tests only care about behaviour past game-over.
  room.game.winner = 'O';
  const r = applyClaim(room, 'alice', 1, 1, KR);
  assert.equal(r.broadcasts.length, 0);
});

test('applyDisconnect: removes role and broadcasts peer-left', () => {
  let room = createRoom(PUZZLE);
  room = applyHello(room, 'alice', rngLow).room;
  room = applyHello(room, 'bob', rngLow).room;
  const r = applyDisconnect(room, 'alice');
  assert.equal(r.room.roles.has('alice'), false);
  assert.equal(r.room.roles.size, 1);
  assert.equal(r.broadcasts.length, 1);
  assert.equal(r.broadcasts[0].to, 'all');
  const msg = /** @type {any} */ (r.broadcasts[0].message);
  assert.equal(msg.type, 'peer-left');
});

test('applyDisconnect: unknown connId is a no-op', () => {
  let room = createRoom(PUZZLE);
  room = applyHello(room, 'alice', rngLow).room;
  const r = applyDisconnect(room, 'stranger');
  assert.equal(r.broadcasts.length, 0);
  assert.equal(r.room, room);
});
