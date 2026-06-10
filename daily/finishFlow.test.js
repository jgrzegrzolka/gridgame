import { test } from 'node:test';
import assert from 'node:assert/strict';

import { runFinishFlow } from './finishFlow.js';

/**
 * Build a stub harness: records the sequence of UI events (loading /
 * cleared / stats) and tracks every call into each network/widget dep,
 * regardless of which return value the test asked for. Overrides set
 * *outcomes* (a return value or a thrown error), never replace the
 * recording wrappers — so call counts stay accurate across failure
 * modes.
 *
 * @param {{
 *   ensureError?: Error,
 *   tokenError?: Error,
 *   submitOutcome?: { outcome: 'ok' } | { outcome: 'failed', reason: string },
 *   statsResult?: any | null,
 * }} [outcomes]
 */
function harness(outcomes = {}) {
  /** @type {string[]} */
  const events = [];
  /** @type {any[]} */
  const submitCalls = [];
  /** @type {any[]} */
  const fetchStatsCalls = [];
  let ensureCalls = 0;
  let tokenCalls = 0;

  const happyStats = { totalAttempts: 4, perCodeFinds: { ch: 3 }, median: 2, topPct: 50 };

  const deps = {
    ensureTurnstile: async () => {
      ensureCalls += 1;
      if (outcomes.ensureError) throw outcomes.ensureError;
    },
    getTurnstileToken: async () => {
      tokenCalls += 1;
      if (outcomes.tokenError) throw outcomes.tokenError;
      return 'tok-xyz';
    },
    submitResult: async (/** @type {any} */ args) => {
      submitCalls.push(args);
      return outcomes.submitOutcome || { outcome: 'ok' };
    },
    fetchStats: async (/** @type {number} */ n, /** @type {any} */ opts) => {
      fetchStatsCalls.push({ n, opts });
      return outcomes.statsResult === undefined ? happyStats : outcomes.statsResult;
    },
    onLoading: () => events.push('loading'),
    onCleared: () => events.push('cleared'),
    onStats: (/** @type {any} */ stats) => events.push(`stats:${stats.totalAttempts}`),
  };

  const baseArgs = {
    n: 7,
    found: 2,
    totalCount: 4,
    foundCodes: ['ch', 'dk'],
    wrongCodes: ['de'],
    durationMs: 12_000,
    deviceId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    store: { getItem: () => null, setItem: () => {} },
    ...deps,
  };

  return {
    args: baseArgs,
    events,
    submitCalls,
    fetchStatsCalls,
    get ensureCalls() { return ensureCalls; },
    get tokenCalls() { return tokenCalls; },
  };
}

test('happy path: loading → stats, with token forwarded and bypassCache=true', async () => {
  const h = harness();
  await runFinishFlow(h.args);
  assert.deepEqual(h.events, ['loading', 'stats:4']);
  assert.equal(h.ensureCalls, 1);
  assert.equal(h.tokenCalls, 1);
  assert.equal(h.submitCalls.length, 1);
  assert.equal(h.submitCalls[0].turnstileToken, 'tok-xyz');
  assert.equal(h.submitCalls[0].n, 7);
  assert.deepEqual(h.fetchStatsCalls, [{ n: 7, opts: { bypassCache: true } }]);
});

test('ensureTurnstile throws → loading → cleared, no submit, no fetch', async () => {
  const h = harness({ ensureError: new Error('script_load_failed') });
  await runFinishFlow(h.args);
  assert.deepEqual(h.events, ['loading', 'cleared']);
  assert.equal(h.submitCalls.length, 0);
  assert.equal(h.fetchStatsCalls.length, 0);
});

test('getTurnstileToken throws → loading → cleared, no submit, no fetch', async () => {
  const h = harness({ tokenError: new Error('turnstile_timeout') });
  await runFinishFlow(h.args);
  assert.deepEqual(h.events, ['loading', 'cleared']);
  assert.equal(h.submitCalls.length, 0);
  assert.equal(h.fetchStatsCalls.length, 0);
});

test('submitResult returns failed → loading → cleared, fetch NOT called', async () => {
  const h = harness({ submitOutcome: { outcome: 'failed', reason: 'http_500' } });
  await runFinishFlow(h.args);
  assert.deepEqual(h.events, ['loading', 'cleared']);
  assert.equal(h.submitCalls.length, 1);
  assert.equal(h.fetchStatsCalls.length, 0);
});

test('fetchStats returns null → loading → cleared (submit succeeded, but stats fetch flaked)', async () => {
  const h = harness({ statsResult: null });
  await runFinishFlow(h.args);
  assert.deepEqual(h.events, ['loading', 'cleared']);
  assert.equal(h.submitCalls.length, 1);
  assert.equal(h.fetchStatsCalls.length, 1);
});

test('submit payload carries the result fields the server expects', async () => {
  const h = harness();
  await runFinishFlow(h.args);
  const call = h.submitCalls[0];
  assert.equal(call.n, 7);
  assert.deepEqual(call.foundCodes, ['ch', 'dk']);
  assert.deepEqual(call.wrongCodes, ['de']);
  assert.equal(call.totalCount, 4);
  assert.equal(call.durationMs, 12_000);
  assert.equal(call.deviceId, 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
});

test('onLoading fires synchronously before any async dep runs', async () => {
  // Guarantees the player gets the spinner immediately on finish, not
  // after the first microtask of Turnstile script-load. Regression
  // protection: if a future refactor awaits ensureTurnstile() before
  // painting loading, on mobile cold path that would leave the result
  // screen blank for 1-2s.
  /** @type {string[]} */
  const order = [];
  const h = harness();
  const args = {
    ...h.args,
    ensureTurnstile: async () => { order.push('ensure'); },
    onLoading: () => order.push('loading'),
  };
  await runFinishFlow(args);
  assert.equal(order[0], 'loading');
  assert.equal(order[1], 'ensure');
});
