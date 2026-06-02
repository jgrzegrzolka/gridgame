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
 * Tiny in-memory replacement for party.storage.
 */
function mockStorage() {
  const data = new Map();
  return {
    /** @param {string} key */
    get: async (key) => data.get(key),
    /** @param {string} key @param {any} value */
    put: async (key, value) => { data.set(key, value); },
    /** @param {string} key */
    delete: async (key) => { data.delete(key); },
  };
}

/**
 * @param {Array<{ id: string }>} conns
 * @param {ReturnType<typeof mockStorage>} [storage]
 */
function mockParty(conns, storage = mockStorage()) {
  return {
    storage,
    /** @param {string} id */
    getConnection: (id) => conns.find((c) => c.id === id),
    getConnections: () => conns,
  };
}

/**
 * @param {string} pid
 * @param {'create' | 'join'} [intent]
 */
function ctxFor(pid, intent) {
  const url = new URL('wss://example.test/parties/main/ABC12');
  url.searchParams.set('pid', pid);
  if (intent) url.searchParams.set('intent', intent);
  // PartyKit hands us a real Request; for tests, the bare URL is enough.
  return { request: /** @type {any} */ ({ url: url.toString() }) };
}

// ---- room lifecycle ----

test('onConnect: first joiner with intent=create initializes the room and welcomes them as X', async () => {
  const a = mockConn('a');
  const srv = new TicTacToeServer(mockParty([a]), COUNTRIES, PUZZLE);
  await srv.onStart();
  await srv.onConnect(a, ctxFor('alice', 'create'));
  assert.equal(a.sent.length, 1);
  const msg = JSON.parse(a.sent[0]);
  assert.equal(msg.type, 'welcome');
  assert.equal(msg.you, 'X', 'host is always X');
  assert.equal(msg.peerPresent, false);
  assert.equal(a.closed, false);
});

test('onConnect: intent=join on an empty (unknown) room is rejected as room-not-found', async () => {
  const a = mockConn('a');
  const srv = new TicTacToeServer(mockParty([a]), COUNTRIES, PUZZLE);
  await srv.onStart();
  await srv.onConnect(a, ctxFor('alice', 'join'));
  assert.equal(a.sent.length, 1);
  const msg = JSON.parse(a.sent[0]);
  assert.equal(msg.type, 'rejected');
  assert.equal(msg.reason, 'room-not-found');
  assert.equal(a.closed, true);
});

test('onConnect: intent=join on a created room assigns the joiner as O and notifies the host', async () => {
  const a = mockConn('a'); const b = mockConn('b');
  const conns = [a, b];
  const srv = new TicTacToeServer(mockParty(conns), COUNTRIES, PUZZLE);
  await srv.onStart();
  await srv.onConnect(a, ctxFor('alice', 'create'));
  await srv.onConnect(b, ctxFor('bob', 'join'));
  const bWelcome = JSON.parse(b.sent[0]);
  assert.equal(bWelcome.type, 'welcome');
  assert.equal(bWelcome.you, 'O');
  assert.equal(bWelcome.peerPresent, true);
  const aLatest = JSON.parse(a.sent[a.sent.length - 1]);
  assert.equal(aLatest.type, 'peer-joined');
});

test('onConnect: missing pid is rejected outright', async () => {
  const a = mockConn('a');
  const srv = new TicTacToeServer(mockParty([a]), COUNTRIES, PUZZLE);
  await srv.onStart();
  await srv.onConnect(a, { request: /** @type {any} */ ({ url: 'wss://example.test/parties/main/ABC12' }) });
  const msg = JSON.parse(a.sent[a.sent.length - 1]);
  assert.equal(msg.type, 'rejected');
  assert.equal(msg.reason, 'missing-player-id');
  assert.equal(a.closed, true);
});

test('onConnect: intent=create after the room is already occupied is a code-collision', async () => {
  const a = mockConn('a'); const c = mockConn('c');
  const srv = new TicTacToeServer(mockParty([a, c]), COUNTRIES, PUZZLE);
  await srv.onStart();
  await srv.onConnect(a, ctxFor('alice', 'create'));
  // A different player tries to "create" the same room name.
  await srv.onConnect(c, ctxFor('carol', 'create'));
  const msg = JSON.parse(c.sent[c.sent.length - 1]);
  assert.equal(msg.type, 'rejected');
  assert.equal(msg.reason, 'code-collision');
  assert.equal(c.closed, true);
});

test('onConnect: third stranger (intent=join) is rejected as room-full', async () => {
  const a = mockConn('a'); const b = mockConn('b'); const c = mockConn('c');
  const srv = new TicTacToeServer(mockParty([a, b, c]), COUNTRIES, PUZZLE);
  await srv.onStart();
  await srv.onConnect(a, ctxFor('alice', 'create'));
  await srv.onConnect(b, ctxFor('bob', 'join'));
  await srv.onConnect(c, ctxFor('eve', 'join'));
  const last = JSON.parse(c.sent[c.sent.length - 1]);
  assert.equal(last.type, 'rejected');
  assert.equal(last.reason, 'room-full');
  assert.equal(c.closed, true);
});

// ---- refresh / reconnect ----

test('refresh: same playerId on a new connection keeps the same role', async () => {
  const a1 = mockConn('a1'); const b = mockConn('b'); const a2 = mockConn('a2');
  const conns = [a1, b];
  const srv = new TicTacToeServer(mockParty(conns), COUNTRIES, PUZZLE);
  await srv.onStart();
  await srv.onConnect(a1, ctxFor('alice', 'create'));   // alice = X
  await srv.onConnect(b,  ctxFor('bob',   'join'));     // bob = O
  await srv.onClose(a1);                                 // alice's WS drops
  // alice reloads — fresh conn but same pid.
  conns.splice(conns.indexOf(a1), 1, a2);
  await srv.onConnect(a2, ctxFor('alice', 'join'));
  const welcome = JSON.parse(a2.sent[0]);
  assert.equal(welcome.you, 'X', 'role survives the refresh');
  assert.equal(welcome.peerPresent, true);
});

test('refresh: both players refresh in opposite order — roles stick (host keeps X)', async () => {
  const a1 = mockConn('a1'); const b1 = mockConn('b1');
  const a2 = mockConn('a2'); const b2 = mockConn('b2');
  const conns = [a1, b1];
  const srv = new TicTacToeServer(mockParty(conns), COUNTRIES, PUZZLE);
  await srv.onStart();
  await srv.onConnect(a1, ctxFor('alice', 'create'));
  await srv.onConnect(b1, ctxFor('bob',   'join'));
  await srv.onClose(a1); await srv.onClose(b1);
  // Bob refreshes first this time.
  conns.length = 0; conns.push(b2, a2);
  await srv.onConnect(b2, ctxFor('bob',   'join'));
  await srv.onConnect(a2, ctxFor('alice', 'join'));
  const aWelcome = JSON.parse(a2.sent[0]);
  const bWelcome = JSON.parse(b2.sent[0]);
  assert.equal(aWelcome.you, 'X');
  assert.equal(bWelcome.you, 'O');
});

// ---- persistence across eviction ----

test('eviction: a new TicTacToeServer instance restores room state from storage', async () => {
  const a = mockConn('a'); const b = mockConn('b');
  const storage = mockStorage();
  const srv1 = new TicTacToeServer(mockParty([a, b], storage), COUNTRIES, PUZZLE);
  await srv1.onStart();
  await srv1.onConnect(a, ctxFor('alice', 'create'));
  await srv1.onConnect(b, ctxFor('bob',   'join'));
  await srv1.onClose(a); await srv1.onClose(b);
  // Simulate eviction: brand new server instance, same storage.
  const a2 = mockConn('a2');
  const srv2 = new TicTacToeServer(mockParty([a2], storage), COUNTRIES, PUZZLE);
  await srv2.onStart();
  await srv2.onConnect(a2, ctxFor('alice', 'join'));
  const welcome = JSON.parse(a2.sent[0]);
  assert.equal(welcome.you, 'X', 'reloaded room remembers alice as host');
  // Puzzle identity survives the eviction. Predicates are functions and
  // don't make it through JSON, so compare by id/label only.
  assert.deepEqual(
    welcome.game.puzzle.rows.map((/** @type {any} */ r) => r.id),
    PUZZLE.rows.map((r) => r.id),
  );
  assert.deepEqual(
    welcome.game.puzzle.cols.map((/** @type {any} */ c) => c.id),
    PUZZLE.cols.map((c) => c.id),
  );
});

// ---- gameplay ----

test('onMessage: ignores malformed JSON (no crash, no broadcast)', async () => {
  const a = mockConn('a');
  const srv = new TicTacToeServer(mockParty([a]), COUNTRIES, PUZZLE);
  await srv.onStart();
  await srv.onConnect(a, ctxFor('alice', 'create'));
  const beforeLen = a.sent.length;
  await srv.onMessage('not json', a);
  assert.equal(a.sent.length, beforeLen, 'no new messages sent');
});

test('onMessage: ignores unknown country code', async () => {
  const a = mockConn('a');
  const srv = new TicTacToeServer(mockParty([a]), COUNTRIES, PUZZLE);
  await srv.onStart();
  await srv.onConnect(a, ctxFor('alice', 'create'));
  const beforeLen = a.sent.length;
  await srv.onMessage(JSON.stringify({ type: 'claim', row: 0, col: 0, countryCode: 'ZZZ' }), a);
  assert.equal(a.sent.length, beforeLen);
});

test('onMessage: a valid claim broadcasts state to ALL connections', async () => {
  const a = mockConn('a'); const b = mockConn('b');
  const conns = [a, b];
  const srv = new TicTacToeServer(mockParty(conns), COUNTRIES, PUZZLE);
  await srv.onStart();
  await srv.onConnect(a, ctxFor('alice', 'create'));  // X
  await srv.onConnect(b, ctxFor('bob',   'join'));    // O — moves first
  const aBefore = a.sent.length; const bBefore = b.sent.length;
  // Bob (O) makes a valid claim on a Europe + red cell.
  await srv.onMessage(JSON.stringify({ type: 'claim', row: 0, col: 0, countryCode: '00' }), b);
  assert.ok(a.sent.length > aBefore);
  assert.ok(b.sent.length > bBefore);
  const last = JSON.parse(b.sent[b.sent.length - 1]);
  assert.equal(last.type, 'state');
  assert.equal(last.game.cells[0][0].owner, 'O');
});

test('onClose: broadcasts peer-left and keeps the role for reconnect', async () => {
  const a = mockConn('a'); const b = mockConn('b');
  const conns = [a, b];
  const srv = new TicTacToeServer(mockParty(conns), COUNTRIES, PUZZLE);
  await srv.onStart();
  await srv.onConnect(a, ctxFor('alice', 'create'));
  await srv.onConnect(b, ctxFor('bob',   'join'));
  const aBefore = a.sent.length; const bBefore = b.sent.length;
  await srv.onClose(a);
  const room = /** @type {NonNullable<typeof srv.room>} */ (srv.room);
  assert.equal(room.roles.has('alice'), true, 'role is sticky');
  assert.equal(room.present.has('alice'), false, 'present is updated');
  const msgs = [...a.sent.slice(aBefore), ...b.sent.slice(bBefore)].map((s) => JSON.parse(s));
  assert.ok(msgs.some((m) => m.type === 'peer-left'));
});
