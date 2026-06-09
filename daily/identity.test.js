import { test } from 'node:test';
import assert from 'node:assert/strict';

import { getOrCreateDeviceId } from './identity.js';

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

function throwingStore() {
  return {
    /** @param {string} _k */
    getItem(_k) { throw new Error('private mode'); },
    /** @param {string} _k @param {string} _v */
    setItem(_k, _v) { throw new Error('quota'); },
  };
}

test('first call generates a fresh id and persists it under gridgame.deviceId', () => {
  const store = fakeStore();
  const id = getOrCreateDeviceId(store, () => 'fresh-uuid-aaaaaaaa');
  assert.equal(id, 'fresh-uuid-aaaaaaaa');
  assert.equal(store._map.get('gridgame.deviceId'), 'fresh-uuid-aaaaaaaa');
});

test('subsequent calls return the same persisted id without regenerating', () => {
  const store = fakeStore({ 'gridgame.deviceId': 'already-here-1234' });
  let calls = 0;
  const id = getOrCreateDeviceId(store, () => { calls++; return 'should-not-be-used'; });
  assert.equal(id, 'already-here-1234');
  assert.equal(calls, 0);
});

test('persisted id under 8 chars is treated as missing → fresh id generated', () => {
  const store = fakeStore({ 'gridgame.deviceId': 'short' });
  const id = getOrCreateDeviceId(store, () => 'replacement-uuid-aaaa');
  assert.equal(id, 'replacement-uuid-aaaa');
  assert.equal(store._map.get('gridgame.deviceId'), 'replacement-uuid-aaaa');
});

test('persisted id over 64 chars is treated as missing → fresh id generated', () => {
  const tooLong = 'x'.repeat(65);
  const store = fakeStore({ 'gridgame.deviceId': tooLong });
  const id = getOrCreateDeviceId(store, () => 'replacement-uuid-aaaa');
  assert.equal(id, 'replacement-uuid-aaaa');
});

test('store.getItem throwing (private mode) still returns a fresh id', () => {
  const store = throwingStore();
  const id = getOrCreateDeviceId(store, () => 'session-only-uuid');
  assert.equal(id, 'session-only-uuid');
});

test('store.setItem throwing (quota exceeded) still returns the fresh id', () => {
  const store = {
    /** @param {string} _k */
    getItem(_k) { return null; },
    /** @param {string} _k @param {string} _v */
    setItem(_k, _v) { throw new Error('quota'); },
  };
  const id = getOrCreateDeviceId(store, () => 'session-only-uuid');
  assert.equal(id, 'session-only-uuid');
});

test('uses crypto.randomUUID-shaped id correctly (sanity check)', () => {
  const store = fakeStore();
  const id = getOrCreateDeviceId(store, () => 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee');
  assert.equal(id, 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee');
  assert.equal(id.length, 36);
});
