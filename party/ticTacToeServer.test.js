import { test } from 'node:test';
import assert from 'node:assert/strict';
import { continent, hasColor } from '../flags/grid.js';
import { TicTacToeServer } from './ticTacToeServer.js';

/** @typedef {import('../flags/group.js').Country} Country */

/**
 * @param {Partial<Country> & { code: string, name: string }} fields
 * @returns {Country}
 */
function country(fields) {
  return { category: 'country', continent: 'Europe', statehood: 'un_member', ...fields };
}

const PUZZLE = {
  rows: [continent('Europe'), continent('Asia'), continent('Africa')],
  cols: [hasColor('red'), hasColor('blue'), hasColor('green')],
};

const FR = country({ code: '00', name: 'France', continent: 'Europe', colors: ['red'] });
const COUNTRIES = [FR];

/**
 * Build a mock connection that records send() and close() calls.
 * @param {string} id
 */
function mockConn(id) {
  /** @type {string[]} */
  const sent = [];
  let closed = false;
  return {
    id,
    send: (/** @type {string} */ data) => { sent.push(data); },
    close: () => { closed = true; },
    /** @returns {string[]} */
    get sent() { return sent; },
    /** @returns {boolean} */
    get closed() { return closed; },
  };
}

/**
 * @param {Array<{ id: string }>} conns
 */
function mockParty(conns) {
  return {
    /** @param {string} id */
    getConnection: (id) => conns.find((c) => c.id === id),
    getConnections: () => conns,
  };
}

test('constructor: initializes room with the given puzzle and no players', () => {
  const conns = /** @type {any[]} */ ([]);
  const srv = new TicTacToeServer(mockParty(conns), COUNTRIES, PUZZLE);
  assert.equal(srv.room.roles.size, 0);
  assert.equal(srv.room.game.currentPlayer, 'O');
  assert.deepEqual(srv.room.game.puzzle, PUZZLE);
});

test('onConnect: first joiner gets a welcome and is NOT closed', () => {
  const a = mockConn('a');
  const conns = [a];
  const srv = new TicTacToeServer(mockParty(conns), COUNTRIES, PUZZLE);
  srv.onConnect(a);
  assert.equal(a.sent.length, 1);
  const msg = JSON.parse(a.sent[0]);
  assert.equal(msg.type, 'welcome');
  assert.ok(msg.you === 'X' || msg.you === 'O');
  assert.equal(a.closed, false);
});

test('onConnect: third joiner receives "rejected" then is closed', () => {
  const a = mockConn('a'); const b = mockConn('b'); const c = mockConn('c');
  const conns = [a, b, c];
  const srv = new TicTacToeServer(mockParty(conns), COUNTRIES, PUZZLE);
  srv.onConnect(a); srv.onConnect(b); srv.onConnect(c);
  const last = JSON.parse(c.sent[c.sent.length - 1]);
  assert.equal(last.type, 'rejected');
  assert.equal(last.reason, 'room-full');
  assert.equal(c.closed, true);
});

test('onMessage: ignores malformed JSON (no crash, no broadcast)', () => {
  const a = mockConn('a');
  const conns = [a];
  const srv = new TicTacToeServer(mockParty(conns), COUNTRIES, PUZZLE);
  srv.onConnect(a);
  const beforeLen = a.sent.length;
  srv.onMessage('not json', a);
  assert.equal(a.sent.length, beforeLen, 'no new messages sent');
});

test('onMessage: ignores unknown country code', () => {
  const a = mockConn('a');
  const conns = [a];
  const srv = new TicTacToeServer(mockParty(conns), COUNTRIES, PUZZLE);
  srv.onConnect(a);
  const beforeLen = a.sent.length;
  srv.onMessage(JSON.stringify({ type: 'claim', row: 0, col: 0, countryCode: 'ZZZ' }), a);
  assert.equal(a.sent.length, beforeLen);
});

test('onMessage: a valid claim broadcasts state to ALL connections', () => {
  const a = mockConn('a'); const b = mockConn('b');
  const conns = [a, b];
  const srv = new TicTacToeServer(mockParty(conns), COUNTRIES, PUZZLE);
  // Make sure 'a' is the one to move (O). If random gave 'a' = X, swap.
  srv.onConnect(a); srv.onConnect(b);
  const mover = srv.room.roles.get('a') === 'O' ? a : b;
  const moverBefore = mover.sent.length;
  const otherBefore = (mover === a ? b : a).sent.length;
  srv.onMessage(JSON.stringify({ type: 'claim', row: 0, col: 0, countryCode: '00' }), mover);
  // Both connections should have received the state broadcast.
  assert.ok(mover.sent.length > moverBefore);
  const otherConn = mover === a ? b : a;
  assert.ok(otherConn.sent.length > otherBefore);
  const last = JSON.parse(mover.sent[mover.sent.length - 1]);
  assert.equal(last.type, 'state');
  assert.equal(last.game.cells[0][0].owner, 'O');
});

test('onClose: broadcasts peer-left and removes the role', () => {
  const a = mockConn('a'); const b = mockConn('b');
  const conns = [a, b];
  const srv = new TicTacToeServer(mockParty(conns), COUNTRIES, PUZZLE);
  srv.onConnect(a); srv.onConnect(b);
  assert.equal(srv.room.roles.size, 2);
  const aBefore = a.sent.length; const bBefore = b.sent.length;
  srv.onClose(a);
  assert.equal(srv.room.roles.has('a'), false);
  assert.equal(srv.room.roles.size, 1);
  // peer-left goes to "all" (which still includes a in our mock, since the
  // mock party doesn't remove on close — that's the runtime's job — but
  // the routing logic is what we're testing).
  const msgs = [...a.sent.slice(aBefore), ...b.sent.slice(bBefore)].map((s) => JSON.parse(s));
  assert.ok(msgs.some((m) => m.type === 'peer-left'));
});
