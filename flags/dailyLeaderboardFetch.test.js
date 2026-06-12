import { test } from 'node:test';
import assert from 'node:assert/strict';

import { fetchLeaderboard } from './dailyLeaderboardFetch.js';

const DEVICE = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const CONFIG = 'europe:60s:sov';

/** @param {{ status?: number, json?: any, throws?: boolean, invalidJson?: boolean }} [opts] */
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
      async json() {
        if (opts.invalidJson) throw new Error('not json');
        return opts.json;
      },
    };
  };
  return { impl, calls };
}

test('fetchLeaderboard: builds URL with deviceId + fresh=1', async () => {
  const f = fakeFetch({ status: 200, json: { configKey: CONFIG, date: '2026-06-12', top: [], you: null } });
  await fetchLeaderboard({ configKey: CONFIG, deviceId: DEVICE, fresh: true, fetchImpl: f.impl });
  assert.equal(
    f.calls[0].url,
    `/api/v1/quiz/leaderboard/${encodeURIComponent(CONFIG)}?deviceId=${encodeURIComponent(DEVICE)}&fresh=1`,
  );
});

test('fetchLeaderboard: URL omits deviceId when not supplied', async () => {
  const f = fakeFetch({ status: 200, json: { configKey: CONFIG, date: '2026-06-12', top: [], you: null } });
  await fetchLeaderboard({ configKey: CONFIG, fetchImpl: f.impl });
  assert.equal(f.calls[0].url, `/api/v1/quiz/leaderboard/${encodeURIComponent(CONFIG)}`);
});

test('fetchLeaderboard: URL includes ?date= when supplied', async () => {
  const f = fakeFetch({ status: 200, json: { configKey: CONFIG, date: '2026-06-10', top: [], you: null } });
  await fetchLeaderboard({ configKey: CONFIG, date: '2026-06-10', fetchImpl: f.impl });
  assert.match(f.calls[0].url, /date=2026-06-10/);
});

test('fetchLeaderboard: normalises top entries — drops malformed rows, defaults missing fields', async () => {
  const json = {
    configKey: CONFIG, date: '2026-06-12',
    top: [
      { deviceId: 'd1', nickname: 'Alice', score: 18, durationMs: 32_400, submittedAt: 123 },
      { deviceId: 'd2', nickname: null, score: 17, durationMs: 40_000 }, // no submittedAt
      { deviceId: 'd3', nickname: 42, score: 16, durationMs: 50_000 },   // non-string nickname → null
      { /* missing deviceId */ score: 15, durationMs: 60_000 },          // dropped
      'not even an object',                                              // dropped
    ],
    you: null,
  };
  const f = fakeFetch({ status: 200, json });
  const r = await fetchLeaderboard({ configKey: CONFIG, fetchImpl: f.impl });
  assert.equal(r.ok, true);
  if (!r.ok) throw new Error('unreachable');
  assert.equal(r.top.length, 3);
  assert.equal(r.top[0].nickname, 'Alice');
  assert.equal(r.top[0].submittedAt, 123);
  assert.equal(r.top[1].submittedAt, 0);   // defaulted
  assert.equal(r.top[2].nickname, null);   // coerced
});

test('fetchLeaderboard: normalises you — drops malformed shape', async () => {
  const f = fakeFetch({
    status: 200,
    json: {
      configKey: CONFIG, date: '2026-06-12', top: [],
      you: { rank: 'not a number', score: 5, durationMs: 30_000 },
    },
  });
  const r = await fetchLeaderboard({ configKey: CONFIG, fetchImpl: f.impl });
  assert.equal(r.ok, true);
  if (!r.ok) throw new Error('unreachable');
  assert.equal(r.you, null);
});

test('fetchLeaderboard: network error → { ok: false, reason: "network_error" }', async () => {
  const f = fakeFetch({ throws: true });
  const r = await fetchLeaderboard({ configKey: CONFIG, fetchImpl: f.impl });
  assert.deepEqual(r, { ok: false, reason: 'network_error' });
});

test('fetchLeaderboard: non-200 with server error code propagates', async () => {
  const f = fakeFetch({ status: 400, json: { error: 'invalid_configKey' } });
  const r = await fetchLeaderboard({ configKey: 'BAD', fetchImpl: f.impl });
  assert.deepEqual(r, { ok: false, reason: 'invalid_configKey' });
});

test('fetchLeaderboard: 200 with non-JSON body → invalid_json', async () => {
  const f = fakeFetch({ status: 200, invalidJson: true });
  const r = await fetchLeaderboard({ configKey: CONFIG, fetchImpl: f.impl });
  assert.deepEqual(r, { ok: false, reason: 'invalid_json' });
});

test('fetchLeaderboard: never throws — all paths resolve with an outcome', async () => {
  await assert.doesNotReject(fetchLeaderboard({ configKey: CONFIG, fetchImpl: fakeFetch({ throws: true }).impl }));
  await assert.doesNotReject(fetchLeaderboard({ configKey: CONFIG, fetchImpl: fakeFetch({ status: 500 }).impl }));
  await assert.doesNotReject(fetchLeaderboard({ configKey: CONFIG, fetchImpl: fakeFetch({ status: 200, invalidJson: true }).impl }));
});
