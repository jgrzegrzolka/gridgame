import test from 'node:test';
import assert from 'node:assert/strict';

import {
  shouldPushQuizRecord,
  getLastQuizRecordPushedAt,
  markQuizRecordPushed,
  PUSH_THROTTLE_MS,
  SENTINEL_KEY,
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

// ---------------------------------------------------------------------------
// shouldPushQuizRecord — the decision contract
// ---------------------------------------------------------------------------

test('shouldPushQuizRecord: PB beat → always push (even on give-up, even if throttled)', () => {
  // A player who gave up mid-round but still beat their PB on the
  // answered questions: server needs to see it for the daily leaderboard.
  assert.equal(shouldPushQuizRecord({ gaveUp: true,  isNew: true, lastPushedAt: T0, now: T0 + 1 }), true);
  assert.equal(shouldPushQuizRecord({ gaveUp: false, isNew: true, lastPushedAt: T0, now: T0 + 1 }), true);
  assert.equal(shouldPushQuizRecord({ gaveUp: false, isNew: true, lastPushedAt: 0,  now: T0 }),     true);
});

test('shouldPushQuizRecord: give-up without PB → skip (no consumer for the bump)', () => {
  assert.equal(shouldPushQuizRecord({ gaveUp: true, isNew: false, lastPushedAt: 0, now: T0 }), false);
  assert.equal(shouldPushQuizRecord({ gaveUp: true, isNew: false, lastPushedAt: T0, now: T0 + 99 * 60 * 1000 }), false);
});

test('shouldPushQuizRecord: legitimate non-PB finish, never pushed → push (seeds the sentinel)', () => {
  // First non-PB finish on a brand-new device. lastPushedAt:0 ("never
  // pushed") fires regardless of how recent `now` is.
  assert.equal(shouldPushQuizRecord({ gaveUp: false, isNew: false, lastPushedAt: 0, now: T0 }), true);
});

test('shouldPushQuizRecord: legitimate non-PB inside throttle window → skip', () => {
  const within = T0 + (PUSH_THROTTLE_MS - 1000);
  assert.equal(shouldPushQuizRecord({ gaveUp: false, isNew: false, lastPushedAt: T0, now: within }), false);
});

test('shouldPushQuizRecord: legitimate non-PB after throttle window → push', () => {
  const past = T0 + PUSH_THROTTLE_MS + 1000;
  assert.equal(shouldPushQuizRecord({ gaveUp: false, isNew: false, lastPushedAt: T0, now: past }), true);
});

test('shouldPushQuizRecord: legitimate non-PB exactly at the boundary → push', () => {
  // Boundary is inclusive (>=) so a finish exactly 30 min after the
  // last push qualifies. Matters mostly for tests; in real use the
  // probability of hitting the exact ms is zero.
  const exact = T0 + PUSH_THROTTLE_MS;
  assert.equal(shouldPushQuizRecord({ gaveUp: false, isNew: false, lastPushedAt: T0, now: exact }), true);
});

test('shouldPushQuizRecord: PB on a brand-new device (lastPushedAt:0) → push', () => {
  // PB path doesn't care about the sentinel — exercises that branch
  // explicitly so a refactor that reorders the early returns is caught.
  assert.equal(shouldPushQuizRecord({ gaveUp: false, isNew: true, lastPushedAt: 0, now: T0 }), true);
});

// ---------------------------------------------------------------------------
// getLastQuizRecordPushedAt — defensive reader
// ---------------------------------------------------------------------------

test('getLastQuizRecordPushedAt: fresh store → 0 ("never pushed")', () => {
  assert.equal(getLastQuizRecordPushedAt(makeStore()), 0);
});

test('getLastQuizRecordPushedAt: malformed value → 0 (defensive)', () => {
  // Hand-edited / corrupted localStorage shouldn't crash the page.
  // Returning 0 is the safe default (next finish fires a push).
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

// ---------------------------------------------------------------------------
// markQuizRecordPushed — defensive writer + roundtrip
// ---------------------------------------------------------------------------

test('markQuizRecordPushed: writes the timestamp, getLastQuizRecordPushedAt reads it back', () => {
  const s = makeStore();
  markQuizRecordPushed(s, T0);
  assert.equal(getLastQuizRecordPushedAt(s), T0);
});

test('markQuizRecordPushed: setItem failure is swallowed (best-effort)', () => {
  // localStorage in private mode / quota-exceeded throws. The helper
  // must not throw — the next finish will just re-attempt the push.
  const throwingStore = {
    getItem: () => null,
    setItem: () => { throw new Error('quota exceeded'); },
  };
  // Does not throw:
  markQuizRecordPushed(/** @type {any} */ (throwingStore), T0);
});

// ---------------------------------------------------------------------------
// End-to-end via the helpers — pinning the "play 5 rounds in 30 min,
// only the first POSTs" workflow that delivers the cost win.
// ---------------------------------------------------------------------------

test('integration: 5 non-PB plays within 30 min → only the first qualifies for push', () => {
  const store = makeStore();
  let pushed = 0;
  for (let i = 0; i < 5; i++) {
    const now = T0 + i * 5 * 60 * 1000;  // 5 plays, 5 min apart = 25 min total
    const ok = shouldPushQuizRecord({
      gaveUp: false, isNew: false,
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
  // First play: non-PB at t=0 → pushes (seeds sentinel)
  let now = T0;
  if (shouldPushQuizRecord({ gaveUp: false, isNew: false, lastPushedAt: 0, now })) {
    markQuizRecordPushed(store, now);
    pushed++;
  }
  // Second play 10 min later: PB → pushes despite throttle
  now = T0 + 10 * 60 * 1000;
  if (shouldPushQuizRecord({
    gaveUp: false, isNew: true,
    lastPushedAt: getLastQuizRecordPushedAt(store),
    now,
  })) {
    markQuizRecordPushed(store, now);
    pushed++;
  }
  // Third play 5 min after that: non-PB → throttled
  now = T0 + 15 * 60 * 1000;
  if (shouldPushQuizRecord({
    gaveUp: false, isNew: false,
    lastPushedAt: getLastQuizRecordPushedAt(store),
    now,
  })) {
    markQuizRecordPushed(store, now);
    pushed++;
  }
  assert.equal(pushed, 2, 'first finish + the PB beat');
});

test('integration: give-ups in the middle of throttled streak never push and never reset the sentinel', () => {
  const store = makeStore();
  // Successful push at t=0
  markQuizRecordPushed(store, T0);
  // Give-up 5 min later → no push, sentinel unchanged
  const give = T0 + 5 * 60 * 1000;
  assert.equal(shouldPushQuizRecord({
    gaveUp: true, isNew: false,
    lastPushedAt: getLastQuizRecordPushedAt(store),
    now: give,
  }), false);
  // Sentinel preserved at T0 (give-up didn't stamp)
  assert.equal(getLastQuizRecordPushedAt(store), T0);
});
