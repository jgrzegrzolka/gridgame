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
  const f = fakeFetch({ status: 200, json: { top: [], you: null } });
  await fetchLeaderboard({ configKey: CONFIG, deviceId: DEVICE, fresh: true, fetchImpl: f.impl });
  assert.equal(
    f.calls[0].url,
    `/api/v1/quiz/leaderboard/${encodeURIComponent(CONFIG)}?deviceId=${encodeURIComponent(DEVICE)}&fresh=1`,
  );
});

test('fetchLeaderboard: omits fresh when not requested', async () => {
  const f = fakeFetch({ status: 200, json: { top: [], you: null } });
  await fetchLeaderboard({ configKey: CONFIG, deviceId: DEVICE, fetchImpl: f.impl });
  assert.equal(
    f.calls[0].url,
    `/api/v1/quiz/leaderboard/${encodeURIComponent(CONFIG)}?deviceId=${encodeURIComponent(DEVICE)}`,
  );
});

test('fetchLeaderboard: normalises top entries — drops malformed rows, defaults missing fields', async () => {
  const json = {
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
  const r = await fetchLeaderboard({ configKey: CONFIG, deviceId: DEVICE, fetchImpl: f.impl });
  assert.equal(r.ok, true);
  if (!r.ok) throw new Error('unreachable');
  assert.equal(r.top.length, 3);
  assert.equal(r.top[0].nickname, 'Alice');
  assert.equal(r.top[0].submittedAt, 123);
  assert.equal(r.top[1].submittedAt, 0);   // defaulted
  assert.equal(r.top[2].nickname, null);   // coerced
});

test('fetchLeaderboard: nicknameAuto — true only when the row explicitly carries true', async () => {
  // Defensive coercion: server contract says boolean, but a legacy row /
  // proxy / cache could ship the field as anything. The renderer keys on
  // strict equality so an oddly-typed value defaults to "not auto" rather
  // than decorating a real nickname with the auto hint.
  const json = {
    top: [
      { deviceId: 'd1', nickname: 'Alice', nicknameAuto: false,    score: 1, durationMs: 1 },
      { deviceId: 'd2', nickname: null,    nicknameAuto: true,     score: 2, durationMs: 2 },
      { deviceId: 'd3', nickname: null,                            score: 3, durationMs: 3 },
      { deviceId: 'd4', nickname: null,    nicknameAuto: 'true',   score: 4, durationMs: 4 },
    ],
    you: null,
  };
  const f = fakeFetch({ status: 200, json });
  const r = await fetchLeaderboard({ configKey: CONFIG, deviceId: DEVICE, fetchImpl: f.impl });
  assert.equal(r.ok, true);
  if (!r.ok) throw new Error('unreachable');
  assert.equal(r.top[0].nicknameAuto, false);
  assert.equal(r.top[1].nicknameAuto, true);
  assert.equal(r.top[2].nicknameAuto, false);    // missing → false (legacy row)
  assert.equal(r.top[3].nicknameAuto, false);    // wrong type → false (defensive)
});

test('fetchLeaderboard: payload with no top key → top: []', async () => {
  // Server-contract violation handled defensively so the renderer never
  // sees an undefined .top.
  const f = fakeFetch({ status: 200, json: {} });
  const r = await fetchLeaderboard({ configKey: CONFIG, deviceId: DEVICE, fetchImpl: f.impl });
  assert.equal(r.ok, true);
  if (!r.ok) throw new Error('unreachable');
  assert.deepEqual(r.top, []);
  assert.equal(r.you, null);
});

test('fetchLeaderboard: normalises you — drops malformed shape', async () => {
  const f = fakeFetch({
    status: 200,
    json: { top: [], you: { rank: 'not a number', score: 5, durationMs: 30_000 } },
  });
  const r = await fetchLeaderboard({ configKey: CONFIG, deviceId: DEVICE, fetchImpl: f.impl });
  assert.equal(r.ok, true);
  if (!r.ok) throw new Error('unreachable');
  assert.equal(r.you, null);
});

test('fetchLeaderboard: network error → { ok: false, reason: "network_error" }', async () => {
  const f = fakeFetch({ throws: true });
  const r = await fetchLeaderboard({ configKey: CONFIG, deviceId: DEVICE, fetchImpl: f.impl });
  assert.deepEqual(r, { ok: false, reason: 'network_error' });
});

test('fetchLeaderboard: non-200 with server error code propagates', async () => {
  const f = fakeFetch({ status: 400, json: { error: 'invalid_configKey' } });
  const r = await fetchLeaderboard({ configKey: 'BAD', deviceId: DEVICE, fetchImpl: f.impl });
  assert.deepEqual(r, { ok: false, reason: 'invalid_configKey' });
});

test('fetchLeaderboard: 200 with non-JSON body → invalid_json', async () => {
  const f = fakeFetch({ status: 200, invalidJson: true });
  const r = await fetchLeaderboard({ configKey: CONFIG, deviceId: DEVICE, fetchImpl: f.impl });
  assert.deepEqual(r, { ok: false, reason: 'invalid_json' });
});

test('fetchLeaderboard: never throws — all paths resolve with an outcome', async () => {
  await assert.doesNotReject(fetchLeaderboard({ configKey: CONFIG, deviceId: DEVICE, fetchImpl: fakeFetch({ throws: true }).impl }));
  await assert.doesNotReject(fetchLeaderboard({ configKey: CONFIG, deviceId: DEVICE, fetchImpl: fakeFetch({ status: 500 }).impl }));
  await assert.doesNotReject(fetchLeaderboard({ configKey: CONFIG, deviceId: DEVICE, fetchImpl: fakeFetch({ status: 200, invalidJson: true }).impl }));
});
