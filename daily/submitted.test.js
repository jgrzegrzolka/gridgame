import { test } from 'node:test';
import assert from 'node:assert/strict';

import { hasSubmitted, markSubmitted } from './submitted.js';

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
    _map: m,
  };
}

test('hasSubmitted returns false on an empty store', () => {
  const store = fakeStore();
  assert.equal(hasSubmitted(store, 7), false);
});

test('markSubmitted + hasSubmitted roundtrip', () => {
  const store = fakeStore();
  markSubmitted(store, 7);
  assert.equal(hasSubmitted(store, 7), true);
  assert.equal(hasSubmitted(store, 8), false);
});

test('markSubmitted persists as a sorted JSON array under gridgame.submittedPuzzles', () => {
  const store = fakeStore();
  markSubmitted(store, 5);
  markSubmitted(store, 1);
  markSubmitted(store, 3);
  assert.equal(store._map.get('gridgame.submittedPuzzles'), '[1,3,5]');
});

test('markSubmitted is idempotent — re-marking does not change storage', () => {
  const store = fakeStore();
  markSubmitted(store, 7);
  markSubmitted(store, 7);
  markSubmitted(store, 7);
  assert.equal(store._map.get('gridgame.submittedPuzzles'), '[7]');
});

test('hasSubmitted reads an existing serialized set', () => {
  const store = fakeStore({ 'gridgame.submittedPuzzles': '[1,3,5,9]' });
  assert.equal(hasSubmitted(store, 1), true);
  assert.equal(hasSubmitted(store, 5), true);
  assert.equal(hasSubmitted(store, 2), false);
});

test('hasSubmitted tolerates malformed JSON (treats as empty)', () => {
  const store = fakeStore({ 'gridgame.submittedPuzzles': '{not an array' });
  assert.equal(hasSubmitted(store, 1), false);
});

test('hasSubmitted tolerates a non-array JSON value (treats as empty)', () => {
  const store = fakeStore({ 'gridgame.submittedPuzzles': '{"7":true}' });
  assert.equal(hasSubmitted(store, 7), false);
});

test('markSubmitted into a malformed store starts a fresh set', () => {
  const store = fakeStore({ 'gridgame.submittedPuzzles': 'garbage' });
  markSubmitted(store, 7);
  assert.equal(store._map.get('gridgame.submittedPuzzles'), '[7]');
});

test('hasSubmitted ignores non-integer / non-positive inputs', () => {
  const store = fakeStore({ 'gridgame.submittedPuzzles': '[1,2,3]' });
  assert.equal(hasSubmitted(store, 0), false);
  assert.equal(hasSubmitted(store, -1), false);
  assert.equal(hasSubmitted(store, 1.5), false);
  assert.equal(hasSubmitted(store, /** @type {any} */ ('1')), false);
});

test('markSubmitted ignores invalid puzzle numbers without throwing', () => {
  const store = fakeStore();
  markSubmitted(store, 0);
  markSubmitted(store, -3);
  markSubmitted(store, 1.5);
  assert.equal(store._map.get('gridgame.submittedPuzzles'), undefined);
});

test('markSubmitted is silent if setItem throws (private mode / quota)', () => {
  const store = {
    /** @param {string} _k */
    getItem(_k) { return null; },
    /** @param {string} _k @param {string} _v */
    setItem(_k, _v) { throw new Error('quota'); },
  };
  // Just asserting this doesn't throw.
  markSubmitted(store, 7);
});

test('hasSubmitted strips out non-integer entries from a tampered store', () => {
  const store = fakeStore({ 'gridgame.submittedPuzzles': '[1, "two", 3, null, 5]' });
  assert.equal(hasSubmitted(store, 1), true);
  assert.equal(hasSubmitted(store, 3), true);
  assert.equal(hasSubmitted(store, 5), true);
});
