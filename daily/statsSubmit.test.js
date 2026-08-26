import { test } from 'node:test';
import assert from 'node:assert/strict';

import { submitResult, flushPendingSubmits } from './statsSubmit.js';
import { loadPending, MAX_ATTEMPTS } from './pendingSubmit.js';

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
  wrongCodes: ['de', 'fr'],
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

// No-op sleep so retry tests don't actually wait.
const noSleep = async () => {};

test('always POSTs even when locally marked submitted (server handles dedup)', async () => {
  // Earlier implementation gated on hasSubmitted to avoid the round-trip,
  // but that gate created a footgun: legitimate re-sends (lost-token
  // retries, etc.) never reached the server. Server-side is the only
  // correct source of truth for dedup.
  const store = fakeStore({ 'gridgame.submittedPuzzles': '[7]' });
  let called = false;
  const r = await submitResult({
    ...baseArgs, store,
    fetchImpl: async () => { called = true; return fakeRes(204, null); },
  });
  assert.deepEqual(r, { outcome: 'ok' });
  assert.equal(called, true);
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

test('fetch throws (network failure) → retried, then reason: network_error', async () => {
  const store = fakeStore();
  let calls = 0;
  const r = await submitResult({
    ...baseArgs, store, sleepImpl: noSleep,
    fetchImpl: async () => { calls++; throw new Error('connection refused'); },
  });
  assert.deepEqual(r, { outcome: 'failed', reason: 'network_error' });
  assert.equal(calls, 3); // initial + 2 retries
});

test('5xx is retried; a later 204 lands → ok (POST is idempotent server-side)', async () => {
  const store = fakeStore();
  let calls = 0;
  const r = await submitResult({
    ...baseArgs, store, sleepImpl: noSleep,
    fetchImpl: async () => { calls++; return calls < 3 ? fakeRes(500, {}) : fakeRes(204, null); },
  });
  assert.deepEqual(r, { outcome: 'ok' });
  assert.equal(calls, 3);
  assert.equal(store._map.get('gridgame.submittedPuzzles'), '[7]');
});

test('network error then 409 → ok (dup re-send after a dropped response)', async () => {
  const store = fakeStore();
  let calls = 0;
  const r = await submitResult({
    ...baseArgs, store, sleepImpl: noSleep,
    fetchImpl: async () => {
      calls++;
      if (calls < 2) throw new Error('reset');
      return fakeRes(409, { error: 'already_submitted' });
    },
  });
  assert.deepEqual(r, { outcome: 'ok' });
  assert.equal(calls, 2);
});

test('4xx is deterministic — surfaced without retrying', async () => {
  const store = fakeStore();
  let calls = 0;
  const r = await submitResult({
    ...baseArgs, store, sleepImpl: noSleep,
    fetchImpl: async () => { calls++; return fakeRes(403, { error: 'turnstile_failed' }); },
  });
  assert.deepEqual(r, { outcome: 'failed', reason: 'turnstile_failed' });
  assert.equal(calls, 1); // no retry on a client error
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
    wrongCodes: ['de', 'fr'],
    totalCount: 9,
    durationMs: 87000,
    deviceId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    turnstileToken: 'fake-cf-token',
  });
});

test('keepalive flag is set so the POST survives a fast tab-close', async () => {
  // Pinned because the give-up-and-close-immediately path is the whole
  // reason this function uses keepalive. A refactor that silently drops
  // the flag would re-open the lost-submission window.
  const store = fakeStore();
  let captured;
  await submitResult({
    ...baseArgs, store,
    fetchImpl: async (url, init) => {
      captured = init;
      return fakeRes(204, null);
    },
  });
  assert.equal(captured.keepalive, true);
});

test('wrongCodes defaults to [] when not supplied', async () => {
  const store = fakeStore();
  let captured;
  // eslint-disable-next-line no-unused-vars
  const { wrongCodes: _wrong, ...withoutWrong } = baseArgs;
  await submitResult({
    ...withoutWrong, store,
    fetchImpl: async (url, init) => {
      captured = { url, init };
      return fakeRes(204, null);
    },
  });
  const body = JSON.parse(captured.init.body);
  assert.deepEqual(body.wrongCodes, []);
});

test('a persistent 5xx failure does NOT mark submitted (so a later visit can retry)', async () => {
  const store = fakeStore();
  await submitResult({
    ...baseArgs, store, sleepImpl: noSleep,
    fetchImpl: async () => fakeRes(500, { error: 'server_error' }),
  });
  assert.equal(store._map.has('gridgame.submittedPuzzles'), false);
});

// --- Parked attempts (see pendingSubmit.js) -------------------------------
// A failed submit used to lose the score outright: no retry beyond this
// function's own, no message, and a revisit never re-POSTs. Parking the
// payload is what makes the next page load able to finish the job.

test('a deterministic 4xx parks the attempt for a later page load', async () => {
  const store = fakeStore();
  const r = await submitResult({
    ...baseArgs, store, sleepImpl: noSleep,
    fetchImpl: async () => fakeRes(400, { error: 'invalid_durationMs' }),
  });
  assert.equal(r.outcome, 'failed');
  const parked = loadPending(store);
  assert.equal(parked.length, 1);
  assert.equal(parked[0].n, 7);
  assert.deepEqual(parked[0].foundCodes, ['ch', 'dk']);
  assert.deepEqual(parked[0].wrongCodes, ['de', 'fr']);
  assert.equal(parked[0].totalCount, 9);
  assert.equal(parked[0].durationMs, 87_000);
  assert.equal(parked[0].deviceId, baseArgs.deviceId);
});

test('an exhausted 5xx retry parks the attempt too', async () => {
  const store = fakeStore();
  await submitResult({
    ...baseArgs, store, sleepImpl: noSleep,
    fetchImpl: async () => fakeRes(500, { error: 'server_error' }),
  });
  assert.equal(loadPending(store).length, 1);
});

test('a network error parks the attempt', async () => {
  const store = fakeStore();
  await submitResult({
    ...baseArgs, store, sleepImpl: noSleep,
    fetchImpl: async () => { throw new Error('offline'); },
  });
  assert.equal(loadPending(store).length, 1);
});

test('a 204 clears any attempt parked by an earlier failure', async () => {
  const store = fakeStore();
  await submitResult({
    ...baseArgs, store, sleepImpl: noSleep,
    fetchImpl: async () => { throw new Error('offline'); },
  });
  assert.equal(loadPending(store).length, 1, 'parked by the first, failed attempt');

  const r = await submitResult({
    ...baseArgs, store, sleepImpl: noSleep, fetchImpl: async () => fakeRes(204),
  });
  assert.equal(r.outcome, 'ok');
  assert.deepEqual(loadPending(store), []);
});

test('a 409 clears the parked attempt as well (server already has it)', async () => {
  const store = fakeStore();
  await submitResult({
    ...baseArgs, store, sleepImpl: noSleep, fetchImpl: async () => fakeRes(500, {}),
  });
  await submitResult({
    ...baseArgs, store, sleepImpl: noSleep,
    fetchImpl: async () => fakeRes(409, { error: 'already_submitted' }),
  });
  assert.deepEqual(loadPending(store), []);
});

test('flushPendingSubmits: re-sends a parked attempt and clears it on success', async () => {
  const store = fakeStore();
  await submitResult({
    ...baseArgs, store, sleepImpl: noSleep, fetchImpl: async () => fakeRes(400, { error: 'nope' }),
  });

  /** @type {any[]} */
  const bodies = [];
  const sent = await flushPendingSubmits({
    store,
    getToken: async () => 'tok',
    sleepImpl: noSleep,
    fetchImpl: async (_url, opts) => { bodies.push(JSON.parse(opts.body)); return fakeRes(204); },
  });

  assert.equal(sent, 1);
  assert.equal(bodies.length, 1);
  assert.equal(bodies[0].puzzleId, 7);
  assert.equal(bodies[0].durationMs, 87_000, 'the original duration is re-sent, not invented');
  assert.deepEqual(bodies[0].foundCodes, ['ch', 'dk']);
  assert.deepEqual(loadPending(store), []);
});

test('flushPendingSubmits: a still-failing attempt stays parked, then ages out', async () => {
  const store = fakeStore();
  const fail = async () => fakeRes(400, { error: 'nope' });
  await submitResult({ ...baseArgs, store, sleepImpl: noSleep, fetchImpl: fail });

  for (let i = 1; i < MAX_ATTEMPTS; i++) {
    const sent = await flushPendingSubmits({
      store, getToken: async () => '', sleepImpl: noSleep, fetchImpl: fail,
    });
    assert.equal(sent, 0, `flush ${i} delivered nothing`);
  }
  assert.deepEqual(loadPending(store), [], 'gives up rather than POSTing forever');
});

test('flushPendingSubmits: nothing parked means no request at all', async () => {
  let called = false;
  const sent = await flushPendingSubmits({
    store: fakeStore(),
    getToken: async () => { called = true; return ''; },
    fetchImpl: async () => { called = true; return fakeRes(204); },
  });
  assert.equal(sent, 0);
  assert.equal(called, false, 'not even a Turnstile token is requested');
});

test('flushPendingSubmits: a failing token provider is not fatal', async () => {
  const store = fakeStore();
  await submitResult({
    ...baseArgs, store, sleepImpl: noSleep, fetchImpl: async () => fakeRes(400, {}),
  });
  const sent = await flushPendingSubmits({
    store, getToken: async () => { throw new Error('turnstile down'); },
    sleepImpl: noSleep, fetchImpl: async () => fakeRes(204),
  });
  assert.equal(sent, 0);
  assert.equal(loadPending(store).length, 1, 'stays parked for the next load');
});
