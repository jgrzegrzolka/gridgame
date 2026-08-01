import { test } from 'node:test';
import assert from 'node:assert/strict';
import { probeRoomStatus } from './roomProbe.js';

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

const URL = 'https://example.test/parties/party/ABC12';

test('probeRoomStatus: alive when the server answers alive', async () => {
  assert.equal(await probeRoomStatus(URL, fetchReturning({ alive: true, playerCount: 2 })), 'alive');
});

test('probeRoomStatus: dead when the server answers not alive', async () => {
  assert.equal(await probeRoomStatus(URL, fetchReturning({ alive: false })), 'dead');
});

// The distinction the whole three-state shape exists for. Each of these used to
// read as "dead", and the caller acted on that by ERASING the remembered room —
// so a cold start or a dropped request permanently destroyed the way back into
// a room that was alive and full of people. Hiding is recoverable on the next
// paint; forgetting is not, so nothing below may claim the room is dead.

test('probeRoomStatus: an unreachable server is unknown, not dead', async () => {
  assert.equal(await probeRoomStatus(URL, fetchThat(() => { throw new Error('network'); })), 'unknown');
});

test('probeRoomStatus: an HTTP error status is unknown, not dead', async () => {
  assert.equal(await probeRoomStatus(URL, fetchReturning({ alive: true }, { status: 500 })), 'unknown');
});

test('probeRoomStatus: a body that will not parse is unknown, not dead', async () => {
  const fetchImpl = async () => ({ ok: true, status: 200, async json() { throw new SyntaxError('not json'); } });
  assert.equal(await probeRoomStatus(URL, fetchImpl), 'unknown');
});

test('probeRoomStatus: a body without an alive boolean is unknown, not dead', async () => {
  assert.equal(await probeRoomStatus(URL, fetchReturning({ playerCount: 2 })), 'unknown');
});

test('probeRoomStatus: a non-boolean alive is unknown — truthiness is not an answer', async () => {
  // A server that started sending `alive: "yes"` (or null) is a server we do
  // not understand. Coercing that to either verdict guesses on the player's
  // behalf, and one of the two guesses is destructive.
  assert.equal(await probeRoomStatus(URL, fetchReturning({ alive: 'yes' })), 'unknown');
  assert.equal(await probeRoomStatus(URL, fetchReturning({ alive: null })), 'unknown');
});

test('probeRoomStatus: a null body is unknown, not dead', async () => {
  assert.equal(await probeRoomStatus(URL, fetchReturning(null)), 'unknown');
});

test('probeRoomStatus: never rejects — it runs on start-screen paint', async () => {
  // Letting a rejection escape would surface as an uncaught error during paint
  // rather than a hidden button.
  await assert.doesNotReject(() => probeRoomStatus(URL, fetchThat(() => { throw new Error('boom'); })));
});

test('probeRoomStatus: cache: no-store is requested — a snapshot is stale the instant it lands', async () => {
  /** @type {any} */
  let seen = null;
  const fetchImpl = async (/** @type {string} */ _url, /** @type {any} */ init) => {
    seen = init;
    return { ok: true, status: 200, async json() { return { alive: true }; } };
  };
  await probeRoomStatus(URL, fetchImpl);
  assert.equal(seen.cache, 'no-store');
});
