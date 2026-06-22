import test from 'node:test';
import assert from 'node:assert/strict';

import {
  STORAGE_KEY,
  emptyState,
  loadState,
  saveState,
  bumpShare,
  bumpCoffeeClick,
  bumpQuiz60sDay,
  getSyncBlobSection,
  inflateFromBlob,
} from './engagementCounters.js';

/** Map-backed store double — same shape as the real localStorage. */
function makeStore() {
  const map = new Map();
  return {
    _map: map,
    getItem: (/** @type {string} */ k) => (map.has(k) ? /** @type {string} */ (map.get(k)) : null),
    setItem: (/** @type {string} */ k, /** @type {string} */ v) => { map.set(k, v); },
  };
}

// ---------------------------------------------------------------------------
// emptyState / loadState — sanitisation contract
// ---------------------------------------------------------------------------

test('emptyState: every counter at zero, log empty, schema v=1', () => {
  assert.deepEqual(emptyState(), {
    v: 1,
    shares: { daily: 0, flagquiz: 0, findflag: 0, ttt: 0 },
    coffeeClickCount: 0,
    quiz60sDayLog: [],
  });
});

test('loadState: returns emptyState on a fresh store (no entry yet)', () => {
  assert.deepEqual(loadState(makeStore()), emptyState());
});

test('loadState: returns emptyState on malformed JSON (defensive)', () => {
  // A hand-edited / corrupted entry shouldn't crash the page — treating
  // it as "no state" matches the fresh-device path and lets the user
  // continue (they just lose whatever was in the bad blob).
  const store = makeStore();
  store.setItem(STORAGE_KEY, 'not json {{{');
  assert.deepEqual(loadState(store), emptyState());
});

test('loadState: round-trips a saved state losslessly', () => {
  const store = makeStore();
  /** @type {import('./engagementCounters.js').EngagementState} */
  const state = {
    v: 1,
    shares: { daily: 5, flagquiz: 3, findflag: 1, ttt: 0 },
    coffeeClickCount: 2,
    quiz60sDayLog: [19000, 19001, 19003],
  };
  saveState(store, state);
  assert.deepEqual(loadState(store), state);
});

test('loadState: discards unknown share surfaces (closed list)', () => {
  // Future drift / typo: a `pinterest` share counter in storage shouldn't
  // leak into the state. Keeping the list closed surfaces the typo at the
  // call site (bumpShare returns unchanged) rather than silently
  // creating phantom counters.
  const store = makeStore();
  store.setItem(STORAGE_KEY, JSON.stringify({
    v: 1,
    shares: { daily: 4, pinterest: 99 },
    coffeeClickCount: 0,
    quiz60sDayLog: [],
  }));
  const state = loadState(store);
  assert.equal(state.shares.daily, 4);
  assert.equal(/** @type {any} */ (state.shares).pinterest, undefined);
});

test('loadState: discards non-integer / negative counter values', () => {
  const store = makeStore();
  store.setItem(STORAGE_KEY, JSON.stringify({
    v: 1,
    shares: { daily: -3, flagquiz: 1.5, findflag: 'NaN', ttt: 7 },
    coffeeClickCount: -1,
    quiz60sDayLog: [],
  }));
  const state = loadState(store);
  // Bad values fall back to zero (the empty-state default); good ones survive.
  assert.equal(state.shares.daily, 0);
  assert.equal(state.shares.flagquiz, 0);
  assert.equal(state.shares.findflag, 0);
  assert.equal(state.shares.ttt, 7);
  assert.equal(state.coffeeClickCount, 0);
});

test('loadState: dedupes + sorts the day log (streakCompute expects ordered + unique)', () => {
  const store = makeStore();
  store.setItem(STORAGE_KEY, JSON.stringify({
    v: 1, shares: {}, coffeeClickCount: 0,
    quiz60sDayLog: [19003, 19001, 19001, 19000, 'bad', 1.5, -5],
  }));
  const state = loadState(store);
  assert.deepEqual(state.quiz60sDayLog, [19000, 19001, 19003]);
});

// ---------------------------------------------------------------------------
// bumpShare — per-surface increments, closed-list guard
// ---------------------------------------------------------------------------

test('bumpShare: increments the named surface and persists', () => {
  const store = makeStore();
  bumpShare(store, 'daily');
  bumpShare(store, 'daily');
  bumpShare(store, 'flagquiz');
  assert.equal(loadState(store).shares.daily, 2);
  assert.equal(loadState(store).shares.flagquiz, 1);
  assert.equal(loadState(store).shares.findflag, 0);
});

test('bumpShare: unknown surface is a no-op (catches typos without crashing)', () => {
  const store = makeStore();
  bumpShare(store, /** @type {any} */ ('twitter'));
  const state = loadState(store);
  assert.deepEqual(state.shares, { daily: 0, flagquiz: 0, findflag: 0, ttt: 0 });
});

test('bumpShare: returns the new state so callers can chain into pushSyncBlob without reloading', () => {
  const store = makeStore();
  const state = bumpShare(store, 'daily');
  assert.equal(state.shares.daily, 1);
});

// ---------------------------------------------------------------------------
// bumpCoffeeClick — monotonic counter
// ---------------------------------------------------------------------------

test('bumpCoffeeClick: increments + persists each call', () => {
  const store = makeStore();
  bumpCoffeeClick(store);
  bumpCoffeeClick(store);
  bumpCoffeeClick(store);
  assert.equal(loadState(store).coffeeClickCount, 3);
});

// ---------------------------------------------------------------------------
// bumpQuiz60sDay — idempotent, sorted insert
// ---------------------------------------------------------------------------

test('bumpQuiz60sDay: appends a new day in sorted position', () => {
  const store = makeStore();
  bumpQuiz60sDay(store, 19003);
  bumpQuiz60sDay(store, 19000);
  bumpQuiz60sDay(store, 19001);
  assert.deepEqual(loadState(store).quiz60sDayLog, [19000, 19001, 19003]);
});

test('bumpQuiz60sDay: same day passed twice is idempotent (no double-count)', () => {
  const store = makeStore();
  bumpQuiz60sDay(store, 19000);
  bumpQuiz60sDay(store, 19000);
  bumpQuiz60sDay(store, 19000);
  assert.deepEqual(loadState(store).quiz60sDayLog, [19000]);
});

test('bumpQuiz60sDay: non-integer / negative dayId rejected, state unchanged', () => {
  const store = makeStore();
  bumpQuiz60sDay(store, 19000);
  bumpQuiz60sDay(store, /** @type {any} */ ('bad'));
  bumpQuiz60sDay(store, 1.5);
  bumpQuiz60sDay(store, -1);
  assert.deepEqual(loadState(store).quiz60sDayLog, [19000]);
});

// ---------------------------------------------------------------------------
// getSyncBlobSection / inflateFromBlob — sync round-trip
// ---------------------------------------------------------------------------

test('getSyncBlobSection: returns the current local state verbatim (no transformation)', () => {
  // The local mirror IS what gets pushed to the server — same shape on
  // both sides means no serialiser drift and no per-call transformation
  // cost. This test pins that invariant.
  const store = makeStore();
  bumpShare(store, 'daily');
  bumpCoffeeClick(store);
  bumpQuiz60sDay(store, 19000);
  assert.deepEqual(getSyncBlobSection(store), loadState(store));
});

test('inflateFromBlob: overwrites localStorage with a sanitised copy of the blob section', () => {
  const store = makeStore();
  bumpShare(store, 'daily');
  bumpShare(store, 'daily');
  // Blob from the server (e.g. pushed by a different device on the same
  // deviceId) should overwrite our local state — the blob is authoritative
  // in the cross-device sync model. Per-device divergence is by design.
  inflateFromBlob(store, {
    v: 1,
    shares: { daily: 10, flagquiz: 5, findflag: 0, ttt: 0 },
    coffeeClickCount: 1,
    quiz60sDayLog: [19000, 19002],
  });
  const state = loadState(store);
  assert.equal(state.shares.daily, 10);
  assert.equal(state.shares.flagquiz, 5);
  assert.equal(state.coffeeClickCount, 1);
  assert.deepEqual(state.quiz60sDayLog, [19000, 19002]);
});

test('inflateFromBlob: malformed blob falls back to emptyState (defensive)', () => {
  const store = makeStore();
  bumpShare(store, 'daily');
  inflateFromBlob(store, /** @type {any} */ ('not an object'));
  assert.deepEqual(loadState(store), emptyState());
});

test('inflateFromBlob: sanitises the same way loadState does (closed share list, bad day numbers stripped)', () => {
  const store = makeStore();
  inflateFromBlob(store, {
    v: 1,
    shares: { daily: 3, pinterest: 99 },
    coffeeClickCount: 2,
    quiz60sDayLog: [19000, 'bad', -5, 19001, 19000],
  });
  const state = loadState(store);
  assert.equal(state.shares.daily, 3);
  assert.equal(/** @type {any} */ (state.shares).pinterest, undefined);
  assert.deepEqual(state.quiz60sDayLog, [19000, 19001]);
});
