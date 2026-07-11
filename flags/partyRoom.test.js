import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createRoom,
  applyHello,
  applyStart,
  applyBuzz,
  applyForceReveal,
  applyNext,
  applyPlayAgain,
  applyDisconnect,
  serializeRoom,
  deserializeRoom,
  DEFAULT_ROUNDS,
} from './partyRoom.js';
import { CORRECT_POINTS } from './partyScore.js';

/** @param {string} answer @returns {{prompt:string,options:string[],answer:string}} */
function q(answer, options = ['jp', 'kr', 'cn', 'th']) {
  return { prompt: answer, options, answer };
}

/**
 * Find the first broadcast of a given message type.
 * @param {{ broadcasts: Array<{ to: string, message: any }> }} result
 * @param {string} type
 * @returns {any}
 */
function msg(result, type) {
  const b = result.broadcasts.find((x) => x.message.type === type);
  return b ? b.message : null;
}

/** Seat two players and start the show. Returns the room mid-question 0. */
function startedTwoPlayer(question = q('jp')) {
  let room = createRoom(3);
  room = applyHello(room, 'alice', 'Alice').room;
  room = applyHello(room, 'bob', 'Bob').room;
  return applyStart(room, 'alice', question).room;
}

// ---- createRoom ----

test('createRoom: empty lobby, no host, default rounds', () => {
  const room = createRoom();
  assert.equal(room.phase, 'lobby');
  assert.equal(room.hostId, null);
  assert.equal(room.seats.size, 0);
  assert.equal(room.totalRounds, DEFAULT_ROUNDS);
});

// ---- applyHello ----

test('applyHello: first player becomes host, second is a plain seat', () => {
  let r = applyHello(createRoom(), 'alice', 'Alice');
  assert.equal(r.room.hostId, 'alice');
  const w = msg(r, 'welcome');
  assert.equal(w.isHost, true);
  assert.equal(w.you, 'alice');

  r = applyHello(r.room, 'bob', 'Bob');
  assert.equal(r.room.hostId, 'alice', 'host stays the first player');
  assert.equal(r.room.seats.size, 2);
  // Bob's welcome says not-host; Alice gets a roster update.
  assert.equal(msg(r, 'welcome').isHost, false);
  const roster = r.broadcasts.find((b) => b.to === 'alice');
  assert.ok(roster, 'existing player is notified');
});

test('applyHello: reconnect keeps seat, host, and score; is not rejected mid-game', () => {
  let room = startedTwoPlayer();
  room = applyBuzz(room, 'alice', 'jp', true).room; // Alice scores
  const before = room.seats.get('alice')?.score;
  const r = applyHello(room, 'alice', 'Alice');
  assert.equal(r.rejectConnection, undefined);
  assert.equal(r.room.seats.get('alice')?.score, before, 'score survives reconnect');
  assert.equal(msg(r, 'welcome').isHost, true);
});

test('applyHello: a new player cannot join once the game has started', () => {
  const room = startedTwoPlayer();
  const r = applyHello(room, 'carol', 'Carol');
  assert.equal(r.rejectConnection, true);
  assert.equal(msg(r, 'rejected').reason, 'in-progress');
  assert.equal(r.room.seats.has('carol'), false);
});

// ---- applyStart ----

test('applyStart: host starts from lobby, question broadcast has no answer', () => {
  let room = createRoom(3);
  room = applyHello(room, 'alice', 'Alice').room;
  const r = applyStart(room, 'alice', q('jp'));
  assert.equal(r.room.phase, 'question');
  const m = msg(r, 'question');
  assert.equal(m.prompt, 'jp');
  assert.deepEqual(m.options, ['jp', 'kr', 'cn', 'th']);
  assert.equal(m.answer, undefined, 'answer is withheld from the broadcast');
});

test('applyStart: non-host cannot start; empty lobby cannot start', () => {
  let room = createRoom(3);
  room = applyHello(room, 'alice', 'Alice').room;
  room = applyHello(room, 'bob', 'Bob').room;
  assert.equal(applyStart(room, 'bob', q('jp')).broadcasts.length, 0);
  assert.equal(applyStart(createRoom(), 'ghost', q('jp')).broadcasts.length, 0);
});

test('applyStart: the host plan + its round count are stored on the room', () => {
  let room = createRoom(11);
  room = applyHello(room, 'alice', 'Alice').room;
  const plan = [{ poolId: 'sovereign', roundId: 'mapPick', rounds: 2 }];
  const r = applyStart(room, 'alice', q('jp'), plan, 2);
  assert.deepEqual(r.room.plan, plan, 'chosen plan is stored');
  assert.equal(r.room.totalRounds, 2, 'totalRounds follows the plan, not the opening default');
  assert.equal(msg(r, 'question').totalRounds, 2, 'the broadcast carries the new total');
});

test('applyStart: omitting the plan keeps whatever the room opened with', () => {
  const opening = [{ poolId: 'sovereign', roundId: 'flagPick', rounds: 4 }];
  let room = createRoom(4, opening);
  room = applyHello(room, 'alice', 'Alice').room;
  const r = applyStart(room, 'alice', q('jp')); // 3-arg form, no plan
  assert.deepEqual(r.room.plan, opening);
  assert.equal(r.room.totalRounds, 4);
});

test('applyStart: tricky defaults off and rides every question broadcast', () => {
  let room = createRoom(3);
  room = applyHello(room, 'alice', 'Alice').room;
  assert.equal(room.tricky, false, 'a fresh room is not tricky');
  const off = applyStart(room, 'alice', q('jp'));
  assert.equal(off.room.tricky, false, 'omitting tricky keeps it off');
  assert.equal(msg(off, 'question').tricky, false, 'the broadcast carries the flag');
});

test('applyStart: the host tricky choice is stored and broadcast', () => {
  let room = createRoom(3);
  room = applyHello(room, 'alice', 'Alice').room;
  const r = applyStart(room, 'alice', q('jp'), undefined, undefined, true);
  assert.equal(r.room.tricky, true, 'chosen tricky is stored on the room');
  assert.equal(msg(r, 'question').tricky, true, 'the question broadcast carries it so clients veil');
});

test('applyStart: a non-boolean tricky keeps the room value (never coerces mid-room)', () => {
  let room = createRoom(3);
  room = applyHello(room, 'alice', 'Alice').room;
  // @ts-expect-error deliberately wrong type — the reducer ignores non-booleans
  const r = applyStart(room, 'alice', q('jp'), undefined, undefined, 'yes');
  assert.equal(r.room.tricky, false, 'a bad value falls back to the room, not truthiness');
});

test('welcome: a mid-game reconnect learns tricky is on so its tiles veil', () => {
  let room = createRoom(3);
  room = applyHello(room, 'alice', 'Alice').room;
  room = applyStart(room, 'alice', q('jp'), undefined, undefined, true).room;
  const r = applyHello(room, 'alice', 'Alice'); // alice reconnects mid-question
  assert.equal(msg(r, 'welcome').tricky, true, 'the resume snapshot carries the tricky flag');
});

test('applyStart: the host reveal config is stored on the room', () => {
  let room = createRoom(3);
  room = applyHello(room, 'alice', 'Alice').room;
  assert.equal(room.reveal, null, 'a fresh room has no reveal config');
  const reveal = { flag: 0.8, map: 0.4, metric: 0.2 };
  const r = applyStart(room, 'alice', q('jp'), undefined, undefined, true, reveal);
  assert.deepEqual(r.room.reveal, reveal, 'chosen reveal config is stored for later rounds');
  const kept = applyStart(createRoom(3, null), 'x', q('jp')); // omitted keeps null
  assert.equal(kept.room.reveal, null);
});

test('question broadcast: a stamped clearFrac reaches clients so the veil clears on time', () => {
  let room = createRoom(3);
  room = applyHello(room, 'alice', 'Alice').room;
  // The server stamps clearFrac on the question (per the round's category); the
  // room just passes it through to the public question.
  const r = applyStart(room, 'alice', { prompt: 'jp', options: ['jp', 'kr'], answer: 'jp', roundId: 'mapPick', clearFrac: 0.4 }, undefined, undefined, true);
  assert.equal(msg(r, 'question').clearFrac, 0.4, 'the veil timing rides the question');
  assert.equal(msg(r, 'question').answer, undefined, 'the answer is still withheld');
});

// ---- applyBuzz ----

test('applyBuzz: records a buzz and announces the count without leaking the choice', () => {
  const room = startedTwoPlayer();
  const r = applyBuzz(room, 'alice', 'jp', true);
  const m = msg(r, 'buzzed');
  assert.equal(m.playerId, 'alice');
  assert.equal(m.buzzedCount, 1);
  assert.equal(m.seatCount, 2);
  assert.equal(m.choice, undefined, 'the chosen option is not broadcast');
  assert.equal(r.room.phase, 'question', 'still waiting on Bob');
});

test('applyBuzz: a second buzz from the same player is ignored', () => {
  let room = startedTwoPlayer();
  room = applyBuzz(room, 'alice', 'jp', true).room;
  const r = applyBuzz(room, 'alice', 'kr', false);
  assert.equal(r.broadcasts.length, 0);
  assert.equal(r.room.buzzes.length, 1);
});

test('applyBuzz: when all present seats have buzzed, the round reveals and scores', () => {
  let room = startedTwoPlayer();
  room = applyBuzz(room, 'alice', 'jp', true).room; // first correct
  const r = applyBuzz(room, 'bob', 'kr', false); // wrong
  assert.equal(r.room.phase, 'reveal');
  const rev = msg(r, 'reveal');
  assert.equal(rev.answer, 'jp', 'answer revealed');
  assert.deepEqual(rev.picks, { alice: 'jp', bob: 'kr' }, 'everyone\'s pick is shown');
  assert.equal(rev.points.alice, CORRECT_POINTS + 5, 'first correct gets the speed bonus');
  assert.equal(rev.points.bob, 0);
  assert.equal(r.room.seats.get('alice')?.score, CORRECT_POINTS + 5);
  assert.equal(rev.isFinalRound, false);
});

test('applyBuzz: solo play scores base points with no speed bonus', () => {
  let room = createRoom(2);
  room = applyHello(room, 'solo', 'Solo').room;
  room = applyStart(room, 'solo', q('jp')).room;
  const r = applyBuzz(room, 'solo', 'jp', true);
  assert.equal(r.room.phase, 'reveal');
  assert.equal(msg(r, 'reveal').points.solo, CORRECT_POINTS, 'no speed bonus solo');
});

// ---- applyForceReveal ----

test('applyForceReveal: host can end the question early (timeout)', () => {
  let room = startedTwoPlayer();
  room = applyBuzz(room, 'alice', 'jp', true).room; // Bob never answers
  const r = applyForceReveal(room, 'alice');
  assert.equal(r.room.phase, 'reveal');
  // Two seats, so the race bonus applies: Alice is the only (and first) correct.
  assert.equal(msg(r, 'reveal').points.alice, CORRECT_POINTS + 5);
  assert.equal(msg(r, 'reveal').points.bob, undefined, 'Bob never buzzed, no entry');
});

test('applyForceReveal: only the host, only during a question', () => {
  const room = startedTwoPlayer();
  assert.equal(applyForceReveal(room, 'bob').broadcasts.length, 0);
});

// ---- applyNext / final ----

test('applyNext: host advances to the next question', () => {
  let room = startedTwoPlayer(q('jp'));
  room = applyBuzz(room, 'alice', 'jp', true).room;
  room = applyBuzz(room, 'bob', 'jp', true).room; // reveal
  const r = applyNext(room, 'alice', q('fr', ['fr', 'de', 'it', 'es']));
  assert.equal(r.room.phase, 'question');
  assert.equal(r.room.roundIndex, 1);
  assert.equal(msg(r, 'question').prompt, 'fr');
});

test('applyNext: after the last round it goes to the final board', () => {
  let room = createRoom(1); // single-round game
  room = applyHello(room, 'alice', 'Alice').room;
  room = applyHello(room, 'bob', 'Bob').room;
  room = applyStart(room, 'alice', q('jp')).room;
  room = applyBuzz(room, 'alice', 'jp', true).room;
  room = applyBuzz(room, 'bob', 'kr', false).room; // reveal, isFinalRound true
  const r = applyNext(room, 'alice', q('fr'));
  assert.equal(r.room.phase, 'final');
  const f = msg(r, 'final');
  assert.equal(f.scoreboard[0].playerId, 'alice', 'winner sorts first');
  assert.ok(f.scoreboard[0].score > f.scoreboard[1].score);
});

// ---- applyPlayAgain ----

test('applyPlayAgain: host resets scores and returns to the lobby', () => {
  let room = createRoom(1);
  room = applyHello(room, 'alice', 'Alice').room;
  room = applyHello(room, 'bob', 'Bob').room;
  room = applyStart(room, 'alice', q('jp')).room;
  room = applyBuzz(room, 'alice', 'jp', true).room;
  room = applyBuzz(room, 'bob', 'kr', false).room;
  room = applyNext(room, 'alice', q('fr')).room; // final
  const r = applyPlayAgain(room, 'alice');
  assert.equal(r.room.phase, 'lobby');
  assert.equal(r.room.seats.get('alice')?.score, 0);
  assert.equal(r.room.seats.get('bob')?.score, 0);
  assert.equal(r.room.seats.size, 2, 'seats are kept');
  // Must broadcast a 'lobby' message (not just 'roster') so clients move their
  // phase back off the final board.
  assert.equal(msg(r, 'lobby').hostId, 'alice');
  assert.equal(msg(r, 'lobby').roster.length, 2);
});

// ---- applyDisconnect ----

test('applyDisconnect: drops presence, keeps the seat', () => {
  let room = startedTwoPlayer();
  const r = applyDisconnect(room, 'bob');
  assert.equal(r.room.present.has('bob'), false);
  assert.equal(r.room.seats.has('bob'), true, 'seat is sticky for reconnect');
  assert.equal(msg(r, 'roster').roster.find((/** @type {any} */ s) => s.playerId === 'bob').present, false);
});

test('applyDisconnect: reveals a question that was only waiting on the leaver', () => {
  let room = startedTwoPlayer();
  room = applyBuzz(room, 'alice', 'jp', true).room; // Alice buzzed, Bob hasn't
  const r = applyDisconnect(room, 'bob');
  assert.equal(r.room.phase, 'reveal', 'no longer hangs waiting on Bob');
});

// ---- persistence ----

test('serialize/deserialize: round-trips state and resets presence', () => {
  let room = startedTwoPlayer();
  room = applyBuzz(room, 'alice', 'jp', true).room;
  const restored = deserializeRoom(JSON.parse(JSON.stringify(serializeRoom(room))));
  assert.equal(restored.phase, 'question');
  assert.equal(restored.hostId, 'alice');
  assert.equal(restored.seats.get('alice')?.nickname, 'Alice');
  assert.equal(restored.buzzes.length, 1);
  assert.equal(restored.present.size, 0, 'presence is not persisted');
});

test('serialize/deserialize: the chosen plan survives an eviction (so mid-game generation stays correct)', () => {
  const plan = [{ poolId: 'nonSovereign', roundId: 'flagPick', rounds: 2 }, { poolId: 'sovereign', roundId: 'mapPick', rounds: 3 }];
  let room = createRoom(11);
  room = applyHello(room, 'alice', 'Alice').room;
  room = applyStart(room, 'alice', q('jp'), plan, 5).room;
  const restored = deserializeRoom(JSON.parse(JSON.stringify(serializeRoom(room))));
  assert.deepEqual(restored.plan, plan);
  assert.equal(restored.totalRounds, 5);
});

test('serialize/deserialize: tricky survives an eviction and defaults off for legacy snapshots', () => {
  let room = createRoom(3);
  room = applyHello(room, 'alice', 'Alice').room;
  room = applyStart(room, 'alice', q('jp'), undefined, undefined, true).room;
  const restored = deserializeRoom(JSON.parse(JSON.stringify(serializeRoom(room))));
  assert.equal(restored.tricky, true, 'the tricky flag round-trips');
  const legacy = deserializeRoom({ phase: 'lobby' }); // a snapshot from before the flag existed
  assert.equal(legacy.tricky, false, 'a pre-tricky snapshot defaults to off');
});

test('serialize/deserialize: the reveal config survives an eviction (so later rounds stamp the right timing)', () => {
  const reveal = { flag: 0.6, map: 0.4, metric: 0.2 };
  let room = createRoom(3);
  room = applyHello(room, 'alice', 'Alice').room;
  room = applyStart(room, 'alice', q('jp'), undefined, undefined, true, reveal).room;
  const restored = deserializeRoom(JSON.parse(JSON.stringify(serializeRoom(room))));
  assert.deepEqual(restored.reveal, reveal, 'the per-category reveal config round-trips');
  assert.equal(deserializeRoom({ phase: 'lobby' }).reveal, null, 'a pre-reveal snapshot defaults to null');
});
