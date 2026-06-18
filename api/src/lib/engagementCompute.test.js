const { test } = require('node:test');
const assert = require('node:assert/strict');

const { computeEngagement } = require('./engagementCompute');

const ZERO = { hasNickname: false, dailySharesCount: 0, quizSharesCount: 0 };

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

test('all three signals at once → all three populated', () => {
  const profile = { nickname: 'Brave Otter' };
  const events = [
    { kind: 'share', payload: { surface: 'daily' } },
    { kind: 'share', payload: { surface: 'flagquiz' } },
  ];
  assert.deepEqual(computeEngagement(profile, events), {
    hasNickname: true,
    dailySharesCount: 1,
    quizSharesCount: 1,
  });
});
