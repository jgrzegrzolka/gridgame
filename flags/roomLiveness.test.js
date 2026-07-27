import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isRoomAlive, anyHumanPresent, ROOM_STALE_MS } from './roomLiveness.js';

/** Minimal room shape — only the fields the liveness rules read. */
function roomWith(overrides = {}) {
  return {
    seats: new Map(),
    present: new Set(),
    lastActiveAt: null,
    ...overrides,
  };
}

test('anyHumanPresent: a human seat listed in present counts', () => {
  const room = roomWith({
    seats: new Map([['alice', { nickname: 'Alice', score: 0 }]]),
    present: new Set(['alice']),
  });
  assert.equal(anyHumanPresent(room), true);
});

test('anyHumanPresent: bots do not count — they cannot drive the clock', () => {
  const room = roomWith({
    seats: new Map([['bot-1', { nickname: 'Botty', score: 0, bot: true }]]),
    present: new Set(['bot-1']),
  });
  assert.equal(anyHumanPresent(room), false);
});

test('anyHumanPresent: empty present set is empty', () => {
  const room = roomWith({
    seats: new Map([['alice', { nickname: 'Alice', score: 0 }]]),
    present: new Set(),
  });
  assert.equal(anyHumanPresent(room), false);
});

test('anyHumanPresent: a seat in present without a seat entry does not crash', () => {
  // Should never happen in a well-formed room, but the helper is called from a
  // server request handler; a null-safe read here beats a 500.
  const room = roomWith({
    seats: new Map(),
    present: new Set(['ghost']),
  });
  assert.equal(anyHumanPresent(room), false);
});

test('isRoomAlive: recent lastActiveAt and a human present is alive', () => {
  const now = 1_000_000;
  const room = roomWith({
    seats: new Map([['alice', { nickname: 'Alice', score: 0 }]]),
    present: new Set(['alice']),
    lastActiveAt: now - 5_000, // 5s ago
  });
  assert.equal(isRoomAlive(room, now), true);
});

test('isRoomAlive: lastActiveAt older than ROOM_STALE_MS is dead', () => {
  const now = 1_000_000;
  const room = roomWith({
    seats: new Map([['alice', { nickname: 'Alice', score: 0 }]]),
    present: new Set(['alice']),
    lastActiveAt: now - ROOM_STALE_MS - 1,
  });
  assert.equal(isRoomAlive(room, now), false);
});

test('isRoomAlive: fresh timestamp but only bots present is dead', () => {
  // A room whose humans have all left, leaving a bot playing to itself, does
  // not deserve a resume prompt. The bot cannot drive the game and cannot
  // welcome a returning human back into a match.
  const now = 1_000_000;
  const room = roomWith({
    seats: new Map([['bot-1', { nickname: 'Botty', score: 0, bot: true }]]),
    present: new Set(['bot-1']),
    lastActiveAt: now - 1_000,
  });
  assert.equal(isRoomAlive(room, now), false);
});

test('isRoomAlive: null lastActiveAt reads as dead', () => {
  // A DO just deserialized from storage without ever having been touched has
  // no known activity time — treat that as dead rather than "unknown".
  const now = 1_000_000;
  const room = roomWith({
    seats: new Map([['alice', { nickname: 'Alice', score: 0 }]]),
    present: new Set(['alice']),
    lastActiveAt: null,
  });
  assert.equal(isRoomAlive(room, now), false);
});

test('isRoomAlive: at exactly the boundary is still alive', () => {
  // Off-by-one guard: 60s ago on a 60s window must still count as alive,
  // otherwise a well-behaved 15s-ping client can flicker to "dead" between
  // frames when the network shakes.
  const now = 1_000_000;
  const room = roomWith({
    seats: new Map([['alice', { nickname: 'Alice', score: 0 }]]),
    present: new Set(['alice']),
    lastActiveAt: now - ROOM_STALE_MS,
  });
  assert.equal(isRoomAlive(room, now), true);
});

test('isRoomAlive: custom staleMs overrides the default', () => {
  const now = 1_000_000;
  const room = roomWith({
    seats: new Map([['alice', { nickname: 'Alice', score: 0 }]]),
    present: new Set(['alice']),
    lastActiveAt: now - 5_000,
  });
  assert.equal(isRoomAlive(room, now, 1_000), false);
});
