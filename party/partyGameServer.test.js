import { test } from 'node:test';
import assert from 'node:assert/strict';
import PartyGameServer from './partyGameServer.js';
import { blockCountFor } from '../flags/partyDraft.js';
import { BLOCK_ROUNDS } from '../flags/partyPlan.js';

/**
 * The party game server is otherwise the thin shell over the tested reducers
 * (`flags/partyRoom.js`) and draft helpers (`flags/partyDraft.js`); these tests
 * pin the one piece that lives only here — the **draft routing**: dealing the
 * opening block, opening a pick at a block boundary, and turning a pick (or a
 * forced pick) into the next block. Mirrors `ticTacToeServer.test.js`'s mocks.
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

/** Play one block's worth of rounds: buzz (solo auto-reveals) then next, five times.
 *  The fifth `next` lands on the pick (or the final board). */
async function playBlock(srv, conn) {
  for (let i = 0; i < BLOCK_ROUNDS; i++) {
    await srv.onMessage(JSON.stringify({ type: 'buzz', choice: 'zz' }), conn);
    await srv.onMessage(JSON.stringify({ type: 'next' }), conn);
  }
}

test('draft start: opens a Flags block, sizes the game from the seat count', async () => {
  const { srv, conn } = await startSoloDraft();
  assert.equal(srv.room.draft, true);
  assert.equal(srv.room.targetBlocks, blockCountFor(1)); // solo -> 2
  assert.equal(srv.room.totalRounds, blockCountFor(1) * BLOCK_ROUNDS);
  const q = conn.last('question');
  assert.equal(q.roundId, 'flagPick', 'block 1 is Flags');
  assert.equal(q.answer, undefined, 'the answer never rides the broadcast');
});

test('draft: a block boundary opens a pick with a hand that excludes the played mode', async () => {
  const { srv, conn } = await startSoloDraft();
  await playBlock(srv, conn); // 5 rounds of Flags, then next -> picking
  assert.equal(srv.room.phase, 'picking');
  const picking = conn.last('picking');
  assert.ok(picking, 'a picking broadcast was sent');
  assert.equal(picking.picker, 'alice', 'the lone seat is the picker');
  assert.equal(picking.hand.length, 5);
  assert.ok(!picking.hand.includes('flags-all'), 'the opening Flags mode is not offered again');
});

test('draft: a valid pick deals that block with attribution and records the mode', async () => {
  const { srv, conn } = await startSoloDraft();
  await playBlock(srv, conn);
  const hand = conn.last('picking').hand;
  const chosen = hand.find((id) => id === 'map-outlines') ?? hand[0];
  await srv.onMessage(JSON.stringify({ type: 'pick', modeId: chosen }), conn);
  assert.equal(srv.room.phase, 'question');
  assert.equal(srv.room.roundIndex, BLOCK_ROUNDS, 'advanced to the first round of block 2');
  const q = conn.last('question');
  assert.deepEqual(q.draftPick, { picker: 'alice', modeId: chosen });
  assert.ok(srv.usedModes.has(chosen), 'the picked mode is now used');
  assert.equal(srv.room.plan.length, 2, 'the block was appended to the plan');
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
  assert.equal(srv.room.phase, 'question', 'the block was dealt on timeout');
  assert.equal(srv.room.roundIndex, BLOCK_ROUNDS);
  const q = conn.last('question');
  assert.equal(q.draftPick.picker, 'alice', 'attributed to the picker who timed out');
});

test('draft: a null picker at a boundary never freezes — it advances instead', async () => {
  // Defensive: force the (normally-unreachable) state where every seat has
  // already picked, then hit a block boundary. `next` must fall through to an
  // ordinary advance, not sit forever in `reveal`.
  const { srv, conn } = await startSoloDraft();
  for (let i = 0; i < BLOCK_ROUNDS - 1; i++) {
    await srv.onMessage(JSON.stringify({ type: 'buzz', choice: 'zz' }), conn);
    await srv.onMessage(JSON.stringify({ type: 'next' }), conn);
  }
  await srv.onMessage(JSON.stringify({ type: 'buzz', choice: 'zz' }), conn); // round 4 -> reveal (boundary)
  srv.room = { ...srv.room, pickedBy: ['alice'] }; // pretend the only seat already picked
  await srv.onMessage(JSON.stringify({ type: 'next' }), conn);
  assert.notEqual(srv.room.phase, 'reveal', 'the room did not freeze at the boundary');
  assert.equal(srv.room.phase, 'question', 'it advanced to the next round');
  assert.equal(srv.room.roundIndex, BLOCK_ROUNDS);
});

test('draft: the last block ends in the final board, no pick', async () => {
  const { srv, conn } = await startSoloDraft();
  await playBlock(srv, conn);                 // block 1 -> picking
  const hand = conn.last('picking').hand;
  await srv.onMessage(JSON.stringify({ type: 'pick', modeId: hand[0] }), conn); // deal block 2
  await playBlock(srv, conn);                 // block 2 (the last) -> final
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
  // Play block 1: every present seat buzzes, then the host advances.
  for (let i = 0; i < BLOCK_ROUNDS; i++) {
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
      assert.ok(Array.isArray(p.hand) && p.hand.length === 5, 'the picker gets the hand');
    } else {
      assert.equal(p.youPick, false, `${id} is a watcher -> youPick false`);
      assert.equal(p.hand, undefined, 'a watcher never receives the hand');
    }
  }
});
