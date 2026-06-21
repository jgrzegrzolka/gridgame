import { test } from 'node:test';
import assert from 'node:assert/strict';

import { decideIsHost, forgetHostRoom, rememberHostRoom } from './tttHostMemory.js';

/** Minimal in-memory Storage stand-in (sessionStorage / localStorage shape). */
function makeStorage() {
  /** @type {Map<string, string>} */
  const store = new Map();
  return {
    /** @param {string} k */
    getItem: (k) => (store.has(k) ? /** @type {string} */ (store.get(k)) : null),
    /** @param {string} k @param {string} v */
    setItem: (k, v) => { store.set(k, String(v)); },
    /** @param {string} k */
    removeItem: (k) => { store.delete(k); },
  };
}

function brokenStorage() {
  return {
    /** @returns {string | null} */
    getItem: () => { throw new Error('disabled'); },
    setItem: () => { throw new Error('disabled'); },
    removeItem: () => { throw new Error('disabled'); },
  };
}

test('decideIsHost returns true when urlIntent is "create"', () => {
  const storage = makeStorage();
  assert.equal(decideIsHost({ storage, roomCode: 'ABCDE', urlIntent: 'create' }), true);
});

test('decideIsHost returns false on a plain join with no stored room', () => {
  const storage = makeStorage();
  assert.equal(decideIsHost({ storage, roomCode: 'ABCDE', urlIntent: 'join' }), false);
});

test('page-reload regression: stored host room + URL intent "join" → still host', () => {
  // This is the exact failure that left Majkel's tttPairs empty: the
  // creator reloaded mid-game, the auto-join branch ran with
  // intent='join', and the old `if (intent === 'create') isHost = true`
  // line flipped isHost to false. With the stored room code matching,
  // we now correctly stay host.
  const storage = makeStorage();
  rememberHostRoom(storage, 'ABCDE');
  assert.equal(decideIsHost({ storage, roomCode: 'ABCDE', urlIntent: 'join' }), true);
});

test('decideIsHost returns false when stored room differs from current room', () => {
  // Joining someone else's room after previously hosting a different
  // one — the stored code is stale w.r.t. THIS room code, so we are
  // not host of this one.
  const storage = makeStorage();
  rememberHostRoom(storage, 'ABCDE');
  assert.equal(decideIsHost({ storage, roomCode: 'FGHIJ', urlIntent: 'join' }), false);
});

test('forgetHostRoom clears the stored code', () => {
  const storage = makeStorage();
  rememberHostRoom(storage, 'ABCDE');
  forgetHostRoom(storage);
  assert.equal(decideIsHost({ storage, roomCode: 'ABCDE', urlIntent: 'join' }), false);
});

test('decideIsHost returns false when storage.getItem throws (private mode)', () => {
  assert.equal(
    decideIsHost({ storage: brokenStorage(), roomCode: 'ABCDE', urlIntent: 'join' }),
    false,
  );
});

test('decideIsHost still honours create intent even when storage is broken', () => {
  assert.equal(
    decideIsHost({ storage: brokenStorage(), roomCode: 'ABCDE', urlIntent: 'create' }),
    true,
  );
});

test('rememberHostRoom does not throw when storage rejects writes', () => {
  assert.doesNotThrow(() => rememberHostRoom(brokenStorage(), 'ABCDE'));
});

test('forgetHostRoom does not throw when storage rejects removes', () => {
  assert.doesNotThrow(() => forgetHostRoom(brokenStorage()));
});
