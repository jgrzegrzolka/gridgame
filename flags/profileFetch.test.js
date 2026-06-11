import { test } from 'node:test';
import assert from 'node:assert/strict';

import { fetchProfile } from './profileFetch.js';

const DEVICE = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

/** @param {{ status?: number, json?: any, throws?: boolean }} [opts] */
function fakeFetch(opts = {}) {
  /** @type {Array<{ url: string }>} */
  const calls = [];
  /** @type {any} */
  const impl = async (/** @type {string} */ url) => {
    calls.push({ url });
    if (opts.throws) throw new Error('network');
    const status = opts.status ?? 200;
    return {
      status,
      async json() { return opts.json; },
    };
  };
  return { impl, calls };
}

test('fetchProfile: 200 with nickname returns ok+nickname and URL-encodes the id', async () => {
  const fetcher = fakeFetch({ status: 200, json: { deviceId: DEVICE, nickname: 'Alice' } });
  const r = await fetchProfile({ deviceId: DEVICE, fetchImpl: fetcher.impl });
  assert.deepEqual(r, { ok: true, nickname: 'Alice' });
  assert.equal(fetcher.calls[0].url, `/api/v1/profile?id=${encodeURIComponent(DEVICE)}`);
});

test('fetchProfile: 200 with null nickname (no row) returns ok+null', async () => {
  // Normal state for any device that never visited /profile/ — the
  // client falls back to the deterministic default via displayNickname.
  const fetcher = fakeFetch({ status: 200, json: { deviceId: DEVICE, nickname: null } });
  const r = await fetchProfile({ deviceId: DEVICE, fetchImpl: fetcher.impl });
  assert.deepEqual(r, { ok: true, nickname: null });
});

test('fetchProfile: network error → { ok: false, reason: "network_error" }', async () => {
  const fetcher = fakeFetch({ throws: true });
  const r = await fetchProfile({ deviceId: DEVICE, fetchImpl: fetcher.impl });
  assert.deepEqual(r, { ok: false, reason: 'network_error' });
});

test('fetchProfile: non-200 with server error code propagates', async () => {
  const fetcher = fakeFetch({ status: 400, json: { error: 'invalid_id' } });
  const r = await fetchProfile({ deviceId: 'short', fetchImpl: fetcher.impl });
  assert.deepEqual(r, { ok: false, reason: 'invalid_id' });
});

test('fetchProfile: never throws — every failure path resolves with an outcome', async () => {
  await assert.doesNotReject(fetchProfile({
    deviceId: DEVICE, fetchImpl: fakeFetch({ throws: true }).impl,
  }));
  await assert.doesNotReject(fetchProfile({
    deviceId: DEVICE, fetchImpl: fakeFetch({ status: 500 }).impl,
  }));
});
