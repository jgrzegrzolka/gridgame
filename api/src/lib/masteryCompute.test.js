const { test } = require('node:test');
const assert = require('node:assert/strict');

const { computeMastery } = require('./masteryCompute');

test('empty input → every counter zero', () => {
  assert.deepEqual(computeMastery([]), {
    cleanSweeps: 0, flawlessSweeps: 0, attemptedFinishes: 0, zeroScoreFinishes: 0,
  });
});

test('clean sweep with wrong guesses → cleanSweeps + attemptedFinishes', () => {
  // Player found everything but had wrong guesses along the way →
  // counts as a clean sweep AND as an honest attempt (the wrongs
  // prove they played, not "guessed lucky"). NOT flawless.
  const docs = [{ foundCodes: ['a', 'b', 'c'], wrongCodes: ['z'], totalCount: 3 }];
  assert.deepEqual(computeMastery(docs), {
    cleanSweeps: 1, flawlessSweeps: 0, attemptedFinishes: 1, zeroScoreFinishes: 0,
  });
});

test('flawless sweep (clean + zero wrong) → cleanSweeps + flawlessSweeps, NOT attemptedFinishes', () => {
  // Flawless is a strict subset of clean — every flawless is also
  // clean. But a flawless run has no wrong guesses, so it doesn't
  // count as an honest attempt (zero wrong = perfect, not "tried").
  const docs = [{ foundCodes: ['a', 'b', 'c'], wrongCodes: [], totalCount: 3 }];
  assert.deepEqual(computeMastery(docs), {
    cleanSweeps: 1, flawlessSweeps: 1, attemptedFinishes: 0, zeroScoreFinishes: 0,
  });
});

test('flawlessSweeps never exceeds cleanSweeps (invariant)', () => {
  // Pin the subset relationship — if a refactor ever increments
  // flawless without first matching the clean-sweep predicate, this
  // catches it.
  const docs = [
    { foundCodes: ['a'], wrongCodes: [], totalCount: 1 },        // clean + flawless
    { foundCodes: ['a'], wrongCodes: ['x'], totalCount: 1 },     // clean + attempted
    { foundCodes: ['a'], wrongCodes: [], totalCount: 1 },        // clean + flawless
    { foundCodes: ['a', 'b'], wrongCodes: [], totalCount: 5 },   // partial, no wrong — nothing
  ];
  const r = computeMastery(docs);
  assert.equal(r.cleanSweeps, 3);
  assert.equal(r.flawlessSweeps, 2);
  assert.ok(r.flawlessSweeps <= r.cleanSweeps);
});

test('partial finish with wrong guesses → attemptedFinishes only (the honest-attempt sweet spot)', () => {
  // The realistic majority of plays: found some, missed some.
  // This is exactly what the casual tier rewards.
  const docs = [{ foundCodes: ['a', 'b'], wrongCodes: ['z'], totalCount: 4 }];
  assert.deepEqual(computeMastery(docs), {
    cleanSweeps: 0, flawlessSweeps: 0, attemptedFinishes: 1, zeroScoreFinishes: 0,
  });
});

test('partial finish with NO wrong guesses → neither counter (lucky non-sweep — uncommon but possible)', () => {
  // Player submitted with a few right and no wrong. Doesn't count
  // as honest-attempt (no wrongs to prove they tried) or clean-sweep
  // (not 100%). Just a quiet submission.
  const docs = [{ foundCodes: ['a', 'b'], wrongCodes: [], totalCount: 4 }];
  assert.deepEqual(computeMastery(docs), {
    cleanSweeps: 0, flawlessSweeps: 0, attemptedFinishes: 0, zeroScoreFinishes: 0,
  });
});

test('zero-score finish with wrong guesses → zeroScoreFinishes only, NOT attemptedFinishes', () => {
  // The player submitted with zero finds but had wrongs. Empty Slate
  // takes priority — attemptedFinishes requires found >= 1.
  const docs = [{ foundCodes: [], wrongCodes: ['x', 'y'], totalCount: 5 }];
  assert.deepEqual(computeMastery(docs), {
    cleanSweeps: 0, flawlessSweeps: 0, attemptedFinishes: 0, zeroScoreFinishes: 1,
  });
});

test('zero-score finish with no wrong → just empty-slate', () => {
  const docs = [{ foundCodes: [], wrongCodes: [], totalCount: 5 }];
  assert.deepEqual(computeMastery(docs), {
    cleanSweeps: 0, flawlessSweeps: 0, attemptedFinishes: 0, zeroScoreFinishes: 1,
  });
});

test('replay path: two flawless sweeps on the same puzzle count twice', () => {
  // Rule counts *moments of mastery*, not unique puzzles. A second
  // 100% on puzzle #3 still feels like an achievement to the player.
  const docs = [
    { foundCodes: ['a', 'b'], wrongCodes: [], totalCount: 2 },
    { foundCodes: ['a', 'b'], wrongCodes: [], totalCount: 2 },
  ];
  assert.deepEqual(computeMastery(docs), {
    cleanSweeps: 2, flawlessSweeps: 2, attemptedFinishes: 0, zeroScoreFinishes: 0,
  });
});

test('mixed batch — counts each independently', () => {
  const docs = [
    { foundCodes: ['a'], wrongCodes: [], totalCount: 1 },              // clean + flawless
    { foundCodes: [], wrongCodes: [], totalCount: 4 },                 // zero
    { foundCodes: ['a', 'b'], wrongCodes: ['z'], totalCount: 5 },      // partial + attempted
    { foundCodes: ['a', 'b', 'c'], wrongCodes: ['z'], totalCount: 3 }, // clean + attempted (had wrongs)
    { foundCodes: [], wrongCodes: ['x'], totalCount: 10 },             // zero (with wrongs — doesn't count as attempted)
  ];
  assert.deepEqual(computeMastery(docs), {
    cleanSweeps: 2, flawlessSweeps: 1, attemptedFinishes: 2, zeroScoreFinishes: 2,
  });
});

test('a 1-flag flawless sweep still counts (no boundary off-by-one)', () => {
  const docs = [{ foundCodes: ['only'], wrongCodes: [], totalCount: 1 }];
  assert.deepEqual(computeMastery(docs), {
    cleanSweeps: 1, flawlessSweeps: 1, attemptedFinishes: 0, zeroScoreFinishes: 0,
  });
});

test('rows with missing foundCodes are skipped, not crashed', () => {
  const docs = [
    { totalCount: 3 },
    { foundCodes: ['a'], wrongCodes: [], totalCount: 1 },
  ];
  assert.deepEqual(computeMastery(docs), {
    cleanSweeps: 1, flawlessSweeps: 1, attemptedFinishes: 0, zeroScoreFinishes: 0,
  });
});

test('rows with non-array foundCodes are skipped', () => {
  const docs = [
    { foundCodes: 'not-an-array', wrongCodes: [], totalCount: 3 },
    { foundCodes: ['a'], wrongCodes: [], totalCount: 1 },
  ];
  assert.deepEqual(computeMastery(docs), {
    cleanSweeps: 1, flawlessSweeps: 1, attemptedFinishes: 0, zeroScoreFinishes: 0,
  });
});

test('rows with non-numeric totalCount are skipped', () => {
  const docs = [
    { foundCodes: ['a'], wrongCodes: [], totalCount: 'oops' },
    { foundCodes: ['a'], wrongCodes: [], totalCount: 1 },
  ];
  assert.deepEqual(computeMastery(docs), {
    cleanSweeps: 1, flawlessSweeps: 1, attemptedFinishes: 0, zeroScoreFinishes: 0,
  });
});

test('clean sweep with missing wrongCodes → counts as clean, NOT as flawless or attempted', () => {
  // Defensive: a pre-flawlessSweeps row that's missing wrongCodes
  // shouldn't quietly count as flawless OR as attempted (we don't
  // know what was guessed wrong). Real rows always carry it.
  const docs = [{ foundCodes: ['a', 'b'], totalCount: 2 }];
  assert.deepEqual(computeMastery(docs), {
    cleanSweeps: 1, flawlessSweeps: 0, attemptedFinishes: 0, zeroScoreFinishes: 0,
  });
});

test('clean sweep with non-array wrongCodes → counts as clean, not flawless or attempted', () => {
  const docs = [{ foundCodes: ['a'], wrongCodes: 'oops', totalCount: 1 }];
  assert.deepEqual(computeMastery(docs), {
    cleanSweeps: 1, flawlessSweeps: 0, attemptedFinishes: 0, zeroScoreFinishes: 0,
  });
});

test('null docs argument is tolerated (no crash)', () => {
  assert.deepEqual(computeMastery(null), {
    cleanSweeps: 0, flawlessSweeps: 0, attemptedFinishes: 0, zeroScoreFinishes: 0,
  });
});

test('null individual rows are skipped', () => {
  const docs = [null, { foundCodes: ['a'], wrongCodes: [], totalCount: 1 }];
  assert.deepEqual(computeMastery(docs), {
    cleanSweeps: 1, flawlessSweeps: 1, attemptedFinishes: 0, zeroScoreFinishes: 0,
  });
});
