import test from 'node:test';
import assert from 'node:assert/strict';
import { computeVerdict, formatMultiplier, formatAvg } from './verdict.js';

test('no stats: mean of 0 / negative / non-finite → null', () => {
  assert.equal(computeVerdict(10, 0), null);
  assert.equal(computeVerdict(10, -2), null);
  assert.equal(computeVerdict(10, NaN), null);
  assert.equal(computeVerdict(10, Infinity), null);
  assert.equal(computeVerdict(10, undefined), null);
});

test('non-finite found → null', () => {
  assert.equal(computeVerdict(NaN, 5), null);
});

test('r ≥ 1.5 → multiplier, k snapped to nearest 0.5', () => {
  // 14 / 6.6 = 2.12 → k = round(4.24)/2 = 2
  assert.deepEqual(computeVerdict(14, 6.6), { kind: 'multiplier', k: 2 });
  // 2.3× → round(4.6)/2 = 2.5
  assert.deepEqual(computeVerdict(23, 10), { kind: 'multiplier', k: 2.5 });
});

test('r exactly 1.5 → multiplier of 1.5 (the boundary belongs to multiplier)', () => {
  assert.deepEqual(computeVerdict(3, 2), { kind: 'multiplier', k: 1.5 });
});

test('the multiplier can never round below 1.5 (its own threshold)', () => {
  // r just over 1.5 still snaps to 1.5, never 1.0
  const v = computeVerdict(151, 100);
  assert.deepEqual(v, { kind: 'multiplier', k: 1.5 });
});

test('1.1 ≤ r < 1.5 → above, no multiplier', () => {
  // 6 / 5.0 = 1.2
  assert.deepEqual(computeVerdict(6, 5), { kind: 'above' });
  // r = 1.1 boundary belongs to above
  assert.deepEqual(computeVerdict(11, 10), { kind: 'above' });
  // r = 1.49 still above (not yet multiplier)
  assert.deepEqual(computeVerdict(149, 100), { kind: 'above' });
});

test('0.9 ≤ r < 1.1 → level, muted', () => {
  // 7 / 7.1 = 0.986
  assert.deepEqual(computeVerdict(7, 7.1), { kind: 'level' });
  assert.deepEqual(computeVerdict(9, 10), { kind: 'level' }); // r = 0.9 boundary
  assert.deepEqual(computeVerdict(109, 100), { kind: 'level' }); // r = 1.09
});

test('r < 0.9 → null (the board never scolds)', () => {
  // 6 / 7.1 = 0.845
  assert.equal(computeVerdict(6, 7.1), null);
  assert.equal(computeVerdict(0, 5), null);
  assert.equal(computeVerdict(89, 100), null); // r = 0.89, just under
});

test('formatMultiplier: whole numbers drop the decimal', () => {
  assert.equal(formatMultiplier(2, 'pl'), '2');
  assert.equal(formatMultiplier(2, 'en'), '2');
  assert.equal(formatMultiplier(3, 'pl'), '3');
});

test('formatMultiplier: halves use the locale separator', () => {
  assert.equal(formatMultiplier(2.5, 'pl'), '2,5');
  assert.equal(formatMultiplier(2.5, 'en'), '2.5');
  assert.equal(formatMultiplier(1.5, 'pl'), '1,5');
});

test('formatAvg: Polish comma, English dot, whole numbers bare', () => {
  assert.equal(formatAvg(6.6, 'pl'), '6,6');
  assert.equal(formatAvg(6.6, 'en'), '6.6');
  assert.equal(formatAvg(7, 'pl'), '7');
  assert.equal(formatAvg(7, 'en'), '7');
});
