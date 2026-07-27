import { test } from 'node:test';
import assert from 'node:assert/strict';
import { probeRoomAlive } from './roomProbe.js';

/**
 * Build a fake fetch that resolves to a JSON body with an optional status.
 * @param {any} body
 * @param {{ status?: number }} [opts]
 */
function fetchReturning(body, { status = 200 } = {}) {
  return async () => ({
    ok: status >= 200 && status < 300,
    status,
    async json() { return body; },
  });
}

/** @param {() => any} action */
function fetchThat(action) {
  return async () => { return action(); };
}

test('probeRoomAlive: returns true when the server answers alive', async () => {
  const alive = await probeRoomAlive('https://example.test/parties/party/ABC12', fetchReturning({ alive: true, playerCount: 2 }));
  assert.equal(alive, true);
});

test('probeRoomAlive: returns false when the server answers dead', async () => {
  const alive = await probeRoomAlive('https://example.test/parties/party/ABC12', fetchReturning({ alive: false }));
  assert.equal(alive, false);
});

test('probeRoomAlive: a network error is treated as dead, not thrown', async () => {
  // The probe runs on start-screen paint; letting a rejection escape would
  // surface as an uncaught error rather than a hidden button. Treat any
  // failure to reach the server as "cannot confirm alive" → dead.
  const alive = await probeRoomAlive('https://example.test/parties/party/ABC12', fetchThat(() => { throw new Error('network'); }));
  assert.equal(alive, false);
});

test('probeRoomAlive: an HTTP error status is treated as dead', async () => {
  const alive = await probeRoomAlive('https://example.test/parties/party/ABC12', fetchReturning({ alive: true }, { status: 500 }));
  assert.equal(alive, false);
});

test('probeRoomAlive: a malformed body reads as dead', async () => {
  // A body without an `alive` boolean is unrecognisable and must not be
  // trusted as either answer.
  const alive = await probeRoomAlive('https://example.test/parties/party/ABC12', fetchReturning({ playerCount: 2 }));
  assert.equal(alive, false);
});

test('probeRoomAlive: cache: no-store is requested — a snapshot is stale the instant it lands', async () => {
  /** @type {any} */
  let seen = null;
  const fetch = async (/** @type {string} */ _url, /** @type {any} */ init) => {
    seen = init;
    return { ok: true, status: 200, async json() { return { alive: true }; } };
  };
  await probeRoomAlive('https://example.test/parties/party/ABC12', fetch);
  assert.equal(seen.cache, 'no-store');
});
