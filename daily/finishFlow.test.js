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

  const happyStats = { totalAttempts: 4, perCodeFinds: { ch: 3 }, mean: 2, topPct: 50 };

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
      // A function lets a test return different values for the fresh vs the
      // cached fetch (n, opts) => ...; otherwise a fixed value / happyStats.
      if (typeof outcomes.statsResult === 'function') return outcomes.statsResult(n, opts);
      return outcomes.statsResult === undefined ? happyStats : outcomes.statsResult;
    },
    onLoading: () => events.push('loading'),
    onCleared: () => events.push('cleared'),
    onStats: (/** @type {any} */ stats) => events.push(`stats:${stats.totalAttempts}`),
    onSubmitFailed: (/** @type {string} */ reason) => events.push(`submitFailed:${reason}`),
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

test('submit failed → still shows stats (replay row already exists; data stands)', async () => {
  const h = harness({ submitOutcome: { outcome: 'failed', reason: 'http_500' } });
  await runFinishFlow(h.args);
  assert.deepEqual(h.events, ['loading', 'submitFailed:http_500', 'stats:4']);
  assert.equal(h.submitCalls.length, 1);
  assert.equal(h.fetchStatsCalls.length, 1); // fresh fetch succeeded
});

test('fresh fetch fails → falls back to cached; cached succeeds → stats shown', async () => {
  const h = harness({
    statsResult: (_n, opts) => (opts.bypassCache
      ? null
      : { totalAttempts: 9, perCodeFinds: {}, mean: 5, topPct: 20 }),
  });
  await runFinishFlow(h.args);
  assert.deepEqual(h.events, ['loading', 'stats:9']);
  assert.equal(h.fetchStatsCalls.length, 2);
  assert.equal(h.fetchStatsCalls[0].opts.bypassCache, true);  // fresh first
  assert.equal(h.fetchStatsCalls[1].opts.bypassCache, false); // cached fallback
});

test('both fresh and cached stats fetches fail → loading → cleared', async () => {
  const h = harness({ statsResult: null });
  await runFinishFlow(h.args);
  assert.deepEqual(h.events, ['loading', 'cleared']);
  assert.equal(h.submitCalls.length, 1);
  assert.equal(h.fetchStatsCalls.length, 2); // tried fresh, then cached
  assert.equal(h.fetchStatsCalls[0].opts.bypassCache, true);
  assert.equal(h.fetchStatsCalls[1].opts.bypassCache, false);
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

// --- Failed submit is no longer silent -----------------------------------
// A rejected POST used to leave no trace anywhere: the outcome was
// discarded here, and the player saw a normal result screen while the
// server had no row. On 2026-08-26 that turned a real 13/13 into a
// vanished score and let a later 4/13 replay become the day's only row.

test('a failed submit reports the reason and still shows stats', async () => {
  const h = harness({ submitOutcome: { outcome: 'failed', reason: 'invalid_durationMs' } });
  await runFinishFlow(h.args);
  assert.deepEqual(h.events, ['loading', 'submitFailed:invalid_durationMs', 'stats:4']);
});

test('a successful submit reports nothing', async () => {
  const h = harness();
  await runFinishFlow(h.args);
  assert.ok(!h.events.some((e) => e.startsWith('submitFailed')));
});

test('a failed submit is reported even when stats then fail too', async () => {
  const h = harness({
    submitOutcome: { outcome: 'failed', reason: 'network_error' },
    statsResult: null,
  });
  await runFinishFlow(h.args);
  assert.deepEqual(h.events, ['loading', 'submitFailed:network_error', 'cleared']);
});

test('onSubmitFailed is optional — omitting it must not break the flow', async () => {
  const h = harness({ submitOutcome: { outcome: 'failed', reason: 'nope' } });
  const { onSubmitFailed, ...rest } = h.args;
  void onSubmitFailed;
  await runFinishFlow(rest);
  assert.deepEqual(h.events, ['loading', 'stats:4']);
});
