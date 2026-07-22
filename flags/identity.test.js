import { test } from 'node:test';
import assert from 'node:assert/strict';

import { getOrCreateDeviceId, restoreOrCreateDeviceId, LEGACY_PLAYER_ID_KEY } from './identity.js';

/**
 * Minimal fetch double. `whoami` is the deviceId /whoami should return, or
 * null to simulate "no cookie". `throws` simulates a network error. Returns
 * `{ fetchImpl, calls }` where `calls()` reports how many times it ran — so a
 * test can assert the fast path never touched the network.
 *
 * @param {{ whoami?: string | null, ok?: boolean, throws?: boolean }} [opts]
 */
function fakeFetch({ whoami = null, ok = true, throws = false } = {}) {
  const state = { count: 0 };
  /** @type {typeof fetch} */
  const fetchImpl = /** @type {any} */ (async (/** @type {string} */ _url) => {
    state.count++;
    if (throws) throw new Error('network down');
    return { ok, async json() { return { deviceId: whoami }; } };
  });
  return { fetchImpl, calls: () => state.count };
}

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

function throwingStore() {
  return {
    /** @param {string} _k */
    getItem(_k) { throw new Error('private mode'); },
    /** @param {string} _k @param {string} _v */
    setItem(_k, _v) { throw new Error('quota'); },
    /** @param {string} _k */
    removeItem(_k) { throw new Error('private mode'); },
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
    /** @param {string} _k */
    removeItem(_k) { /* no-op */ },
  };
  const id = getOrCreateDeviceId(store, () => 'session-only-uuid');
  assert.equal(id, 'session-only-uuid');
});

// ---- Feature H1: legacy gridgame.player.id migration ----

test('migration: legacy player.id is adopted as deviceId when none exists, and the legacy key is removed', () => {
  const store = fakeStore({ [LEGACY_PLAYER_ID_KEY]: 'legacy-player-id-uuid' });
  const id = getOrCreateDeviceId(store, () => 'fresh-should-not-be-used');
  assert.equal(id, 'legacy-player-id-uuid');
  assert.equal(store._map.get('gridgame.deviceId'), 'legacy-player-id-uuid');
  assert.equal(store._map.has(LEGACY_PLAYER_ID_KEY), false);
});

test('migration: when both keys exist, deviceId wins and the legacy key is removed', () => {
  const store = fakeStore({
    'gridgame.deviceId': 'existing-device-id',
    [LEGACY_PLAYER_ID_KEY]: 'legacy-player-id-uuid',
  });
  const id = getOrCreateDeviceId(store, () => 'fresh-should-not-be-used');
  assert.equal(id, 'existing-device-id');
  assert.equal(store._map.get('gridgame.deviceId'), 'existing-device-id');
  assert.equal(store._map.has(LEGACY_PLAYER_ID_KEY), false);
});

test('migration: no legacy key is a no-op (does not touch deviceId)', () => {
  const store = fakeStore({ 'gridgame.deviceId': 'existing-device-id' });
  const id = getOrCreateDeviceId(store, () => 'fresh-should-not-be-used');
  assert.equal(id, 'existing-device-id');
  assert.equal(store._map.size, 1);
});

test('migration: legacy value too short gets adopted then immediately re-minted by the length validator', () => {
  // The migration is intentionally trusting — it copies the legacy value
  // verbatim. The existing 8-64 validator then rejects it and mints a fresh
  // one. End result: a too-short legacy id can never survive into deviceId.
  const store = fakeStore({ [LEGACY_PLAYER_ID_KEY]: 'short' });
  const id = getOrCreateDeviceId(store, () => 'fresh-uuid-aaaaaaaa');
  assert.equal(id, 'fresh-uuid-aaaaaaaa');
  assert.equal(store._map.get('gridgame.deviceId'), 'fresh-uuid-aaaaaaaa');
  assert.equal(store._map.has(LEGACY_PLAYER_ID_KEY), false);
});

test('migration: storage throwing during migration is swallowed; a fresh id is still returned', () => {
  const store = throwingStore();
  const id = getOrCreateDeviceId(store, () => 'session-only-uuid');
  assert.equal(id, 'session-only-uuid');
});

test('uses crypto.randomUUID-shaped id correctly (sanity check)', () => {
  const store = fakeStore();
  const id = getOrCreateDeviceId(store, () => 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee');
  assert.equal(id, 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee');
  assert.equal(id.length, 36);
});

// ---- Feature W: restoreOrCreateDeviceId (durable identity) ----

test('restore: existing local id is returned without hitting the network', async () => {
  const store = fakeStore({ 'gridgame.deviceId': 'already-here-1234' });
  const { fetchImpl, calls } = fakeFetch({ whoami: 'cookie-id-should-not-win' });
  const res = await restoreOrCreateDeviceId(store, () => 'fresh', fetchImpl);
  assert.deepEqual(res, { deviceId: 'already-here-1234', restored: false });
  assert.equal(calls(), 0); // fast path: never called /whoami
});

test('restore: no local id + cookie present → adopt the cookie id, restored:true', async () => {
  const store = fakeStore();
  const { fetchImpl, calls } = fakeFetch({ whoami: 'restored-from-cookie-1' });
  const res = await restoreOrCreateDeviceId(store, () => 'fresh-should-not-be-used', fetchImpl);
  assert.deepEqual(res, { deviceId: 'restored-from-cookie-1', restored: true });
  // Adopted id is written back to localStorage so later sync calls see it.
  assert.equal(store._map.get('gridgame.deviceId'), 'restored-from-cookie-1');
  assert.equal(calls(), 1);
});

test('restore: no local id + no cookie → mint fresh, restored:false', async () => {
  const store = fakeStore();
  const { fetchImpl } = fakeFetch({ whoami: null });
  const res = await restoreOrCreateDeviceId(store, () => 'freshly-minted-uuid', fetchImpl);
  assert.deepEqual(res, { deviceId: 'freshly-minted-uuid', restored: false });
  assert.equal(store._map.get('gridgame.deviceId'), 'freshly-minted-uuid');
});

test('restore: /whoami network error → mint fresh, never throws', async () => {
  const store = fakeStore();
  const { fetchImpl } = fakeFetch({ throws: true });
  const res = await restoreOrCreateDeviceId(store, () => 'fresh-after-error', fetchImpl);
  assert.deepEqual(res, { deviceId: 'fresh-after-error', restored: false });
});

test('restore: /whoami non-2xx → mint fresh (cookie treated as absent)', async () => {
  const store = fakeStore();
  const { fetchImpl } = fakeFetch({ whoami: 'ignored-because-not-ok', ok: false });
  const res = await restoreOrCreateDeviceId(store, () => 'fresh-on-500', fetchImpl);
  assert.deepEqual(res, { deviceId: 'fresh-on-500', restored: false });
});

test('restore: a too-short cookie id is rejected → mint fresh instead of adopting junk', async () => {
  const store = fakeStore();
  const { fetchImpl } = fakeFetch({ whoami: 'short' });
  const res = await restoreOrCreateDeviceId(store, () => 'fresh-valid-uuid-aaaa', fetchImpl);
  assert.deepEqual(res, { deviceId: 'fresh-valid-uuid-aaaa', restored: false });
});

test('restore: legacy player.id still migrates ahead of the cookie path', async () => {
  const store = fakeStore({ [LEGACY_PLAYER_ID_KEY]: 'legacy-player-id-uuid' });
  const { fetchImpl, calls } = fakeFetch({ whoami: 'cookie-should-not-win' });
  const res = await restoreOrCreateDeviceId(store, () => 'fresh', fetchImpl);
  assert.deepEqual(res, { deviceId: 'legacy-player-id-uuid', restored: false });
  assert.equal(calls(), 0); // legacy adopt = local hit, no network
});
