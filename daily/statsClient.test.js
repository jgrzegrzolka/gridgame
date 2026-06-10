import { test } from 'node:test';
import assert from 'node:assert/strict';

import { fetchStats } from './statsClient.js';

const fakeRes = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

test('successful fetch returns parsed JSON', async () => {
  const stats = await fetchStats(7, {
    fetchImpl: async () => fakeRes(200, { totalAttempts: 10, perCodeFinds: { ch: 8 }, mean: 2, topPct: 12 }),
  });
  assert.deepEqual(stats, { totalAttempts: 10, perCodeFinds: { ch: 8 }, mean: 2, topPct: 12 });
});

test('non-2xx response returns null', async () => {
  const stats = await fetchStats(7, {
    fetchImpl: async () => fakeRes(500, { error: 'server_error' }),
  });
  assert.equal(stats, null);
});

test('fetch throwing (network error) returns null', async () => {
  const stats = await fetchStats(7, {
    fetchImpl: async () => { throw new Error('offline'); },
  });
  assert.equal(stats, null);
});

test('malformed JSON returns null', async () => {
  const stats = await fetchStats(7, {
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => { throw new Error('bad'); } }),
  });
  assert.equal(stats, null);
});

test('default request uses the bare URL with puzzleId in the path', async () => {
  let calledUrl = '';
  await fetchStats(42, {
    fetchImpl: async (url) => { calledUrl = url; return fakeRes(200, {}); },
  });
  assert.equal(calledUrl, '/api/v1/daily/stats/42');
});

test('bypassCache=true appends ?fresh=1', async () => {
  let calledUrl = '';
  await fetchStats(42, {
    bypassCache: true,
    fetchImpl: async (url) => { calledUrl = url; return fakeRes(200, {}); },
  });
  assert.equal(calledUrl, '/api/v1/daily/stats/42?fresh=1');
});

test('bypassCache=false (default) sends the bare URL', async () => {
  let calledUrl = '';
  await fetchStats(42, {
    bypassCache: false,
    fetchImpl: async (url) => { calledUrl = url; return fakeRes(200, {}); },
  });
  assert.equal(calledUrl, '/api/v1/daily/stats/42');
});
