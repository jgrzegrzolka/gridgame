import test from 'node:test';
import assert from 'node:assert/strict';

import { buildEngagementOverlay, mergeEngagementOverlay } from './engagementSnapshot.js';
import { STORAGE_KEY } from './engagementCounters.js';

/** @param {Record<string, unknown> | undefined} [initialState] */
function makeStore(initialState) {
  const map = new Map();
  if (initialState) map.set(STORAGE_KEY, JSON.stringify(initialState));
  return {
    getItem: (/** @type {string} */ k) => (map.has(k) ? /** @type {string} */ (map.get(k)) : null),
    setItem: (/** @type {string} */ k, /** @type {string} */ v) => { map.set(k, v); },
  };
}

// ---------------------------------------------------------------------------
// buildEngagementOverlay — project localStorage into snapshot fields
// ---------------------------------------------------------------------------

test('buildEngagementOverlay: empty store → all zeros / false', () => {
  const r = buildEngagementOverlay(makeStore(), 19000);
  assert.deepEqual(r, {
    dailySharesCount: 0,
    quizSharesCount: 0,
    findflagSharesCount: 0,
    coffeeClicked: false,
    quiz60sCurrentStreak: 0,
    quiz60sMaxStreak: 0,
    quiz60sDistinctDays: 0,
  });
});

test('buildEngagementOverlay: share counts map per-surface (note the flagquiz → quizSharesCount key rename)', () => {
  const store = makeStore({
    v: 1,
    shares: { daily: 5, flagquiz: 3, findflag: 2, ttt: 9 },
    coffeeClickCount: 0,
    quiz60sDayLog: [],
  });
  const r = buildEngagementOverlay(store, 19000);
  assert.equal(r.dailySharesCount, 5);
  assert.equal(r.quizSharesCount, 3);    // flagquiz → quizSharesCount rename pins here
  assert.equal(r.findflagSharesCount, 2);
  // ttt has no current achievement consumer, so it does not surface as a snapshot field.
  assert.equal(/** @type {any} */ (r).tttSharesCount, undefined);
});

test('buildEngagementOverlay: coffeeClickCount >= 1 → coffeeClicked true (matches server boolean semantics)', () => {
  const r1 = buildEngagementOverlay(makeStore({
    v: 1, shares: {}, coffeeClickCount: 1, quiz60sDayLog: [],
  }), 19000);
  assert.equal(r1.coffeeClicked, true);

  const r2 = buildEngagementOverlay(makeStore({
    v: 1, shares: {}, coffeeClickCount: 0, quiz60sDayLog: [],
  }), 19000);
  assert.equal(r2.coffeeClicked, false);
});

test('buildEngagementOverlay: quiz60s streak computed from day log, with today reset', () => {
  // Played days: 100, 101, 102 (streak of 3), gap on 103, 104, 105 (streak of 2). Today = 105.
  const store = makeStore({
    v: 1,
    shares: { daily: 0, flagquiz: 0, findflag: 0, ttt: 0 },
    coffeeClickCount: 0,
    quiz60sDayLog: [100, 101, 102, 104, 105],
  });
  const r = buildEngagementOverlay(store, 105);
  assert.equal(r.quiz60sCurrentStreak, 2);   // trailing 104-105 (today is 105)
  assert.equal(r.quiz60sMaxStreak, 3);       // 100-101-102
  assert.equal(r.quiz60sDistinctDays, 5);
});

test('buildEngagementOverlay: missed today → currentStreak resets, maxStreak preserved', () => {
  // Played up to day 103. Today is 105 (player missed yesterday + today).
  const store = makeStore({
    v: 1,
    shares: { daily: 0, flagquiz: 0, findflag: 0, ttt: 0 },
    coffeeClickCount: 0,
    quiz60sDayLog: [100, 101, 102, 103],
  });
  const r = buildEngagementOverlay(store, 105);
  assert.equal(r.quiz60sCurrentStreak, 0);
  assert.equal(r.quiz60sMaxStreak, 4);
  assert.equal(r.quiz60sDistinctDays, 4);
});

test('buildEngagementOverlay: null todayDayId → no missed-today reset', () => {
  // Useful for code paths that haven't computed the day yet — we don't
  // want to falsely zero out currentStreak just because today is unknown.
  const store = makeStore({
    v: 1, shares: {}, coffeeClickCount: 0, quiz60sDayLog: [100, 101, 102],
  });
  const r = buildEngagementOverlay(store, null);
  assert.equal(r.quiz60sCurrentStreak, 3);  // would be 0 if we reset on missing today
});

// ---------------------------------------------------------------------------
// mergeEngagementOverlay — overlay onto the server snapshot
// ---------------------------------------------------------------------------

test('mergeEngagementOverlay: server fields pass through unchanged for non-engagement keys', () => {
  const server = {
    currentStreak: 14,
    maxStreak: 14,
    totalPlayed: 14,
    hasNickname: true,
    hasLinkedDevice: true,
    tttGamesPlayed: 9,
    // Server still returns engagement fields today; we expect to overlay them.
    dailySharesCount: 0,
    quizSharesCount: 0,
  };
  const store = makeStore({
    v: 1, shares: { daily: 7, flagquiz: 2 }, coffeeClickCount: 1, quiz60sDayLog: [],
  });
  const r = mergeEngagementOverlay(server, store, 19000);
  // Server-only fields preserved
  assert.equal(r.currentStreak, 14);
  assert.equal(r.hasNickname, true);
  assert.equal(r.tttGamesPlayed, 9);
  // Engagement fields overridden by localStorage
  assert.equal(r.dailySharesCount, 7);
  assert.equal(r.quizSharesCount, 2);
  assert.equal(r.coffeeClicked, true);
});

test('mergeEngagementOverlay: localStorage wins even when server has higher counts (local is canonical)', () => {
  // The whole point of Phase 4.5: the server can be stale (push throttled),
  // but the local state is the truth for the current device. If predicates
  // pulled from the server, a fresh share wouldn't immediately unlock the
  // "Daily Sharer" badge — that's the regression we're fixing.
  const server = { dailySharesCount: 99 };
  const store = makeStore({
    v: 1, shares: { daily: 1 }, coffeeClickCount: 0, quiz60sDayLog: [],
  });
  const r = mergeEngagementOverlay(server, store, 19000);
  assert.equal(r.dailySharesCount, 1);  // local wins
});

test('mergeEngagementOverlay: null server snapshot → returns standalone overlay', () => {
  const store = makeStore({
    v: 1, shares: { daily: 3 }, coffeeClickCount: 1, quiz60sDayLog: [100],
  });
  const r = mergeEngagementOverlay(null, store, 100);
  assert.equal(r.dailySharesCount, 3);
  assert.equal(r.coffeeClicked, true);
  assert.equal(r.quiz60sCurrentStreak, 1);
  // No server fields present
  assert.equal(/** @type {any} */ (r).currentStreak, undefined);
});

test('mergeEngagementOverlay: undefined server snapshot → returns standalone overlay (same as null)', () => {
  const store = makeStore();
  const r = mergeEngagementOverlay(undefined, store, 19000);
  assert.equal(r.dailySharesCount, 0);
});

test('mergeEngagementOverlay: does not mutate the input snapshot', () => {
  const server = { currentStreak: 14, dailySharesCount: 99 };
  const snapshot = JSON.stringify(server);
  const store = makeStore({ v: 1, shares: { daily: 1 }, coffeeClickCount: 0, quiz60sDayLog: [] });
  mergeEngagementOverlay(server, store, 19000);
  assert.equal(JSON.stringify(server), snapshot);
});
