import test from 'node:test';
import assert from 'node:assert/strict';

import {
  shouldPushQuizRecord,
  computeTodayPbCandidate,
  utcDateKey,
  getLastQuizRecordPushedAt,
  markQuizRecordPushed,
  getQuizDayBest,
  setQuizDayBest,
  PUSH_THROTTLE_MS,
  SENTINEL_KEY,
  DAY_BEST_KEY_PREFIX,
} from './quizRecordThrottle.js';

function makeStore() {
  const map = new Map();
  return {
    _map: map,
    getItem: (/** @type {string} */ k) => (map.has(k) ? /** @type {string} */ (map.get(k)) : null),
    setItem: (/** @type {string} */ k, /** @type {string} */ v) => { map.set(k, v); },
  };
}

const T0 = 1_700_000_000_000;
const TODAY = utcDateKey(T0);

// ---------------------------------------------------------------------------
// utcDateKey — must match the server's `dailyLeaderboardDoc.todayDateKey`
// (`new Date(now).toISOString().slice(0, 10)`).
// ---------------------------------------------------------------------------

test('utcDateKey: matches the server format', () => {
  assert.equal(utcDateKey(1_700_000_000_000), '2023-11-14');
  assert.equal(utcDateKey(Date.UTC(2026, 0, 1, 0, 0, 0)), '2026-01-01');
  assert.equal(utcDateKey(Date.UTC(2026, 0, 1, 23, 59, 59, 999)), '2026-01-01');
  assert.equal(utcDateKey(Date.UTC(2026, 0, 2, 0, 0, 0)), '2026-01-02');
});

// ---------------------------------------------------------------------------
// computeTodayPbCandidate — would the server's mergeDailyLeaderboard
// write or update today's row?
// ---------------------------------------------------------------------------

test('computeTodayPbCandidate: dayBest null → candidate (first of day)', () => {
  assert.equal(
    computeTodayPbCandidate({ dayBest: null, entry: { score: 5, durationMs: 1000 }, lowerWins: false, now: T0 }),
    true,
  );
});

test('computeTodayPbCandidate: dayBest for a previous date → candidate (rollover)', () => {
  // Same-week-ago cache from yesterday's session shouldn't gate today's first finish.
  const dayBest = { date: '2023-11-13', score: 10, durationMs: 1000 };
  assert.equal(
    computeTodayPbCandidate({ dayBest, entry: { score: 1, durationMs: 99_999 }, lowerWins: false, now: T0 }),
    true,
  );
});

test('computeTodayPbCandidate: higher-wins beats today best → candidate', () => {
  const dayBest = { date: TODAY, score: 7, durationMs: 5000 };
  assert.equal(
    computeTodayPbCandidate({ dayBest, entry: { score: 8, durationMs: 6000 }, lowerWins: false, now: T0 }),
    true,
  );
});

test('computeTodayPbCandidate: higher-wins same score, faster time → candidate', () => {
  const dayBest = { date: TODAY, score: 7, durationMs: 5000 };
  assert.equal(
    computeTodayPbCandidate({ dayBest, entry: { score: 7, durationMs: 4999 }, lowerWins: false, now: T0 }),
    true,
  );
});

test('computeTodayPbCandidate: higher-wins same score, equal time → not a candidate', () => {
  const dayBest = { date: TODAY, score: 7, durationMs: 5000 };
  assert.equal(
    computeTodayPbCandidate({ dayBest, entry: { score: 7, durationMs: 5000 }, lowerWins: false, now: T0 }),
    false,
  );
});

test('computeTodayPbCandidate: higher-wins worse score → not a candidate', () => {
  const dayBest = { date: TODAY, score: 7, durationMs: 5000 };
  assert.equal(
    computeTodayPbCandidate({ dayBest, entry: { score: 6, durationMs: 1 }, lowerWins: false, now: T0 }),
    false,
  );
});

test('computeTodayPbCandidate: lower-wins beats today best (fewer mistakes) → candidate', () => {
  const dayBest = { date: TODAY, score: 3, durationMs: 30_000 };
  assert.equal(
    computeTodayPbCandidate({ dayBest, entry: { score: 2, durationMs: 60_000 }, lowerWins: true, now: T0 }),
    true,
  );
});

test('computeTodayPbCandidate: lower-wins more mistakes → not a candidate', () => {
  const dayBest = { date: TODAY, score: 3, durationMs: 30_000 };
  assert.equal(
    computeTodayPbCandidate({ dayBest, entry: { score: 4, durationMs: 1 }, lowerWins: true, now: T0 }),
    false,
  );
});

test('computeTodayPbCandidate: lower-wins same mistakes, faster → candidate', () => {
  const dayBest = { date: TODAY, score: 3, durationMs: 30_000 };
  assert.equal(
    computeTodayPbCandidate({ dayBest, entry: { score: 3, durationMs: 29_999 }, lowerWins: true, now: T0 }),
    true,
  );
});

// ---------------------------------------------------------------------------
// shouldPushQuizRecord — the decision contract.
// `engaged` and `isTodayPbCandidate` come from the call site.
// ---------------------------------------------------------------------------

test('shouldPushQuizRecord: all-time PB beat → always push', () => {
  // Bypasses every other gate including the today-PB candidate path.
  assert.equal(shouldPushQuizRecord({ engaged: false, isNew: true, isTodayPbCandidate: false, lastPushedAt: T0, now: T0 + 1 }), true);
  assert.equal(shouldPushQuizRecord({ engaged: true,  isNew: true, isTodayPbCandidate: false, lastPushedAt: T0, now: T0 + 1 }), true);
  assert.equal(shouldPushQuizRecord({ engaged: true,  isNew: true, isTodayPbCandidate: true,  lastPushedAt: 0,  now: T0 }),     true);
});

test('shouldPushQuizRecord: not engaged (zero picks) without PB → skip', () => {
  // The today-PB-candidate path doesn't override no-engagement: a
  // give-up-with-zero-picks shouldn't bump anything server-side even
  // if it would technically be the "first finish of the day".
  assert.equal(shouldPushQuizRecord({ engaged: false, isNew: false, isTodayPbCandidate: true,  lastPushedAt: 0, now: T0 }), false);
  assert.equal(shouldPushQuizRecord({ engaged: false, isNew: false, isTodayPbCandidate: false, lastPushedAt: T0, now: T0 + 99 * 60 * 1000 }), false);
});

test('shouldPushQuizRecord: engaged + today-PB candidate → push (the fix)', () => {
  // The reason this gate exists: oceania-all played once, niche config,
  // not an all-time PB, but a today-PB-write that the 30 min throttle
  // would otherwise drop. Empty-leaderboard bug fixed here.
  assert.equal(shouldPushQuizRecord({ engaged: true, isNew: false, isTodayPbCandidate: true, lastPushedAt: T0, now: T0 + 1000 }), true);
});

test('shouldPushQuizRecord: engaged non-PB, no leaderboard impact, never pushed → push (seeds sentinel)', () => {
  assert.equal(shouldPushQuizRecord({ engaged: true, isNew: false, isTodayPbCandidate: false, lastPushedAt: 0, now: T0 }), true);
});

test('shouldPushQuizRecord: engaged non-PB, no leaderboard impact, inside throttle window → skip', () => {
  const within = T0 + (PUSH_THROTTLE_MS - 1000);
  assert.equal(shouldPushQuizRecord({ engaged: true, isNew: false, isTodayPbCandidate: false, lastPushedAt: T0, now: within }), false);
});

test('shouldPushQuizRecord: engaged non-PB, no leaderboard impact, after throttle window → push', () => {
  const past = T0 + PUSH_THROTTLE_MS + 1000;
  assert.equal(shouldPushQuizRecord({ engaged: true, isNew: false, isTodayPbCandidate: false, lastPushedAt: T0, now: past }), true);
});

test('shouldPushQuizRecord: engaged non-PB, no leaderboard impact, exactly at the boundary → push', () => {
  // Boundary is inclusive (>=) so a finish exactly 30 min after the
  // last push qualifies.
  const exact = T0 + PUSH_THROTTLE_MS;
  assert.equal(shouldPushQuizRecord({ engaged: true, isNew: false, isTodayPbCandidate: false, lastPushedAt: T0, now: exact }), true);
});

test('shouldPushQuizRecord: gave-up-with-real-progress (engaged: true, non-PB, no leaderboard impact) → throttled', () => {
  // Pre-fix Phase 5 used `gaveUp` as the skip signal, which falsely
  // dropped the attempts bump for players who answered many questions
  // before giving up. Under the unified `engaged` gate, those are real
  // rounds — they go through the throttle like any other non-PB.
  const within = T0 + 60_000;
  assert.equal(shouldPushQuizRecord({ engaged: true, isNew: false, isTodayPbCandidate: false, lastPushedAt: T0, now: within }), false);
  const past = T0 + PUSH_THROTTLE_MS + 60_000;
  assert.equal(shouldPushQuizRecord({ engaged: true, isNew: false, isTodayPbCandidate: false, lastPushedAt: T0, now: past }), true);
});

// ---------------------------------------------------------------------------
// getLastQuizRecordPushedAt / markQuizRecordPushed — defensive sentinel I/O
// ---------------------------------------------------------------------------

test('getLastQuizRecordPushedAt: fresh store → 0 ("never pushed")', () => {
  assert.equal(getLastQuizRecordPushedAt(makeStore()), 0);
});

test('getLastQuizRecordPushedAt: malformed value → 0 (defensive)', () => {
  for (const bad of ['not a number', 'NaN', '-1', '0', '']) {
    const s = makeStore();
    s.setItem(SENTINEL_KEY, bad);
    assert.equal(getLastQuizRecordPushedAt(s), 0, `bad value: "${bad}"`);
  }
});

test('getLastQuizRecordPushedAt: round-trips a valid timestamp', () => {
  const s = makeStore();
  s.setItem(SENTINEL_KEY, String(T0));
  assert.equal(getLastQuizRecordPushedAt(s), T0);
});

test('markQuizRecordPushed: writes the timestamp, getLastQuizRecordPushedAt reads it back', () => {
  const s = makeStore();
  markQuizRecordPushed(s, T0);
  assert.equal(getLastQuizRecordPushedAt(s), T0);
});

test('markQuizRecordPushed: setItem failure is swallowed (best-effort)', () => {
  const throwingStore = {
    getItem: () => null,
    setItem: () => { throw new Error('quota exceeded'); },
  };
  markQuizRecordPushed(/** @type {any} */ (throwingStore), T0);
});

// ---------------------------------------------------------------------------
// getQuizDayBest / setQuizDayBest — per-config today-best cache I/O
// ---------------------------------------------------------------------------

test('getQuizDayBest: fresh store → null', () => {
  assert.equal(getQuizDayBest(makeStore(), 'oceania:all:sov'), null);
});

test('getQuizDayBest / setQuizDayBest: round-trips a valid record', () => {
  const s = makeStore();
  setQuizDayBest(s, 'oceania:all:sov', { date: '2026-06-25', score: 3, durationMs: 41_200 });
  assert.deepEqual(
    getQuizDayBest(s, 'oceania:all:sov'),
    { date: '2026-06-25', score: 3, durationMs: 41_200 },
  );
});

test('getQuizDayBest: key namespace is per-config (no cross-talk)', () => {
  const s = makeStore();
  setQuizDayBest(s, 'oceania:all:sov', { date: '2026-06-25', score: 3, durationMs: 41_200 });
  assert.equal(getQuizDayBest(s, 'europe:60s:sov'), null);
});

test('getQuizDayBest: malformed JSON → null (defensive)', () => {
  const s = makeStore();
  s.setItem(DAY_BEST_KEY_PREFIX + 'oceania:all:sov', '{not valid json');
  assert.equal(getQuizDayBest(s, 'oceania:all:sov'), null);
});

test('getQuizDayBest: missing fields → null (defensive)', () => {
  const s = makeStore();
  s.setItem(DAY_BEST_KEY_PREFIX + 'oceania:all:sov', JSON.stringify({ date: '2026-06-25', score: 3 }));
  assert.equal(getQuizDayBest(s, 'oceania:all:sov'), null);
});

test('setQuizDayBest: setItem failure is swallowed (best-effort)', () => {
  const throwingStore = {
    getItem: () => null,
    setItem: () => { throw new Error('quota exceeded'); },
  };
  setQuizDayBest(/** @type {any} */ (throwingStore), 'oceania:all:sov', { date: '2026-06-25', score: 3, durationMs: 1 });
});

// ---------------------------------------------------------------------------
// End-to-end via the helpers — pinning the workflows that motivated the
// throttle (cost win) and the today-PB-candidate trigger (bugfix).
// ---------------------------------------------------------------------------

test('integration: 5 engaged non-PB-non-candidate plays within 30 min → only the first qualifies', () => {
  // Cost-win pin: subsequent non-leaderboard finishes within the
  // throttle window stay client-side.
  const store = makeStore();
  let pushed = 0;
  for (let i = 0; i < 5; i++) {
    const now = T0 + i * 5 * 60 * 1000;
    const ok = shouldPushQuizRecord({
      engaged: true, isNew: false, isTodayPbCandidate: false,
      lastPushedAt: getLastQuizRecordPushedAt(store),
      now,
    });
    if (ok) {
      markQuizRecordPushed(store, now);
      pushed++;
    }
  }
  assert.equal(pushed, 1, 'only the first push fires; rest are throttled');
});

test('integration: PB in the middle of a throttled streak still pushes', () => {
  const store = makeStore();
  let pushed = 0;
  let now = T0;
  if (shouldPushQuizRecord({ engaged: true, isNew: false, isTodayPbCandidate: false, lastPushedAt: 0, now })) {
    markQuizRecordPushed(store, now);
    pushed++;
  }
  now = T0 + 10 * 60 * 1000;
  if (shouldPushQuizRecord({
    engaged: true, isNew: true, isTodayPbCandidate: false,
    lastPushedAt: getLastQuizRecordPushedAt(store),
    now,
  })) {
    markQuizRecordPushed(store, now);
    pushed++;
  }
  now = T0 + 15 * 60 * 1000;
  if (shouldPushQuizRecord({
    engaged: true, isNew: false, isTodayPbCandidate: false,
    lastPushedAt: getLastQuizRecordPushedAt(store),
    now,
  })) {
    markQuizRecordPushed(store, now);
    pushed++;
  }
  assert.equal(pushed, 2, 'first finish + the PB beat');
});

test('integration: today-PB candidate after a recent unrelated push still pushes (the fix)', () => {
  // Reproduces the empty-leaderboard bug: device pushed for config A
  // 10 min ago, then plays config B for the first time today. Pre-fix
  // the 30 min throttle dropped this push; post-fix the today-PB
  // candidate trigger fires it.
  const store = makeStore();
  markQuizRecordPushed(store, T0); // sentinel from config A's push
  const now = T0 + 10 * 60 * 1000;
  const ok = shouldPushQuizRecord({
    engaged: true, isNew: false,
    isTodayPbCandidate: computeTodayPbCandidate({
      dayBest: getQuizDayBest(store, 'oceania:all:sov'), // null → candidate
      entry: { score: 2, durationMs: 60_000 },
      lowerWins: true,
      now,
    }),
    lastPushedAt: getLastQuizRecordPushedAt(store),
    now,
  });
  assert.equal(ok, true);
});

test('integration: not-engaged rounds in the middle never push and never reset the sentinel', () => {
  const store = makeStore();
  markQuizRecordPushed(store, T0);
  const noPlay = T0 + 5 * 60 * 1000;
  assert.equal(shouldPushQuizRecord({
    engaged: false, isNew: false, isTodayPbCandidate: false,
    lastPushedAt: getLastQuizRecordPushedAt(store),
    now: noPlay,
  }), false);
  assert.equal(getLastQuizRecordPushedAt(store), T0);
});

test('integration: second worse finish on the same config + same day → throttled (cache prevents wasted push)', () => {
  // Player just pushed a today-PB for oceania-all (score 2, recorded
  // in the cache). 5 min later they play again and score 4 (worse in
  // lower-wins). Cache says "today's best is 2"; this finish doesn't
  // beat it → not a candidate → throttle path applies → skipped.
  const store = makeStore();
  const firstFinish = T0;
  markQuizRecordPushed(store, firstFinish);
  setQuizDayBest(store, 'oceania:all:sov', { date: TODAY, score: 2, durationMs: 60_000 });

  const now = T0 + 5 * 60 * 1000;
  const ok = shouldPushQuizRecord({
    engaged: true, isNew: false,
    isTodayPbCandidate: computeTodayPbCandidate({
      dayBest: getQuizDayBest(store, 'oceania:all:sov'),
      entry: { score: 4, durationMs: 30_000 },
      lowerWins: true,
      now,
    }),
    lastPushedAt: getLastQuizRecordPushedAt(store),
    now,
  });
  assert.equal(ok, false);
});

