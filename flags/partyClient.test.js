import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  initialPartyClientState,
  reducePartyMessage,
  withLocalBuzz,
  pickPartyCelebration,
  isCleanReveal,
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
    roundIndex: 0, totalRounds: 5, question: null, scoreboard: [],
  });
  assert.equal(s.you, you);
  assert.equal(s.isHost, true);
  assert.equal(s.phase, 'lobby');
  assert.equal(s.totalRounds, 5);
  assert.equal(s.roster.length, 1);
});

test('welcome + question: the tricky flag is learned from the server and defaults off', () => {
  assert.equal(initialPartyClientState().tricky, false, 'off until the server says otherwise');
  // A mid-game reconnect learns tricky from the welcome snapshot.
  let s = reduce(initialPartyClientState(), {
    type: 'welcome', you, isHost: false, phase: 'question', roster: [], totalRounds: 5, tricky: true,
  });
  assert.equal(s.tricky, true, 'welcome adopts tricky so the resumed tiles veil');
  // Each question broadcast also carries it (the source of truth per round), plus
  // the per-question veil timing the server stamped from the host's reveal config.
  s = reduce({ ...initialPartyClientState(), roster: [{ playerId: you, nickname: 'Me', score: 0, present: true }] },
    { type: 'question', prompt: 'fr', options: ['fr', 'de'], roundId: 'mapPick', roundIndex: 0, totalRounds: 5, tricky: true, clearFrac: 0.4 });
  assert.equal(s.tricky, true, 'question adopts tricky');
  assert.equal(s.question?.clearFrac, 0.4, 'the veil timing threads onto the question');
});

test('roster: recomputes isHost against my own id', () => {
  let s = reduce(initialPartyClientState(), { type: 'welcome', you, isHost: false, phase: 'lobby', roster: [], totalRounds: 5 });
  s = reduce(s, { type: 'roster', hostId: you, roster: [{ playerId: you, nickname: 'Me', score: 0, present: true }] });
  assert.equal(s.isHost, true);
  s = reduce(s, { type: 'roster', hostId: 'someone-else', roster: [] });
  assert.equal(s.isHost, false);
});

test('question: enters the question phase and clears the previous pick/reveal', () => {
  /** @type {import('./partyClient.js').PartyClientState} */
  let s = { ...initialPartyClientState(), you, phase: 'reveal', myChoice: 'jp', reveal: { answer: 'jp', picks: {}, points: {} }, roster: [{ playerId: you, nickname: 'Me', score: 0, present: true }] };
  s = reduce(s, { type: 'question', prompt: 'fr', options: ['fr', 'de', 'it', 'es'], roundId: 'mapPick', roundIndex: 1, totalRounds: 5 });
  assert.equal(s.phase, 'question');
  assert.equal(s.question?.prompt, 'fr');
  assert.equal(s.question?.roundId, 'mapPick', 'roundId is threaded through so the page can pick flag vs contour tiles');
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
    scoreboard: [{ playerId: 'me', nickname: 'Me', score: 15 }], roundIndex: 0, totalRounds: 5,
  });
  assert.equal(s.phase, 'reveal');
  assert.equal(s.reveal?.answer, 'jp');
  assert.deepEqual(s.reveal?.picks, { me: 'jp', bob: 'kr' });
  assert.equal(s.reveal?.points.me, 15);
  assert.equal(s.scoreboard?.[0].score, 15);
});

test('lobby: Play again returns to the lobby and clears round state', () => {
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
