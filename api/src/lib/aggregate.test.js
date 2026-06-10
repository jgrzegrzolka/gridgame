const test = require('node:test');
const assert = require('node:assert/strict');
const { aggregate } = require('./aggregate');

test('empty input returns empty stats', () => {
  assert.deepEqual(aggregate([]), {
    totalAttempts: 0,
    perCodeFinds: {},
    mean: 0,
    topPct: 0,
  });
});

test('non-array input is treated as empty', () => {
  assert.deepEqual(aggregate(null), {
    totalAttempts: 0,
    perCodeFinds: {},
    mean: 0,
    topPct: 0,
  });
});

test('single perfect row → 100% top, mean = totalCount', () => {
  const r = aggregate([{ foundCodes: ['ch', 'dk', 'gb'], totalCount: 3 }]);
  assert.deepEqual(r, {
    totalAttempts: 1,
    perCodeFinds: { ch: 1, dk: 1, gb: 1 },
    mean: 3,
    topPct: 100,
  });
});

test('single non-perfect row → 0% top, mean = own score', () => {
  const r = aggregate([{ foundCodes: ['ch'], totalCount: 3 }]);
  assert.equal(r.topPct, 0);
  assert.equal(r.mean, 1);
});

test('perCodeFinds counts each code across all rows', () => {
  const rows = [
    { foundCodes: ['ch', 'dk'], totalCount: 3 },
    { foundCodes: ['ch', 'gb'], totalCount: 3 },
    { foundCodes: ['ch'],       totalCount: 3 },
  ];
  const r = aggregate(rows);
  assert.deepEqual(r.perCodeFinds, { ch: 3, dk: 1, gb: 1 });
  assert.equal(r.totalAttempts, 3);
});

test('topPct counts rows where length === totalCount', () => {
  const rows = [
    { foundCodes: ['a', 'b', 'c'], totalCount: 3 }, // perfect
    { foundCodes: ['a', 'b'],      totalCount: 3 },
    { foundCodes: ['a', 'b', 'c'], totalCount: 3 }, // perfect
    { foundCodes: ['a'],           totalCount: 3 },
  ];
  // 2 of 4 perfect = 50
  assert.equal(aggregate(rows).topPct, 50);
});

test('topPct rounds to nearest integer', () => {
  const rows = Array.from({ length: 7 }, (_, i) => ({
    foundCodes: i < 2 ? ['a', 'b', 'c'] : ['a'],
    totalCount: 3,
  }));
  // 2/7 = 28.57… → 29
  assert.equal(aggregate(rows).topPct, 29);
});

test('mean is the arithmetic average of foundCodes lengths', () => {
  const rows = [
    { foundCodes: ['a'],                totalCount: 5 },
    { foundCodes: ['a', 'b'],           totalCount: 5 },
    { foundCodes: ['a', 'b', 'c'],      totalCount: 5 },
    { foundCodes: ['a', 'b', 'c', 'd'], totalCount: 5 },
    { foundCodes: ['a', 'b', 'c', 'd', 'e'], totalCount: 5 },
  ];
  // (1 + 2 + 3 + 4 + 5) / 5 = 3
  assert.equal(aggregate(rows).mean, 3);
});

test('mean rounds to one decimal place — .5 stays .5 (no integer rounding)', () => {
  const rows = [
    { foundCodes: ['a'],                totalCount: 4 },
    { foundCodes: ['a', 'b'],           totalCount: 4 },
    { foundCodes: ['a', 'b', 'c'],      totalCount: 4 },
    { foundCodes: ['a', 'b', 'c', 'd'], totalCount: 4 },
  ];
  // (1 + 2 + 3 + 4) / 4 = 2.5 → 2.5
  assert.equal(aggregate(rows).mean, 2.5);
});

test('mean: two rows 2/3 and 3/3 reads as 2.5/3 (the puzzle 5 case)', () => {
  // Regression protection from a real prod case: with two submissions
  // (one perfect, one one-short), integer rounding of 2.5 bumped the
  // headline to 3/3 while one tile clearly showed 50%. One-decimal
  // rounding gives 2.5, which lines up with the tiles.
  const rows = [
    { foundCodes: ['a', 'b'], totalCount: 3 },
    { foundCodes: ['a', 'b', 'c'], totalCount: 3 },
  ];
  assert.equal(aggregate(rows).mean, 2.5);
});

test('mean: 9/9, 9/9, 1/9 reads as 6.3 (formerly 6 under integer rounding)', () => {
  // Same screenshot regression we previously pinned at 6 with integer
  // rounding — now reports the fractional value. 19/3 = 6.333… → 6.3.
  const rows = [
    { foundCodes: Array.from({ length: 9 }, (_, i) => `c${i}`), totalCount: 9 },
    { foundCodes: Array.from({ length: 9 }, (_, i) => `c${i}`), totalCount: 9 },
    { foundCodes: ['c0'], totalCount: 9 },
  ];
  assert.equal(aggregate(rows).mean, 6.3);
});

test('mean tolerates unsorted input lengths', () => {
  const rows = [
    { foundCodes: ['a', 'b', 'c', 'd', 'e'], totalCount: 5 },
    { foundCodes: ['a'], totalCount: 5 },
    { foundCodes: ['a', 'b'], totalCount: 5 },
  ];
  // (5 + 1 + 2) / 3 = 2.666… → 2.7
  assert.equal(aggregate(rows).mean, 2.7);
});

test('row with missing totalCount still contributes to counts and mean', () => {
  const rows = [
    { foundCodes: ['a', 'b'] }, // no totalCount
    { foundCodes: ['a'], totalCount: 2 },
  ];
  const r = aggregate(rows);
  assert.equal(r.totalAttempts, 2);
  assert.deepEqual(r.perCodeFinds, { a: 2, b: 1 });
  // (2 + 1) / 2 = 1.5
  assert.equal(r.mean, 1.5);
  // totalCount inherited from later row = 2; row 1 with length 2 counts as perfect
  assert.equal(r.topPct, 50);
});

test('row with missing foundCodes is tolerated as zero-find', () => {
  const rows = [
    { totalCount: 3 },
    { foundCodes: ['a', 'b', 'c'], totalCount: 3 },
  ];
  const r = aggregate(rows);
  assert.equal(r.totalAttempts, 2);
  assert.deepEqual(r.perCodeFinds, { a: 1, b: 1, c: 1 });
  // (0 + 3) / 2 = 1.5
  assert.equal(r.mean, 1.5);
  assert.equal(r.topPct, 50);
});

test('whole-number means stay whole (no trailing ".0")', () => {
  // Important UX detail: when the mean is exactly N, the headline
  // should read "N/total" not "N.0/total". Math.round(N*10)/10 = N
  // preserves the integer when it's clean.
  const rows = [
    { foundCodes: ['a', 'b', 'c'], totalCount: 3 },
    { foundCodes: ['a', 'b', 'c'], totalCount: 3 },
  ];
  const r = aggregate(rows);
  assert.equal(r.mean, 3);
  // Sanity: this is the literal number 3, not 3.0 — String(3) === '3'.
  assert.equal(String(r.mean), '3');
});
