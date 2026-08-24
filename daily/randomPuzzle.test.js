import test from 'node:test';
import assert from 'node:assert/strict';
import { unplayedPuzzles, pickRandomUnplayed } from './randomUnplayed.js';

/** @param {number} n */
const p = (n) => /** @type {any} */ ({ n, date: '2026-01-01', filter: 'continent:Europe', answers: ['fr'] });
const CATALOG = [p(1), p(2), p(3), p(4)];

test('unplayedPuzzles: entries with a saved score are excluded', () => {
  const out = unplayedPuzzles(CATALOG, { 2: { f: 3, t: 5 }, 4: { f: 5, t: 5 } });
  assert.deepEqual(out.map((e) => e.n), [1, 3]);
});

test('unplayedPuzzles: no scores at all means everything is a candidate', () => {
  assert.deepEqual(unplayedPuzzles(CATALOG, {}).map((e) => e.n), [1, 2, 3, 4]);
});

test('unplayedPuzzles: a zero-score record still counts as played', () => {
  // 0/5 is a real record (played and scored nothing), not an absent one.
  // A truthiness bug on the score object would wrongly re-offer it.
  const out = unplayedPuzzles(CATALOG, { 3: { f: 0, t: 5 } });
  assert.deepEqual(out.map((e) => e.n), [1, 2, 4]);
});

test('unplayedPuzzles: tolerates a missing catalog or scores map', () => {
  assert.deepEqual(unplayedPuzzles(/** @type {any} */ (undefined), {}), []);
  assert.deepEqual(unplayedPuzzles(CATALOG, /** @type {any} */ (null)).length, 4);
});

test('pickRandomUnplayed: returns null when every puzzle has been played', () => {
  const all = { 1: { f: 1, t: 1 }, 2: { f: 1, t: 1 }, 3: { f: 1, t: 1 }, 4: { f: 1, t: 1 } };
  assert.equal(pickRandomUnplayed(CATALOG, all), null);
});

test('pickRandomUnplayed: returns null on an empty catalog', () => {
  assert.equal(pickRandomUnplayed([], {}), null);
});

test('pickRandomUnplayed: picks from the unplayed pool, not the whole catalog', () => {
  // Pool is [1, 3]; rand 0.99 must land on 3, never on 4.
  const got = pickRandomUnplayed(CATALOG, { 2: { f: 1, t: 1 }, 4: { f: 1, t: 1 } }, () => 0.99);
  assert.equal(got?.n, 3);
});

test('pickRandomUnplayed: rand at the bottom of the range picks the first candidate', () => {
  assert.equal(pickRandomUnplayed(CATALOG, { 1: { f: 1, t: 1 } }, () => 0)?.n, 2);
});

test('pickRandomUnplayed: a rand of exactly 1 is clamped, not out of range', () => {
  // Math.random never returns 1, but a stub or polyfill can. Without the
  // clamp this indexes off the end and returns undefined.
  const got = pickRandomUnplayed(CATALOG, {}, () => 1);
  assert.equal(got?.n, 4);
});

test('pickRandomUnplayed: every candidate is reachable over many draws', () => {
  // A shape assertion ("returns something unplayed") passes against a
  // picker that always returns the same entry. Measure the spread instead.
  const seen = new Set();
  for (let i = 0; i < 2000; i++) {
    const got = pickRandomUnplayed(CATALOG, { 2: { f: 1, t: 1 } });
    assert.ok(got && got.n !== 2, 'never offers a played puzzle');
    seen.add(got.n);
  }
  assert.deepEqual([...seen].sort(), [1, 3, 4], 'all three candidates come up');
});
