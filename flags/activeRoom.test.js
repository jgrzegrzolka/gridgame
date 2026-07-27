import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  rememberActiveRoom,
  readActiveRoom,
  forgetActiveRoom,
  ACTIVE_ROOM_KEY,
  ACTIVE_ROOM_MAX_AGE_MS,
} from './activeRoom.js';

/** Map-backed Store double — same shape as the real localStorage. */
function fakeStore(/** @type {Record<string, string>} */ seed = {}) {
  const m = new Map(Object.entries(seed));
  return {
    getItem: (/** @type {string} */ k) => (m.has(k) ? /** @type {string} */ (m.get(k)) : null),
    setItem: (/** @type {string} */ k, /** @type {string} */ v) => { m.set(k, v); },
    removeItem: (/** @type {string} */ k) => { m.delete(k); },
    /** test-only peek */
    _raw: () => m.get(ACTIVE_ROOM_KEY),
  };
}

/** Stand-in for a game's own 5-character code validator. */
const isCode = (/** @type {string} */ c) => /^[A-Z]{5}$/.test(c);

const NOW = 1_700_000_000_000;

test('remember then read: round-trips the room for its own game', () => {
  const store = fakeStore();
  rememberActiveRoom(store, { game: 'party', code: 'ABCDE', at: NOW });
  assert.deepEqual(readActiveRoom(store, 'party', NOW, isCode), { game: 'party', code: 'ABCDE', at: NOW });
});

test('read: a room belonging to the other game is not offered', () => {
  const store = fakeStore();
  rememberActiveRoom(store, { game: 'ttt', code: 'ABCDE', at: NOW });
  assert.equal(readActiveRoom(store, 'party', NOW, isCode), null);
});

test('read: nothing remembered reads as nothing', () => {
  assert.equal(readActiveRoom(fakeStore(), 'party', NOW, isCode), null);
});

test('forget: clears the entry', () => {
  const store = fakeStore();
  rememberActiveRoom(store, { game: 'party', code: 'ABCDE', at: NOW });
  forgetActiveRoom(store);
  assert.equal(readActiveRoom(store, 'party', NOW, isCode), null);
});

test('remember: a second room replaces the first (one room at a time)', () => {
  const store = fakeStore();
  rememberActiveRoom(store, { game: 'party', code: 'AAAAA', at: NOW });
  rememberActiveRoom(store, { game: 'party', code: 'BBBBB', at: NOW });
  assert.equal(readActiveRoom(store, 'party', NOW, isCode)?.code, 'BBBBB');
});

// ---- the staleness window ----

test('read: an entry inside the window is offered, one past it is not', () => {
  const store = fakeStore();
  rememberActiveRoom(store, { game: 'party', code: 'ABCDE', at: NOW });
  const justInside = NOW + ACTIVE_ROOM_MAX_AGE_MS;
  const justOutside = justInside + 1;
  assert.ok(readActiveRoom(store, 'party', justInside, isCode), 'the boundary itself still counts');
  assert.equal(readActiveRoom(store, 'party', justOutside, isCode), null);
});

test('read: an entry stamped in the future is treated as fresh, not expired', () => {
  // A corrected system clock or a timezone change can leave `at` ahead of now.
  // The player is far likelier to still be in the room than to be holding an
  // entry from the future, so the arithmetic must not go negative-then-expire.
  const store = fakeStore();
  rememberActiveRoom(store, { game: 'party', code: 'ABCDE', at: NOW + 60_000 });
  assert.ok(readActiveRoom(store, 'party', NOW, isCode));
});

// ---- hostile / stale stored values ----

test('read: malformed stored values all read as no room', () => {
  for (const raw of [
    'not json at all',
    'null',
    '"a string"',
    '[]',
    '{}',
    JSON.stringify({ game: 'party', code: 'ABCDE' }),           // no timestamp
    JSON.stringify({ game: 'party', at: NOW }),                  // no code
    JSON.stringify({ game: 'party', code: 'lowercase', at: NOW }), // fails the validator
    JSON.stringify({ game: 'party', code: 'TOOLONG', at: NOW }),
    JSON.stringify({ game: 'party', code: 'ABCDE', at: 'soon' }), // wrong type
    JSON.stringify({ game: 'party', code: 'ABCDE', at: NaN }),    // JSON-encodes to null
  ]) {
    const store = fakeStore({ [ACTIVE_ROOM_KEY]: raw });
    assert.equal(readActiveRoom(store, 'party', NOW, isCode), null, `should reject: ${raw}`);
  }
});

test('a storage that throws degrades to no memory instead of breaking the page', () => {
  // Private mode with a zero quota, or a third-party-blocked iframe: every
  // access throws. Nothing here may propagate — the room still works, it just
  // cannot be remembered.
  const hostile = {
    getItem() { throw new Error('nope'); },
    setItem() { throw new Error('nope'); },
    removeItem() { throw new Error('nope'); },
  };
  assert.doesNotThrow(() => rememberActiveRoom(hostile, { game: 'party', code: 'ABCDE', at: NOW }));
  assert.doesNotThrow(() => forgetActiveRoom(hostile));
  assert.equal(readActiveRoom(hostile, 'party', NOW, isCode), null);
});

test('a missing store is handled the same way', () => {
  assert.doesNotThrow(() => rememberActiveRoom(null, { game: 'party', code: 'ABCDE', at: NOW }));
  assert.doesNotThrow(() => forgetActiveRoom(null));
  assert.equal(readActiveRoom(null, 'party', NOW, isCode), null);
});
