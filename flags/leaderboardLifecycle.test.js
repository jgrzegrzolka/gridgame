import { test } from 'node:test';
import assert from 'node:assert/strict';

import { runLeaderboardCycle } from './leaderboardLifecycle.js';

function captureStates() {
  /** @type {any[]} */
  const states = [];
  return {
    states,
    paint: (/** @type {any} */ s) => { states.push(s); },
  };
}

test('runLeaderboardCycle: paints loading first, then ready on submit-ok + fetch-ok', async () => {
  const { states, paint } = captureStates();
  await runLeaderboardCycle({
    submitImpl: async () => ({ outcome: 'ok' }),
    fetchImpl: async () => ({ ok: true, top: [{ deviceId: 'd1', score: 10, durationMs: 50_000 }], you: { rank: 1, score: 10, durationMs: 50_000 } }),
    paint,
  });
  assert.equal(states.length, 2);
  assert.equal(states[0].state, 'loading');
  assert.equal(states[1].state, 'ready');
  assert.equal(states[1].data.top.length, 1);
});

test('runLeaderboardCycle: submit-failed still flows to fetch (failed outcome ≠ rejection)', async () => {
  const { states, paint } = captureStates();
  await runLeaderboardCycle({
    submitImpl: async () => ({ outcome: 'failed', reason: 'http_500' }),
    fetchImpl: async () => ({ ok: true, top: [], you: null }),
    paint,
  });
  assert.equal(states.length, 2);
  assert.equal(states[1].state, 'ready');
});

test('runLeaderboardCycle: submit REJECTS (contract drift) — fetch still fires, panel still paints', async () => {
  // Pins the contract: even if submit unexpectedly rejects, the panel
  // must end in a terminal state. Without this guard, a future refactor
  // that lets submit reject would leave the panel stuck in "loading".
  const { states, paint } = captureStates();
  await runLeaderboardCycle({
    submitImpl: async () => { throw new Error('network'); },
    fetchImpl: async () => ({ ok: true, top: [], you: null }),
    paint,
  });
  assert.equal(states[states.length - 1].state, 'ready');
});

test('runLeaderboardCycle: fetch returns ok=false → paints failed (not stuck on loading)', async () => {
  const { states, paint } = captureStates();
  await runLeaderboardCycle({
    submitImpl: async () => ({ outcome: 'ok' }),
    fetchImpl: async () => ({ ok: false, reason: 'http_500' }),
    paint,
  });
  assert.equal(states[states.length - 1].state, 'failed');
});

test('runLeaderboardCycle: fetch REJECTS — caught, paints failed', async () => {
  const { states, paint } = captureStates();
  await runLeaderboardCycle({
    submitImpl: async () => ({ outcome: 'ok' }),
    fetchImpl: async () => { throw new Error('boom'); },
    paint,
  });
  assert.equal(states[states.length - 1].state, 'failed');
});

test('runLeaderboardCycle: fetch fires AFTER submit settles, never before', async () => {
  // Critical ordering: the server writes the leaderboard row as part of
  // the submit handler, so the fetch has to land later or it'll miss the
  // just-submitted row.
  /** @type {string[]} */
  const order = [];
  await runLeaderboardCycle({
    submitImpl: async () => { order.push('submit'); },
    fetchImpl: async () => { order.push('fetch'); return { ok: true, top: [], you: null }; },
    paint: () => {},
  });
  assert.deepEqual(order, ['submit', 'fetch']);
});
