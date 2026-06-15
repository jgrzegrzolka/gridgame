import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchDailyMe } from './streakClient.js';

/**
 * Helper: build a fake `fetch` that returns a single canned response and
 * records the URL it was called with.
 */
function fakeFetch({ ok = true, status = 200, body = null } = {}) {
  const calls = [];
  const fn = async (url) => {
    calls.push(String(url));
    return {
      ok,
      status,
      json: async () => body,
    };
  };
  fn.calls = calls;
  return fn;
}

const FULL = {
  currentStreak: 3,
  maxStreak: 7,
  winPercent: 82,
  totalPlayed: 11,
  totalCompleted: 9,
};

test('fetchDailyMe: happy path — passes deviceId, returns shape', async () => {
  const f = fakeFetch({ body: FULL });
  const out = await fetchDailyMe('dev-abc-123', { fetchImpl: f });
  assert.deepEqual(out, FULL);
  assert.ok(f.calls[0].includes('deviceId=dev-abc-123'));
  assert.ok(!f.calls[0].includes('fresh=1'));
});

test('fetchDailyMe: bypassCache appends ?fresh=1', async () => {
  const f = fakeFetch({ body: FULL });
  await fetchDailyMe('dev-abc', { bypassCache: true, fetchImpl: f });
  assert.ok(f.calls[0].includes('fresh=1'));
});

test('fetchDailyMe: missing deviceId returns null without calling fetch', async () => {
  const f = fakeFetch({ body: FULL });
  // @ts-ignore — intentional bad input
  const out = await fetchDailyMe('', { fetchImpl: f });
  assert.equal(out, null);
  assert.equal(f.calls.length, 0);
});

test('fetchDailyMe: non-2xx returns null', async () => {
  const f = fakeFetch({ ok: false, status: 500, body: { error: 'server_error' } });
  const out = await fetchDailyMe('dev-abc', { fetchImpl: f });
  assert.equal(out, null);
});

test('fetchDailyMe: thrown fetch returns null (network error)', async () => {
  const out = await fetchDailyMe('dev-abc', {
    fetchImpl: async () => { throw new Error('offline'); },
  });
  assert.equal(out, null);
});

test('fetchDailyMe: thrown json() returns null (malformed body)', async () => {
  const out = await fetchDailyMe('dev-abc', {
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => { throw new Error('not json'); },
    }),
  });
  assert.equal(out, null);
});

test('fetchDailyMe: non-object body returns null', async () => {
  const f = fakeFetch({ body: 'not an object' });
  const out = await fetchDailyMe('dev-abc', { fetchImpl: f });
  assert.equal(out, null);
});

test('fetchDailyMe: missing fields collapse to 0 (defensive shape)', async () => {
  const f = fakeFetch({ body: { currentStreak: 5 } });
  const out = await fetchDailyMe('dev-abc', { fetchImpl: f });
  assert.deepEqual(out, {
    currentStreak: 5,
    maxStreak: 0,
    winPercent: 0,
    totalPlayed: 0,
    totalCompleted: 0,
  });
});

test('fetchDailyMe: non-numeric field values collapse to 0', async () => {
  const f = fakeFetch({
    body: {
      currentStreak: 'abc',
      maxStreak: null,
      winPercent: undefined,
      totalPlayed: NaN,
      totalCompleted: 4,
    },
  });
  const out = await fetchDailyMe('dev-abc', { fetchImpl: f });
  assert.deepEqual(out, {
    currentStreak: 0,
    maxStreak: 0,
    winPercent: 0,
    totalPlayed: 0,
    totalCompleted: 4,
  });
});

test('fetchDailyMe: float fields truncate to int', async () => {
  const f = fakeFetch({ body: { ...FULL, winPercent: 82.7, currentStreak: 3.9 } });
  const out = await fetchDailyMe('dev-abc', { fetchImpl: f });
  assert.equal(out.winPercent, 82);
  assert.equal(out.currentStreak, 3);
});
