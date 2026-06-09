import { test } from 'node:test';
import assert from 'node:assert/strict';

import { submitQuizRecord } from './quizRecordSubmit.js';

const VALID = () => ({
  deviceId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  configKey: 'countries:60s:sov',
  score: 50,
  durationMs: 60_000,
  lowerWins: false,
});

/**
 * @param {(url: string, init: RequestInit) => any} handler
 */
function fakeFetch(handler) {
  /** @type {{ url: string, init: RequestInit }[]} */
  const calls = [];
  /** @type {any} */
  const f = async (/** @type {string} */ url, /** @type {RequestInit} */ init) => {
    calls.push({ url, init });
    return handler(url, init);
  };
  f.calls = calls;
  return f;
}

test('204 → outcome ok', async () => {
  const f = fakeFetch(() => ({ status: 204, json: async () => ({}) }));
  const out = await submitQuizRecord({ ...VALID(), fetchImpl: f });
  assert.deepEqual(out, { outcome: 'ok' });
});

test('posts JSON body with all required fields', async () => {
  const f = fakeFetch(() => ({ status: 204, json: async () => ({}) }));
  await submitQuizRecord({ ...VALID(), fetchImpl: f });
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].url, '/api/v1/quiz/record');
  assert.equal(f.calls[0].init.method, 'POST');
  const sent = JSON.parse(/** @type {string} */ (f.calls[0].init.body));
  assert.deepEqual(sent, {
    deviceId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    configKey: 'countries:60s:sov',
    score: 50,
    durationMs: 60_000,
    lowerWins: false,
  });
});

test('400 with server error code → outcome failed with that reason', async () => {
  const f = fakeFetch(() => ({
    status: 400,
    json: async () => ({ error: 'invalid_configKey' }),
  }));
  const out = await submitQuizRecord({ ...VALID(), fetchImpl: f });
  assert.deepEqual(out, { outcome: 'failed', reason: 'invalid_configKey' });
});

test('500 without parseable body → outcome failed with http_500', async () => {
  const f = fakeFetch(() => ({
    status: 500,
    json: async () => { throw new Error('not json'); },
  }));
  const out = await submitQuizRecord({ ...VALID(), fetchImpl: f });
  assert.deepEqual(out, { outcome: 'failed', reason: 'http_500' });
});

test('fetch throwing (network error) → outcome failed with network_error', async () => {
  /** @type {any} */
  const f = async () => { throw new Error('offline'); };
  const out = await submitQuizRecord({ ...VALID(), fetchImpl: f });
  assert.deepEqual(out, { outcome: 'failed', reason: 'network_error' });
});

test('never throws on any input (defensive)', async () => {
  /** @type {any} */
  const f = async () => { throw new Error('boom'); };
  await assert.doesNotReject(submitQuizRecord({ ...VALID(), fetchImpl: f }));
});
