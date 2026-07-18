import { test } from 'node:test';
import assert from 'node:assert/strict';
import PartyGameServer from './partyGameServer.js';
import { roundCountFor, HAND_SIZE } from '../flags/partyDraft.js';
import { ROUND_QUESTIONS } from '../flags/partyPlan.js';

/**
 * The party game server is otherwise the thin shell over the tested reducers
 * (`flags/partyRoom.js`) and draft helpers (`flags/partyDraft.js`); these tests
 * pin the one piece that lives only here — the **draft routing**: dealing the
 * opening round, opening a pick at a round boundary, and turning a pick (or a
 * forced pick) into the next round. Mirrors `ticTacToeServer.test.js`'s mocks.
 */

/** @param {string} id */
function mockConn(id) {
  /** @type {string[]} */
  const sent = [];
  return {
    id,
    send: (/** @type {string} */ data) => { sent.push(data); },
    close: () => {},
    get sent() { return sent; },
    /** All parsed messages this conn has received, in order. */
    get msgs() { return sent.map((s) => JSON.parse(s)); },
    /** The last message of a given type, or null. @param {string} type */
    last(type) { const m = this.msgs.filter((x) => x.type === type); return m.length ? m[m.length - 1] : null; },
  };
}

function mockStorage() {
  const data = new Map();
  return {
    get: async (/** @type {string} */ k) => data.get(k),
    put: async (/** @type {string} */ k, /** @type {any} */ v) => { data.set(k, v); },
    delete: async (/** @type {string} */ k) => { data.delete(k); },
  };
}

/** @param {Array<{ id: string }>} conns */
function mockParty(conns) {
  return { storage: mockStorage(), getConnection: (/** @type {string} */ id) => conns.find((c) => c.id === id), getConnections: () => conns };
}

/** @param {string} pid @param {'create'|'join'} [intent] @param {string} [nick] */
function ctxFor(pid, intent = 'create', nick) {
  const url = new URL('wss://example.test/parties/party/ABC12');
  url.searchParams.set('pid', pid);
  url.searchParams.set('intent', intent);
  if (nick) url.searchParams.set('nick', nick);
  return { request: /** @type {any} */ ({ url: url.toString() }) };
}

/** Start a solo draft game and return { srv, conn }. */
async function startSoloDraft() {
  const conn = mockConn('a');
  const srv = new PartyGameServer(mockParty([conn]));
  await srv.onStart();
  await srv.onConnect(conn, ctxFor('alice'));
  await srv.onMessage(JSON.stringify({ type: 'start', draft: true }), conn);
  return { srv, conn };
}

/** Play one round's worth of questions: buzz (solo auto-reveals) then next, five times.
 *  The fifth `next` lands on the pick (or the final board). */
async function playBlock(srv, conn) {
  for (let i = 0; i < ROUND_QUESTIONS; i++) {
    await srv.onMessage(JSON.stringify({ type: 'buzz', choice: 'zz' }), conn);
    await srv.onMessage(JSON.stringify({ type: 'next' }), conn);
  }
}

test('draft start: opens a Flags round, sizes the game from the seat count', async () => {
  const { srv, conn } = await startSoloDraft();
  assert.equal(srv.room.draft, true);
  assert.equal(srv.room.targetRounds, roundCountFor(1)); // solo -> 3
  assert.equal(srv.room.totalQuestions, roundCountFor(1) * ROUND_QUESTIONS);
  const q = conn.last('question');
  assert.equal(q.questionId, 'flagPick', 'round 1 is Flags');
  assert.equal(q.answer, undefined, 'the answer never rides the broadcast');
});

test('draft start: the host\'s round count overrides the seat-count suggestion', async () => {
  const conn = mockConn('a');
  const srv = new PartyGameServer(mockParty([conn]));
  await srv.onStart();
  await srv.onConnect(conn, ctxFor('alice'));
  await srv.onMessage(JSON.stringify({ type: 'start', draft: true, rounds: 7 }), conn);
  assert.equal(srv.room.targetRounds, 7);
  assert.equal(srv.room.totalQuestions, 7 * ROUND_QUESTIONS);
});

test('draft start: an out-of-range round count falls back to the suggestion', async () => {
  for (const rounds of [0, 99, -3, 2.5, 'lots', null]) {
    const conn = mockConn('a');
    const srv = new PartyGameServer(mockParty([conn]));
    await srv.onStart();
    await srv.onConnect(conn, ctxFor('alice'));
    await srv.onMessage(JSON.stringify({ type: 'start', draft: true, rounds }), conn);
    assert.equal(srv.room.targetRounds, roundCountFor(1), `rounds=${rounds}`);
  }
});

test('draft start: tricky mode is forced off even if a stale client sends it', async () => {
  // Tricky is a Custom-setup option; the draft door never showed the toggle, so a
  // device that once enabled it in Custom used to veil every later draft game.
  const conn = mockConn('a');
  const srv = new PartyGameServer(mockParty([conn]));
  await srv.onStart();
  await srv.onConnect(conn, ctxFor('alice'));
  await srv.onMessage(JSON.stringify({ type: 'start', draft: true, tricky: true }), conn);
  assert.equal(srv.room.tricky, false);
  assert.equal(conn.last('question').tricky, false, 'and clients are told not to veil');
});

test('setlist start: tricky mode still rides the host plan', async () => {
  // The draft override must not disarm tricky for Custom setup.
  const conn = mockConn('a');
  const srv = new PartyGameServer(mockParty([conn]));
  await srv.onStart();
  await srv.onConnect(conn, ctxFor('alice'));
  await srv.onMessage(JSON.stringify({ type: 'start', tricky: true }), conn);
  assert.equal(srv.room.tricky, true);
});

test('draft: a round boundary opens a pick with a hand that excludes the played mode', async () => {
  const { srv, conn } = await startSoloDraft();
  await playBlock(srv, conn); // 5 questions of Flags, then next -> picking
  assert.equal(srv.room.phase, 'picking');
  const picking = conn.last('picking');
  assert.ok(picking, 'a picking broadcast was sent');
  assert.equal(picking.picker, 'alice', 'the lone seat is the picker');
  assert.equal(picking.hand.length, HAND_SIZE);
  assert.ok(!picking.hand.includes('flags-all'), 'the opening Flags mode is not offered again');
});

test('draft: a valid pick deals that round with attribution and records the mode', async () => {
  const { srv, conn } = await startSoloDraft();
  await playBlock(srv, conn);
  const hand = conn.last('picking').hand;
  const chosen = hand.find((id) => id === 'map-outlines') ?? hand[0];
  await srv.onMessage(JSON.stringify({ type: 'pick', modeId: chosen }), conn);
  assert.equal(srv.room.phase, 'question');
  assert.equal(srv.room.questionIndex, ROUND_QUESTIONS, 'advanced to the first question of round 2');
  const q = conn.last('question');
  assert.deepEqual(q.draftPick, { picker: 'alice', modeId: chosen });
  assert.ok(srv.usedModes.has(chosen), 'the picked mode is now used');
  assert.equal(srv.room.plan.length, 2, 'the round was appended to the plan');
});

test('draft: an invalid pick (unknown / already-played mode) is ignored', async () => {
  const { srv, conn } = await startSoloDraft();
  await playBlock(srv, conn);
  const before = conn.sent.length;
  await srv.onMessage(JSON.stringify({ type: 'pick', modeId: 'flags-all' }), conn); // already played
  await srv.onMessage(JSON.stringify({ type: 'pick', modeId: 'not-a-mode' }), conn);
  assert.equal(srv.room.phase, 'picking', 'still waiting for a valid pick');
  assert.equal(conn.sent.length, before, 'nothing broadcast for an invalid pick');
});

test('draft: only the designated picker can pick', async () => {
  const { srv, conn } = await startSoloDraft();
  await playBlock(srv, conn);
  const hand = conn.last('picking').hand;
  // A message from a non-picker id is dropped (playerByConn maps this conn to
  // alice, who *is* the picker here, so simulate a spoof by clearing the picker).
  srv.room = { ...srv.room, picker: 'someone-else' };
  await srv.onMessage(JSON.stringify({ type: 'pick', modeId: hand[0] }), conn);
  assert.equal(srv.room.phase, 'picking', 'a pick from a non-picker is ignored');
});

test('draft: forcePick from the host resolves the pick with a random hand card', async () => {
  const { srv, conn } = await startSoloDraft();
  await playBlock(srv, conn);
  await srv.onMessage(JSON.stringify({ type: 'forcePick' }), conn);
  assert.equal(srv.room.phase, 'question', 'the round was dealt on timeout');
  assert.equal(srv.room.questionIndex, ROUND_QUESTIONS);
  const q = conn.last('question');
  assert.equal(q.draftPick.picker, 'alice', 'attributed to the picker who timed out');
});

test('draft: a boundary where everyone has picked wraps the rotation, never freezes', async () => {
  // The host can set more rounds than seats, so "every seat has already picked"
  // is a normal mid-game state. The boundary must still open a pick (the
  // rotation wraps) rather than freezing in `reveal` or skipping the pick.
  const { srv, conn } = await startSoloDraft();
  for (let i = 0; i < ROUND_QUESTIONS - 1; i++) {
    await srv.onMessage(JSON.stringify({ type: 'buzz', choice: 'zz' }), conn);
    await srv.onMessage(JSON.stringify({ type: 'next' }), conn);
  }
  await srv.onMessage(JSON.stringify({ type: 'buzz', choice: 'zz' }), conn); // question 4 -> reveal (boundary)
  srv.room = { ...srv.room, pickedBy: ['alice'] }; // the only seat already picked once
  await srv.onMessage(JSON.stringify({ type: 'next' }), conn);
  assert.notEqual(srv.room.phase, 'reveal', 'the room did not freeze at the boundary');
  assert.equal(srv.room.phase, 'picking', 'the rotation wrapped to a fresh pick');
  assert.equal(srv.room.picker, 'alice');
});

test('draft: the last round ends in the final board, no pick', async () => {
  // Play every round the game was sized for; the boundary after the last one is
  // the final board, not another pick.
  const conn = mockConn('a');
  const srv = new PartyGameServer(mockParty([conn]));
  await srv.onStart();
  await srv.onConnect(conn, ctxFor('alice'));
  await srv.onMessage(JSON.stringify({ type: 'start', draft: true, rounds: 3 }), conn);
  await playBlock(srv, conn);                 // round 1 -> picking
  for (let b = 2; b <= 3; b++) {
    const hand = conn.last('picking').hand;
    await srv.onMessage(JSON.stringify({ type: 'pick', modeId: hand[0] }), conn);
    await playBlock(srv, conn);
  }
  assert.equal(srv.room.phase, 'final');
  assert.ok(conn.last('final'), 'the final board was broadcast');
});

test('draft (3 players): the picking broadcast names the same picker for everyone', async () => {
  const a = mockConn('a'), b = mockConn('b'), c = mockConn('c');
  const srv = new PartyGameServer(mockParty([a, b, c]));
  await srv.onStart();
  await srv.onConnect(a, ctxFor('alice', 'create', 'Alice'));
  await srv.onConnect(b, ctxFor('bob', 'join', 'Bob'));
  await srv.onConnect(c, ctxFor('carol', 'join', 'Carol'));

  // Each player's own welcome must carry their own id as `you`.
  assert.equal(a.last('welcome').you, 'alice');
  assert.equal(b.last('welcome').you, 'bob');
  assert.equal(c.last('welcome').you, 'carol');

  await srv.onMessage(JSON.stringify({ type: 'start', draft: true }), a);
  // Play round 1: every present seat buzzes, then the host advances.
  for (let i = 0; i < ROUND_QUESTIONS; i++) {
    await srv.onMessage(JSON.stringify({ type: 'buzz', choice: 'zz' }), a);
    await srv.onMessage(JSON.stringify({ type: 'buzz', choice: 'zz' }), b);
    await srv.onMessage(JSON.stringify({ type: 'buzz', choice: 'zz' }), c);
    await srv.onMessage(JSON.stringify({ type: 'next' }), a);
  }
  assert.equal(srv.room.phase, 'picking');

  // All three clients receive a picking broadcast naming the SAME picker.
  const pa = a.last('picking'), pb = b.last('picking'), pc = c.last('picking');
  assert.ok(pa && pb && pc, 'everyone got a picking broadcast');
  assert.equal(pa.picker, pb.picker);
  assert.equal(pb.picker, pc.picker);
  assert.ok(['alice', 'bob', 'carol'].includes(pa.picker), 'picker is a real seat');

  // Server-authoritative youPick: EXACTLY the picker's own connection is told
  // youPick=true (and given the hand); the other two get youPick=false and no
  // hand. This is the "player3 sees the wrong picker" fix — the picker's client
  // never has to re-derive its role, so a stale id can't hide their hand.
  const byId = { alice: a, bob: b, carol: c };
  for (const [id, conn] of Object.entries(byId)) {
    const p = conn.last('picking');
    if (id === pa.picker) {
      assert.equal(p.youPick, true, `${id} is the picker -> youPick true`);
      assert.ok(Array.isArray(p.hand) && p.hand.length === HAND_SIZE, 'the picker gets the hand');
    } else {
      assert.equal(p.youPick, false, `${id} is a watcher -> youPick false`);
      assert.equal(p.hand, undefined, 'a watcher never receives the hand');
    }
  }
});
