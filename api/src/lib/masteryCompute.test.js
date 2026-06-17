const { test } = require('node:test');
const assert = require('node:assert/strict');

const { computeMastery } = require('./masteryCompute');

test('empty input → both counters zero', () => {
  assert.deepEqual(computeMastery([]), { cleanSweeps: 0, zeroScoreFinishes: 0 });
});

test('single clean sweep (foundCodes.length === totalCount)', () => {
  const docs = [{ foundCodes: ['a', 'b', 'c'], totalCount: 3 }];
  assert.deepEqual(computeMastery(docs), { cleanSweeps: 1, zeroScoreFinishes: 0 });
});

test('single zero-score finish (foundCodes empty)', () => {
  const docs = [{ foundCodes: [], totalCount: 5 }];
  assert.deepEqual(computeMastery(docs), { cleanSweeps: 0, zeroScoreFinishes: 1 });
});

test('partial finish (some found, not all) → neither counter increments', () => {
  const docs = [{ foundCodes: ['a', 'b'], totalCount: 4 }];
  assert.deepEqual(computeMastery(docs), { cleanSweeps: 0, zeroScoreFinishes: 0 });
});

test('replay path: two clean sweeps on the same puzzle count twice', () => {
  // Rule counts *moments of mastery*, not unique puzzles. A second
  // 100% on puzzle #3 still feels like an achievement to the player.
  const docs = [
    { foundCodes: ['a', 'b'], totalCount: 2 },
    { foundCodes: ['a', 'b'], totalCount: 2 },
  ];
  assert.deepEqual(computeMastery(docs), { cleanSweeps: 2, zeroScoreFinishes: 0 });
});

test('mixed batch — counts each independently', () => {
  const docs = [
    { foundCodes: ['a'], totalCount: 1 },           // clean sweep
    { foundCodes: [], totalCount: 4 },              // zero
    { foundCodes: ['a', 'b'], totalCount: 5 },      // partial — neither
    { foundCodes: ['a', 'b', 'c'], totalCount: 3 }, // clean sweep
    { foundCodes: [], totalCount: 10 },             // zero
  ];
  assert.deepEqual(computeMastery(docs), { cleanSweeps: 2, zeroScoreFinishes: 2 });
});

test('a 1-flag clean sweep still counts (no boundary off-by-one)', () => {
  const docs = [{ foundCodes: ['only'], totalCount: 1 }];
  assert.deepEqual(computeMastery(docs), { cleanSweeps: 1, zeroScoreFinishes: 0 });
});

test('rows with missing foundCodes are skipped, not crashed', () => {
  const docs = [
    { totalCount: 3 },
    { foundCodes: ['a'], totalCount: 1 },
  ];
  assert.deepEqual(computeMastery(docs), { cleanSweeps: 1, zeroScoreFinishes: 0 });
});

test('rows with non-array foundCodes are skipped', () => {
  const docs = [
    { foundCodes: 'not-an-array', totalCount: 3 },
    { foundCodes: ['a'], totalCount: 1 },
  ];
  assert.deepEqual(computeMastery(docs), { cleanSweeps: 1, zeroScoreFinishes: 0 });
});

test('rows with non-numeric totalCount are skipped', () => {
  const docs = [
    { foundCodes: ['a'], totalCount: 'oops' },
    { foundCodes: ['a'], totalCount: 1 },
  ];
  assert.deepEqual(computeMastery(docs), { cleanSweeps: 1, zeroScoreFinishes: 0 });
});

test('null docs argument is tolerated (no crash)', () => {
  assert.deepEqual(computeMastery(null), { cleanSweeps: 0, zeroScoreFinishes: 0 });
});

test('null individual rows are skipped', () => {
  const docs = [null, { foundCodes: ['a'], totalCount: 1 }];
  assert.deepEqual(computeMastery(docs), { cleanSweeps: 1, zeroScoreFinishes: 0 });
});
