import { test } from 'node:test';
import assert from 'node:assert/strict';
import { barFractions } from './partyChart.js';

test('all-positive metrics read as a share of the biggest', () => {
  // The common case, and the one a player intuitively expects: the winner fills
  // the bar and everyone else is a visible proportion of it.
  const f = barFractions(['a', 'b', 'c', 'd'], { a: 100, b: 50, c: 25, d: 0 });
  assert.deepEqual(f, [1, 0.5, 0.25, 0]);
});

test('a negative metric never produces a negative bar', () => {
  // THE reason this is normalised across the range rather than value/max.
  // Temperature bottoms out at -49C; under value/max that country's bar is
  // negative, which renders as no bar rather than as an obviously wrong one.
  const f = barFractions(['hot', 'mild', 'cold'], { hot: 30, mild: 0, cold: -49 });
  for (const x of f) assert.ok(x >= 0 && x <= 1, `fraction ${x} out of range`);
  assert.equal(f[2], 0, 'the coldest sits at the floor');
  assert.ok(f[0] > f[1] && f[1] > f[2], 'and the order still reads correctly');
});

test('an all-negative quartet still ranks, rather than collapsing to nothing', () => {
  const f = barFractions(['a', 'b', 'c'], { a: -5, b: -20, c: -49 });
  assert.ok(f[0] > f[1] && f[1] > f[2], 'warmest longest, coldest shortest');
  assert.equal(f[2], 0);
  for (const x of f) assert.ok(x >= 0 && x <= 1);
});

test('a least-question ranks ascending and the bars follow the VALUES', () => {
  // On a "least" question ranking[0] is the smallest, so the bars grow as you
  // read down. That is deliberate: position encodes the answer, length encodes
  // the value, and both are labelled. Pinned so it is not "fixed" by accident.
  const f = barFractions(['smallest', 'mid', 'biggest'], { smallest: 10, mid: 50, biggest: 100 });
  assert.ok(f[0] < f[1] && f[1] < f[2], 'bar length tracks the value, not the rank');
});

test('identical values give every bar the same length', () => {
  // No range to normalise against. A full bar each is the honest reading of
  // "these are the same"; dividing by a zero span would give NaN.
  const f = barFractions(['a', 'b'], { a: 7, b: 7 });
  assert.deepEqual(f, [1, 1]);
  for (const x of f) assert.ok(Number.isFinite(x));
});

test('all-zero values do not divide by zero', () => {
  const f = barFractions(['a', 'b'], { a: 0, b: 0 });
  for (const x of f) assert.ok(Number.isFinite(x), 'no NaN from a zero span');
});

test('a missing or malformed value counts as zero rather than throwing', () => {
  // The reveal carries a value for every option it ranks, so a gap means a
  // stale or partial payload. A short bar beats a broken chart.
  const f = barFractions(['a', 'b', 'c', 'd'], { a: 100, c: /** @type {any} */ ('50'), d: NaN });
  assert.equal(f.length, 4);
  for (const x of f) assert.ok(Number.isFinite(x) && x >= 0 && x <= 1);
  assert.equal(f[0], 1, 'the one real value still anchors the top');
});

test('empty or absent inputs return an empty list, not a crash', () => {
  assert.deepEqual(barFractions([], { a: 1 }), []);
  assert.deepEqual(barFractions(/** @type {any} */ (null), { a: 1 }), []);
  assert.deepEqual(barFractions(['a'], null), [0]);
  assert.deepEqual(barFractions(['a'], undefined), [0]);
});

test('one option is a full bar', () => {
  assert.deepEqual(barFractions(['a'], { a: 42 }), [1]);
});
