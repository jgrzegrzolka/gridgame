const { test } = require('node:test');
const assert = require('node:assert/strict');

const { computeMastery } = require('./masteryCompute');

test('empty input → every counter zero', () => {
  assert.deepEqual(computeMastery([]), { cleanSweeps: 0, flawlessSweeps: 0, zeroScoreFinishes: 0 });
});

test('single clean sweep with wrong guesses → cleanSweeps only', () => {
  // Player found everything but had wrong guesses along the way →
  // counts as a clean sweep, NOT as flawless.
  const docs = [{ foundCodes: ['a', 'b', 'c'], wrongCodes: ['z'], totalCount: 3 }];
  assert.deepEqual(computeMastery(docs), { cleanSweeps: 1, flawlessSweeps: 0, zeroScoreFinishes: 0 });
});

test('flawless sweep (clean + zero wrong) increments both', () => {
  // Flawless is a strict subset of clean — every flawless is also clean.
  const docs = [{ foundCodes: ['a', 'b', 'c'], wrongCodes: [], totalCount: 3 }];
  assert.deepEqual(computeMastery(docs), { cleanSweeps: 1, flawlessSweeps: 1, zeroScoreFinishes: 0 });
});

test('flawlessSweeps never exceeds cleanSweeps (invariant)', () => {
  // Pin the subset relationship — if a refactor ever increments
  // flawless without first matching the clean-sweep predicate, this
  // catches it.
  const docs = [
    { foundCodes: ['a'], wrongCodes: [], totalCount: 1 },        // both++
    { foundCodes: ['a'], wrongCodes: ['x'], totalCount: 1 },     // clean only
    { foundCodes: ['a'], wrongCodes: [], totalCount: 1 },        // both++
    { foundCodes: ['a', 'b'], wrongCodes: [], totalCount: 5 },   // partial — neither
  ];
  const r = computeMastery(docs);
  assert.equal(r.cleanSweeps, 3);
  assert.equal(r.flawlessSweeps, 2);
  assert.ok(r.flawlessSweeps <= r.cleanSweeps);
});

test('single zero-score finish (foundCodes empty)', () => {
  const docs = [{ foundCodes: [], wrongCodes: [], totalCount: 5 }];
  assert.deepEqual(computeMastery(docs), { cleanSweeps: 0, flawlessSweeps: 0, zeroScoreFinishes: 1 });
});

test('partial finish (some found, not all) → no counter increments', () => {
  const docs = [{ foundCodes: ['a', 'b'], wrongCodes: [], totalCount: 4 }];
  assert.deepEqual(computeMastery(docs), { cleanSweeps: 0, flawlessSweeps: 0, zeroScoreFinishes: 0 });
});

test('replay path: two flawless sweeps on the same puzzle count twice', () => {
  // Rule counts *moments of mastery*, not unique puzzles. A second
  // 100% on puzzle #3 still feels like an achievement to the player.
  const docs = [
    { foundCodes: ['a', 'b'], wrongCodes: [], totalCount: 2 },
    { foundCodes: ['a', 'b'], wrongCodes: [], totalCount: 2 },
  ];
  assert.deepEqual(computeMastery(docs), { cleanSweeps: 2, flawlessSweeps: 2, zeroScoreFinishes: 0 });
});

test('mixed batch — counts each independently', () => {
  const docs = [
    { foundCodes: ['a'], wrongCodes: [], totalCount: 1 },           // clean + flawless
    { foundCodes: [], wrongCodes: [], totalCount: 4 },              // zero
    { foundCodes: ['a', 'b'], wrongCodes: [], totalCount: 5 },      // partial — neither
    { foundCodes: ['a', 'b', 'c'], wrongCodes: ['z'], totalCount: 3 }, // clean only
    { foundCodes: [], wrongCodes: ['x'], totalCount: 10 },          // zero
  ];
  assert.deepEqual(computeMastery(docs), { cleanSweeps: 2, flawlessSweeps: 1, zeroScoreFinishes: 2 });
});

test('a 1-flag flawless sweep still counts (no boundary off-by-one)', () => {
  const docs = [{ foundCodes: ['only'], wrongCodes: [], totalCount: 1 }];
  assert.deepEqual(computeMastery(docs), { cleanSweeps: 1, flawlessSweeps: 1, zeroScoreFinishes: 0 });
});

test('rows with missing foundCodes are skipped, not crashed', () => {
  const docs = [
    { totalCount: 3 },
    { foundCodes: ['a'], wrongCodes: [], totalCount: 1 },
  ];
  assert.deepEqual(computeMastery(docs), { cleanSweeps: 1, flawlessSweeps: 1, zeroScoreFinishes: 0 });
});

test('rows with non-array foundCodes are skipped', () => {
  const docs = [
    { foundCodes: 'not-an-array', wrongCodes: [], totalCount: 3 },
    { foundCodes: ['a'], wrongCodes: [], totalCount: 1 },
  ];
  assert.deepEqual(computeMastery(docs), { cleanSweeps: 1, flawlessSweeps: 1, zeroScoreFinishes: 0 });
});

test('rows with non-numeric totalCount are skipped', () => {
  const docs = [
    { foundCodes: ['a'], wrongCodes: [], totalCount: 'oops' },
    { foundCodes: ['a'], wrongCodes: [], totalCount: 1 },
  ];
  assert.deepEqual(computeMastery(docs), { cleanSweeps: 1, flawlessSweeps: 1, zeroScoreFinishes: 0 });
});

test('clean sweep with missing wrongCodes → counts as clean, not flawless', () => {
  // Defensive: a pre-flawlessSweeps row that's missing wrongCodes
  // shouldn't quietly count as flawless (we don't know what was
  // guessed wrong). Real rows from buildDailyResultDoc always carry
  // it; this is the upgrade-path guard.
  const docs = [{ foundCodes: ['a', 'b'], totalCount: 2 }];
  assert.deepEqual(computeMastery(docs), { cleanSweeps: 1, flawlessSweeps: 0, zeroScoreFinishes: 0 });
});

test('clean sweep with non-array wrongCodes → counts as clean, not flawless', () => {
  const docs = [{ foundCodes: ['a'], wrongCodes: 'oops', totalCount: 1 }];
  assert.deepEqual(computeMastery(docs), { cleanSweeps: 1, flawlessSweeps: 0, zeroScoreFinishes: 0 });
});

test('null docs argument is tolerated (no crash)', () => {
  assert.deepEqual(computeMastery(null), { cleanSweeps: 0, flawlessSweeps: 0, zeroScoreFinishes: 0 });
});

test('null individual rows are skipped', () => {
  const docs = [null, { foundCodes: ['a'], wrongCodes: [], totalCount: 1 }];
  assert.deepEqual(computeMastery(docs), { cleanSweeps: 1, flawlessSweeps: 1, zeroScoreFinishes: 0 });
});
