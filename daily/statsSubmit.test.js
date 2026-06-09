import { test } from 'node:test';
import assert from 'node:assert/strict';

import { submitResult } from './statsSubmit.js';

function fakeStore(initial = {}) {
  /** @type {Map<string, string>} */
  const m = new Map(Object.entries(initial));
  return {
    /** @param {string} k */
    getItem(k) { return m.has(k) ? /** @type {string} */ (m.get(k)) : null; },
    /** @param {string} k @param {string} v */
    setItem(k, v) { m.set(k, v); },
    _map: m,
  };
}

const baseArgs = {
  n: 7,
  foundCodes: ['ch', 'dk'],
  totalCount: 9,
  durationMs: 87_000,
  deviceId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  turnstileToken: 'fake-cf-token',
};

const fakeRes = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

test('returns "already" without POSTing when gate says so', async () => {
  const store = fakeStore({ 'gridgame.submittedPuzzles': '[7]' });
  let called = false;
  const r = await submitResult({
    ...baseArgs, store,
    fetchImpl: async () => { called = true; return fakeRes(204, null); },
  });
  assert.deepEqual(r, { outcome: 'already' });
  assert.equal(called, false);
});

test('returns "ok" and marks submitted on 204', async () => {
  const store = fakeStore();
  const r = await submitResult({
    ...baseArgs, store, fetchImpl: async () => fakeRes(204, null),
  });
  assert.deepEqual(r, { outcome: 'ok' });
  assert.equal(store._map.get('gridgame.submittedPuzzles'), '[7]');
});

test('treats 409 as success (already-on-server is the same end state)', async () => {
  const store = fakeStore();
  const r = await submitResult({
    ...baseArgs, store, fetchImpl: async () => fakeRes(409, { error: 'already_submitted' }),
  });
  assert.deepEqual(r, { outcome: 'ok' });
  assert.equal(store._map.get('gridgame.submittedPuzzles'), '[7]');
});

test('4xx with a server error code surfaces that code as reason', async () => {
  const store = fakeStore();
  const r = await submitResult({
    ...baseArgs, store,
    fetchImpl: async () => fakeRes(403, { error: 'turnstile_failed' }),
  });
  assert.deepEqual(r, { outcome: 'failed', reason: 'turnstile_failed' });
  assert.equal(store._map.has('gridgame.submittedPuzzles'), false);
});

test('429 rate-limit response surfaces rate_limited as reason', async () => {
  const store = fakeStore();
  const r = await submitResult({
    ...baseArgs, store,
    fetchImpl: async () => fakeRes(429, { error: 'rate_limited' }),
  });
  assert.deepEqual(r, { outcome: 'failed', reason: 'rate_limited' });
});

test('4xx with no parseable body falls back to http_<status>', async () => {
  const store = fakeStore();
  const r = await submitResult({
    ...baseArgs, store,
    fetchImpl: async () => ({
      ok: false, status: 400,
      json: async () => { throw new Error('not json'); },
    }),
  });
  assert.deepEqual(r, { outcome: 'failed', reason: 'http_400' });
});

test('fetch throws (network failure) → reason: network_error', async () => {
  const store = fakeStore();
  const r = await submitResult({
    ...baseArgs, store,
    fetchImpl: async () => { throw new Error('connection refused'); },
  });
  assert.deepEqual(r, { outcome: 'failed', reason: 'network_error' });
});

test('POSTs to /api/v1/daily/result with the right body', async () => {
  const store = fakeStore();
  let captured;
  await submitResult({
    ...baseArgs, store,
    fetchImpl: async (url, init) => {
      captured = { url, init };
      return fakeRes(204, null);
    },
  });
  assert.equal(captured.url, '/api/v1/daily/result');
  assert.equal(captured.init.method, 'POST');
  assert.equal(captured.init.headers['content-type'], 'application/json');
  const body = JSON.parse(captured.init.body);
  assert.deepEqual(body, {
    puzzleId: 7,
    foundCodes: ['ch', 'dk'],
    totalCount: 9,
    durationMs: 87000,
    deviceId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    turnstileToken: 'fake-cf-token',
  });
});

test('failure does NOT mark submitted (so a retry on the next visit is possible)', async () => {
  const store = fakeStore();
  await submitResult({
    ...baseArgs, store, fetchImpl: async () => fakeRes(500, { error: 'server_error' }),
  });
  assert.equal(store._map.has('gridgame.submittedPuzzles'), false);
});
