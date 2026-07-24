import { test } from 'node:test';
import assert from 'node:assert/strict';
import PartyGameServer from './partyGameServer.js';
import { roundCountFor, HAND_SIZE, usedIdForMode } from '../flags/partyDraft.js';
import { ROUND_QUESTIONS } from '../flags/partyPlan.js';

/**
 * The party game server is otherwise the thin shell over the tested reducers
 * (`flags/partyRoom.js`) and draft helpers (`flags/partyDraft.js`); these tests
 * pin the one piece that lives only here — the **draft routing**: dealing the
 * first round, opening a pick at a round boundary, and turning a pick (or a
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
  await srv.onMessage(JSON.stringify({ type: 'start' }), conn);
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
  assert.equal(srv.room.targetRounds, roundCountFor(1)); // solo reads the 2-seat column
  assert.equal(srv.room.totalQuestions, roundCountFor(1) * ROUND_QUESTIONS);
  const q = conn.last('question');
  assert.equal(q.questionId, 'flagPick', 'round 1 is Flags');
  assert.equal(q.answer, undefined, 'the answer never rides the broadcast');
});

test('draft start: the host armed firstPick veil reaches the first round', async () => {
  // applyStart deals round 0's question directly rather than routing it through
  // applyPick, so its veil comes in through applyStart's tricky argument rather
  // than a segment the picker armed. The question broadcast carries room.tricky,
  // so an armed first-round veil shows tricky:true.
  const conn = mockConn('a');
  const srv = new PartyGameServer(mockParty([conn]));
  await srv.onStart();
  await srv.onConnect(conn, ctxFor('alice'));
  await srv.onMessage(JSON.stringify({ type: 'setFirstPick', firstPick: 'flags-all', veil: true }), conn);
  await srv.onMessage(JSON.stringify({ type: 'start' }), conn);
  assert.equal(srv.room.tricky, true, 'the first round is veiled');
  assert.equal(conn.last('question').tricky, true, 'and the tiles know it');
});

test('draft start: an armed firstPick veil applies to spot-the-flag too', async () => {
  // The whole point of the change: spot-flag is now veilable, so a host who
  // opens on it and arms the veil gets a veiled firstPick rather than the veil
  // being silently dropped (canVeilMode used to refuse it).
  const conn = mockConn('a');
  const srv = new PartyGameServer(mockParty([conn]));
  await srv.onStart();
  await srv.onConnect(conn, ctxFor('alice'));
  await srv.onMessage(JSON.stringify({ type: 'setFirstPick', firstPick: 'spot-flag', veil: true }), conn);
  await srv.onMessage(JSON.stringify({ type: 'start' }), conn);
  assert.equal(conn.last('question').questionId, 'spotFlag', 'opened on spot-the-flag');
  assert.equal(srv.room.tricky, true, 'and it is veiled');
});

test('draft start: no firstPick veil leaves the first round clear', async () => {
  const { srv, conn } = await startSoloDraft();
  assert.equal(srv.room.tricky, false);
  assert.equal(conn.last('question').tricky, false);
});

test('draft start: the host length choice sets the round count', async () => {
  const a = mockConn('a'), b = mockConn('b');
  const srv = new PartyGameServer(mockParty([a, b]));
  await srv.onStart();
  await srv.onConnect(a, ctxFor('alice', 'create', 'Alice'));
  await srv.onConnect(b, ctxFor('bob', 'join', 'Bob'));
  await srv.onMessage(JSON.stringify({ type: 'start', length: 'long' }), a);
  // Two seats, long: the table's 2-seat column.
  assert.equal(srv.room.targetRounds, 11);
  assert.equal(srv.room.totalQuestions, 11 * ROUND_QUESTIONS);
});

test('draft start: a length outside the offered set falls back to medium', async () => {
  // `2` and `4` are what a client still on the retired picks-per-player build
  // would send; they must not be read as a length.
  for (const length of [0, 2, 4, 99, 'huge', '', null, undefined]) {
    const conn = mockConn('a');
    const srv = new PartyGameServer(mockParty([conn]));
    await srv.onStart();
    await srv.onConnect(conn, ctxFor('alice'));
    await srv.onMessage(JSON.stringify({ type: 'start', length }), conn);
    assert.equal(srv.room.targetRounds, roundCountFor(1, 'medium'), `length=${length}`);
  }
});

test('setLength: the host sets it and everyone is told, before anything starts', async () => {
  const a = mockConn('a'), b = mockConn('b');
  const srv = new PartyGameServer(mockParty([a, b]));
  await srv.onStart();
  await srv.onConnect(a, ctxFor('alice', 'create', 'Alice'));
  await srv.onConnect(b, ctxFor('bob', 'join', 'Bob'));

  await srv.onMessage(JSON.stringify({ type: 'setLength', length: 'long' }), a);
  assert.equal(srv.room.length, 'long');
  assert.equal(b.last('settings').length, 'long', 'the guest is told — that is the whole point');
  assert.equal(a.last('settings').length, 'long', 'and so is the host');

  // ...and the game it starts is the one everybody was looking at.
  await srv.onMessage(JSON.stringify({ type: 'start' }), a);
  assert.equal(srv.room.targetRounds, roundCountFor(2, 'long'));
});

test('setLength: a guest cannot change what the room is playing', async () => {
  const a = mockConn('a'), b = mockConn('b');
  const srv = new PartyGameServer(mockParty([a, b]));
  await srv.onStart();
  await srv.onConnect(a, ctxFor('alice', 'create', 'Alice'));
  await srv.onConnect(b, ctxFor('bob', 'join', 'Bob'));
  await srv.onMessage(JSON.stringify({ type: 'setLength', length: 'short' }), a);
  await srv.onMessage(JSON.stringify({ type: 'setLength', length: 'long' }), b);
  assert.equal(srv.room.length, 'short', "the guest's attempt changed nothing");
});

// Deploy skew, both directions. PartyKit and the SWA site ship on separate
// workflows, so each build has to survive meeting the other one.
test('deploy skew: a client too old to send setLength still gets the length it picked', async () => {
  // Nothing ever calls setLength, so the room's length stays null and the start
  // message decides — exactly the pre-existing protocol.
  const conn = mockConn('a');
  const srv = new PartyGameServer(mockParty([conn]));
  await srv.onStart();
  await srv.onConnect(conn, ctxFor('alice'));
  await srv.onMessage(JSON.stringify({ type: 'start', length: 'long' }), conn);
  assert.equal(srv.room.targetRounds, roundCountFor(1, 'long'));
});

test('deploy skew: once a client has claimed the room, the room wins', async () => {
  // A modern host always claims the room on entering the lobby, so a stale tab
  // re-sending an old start payload cannot resize the game out from under the
  // length every guest is looking at.
  const conn = mockConn('a');
  const srv = new PartyGameServer(mockParty([conn]));
  await srv.onStart();
  await srv.onConnect(conn, ctxFor('alice'));
  await srv.onMessage(JSON.stringify({ type: 'setLength', length: 'short' }), conn);
  await srv.onMessage(JSON.stringify({ type: 'start', length: 'long' }), conn);
  assert.equal(srv.room.targetRounds, roundCountFor(1, 'short'), 'the room, not the message');
});

test('draft start: tricky mode is forced off even if a stale client sends it', async () => {
  // Tricky is a Custom-setup option; the draft door never showed the toggle, so a
  // device that once enabled it in Custom used to veil every later draft game.
  const conn = mockConn('a');
  const srv = new PartyGameServer(mockParty([conn]));
  await srv.onStart();
  await srv.onConnect(conn, ctxFor('alice'));
  await srv.onMessage(JSON.stringify({ type: 'start', tricky: true }), conn);
  assert.equal(srv.room.tricky, false);
  assert.equal(conn.last('question').tricky, false, 'and clients are told not to veil');
});

// The no-repeat sets are the server's memory of what this show has already used:
// `usedCodes` stops a country being dealt twice, `usedModes` stops a mode being
// re-offered in a later draft hand. A `start` resets both, which is right at the
// top of a game -- but the reset ran BEFORE applyStart decided whether the start
// was allowed, so anyone who could send the message could wipe them, mid-game,
// without starting anything. The room correctly refused (wrong phase, wrong
// sender) and play continued on an emptied memory.
test('a non-host start mid-game leaves the no-repeat sets alone', async () => {
  const a = mockConn('a'), b = mockConn('b');
  const srv = new PartyGameServer(mockParty([a, b]));
  await srv.onStart();
  await srv.onConnect(a, ctxFor('alice', 'create', 'Alice'));
  await srv.onConnect(b, ctxFor('bob', 'join', 'Bob'));
  await srv.onMessage(JSON.stringify({ type: 'start', length: 'short' }), a);
  await srv.onMessage(JSON.stringify({ type: 'buzz', choice: 'zz' }), a);
  await srv.onMessage(JSON.stringify({ type: 'next' }), a);

  const codes = new Set(srv.usedCodes);
  const modes = new Set(srv.usedModes);
  assert.ok(codes.size > 0, 'the game has dealt something to remember');
  assert.ok(modes.size > 0, 'and has a first-round mode on the board');
  const questionIndex = srv.room.questionIndex;

  await srv.onMessage(JSON.stringify({ type: 'start', length: 'long' }), b);

  assert.equal(srv.room.questionIndex, questionIndex, 'the guest did not restart the game');
  assert.deepEqual(srv.usedCodes, codes, 'and did not clear the dealt-country memory');
  assert.deepEqual(srv.usedModes, modes, 'nor the played-mode memory');
});

// Same guard, the other way in: the host is allowed to start, but only from the
// lobby. A duplicate Start from an already-playing host must not reset either.
test('a second start from the host mid-game leaves the no-repeat sets alone', async () => {
  const { srv, conn } = await startSoloDraft();
  await srv.onMessage(JSON.stringify({ type: 'buzz', choice: 'zz' }), conn);
  await srv.onMessage(JSON.stringify({ type: 'next' }), conn);
  const codes = new Set(srv.usedCodes);

  await srv.onMessage(JSON.stringify({ type: 'start', length: 'long' }), conn);

  assert.deepEqual(srv.usedCodes, codes, 'a mid-game restart is refused, memory intact');
});

test('draft: a round boundary opens a pick with a hand that excludes the played mode', async () => {
  const { srv, conn } = await startSoloDraft();
  await playBlock(srv, conn); // 5 questions of Flags, then next -> picking
  assert.equal(srv.room.phase, 'picking');
  const picking = conn.last('picking');
  assert.ok(picking, 'a picking broadcast was sent');
  assert.equal(picking.picker, 'alice', 'the lone seat is the picker');
  assert.equal(picking.hand.length, HAND_SIZE);
  assert.ok(picking.hand.includes('flags-all'), 'Flags is offered again — it is exempt from no-repeat');
  assert.ok(picking.hand.includes('flags-weird'), 'so is Weird flags');
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

test('draft: an invalid pick (unknown / already-played one-shot mode) is ignored', async () => {
  // 3 picks each, so there is still a pick pending after outlines is spent.
  const conn = mockConn('a');
  const srv = new PartyGameServer(mockParty([conn]));
  await srv.onStart();
  await srv.onConnect(conn, ctxFor('alice'));
  await srv.onMessage(JSON.stringify({ type: 'start', length: 'long' }), conn);
  await playBlock(srv, conn);
  // Take outlines, play it out, and it is spent for the rest of the game.
  await srv.onMessage(JSON.stringify({ type: 'pick', modeId: 'map-outlines' }), conn);
  await playBlock(srv, conn);
  const before = conn.sent.length;
  await srv.onMessage(JSON.stringify({ type: 'pick', modeId: 'map-outlines' }), conn); // already played
  await srv.onMessage(JSON.stringify({ type: 'pick', modeId: 'not-a-mode' }), conn);
  assert.equal(srv.room.phase, 'picking', 'still waiting for a valid pick');
  assert.equal(conn.sent.length, before, 'nothing broadcast for an invalid pick');
});

test('draft: Flags can actually be picked again and deals a real round', async () => {
  // The exemption has to survive the server's own validation, not just the hand.
  const { srv, conn } = await startSoloDraft();
  await playBlock(srv, conn);
  await srv.onMessage(JSON.stringify({ type: 'pick', modeId: 'flags-all' }), conn);
  assert.equal(srv.room.phase, 'question', 'the repeat pick was accepted');
  assert.equal(conn.last('question').questionId, 'flagPick');
  assert.equal(conn.last('question').draftPick.modeId, 'flags-all');
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

// ---- the Decider ----

/** Two seats, one pick each: round 1, alice's round, bob's round, the Decider. */
async function startDuoDraft() {
  const a = mockConn('a'), b = mockConn('b');
  const srv = new PartyGameServer(mockParty([a, b]));
  await srv.onStart();
  await srv.onConnect(a, ctxFor('alice', 'create', 'Alice'));
  await srv.onConnect(b, ctxFor('bob', 'join', 'Bob'));
  await srv.onMessage(JSON.stringify({ type: 'start', length: 'short' }), a);
  return { srv, a, b };
}

/** Play a round where `winner` answers correctly and the other seat does not, so
 *  the standings actually move. Buzzing the real answer needs it, so read it off
 *  the room (the server holds it; it never leaves in a broadcast). */
async function playRoundWon(srv, conns, winner) {
  for (let i = 0; i < ROUND_QUESTIONS; i++) {
    const answer = srv.room.question.answer;
    for (const [pid, conn] of conns) {
      await srv.onMessage(JSON.stringify({ type: 'buzz', choice: pid === winner ? answer : 'zz' }), conn);
    }
    if (srv.room.phase === 'reveal') await srv.onMessage(JSON.stringify({ type: 'next' }), conns[0][1]);
  }
}

test('the Decider: the closing pick goes to last place, not to the rotation', async () => {
  // The finding this phase exists for. Alice wins every round, so the rotation's
  // tie-break pushes her to the back and would hand her the double-points round.
  const { srv, a, b } = await startDuoDraft();
  const conns = [['alice', a], ['bob', b]];

  await playRoundWon(srv, conns, 'alice');          // firstPick -> pick 1
  assert.equal(srv.room.phase, 'picking');
  assert.equal(srv.room.decider, false, 'a rotation pick, not the Decider');
  assert.equal(srv.room.picker, 'bob', 'bob is last, and has not picked');
  await srv.onMessage(JSON.stringify({ type: 'pick', modeId: 'map-outlines' }), b);

  await playRoundWon(srv, conns, 'alice');          // bob's round -> pick 2
  // bob again, and that is the first pick counting. alice picked it in the lobby, so
  // after bob's first pick the two are level at one each -- and a tie goes to the
  // lowest-ranked, which is bob, who is losing every round. He draws level-plus-one
  // before alice picks again, which is exactly the catch-up the seeding is for.
  // (Before the host chose round 1, alice held zero picks here and went next.)
  assert.equal(srv.room.picker, 'bob', 'tied on picks, so the lower-ranked seat goes');
  await srv.onMessage(JSON.stringify({ type: 'pick', modeId: 'flags-weird' }), b);

  // ...and however many rotation picks the length asks for after that, the last
  // boundary is the Decider's.
  for (let guard = 0; guard < 40 && !srv.room.decider; guard++) {
    await playRoundWon(srv, conns, 'alice');
    if (srv.room.decider) break;
    await srv.onMessage(JSON.stringify({ type: 'pick', modeId: 'flags-all' }), srv.room.picker === 'alice' ? a : b);
  }
  assert.equal(srv.room.phase, 'picking');
  assert.equal(srv.room.decider, true, 'the last boundary opens the Decider');
  assert.equal(srv.room.picker, 'bob', 'last place picks it, though the rotation is spent');
  assert.equal(b.last('picking').decider, true, 'and the picker is told what they are choosing');
  assert.equal(a.last('picking').decider, true, 'as is the watcher');
});

test('the Decider: the picks are spent within one of each other, and the Decider spends no slot', async () => {
  const { srv, b } = await playToDeciderPick();
  const before = [...srv.room.pickedBy];
  // This used to assert an exact tie: LENGTH_ROUNDS was built so `rounds - 2`
  // divided evenly by the seat count. The firstPick is a pick now -- the host chose
  // it in the lobby -- so the total is `rounds - 1`, which is odd at two seats and
  // cannot tie. Within one is the strongest true statement, and it is what
  // `pickShareFor` reports to the lobby as `extra`.
  const alice = before.filter((p) => p === 'alice').length;
  const bob = before.filter((p) => p === 'bob').length;
  assert.ok(Math.abs(alice - bob) <= 1, `picks within one: ${JSON.stringify(before)}`);
  assert.equal(alice + bob, srv.room.targetRounds - 1,
    'every round but the Decider -- the first pick counts now, as the host pick');

  await srv.onMessage(JSON.stringify({ type: 'pick', modeId: 'superlative-coffee' }), b);
  assert.deepEqual(srv.room.pickedBy, before, 'the Decider spent no rotation slot');
});

test('the Decider: it is the last round, and playing it out ends the game', async () => {
  const { srv, a, b } = await playToDeciderPick();
  await srv.onMessage(JSON.stringify({ type: 'pick', modeId: 'superlative-coffee' }), b);

  assert.equal(srv.room.questionIndex, finalRoundStart(srv), 'the Decider is the last round');
  await srv.onMessage(JSON.stringify({ type: 'buzz', choice: srv.room.question.answer }), b);
  await srv.onMessage(JSON.stringify({ type: 'buzz', choice: 'zz' }), a);

  // ...and playing it out ends the show rather than opening another pick.
  for (let i = 0; i < ROUND_QUESTIONS; i++) {
    if (srv.room.phase === 'reveal') await srv.onMessage(JSON.stringify({ type: 'next' }), a);
    if (srv.room.phase !== 'question') break;
    await srv.onMessage(JSON.stringify({ type: 'buzz', choice: 'zz' }), a);
    await srv.onMessage(JSON.stringify({ type: 'buzz', choice: 'zz' }), b);
  }
  await srv.onMessage(JSON.stringify({ type: 'next' }), a);
  assert.equal(srv.room.phase, 'final', 'the Decider is the last round of the game');
});

/** Play a duo game up to the moment the Decider pick opens. `winner` takes every
 *  round, so the standings are unambiguous and last place is the other seat.
 *
 *  Loops to the Decider rather than counting rounds: how many rotation picks a
 *  duo game has is a property of the length table, and these tests are about the
 *  Decider's rules, not about that number. Every rotation pick takes `flags-all`,
 *  which is exempt from the no-repeat rule and so is always a legal pick however
 *  many the length asks for. */
async function playToDeciderPick(winner = 'alice') {
  const { srv, a, b } = await startDuoDraft();
  const conns = [['alice', a], ['bob', b]];
  for (let guard = 0; guard < 40 && !srv.room.decider; guard++) {
    await playRoundWon(srv, conns, winner);
    if (srv.room.decider) break;
    await srv.onMessage(JSON.stringify({ type: 'pick', modeId: 'flags-all' }), srv.room.picker === 'alice' ? a : b);
  }
  assert.equal(srv.room.decider, true, 'the game reached its Decider');
  return { srv, a, b, conns };
}

/** The 0-based question index the final round starts at. */
const finalRoundStart = (srv) => (srv.room.targetRounds - 1) * ROUND_QUESTIONS;

test('the Decider: a forced pick still spends no rotation slot', async () => {
  // The anti-stall path routes through `applyPick` like a real pick, so it
  // inherits the Decider's rules for free — but "for free" is exactly the kind of
  // thing that stops being true silently, so it is pinned rather than reasoned.
  const { srv, a, b } = await playToDeciderPick();
  assert.equal(srv.room.decider, true);
  const before = [...srv.room.pickedBy];

  await srv.onMessage(JSON.stringify({ type: 'forcePick' }), a); // host's clock ran out
  assert.equal(srv.room.phase, 'question', 'the closing round was dealt on timeout');
  assert.deepEqual(srv.room.pickedBy, before, 'a forced Decider spends no rotation slot either');
  assert.equal(srv.room.decider, false, 'and the flag is cleared');
  assert.equal(srv.room.questionIndex, finalRoundStart(srv), 'it is still the last round');
  assert.equal(a.last('question').draftPick.picker, 'bob', 'attributed to the seat that timed out');

  // Both seats must buzz before the reveal fires, or `last('reveal')` is still
  // the PREVIOUS round's, and this would read the wrong beat.
  const answer = srv.room.question.answer;
  await srv.onMessage(JSON.stringify({ type: 'buzz', choice: answer }), a);
  await srv.onMessage(JSON.stringify({ type: 'buzz', choice: 'zz' }), b);
  const reveal = a.last('reveal');
  assert.equal(reveal.questionIndex, finalRoundStart(srv), 'reading the closing round\'s own reveal');
});

// A seat outlives its socket (sticky score, for reconnect), so a player who quits
// stops scoring and sinks toward last place — which is precisely who both picker
// rules aim at, the Decider hardest and at the worst possible moment. Left alone,
// the room waits on someone who is gone until the host's 45 s anti-stall fires.
test('the Decider: a picker who leaves mid-pick hands the turn on, no waiting', async () => {
  const { srv, a, b } = await playToDeciderPick();
  assert.equal(srv.room.picker, 'bob');

  await srv.onClose(b); // bob quits as the closing act opens

  assert.equal(srv.room.present.has('bob'), false, 'presence dropped');
  assert.ok(srv.room.seats.has('bob'), 'but the seat and its score stay, for reconnect');
  assert.equal(srv.room.phase, 'picking', 'still the closing pick');
  assert.equal(srv.room.decider, true, 'still the Decider — only the seat changed');
  assert.equal(srv.room.picker, 'alice', 'handed to whoever is still here');

  const picking = a.last('picking');
  assert.equal(picking.youPick, true, 'and she is told it is hers, with a hand');
  assert.ok(Array.isArray(picking.hand) && picking.hand.length > 0);
  assert.equal(picking.decider, true);
});

test('a picker who leaves mid-ROTATION-pick is replaced the same way', async () => {
  // The fix is not Decider-specific: the rotation had the identical stall, and
  // both go through one picker-selection method so they cannot drift apart.
  const { srv, a, b } = await startDuoDraft();
  await playRoundWon(srv, [['alice', a], ['bob', b]], 'alice');
  assert.equal(srv.room.phase, 'picking');
  assert.equal(srv.room.decider, false, 'an ordinary rotation pick');
  assert.equal(srv.room.picker, 'bob');

  await srv.onClose(b);
  assert.equal(srv.room.picker, 'alice', 'the rotation hands the turn on too');
  assert.equal(a.last('picking').youPick, true);
});

test('an absent seat is never handed a pick in the first place', async () => {
  // The other half: `eligiblePickers` keeps a player who left BEFORE the boundary
  // from being chosen at all, so the re-election path is a backstop rather than
  // the normal route.
  const { srv, a, b } = await startDuoDraft();
  await srv.onClose(b);                    // bob leaves mid-round
  await playRoundWon(srv, [['alice', a]], 'alice');
  assert.equal(srv.room.phase, 'picking');
  assert.equal(srv.room.picker, 'alice', 'the departed seat was skipped, not picked');
});

test('the last player standing still holds the pick — nobody left to hand it to', async () => {
  // Degenerate case: with no eligible replacement, `applyRepick` is a no-op and
  // the turn stays put rather than the room dropping into a null-picker state it
  // has no way out of.
  const { srv, a, b } = await playToDeciderPick();
  assert.equal(srv.room.picker, 'bob');
  await srv.onClose(a);   // the host leaves; bob (the picker) is all that's left
  assert.equal(srv.room.picker, 'bob', 'unchanged — there was no one to promote');
  assert.equal(srv.room.phase, 'picking');
});

test('draft: the last round ends in the final board, no pick', async () => {
  // Play every round the game was sized for; the boundary after the last one is
  // the final board, not another pick.
  const conn = mockConn('a');
  const srv = new PartyGameServer(mockParty([conn]));
  await srv.onStart();
  await srv.onConnect(conn, ctxFor('alice'));
  // `short` rather than a `rounds` field: that field was never read by the
  // server, so this test was silently playing whatever the default sized.
  await srv.onMessage(JSON.stringify({ type: 'start', length: 'short' }), conn);
  await playBlock(srv, conn);                 // round 1 -> picking
  for (let r = 2; r <= srv.room.targetRounds; r++) {
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

  await srv.onMessage(JSON.stringify({ type: 'start' }), a);
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

// ---- hold-to-read: the holders set ----
// `applyHold` is a pure relay and is tested in flags/partyRoom.test.js. The
// LIFECYCLE lives only here, in the shell, and cannot be reached from there:
// which seats are currently holding, when that set is cleared, and — the one
// case no client can ever cover, because its tab is already gone — releasing a
// seat that drops mid-hold. Held time is unbounded, so if that release is ever
// lost the room freezes on a reveal nobody is reading, with nothing to bail it
// out. These pin it.

/** A metric card from the hand actually dealt — the hand is random, so a
 *  hardcoded id is not reliably on offer. Metric rounds are the ones that rank
 *  their options, which is what makes their reveal a chart. */
function metricCardIn(conn) {
  const hand = conn.last('picking').hand;
  const card = hand.find((id) => id.startsWith('superlative-'));
  assert.ok(card, `expected a metric card in the dealt hand: ${hand.join(', ')}`);
  return card;
}

/** Choose a metric round from whichever seat was actually dealt the hand. The
 *  picker is the trailing seat, so in a multi-seat game it is not necessarily
 *  the one driving the test — and the hand is only ever sent to the picker. */
async function pickMetricRound(srv, conns) {
  // Watchers get a `picking` message too — it names who is choosing — but only
  // the picker's carries a hand, so match on the hand rather than the message.
  const picker = conns.find((c) => c.last('picking')?.hand);
  assert.ok(picker, 'expected one seat to have been dealt a hand');
  await srv.onMessage(JSON.stringify({ type: 'pick', modeId: metricCardIn(picker) }), picker);
}

/** Drive a solo draft game to a CHART reveal (a metric round's first question,
 *  answered). Only a reveal carrying `question.ranking` accepts a hold. */
async function atChartReveal() {
  const conn = mockConn('a');
  const srv = new PartyGameServer(mockParty([conn]));
  await srv.onStart();
  await srv.onConnect(conn, ctxFor('alice'));
  await srv.onMessage(JSON.stringify({ type: 'start', length: 'long' }), conn);
  await playBlock(srv, conn);
  await srv.onMessage(JSON.stringify({ type: 'pick', modeId: metricCardIn(conn) }), conn);
  await srv.onMessage(JSON.stringify({ type: 'buzz', choice: 'zz' }), conn);
  assert.equal(srv.room.phase, 'reveal');
  assert.ok(Array.isArray(srv.room.question.ranking) && srv.room.question.ranking.length > 0,
    'expected a ranked (chart) question so the hold is accepted');
  return { srv, conn };
}

test('hold: a press is remembered and a release forgets it', async () => {
  const { srv, conn } = await atChartReveal();
  await srv.onMessage(JSON.stringify({ type: 'hold', on: true }), conn);
  assert.deepEqual([...srv.holders], ['alice'], 'the server knows who to release later');
  assert.deepEqual(conn.last('holding'), { type: 'holding', playerId: 'alice', on: true });
  await srv.onMessage(JSON.stringify({ type: 'hold', on: false }), conn);
  assert.deepEqual([...srv.holders], []);
  assert.equal(conn.last('holding').on, false);
});

test('hold: a rejected hold is not remembered', async () => {
  // The bookkeeping must follow the reducer's verdict, not the message. If a
  // refused hold were recorded, that seat would emit a phantom release on
  // disconnect — telling every client to unfreeze a hold that never existed.
  const { srv, conn } = await startSoloDraft();
  assert.equal(srv.room.phase, 'question', 'not a reveal, so the hold is refused');
  await srv.onMessage(JSON.stringify({ type: 'hold', on: true }), conn);
  assert.deepEqual([...srv.holders], []);
  assert.equal(conn.last('holding'), null, 'and nothing was broadcast');
});

test('hold: a hold on a reveal that draws no chart is refused and not remembered', async () => {
  // The opening Flags round reveals without a ranking. Only a crafted client
  // gets here (the button is never rendered), which is exactly why it is pinned.
  const { srv, conn } = await startSoloDraft();
  await srv.onMessage(JSON.stringify({ type: 'buzz', choice: 'zz' }), conn);
  assert.equal(srv.room.phase, 'reveal');
  assert.ok(!srv.room.question.ranking, 'a flag-pick reveal has no ranking');
  await srv.onMessage(JSON.stringify({ type: 'hold', on: true }), conn);
  assert.deepEqual([...srv.holders], [], 'refused, so nothing to release later');
});

test('hold: dropping mid-hold releases the seat for the whole room', async () => {
  // THE case that justifies the holders set. The holder cannot send its own
  // release — its tab is gone — and held time has no ceiling, so without this
  // broadcast every remaining client stays frozen forever.
  const holder = mockConn('a');
  const watcher = mockConn('b');
  const srv = new PartyGameServer(mockParty([holder, watcher]));
  await srv.onStart();
  await srv.onConnect(holder, ctxFor('alice', 'create', 'Alice'));
  await srv.onConnect(watcher, ctxFor('bob', 'join', 'Bob'));
  await srv.onMessage(JSON.stringify({ type: 'start', length: 'long' }), holder);
  // Both seats have to buzz for the question to resolve — with one still
  // outstanding there is no auto-reveal, and `next` on a live question is a
  // no-op, so a one-sided block would simply never advance the room.
  for (let i = 0; i < ROUND_QUESTIONS; i++) {
    await srv.onMessage(JSON.stringify({ type: 'buzz', choice: 'zz' }), holder);
    await srv.onMessage(JSON.stringify({ type: 'buzz', choice: 'zz' }), watcher);
    await srv.onMessage(JSON.stringify({ type: 'next' }), holder);
  }
  await pickMetricRound(srv, [holder, watcher]);
  await srv.onMessage(JSON.stringify({ type: 'buzz', choice: 'zz' }), holder);
  await srv.onMessage(JSON.stringify({ type: 'buzz', choice: 'zz' }), watcher);
  assert.equal(srv.room.phase, 'reveal');
  await srv.onMessage(JSON.stringify({ type: 'hold', on: true }), holder);
  assert.deepEqual([...srv.holders], ['alice']);

  await srv.onClose(holder);
  const release = watcher.last('holding');
  assert.deepEqual(release, { type: 'holding', playerId: 'alice', on: false },
    'the seats still here are told to unfreeze');
  assert.deepEqual([...srv.holders], [], 'and the seat is forgotten');
});

test('hold: a seat that was not holding produces no release when it drops', async () => {
  const holder = mockConn('a');
  const other = mockConn('b');
  const srv = new PartyGameServer(mockParty([holder, other]));
  await srv.onStart();
  await srv.onConnect(holder, ctxFor('alice', 'create', 'Alice'));
  await srv.onConnect(other, ctxFor('bob', 'join', 'Bob'));
  await srv.onMessage(JSON.stringify({ type: 'start', length: 'long' }), holder);
  await srv.onClose(other);
  assert.equal(holder.last('holding'), null, 'no phantom release for a seat that never held');
});

test('hold: holders are cleared when the phase moves on', async () => {
  // A hold belongs to the reveal it was pressed on. A stale entry surviving into
  // the next question would earn a phantom release the moment that seat later
  // disconnected, unfreezing a clock nobody was holding.
  const { srv, conn } = await atChartReveal();
  await srv.onMessage(JSON.stringify({ type: 'hold', on: true }), conn);
  assert.deepEqual([...srv.holders], ['alice']);
  await srv.onMessage(JSON.stringify({ type: 'next' }), conn);
  assert.notEqual(srv.room.phase, 'reveal', 'the room moved on');
  assert.deepEqual([...srv.holders], [], 'so the hold did not survive with it');
});

// ---- bots (Iteration 17) ----

test('addBot: the host adds a present bot; it takes a seat with its skill', async () => {
  const conn = mockConn('a');
  const srv = new PartyGameServer(mockParty([conn]));
  await srv.onStart();
  await srv.onConnect(conn, ctxFor('alice'));
  await srv.onMessage(JSON.stringify({ type: 'addBot', skill: 'hard' }), conn);
  const roster = conn.last('roster').roster;
  const bot = roster.find((/** @type {any} */ r) => r.bot);
  assert.ok(bot, 'a bot seat appears in the roster');
  assert.equal(bot.skill, 'hard');
  assert.equal(bot.present, true);
  assert.equal(srv.room.seats.size, 2, 'solo host + bot = a two-seat game');
});

test('addBot: an unknown skill is coerced to the default', async () => {
  const conn = mockConn('a');
  const srv = new PartyGameServer(mockParty([conn]));
  await srv.onStart();
  await srv.onConnect(conn, ctxFor('alice'));
  await srv.onMessage(JSON.stringify({ type: 'addBot', skill: 'brutal' }), conn);
  const bot = conn.last('roster').roster.find((/** @type {any} */ r) => r.bot);
  assert.equal(bot.skill, 'medium');
});

test('removeBot: the host removes its bot, back to a lone seat', async () => {
  const conn = mockConn('a');
  const srv = new PartyGameServer(mockParty([conn]));
  await srv.onStart();
  await srv.onConnect(conn, ctxFor('alice'));
  await srv.onMessage(JSON.stringify({ type: 'addBot', skill: 'easy' }), conn);
  const botId = conn.last('roster').roster.find((/** @type {any} */ r) => r.bot).playerId;
  await srv.onMessage(JSON.stringify({ type: 'removeBot', botId }), conn);
  assert.equal(srv.room.seats.size, 1);
  assert.ok(!srv.room.seats.has(botId));
});

test('a bot buzzes on its own once a question is dealt', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const conn = mockConn('a');
  const srv = new PartyGameServer(mockParty([conn]));
  await srv.onStart();
  await srv.onConnect(conn, ctxFor('alice'));
  await srv.onMessage(JSON.stringify({ type: 'addBot', skill: 'hard' }), conn);
  await srv.onMessage(JSON.stringify({ type: 'start' }), conn);
  assert.equal(srv.room.phase, 'question');
  assert.equal(srv.botTimers.length, 1, 'a buzz is scheduled for the bot');
  // Advance past the hard bot's max delay (3s), then let botBuzz's async work settle.
  t.mock.timers.tick(3500);
  await new Promise((r) => setImmediate(r));
  const botBuzz = srv.room.buzzes.find((b) => b.playerId.startsWith('bot:'));
  assert.ok(botBuzz, 'the bot recorded a buzz');
  assert.notEqual(srv.room.phase, 'lobby');
});

test('leaving the question phase cancels a bot buzz that had not fired', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const conn = mockConn('a');
  const srv = new PartyGameServer(mockParty([conn]));
  await srv.onStart();
  await srv.onConnect(conn, ctxFor('alice'));
  await srv.onMessage(JSON.stringify({ type: 'addBot', skill: 'easy' }), conn);
  await srv.onMessage(JSON.stringify({ type: 'start' }), conn);
  assert.equal(srv.botTimers.length, 1);
  // The host force-reveals before the easy bot's 6-9s delay elapses.
  await srv.onMessage(JSON.stringify({ type: 'reveal' }), conn);
  assert.equal(srv.room.phase, 'reveal');
  assert.equal(srv.botTimers.length, 0, 'pending bot buzz was cancelled on leaving the question');
});

// ---- bots: server-integration paths (cleanup PR) ----

/** Flush microtasks so an async bot handler fired by a mock timer runs to completion. */
async function settle() { for (let i = 0; i < 8; i++) await new Promise((r) => setImmediate(r)); }

test('a bot can be the draft picker and starts its own round', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const conn = mockConn('a');
  const srv = new PartyGameServer(mockParty([conn]));
  await srv.onStart();
  await srv.onConnect(conn, ctxFor('alice'));
  await srv.onMessage(JSON.stringify({ type: 'addBot', skill: 'hard' }), conn);
  const botId = conn.last('roster').roster.find((/** @type {any} */ r) => r.bot).playerId;
  await srv.onMessage(JSON.stringify({ type: 'start' }), conn);
  // Play round 1 (the host's Flags round): host buzzes, the bot buzzes on its
  // timer to complete the two-seat question, then next.
  for (let i = 0; i < ROUND_QUESTIONS; i++) {
    await srv.onMessage(JSON.stringify({ type: 'buzz', choice: 'zz' }), conn);
    t.mock.timers.tick(10000); await settle();
    assert.equal(srv.room.phase, 'reveal', `question ${i} revealed after both seats buzzed`);
    await srv.onMessage(JSON.stringify({ type: 'next' }), conn); await settle();
  }
  // The round-1 boundary hands the pick to the bot: the host already picked round 1.
  assert.equal(srv.room.phase, 'picking');
  assert.equal(srv.room.picker, botId, 'the bot holds the pick');
  assert.ok(srv.botPickTimer, 'a bot self-pick is scheduled');
  const planBefore = srv.room.plan.length;
  const usedBefore = new Set(srv.usedModes);
  t.mock.timers.tick(2500); await settle();               // > BOT_PICK_DELAY_MS (2s)
  assert.equal(srv.room.phase, 'question', 'the bot picked and its round started');
  assert.equal(srv.room.plan.length, planBefore + 1, 'the plan grew by the bot round');
  const q = conn.last('question');
  assert.ok(q.draftPick && q.draftPick.picker === botId, 'the round is attributed to the bot');
  // What the bot actually played, recorded through the SAME bookkeeping a human
  // pick uses. Asserting "the set grew" instead was flaky at ~8%: the bot picks a
  // random card from its hand, and `flags-all` is REPEATABLE, so it sits in every
  // hand including the one dealt after round 1 played it. When the bot re-picks
  // it the round is legal, the plan grows, and `usedModes` correctly does not —
  // the family is already in there. Pin the membership, and pin the growth only
  // for the case where growth is actually the right answer.
  const played = usedIdForMode(q.draftPick.modeId);
  assert.ok(srv.usedModes.has(played), `the bot mode ${played} was recorded as used`);
  assert.equal(
    srv.usedModes.size,
    usedBefore.size + (usedBefore.has(played) ? 0 : 1),
    'the played-mode memory grew by exactly the bot round, or not at all on a repeatable re-pick',
  );
  // Fresh-question reschedule at index > 0: the bot's just-dealt round scheduled its buzz.
  assert.equal(srv.botTimers.length, 1, 'the bot re-buzzes on the round it just dealt');
});

test('a bot is restored to present after an eviction (fresh server, same storage)', async () => {
  const conn = mockConn('a');
  const party = mockParty([conn]);
  const srv = new PartyGameServer(party);
  await srv.onStart();
  await srv.onConnect(conn, ctxFor('alice'));
  await srv.onMessage(JSON.stringify({ type: 'addBot', skill: 'hard' }), conn);
  const botId = conn.last('roster').roster.find((/** @type {any} */ r) => r.bot).playerId;
  // Evict: a brand-new server instance over the SAME storage reads the snapshot.
  const srv2 = new PartyGameServer(party);
  await srv2.onStart();
  assert.ok(srv2.room, 'the room was restored from storage');
  assert.ok(srv2.room.present.has(botId), 'the bot is present again with no socket');
  assert.equal(srv2.room.seats.get(botId).skill, 'hard', 'its skill survived the round trip');
});

test('two bots each get a buzz timer; completing the question clears the rest', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const conn = mockConn('a');
  const srv = new PartyGameServer(mockParty([conn]));
  await srv.onStart();
  await srv.onConnect(conn, ctxFor('alice'));
  await srv.onMessage(JSON.stringify({ type: 'addBot', skill: 'hard' }), conn);
  await srv.onMessage(JSON.stringify({ type: 'addBot', skill: 'easy' }), conn);
  await srv.onMessage(JSON.stringify({ type: 'start' }), conn);
  assert.equal(srv.botTimers.length, 2, 'both bots are scheduled');
  await srv.onMessage(JSON.stringify({ type: 'buzz', choice: 'zz' }), conn); // host buzzes too
  t.mock.timers.tick(10000); await settle();
  assert.equal(srv.room.phase, 'reveal', 'all three present seats buzzed → reveal');
  assert.equal(srv.botTimers.length, 0, 'the completing buzz cancelled the sibling timers');
});

test('a bot buzz is resolved through isCorrect and scored on the reveal', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const conn = mockConn('a');
  const srv = new PartyGameServer(mockParty([conn]));
  await srv.onStart();
  await srv.onConnect(conn, ctxFor('alice'));
  await srv.onMessage(JSON.stringify({ type: 'addBot', skill: 'hard' }), conn);
  const botId = conn.last('roster').roster.find((/** @type {any} */ r) => r.bot).playerId;
  await srv.onMessage(JSON.stringify({ type: 'start' }), conn);
  const answer = srv.room.question.answer;
  await srv.onMessage(JSON.stringify({ type: 'buzz', choice: 'zz' }), conn); // host wrong
  t.mock.timers.tick(10000); await settle();
  const botBuzz = srv.room.buzzes.find((b) => b.playerId === botId);
  assert.ok(botBuzz, 'the bot recorded a buzz');
  assert.equal(typeof botBuzz.correct, 'boolean', 'correctness was resolved (not left undefined)');
  assert.equal(botBuzz.correct, botBuzz.choice === answer, 'the correct flag matches the real answer');
  const reveal = conn.last('reveal');
  assert.ok(reveal && reveal.points && botId in reveal.points, 'the reveal scored the bot');
});

test('a bot re-added after a remove keeps a distinct name (no collision)', async () => {
  const conn = mockConn('a');
  const srv = new PartyGameServer(mockParty([conn]));
  await srv.onStart();
  await srv.onConnect(conn, ctxFor('alice'));
  await srv.onMessage(JSON.stringify({ type: 'addBot', skill: 'easy' }), conn);
  await srv.onMessage(JSON.stringify({ type: 'addBot', skill: 'easy' }), conn);
  const first = conn.last('roster').roster.filter((/** @type {any} */ r) => r.bot);
  const roboId = first[0].playerId; // BOT_NAMES[0]
  await srv.onMessage(JSON.stringify({ type: 'removeBot', botId: roboId }), conn);
  await srv.onMessage(JSON.stringify({ type: 'addBot', skill: 'easy' }), conn);
  const names = conn.last('roster').roster.filter((/** @type {any} */ r) => r.bot).map((/** @type {any} */ r) => r.nickname);
  assert.equal(new Set(names).size, names.length, 'names stay distinct across a remove-then-add');
});

test('every question the server deals is stamped with the mode it came from', async (t) => {
  // The stamp the bot's difficulty table keys on. `questionId` cannot carry it:
  // flags-all and flags-weird are the same flagPick module over different pools,
  // and a territory flag is far harder for a person than a sovereign one.
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const conn = mockConn('a');
  const srv = new PartyGameServer(mockParty([conn]));
  await srv.onStart();
  await srv.onConnect(conn, ctxFor('alice'));
  await srv.onMessage(JSON.stringify({ type: 'setFirstPick', firstPick: 'flags-weird' }), conn);
  await srv.onMessage(JSON.stringify({ type: 'start' }), conn);
  assert.equal(srv.room.question.questionId, 'flagPick', 'same question module as flags-all…');
  assert.equal(srv.room.question.modeId, 'flags-weird', '…but the mode says which flags');
});

test("a bot plays the round it drafted a little better than anyone else's", async (t) => {
  // The wiring this pins is one argument: the server passing `roundPicker === pid`
  // into `decideBuzz` as `picked`. A person drafts the category they know, so a
  // seat that picked and then played the round exactly as it plays every other one
  // is the only one for which the pick meant nothing. The bonus maths itself is
  // `flags/partyBot.test.js`.
  //
  // 0.55 sits between Easy's base accuracy (0.5) and its picked accuracy (0.58),
  // so one roll gives two verdicts: a miss on someone else's round, a hit on its
  // own. Mocked after the question is generated, so the draw stays ordinary.
  /** @param {(botId: string) => string | null} pickerFor */
  const correctnessWhenPickerIs = async (pickerFor) => {
    const conn = mockConn('a');
    const srv = new PartyGameServer(mockParty([conn]));
    await srv.onStart();
    await srv.onConnect(conn, ctxFor('alice'));
    await srv.onMessage(JSON.stringify({ type: 'addBot', skill: 'easy' }), conn);
    const botId = conn.last('roster').roster.find((/** @type {any} */ r) => r.bot).playerId;
    await srv.onMessage(JSON.stringify({ type: 'start' }), conn);
    t.mock.method(Math, 'random', () => 0.55);
    srv.room.roundPicker = pickerFor(botId);
    srv.scheduleBotBuzzes();
    t.mock.timers.tick(20000); await settle();
    t.mock.restoreAll();
    const buzz = srv.room.buzzes.find((/** @type {any} */ b) => b.playerId === botId);
    assert.ok(buzz, 'the bot buzzed');
    return buzz.correct;
  };
  t.mock.timers.enable({ apis: ['setTimeout'] });
  assert.equal(await correctnessWhenPickerIs(() => null), false, "not its round: the roll misses");
  assert.equal(await correctnessWhenPickerIs((botId) => botId), true, 'its own round: the same roll lands');
});

test('a veiled round delays the bot too — the veil is not a handicap on humans alone', async (t) => {
  // The wiring this pins is one argument: the server passing `room.tricky` into
  // `decideBuzz`. Without it a Hard bot buzzed at 1-3 s against tiles that are not
  // fully clear until 16 s, so no human could win the speed bonus on a veiled
  // round at any difficulty. The delay maths itself is `flags/partyBot.test.js`.
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const conn = mockConn('a');
  const srv = new PartyGameServer(mockParty([conn]));
  await srv.onStart();
  await srv.onConnect(conn, ctxFor('alice'));
  await srv.onMessage(JSON.stringify({ type: 'setFirstPick', firstPick: 'flags-all', veil: true }), conn);
  await srv.onMessage(JSON.stringify({ type: 'addBot', skill: 'hard' }), conn);
  await srv.onMessage(JSON.stringify({ type: 'start' }), conn);
  assert.equal(srv.room.tricky, true, 'the round really is veiled');

  // 4 s in — comfortably past an unveiled Hard bot's 1-3 s window, and the tiles
  // are barely a quarter clear. The bot must still be waiting.
  t.mock.timers.tick(4000); await settle();
  assert.equal(srv.room.buzzes.length, 0, 'the bot has not buzzed while the tiles are still covered');
  assert.equal(srv.room.phase, 'question', 'so the question is still open');

  // By the ceiling it has answered, whatever it rolled.
  t.mock.timers.tick(14000); await settle();
  assert.equal(srv.room.buzzes.length, 1, 'the bot buzzed before the clock ran out');
});
