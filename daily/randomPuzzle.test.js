import test from 'node:test';
import assert from 'node:assert/strict';
import { unplayedPuzzles, pickRandomPuzzle } from './randomPuzzle.js';

/** @param {number} n */
const p = (n) => /** @type {any} */ ({ n, date: '2026-01-01', filter: 'continent:Europe', answers: ['fr'] });
const CATALOG = [p(1), p(2), p(3), p(4)];
/** @param {number[]} ns */
const played = (ns) => Object.fromEntries(ns.map((n) => [n, { f: 1, t: 1 }]));

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
  assert.equal(unplayedPuzzles(CATALOG, /** @type {any} */ (null)).length, 4);
});

test('pickRandomPuzzle: prefers an unplayed puzzle over a played one', () => {
  // Pool is [1, 3]; rand 0.99 must land on 3, never on 4.
  const got = pickRandomPuzzle(CATALOG, played([2, 4]), () => 0.99);
  assert.equal(got?.n, 3);
});

test('pickRandomPuzzle: still offers a puzzle when every one has been played', () => {
  // The regression this file exists for. Removing the action once the
  // player has completed the archive hides it from the only people who
  // ever get there.
  const got = pickRandomPuzzle(CATALOG, played([1, 2, 3, 4]), () => 0.5);
  assert.ok(got, 'a fully-played archive must still yield a puzzle');
  assert.ok([1, 2, 3, 4].includes(got.n));
});

test('pickRandomPuzzle: the all-played fallback spans the whole catalog', () => {
  const seen = new Set();
  for (let i = 0; i < 2000; i++) {
    const got = pickRandomPuzzle(CATALOG, played([1, 2, 3, 4]));
    seen.add(got?.n);
  }
  assert.deepEqual([...seen].sort(), [1, 2, 3, 4], 'not stuck on one entry');
});

test('pickRandomPuzzle: returns null only when the catalog itself is empty', () => {
  assert.equal(pickRandomPuzzle([], {}), null);
  assert.equal(pickRandomPuzzle(/** @type {any} */ (undefined), {}), null);
});

test('pickRandomPuzzle: rand at the bottom of the range picks the first candidate', () => {
  assert.equal(pickRandomPuzzle(CATALOG, played([1]), () => 0)?.n, 2);
});

test('pickRandomPuzzle: a rand of exactly 1 is clamped, not out of range', () => {
  // Math.random never returns 1, but a stub or polyfill can. Without the
  // clamp this indexes off the end and returns undefined.
  assert.equal(pickRandomPuzzle(CATALOG, {}, () => 1)?.n, 4);
});

test('pickRandomPuzzle: every unplayed candidate is reachable over many draws', () => {
  // A shape assertion ("returns something unplayed") passes against a
  // picker that always returns the same entry. Measure the spread instead.
  const seen = new Set();
  for (let i = 0; i < 2000; i++) {
    const got = pickRandomPuzzle(CATALOG, played([2]));
    assert.ok(got && got.n !== 2, 'never offers a played puzzle while unplayed ones remain');
    seen.add(got.n);
  }
  assert.deepEqual([...seen].sort(), [1, 3, 4], 'all three candidates come up');
});
