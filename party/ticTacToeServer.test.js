import { test } from 'node:test';
import assert from 'node:assert/strict';
import { continent, hasColor } from '../flags/engine.js';
import { createCountry } from '../flags/group.js';
import { TicTacToeServer } from './ticTacToeServer.js';

/** @typedef {import('../flags/group.js').Country} Country */

/**
 * @param {Partial<Country> & { code: string, name: string }} fields
 * @returns {Country}
 */
function country(fields) {
  return createCountry({ category: 'country', continent: 'Europe', statehood: 'un_member', ...fields });
}

const PUZZLE = {
  rows: [continent('Europe'), continent('Asia'), continent('Africa')],
  cols: [hasColor('red'), hasColor('blue'), hasColor('green')],
};

const FR = country({ code: '00', name: 'France', continent: 'Europe', primaryColors: ['red'] });
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

test('rematch: a player message ignored while the game is in progress', async () => {
  const a = mockConn('a'); const b = mockConn('b');
  const srv = new TicTacToeServer(mockParty([a, b]), COUNTRIES, PUZZLE);
  await srv.onStart();
  await srv.onConnect(a, ctxFor('alice', 'create'));
  await srv.onConnect(b, ctxFor('bob',   'join'));
  const aBefore = a.sent.length; const bBefore = b.sent.length;
  await srv.onMessage(JSON.stringify({ type: 'rematch' }), a);
  assert.equal(a.sent.length, bBefore - (bBefore - aBefore), 'no new state broadcast');
  assert.equal(b.sent.length, bBefore);
});

test('rematch: after a game ends, a single click starts a fresh game and broadcasts to both', async () => {
  const a = mockConn('a'); const b = mockConn('b');
  const srv = new TicTacToeServer(mockParty([a, b]), COUNTRIES, PUZZLE);
  await srv.onStart();
  await srv.onConnect(a, ctxFor('alice', 'create'));
  await srv.onConnect(b, ctxFor('bob',   'join'));
  // Force a finished state.
  /** @type {import('../flags/onlineRoom.js').Room} */ (srv.room).game.winner = 'O';
  const aBefore = a.sent.length; const bBefore = b.sent.length;
  await srv.onMessage(JSON.stringify({ type: 'rematch' }), a);
  const aMsgs = a.sent.slice(aBefore).map((s) => JSON.parse(s));
  const bMsgs = b.sent.slice(bBefore).map((s) => JSON.parse(s));
  const aRematch = aMsgs.find((m) => m.type === 'state' && m.kind === 'rematch');
  const bRematch = bMsgs.find((m) => m.type === 'state' && m.kind === 'rematch');
  assert.ok(aRematch, 'host receives the rematch state');
  assert.ok(bRematch, 'joiner receives the rematch state');
  assert.equal(aRematch.game.winner, null);
});

test('rematch: from a sender who is not in the room is silently ignored', async () => {
  const a = mockConn('a'); const b = mockConn('b'); const c = mockConn('c');
  const srv = new TicTacToeServer(mockParty([a, b, c]), COUNTRIES, PUZZLE);
  await srv.onStart();
  await srv.onConnect(a, ctxFor('alice', 'create'));
  await srv.onConnect(b, ctxFor('bob',   'join'));
  /** @type {import('../flags/onlineRoom.js').Room} */ (srv.room).game.winner = 'O';
  const aBefore = a.sent.length; const bBefore = b.sent.length;
  // c is not registered in the room — server didn't see an onConnect for c.
  await srv.onMessage(JSON.stringify({ type: 'rematch' }), c);
  assert.equal(a.sent.length, aBefore);
  assert.equal(b.sent.length, bBefore);
});

test('give-up: a player message broadcasts give-up state to both, freezes the board, blocks further claims', async () => {
  const a = mockConn('a'); const b = mockConn('b');
  const conns = [a, b];
  const srv = new TicTacToeServer(mockParty(conns), COUNTRIES, PUZZLE);
  await srv.onStart();
  await srv.onConnect(a, ctxFor('alice', 'create'));   // X
  await srv.onConnect(b, ctxFor('bob',   'join'));     // O
  const aBefore = a.sent.length; const bBefore = b.sent.length;
  await srv.onMessage(JSON.stringify({ type: 'give-up' }), a);
  const aMsgs = a.sent.slice(aBefore).map((s) => JSON.parse(s));
  const bMsgs = b.sent.slice(bBefore).map((s) => JSON.parse(s));
  const aGiveUp = aMsgs.find((m) => m.type === 'state' && m.kind === 'give-up');
  const bGiveUp = bMsgs.find((m) => m.type === 'state' && m.kind === 'give-up');
  assert.ok(aGiveUp, 'resigning host sees the broadcast');
  assert.ok(bGiveUp, 'opponent sees the broadcast');
  assert.equal(aGiveUp.who, 'X', 'who carries the resigner role');
  assert.equal(aGiveUp.game.gaveUp, true);
  assert.equal(aGiveUp.game.cells[0][0].country.code, '00',
    'the only matching country was placed in the only valid cell');
  // Follow-up claim must be ignored — game is over.
  const aAfter = a.sent.length;
  await srv.onMessage(JSON.stringify({ type: 'claim', row: 1, col: 0, countryCode: '00' }), b);
  assert.equal(a.sent.length, aAfter, 'no further broadcasts — board is frozen');
});

test('give-up: a sender who is not in the room is silently ignored', async () => {
  const a = mockConn('a'); const b = mockConn('b'); const c = mockConn('c');
  const srv = new TicTacToeServer(mockParty([a, b, c]), COUNTRIES, PUZZLE);
  await srv.onStart();
  await srv.onConnect(a, ctxFor('alice', 'create'));
  await srv.onConnect(b, ctxFor('bob',   'join'));
  const aBefore = a.sent.length; const bBefore = b.sent.length;
  await srv.onMessage(JSON.stringify({ type: 'give-up' }), c);
  assert.equal(a.sent.length, aBefore);
  assert.equal(b.sent.length, bBefore);
});

test('give-up: ignored once the game is already over', async () => {
  const a = mockConn('a'); const b = mockConn('b');
  const srv = new TicTacToeServer(mockParty([a, b]), COUNTRIES, PUZZLE);
  await srv.onStart();
  await srv.onConnect(a, ctxFor('alice', 'create'));
  await srv.onConnect(b, ctxFor('bob',   'join'));
  /** @type {import('../flags/onlineRoom.js').Room} */ (srv.room).game.winner = 'X';
  const aBefore = a.sent.length;
  await srv.onMessage(JSON.stringify({ type: 'give-up' }), a);
  assert.equal(a.sent.length, aBefore);
});

test('give-up: gaveUpBy is stamped onto the game so a refresh-restore can pick "You gave up" vs "Opponent gave up"', async () => {
  const a1 = mockConn('a1'); const b = mockConn('b'); const a2 = mockConn('a2');
  const conns = [a1, b];
  const srv = new TicTacToeServer(mockParty(conns), COUNTRIES, PUZZLE);
  await srv.onStart();
  await srv.onConnect(a1, ctxFor('alice', 'create'));   // alice = X
  await srv.onConnect(b,  ctxFor('bob',   'join'));     // bob = O
  await srv.onMessage(JSON.stringify({ type: 'give-up' }), a1);
  // Confirm the live broadcast records the resigner role on the game.
  const live = a1.sent.map((s) => JSON.parse(s)).find((m) => m.type === 'state' && m.kind === 'give-up');
  assert.equal(live.game.gaveUpBy, 'X', 'live state carries gaveUpBy=X (alice)');

  // Now alice refreshes — the welcome must replay the finished game with
  // gaveUpBy intact, otherwise the page can't distinguish self-resign
  // from opponent-resign on reload (the bug this test pins).
  await srv.onClose(a1);
  conns.splice(conns.indexOf(a1), 1, a2);
  await srv.onConnect(a2, ctxFor('alice', 'join'));
  const welcome = JSON.parse(a2.sent[0]);
  assert.equal(welcome.type, 'welcome');
  assert.equal(welcome.game.gaveUp, true, 'refresh replays the finished game');
  assert.equal(welcome.game.gaveUpBy, 'X', 'and the resigner role survives the round-trip through persistence');
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

// ---- Advanced mode (the room setting) ----

/**
 * @param {string} pid
 * @param {'create' | 'join'} intent
 * @param {boolean} advanced
 */
function ctxForAdvanced(pid, intent, advanced) {
  const url = new URL('wss://example.test/parties/main/ABC12');
  url.searchParams.set('pid', pid);
  url.searchParams.set('intent', intent);
  if (advanced) url.searchParams.set('advanced', '1');
  return { request: /** @type {any} */ ({ url: url.toString() }) };
}

/**
 * Record which pool each deal asked for. The suite forces a fixed puzzle, so
 * the generated board can't reveal the pool — but "did the server ask for the
 * easy one" is the actual contract here, and it's the thing that silently
 * breaks (a rematch quietly reverting to the full pool looks fine locally).
 * @param {TicTacToeServer} srv
 */
function recordDeals(srv) {
  /** @type {boolean[]} */
  const calls = [];
  const original = srv.dealPuzzle.bind(srv);
  srv.dealPuzzle = (advanced) => { calls.push(advanced); return original(advanced); };
  return calls;
}

test('onConnect: ?advanced=1 on a create deals the room from the full pool and tells the host', async () => {
  const a = mockConn('a');
  const srv = new TicTacToeServer(mockParty([a]), COUNTRIES, PUZZLE);
  const deals = recordDeals(srv);
  await srv.onStart();
  await srv.onConnect(a, ctxForAdvanced('alice', 'create', true));

  assert.deepEqual(deals, [true], 'the create deal must use the full pool');
  const msg = JSON.parse(a.sent[0]);
  assert.equal(msg.advanced, true);
  assert.equal(msg.isHost, true);
});

test('onConnect: a create without ?advanced deals the default flag board', async () => {
  const a = mockConn('a');
  const srv = new TicTacToeServer(mockParty([a]), COUNTRIES, PUZZLE);
  const deals = recordDeals(srv);
  await srv.onStart();
  await srv.onConnect(a, ctxFor('alice', 'create'));

  assert.deepEqual(deals, [false]);
  assert.equal(JSON.parse(a.sent[0]).advanced, false);
});

test('onConnect: a joiner cannot smuggle ?advanced=1 into an existing room', async () => {
  const a = mockConn('a');
  const b = mockConn('b');
  const srv = new TicTacToeServer(mockParty([a, b]), COUNTRIES, PUZZLE);
  await srv.onStart();
  await srv.onConnect(a, ctxFor('alice', 'create'));      // normal room
  await srv.onConnect(b, ctxForAdvanced('bob', 'join', true)); // bob tries his luck

  const bobWelcome = JSON.parse(b.sent[0]);
  assert.equal(bobWelcome.advanced, false, 'the room was already dealt; the param is inert');
  assert.equal(bobWelcome.isHost, false);
});

test('set-advanced: the host re-deals and both players are sent the new board', async () => {
  const a = mockConn('a');
  const b = mockConn('b');
  const srv = new TicTacToeServer(mockParty([a, b]), COUNTRIES, PUZZLE);
  await srv.onStart();
  await srv.onConnect(a, ctxFor('alice', 'create'));
  await srv.onConnect(b, ctxFor('bob', 'join'));
  const deals = recordDeals(srv);

  await srv.onMessage(JSON.stringify({ type: 'set-advanced', advanced: true }), a);

  assert.deepEqual(deals, [true], 'the re-deal must use the pool the host just asked for');
  for (const conn of [a, b]) {
    const last = JSON.parse(conn.sent[conn.sent.length - 1]);
    assert.equal(last.kind, 'advanced-changed', `${conn.id} must be told the board changed`);
    assert.equal(last.advanced, true);
  }
});

test('set-advanced: the joiner is ignored, and nobody is told anything', async () => {
  const a = mockConn('a');
  const b = mockConn('b');
  const srv = new TicTacToeServer(mockParty([a, b]), COUNTRIES, PUZZLE);
  await srv.onStart();
  await srv.onConnect(a, ctxFor('alice', 'create'));
  await srv.onConnect(b, ctxFor('bob', 'join'));
  const sentBefore = a.sent.length;

  await srv.onMessage(JSON.stringify({ type: 'set-advanced', advanced: true }), b);

  assert.equal(a.sent.length, sentBefore, 'a refused set-advanced broadcasts nothing');
  assert.equal(srv.room?.advanced, false);
});

test('set-advanced: is refused once a move has landed', async () => {
  const a = mockConn('a');
  const b = mockConn('b');
  const srv = new TicTacToeServer(mockParty([a, b]), COUNTRIES, PUZZLE);
  await srv.onStart();
  await srv.onConnect(a, ctxFor('alice', 'create'));
  await srv.onConnect(b, ctxFor('bob', 'join'));
  // Bob is O and moves first; FR is Europe + red, so (0,0) is valid.
  await srv.onMessage(JSON.stringify({ type: 'claim', row: 0, col: 0, countryCode: FR.code }), b);
  const sentBefore = a.sent.length;

  await srv.onMessage(JSON.stringify({ type: 'set-advanced', advanced: true }), a);

  assert.equal(a.sent.length, sentBefore, 'the host cannot re-deal over the opponent');
  assert.equal(srv.room?.game.cells[0][0].country?.code, FR.code);
});

test('set-advanced: survives a durable-object eviction, so a rematch keeps the mode', async () => {
  const storage = mockStorage();
  const a = mockConn('a');
  const srv = new TicTacToeServer(mockParty([a], storage), COUNTRIES, PUZZLE);
  await srv.onStart();
  await srv.onConnect(a, ctxForAdvanced('alice', 'create', true));

  // A fresh DO over the same storage — what an eviction actually looks like.
  const revived = new TicTacToeServer(mockParty([a], storage), COUNTRIES, PUZZLE);
  await revived.onStart();
  assert.equal(revived.room?.advanced, true);
});

test('rematch: deals from the room mode, not the default pool', async () => {
  const a = mockConn('a');
  const b = mockConn('b');
  const srv = new TicTacToeServer(mockParty([a, b]), COUNTRIES, PUZZLE);
  await srv.onStart();
  await srv.onConnect(a, ctxForAdvanced('alice', 'create', true));
  await srv.onConnect(b, ctxFor('bob', 'join'));
  await srv.onMessage(JSON.stringify({ type: 'give-up' }), a);
  const deals = recordDeals(srv);

  await srv.onMessage(JSON.stringify({ type: 'rematch' }), a);

  // Agreeing to a no-statistics board and then getting metrics on "Play again"
  // would be a bait, so this is the assertion that keeps the promise.
  assert.deepEqual(deals, [true]);
  assert.equal(srv.room?.advanced, true);
});
