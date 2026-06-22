import test from 'node:test';
import assert from 'node:assert/strict';

import { pullSyncBlob, pushSyncBlob } from './syncBlob.js';

const DEV_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

/** @param {{ status?: number, json?: any, throws?: boolean, invalidJson?: boolean }} [opts] */
function fakeFetch(opts = {}) {
  /** @type {Array<{ url: string, init?: any }>} */
  const calls = [];
  /** @type {any} */
  const impl = async (/** @type {string} */ url, /** @type {any} */ init) => {
    calls.push({ url, init });
    if (opts.throws) throw new Error('network');
    return {
      status: opts.status ?? 200,
      async json() {
        if (opts.invalidJson) throw new Error('not json');
        return opts.json;
      },
    };
  };
  return { impl, calls };
}

// ---------------------------------------------------------------------------
// pullSyncBlob — read path goes through the existing /api/v1/sync/hydrate
// endpoint, which already returns daily/quiz/nickname alongside the blob.
// ---------------------------------------------------------------------------

test('pullSyncBlob: GETs /api/v1/sync/hydrate with deviceId and returns the blob', async () => {
  const blob = { engagement: { shareCount: 5 } };
  const f = fakeFetch({ status: 200, json: { daily: [], records: {}, nickname: null, syncBlob: blob } });
  const r = await pullSyncBlob(DEV_ID, { fetchImpl: f.impl });
  assert.deepEqual(r, { ok: true, blob });
  assert.equal(f.calls[0].url, `/api/v1/sync/hydrate?deviceId=${encodeURIComponent(DEV_ID)}`);
});

test('pullSyncBlob: null syncBlob is a successful pull (device has never written one)', async () => {
  // Server sends null for legacy devices / fresh installs. That's not a
  // failure — the caller branches on `blob === null` to decide whether
  // to initialise localStorage from server state or start fresh.
  const f = fakeFetch({ status: 200, json: { daily: [], records: {}, nickname: null, syncBlob: null } });
  const r = await pullSyncBlob(DEV_ID, { fetchImpl: f.impl });
  assert.deepEqual(r, { ok: true, blob: null });
});

test('pullSyncBlob: array / primitive syncBlob (malformed) → null, still ok:true', async () => {
  // Defensive coercion: a hand-edited row or future drift could ship a
  // non-object. Returning null + ok:true means the caller sees the same
  // shape as "no blob yet" — they fall back to their own initial state.
  for (const bad of [['arr'], 42, 'str', true]) {
    const f = fakeFetch({ status: 200, json: { syncBlob: bad } });
    const r = await pullSyncBlob(DEV_ID, { fetchImpl: f.impl });
    assert.deepEqual(r, { ok: true, blob: null }, `bad=${JSON.stringify(bad)}`);
  }
});

test('pullSyncBlob: non-200 → ok:false with http_<status>', async () => {
  for (const status of [400, 429, 500, 503]) {
    const f = fakeFetch({ status });
    const r = await pullSyncBlob(DEV_ID, { fetchImpl: f.impl });
    assert.deepEqual(r, { ok: false, reason: `http_${status}` }, `status=${status}`);
  }
});

test('pullSyncBlob: network throw → ok:false network_error (never throws upward)', async () => {
  const f = fakeFetch({ throws: true });
  const r = await pullSyncBlob(DEV_ID, { fetchImpl: f.impl });
  assert.deepEqual(r, { ok: false, reason: 'network_error' });
});

test('pullSyncBlob: 200 with non-JSON body → ok:false invalid_json', async () => {
  const f = fakeFetch({ status: 200, invalidJson: true });
  const r = await pullSyncBlob(DEV_ID, { fetchImpl: f.impl });
  assert.deepEqual(r, { ok: false, reason: 'invalid_json' });
});

test('pullSyncBlob: invalid deviceId rejected without firing', async () => {
  const f = fakeFetch({});
  const r = await pullSyncBlob('', { fetchImpl: f.impl });
  assert.deepEqual(r, { ok: false, reason: 'invalid_deviceId' });
  assert.equal(f.calls.length, 0);
});

// ---------------------------------------------------------------------------
// pushSyncBlob — write path goes through /api/v1/profile/sync-blob.
// ---------------------------------------------------------------------------

test('pushSyncBlob: POSTs the blob with deviceId and resolves ok:true on 204', async () => {
  const blob = { engagement: { shareCount: 7 } };
  const f = fakeFetch({ status: 204 });
  const r = await pushSyncBlob(DEV_ID, blob, { fetchImpl: f.impl });
  assert.deepEqual(r, { ok: true });
  assert.equal(f.calls[0].url, '/api/v1/profile/sync-blob');
  assert.equal(f.calls[0].init.method, 'POST');
  assert.equal(f.calls[0].init.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(f.calls[0].init.body), { deviceId: DEV_ID, blob });
});

test('pushSyncBlob: empty object {} is a valid blob (clearing all counters is legal)', async () => {
  // A user who hasn't earned anything yet still pushes their state —
  // {} is the canonical "nothing to sync but I'm reporting in" shape
  // and must round-trip cleanly through validation.
  const f = fakeFetch({ status: 204 });
  const r = await pushSyncBlob(DEV_ID, {}, { fetchImpl: f.impl });
  assert.deepEqual(r, { ok: true });
});

test('pushSyncBlob: non-object blob rejected locally without firing', async () => {
  // Local guard mirrors the server-side check. Failing here surfaces
  // the bug to the caller's stack instead of a generic HTTP error and
  // saves a useless round-trip.
  for (const bad of [null, ['arr'], 42, 'str', true]) {
    const f = fakeFetch({});
    const r = await pushSyncBlob(DEV_ID, /** @type {any} */ (bad), { fetchImpl: f.impl });
    assert.deepEqual(r, { ok: false, reason: 'invalid_blob' });
    assert.equal(f.calls.length, 0, `bad=${JSON.stringify(bad)}`);
  }
});

test('pushSyncBlob: non-204 success-shape → ok:false with server-supplied reason', async () => {
  // Server signalling a problem (413 blob_too_large, 429 rate_limited)
  // should reach the caller verbatim so they can decide to retry,
  // shrink the blob, etc.
  const f = fakeFetch({ status: 413, json: { error: 'blob_too_large' } });
  const r = await pushSyncBlob(DEV_ID, { x: 1 }, { fetchImpl: f.impl });
  assert.deepEqual(r, { ok: false, reason: 'blob_too_large' });
});

test('pushSyncBlob: non-204 without parsable body → http_<status>', async () => {
  const f = fakeFetch({ status: 500, invalidJson: true });
  const r = await pushSyncBlob(DEV_ID, { x: 1 }, { fetchImpl: f.impl });
  assert.deepEqual(r, { ok: false, reason: 'http_500' });
});

test('pushSyncBlob: network throw → ok:false network_error (never throws upward)', async () => {
  const f = fakeFetch({ throws: true });
  const r = await pushSyncBlob(DEV_ID, { x: 1 }, { fetchImpl: f.impl });
  assert.deepEqual(r, { ok: false, reason: 'network_error' });
});

test('pushSyncBlob: invalid deviceId rejected without firing', async () => {
  const f = fakeFetch({});
  const r = await pushSyncBlob('', { x: 1 }, { fetchImpl: f.impl });
  assert.deepEqual(r, { ok: false, reason: 'invalid_deviceId' });
  assert.equal(f.calls.length, 0);
});
