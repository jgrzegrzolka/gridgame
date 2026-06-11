import { test } from 'node:test';
import assert from 'node:assert/strict';

import { fetchTttPair } from './tttPairFetch.js';

const DEVICE = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const OPP = '11111111-2222-3333-4444-555555555555';

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

test('fetchTttPair: 200 with full row returns it verbatim with URL-encoded params', async () => {
  const fetcher = fakeFetch({
    status: 200,
    json: {
      deviceId: DEVICE, opponentId: OPP,
      m3x3: { wins: 3, losses: 2, draws: 1 },
      m9x9: { wins: 0, losses: 1, draws: 0 },
      lastPlayedAt: 1_700_000_000_000,
    },
  });
  const r = await fetchTttPair({ deviceId: DEVICE, opponentId: OPP, fetchImpl: fetcher.impl });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.row.m3x3.wins, 3);
  assert.equal(r.row.m9x9.losses, 1);
  assert.equal(r.row.lastPlayedAt, 1_700_000_000_000);
  assert.equal(fetcher.calls[0].url,
    `/api/v1/ttt/result?deviceId=${encodeURIComponent(DEVICE)}&opponentId=${encodeURIComponent(OPP)}`);
});

test('fetchTttPair: empty-pair server response (server returns zero counters) normalises cleanly', async () => {
  const fetcher = fakeFetch({
    status: 200,
    json: {
      deviceId: DEVICE, opponentId: OPP,
      m3x3: { wins: 0, losses: 0, draws: 0 },
      m9x9: { wins: 0, losses: 0, draws: 0 },
      lastPlayedAt: null,
    },
  });
  const r = await fetchTttPair({ deviceId: DEVICE, opponentId: OPP, fetchImpl: fetcher.impl });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.deepEqual(r.row.m3x3, { wins: 0, losses: 0, draws: 0 });
  assert.equal(r.row.lastPlayedAt, null);
});

test('fetchTttPair: partial / garbage server row is defensively zeroed out', async () => {
  const fetcher = fakeFetch({
    status: 200,
    json: { deviceId: DEVICE, opponentId: OPP, m3x3: { wins: 'lots', losses: -5 } },
  });
  const r = await fetchTttPair({ deviceId: DEVICE, opponentId: OPP, fetchImpl: fetcher.impl });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.deepEqual(r.row.m3x3, { wins: 0, losses: 0, draws: 0 });
  assert.deepEqual(r.row.m9x9, { wins: 0, losses: 0, draws: 0 });
});

test('fetchTttPair: network error → { ok: false, reason: "network_error" }', async () => {
  const fetcher = fakeFetch({ throws: true });
  const r = await fetchTttPair({ deviceId: DEVICE, opponentId: OPP, fetchImpl: fetcher.impl });
  assert.deepEqual(r, { ok: false, reason: 'network_error' });
});

test('fetchTttPair: server error code propagates', async () => {
  const fetcher = fakeFetch({ status: 400, json: { error: 'self_match' } });
  const r = await fetchTttPair({ deviceId: DEVICE, opponentId: DEVICE, fetchImpl: fetcher.impl });
  assert.deepEqual(r, { ok: false, reason: 'self_match' });
});

test('fetchTttPair: never throws — every failure path resolves with an outcome', async () => {
  await assert.doesNotReject(fetchTttPair({
    deviceId: DEVICE, opponentId: OPP, fetchImpl: fakeFetch({ throws: true }).impl,
  }));
  await assert.doesNotReject(fetchTttPair({
    deviceId: DEVICE, opponentId: OPP, fetchImpl: fakeFetch({ status: 500 }).impl,
  }));
});
