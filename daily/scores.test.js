import { test } from 'node:test';
import assert from 'node:assert/strict';

import { loadScores, saveScore, formatScore, isCompleteRecord, applyScoreMigrations, migrateScores } from './scores.js';

function fakeStore(initial = {}) {
  /** @type {Map<string, string>} */
  const m = new Map(Object.entries(initial));
  return {
    /** @param {string} k */
    getItem(k) {
      return m.has(k) ? /** @type {string} */ (m.get(k)) : null;
    },
    /** @param {string} k @param {string} v */
    setItem(k, v) {
      m.set(k, v);
    },
    _map: m,
  };
}

test('loadScores returns {} when store is empty', () => {
  const store = fakeStore();
  assert.deepEqual(loadScores(store), {});
});

test('loadScores returns {} when value is malformed JSON', () => {
  const store = fakeStore({ 'daily.scores': '{not json' });
  assert.deepEqual(loadScores(store), {});
});

test('loadScores returns {} when value is not an object', () => {
  const store = fakeStore({ 'daily.scores': '42' });
  assert.deepEqual(loadScores(store), {});
});

test('saveScore + loadScores roundtrips minimal {f, t}', () => {
  const store = fakeStore();
  saveScore(store, 1, 5, 9);
  saveScore(store, 3, 11, 11);
  assert.deepEqual(loadScores(store), {
    1: { f: 5, t: 9 },
    3: { f: 11, t: 11 },
  });
});

test('saveScore + loadScores roundtrips full {f, t, c}', () => {
  const store = fakeStore();
  saveScore(store, 1, 3, 9, ['fi', 'no', 'se']);
  assert.deepEqual(loadScores(store), {
    1: { f: 3, t: 9, c: ['fi', 'no', 'se'] },
  });
});

test('saveScore does NOT overwrite an existing entry (first-attempt-only)', () => {
  // The archive locks in the player's first attempt — replays are
  // silently dropped. Mirrors the server-side rule (insert-only Cosmos
  // 409s on duplicate (puzzleId, deviceId)) so a replay can't make
  // local and Cosmos disagree about which attempt counts.
  const store = fakeStore();
  saveScore(store, 1, 3, 9, ['a', 'b', 'c']);
  saveScore(store, 1, 7, 9, ['a', 'b', 'c', 'd', 'e', 'f', 'g']);
  assert.deepEqual(loadScores(store), {
    1: { f: 3, t: 9, c: ['a', 'b', 'c'] },
  });
});

test('saveScore does NOT overwrite even a minimal {f, t} record', () => {
  // Legacy records from before 2026-06-06 don't have `c`. The rule is
  // strict — first save wins regardless of completeness. The cost is
  // that those legacy records can't be upgraded to {f, t, c} by a
  // replay; revisits of legacy puzzles will play through instead of
  // jumping to the result page. Acceptable: any player who replays
  // will pin a new full record from then on for new puzzles.
  const store = fakeStore();
  saveScore(store, 1, 3, 9); // legacy shape: no codes
  saveScore(store, 1, 7, 9, ['a', 'b', 'c', 'd', 'e', 'f', 'g']);
  assert.deepEqual(loadScores(store), {
    1: { f: 3, t: 9 },
  });
});

test('loadScores drops entries with missing or wrong-typed core fields', () => {
  const store = fakeStore({
    'daily.scores': JSON.stringify({
      1: { f: 4, t: 9 },
      2: { f: '4', t: 9 }, // wrong type
      3: null, // missing
      4: { f: 4 }, // missing t
      bad: { f: 4, t: 9 }, // non-integer key
    }),
  });
  assert.deepEqual(loadScores(store), { 1: { f: 4, t: 9 } });
});

test('loadScores keeps core fields but drops a malformed c', () => {
  const store = fakeStore({
    'daily.scores': JSON.stringify({
      1: { f: 3, t: 9, c: 'not-an-array' },
      2: { f: 3, t: 9, c: ['fi', 5] }, // wrong element type
    }),
  });
  // c gets dropped; f/t survive in each case.
  assert.deepEqual(loadScores(store), {
    1: { f: 3, t: 9 },
    2: { f: 3, t: 9 },
  });
});

test('loadScores ignores legacy ms field on stored records', () => {
  // Records written before the timer was removed (2026-06-07) carried an
  // `ms` (elapsed milliseconds) field. The new loader simply doesn't read
  // it — old records still load cleanly; ms is dropped on next save.
  const store = fakeStore({
    'daily.scores': JSON.stringify({
      1: { f: 3, t: 9, c: ['fi'], ms: 42500 },
    }),
  });
  assert.deepEqual(loadScores(store), {
    1: { f: 3, t: 9, c: ['fi'] },
  });
});

test('formatScore renders "f/t" or null', () => {
  assert.equal(formatScore({ f: 3, t: 9 }), '3/9');
  assert.equal(formatScore({ f: 0, t: 5 }), '0/5');
  assert.equal(formatScore(undefined), null);
});

test('isCompleteRecord is true when c is present', () => {
  assert.equal(isCompleteRecord(undefined), false);
  assert.equal(isCompleteRecord({ f: 3, t: 9 }), false);
  assert.equal(isCompleteRecord({ f: 3, t: 9, c: ['fi'] }), true);
});

test('applyScoreMigrations: puzzle1_add_li credits past 9/9 finishers with li', () => {
  const { scores, changed } = applyScoreMigrations({
    1: { f: 9, t: 9, c: ['ch', 'dk', 'fi', 'gb', 'gr', 'is', 'mt', 'no', 'se'] },
  });
  assert.equal(changed, true);
  assert.equal(scores[1].f, 10);
  assert.equal(scores[1].t, 10);
  assert.ok(scores[1].c.includes('li'));
});

test('applyScoreMigrations: puzzle1_add_li credits partial finishers too (7/9 → 8/10)', () => {
  const { scores } = applyScoreMigrations({
    1: { f: 7, t: 9, c: ['ch', 'dk', 'fi', 'gb', 'gr', 'is', 'mt'] },
  });
  assert.equal(scores[1].f, 8);
  assert.equal(scores[1].t, 10);
  assert.ok(scores[1].c.includes('li'));
});

test('applyScoreMigrations: skipped record without c still gets credit', () => {
  const { scores, changed } = applyScoreMigrations({ 1: { f: 5, t: 9 } });
  assert.equal(changed, true);
  assert.equal(scores[1].t, 10);
  assert.deepEqual(scores[1].c, ['li']);
});

test('applyScoreMigrations: already-migrated record is left alone', () => {
  const before = { 1: { f: 10, t: 10, c: ['ch', 'dk', 'fi', 'gb', 'gr', 'is', 'li', 'mt', 'no', 'se'] } };
  const { changed } = applyScoreMigrations(before);
  assert.equal(changed, false);
});

test('applyScoreMigrations: no #1 record → no-op', () => {
  const { changed } = applyScoreMigrations({ 5: { f: 3, t: 7 } });
  assert.equal(changed, false);
});

test('migrateScores persists when migration applies', () => {
  const store = fakeStore({
    'daily.scores': JSON.stringify({ 1: { f: 9, t: 9, c: ['ch', 'dk', 'fi', 'gb', 'gr', 'is', 'mt', 'no', 'se'] } }),
  });
  migrateScores(store);
  const after = loadScores(store);
  assert.equal(after[1].t, 10);
  assert.ok(after[1].c.includes('li'));
});

test('migrateScores does not write when nothing changed', () => {
  const store = fakeStore({ 'daily.scores': JSON.stringify({ 5: { f: 3, t: 7 } }) });
  const before = store._map.get('daily.scores');
  migrateScores(store);
  assert.equal(store._map.get('daily.scores'), before);
});
