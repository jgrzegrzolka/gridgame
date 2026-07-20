import { test } from 'node:test';
import assert from 'node:assert/strict';

import { STORAGE_KEY, loadProgress, saveProgress, clearProgress } from './progress.js';

function fakeStore(initial = {}) {
  /** @type {Map<string, string>} */
  const m = new Map(Object.entries(initial));
  return {
    /** @param {string} k */
    getItem(k) {
      return m.has(k) ? /** @type {string} */ (m.get(k)) : null;
    },
    /** @param {string} k @param {string} v */
    setItem(k, v) {
      m.set(k, v);
    },
    /** @param {string} k */
    removeItem(k) {
      m.delete(k);
    },
    _map: m,
  };
}

test('an empty store has no progress', () => {
  assert.equal(loadProgress(fakeStore(), 12), null);
});

test('save then load round-trips found, wrong and the start time', () => {
  const store = fakeStore();
  saveProgress(store, 12, { found: ['so', 'km'], wrong: ['pl'], startedAt: 1700 });
  assert.deepEqual(loadProgress(store, 12), { c: ['so', 'km'], w: ['pl'], s: 1700 });
});

test('progress is per puzzle — saving one does not disturb another', () => {
  const store = fakeStore();
  saveProgress(store, 12, { found: ['so'], wrong: [], startedAt: 1 });
  saveProgress(store, 13, { found: ['fr'], wrong: ['pl'], startedAt: 2 });
  assert.deepEqual(loadProgress(store, 12), { c: ['so'], w: [], s: 1 });
  assert.deepEqual(loadProgress(store, 13), { c: ['fr'], w: ['pl'], s: 2 });
});

test('saving the same puzzle again overwrites it', () => {
  // Every guess rewrites the entry, so the last write must win — unlike
  // `daily.scores`, which is deliberately first-attempt-only.
  const store = fakeStore();
  saveProgress(store, 12, { found: ['so'], wrong: [], startedAt: 5 });
  saveProgress(store, 12, { found: ['so', 'km'], wrong: ['pl'], startedAt: 5 });
  assert.deepEqual(loadProgress(store, 12), { c: ['so', 'km'], w: ['pl'], s: 5 });
});

test('clearProgress removes only the puzzle asked for', () => {
  const store = fakeStore();
  saveProgress(store, 12, { found: ['so'], wrong: [], startedAt: 1 });
  saveProgress(store, 13, { found: ['fr'], wrong: [], startedAt: 2 });
  clearProgress(store, 12);
  assert.equal(loadProgress(store, 12), null);
  assert.deepEqual(loadProgress(store, 13), { c: ['fr'], w: [], s: 2 });
});

test('clearing a puzzle with no progress is a no-op, not a throw', () => {
  const store = fakeStore();
  assert.doesNotThrow(() => clearProgress(store, 99));
});

test('corrupt JSON reads as no progress rather than throwing', () => {
  const store = fakeStore({ [STORAGE_KEY]: '{not json' });
  assert.equal(loadProgress(store, 12), null);
});

test('an entry missing its found list is rejected', () => {
  // A record without `c` cannot rebuild the board, so it is not progress.
  const store = fakeStore({ [STORAGE_KEY]: JSON.stringify({ 12: { w: ['pl'], s: 1 } }) });
  assert.equal(loadProgress(store, 12), null);
});

test('non-string codes are dropped rather than poisoning the board', () => {
  const store = fakeStore({
    [STORAGE_KEY]: JSON.stringify({ 12: { c: ['so', 7, null, 'km'], w: ['pl', {}], s: 1 } }),
  });
  assert.deepEqual(loadProgress(store, 12), { c: ['so', 'km'], w: ['pl'], s: 1 });
});

test('a missing or unusable start time falls back to 0', () => {
  // 0 is reported rather than invented so the caller can decide; a
  // fabricated "now" would silently reset the clock on every load.
  const store = fakeStore({ [STORAGE_KEY]: JSON.stringify({ 12: { c: ['so'], w: [] } }) });
  assert.deepEqual(loadProgress(store, 12), { c: ['so'], w: [], s: 0 });
  const store2 = fakeStore({ [STORAGE_KEY]: JSON.stringify({ 12: { c: ['so'], w: [], s: 'x' } }) });
  assert.deepEqual(loadProgress(store2, 12), { c: ['so'], w: [], s: 0 });
});

test('a missing wrong list reads as no wrong guesses', () => {
  const store = fakeStore({ [STORAGE_KEY]: JSON.stringify({ 12: { c: ['so'], s: 1 } }) });
  assert.deepEqual(loadProgress(store, 12), { c: ['so'], w: [], s: 1 });
});

test('non-integer puzzle numbers are refused on both read and write', () => {
  const store = fakeStore();
  saveProgress(store, 0, { found: ['so'], wrong: [], startedAt: 1 });
  saveProgress(store, -3, { found: ['so'], wrong: [], startedAt: 1 });
  saveProgress(store, 1.5, { found: ['so'], wrong: [], startedAt: 1 });
  assert.equal(store.getItem(STORAGE_KEY), null);
  assert.equal(loadProgress(store, 0), null);
});

test('a store that throws on write does not take the game down', () => {
  // Safari private mode throws on setItem when the quota is zero. Losing
  // resume is acceptable; losing the running game is not.
  const store = {
    getItem: () => null,
    setItem() { throw new Error('QuotaExceededError'); },
    removeItem() { throw new Error('QuotaExceededError'); },
  };
  assert.doesNotThrow(() => saveProgress(store, 12, { found: ['so'], wrong: [], startedAt: 1 }));
  assert.doesNotThrow(() => clearProgress(store, 12));
});
