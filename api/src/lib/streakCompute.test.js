const test = require('node:test');
const assert = require('node:assert/strict');
const { computeStreak } = require('./streakCompute');

test('streakCompute: empty rows — all zeros', () => {
  assert.deepEqual(computeStreak({ rows: [] }), {
    currentStreak: 0,
    maxStreak: 0,
    winPercent: 0,
    totalPlayed: 0,
    totalCompleted: 0,
  });
});

test('streakCompute: single completed row — streak 1, win 100%', () => {
  assert.deepEqual(computeStreak({ rows: [{ puzzleId: 5, completed: true }] }), {
    currentStreak: 1,
    maxStreak: 1,
    winPercent: 100,
    totalPlayed: 1,
    totalCompleted: 1,
  });
});

test('streakCompute: single uncompleted row — streak 0, win 0%', () => {
  assert.deepEqual(computeStreak({ rows: [{ puzzleId: 5, completed: false }] }), {
    currentStreak: 0,
    maxStreak: 0,
    winPercent: 0,
    totalPlayed: 1,
    totalCompleted: 0,
  });
});

test('streakCompute: all completed, consecutive — current = max = total', () => {
  const rows = [1, 2, 3, 4, 5].map((puzzleId) => ({ puzzleId, completed: true }));
  assert.deepEqual(computeStreak({ rows }), {
    currentStreak: 5,
    maxStreak: 5,
    winPercent: 100,
    totalPlayed: 5,
    totalCompleted: 5,
  });
});

test('streakCompute: all missed — streak 0, win 0%', () => {
  const rows = [1, 2, 3].map((puzzleId) => ({ puzzleId, completed: false }));
  assert.deepEqual(computeStreak({ rows }), {
    currentStreak: 0,
    maxStreak: 0,
    winPercent: 0,
    totalPlayed: 3,
    totalCompleted: 0,
  });
});

test('streakCompute: completed streak broken by a failed row in the middle', () => {
  // ✓ ✓ ✗ ✓ ✓ — max=2 (first or last pair), current=2 (trailing pair)
  const rows = [
    { puzzleId: 1, completed: true },
    { puzzleId: 2, completed: true },
    { puzzleId: 3, completed: false },
    { puzzleId: 4, completed: true },
    { puzzleId: 5, completed: true },
  ];
  assert.deepEqual(computeStreak({ rows }), {
    currentStreak: 2,
    maxStreak: 2,
    winPercent: 80,
    totalPlayed: 5,
    totalCompleted: 4,
  });
});

test('streakCompute: streak broken by a missing puzzleId (gap, no failed row)', () => {
  // ✓ ✓ _ ✓ — skipped #3 entirely; current=1, max=2
  const rows = [
    { puzzleId: 1, completed: true },
    { puzzleId: 2, completed: true },
    { puzzleId: 4, completed: true },
  ];
  assert.deepEqual(computeStreak({ rows }), {
    currentStreak: 1,
    maxStreak: 2,
    winPercent: 100,
    totalPlayed: 3,
    totalCompleted: 3,
  });
});

test('streakCompute: trailing failed row — current 0, max preserved from earlier run', () => {
  // ✓ ✓ ✓ ✗ — current=0, max=3
  const rows = [
    { puzzleId: 1, completed: true },
    { puzzleId: 2, completed: true },
    { puzzleId: 3, completed: true },
    { puzzleId: 4, completed: false },
  ];
  assert.deepEqual(computeStreak({ rows }), {
    currentStreak: 0,
    maxStreak: 3,
    winPercent: 75,
    totalPlayed: 4,
    totalCompleted: 3,
  });
});

test('streakCompute: latestPuzzleId ahead of last row — current resets to 0 (missed today)', () => {
  // Last played row is #3, but #5 is live → player skipped #4 and #5.
  const rows = [
    { puzzleId: 1, completed: true },
    { puzzleId: 2, completed: true },
    { puzzleId: 3, completed: true },
  ];
  const out = computeStreak({ rows, latestPuzzleId: 5 });
  assert.equal(out.currentStreak, 0);
  assert.equal(out.maxStreak, 3);
});

test('streakCompute: latestPuzzleId equals last row — streak counts normally', () => {
  // Player just finished today's puzzle — streak alive.
  const rows = [
    { puzzleId: 8, completed: true },
    { puzzleId: 9, completed: true },
    { puzzleId: 10, completed: true },
  ];
  const out = computeStreak({ rows, latestPuzzleId: 10 });
  assert.equal(out.currentStreak, 3);
});

test('streakCompute: unsorted input — sorts internally', () => {
  const rows = [
    { puzzleId: 3, completed: true },
    { puzzleId: 1, completed: true },
    { puzzleId: 2, completed: true },
  ];
  const out = computeStreak({ rows });
  assert.equal(out.currentStreak, 3);
  assert.equal(out.maxStreak, 3);
});

test('streakCompute: winPercent rounds — 2 of 3 = 67%', () => {
  const rows = [
    { puzzleId: 1, completed: true },
    { puzzleId: 2, completed: true },
    { puzzleId: 3, completed: false },
  ];
  assert.equal(computeStreak({ rows }).winPercent, 67);
});

test('streakCompute: does not mutate the input array', () => {
  const rows = [
    { puzzleId: 3, completed: true },
    { puzzleId: 1, completed: true },
    { puzzleId: 2, completed: true },
  ];
  const snapshot = rows.map((r) => ({ ...r }));
  computeStreak({ rows });
  assert.deepEqual(rows, snapshot);
});
