import { test } from 'node:test';
import assert from 'node:assert/strict';

import { submitTttResult } from './tttResultSubmit.js';

const DEVICE = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const OPP = '11111111-2222-3333-4444-555555555555';

/**
 * @param {{ status?: number, ok?: boolean, json?: any, throws?: boolean }} [opts]
 */
function fakeFetch(opts = {}) {
  /** @type {Array<{ url: string, init: any }>} */
  const calls = [];
  /** @type {any} */
  const impl = async (/** @type {string} */ url, /** @type {any} */ init) => {
    calls.push({ url, init });
    if (opts.throws) throw new Error('network');
    const status = opts.status ?? 204;
    return {
      status,
      ok: opts.ok ?? (status >= 200 && status < 300),
      async json() { return opts.json; },
    };
  };
  return { impl, calls };
}

test('submitTttResult: 204 → { outcome: "ok" } and POSTs the expected body shape', async () => {
  const fetcher = fakeFetch({ status: 204 });
  const r = await submitTttResult({
    deviceId: DEVICE, opponentId: OPP, mode: '3x3', outcome: 'win',
    fetchImpl: fetcher.impl,
  });
  assert.deepEqual(r, { outcome: 'ok' });
  assert.equal(fetcher.calls.length, 1);
  assert.equal(fetcher.calls[0].url, '/api/v1/ttt/result');
  assert.equal(fetcher.calls[0].init.method, 'POST');
  assert.equal(fetcher.calls[0].init.headers['content-type'], 'application/json');
  assert.deepEqual(JSON.parse(fetcher.calls[0].init.body), {
    deviceId: DEVICE, opponentId: OPP, mode: '3x3', outcome: 'win',
  });
});

test('submitTttResult: network error → { outcome: "failed", reason: "network_error" }', async () => {
  const fetcher = fakeFetch({ throws: true });
  const r = await submitTttResult({
    deviceId: DEVICE, opponentId: OPP, mode: '3x3', outcome: 'loss',
    fetchImpl: fetcher.impl,
  });
  assert.deepEqual(r, { outcome: 'failed', reason: 'network_error' });
});

test('submitTttResult: server error body surfaces the error code in `reason`', async () => {
  const fetcher = fakeFetch({ status: 400, json: { error: 'invalid_mode' } });
  const r = await submitTttResult({
    deviceId: DEVICE, opponentId: OPP, mode: '3x3', outcome: 'draw',
    fetchImpl: fetcher.impl,
  });
  assert.deepEqual(r, { outcome: 'failed', reason: 'invalid_mode' });
});

test('submitTttResult: non-204 with no parsable body → reason: http_<status>', async () => {
  const fetcher = fakeFetch({ status: 500, json: undefined });
  const r = await submitTttResult({
    deviceId: DEVICE, opponentId: OPP, mode: '3x3', outcome: 'win',
    fetchImpl: fetcher.impl,
  });
  assert.deepEqual(r, { outcome: 'failed', reason: 'http_500' });
});

test('submitTttResult: never throws — every failure path resolves with an outcome', async () => {
  // Critical contract: callers fire-and-forget with `void submitTttResult(...)`.
  // An unhandled rejection here would surface as a noisy console warning
  // (and in some runtimes a process crash). Pin the no-throw guarantee.
  await assert.doesNotReject(submitTttResult({
    deviceId: DEVICE, opponentId: OPP, mode: '3x3', outcome: 'win',
    fetchImpl: fakeFetch({ throws: true }).impl,
  }));
  await assert.doesNotReject(submitTttResult({
    deviceId: DEVICE, opponentId: OPP, mode: '3x3', outcome: 'win',
    fetchImpl: fakeFetch({ status: 500 }).impl,
  }));
});
