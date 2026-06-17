import { test } from 'node:test';
import assert from 'node:assert/strict';
import { visiblePuzzles, latestPuzzle } from './puzzleFilter.js';

/** @type {import('./daily.js').DailyPuzzle[]} */
const SAMPLE = [
  { n: 1, date: '2026-06-06', filter: 'a', answers: ['x'] },
  { n: 2, date: '2026-06-07', filter: 'a', answers: ['x'] },
  { n: 3, date: '2026-06-08', filter: 'a', answers: ['x'] },
  { n: 4, date: '2026-06-09', filter: 'a', answers: ['x'] },
];

test('visiblePuzzles: includes the entry whose date is today', () => {
  const out = visiblePuzzles(SAMPLE, '2026-06-08');
  assert.deepEqual(
    out.map((p) => p.n),
    [1, 2, 3],
  );
});

test('visiblePuzzles: excludes future entries', () => {
  const out = visiblePuzzles(SAMPLE, '2026-06-07');
  assert.deepEqual(
    out.map((p) => p.n),
    [1, 2],
  );
});

test('visiblePuzzles: empty when today is before the first entry', () => {
  assert.deepEqual(visiblePuzzles(SAMPLE, '2026-01-01'), []);
});

test('visiblePuzzles: all visible when today is past the last entry', () => {
  const out = visiblePuzzles(SAMPLE, '2099-12-31');
  assert.equal(out.length, SAMPLE.length);
});

test('visiblePuzzles: preserves entries unchanged (does not mutate)', () => {
  const before = JSON.stringify(SAMPLE);
  visiblePuzzles(SAMPLE, '2026-06-08');
  assert.equal(JSON.stringify(SAMPLE), before);
});

test('latestPuzzle: returns the highest-dated visible entry', () => {
  const got = latestPuzzle(SAMPLE, '2026-06-08');
  assert.equal(got?.n, 3);
});

test('latestPuzzle: returns null when nothing is visible yet', () => {
  assert.equal(latestPuzzle(SAMPLE, '2026-01-01'), null);
});

test('latestPuzzle: tolerates out-of-order input', () => {
  const shuffled = [SAMPLE[2], SAMPLE[0], SAMPLE[3], SAMPLE[1]];
  const got = latestPuzzle(shuffled, '2026-06-09');
  assert.equal(got?.n, 4);
});

test('latestPuzzle: empty catalog returns null', () => {
  assert.equal(latestPuzzle([], '2026-06-09'), null);
});
