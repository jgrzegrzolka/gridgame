import test from 'node:test';
import assert from 'node:assert/strict';
import { submitEngagementEvent } from './eventSubmit.js';

const DEV_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

/**
 * @param {{ ok?: boolean, status?: number, throws?: boolean }} cfg
 */
function makeFetch(cfg) {
  /** @type {Array<{ url: string, init: any }>} */
  const calls = [];
  /** @param {any} url @param {any} init */
  const impl = async (url, init) => {
    calls.push({ url: String(url), init });
    if (cfg.throws) throw new Error('network down');
    return /** @type {any} */ ({
      ok: cfg.ok ?? true,
      status: cfg.status ?? 201,
    });
  };
  return { impl: /** @type {typeof fetch} */ (/** @type {any} */ (impl)), calls };
}

test('submitEngagementEvent: posts to /api/v1/event with deviceId + kind + payload', async () => {
  const fetcher = makeFetch({ ok: true, status: 201 });
  const ok = await submitEngagementEvent(
    DEV_ID,
    { kind: 'share', payload: { surface: 'daily', contextHint: '7' } },
    { fetchImpl: fetcher.impl },
  );
  assert.equal(ok, true);
  assert.equal(fetcher.calls.length, 1);
  const call = fetcher.calls[0];
  assert.equal(call.url, '/api/v1/event');
  assert.equal(call.init.method, 'POST');
  assert.equal(call.init.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(call.init.body), {
    deviceId: DEV_ID,
    kind: 'share',
    payload: { surface: 'daily', contextHint: '7' },
  });
});

test('submitEngagementEvent: treats 409 as success (dedupe path for daily_start)', async () => {
  const fetcher = makeFetch({ ok: false, status: 409 });
  const ok = await submitEngagementEvent(
    DEV_ID,
    { kind: 'daily_start', payload: { puzzleId: 7 } },
    { fetchImpl: fetcher.impl },
  );
  assert.equal(ok, true);
});

test('submitEngagementEvent: returns false on non-OK non-409 status', async () => {
  for (const status of [400, 429, 500, 503]) {
    const fetcher = makeFetch({ ok: false, status });
    const ok = await submitEngagementEvent(
      DEV_ID,
      { kind: 'share', payload: { surface: 'daily' } },
      { fetchImpl: fetcher.impl },
    );
    assert.equal(ok, false, `status=${status}`);
  }
});

test('submitEngagementEvent: never throws on network failure — returns false', async () => {
  const fetcher = makeFetch({ throws: true });
  const ok = await submitEngagementEvent(
    DEV_ID,
    { kind: 'share', payload: { surface: 'daily' } },
    { fetchImpl: fetcher.impl },
  );
  assert.equal(ok, false);
});

test('submitEngagementEvent: rejects empty deviceId without firing', async () => {
  const fetcher = makeFetch({});
  const ok = await submitEngagementEvent(
    '',
    { kind: 'share', payload: { surface: 'daily' } },
    { fetchImpl: fetcher.impl },
  );
  assert.equal(ok, false);
  assert.equal(fetcher.calls.length, 0);
});

test('submitEngagementEvent: rejects null event without firing', async () => {
  const fetcher = makeFetch({});
  const ok = await submitEngagementEvent(
    DEV_ID,
    /** @type {any} */ (null),
    { fetchImpl: fetcher.impl },
  );
  assert.equal(ok, false);
  assert.equal(fetcher.calls.length, 0);
});

test('submitEngagementEvent: rejects event with missing kind without firing', async () => {
  const fetcher = makeFetch({});
  const ok = await submitEngagementEvent(
    DEV_ID,
    /** @type {any} */ ({ payload: { surface: 'daily' } }),
    { fetchImpl: fetcher.impl },
  );
  assert.equal(ok, false);
  assert.equal(fetcher.calls.length, 0);
});

test('submitEngagementEvent: rejects event with missing payload without firing', async () => {
  const fetcher = makeFetch({});
  const ok = await submitEngagementEvent(
    DEV_ID,
    /** @type {any} */ ({ kind: 'share' }),
    { fetchImpl: fetcher.impl },
  );
  assert.equal(ok, false);
  assert.equal(fetcher.calls.length, 0);
});
