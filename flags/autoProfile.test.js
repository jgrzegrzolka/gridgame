import test from 'node:test';
import assert from 'node:assert/strict';
import { ensureProfile, STORAGE_KEY } from './autoProfile.js';

const DEV_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

/**
 * Map-backed Store double — same shape as the real localStorage but
 * accessible from tests without jsdom.
 *
 * @returns {{ store: import('./autoProfile.js').Store & { _map: Map<string, string> } }}
 */
function makeStore() {
  const map = new Map();
  return {
    store: {
      _map: map,
      getItem: (k) => (map.has(k) ? /** @type {string} */ (map.get(k)) : null),
      setItem: (k, v) => { map.set(k, v); },
    },
  };
}

/**
 * @param {{ ok?: boolean, status?: number, throws?: boolean }} cfg
 */
function makeFetch(cfg) {
  /** @type {Array<{ url: string, init: any }>} */
  const calls = [];
  /** @param {any} url @param {any} init */
  const impl = async (url, init) => {
    calls.push({ url: String(url), init });
    if (cfg.throws) throw new Error('network down');
    return /** @type {any} */ ({
      ok: cfg.ok ?? true,
      status: cfg.status ?? 201,
    });
  };
  return { impl: /** @type {typeof fetch} */ (/** @type {any} */ (impl)), calls };
}

test('ensureProfile: posts to /api/v1/profile/ensure with deviceId on first call', async () => {
  const { store } = makeStore();
  const fetcher = makeFetch({ ok: true, status: 201 });
  const ok = await ensureProfile(DEV_ID, { store, fetchImpl: fetcher.impl });
  assert.equal(ok, true);
  assert.equal(fetcher.calls.length, 1);
  const call = fetcher.calls[0];
  assert.equal(call.url, '/api/v1/profile/ensure');
  assert.equal(call.init.method, 'POST');
  assert.equal(call.init.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(call.init.body), { deviceId: DEV_ID });
});

test('ensureProfile: sets the localStorage sentinel after a successful call', async () => {
  const { store } = makeStore();
  const fetcher = makeFetch({ ok: true, status: 201 });
  await ensureProfile(DEV_ID, { store, fetchImpl: fetcher.impl });
  assert.equal(store.getItem(STORAGE_KEY), '1');
});

test('ensureProfile: short-circuits without a fetch when sentinel is already set', async () => {
  // Once we've confirmed the row exists, every subsequent call across
  // page-loads / sessions should be a pure localStorage read. No HTTP
  // round-trip — this is the cost-saving point of the sentinel.
  const { store } = makeStore();
  store.setItem(STORAGE_KEY, '1');
  const fetcher = makeFetch({});
  const ok = await ensureProfile(DEV_ID, { store, fetchImpl: fetcher.impl });
  assert.equal(ok, true);
  assert.equal(fetcher.calls.length, 0);
});

test('ensureProfile: treats 200 (already-existed) as success and sets the sentinel', async () => {
  // The server returns 200 when the row already exists (idempotent
  // contract). Same postcondition as 201 — the sentinel must latch.
  const { store } = makeStore();
  const fetcher = makeFetch({ ok: true, status: 200 });
  const ok = await ensureProfile(DEV_ID, { store, fetchImpl: fetcher.impl });
  assert.equal(ok, true);
  assert.equal(store.getItem(STORAGE_KEY), '1');
});

test('ensureProfile: returns false and leaves the sentinel unset on non-OK status', async () => {
  // Any 4xx/5xx leaves the sentinel cleared so the next action retries —
  // the "did we already ensure" guard must reflect actual server state.
  for (const status of [400, 429, 500, 503]) {
    const { store } = makeStore();
    const fetcher = makeFetch({ ok: false, status });
    const ok = await ensureProfile(DEV_ID, { store, fetchImpl: fetcher.impl });
    assert.equal(ok, false, `status=${status}`);
    assert.equal(store.getItem(STORAGE_KEY), null, `status=${status}`);
  }
});

test('ensureProfile: never throws on network failure — returns false', async () => {
  const { store } = makeStore();
  const fetcher = makeFetch({ throws: true });
  const ok = await ensureProfile(DEV_ID, { store, fetchImpl: fetcher.impl });
  assert.equal(ok, false);
  assert.equal(store.getItem(STORAGE_KEY), null);
});

test('ensureProfile: rejects empty deviceId without firing', async () => {
  const { store } = makeStore();
  const fetcher = makeFetch({});
  const ok = await ensureProfile('', { store, fetchImpl: fetcher.impl });
  assert.equal(ok, false);
  assert.equal(fetcher.calls.length, 0);
});

test('ensureProfile: rejects non-string deviceId without firing', async () => {
  const { store } = makeStore();
  const fetcher = makeFetch({});
  const ok = await ensureProfile(/** @type {any} */ (null), { store, fetchImpl: fetcher.impl });
  assert.equal(ok, false);
  assert.equal(fetcher.calls.length, 0);
});

test('ensureProfile: still fires when no store is available (degrades to per-call POSTs)', async () => {
  // If localStorage is unavailable (SSR, private mode with quota=0), the
  // helper falls back to per-call POSTs. Server idempotency means this is
  // safe — same row, no churn.
  const fetcher = makeFetch({ ok: true, status: 200 });
  const ok = await ensureProfile(DEV_ID, { fetchImpl: fetcher.impl });
  assert.equal(ok, true);
  assert.equal(fetcher.calls.length, 1);
});
