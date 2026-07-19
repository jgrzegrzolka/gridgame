import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  initialPartyClientState,
  reducePartyMessage,
  withLocalBuzz,
  isDisabledOption,
  visibleOptions,
  pickPartyCelebration,
  isCleanReveal,
  isBlankReveal,
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
    doubled: true,
  }).state;
  assert.deepEqual(state.reveal?.breakdown, { a: { base: 10, speed: 5, solo: 5 } });
  assert.equal(state.reveal?.doubled, true, 'doubled rides the reveal too (it never used to)');
});

test('reveal message: a server with no breakdown leaves an empty one, not undefined', () => {
  let state = initialPartyClientState();
  state = reducePartyMessage(state, { type: 'reveal', answer: 'pl', picks: {}, points: {} }).state;
  assert.deepEqual(state.reveal?.breakdown, {});
  assert.equal(state.reveal?.doubled, false);
});

// ---- kid mode ----

/**
 * The question on a state, asserted present.
 * @param {any} state
 * @returns {any}
 */
function questionOf(state) {
  assert.ok(state.question, 'expected a live question');
  return state.question;
}

/** A kid mid-question: four options, two of them disabled. */
function kidMidQuestion() {
  const { state } = reducePartyMessage(initialPartyClientState(), {
    type: 'question', prompt: 'jp', options: ['jp', 'kr', 'cn', 'th'], easy: ['kr', 'cn'],
  });
  return state;
}

test('a kid learns which two options are out', () => {
  const state = kidMidQuestion();
  assert.deepEqual(questionOf(state).easy, ['kr', 'cn']);
  assert.equal(isDisabledOption(state, 'kr'), true);
  assert.equal(isDisabledOption(state, 'jp'), false, 'the answer is still live');
  assert.equal(isDisabledOption(state, 'th'), false, 'and so is the one wrong option left');
});

test('a grown-up has no disabled options at all', () => {
  const { state } = reducePartyMessage(initialPartyClientState(), {
    type: 'question', prompt: 'jp', options: ['jp', 'kr', 'cn', 'th'],
  });
  assert.equal(questionOf(state).easy, null);
  for (const code of questionOf(state).options) assert.equal(isDisabledOption(state, code), false);
});

test('a kid cannot buzz a disabled option', () => {
  // The tiles render as un-clickable divs, but the guard lives here too: a
  // keyboard or assistive-tech activation must not lock in a tile that is out.
  const state = kidMidQuestion();
  assert.equal(withLocalBuzz(state, 'kr').myChoice, null);
  assert.equal(withLocalBuzz(state, 'jp').myChoice, 'jp', 'a live option still buzzes');
});

test('the disabled pair arrives on a mid-question reconnect too', () => {
  const { state } = reducePartyMessage(initialPartyClientState(), {
    type: 'welcome', you: 'bob', phase: 'question', roster: [],
    question: { prompt: 'jp', options: ['jp', 'kr', 'cn', 'th'], easy: ['kr', 'cn'] },
  });
  assert.equal(isDisabledOption(state, 'kr'), true);
});

test('the next question clears the previous one\'s disabled pair', () => {
  // `easy` is per question. A kid whose second question came from a server that
  // sent none must get four live tiles, not the stale two.
  let state = kidMidQuestion();
  state = reducePartyMessage(state, { type: 'question', prompt: 'us', options: ['us', 'ca', 'mx', 'br'] }).state;
  assert.equal(questionOf(state).easy, null);
  assert.equal(isDisabledOption(state, 'ca'), false);
});

test('a kid draws only the two live options during the question', () => {
  const state = kidMidQuestion();
  assert.deepEqual(visibleOptions(state, false), ['jp', 'th']);
});

test('the reveal gives a kid the whole board back', () => {
  // They should see what they were shielded from, including the two tiles they
  // never had a chance to pick.
  const state = kidMidQuestion();
  assert.deepEqual(visibleOptions(state, true), ['jp', 'kr', 'cn', 'th']);
});

test('a grown-up always draws all four', () => {
  const { state } = reducePartyMessage(initialPartyClientState(), {
    type: 'question', prompt: 'jp', options: ['jp', 'kr', 'cn', 'th'],
  });
  assert.deepEqual(visibleOptions(state, false), ['jp', 'kr', 'cn', 'th']);
  assert.deepEqual(visibleOptions(state, true), ['jp', 'kr', 'cn', 'th']);
});

test('visibleOptions keeps the question order it was given', () => {
  // The grid draws in this order, so a stable order keeps a kid's two tiles in
  // the same relative places the table sees them.
  const { state } = reducePartyMessage(initialPartyClientState(), {
    type: 'question', prompt: 'jp', options: ['kr', 'jp', 'cn', 'th'], easy: ['cn', 'kr'],
  });
  assert.deepEqual(visibleOptions(state, false), ['jp', 'th']);
});

test('visibleOptions is safe with no question at all', () => {
  assert.deepEqual(visibleOptions(initialPartyClientState(), false), []);
});
