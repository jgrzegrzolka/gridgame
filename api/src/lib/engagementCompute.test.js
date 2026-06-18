const { test } = require('node:test');
const assert = require('node:assert/strict');

const { computeEngagement } = require('./engagementCompute');

const ZERO = {
  hasNickname: false,
  hasLinkedDevice: false,
  dailySharesCount: 0,
  quizSharesCount: 0,
  findflagSharesCount: 0,
  coffeeClicked: false,
};

test('null profile and null events → zero result', () => {
  assert.deepEqual(computeEngagement(null, null), ZERO);
});

test('undefined profile and events → zero result', () => {
  assert.deepEqual(computeEngagement(undefined, undefined), ZERO);
});

test('profile with no nickname field → hasNickname false', () => {
  assert.equal(computeEngagement({}, []).hasNickname, false);
});

test('profile with explicit nickname:null → hasNickname false', () => {
  assert.equal(computeEngagement({ nickname: null }, []).hasNickname, false);
});

test('profile with empty-string nickname → hasNickname false (the profile row exists but the player never picked a name)', () => {
  assert.equal(computeEngagement({ nickname: '' }, []).hasNickname, false);
});

test('profile with non-string nickname → hasNickname false (defensive)', () => {
  assert.equal(computeEngagement({ nickname: /** @type {any} */ (123) }, []).hasNickname, false);
});

test('profile with a real nickname → hasNickname true', () => {
  assert.equal(computeEngagement({ nickname: 'Nimble Hare' }, []).hasNickname, true);
});

test('daily share event → dailySharesCount only', () => {
  const events = [{ kind: 'share', payload: { surface: 'daily' } }];
  const r = computeEngagement(null, events);
  assert.equal(r.dailySharesCount, 1);
  assert.equal(r.quizSharesCount, 0);
});

test('quiz share event → quizSharesCount only', () => {
  const events = [{ kind: 'share', payload: { surface: 'flagquiz' } }];
  const r = computeEngagement(null, events);
  assert.equal(r.dailySharesCount, 0);
  assert.equal(r.quizSharesCount, 1);
});

test('multiple shares of the same surface count up (it\'s engagement, not unique)', () => {
  const events = [
    { kind: 'share', payload: { surface: 'daily' } },
    { kind: 'share', payload: { surface: 'daily' } },
    { kind: 'share', payload: { surface: 'flagquiz' } },
  ];
  const r = computeEngagement(null, events);
  assert.equal(r.dailySharesCount, 2);
  assert.equal(r.quizSharesCount, 1);
});

test('non-share kinds are ignored (daily_start, findflag_play)', () => {
  const events = [
    { kind: 'daily_start', payload: { puzzleId: 12 } },
    { kind: 'findflag_play', payload: { filter: 'europe', mode: 'random' } },
    { kind: 'share', payload: { surface: 'daily' } },
  ];
  const r = computeEngagement(null, events);
  assert.equal(r.dailySharesCount, 1);
  assert.equal(r.quizSharesCount, 0);
});

test('share events for surfaces we don\'t track for achievements (findflag, ttt) are silently skipped', () => {
  // Captured server-side for analytics, but not folded into any
  // current achievement counter.
  const events = [
    { kind: 'share', payload: { surface: 'findflag' } },
    { kind: 'share', payload: { surface: 'ttt' } },
    { kind: 'share', payload: { surface: 'daily' } },
  ];
  const r = computeEngagement(null, events);
  assert.equal(r.dailySharesCount, 1);
  assert.equal(r.quizSharesCount, 0);
});

test('malformed event (missing payload) is skipped, not crashed', () => {
  const events = [
    { kind: 'share' },
    { kind: 'share', payload: null },
    { kind: 'share', payload: { surface: 'daily' } },
  ];
  const r = computeEngagement(null, events);
  assert.equal(r.dailySharesCount, 1);
  assert.equal(r.quizSharesCount, 0);
});

test('malformed event (null row) is skipped, not crashed', () => {
  const events = [null, undefined, { kind: 'share', payload: { surface: 'daily' } }];
  const r = computeEngagement(null, events);
  assert.equal(r.dailySharesCount, 1);
});

test('event with unrecognised surface is skipped', () => {
  const events = [
    { kind: 'share', payload: { surface: 'totally-new-surface' } },
    { kind: 'share', payload: { surface: 'daily' } },
  ];
  const r = computeEngagement(null, events);
  assert.equal(r.dailySharesCount, 1);
  assert.equal(r.quizSharesCount, 0);
});

test('all signals at once → all populated', () => {
  const profile = { nickname: 'Brave Otter', linkedAt: 1_750_000_000_000 };
  const events = [
    { kind: 'share', payload: { surface: 'daily' } },
    { kind: 'share', payload: { surface: 'flagquiz' } },
    { kind: 'share', payload: { surface: 'findflag' } },
    { kind: 'coffee_click', payload: {} },
  ];
  assert.deepEqual(computeEngagement(profile, events), {
    hasNickname: true,
    hasLinkedDevice: true,
    dailySharesCount: 1,
    quizSharesCount: 1,
    findflagSharesCount: 1,
    coffeeClicked: true,
  });
});

// --- hasLinkedDevice -----------------------------------------------------

test('profile with numeric linkedAt → hasLinkedDevice true', () => {
  assert.equal(computeEngagement({ linkedAt: 1_750_000_000_000 }, []).hasLinkedDevice, true);
});

test('profile with null linkedAt → hasLinkedDevice false', () => {
  assert.equal(computeEngagement({ linkedAt: null }, []).hasLinkedDevice, false);
});

test('profile with missing linkedAt → hasLinkedDevice false', () => {
  assert.equal(computeEngagement({ nickname: 'X' }, []).hasLinkedDevice, false);
});

test('profile with NaN linkedAt → hasLinkedDevice false (defensive)', () => {
  assert.equal(computeEngagement({ linkedAt: NaN }, []).hasLinkedDevice, false);
});

test('profile with string linkedAt → hasLinkedDevice false (defensive)', () => {
  assert.equal(computeEngagement({ linkedAt: /** @type {any} */ ('yesterday') }, []).hasLinkedDevice, false);
});

// --- findflagSharesCount -------------------------------------------------

test('findflag share event → findflagSharesCount only', () => {
  const events = [{ kind: 'share', payload: { surface: 'findflag' } }];
  const r = computeEngagement(null, events);
  assert.equal(r.findflagSharesCount, 1);
  assert.equal(r.dailySharesCount, 0);
  assert.equal(r.quizSharesCount, 0);
});

test('multiple findflag shares count up', () => {
  const events = [
    { kind: 'share', payload: { surface: 'findflag' } },
    { kind: 'share', payload: { surface: 'findflag' } },
    { kind: 'share', payload: { surface: 'findflag' } },
  ];
  assert.equal(computeEngagement(null, events).findflagSharesCount, 3);
});

// --- coffeeClicked --------------------------------------------------------

test('any coffee_click event → coffeeClicked true', () => {
  const events = [{ kind: 'coffee_click', payload: {} }];
  assert.equal(computeEngagement(null, events).coffeeClicked, true);
});

test('multiple coffee_click events → coffeeClicked still just true (boolean signal)', () => {
  const events = [
    { kind: 'coffee_click', payload: {} },
    { kind: 'coffee_click', payload: {} },
    { kind: 'coffee_click', payload: {} },
  ];
  assert.equal(computeEngagement(null, events).coffeeClicked, true);
});

test('no coffee_click events → coffeeClicked false', () => {
  const events = [
    { kind: 'share', payload: { surface: 'daily' } },
    { kind: 'daily_start', payload: { puzzleId: 5 } },
  ];
  assert.equal(computeEngagement(null, events).coffeeClicked, false);
});
