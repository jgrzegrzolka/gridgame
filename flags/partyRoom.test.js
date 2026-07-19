import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createRoom,
  applyHello,
  applyStart,
  canStart,
  applyBuzz,
  applyForceReveal,
  applyNext,
  applyPlayAgain,
  applyReturnToLobby,
  applyDisconnect,
  pendingPickAfterReveal,
  applyEnterPicking,
  applyRepick,
  applyPick,
  applySetKid,
  serializeRoom,
  deserializeRoom,
  DEFAULT_QUESTIONS,
  MAX_SEATS,
} from './partyRoom.js';
import { CORRECT_POINTS, SPEED_BONUS, SOLE_SURVIVOR_BONUS, CLOSENESS_LADDER } from './partyScore.js';

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

test('createRoom: empty lobby, no host, default questions', () => {
  const room = createRoom();
  assert.equal(room.phase, 'lobby');
  assert.equal(room.hostId, null);
  assert.equal(room.seats.size, 0);
  assert.equal(room.totalQuestions, DEFAULT_QUESTIONS);
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

test('applyHello: a new player is rejected once the room is full', () => {
  let room = createRoom();
  for (let i = 0; i < MAX_SEATS; i++) room = applyHello(room, `p${i}`, `P${i}`).room;
  assert.equal(room.seats.size, MAX_SEATS);
  const r = applyHello(room, 'overflow', 'Overflow');
  assert.equal(r.rejectConnection, true);
  assert.equal(msg(r, 'rejected').reason, 'room-full');
  assert.equal(r.room.seats.has('overflow'), false);
});

test('applyHello: a reconnect is welcomed even when the room is full', () => {
  let room = createRoom();
  for (let i = 0; i < MAX_SEATS; i++) room = applyHello(room, `p${i}`, `P${i}`).room;
  const r = applyHello(room, 'p0', 'P0'); // an existing seat drops and returns
  assert.equal(r.rejectConnection, undefined);
  assert.equal(r.room.seats.size, MAX_SEATS, 'no new seat is added');
  assert.equal(msg(r, 'welcome').you, 'p0');
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

// `canStart` is the guard applyStart applies, exported so a caller with side
// effects (party/partyGameServer.js clears its no-repeat sets and generates
// question 0) can ask BEFORE it commits to them rather than after.
test('canStart: only the host, only from the lobby, only with a seat taken', () => {
  let room = createRoom(3);
  assert.equal(canStart(room, 'alice'), false, 'nobody has said hello yet');
  room = applyHello(room, 'alice', 'Alice').room;
  room = applyHello(room, 'bob', 'Bob').room;
  assert.equal(canStart(room, 'alice'), true, 'the host, in the lobby');
  assert.equal(canStart(room, 'bob'), false, 'a guest never starts');
  assert.equal(canStart(room, 'ghost'), false, 'nor a stranger');

  // The case the applyStart tests above never covered: a game already running.
  const playing = applyStart(room, 'alice', q('jp')).room;
  assert.equal(playing.phase, 'question');
  assert.equal(canStart(playing, 'alice'), false, 'not even the host restarts mid-game');
  assert.equal(canStart(playing, 'bob'), false);
});

test('applyStart: the host plan + its question count are stored on the room', () => {
  let room = createRoom(11);
  room = applyHello(room, 'alice', 'Alice').room;
  const plan = [{ poolId: 'sovereign', questionId: 'mapPick', questions: 2 }];
  const r = applyStart(room, 'alice', q('jp'), plan, 2);
  assert.deepEqual(r.room.plan, plan, 'chosen plan is stored');
  assert.equal(r.room.totalQuestions, 2, 'totalQuestions follows the plan, not the opening default');
  assert.equal(msg(r, 'question').totalQuestions, 2, 'the broadcast carries the new total');
});

test('applyStart: omitting the plan keeps whatever the room opened with', () => {
  const opening = [{ poolId: 'sovereign', questionId: 'flagPick', questions: 4 }];
  let room = createRoom(4, opening);
  room = applyHello(room, 'alice', 'Alice').room;
  const r = applyStart(room, 'alice', q('jp')); // 3-arg form, no plan
  assert.deepEqual(r.room.plan, opening);
  assert.equal(r.room.totalQuestions, 4);
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
  const reveal = { flag: 0.8, map: 0.4, metric: 0.2, name: 0.5 };
  const r = applyStart(room, 'alice', q('jp'), undefined, undefined, true, reveal);
  assert.deepEqual(r.room.reveal, reveal, 'chosen reveal config is stored for later questions');
  const kept = applyStart(createRoom(3, null), 'x', q('jp')); // omitted keeps null
  assert.equal(kept.room.reveal, null);
});

test('question broadcast: a stamped clearFrac reaches clients so the veil clears on time', () => {
  let room = createRoom(3);
  room = applyHello(room, 'alice', 'Alice').room;
  // The server stamps clearFrac on the question (per the question's category); the
  // room just passes it through to the public question.
  const r = applyStart(room, 'alice', { prompt: 'jp', options: ['jp', 'kr'], answer: 'jp', questionId: 'mapPick', clearFrac: 0.4 }, undefined, undefined, true);
  assert.equal(msg(r, 'question').clearFrac, 0.4, 'the veil timing rides the question');
  assert.equal(msg(r, 'question').answer, undefined, 'the answer is still withheld');
});

test('question broadcast: no name timing rides the wire', () => {
  let room = createRoom(3);
  room = applyHello(room, 'alice', 'Alice').room;
  // The world-facts name reveal fires at a fixed beat every client computes from
  // the questionId, so nothing about it is stamped or broadcast. A stale field on
  // the input must not leak into the public question either.
  // The cast is the assertion: `nameFrac` is no longer part of Question, and a
  // client that still sends it must not get it echoed back.
  const stale = /** @type {any} */ ({ prompt: 'most', options: ['br', 'vn'], answer: 'br', questionId: 'superlative-coffee', nameFrac: 0.5 });
  const r = applyStart(room, 'alice', stale, undefined, undefined, false);
  assert.equal(msg(r, 'question').nameFrac, undefined, 'no name timing on the wire');
  assert.equal(msg(r, 'question').questionId, 'superlative-coffee', 'the id the client needs is there');
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

test('applyBuzz: when all present seats have buzzed, the question reveals and scores', () => {
  let room = startedTwoPlayer();
  room = applyBuzz(room, 'alice', 'jp', true).room; // first correct
  const r = applyBuzz(room, 'bob', 'kr', false); // wrong
  assert.equal(r.room.phase, 'reveal');
  const rev = msg(r, 'reveal');
  assert.equal(rev.answer, 'jp', 'answer revealed');
  assert.deepEqual(rev.picks, { alice: 'jp', bob: 'kr' }, 'everyone\'s pick is shown');
  // Alice is the ONLY one correct, so she takes the sole-survivor bonus but no
  // speed: there was no race to win.
  const aliceAward = CORRECT_POINTS + SOLE_SURVIVOR_BONUS;
  assert.equal(rev.points.alice, aliceAward, 'the only one who knew it');
  assert.deepEqual(
    rev.breakdown.alice,
    { base: CORRECT_POINTS, speed: 0, solo: SOLE_SURVIVOR_BONUS, closeness: 0 },
    'the reveal itemises what earned it, so the break need not guess',
  );
  assert.deepEqual(rev.breakdown.bob, { base: 0, speed: 0, solo: 0, closeness: 0 },
    'a flag-pick question ranks nothing, so a wrong pick earns no closeness');
  assert.equal(rev.points.bob, 0);
  assert.equal(r.room.seats.get('alice')?.score, aliceAward);
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
  // A seat that never buzzed still counts as not having got it, so Alice is the
  // sole survivor -- and with nobody else correct there was no race, so no speed.
  assert.equal(msg(r, 'reveal').points.alice, CORRECT_POINTS + SOLE_SURVIVOR_BONUS);
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
  assert.equal(r.room.questionIndex, 1);
  assert.equal(msg(r, 'question').prompt, 'fr');
});

test('applyNext: after the last question it goes to the final board', () => {
  let room = createRoom(1); // single-question game
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

// ---- applyReturnToLobby ----

test('applyReturnToLobby: host aborts a running question back to the lobby', () => {
  // Play question 1 to completion so there's a banked score to wipe (scores land
  // at reveal, not on the buzz), then abort during question 2's live question.
  let room = startedTwoPlayer(q('jp'));
  room = applyBuzz(room, 'alice', 'jp', true).room;
  room = applyBuzz(room, 'bob', 'jp', true).room; // reveal -> scores bank
  room = applyNext(room, 'alice', q('fr', ['fr', 'de', 'it', 'es'])).room; // question 2 question
  assert.equal(room.phase, 'question');
  assert.ok((room.seats.get('alice')?.score ?? 0) > 0, 'precondition: a banked score');
  const r = applyReturnToLobby(room, 'alice');
  assert.equal(r.room.phase, 'lobby');
  assert.equal(r.room.questionIndex, 0, 'question counter rewinds');
  assert.equal(r.room.question, null);
  assert.equal(r.room.seats.get('alice')?.score, 0, 'scores wiped');
  assert.equal(r.room.seats.size, 2, 'seats are kept');
  // Same dedicated 'lobby' message as play-again, so every client leaves the
  // question view for the settings screen.
  assert.equal(msg(r, 'lobby').hostId, 'alice');
  assert.equal(msg(r, 'lobby').roster.length, 2);
});

test('applyReturnToLobby: works from the reveal phase too', () => {
  let room = startedTwoPlayer();
  room = applyBuzz(room, 'alice', 'jp', true).room;
  room = applyBuzz(room, 'bob', 'kr', false).room; // both buzzed -> reveal, scores bank
  assert.equal(room.phase, 'reveal');
  assert.ok((room.seats.get('alice')?.score ?? 0) > 0, 'precondition: a banked score');
  const r = applyReturnToLobby(room, 'alice');
  assert.equal(r.room.phase, 'lobby');
  assert.equal(r.room.seats.get('alice')?.score, 0, 'scores wiped');
  assert.equal(msg(r, 'lobby').hostId, 'alice');
});

test('applyReturnToLobby: only the host can trigger it', () => {
  const room = startedTwoPlayer();
  assert.equal(applyReturnToLobby(room, 'bob').broadcasts.length, 0);
  assert.equal(applyReturnToLobby(room, 'bob').room.phase, 'question', 'no phase change');
});

test('applyReturnToLobby: no-op from the lobby (nothing to abort)', () => {
  let room = createRoom(3);
  room = applyHello(room, 'alice', 'Alice').room; // still in lobby
  assert.equal(applyReturnToLobby(room, 'alice').broadcasts.length, 0);
});

test('applyReturnToLobby: no-op from the final board (use play-again there)', () => {
  let room = createRoom(1);
  room = applyHello(room, 'alice', 'Alice').room;
  room = applyHello(room, 'bob', 'Bob').room;
  room = applyStart(room, 'alice', q('jp')).room;
  room = applyBuzz(room, 'alice', 'jp', true).room;
  room = applyBuzz(room, 'bob', 'kr', false).room;
  room = applyNext(room, 'alice', q('fr')).room; // final
  assert.equal(room.phase, 'final');
  assert.equal(applyReturnToLobby(room, 'alice').broadcasts.length, 0);
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
  const plan = [{ poolId: 'nonSovereign', questionId: 'flagPick', questions: 2 }, { poolId: 'sovereign', questionId: 'mapPick', questions: 3 }];
  let room = createRoom(11);
  room = applyHello(room, 'alice', 'Alice').room;
  room = applyStart(room, 'alice', q('jp'), plan, 5).room;
  const restored = deserializeRoom(JSON.parse(JSON.stringify(serializeRoom(room))));
  assert.deepEqual(restored.plan, plan);
  assert.equal(restored.totalQuestions, 5);
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

test('serialize/deserialize: the reveal config survives an eviction (so later questions stamp the right timing)', () => {
  const reveal = { flag: 0.6, map: 0.4, metric: 0.2, name: null };
  let room = createRoom(3);
  room = applyHello(room, 'alice', 'Alice').room;
  room = applyStart(room, 'alice', q('jp'), undefined, undefined, true, reveal).room;
  const restored = deserializeRoom(JSON.parse(JSON.stringify(serializeRoom(room))));
  assert.deepEqual(restored.reveal, reveal, 'the per-category reveal config round-trips');
  assert.equal(deserializeRoom({ phase: 'lobby' }).reveal, null, 'a pre-reveal snapshot defaults to null');
});

// ---- draft mode (Iteration 9) ----

/** A draft room fast-forwarded to a reveal at a round boundary (questionIndex 4 of a
 *  15-question / 3-round game). Reducers are pure, so setting phase/questionIndex on the
 *  started room is a legitimate way to exercise the pick reducers in isolation. */
function draftRevealAtBoundary(questionIndex = 4, targetRounds = 3) {
  let room = createRoom(15);
  room = applyHello(room, 'alice', 'Alice').room;
  room = applyHello(room, 'bob', 'Bob').room;
  const openingPlan = [{ poolId: 'sovereign', questionId: 'flagPick', questions: 5 }];
  room = applyStart(room, 'alice', q('jp'), openingPlan, 15, false, null, { draft: true, targetRounds }).room;
  return { ...room, phase: /** @type {any} */ ('reveal'), questionIndex };
}

test('applyStart: draft mode records draft + targetRounds and clears pick state', () => {
  let room = createRoom(15);
  room = applyHello(room, 'alice', 'Alice').room;
  room = applyHello(room, 'bob', 'Bob').room;
  const r = applyStart(room, 'alice', q('jp'), [{ poolId: 'sovereign', questionId: 'flagPick', questions: 5 }], 15, false, null, { draft: true, targetRounds: 3 });
  assert.equal(r.room.draft, true);
  assert.equal(r.room.targetRounds, 3);
  assert.equal(r.room.totalQuestions, 15);
  assert.deepEqual(r.room.pickedBy, []);
  assert.equal(r.room.picker, null);
});

test('applyStart: a non-draft game leaves draft off', () => {
  const room = startedTwoPlayer();
  assert.equal(room.draft, false);
  assert.equal(room.targetRounds, 0);
});

test('pendingPickAfterReveal: true at a draft round boundary, not on the last question or in setlist', () => {
  assert.equal(pendingPickAfterReveal(draftRevealAtBoundary(4)), true);   // end of round 1
  assert.equal(pendingPickAfterReveal(draftRevealAtBoundary(9)), true);   // end of round 2
  assert.equal(pendingPickAfterReveal(draftRevealAtBoundary(14)), false); // final question -> final board
  assert.equal(pendingPickAfterReveal(draftRevealAtBoundary(2)), false);  // mid-round
  // setlist (non-draft) never opens a pick
  const setlist = { ...draftRevealAtBoundary(4), draft: false };
  assert.equal(pendingPickAfterReveal(setlist), false);
});

test('applyEnterPicking: reveal -> picking; the picker gets youPick+hand, watchers get neither', () => {
  const room = draftRevealAtBoundary(4); // alice (host) + bob, both present; picker bob
  const hand = ['map-outlines', 'superlative-coffee', 'superlative-beer'];
  const r = applyEnterPicking(room, 'alice', 'bob', hand);
  assert.equal(r.room.phase, 'picking');
  assert.equal(r.room.picker, 'bob');
  assert.deepEqual(r.room.hand, hand);
  // The picker's message is server-authoritative: youPick true + the hand.
  const toBob = /** @type {any} */ (r.broadcasts.find((b) => b.to === 'bob')?.message);
  assert.ok(toBob);
  assert.equal(toBob.youPick, true);
  assert.deepEqual(toBob.hand, hand);
  // A watcher is told youPick false and never gets the hand.
  const toAlice = /** @type {any} */ (r.broadcasts.find((b) => b.to === 'alice')?.message);
  assert.ok(toAlice);
  assert.equal(toAlice.youPick, false);
  assert.equal(toAlice.picker, 'bob');
  assert.equal(toAlice.hand, undefined, 'the hand is not leaked to a watcher');
});

test('applyEnterPicking: ignored for a non-host or with no picker', () => {
  const room = draftRevealAtBoundary(4);
  assert.equal(applyEnterPicking(room, 'bob', 'bob', ['map-outlines']).broadcasts.length, 0);
  assert.equal(applyEnterPicking(room, 'alice', null, ['map-outlines']).broadcasts.length, 0);
});

test('applyPick: the picker chooses -> round appended, advances to its first question', () => {
  let room = draftRevealAtBoundary(4);
  room = applyEnterPicking(room, 'alice', 'bob', ['map-outlines', 'superlative-coffee']).room;
  const segment = { poolId: 'sovereign', questionId: 'mapPick', questions: 5 };
  const r = applyPick(room, 'bob', 'map-outlines', segment, q('pa', ['pa', 'us', 'fr', 'de']));
  assert.equal(r.room.phase, 'question');
  assert.equal(r.room.questionIndex, 5);               // first question of round 2
  assert.deepEqual(r.room.plan?.[r.room.plan.length - 1], segment); // round appended
  assert.deepEqual(r.room.pickedBy, ['bob']);       // no-repeat set updated
  assert.equal(r.room.picker, null);
  assert.equal(r.room.hand, null);
  const m = msg(r, 'question');
  assert.deepEqual(m.draftPick, { picker: 'bob', modeId: 'map-outlines' });
  assert.equal(m.answer, undefined, 'the answer never rides the question broadcast');
});

test('applyPick: only the designated picker can pick, and only in the picking phase', () => {
  let room = draftRevealAtBoundary(4);
  room = applyEnterPicking(room, 'alice', 'bob', ['map-outlines']).room;
  const seg = { poolId: 'sovereign', questionId: 'mapPick', questions: 5 };
  assert.equal(applyPick(room, 'alice', 'map-outlines', seg, q('pa')).broadcasts.length, 0, 'wrong picker ignored');
  const notPicking = draftRevealAtBoundary(4); // still in reveal
  assert.equal(applyPick(notPicking, 'bob', 'map-outlines', seg, q('pa')).broadcasts.length, 0, 'wrong phase ignored');
});

test('the scoreboard keeps join order when scores tie', () => {
  // The ordering guarantee `deciderPickerFor` rests on: it takes the bottom row,
  // so "who picks the round that decides the game" when two players are level is
  // decided entirely by this sort being stable over insertion-ordered seats.
  // Pinned here as well as in partyDraft.test.js because the two halves can break
  // independently — this is the half that could change under a sort swap.
  let room = createRoom(15);
  for (const id of ['early', 'leader', 'late']) room = applyHello(room, id, id).room;
  const seats = new Map(room.seats);
  seats.set('early', { nickname: 'early', score: 10, kid: false });   // joined 1st
  seats.set('leader', { nickname: 'leader', score: 30, kid: false });
  seats.set('late', { nickname: 'late', score: 10, kid: false });     // joined 3rd, same score
  room = { ...room, seats, phase: /** @type {any} */ ('question'), question: q('pa', ['pa', 'us']), buzzes: [] };

  // Read the board the way the server does — off a broadcast, not a private helper.
  const board = msg(applyForceReveal(room, 'early'), 'reveal').scoreboard
    .map((/** @type {any} */ r) => r.playerId);
  assert.deepEqual(board, ['leader', 'early', 'late']);
  assert.equal(board[board.length - 1], 'late', 'a tie for last puts the LAST-JOINED seat on the bottom row');
});

test('applyEnterPicking: the Decider flag rides both the picker and the watcher message', () => {
  // Every seat has to know the closing act has started — the watcher screen names
  // it just as the picker's does, so `decider` is not picker-only like the hand.
  const room = draftRevealAtBoundary(4);
  const r = applyEnterPicking(room, 'alice', 'bob', ['map-outlines'], true);
  assert.equal(r.room.decider, true);
  assert.equal(/** @type {any} */ (r.broadcasts.find((b) => b.to === 'bob')?.message).decider, true);
  assert.equal(/** @type {any} */ (r.broadcasts.find((b) => b.to === 'alice')?.message).decider, true);
  // ...and an ordinary rotation pick says so explicitly rather than omitting it.
  const ordinary = applyEnterPicking(room, 'alice', 'bob', ['map-outlines']);
  assert.equal(ordinary.room.decider, false);
  assert.equal(/** @type {any} */ (ordinary.broadcasts.find((b) => b.to === 'bob')?.message).decider, false);
});

test('applyRepick: the turn moves, the pick keeps its identity', () => {
  let room = draftRevealAtBoundary(4);
  room = applyEnterPicking(room, 'alice', 'bob', ['map-outlines', 'superlative-coffee'], true).room;
  const r = applyRepick(room, 'alice');
  assert.equal(r.room.picker, 'alice');
  assert.equal(r.room.phase, 'picking', 'still picking, not re-entered from reveal');
  assert.equal(r.room.decider, true, 'still the Decider');
  assert.deepEqual(r.room.hand, ['map-outlines', 'superlative-coffee'], 'and the same dealt hand');
  // The new picker is told it is theirs, with the hand; the watcher is not.
  const toAlice = /** @type {any} */ (r.broadcasts.find((b) => b.to === 'alice')?.message);
  assert.equal(toAlice.youPick, true);
  assert.deepEqual(toAlice.hand, ['map-outlines', 'superlative-coffee']);
  assert.equal(toAlice.decider, true);
  const toBob = /** @type {any} */ (r.broadcasts.find((b) => b.to === 'bob')?.message);
  assert.equal(toBob.youPick, false);
  assert.equal(toBob.hand, undefined, 'the hand is not leaked to a watcher');
});

test('applyRepick: refuses outside picking, and no-ops with nobody to promote', () => {
  const reveal = draftRevealAtBoundary(4);
  assert.equal(applyRepick(reveal, 'alice').broadcasts.length, 0, 'not in the picking phase');
  const picking = applyEnterPicking(reveal, 'alice', 'bob', ['map-outlines']).room;
  assert.equal(applyRepick(picking, null).broadcasts.length, 0, 'nobody eligible: hold the turn');
  assert.equal(applyRepick(picking, 'bob').broadcasts.length, 0, 'already the picker: nothing to do');
  assert.equal(applyRepick(picking, null).room.picker, 'bob', 'and the room is left alone');
});

test('applyPick: the Decider does not spend a rotation slot', () => {
  // The promise the Decider was moved outside the rotation to keep: choosing it
  // must not count as one of your `picksPerPlayer` picks.
  let room = draftRevealAtBoundary(4);
  room = applyEnterPicking(room, 'alice', 'bob', ['map-outlines'], true).room;
  const segment = { poolId: 'sovereign', questionId: 'mapPick', questions: 5 };
  const r = applyPick(room, 'bob', 'map-outlines', segment, q('pa', ['pa', 'us', 'fr', 'de']));
  assert.deepEqual(r.room.pickedBy, [], 'the pick history is untouched');
  assert.equal(r.room.decider, false, 'and the flag is cleared with the rest of the pick state');
  // The round itself is dealt exactly like any other pick.
  assert.equal(r.room.phase, 'question');
  assert.deepEqual(r.room.plan?.[r.room.plan.length - 1], segment);
  assert.deepEqual(msg(r, 'question').draftPick, { picker: 'bob', modeId: 'map-outlines' });
});

test('serialize/deserialize: draft state survives an eviction; a legacy snapshot defaults to non-draft', () => {
  let room = draftRevealAtBoundary(4);
  room = applyEnterPicking(room, 'alice', 'bob', ['map-outlines', 'superlative-coffee']).room;
  const restored = deserializeRoom(JSON.parse(JSON.stringify(serializeRoom(room))));
  assert.equal(restored.draft, true);
  assert.equal(restored.targetRounds, 3);
  assert.equal(restored.picker, 'bob');
  assert.deepEqual(restored.hand, ['map-outlines', 'superlative-coffee']);
  assert.equal(restored.decider, false);
  const midDecider = deserializeRoom(JSON.parse(JSON.stringify(serializeRoom(
    applyEnterPicking(draftRevealAtBoundary(4), 'alice', 'bob', ['map-outlines'], true).room,
  ))));
  assert.equal(midDecider.decider, true, 'an eviction mid-Decider-pick still knows what it is');
  const legacy = deserializeRoom({ phase: 'lobby' });
  assert.equal(legacy.decider, false);
  assert.equal(legacy.draft, false);
  assert.equal(legacy.targetRounds, 0);
  assert.deepEqual(legacy.pickedBy, []);
  assert.equal(legacy.picker, null);
});

// ---- final-round double points (final-round polish) ----

test('the final round scores exactly like every other round', () => {
  // The Decider used to pay double. Measured over simulated four-player games it
  // did not do the job it was added for: doubling scales the expected drift and
  // the variance together, so the leader pulled away as fast as the swing grew,
  // and last place won 0.0% of games. The multiplier is gone -- the comeback
  // mechanic is last place CHOOSING the closing round (`deciderPickerFor`). This
  // pins that no round scores differently, so it cannot quietly come back.
  let room = createRoom(10);
  room = applyHello(room, 'alice', 'Alice').room;
  room = applyStart(room, 'alice', q('jp'), [{ poolId: 'sovereign', questionId: 'flagPick', questions: 10 }], 10).room;

  let r = applyBuzz(room, 'alice', 'jp', true);
  assert.equal(msg(r, 'reveal').points.alice, CORRECT_POINTS, 'an ordinary round');

  // Same answer, same seat, but on the closing round.
  const atFinal = { ...r.room, phase: /** @type {any} */ ('question'), questionIndex: 5, question: q('kr'), buzzes: [] };
  r = applyBuzz(atFinal, 'alice', 'kr', true);
  assert.equal(msg(r, 'reveal').points.alice, CORRECT_POINTS, 'and the final round pays the same');
  assert.equal(r.room.seats.get('alice')?.score, CORRECT_POINTS * 2, 'two questions, two plain awards');
  assert.equal('doubled' in msg(r, 'reveal'), false, 'and the wire carries no doubled flag');
});

test('applyPick: a veiled segment turns the veil on for that round only', () => {
  let room = draftRevealAtBoundary(4);
  room = applyEnterPicking(room, 'alice', 'bob', ['map-outlines', 'superlative-coffee']).room;
  const segment = { poolId: 'sovereign', questionId: 'mapPick', questions: 5, veil: true };
  const r = applyPick(room, 'bob', 'map-outlines', segment, q('pa', ['pa', 'us', 'fr', 'de']));
  assert.equal(r.room.tricky, true, 'the picked round veils');
  assert.equal(msg(r, 'question').tricky, true, 'and the clients are told');
  assert.deepEqual(r.room.plan?.[r.room.plan.length - 1], segment, 'veil persists on the segment');
});

// The veil is a property of the picked round, not of the game: whatever the
// previous round did, an unveiled pick must deal a clear round. Without this
// the first veiled pick would leave `tricky` latched on for the rest of the
// draft -- exactly the leak the draft's forced `tricky: false` at start exists
// to prevent, just arriving one round later.
test('applyPick: an unveiled pick clears a veil left on by the previous round', () => {
  let room = draftRevealAtBoundary(4);
  room = { ...room, tricky: true };
  room = applyEnterPicking(room, 'alice', 'bob', ['map-outlines']).room;
  const segment = { poolId: 'sovereign', questionId: 'mapPick', questions: 5 };
  const r = applyPick(room, 'bob', 'map-outlines', segment, q('pa'));
  assert.equal(r.room.tricky, false, 'no veil on the segment -> no veil on the round');
  assert.equal(msg(r, 'question').tricky, false);
});

// ---- ranked (world-facts) questions: closeness ----

/** A world-facts question: same shape, plus the true order and the raw values. */
function rankedQ() {
  return {
    prompt: 'most',
    options: ['jp', 'kr', 'cn', 'th'],
    answer: 'cn',
    ranking: ['cn', 'jp', 'kr', 'th'],
    values: { cn: 1000, jp: 500, kr: 250, th: 100 },
  };
}

test('a ranked question pays a near miss, by how near it was', () => {
  let room = startedTwoPlayer(rankedQ());
  room = applyBuzz(room, 'alice', 'jp', false).room;   // the runner-up
  const r = applyBuzz(room, 'bob', 'th', false);       // dead last
  const rev = msg(r, 'reveal');
  assert.equal(rev.points.alice, CLOSENESS_LADDER[1], 'runner-up scores');
  assert.equal(rev.points.bob, CLOSENESS_LADDER[3], 'last scores nothing');
  assert.equal(rev.breakdown.alice.closeness, CLOSENESS_LADDER[1]);
  assert.equal(rev.breakdown.alice.base, 0, 'a near miss is not a correct answer');
});

test('closeness reaches the seat scores, not just the reveal', () => {
  // scoreQuestion is what the room adds to seats. If closeness only landed in
  // the breakdown, the chart would promise points nobody ever banked.
  let room = startedTwoPlayer(rankedQ());
  room = applyBuzz(room, 'alice', 'jp', false).room;
  const r = applyBuzz(room, 'bob', 'th', false);
  const alice = r.room.seats.get('alice');
  assert.ok(alice, 'alice still has a seat');
  assert.equal(alice.score, CLOSENESS_LADDER[1], 'the near miss is banked');
});

test('the ranking and values ride the reveal, never the question', () => {
  // They name the answer outright. `publicQuestion` is an allow-list, so this
  // pins the property that makes that safe rather than trusting the allow-list
  // to stay one.
  const room = startedTwoPlayer(rankedQ());
  const start = applyStart(createRoomWith2(), 'alice', rankedQ());
  const qMsg = msg(start, 'question');
  assert.ok(qMsg, 'a question is broadcast');
  assert.equal(qMsg.answer, undefined, 'the answer never rides the question');
  assert.equal(qMsg.ranking, undefined, 'nor does the ranking, which names it');
  assert.equal(qMsg.values, undefined, 'nor the values, which reveal the order');
  const rev = msg(applyBuzz(applyBuzz(room, 'alice', 'jp', false).room, 'bob', 'th', false), 'reveal');
  assert.deepEqual(rev.ranking, ['cn', 'jp', 'kr', 'th'], 'but the reveal carries them');
  assert.equal(rev.values.cn, 1000);
});

test('an unranked question sends no ranking at all', () => {
  // flag-pick and map-pick must be untouched by this: no ranking key on the
  // wire, and the client falls back to the plain tile reveal.
  let room = startedTwoPlayer();
  room = applyBuzz(room, 'alice', 'jp', true).room;
  const rev = msg(applyBuzz(room, 'bob', 'kr', false), 'reveal');
  assert.equal('ranking' in rev, false, 'no ranking key for an unranked question');
  assert.equal('values' in rev, false);
});

function createRoomWith2() {
  let room = createRoom(3);
  room = applyHello(room, 'alice', 'Alice').room;
  return applyHello(room, 'bob', 'Bob').room;
}

// ---- kid mode ----

/** @param {any} room @param {string} pid @returns {any} the seat, asserted present */
function seatOf(room, pid) {
  const seat = room.seats.get(pid);
  assert.ok(seat, `expected a seat for ${pid}`);
  return seat;
}

/**
 * The message addressed to one specific player.
 * @param {{ broadcasts: Array<{ to: string, message: any }> }} result
 * @param {string} to
 * @returns {any}
 */
function msgTo(result, to) {
  const b = result.broadcasts.find((x) => x.to === to);
  assert.ok(b, `expected a broadcast addressed to ${to}`);
  return b.message;
}

/** Seat Alice (host) + Bob, mark Bob a kid. Returns the lobby room. */
function lobbyWithKidBob() {
  return applySetKid(createRoomWith2(), 'alice', 'bob', true).room;
}

test('applySetKid: the host marks a seat as a kid', () => {
  const room = lobbyWithKidBob();
  assert.equal(seatOf(room, 'bob').kid, true);
  assert.equal(seatOf(room, 'alice').kid, false, 'everyone else is untouched');
});

test('applySetKid: rebroadcasts the roster so every client repaints the badge', () => {
  const result = applySetKid(createRoomWith2(), 'alice', 'bob', true);
  const roster = msg(result, 'roster').roster;
  assert.equal(roster.find((/** @type {any} */ r) => r.playerId === 'bob').kid, true);
  assert.equal(roster.find((/** @type {any} */ r) => r.playerId === 'alice').kid, false);
});

test('applySetKid: a non-host cannot mark anyone, not even themselves', () => {
  const result = applySetKid(createRoomWith2(), 'bob', 'bob', true);
  assert.equal(seatOf(result.room, 'bob').kid, false);
  assert.deepEqual(result.broadcasts, []);
});

test('applySetKid: only from the lobby — no handicap changes mid-game', () => {
  const room = applyStart(createRoomWith2(), 'alice', q('jp')).room;
  const result = applySetKid(room, 'alice', 'bob', true);
  assert.equal(seatOf(result.room, 'bob').kid, false);
  assert.deepEqual(result.broadcasts, []);
});

test('applySetKid: unmarking works, and an unknown seat is a no-op', () => {
  let room = lobbyWithKidBob();
  room = applySetKid(room, 'alice', 'bob', false).room;
  assert.equal(seatOf(room, 'bob').kid, false);
  assert.deepEqual(applySetKid(room, 'alice', 'nobody', true).broadcasts, []);
});

test('a kid gets two wrong options to disable; nobody else gets any', () => {
  const result = applyStart(lobbyWithKidBob(), 'alice', q('jp', ['jp', 'kr', 'cn', 'th']));
  const toBob = msgTo(result, 'bob');
  const toAlice = msgTo(result, 'alice');

  assert.equal(toBob.easy.length, 2);
  assert.equal(toBob.easy.includes('jp'), false, 'the answer is never disabled');
  assert.equal('easy' in toAlice, false, 'a grown-up plays the full four');
  assert.equal('answer' in toBob, false, 'and the answer still never rides the question');
});

test('a room with no kids still sends one broadcast to all', () => {
  // The per-recipient fan-out is opt-in: an ordinary game keeps the cheap
  // single-message path it has always had.
  const result = applyStart(createRoomWith2(), 'alice', q('jp'));
  assert.equal(result.broadcasts.length, 1);
  assert.equal(result.broadcasts[0].to, 'all');
});

test("a kid's disabled pair is stable across a reconnect", () => {
  // Deterministic, not random: the welcome a kid gets on reconnect must name
  // the same two tiles the question did, or two more options vanish mid-round.
  const room = lobbyWithKidBob();
  const question = q('jp');
  const started = applyStart(room, 'alice', question).room;
  const onReconnect = msg(applyHello(started, 'bob', 'Bob'), 'welcome').question.easy;
  const onQuestion = msgTo(applyStart(room, 'alice', question), 'bob').easy;
  assert.deepEqual(onReconnect, onQuestion);
});

test('a grown-up reconnecting mid-question gets no easy list', () => {
  const started = applyStart(lobbyWithKidBob(), 'alice', q('jp')).room;
  assert.equal('easy' in msg(applyHello(started, 'alice', 'Alice'), 'welcome').question, false);
});

test('the kid flag survives an eviction', () => {
  const room = deserializeRoom(serializeRoom(lobbyWithKidBob()));
  assert.equal(seatOf(room, 'bob').kid, true);
});

test('a seat stored before kid mode deserializes as a grown-up', () => {
  const room = deserializeRoom({ seats: [['alice', { nickname: 'Alice', score: 7 }]] });
  assert.equal(seatOf(room, 'alice').kid, false);
  assert.equal(seatOf(room, 'alice').score, 7, 'and keeps everything else');
});

test('play again keeps the kid flag — scores reset, handicaps do not', () => {
  let room = lobbyWithKidBob();
  room = applyStart(room, 'alice', q('jp')).room;
  room = applyBuzz(room, 'alice', 'jp', true).room;
  room = applyBuzz(room, 'bob', 'jp', true).room;
  const after = applyPlayAgain({ ...room, phase: /** @type {any} */ ('final') }, 'alice').room;
  assert.equal(seatOf(after, 'bob').kid, true);
  assert.equal(seatOf(after, 'bob').score, 0);
});
