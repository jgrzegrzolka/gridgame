import { test } from 'node:test';
import assert from 'node:assert/strict';
import { continent, hasColor } from '../flags/grid.js';
import { UltimateTicTacToeServer } from './ultimateTicTacToeServer.js';

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

/** @param {string} id */
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
  const url = new URL('wss://example.test/parties/ultimate/ABC12');
  url.searchParams.set('pid', pid);
  if (intent) url.searchParams.set('intent', intent);
  return { request: /** @type {any} */ ({ url: url.toString() }) };
}

// ---- room lifecycle ----

test('onConnect: first joiner with intent=create initializes the 9×9 room and welcomes them as X', async () => {
  const a = mockConn('a');
  const srv = new UltimateTicTacToeServer(mockParty([a]), COUNTRIES, PUZZLE);
  await srv.onStart();
  await srv.onConnect(a, ctxFor('alice', 'create'));
  assert.equal(a.sent.length, 1);
  const msg = JSON.parse(a.sent[0]);
  assert.equal(msg.type, 'welcome');
  assert.equal(msg.you, 'X');
  assert.equal(msg.peerPresent, false);
  // 9×9 welcome carries the ultimate game state — 3×3 of small boards.
  assert.equal(msg.game.boards.length, 3);
  assert.equal(msg.game.boards[0].length, 3);
  assert.equal(a.closed, false);
});

test('onConnect: intent=join on an unknown room is rejected as room-not-found', async () => {
  const a = mockConn('a');
  const srv = new UltimateTicTacToeServer(mockParty([a]), COUNTRIES, PUZZLE);
  await srv.onStart();
  await srv.onConnect(a, ctxFor('alice', 'join'));
  const msg = JSON.parse(a.sent[0]);
  assert.equal(msg.type, 'rejected');
  assert.equal(msg.reason, 'room-not-found');
  assert.equal(a.closed, true);
});

test('onConnect: join after create assigns O and notifies host', async () => {
  const a = mockConn('a'); const b = mockConn('b');
  const srv = new UltimateTicTacToeServer(mockParty([a, b]), COUNTRIES, PUZZLE);
  await srv.onStart();
  await srv.onConnect(a, ctxFor('alice', 'create'));
  await srv.onConnect(b, ctxFor('bob', 'join'));
  const bWelcome = JSON.parse(b.sent[0]);
  assert.equal(bWelcome.you, 'O');
  assert.equal(bWelcome.peerPresent, true);
  const aLatest = JSON.parse(a.sent[a.sent.length - 1]);
  assert.equal(aLatest.type, 'peer-joined');
});

test('onConnect: missing pid is rejected', async () => {
  const a = mockConn('a');
  const srv = new UltimateTicTacToeServer(mockParty([a]), COUNTRIES, PUZZLE);
  await srv.onStart();
  await srv.onConnect(a, { request: /** @type {any} */ ({ url: 'wss://example.test/parties/ultimate/ABC12' }) });
  const msg = JSON.parse(a.sent[a.sent.length - 1]);
  assert.equal(msg.reason, 'missing-player-id');
});

test('onConnect: intent=create on an occupied room is a code-collision', async () => {
  const a = mockConn('a'); const c = mockConn('c');
  const srv = new UltimateTicTacToeServer(mockParty([a, c]), COUNTRIES, PUZZLE);
  await srv.onStart();
  await srv.onConnect(a, ctxFor('alice', 'create'));
  await srv.onConnect(c, ctxFor('carol', 'create'));
  const msg = JSON.parse(c.sent[c.sent.length - 1]);
  assert.equal(msg.reason, 'code-collision');
});

test('onConnect: third stranger is rejected as room-full', async () => {
  const a = mockConn('a'); const b = mockConn('b'); const c = mockConn('c');
  const srv = new UltimateTicTacToeServer(mockParty([a, b, c]), COUNTRIES, PUZZLE);
  await srv.onStart();
  await srv.onConnect(a, ctxFor('alice', 'create'));
  await srv.onConnect(b, ctxFor('bob', 'join'));
  await srv.onConnect(c, ctxFor('eve', 'join'));
  const last = JSON.parse(c.sent[c.sent.length - 1]);
  assert.equal(last.reason, 'room-full');
});

// ---- refresh / eviction ----

test('refresh: same playerId on a new connection keeps the same role', async () => {
  const a1 = mockConn('a1'); const b = mockConn('b'); const a2 = mockConn('a2');
  const conns = [a1, b];
  const srv = new UltimateTicTacToeServer(mockParty(conns), COUNTRIES, PUZZLE);
  await srv.onStart();
  await srv.onConnect(a1, ctxFor('alice', 'create'));
  await srv.onConnect(b,  ctxFor('bob',   'join'));
  await srv.onClose(a1);
  conns.splice(conns.indexOf(a1), 1, a2);
  await srv.onConnect(a2, ctxFor('alice', 'join'));
  const welcome = JSON.parse(a2.sent[0]);
  assert.equal(welcome.you, 'X');
  assert.equal(welcome.peerPresent, true);
});

test('eviction: a new server instance restores 9×9 room state from storage', async () => {
  const a = mockConn('a'); const b = mockConn('b');
  const storage = mockStorage();
  const srv1 = new UltimateTicTacToeServer(mockParty([a, b], storage), COUNTRIES, PUZZLE);
  await srv1.onStart();
  await srv1.onConnect(a, ctxFor('alice', 'create'));
  await srv1.onConnect(b, ctxFor('bob',   'join'));
  await srv1.onClose(a); await srv1.onClose(b);
  const a2 = mockConn('a2');
  const srv2 = new UltimateTicTacToeServer(mockParty([a2], storage), COUNTRIES, PUZZLE);
  await srv2.onStart();
  await srv2.onConnect(a2, ctxFor('alice', 'join'));
  const welcome = JSON.parse(a2.sent[0]);
  assert.equal(welcome.you, 'X');
  assert.deepEqual(
    welcome.game.puzzle.rows.map((/** @type {any} */ r) => r.id),
    PUZZLE.rows.map((r) => r.id),
  );
});

// ---- storage isolation ----

test('storage key does not collide with the 3×3 server (different key namespace)', async () => {
  const a = mockConn('a');
  const storage = mockStorage();
  const srv = new UltimateTicTacToeServer(mockParty([a], storage), COUNTRIES, PUZZLE);
  await srv.onStart();
  await srv.onConnect(a, ctxFor('alice', 'create'));
  // The 9×9 server uses 'ultimate-room' so a 3×3 server reading 'room' here
  // would find nothing — verify the key the server actually wrote.
  assert.notEqual(await storage.get('ultimate-room'), undefined,
    '9×9 snapshot must live under the ultimate-room key');
  assert.equal(await storage.get('room'), undefined,
    '9×9 server must not write to the 3×3 key');
});

// ---- gameplay ----

test('onMessage: malformed JSON is a no-op', async () => {
  const a = mockConn('a');
  const srv = new UltimateTicTacToeServer(mockParty([a]), COUNTRIES, PUZZLE);
  await srv.onStart();
  await srv.onConnect(a, ctxFor('alice', 'create'));
  const before = a.sent.length;
  await srv.onMessage('not json', a);
  assert.equal(a.sent.length, before);
});

test('onMessage: unknown country code is a no-op', async () => {
  const a = mockConn('a');
  const srv = new UltimateTicTacToeServer(mockParty([a]), COUNTRIES, PUZZLE);
  await srv.onStart();
  await srv.onConnect(a, ctxFor('alice', 'create'));
  const before = a.sent.length;
  await srv.onMessage(JSON.stringify({
    type: 'claim', bigRow: 0, bigCol: 0, smallRow: 0, smallCol: 0, countryCode: 'ZZZ',
  }), a);
  assert.equal(a.sent.length, before);
});

test('onMessage: valid 9×9 claim broadcasts state with all four coords', async () => {
  const a = mockConn('a'); const b = mockConn('b');
  const srv = new UltimateTicTacToeServer(mockParty([a, b]), COUNTRIES, PUZZLE);
  await srv.onStart();
  await srv.onConnect(a, ctxFor('alice', 'create'));
  await srv.onConnect(b, ctxFor('bob',   'join'));
  const aBefore = a.sent.length; const bBefore = b.sent.length;
  await srv.onMessage(JSON.stringify({
    type: 'claim', bigRow: 0, bigCol: 0, smallRow: 0, smallCol: 0, countryCode: '00',
  }), b);
  assert.ok(a.sent.length > aBefore);
  assert.ok(b.sent.length > bBefore);
  const last = JSON.parse(b.sent[b.sent.length - 1]);
  assert.equal(last.type, 'state');
  assert.equal(last.bigRow, 0);
  assert.equal(last.smallRow, 0);
  assert.equal(last.game.boards[0][0].cells[0][0].owner, 'O');
});

test('rematch: ignored while game in progress', async () => {
  const a = mockConn('a'); const b = mockConn('b');
  const srv = new UltimateTicTacToeServer(mockParty([a, b]), COUNTRIES, PUZZLE);
  await srv.onStart();
  await srv.onConnect(a, ctxFor('alice', 'create'));
  await srv.onConnect(b, ctxFor('bob',   'join'));
  const aBefore = a.sent.length; const bBefore = b.sent.length;
  await srv.onMessage(JSON.stringify({ type: 'rematch' }), a);
  assert.equal(a.sent.length, aBefore);
  assert.equal(b.sent.length, bBefore);
});

test('rematch: after a game ends, broadcasts a fresh game to both', async () => {
  const a = mockConn('a'); const b = mockConn('b');
  const srv = new UltimateTicTacToeServer(mockParty([a, b]), COUNTRIES, PUZZLE);
  await srv.onStart();
  await srv.onConnect(a, ctxFor('alice', 'create'));
  await srv.onConnect(b, ctxFor('bob',   'join'));
  /** @type {NonNullable<typeof srv.room>} */ (srv.room).game.winner = 'O';
  const aBefore = a.sent.length; const bBefore = b.sent.length;
  await srv.onMessage(JSON.stringify({ type: 'rematch' }), a);
  const aRematch = a.sent.slice(aBefore).map((s) => JSON.parse(s)).find((m) => m.kind === 'rematch');
  const bRematch = b.sent.slice(bBefore).map((s) => JSON.parse(s)).find((m) => m.kind === 'rematch');
  assert.ok(aRematch);
  assert.ok(bRematch);
  assert.equal(aRematch.game.winner, null);
});

test('give-up: broadcasts to both, sets gaveUp, blocks further claims', async () => {
  const a = mockConn('a'); const b = mockConn('b');
  const srv = new UltimateTicTacToeServer(mockParty([a, b]), COUNTRIES, PUZZLE);
  await srv.onStart();
  await srv.onConnect(a, ctxFor('alice', 'create'));
  await srv.onConnect(b, ctxFor('bob',   'join'));
  const aBefore = a.sent.length; const bBefore = b.sent.length;
  await srv.onMessage(JSON.stringify({ type: 'give-up' }), a);
  const aGiveUp = a.sent.slice(aBefore).map((s) => JSON.parse(s)).find((m) => m.kind === 'give-up');
  const bGiveUp = b.sent.slice(bBefore).map((s) => JSON.parse(s)).find((m) => m.kind === 'give-up');
  assert.ok(aGiveUp);
  assert.ok(bGiveUp);
  assert.equal(aGiveUp.who, 'X');
  assert.equal(aGiveUp.game.gaveUp, true);
  const aAfter = a.sent.length;
  await srv.onMessage(JSON.stringify({
    type: 'claim', bigRow: 0, bigCol: 0, smallRow: 1, smallCol: 0, countryCode: '00',
  }), b);
  assert.equal(a.sent.length, aAfter);
});

test('onClose: broadcasts peer-left and keeps role for reconnect', async () => {
  const a = mockConn('a'); const b = mockConn('b');
  const srv = new UltimateTicTacToeServer(mockParty([a, b]), COUNTRIES, PUZZLE);
  await srv.onStart();
  await srv.onConnect(a, ctxFor('alice', 'create'));
  await srv.onConnect(b, ctxFor('bob',   'join'));
  const bBefore = b.sent.length;
  await srv.onClose(a);
  const room = /** @type {NonNullable<typeof srv.room>} */ (srv.room);
  assert.equal(room.roles.has('alice'), true);
  assert.equal(room.present.has('alice'), false);
  const msgs = b.sent.slice(bBefore).map((s) => JSON.parse(s));
  assert.ok(msgs.some((m) => m.type === 'peer-left'));
});
