import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  initialPartyClientState,
  reducePartyMessage,
  withLocalBuzz,
  pickPartyCelebration,
  isCleanReveal,
  isBlankReveal,
  revealOrder,
} from './partyClient.js';

const you = 'me';

/**
 * @param {import('./partyClient.js').PartyClientState} state
 * @param {any} msg
 */
function reduce(state, msg) {
  return reducePartyMessage(state, msg).state;
}

test('initial state: connecting, no seat, nothing chosen', () => {
  const s = initialPartyClientState();
  assert.equal(s.phase, 'connecting');
  assert.equal(s.you, null);
  assert.equal(s.myChoice, null);
});

test('welcome: adopts identity, host flag, phase, roster and totals', () => {
  const s = reduce(initialPartyClientState(), {
    type: 'welcome', you, isHost: true, phase: 'lobby',
    roster: [{ playerId: you, nickname: 'Me', score: 0, present: true }],
    questionIndex: 0, totalQuestions: 5, question: null, scoreboard: [],
  });
  assert.equal(s.you, you);
  assert.equal(s.isHost, true);
  assert.equal(s.phase, 'lobby');
  assert.equal(s.totalQuestions, 5);
  assert.equal(s.roster.length, 1);
});

test('welcome + question: the tricky flag is learned from the server and defaults off', () => {
  assert.equal(initialPartyClientState().tricky, false, 'off until the server says otherwise');
  // A mid-game reconnect learns tricky from the welcome snapshot.
  let s = reduce(initialPartyClientState(), {
    type: 'welcome', you, isHost: false, phase: 'question', roster: [], totalQuestions: 5, tricky: true,
  });
  assert.equal(s.tricky, true, 'welcome adopts tricky so the resumed tiles veil');
  // Each question broadcast also carries it (the source of truth per question), plus
  // the per-question veil timing the server stamped from the host's reveal config.
  s = reduce({ ...initialPartyClientState(), roster: [{ playerId: you, nickname: 'Me', score: 0, present: true }] },
    { type: 'question', prompt: 'fr', options: ['fr', 'de'], questionId: 'mapPick', questionIndex: 0, totalQuestions: 5, tricky: true, clearFrac: 0.4 });
  assert.equal(s.tricky, true, 'question adopts tricky');
  assert.equal(s.question?.clearFrac, 0.4, 'the veil timing threads onto the question');
});

test('roster: recomputes isHost against my own id', () => {
  let s = reduce(initialPartyClientState(), { type: 'welcome', you, isHost: false, phase: 'lobby', roster: [], totalQuestions: 5 });
  s = reduce(s, { type: 'roster', hostId: you, roster: [{ playerId: you, nickname: 'Me', score: 0, present: true }] });
  assert.equal(s.isHost, true);
  s = reduce(s, { type: 'roster', hostId: 'someone-else', roster: [] });
  assert.equal(s.isHost, false);
});

test('question: enters the question phase and clears the previous pick/reveal', () => {
  /** @type {import('./partyClient.js').PartyClientState} */
  let s = { ...initialPartyClientState(), you, phase: 'reveal', myChoice: 'jp', reveal: { answer: 'jp', picks: {}, points: {} }, roster: [{ playerId: you, nickname: 'Me', score: 0, present: true }] };
  s = reduce(s, { type: 'question', prompt: 'fr', options: ['fr', 'de', 'it', 'es'], questionId: 'mapPick', questionIndex: 1, totalQuestions: 5 });
  assert.equal(s.phase, 'question');
  assert.equal(s.question?.prompt, 'fr');
  assert.equal(s.question?.questionId, 'mapPick', 'questionId is threaded through so the page can pick flag vs contour tiles');
  assert.equal(s.myChoice, null, 'previous pick cleared');
  assert.equal(s.reveal, null, 'previous reveal cleared');
  assert.equal(s.buzzedCount, 0);
  assert.equal(s.seatCount, 1, 'seeded from present roster');
});

test('buzzed: tracks the answered / total counts', () => {
  /** @type {import('./partyClient.js').PartyClientState} */
  let s = { ...initialPartyClientState(), phase: 'question' };
  s = reduce(s, { type: 'buzzed', playerId: 'x', buzzedCount: 1, seatCount: 2 });
  assert.equal(s.buzzedCount, 1);
  assert.equal(s.seatCount, 2);
});

test('reveal: exposes the answer, everyone\'s picks, and points', () => {
  /** @type {import('./partyClient.js').PartyClientState} */
  let s = { ...initialPartyClientState(), phase: 'question' };
  s = reduce(s, {
    type: 'reveal', answer: 'jp', picks: { me: 'jp', bob: 'kr' }, points: { me: 15, bob: 0 },
    scoreboard: [{ playerId: 'me', nickname: 'Me', score: 15 }], questionIndex: 0, totalQuestions: 5,
  });
  assert.equal(s.phase, 'reveal');
  assert.equal(s.reveal?.answer, 'jp');
  assert.deepEqual(s.reveal?.picks, { me: 'jp', bob: 'kr' });
  assert.equal(s.reveal?.points.me, 15);
  assert.equal(s.scoreboard?.[0].score, 15);
});

test('lobby: Play again returns to the lobby and clears question state', () => {
  /** @type {import('./partyClient.js').PartyClientState} */
  let s = { ...initialPartyClientState(), you, phase: 'final', myChoice: 'jp', reveal: { answer: 'jp', picks: {}, points: {} }, scoreboard: [{ playerId: you, nickname: 'Me', score: 40 }] };
  s = reduce(s, { type: 'lobby', hostId: you, roster: [{ playerId: you, nickname: 'Me', score: 0, present: true }] });
  assert.equal(s.phase, 'lobby');
  assert.equal(s.isHost, true);
  assert.equal(s.myChoice, null);
  assert.equal(s.reveal, null);
  assert.equal(s.scoreboard, null);
  assert.equal(s.roster[0].score, 0);
});

test('final: switches to the final board with the scoreboard', () => {
  const s = reduce(initialPartyClientState(), {
    type: 'final', scoreboard: [{ playerId: 'me', nickname: 'Me', score: 40 }],
  });
  assert.equal(s.phase, 'final');
  assert.equal(s.scoreboard?.[0].score, 40);
});

test('rejected: sets a translatable status and asks the caller to close', () => {
  const r = reducePartyMessage(initialPartyClientState(), { type: 'rejected', reason: 'room-not-found' });
  assert.equal(r.state.statusOverride?.key, 'party.reject.roomNotFound');
  assert.deepEqual(r.effects, [{ type: 'close' }]);
});

test('rejected: unknown reason carries the raw code for template substitution', () => {
  const r = reducePartyMessage(initialPartyClientState(), { type: 'rejected', reason: 'mystery' });
  assert.deepEqual(r.state.statusOverride, {
    key: 'party.reject.fallback', fallback: 'Rejected: {reason}', params: { reason: 'mystery' },
  });
});

test('unknown message type is a no-op', () => {
  const s0 = initialPartyClientState();
  const r = reducePartyMessage(s0, { type: 'whatever' });
  assert.equal(r.state, s0);
});

// ---- withLocalBuzz ----

test('withLocalBuzz: locks the first valid pick during a question', () => {
  const s = { ...initialPartyClientState(), phase: /** @type {const} */ ('question'), question: { prompt: 'jp', options: ['jp', 'kr', 'cn', 'th'] } };
  const s2 = withLocalBuzz(s, 'kr');
  assert.equal(s2.myChoice, 'kr');
});

test('withLocalBuzz: ignores a second tap (first answer counts)', () => {
  const s = { ...initialPartyClientState(), phase: /** @type {const} */ ('question'), myChoice: 'jp', question: { prompt: 'jp', options: ['jp', 'kr', 'cn', 'th'] } };
  assert.equal(withLocalBuzz(s, 'kr').myChoice, 'jp');
});

test('withLocalBuzz: ignores a choice that is not an option, or outside a question', () => {
  const q = { prompt: 'jp', options: ['jp', 'kr', 'cn', 'th'] };
  assert.equal(withLocalBuzz({ ...initialPartyClientState(), phase: /** @type {const} */ ('question'), question: q }, 'zz').myChoice, null);
  assert.equal(withLocalBuzz({ ...initialPartyClientState(), phase: /** @type {const} */ ('reveal'), question: q }, 'jp').myChoice, null);
});

test('pickPartyCelebration: sole winner (that is me) gets fireworks', () => {
  const scoreboard = [
    { playerId: 'me', nickname: 'Me', score: 30 },
    { playerId: 'a', nickname: 'A', score: 20 },
  ];
  assert.equal(pickPartyCelebration({ scoreboard, you: 'me' }), 'fireworks');
});

test('pickPartyCelebration: someone else won → confetti', () => {
  const scoreboard = [
    { playerId: 'a', nickname: 'A', score: 30 },
    { playerId: 'me', nickname: 'Me', score: 20 },
  ];
  assert.equal(pickPartyCelebration({ scoreboard, you: 'me' }), 'confetti');
});

test('pickPartyCelebration: tie at the top → confetti even for a tied leader', () => {
  const scoreboard = [
    { playerId: 'me', nickname: 'Me', score: 30 },
    { playerId: 'a', nickname: 'A', score: 30 },
  ];
  assert.equal(pickPartyCelebration({ scoreboard, you: 'me' }), 'confetti');
});

test('pickPartyCelebration: scoreless finish (top score 0) → none', () => {
  const scoreboard = [
    { playerId: 'me', nickname: 'Me', score: 0 },
    { playerId: 'a', nickname: 'A', score: 0 },
  ];
  assert.equal(pickPartyCelebration({ scoreboard, you: 'me' }), 'none');
});

test('pickPartyCelebration: empty or null scoreboard → none', () => {
  assert.equal(pickPartyCelebration({ scoreboard: [], you: 'me' }), 'none');
  assert.equal(pickPartyCelebration({ scoreboard: null, you: 'me' }), 'none');
});

test('pickPartyCelebration: solo winner with unknown local id → confetti (no false fireworks)', () => {
  const scoreboard = [{ playerId: 'a', nickname: 'A', score: 10 }];
  assert.equal(pickPartyCelebration({ scoreboard, you: null }), 'confetti');
});

// ---- isCleanReveal ----

/** @param {string} id @param {boolean} [present] */
function seat(id, present = true) {
  return { playerId: id, nickname: id, score: 0, present };
}

test('isCleanReveal: solo player who nailed it → clean', () => {
  const roster = [seat('me')];
  assert.equal(isCleanReveal(roster, { answer: 'jp', picks: { me: 'jp' } }), true);
});

test('isCleanReveal: solo player who missed → not clean', () => {
  const roster = [seat('me')];
  assert.equal(isCleanReveal(roster, { answer: 'jp', picks: { me: 'kr' } }), false);
});

test('isCleanReveal: solo timeout (no pick) → not clean', () => {
  const roster = [seat('me')];
  assert.equal(isCleanReveal(roster, { answer: 'jp', picks: {} }), false);
});

test('isCleanReveal: everyone present buzzed correctly → clean', () => {
  const roster = [seat('a'), seat('b')];
  assert.equal(isCleanReveal(roster, { answer: 'jp', picks: { a: 'jp', b: 'jp' } }), true);
});

test('isCleanReveal: one wrong pick spoils the sweep', () => {
  const roster = [seat('a'), seat('b')];
  assert.equal(isCleanReveal(roster, { answer: 'jp', picks: { a: 'jp', b: 'kr' } }), false);
});

test('isCleanReveal: a present player who never answered spoils the sweep', () => {
  const roster = [seat('a'), seat('b')];
  assert.equal(isCleanReveal(roster, { answer: 'jp', picks: { a: 'jp' } }), false);
});

test('isCleanReveal: an away player is ignored — present sweep still counts as clean', () => {
  const roster = [seat('a'), seat('gone', false)];
  assert.equal(isCleanReveal(roster, { answer: 'jp', picks: { a: 'jp' } }), true);
});

test('isCleanReveal: no reveal or empty room → not clean', () => {
  assert.equal(isCleanReveal([seat('a')], null), false);
  assert.equal(isCleanReveal([], { answer: 'jp', picks: {} }), false);
});

// ---- draft: the picking phase (Iteration 9) ----

test('picking (the picker): youPick true + the hand, server-authoritative', () => {
  // `you` deliberately does NOT match `picker` — youPick must still come from the
  // server, not from a client-side you === picker comparison.
  const s = reduce({ ...initialPartyClientState(), you, phase: 'reveal' }, {
    type: 'picking', youPick: true, picker: 'someone-else', hand: ['map-outlines', 'superlative-coffee'], questionIndex: 4, totalQuestions: 15,
  });
  assert.equal(s.phase, 'picking');
  assert.equal(s.youPick, true, 'the server told us we pick, regardless of our id');
  assert.deepEqual(s.hand, ['map-outlines', 'superlative-coffee']);
  assert.equal(s.reveal, null);
});

test('picking (a watcher): youPick false, no hand', () => {
  const s = reduce({ ...initialPartyClientState(), you, phase: 'reveal' }, {
    type: 'picking', youPick: false, picker: 'bob', questionIndex: 4, totalQuestions: 15,
  });
  assert.equal(s.youPick, false);
  assert.equal(s.picker, 'bob');
  assert.equal(s.hand, null);
});

test('question after a pick: clears the picking turn and records who picked', () => {
  /** @type {import('./partyClient.js').PartyClientState} */
  let s = { ...initialPartyClientState(), you, phase: 'picking', picker: 'bob', youPick: true, hand: ['map-outlines'] };
  s = reduce(s, { type: 'question', prompt: 'pa', options: ['pa', 'us'], questionIndex: 5, totalQuestions: 15, draftPick: { picker: 'bob', modeId: 'map-outlines' } });
  assert.equal(s.phase, 'question');
  assert.equal(s.picker, null);
  assert.equal(s.youPick, false);
  assert.equal(s.hand, null);
  assert.deepEqual(s.lastPick, { picker: 'bob', modeId: 'map-outlines' });
});

test('an ordinary (non-drafted) question clears lastPick', () => {
  /** @type {import('./partyClient.js').PartyClientState} */
  let s = { ...initialPartyClientState(), lastPick: { picker: 'bob', modeId: 'map-outlines' } };
  s = reduce(s, { type: 'question', prompt: 'jp', options: ['jp'], questionIndex: 6, totalQuestions: 15 });
  assert.equal(s.lastPick, null);
});

test('welcome mid-pick resumes the picker turn (youPick + hand) server-authoritatively', () => {
  const s = reduce(initialPartyClientState(), {
    type: 'welcome', you, isHost: false, phase: 'picking', roster: [], totalQuestions: 15,
    picker: 'bob', youPick: true, hand: ['map-outlines', 'superlative-beer'],
  });
  assert.equal(s.phase, 'picking');
  assert.equal(s.youPick, true);
  assert.deepEqual(s.hand, ['map-outlines', 'superlative-beer']);
});

test('welcome mid-pick as a watcher: youPick false, no hand', () => {
  const s = reduce(initialPartyClientState(), {
    type: 'welcome', you, isHost: false, phase: 'picking', roster: [], totalQuestions: 15,
    picker: 'bob', youPick: false, hand: null,
  });
  assert.equal(s.youPick, false);
  assert.equal(s.picker, 'bob');
});

test('lobby (play again) clears any draft state', () => {
  /** @type {import('./partyClient.js').PartyClientState} */
  let s = { ...initialPartyClientState(), phase: 'picking', picker: 'bob', hand: ['x'], lastPick: { picker: 'bob', modeId: 'x' }, decider: true };
  s = reduce(s, { type: 'lobby', hostId: you, roster: [] });
  assert.equal(s.phase, 'lobby');
  assert.equal(s.picker, null);
  assert.equal(s.hand, null);
  assert.equal(s.lastPick, null);
  assert.equal(s.decider, false);
});

// ---- the Decider (Iteration 12) ----

test('picking: the Decider flag reaches the picker AND the watcher', () => {
  // Unlike the hand, this is not picker-only: the closing act is announced to
  // the whole table, so the watch screen can name what is being chosen.
  for (const youPick of [true, false]) {
    const s = reduce({ ...initialPartyClientState(), you, phase: 'reveal' }, {
      type: 'picking', youPick, picker: 'bob', questionIndex: 14, totalQuestions: 20, decider: true,
    });
    assert.equal(s.decider, true, `youPick=${youPick}`);
  }
});

test('picking: an ordinary rotation pick is not the Decider', () => {
  const s = reduce({ ...initialPartyClientState(), you, phase: 'reveal' }, {
    type: 'picking', youPick: false, picker: 'bob', questionIndex: 4, totalQuestions: 20,
  });
  assert.equal(s.decider, false, 'and an older server that omits the field reads as false');
});

test('the Decider flag is dropped the moment its round starts', () => {
  // Once the round is playing it is simply the final round, which the round card
  // derives from the question itself — a stale `decider` would be a second,
  // divergent source of truth for the same fact.
  /** @type {import('./partyClient.js').PartyClientState} */
  let s = { ...initialPartyClientState(), you, phase: 'picking', picker: 'bob', decider: true };
  s = reduce(s, { type: 'question', prompt: 'pa', options: ['pa'], questionIndex: 15, totalQuestions: 20, draftPick: { picker: 'bob', modeId: 'superlative-coffee' } });
  assert.equal(s.decider, false);
});

test('welcome mid-Decider-pick resumes knowing it is the Decider', () => {
  const s = reduce(initialPartyClientState(), {
    type: 'welcome', you, isHost: false, phase: 'picking', roster: [], totalQuestions: 20,
    questionIndex: 14, picker: 'bob', youPick: false, hand: null, decider: true,
  });
  assert.equal(s.decider, true);
});

// ---- isBlankReveal: the "Nobody knew" beat ----

/** @param {string} id @param {boolean} [present] */
const blankSeat = (id, present = true) => ({ playerId: id, nickname: id, score: 0, present });

test('isBlankReveal: every present player wrong → the room was beaten', () => {
  const roster = [blankSeat('a'), blankSeat('b'), blankSeat('c')];
  const reveal = { answer: 'pl', picks: { a: 'de', b: 'fr', c: 'de' } };
  assert.equal(isBlankReveal(roster, reveal), true);
});

test('isBlankReveal: a timeout counts as not knowing', () => {
  // A seat with no pick at all didn't know it either, so a question nobody even
  // answered is the loudest version of this.
  const roster = [blankSeat('a'), blankSeat('b')];
  assert.equal(isBlankReveal(roster, { answer: 'pl', picks: {} }), true);
});

test('isBlankReveal: one correct answer is not a blank', () => {
  const roster = [blankSeat('a'), blankSeat('b')];
  assert.equal(isBlankReveal(roster, { answer: 'pl', picks: { a: 'pl', b: 'de' } }), false);
});

test('isBlankReveal: an absent player getting it wrong does not decide it', () => {
  // Only players in the room are asked; a departed seat's stale pick shouldn't be
  // able to turn a question somebody actually got into a shared groan (or vice versa).
  const roster = [blankSeat('a'), blankSeat('b'), blankSeat('c', false)];
  // The departed seat holds the only correct pick: the room still got beaten.
  assert.equal(isBlankReveal(roster, { answer: 'pl', picks: { a: 'de', b: 'fr', c: 'pl' } }), true);
  // ...and a present player getting it right ends the beat, absent seat or not.
  assert.equal(isBlankReveal(roster, { answer: 'pl', picks: { a: 'pl', b: 'fr', c: 'de' } }), false);
});

test('isBlankReveal: never fires in solo play', () => {
  // With one seat "nobody knew" is just "you were wrong", which the reveal
  // already says, and naming it would read as the game being smug at one player.
  assert.equal(isBlankReveal([blankSeat('a')], { answer: 'pl', picks: { a: 'de' } }), false);
});

test('isBlankReveal: no reveal, no beat', () => {
  assert.equal(isBlankReveal([blankSeat('a'), blankSeat('b')], null), false);
});

test('isBlankReveal and isCleanReveal are mutually exclusive on a real room', () => {
  const roster = [blankSeat('a'), blankSeat('b')];
  /** @type {Record<string, string>[]} */
  const cases = [{ a: 'pl', b: 'pl' }, { a: 'pl', b: 'de' }, { a: 'de', b: 'fr' }, {}];
  for (const picks of cases) {
    const reveal = { answer: 'pl', picks };
    assert.equal(isCleanReveal(roster, reveal) && isBlankReveal(roster, reveal), false);
  }
});

test('reveal message: the itemised breakdown reaches client state', () => {
  let state = initialPartyClientState();
  state = reducePartyMessage(state, {
    type: 'reveal',
    answer: 'pl',
    picks: { a: 'pl' },
    points: { a: 20 },
    breakdown: { a: { base: 10, speed: 5, solo: 5 } },
  }).state;
  assert.deepEqual(state.reveal?.breakdown, { a: { base: 10, speed: 5, solo: 5 } });
});

test('reveal message: a server with no breakdown leaves an empty one, not undefined', () => {
  let state = initialPartyClientState();
  state = reducePartyMessage(state, { type: 'reveal', answer: 'pl', picks: {}, points: {} }).state;
  assert.deepEqual(state.reveal?.breakdown, {});
});


// ---- hold to read ----

/** A room sitting on a chart reveal, which is the only place holds happen. */
function atReveal() {
  return /** @type {import('./partyClient.js').PartyClientState} */ ({
    ...initialPartyClientState(), you, phase: 'reveal',
    reveal: { answer: 'jp', picks: {}, points: {}, ranking: ['jp', 'kr'], values: { jp: 8, kr: 1 } },
  });
}

test('holding: a press adds the seat, a release removes it', () => {
  let s = reduce(atReveal(), { type: 'holding', playerId: 'bob', on: true });
  assert.deepEqual(s.holders, ['bob']);
  s = reduce(s, { type: 'holding', playerId: 'bob', on: false });
  assert.deepEqual(s.holders, [], 'the clock is free again');
});

test('holding: the clock stays frozen until the LAST holder lets go', () => {
  // Why holders is a set and not a boolean. Two players read at once; the first
  // one to finish must not resume the countdown out from under the second.
  let s = reduce(atReveal(), { type: 'holding', playerId: 'bob', on: true });
  s = reduce(s, { type: 'holding', playerId: 'zosia', on: true });
  assert.deepEqual(s.holders, ['bob', 'zosia']);
  s = reduce(s, { type: 'holding', playerId: 'bob', on: false });
  assert.deepEqual(s.holders, ['zosia'], 'still held by Zosia');
  s = reduce(s, { type: 'holding', playerId: 'zosia', on: false });
  assert.deepEqual(s.holders, []);
});

test('holding: a repeated press from one seat does not stack', () => {
  // A jittery pointer or a duplicated message would otherwise leave an entry a
  // single release cannot clear. Held time is unbounded, so nothing would come
  // along to bail the room out -- the reveal would stay frozen until the phase
  // changed, which it cannot do while the clock is held.
  let s = reduce(atReveal(), { type: 'holding', playerId: 'bob', on: true });
  s = reduce(s, { type: 'holding', playerId: 'bob', on: true });
  assert.deepEqual(s.holders, ['bob'], 'still one entry');
  s = reduce(s, { type: 'holding', playerId: 'bob', on: false });
  assert.deepEqual(s.holders, [], 'and one release clears it');
});

test('holding: a release for a seat that was not holding changes nothing', () => {
  const before = atReveal();
  const after = reduce(before, { type: 'holding', playerId: 'ghost', on: false });
  assert.equal(after, before, 'same object — no pointless re-render');
});

test('holding: a message with no playerId is ignored', () => {
  const before = atReveal();
  assert.equal(reduce(before, { type: 'holding', on: true }), before);
});

test('a hold never survives into the next phase', () => {
  // The finger can still be down when the reveal ends. If the hold carried over,
  // the next question would open with a frozen clock and no way to unfreeze it
  // (the release goes to a phase that ignores holds).
  const held = reduce(atReveal(), { type: 'holding', playerId: 'bob', on: true });
  assert.deepEqual(held.holders, ['bob']);
  const nextQuestion = reduce(held, {
    type: 'question', prompt: 'p', options: ['jp', 'kr', 'cn', 'th'], questionIndex: 1,
  });
  assert.equal(nextQuestion.phase, 'question');
  assert.deepEqual(nextQuestion.holders, [], 'cleared by the phase change');
});

test('a hold on the last reveal does not survive into the final board', () => {
  // The path that is easy to miss: reveal -> final skips the question case
  // entirely, which is why clearing lives on the phase change rather than in
  // each case that moves it.
  const held = reduce(atReveal(), { type: 'holding', playerId: 'bob', on: true });
  const final = reduce(held, { type: 'final', scoreboard: [] });
  assert.equal(final.phase, 'final');
  assert.deepEqual(final.holders, []);
});

// ---- lobby settings: length and the first round ----
// The `settings` message had no test at all before the first round arrived,
// which is how a one-field message clobbering the other field could have shipped
// unnoticed. Both fields fall back to what we already hold precisely so a message
// naming one does not blank the other; that `??` is the thing these pin.

test('settings: a length-only message leaves the first round alone', () => {
  let s = initialPartyClientState();
  s = reduce(s, { type: 'settings', firstPick: 'spot-flag' });
  s = reduce(s, { type: 'settings', length: 'short' });
  assert.equal(s.length, 'short');
  assert.equal(s.firstPick, 'spot-flag', 'the host changing length must not reset the first round');
});

test('settings: an firstPick-only message leaves the length alone', () => {
  let s = initialPartyClientState();
  s = reduce(s, { type: 'settings', length: 'long' });
  s = reduce(s, { type: 'settings', firstPick: 'map-outlines' });
  assert.equal(s.firstPick, 'map-outlines');
  assert.equal(s.length, 'long', 'the host changing the first pick must not reset the length');
});

test('welcome: a joiner learns both lobby settings immediately', () => {
  // Without this a mid-lobby joiner paints the defaults until the host happens to
  // change something, so they see a game they are not actually about to play.
  const s = reduce(initialPartyClientState(), {
    type: 'welcome', you, hostId: 'h', phase: 'lobby', roster: [],
    length: 'short', firstPick: 'flags-weird',
  });
  assert.equal(s.length, 'short');
  assert.equal(s.firstPick, 'flags-weird');
});

test('welcome: a server that sends neither setting leaves what we hold', () => {
  // An older PartyKit deploy omits them; the SWA site and PartyKit ship on
  // separate workflows, so this pairing is real and not hypothetical.
  let s = initialPartyClientState();
  s = reduce(s, { type: 'settings', length: 'long', firstPick: 'spot-flag' });
  s = reduce(s, { type: 'welcome', you, hostId: 'h', phase: 'lobby', roster: [] });
  assert.equal(s.length, 'long');
  assert.equal(s.firstPick, 'spot-flag');
});

test('revealOrder: highest points this question on top, not cumulative leader', () => {
  // Server sends the board descending by TOTAL: the leader (Ada) scored 0 this
  // question, a trailing player (Dan) scored the most.
  const scoreboard = [
    { playerId: 'ada', nickname: 'Ada', score: 60 },
    { playerId: 'ben', nickname: 'Ben', score: 40 },
    { playerId: 'dan', nickname: 'Dan', score: 30 },
  ];
  const points = { ada: 0, ben: 3, dan: 8 };
  const ordered = revealOrder(scoreboard, points).map((r) => r.playerId);
  assert.deepEqual(ordered, ['dan', 'ben', 'ada'], 'biggest gain this question leads');
});

test('revealOrder: ties on points break by cumulative score then id, and it is stable', () => {
  const scoreboard = [
    { playerId: 'ada', nickname: 'Ada', score: 50 },
    { playerId: 'ben', nickname: 'Ben', score: 55 },
    { playerId: 'cara', nickname: 'Cara', score: 20 },
  ];
  const points = { ada: 5, ben: 5, cara: 0 };
  const ordered = revealOrder(scoreboard, points).map((r) => r.playerId);
  // ada & ben both +5 -> higher total (ben) first; cara scored 0 -> last.
  assert.deepEqual(ordered, ['ben', 'ada', 'cara']);
});

test('revealOrder: missing points / empty board are safe and non-mutating', () => {
  assert.deepEqual(revealOrder(null, null), []);
  const board = [
    { playerId: 'b', nickname: 'B', score: 10 },
    { playerId: 'a', nickname: 'A', score: 10 },
  ];
  const out = revealOrder(board, undefined); // no points at all -> by score then id
  assert.deepEqual(out.map((r) => r.playerId), ['a', 'b']);
  assert.deepEqual(board.map((r) => r.playerId), ['b', 'a'], 'input array untouched');
});
