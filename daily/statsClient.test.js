import { test } from 'node:test';
import assert from 'node:assert/strict';

import { fetchStats } from './statsClient.js';

const fakeRes = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

// No-op sleep so retry tests don't actually wait.
const noSleep = async () => {};

test('successful fetch returns parsed JSON', async () => {
  const stats = await fetchStats(7, {
    fetchImpl: async () => fakeRes(200, { totalAttempts: 10, perCodeFinds: { ch: 8 }, mean: 2, topPct: 12 }),
  });
  assert.deepEqual(stats, { totalAttempts: 10, perCodeFinds: { ch: 8 }, mean: 2, topPct: 12 });
});

test('success returns immediately — no retry, one request', async () => {
  let calls = 0;
  await fetchStats(7, { sleepImpl: noSleep, fetchImpl: async () => { calls++; return fakeRes(200, {}); } });
  assert.equal(calls, 1);
});

test('5xx is retried, then gives up → null (retries + 1 requests)', async () => {
  let calls = 0;
  const stats = await fetchStats(7, {
    retries: 2,
    sleepImpl: noSleep,
    fetchImpl: async () => { calls++; return fakeRes(500, { error: 'server_error' }); },
  });
  assert.equal(stats, null);
  assert.equal(calls, 3); // initial + 2 retries
});

test('5xx then 200 → the retry succeeds and returns the stats', async () => {
  let calls = 0;
  const stats = await fetchStats(7, {
    retries: 2,
    sleepImpl: noSleep,
    fetchImpl: async () => {
      calls++;
      return calls < 2 ? fakeRes(503, {}) : fakeRes(200, { totalAttempts: 5, perCodeFinds: {}, mean: 3, topPct: 40 });
    },
  });
  assert.deepEqual(stats, { totalAttempts: 5, perCodeFinds: {}, mean: 3, topPct: 40 });
  assert.equal(calls, 2);
});

test('4xx is deterministic — returns null WITHOUT retrying', async () => {
  let calls = 0;
  const stats = await fetchStats(7, {
    retries: 2,
    sleepImpl: noSleep,
    fetchImpl: async () => { calls++; return fakeRes(400, { error: 'bad_request' }); },
  });
  assert.equal(stats, null);
  assert.equal(calls, 1); // no retry on a client error
});

test('network error is retried, then gives up → null', async () => {
  let calls = 0;
  const stats = await fetchStats(7, {
    retries: 2,
    sleepImpl: noSleep,
    fetchImpl: async () => { calls++; throw new Error('offline'); },
  });
  assert.equal(stats, null);
  assert.equal(calls, 3);
});

test('network error then success → returns the stats', async () => {
  let calls = 0;
  const stats = await fetchStats(7, {
    retries: 2,
    sleepImpl: noSleep,
    fetchImpl: async () => {
      calls++;
      if (calls < 2) throw new Error('offline');
      return fakeRes(200, { totalAttempts: 1, perCodeFinds: {}, mean: 1, topPct: 0 });
    },
  });
  assert.equal(stats.totalAttempts, 1);
  assert.equal(calls, 2);
});

test('backoff grows per attempt (linear)', async () => {
  const waits = [];
  await fetchStats(7, {
    retries: 2,
    retryDelayMs: 500,
    sleepImpl: async (ms) => { waits.push(ms); },
    fetchImpl: async () => fakeRes(500, {}),
  });
  assert.deepEqual(waits, [500, 1000]); // one wait before each retry
});

test('retries: 0 disables retry (one request, then null on 5xx)', async () => {
  let calls = 0;
  const stats = await fetchStats(7, {
    retries: 0,
    sleepImpl: noSleep,
    fetchImpl: async () => { calls++; return fakeRes(500, {}); },
  });
  assert.equal(stats, null);
  assert.equal(calls, 1);
});

test('malformed JSON on a 200 → null (parse failure is treated as a fetch failure)', async () => {
  const stats = await fetchStats(7, {
    retries: 1,
    sleepImpl: noSleep,
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => { throw new Error('bad'); } }),
  });
  assert.equal(stats, null);
});

test('default request uses the bare URL with puzzleId in the path', async () => {
  let calledUrl = '';
  await fetchStats(42, {
    sleepImpl: noSleep,
    fetchImpl: async (url) => { calledUrl = url; return fakeRes(200, {}); },
  });
  assert.equal(calledUrl, '/api/v1/daily/stats/42');
});

test('bypassCache=true appends ?fresh=1', async () => {
  let calledUrl = '';
  await fetchStats(42, {
    bypassCache: true,
    sleepImpl: noSleep,
    fetchImpl: async (url) => { calledUrl = url; return fakeRes(200, {}); },
  });
  assert.equal(calledUrl, '/api/v1/daily/stats/42?fresh=1');
});

test('bypassCache=false (default) sends the bare URL', async () => {
  let calledUrl = '';
  await fetchStats(42, {
    bypassCache: false,
    sleepImpl: noSleep,
    fetchImpl: async (url) => { calledUrl = url; return fakeRes(200, {}); },
  });
  assert.equal(calledUrl, '/api/v1/daily/stats/42');
});
