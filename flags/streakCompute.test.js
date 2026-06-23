import test from 'node:test';
import assert from 'node:assert/strict';

import { computeStreak, dayLogToStreakRows } from './streakCompute.js';

// Tests mirror the most-important cases in api/src/lib/streakCompute.test.js
// so drift between the two copies fails CI loudly. See header comment on
// flags/streakCompute.js explaining the duplication.

// ---------------------------------------------------------------------------
// computeStreak — the streak math
// ---------------------------------------------------------------------------

test('computeStreak: empty rows → all zeros', () => {
  assert.deepEqual(computeStreak({ rows: [] }), {
    currentStreak: 0, maxStreak: 0, winPercent: 0, totalPlayed: 0, totalCompleted: 0,
  });
});

test('computeStreak: single completed row → streak 1, win 100%', () => {
  const r = computeStreak({ rows: [{ id: 5, completed: true }], latestId: 5 });
  assert.equal(r.currentStreak, 1);
  assert.equal(r.maxStreak, 1);
  assert.equal(r.winPercent, 100);
});

test('computeStreak: all completed, consecutive → current = max = total', () => {
  const rows = [10, 11, 12, 13, 14].map((id) => ({ id, completed: true }));
  const r = computeStreak({ rows, latestId: 14 });
  assert.equal(r.currentStreak, 5);
  assert.equal(r.maxStreak, 5);
  assert.equal(r.totalPlayed, 5);
});

test('computeStreak: gap breaks the run; current resets to trailing consecutive', () => {
  const rows = [
    { id: 10, completed: true },
    { id: 11, completed: true },
    { id: 12, completed: true },
    // gap on 13
    { id: 14, completed: true },
    { id: 15, completed: true },
  ];
  const r = computeStreak({ rows, latestId: 15 });
  assert.equal(r.maxStreak, 3);
  assert.equal(r.currentStreak, 2);
  assert.equal(r.totalPlayed, 5);
});

test('computeStreak: latestId ahead of last row → current resets to 0 (missed today)', () => {
  const r = computeStreak({
    rows: [{ id: 10, completed: true }, { id: 11, completed: true }],
    latestId: 13,
  });
  assert.equal(r.currentStreak, 0);
  assert.equal(r.maxStreak, 2);
});

test('computeStreak: unsorted input — sorts internally', () => {
  const r = computeStreak({
    rows: [
      { id: 12, completed: true },
      { id: 10, completed: true },
      { id: 11, completed: true },
    ],
    latestId: 12,
  });
  assert.equal(r.currentStreak, 3);
  assert.equal(r.maxStreak, 3);
});

test('computeStreak: does not mutate the input array', () => {
  const rows = [
    { id: 12, completed: true },
    { id: 10, completed: true },
    { id: 11, completed: true },
  ];
  const snapshot = JSON.stringify(rows);
  computeStreak({ rows, latestId: 12 });
  assert.equal(JSON.stringify(rows), snapshot);
});

// ---------------------------------------------------------------------------
// dayLogToStreakRows
// ---------------------------------------------------------------------------

test('dayLogToStreakRows: empty / non-array → []', () => {
  assert.deepEqual(dayLogToStreakRows([]), []);
  assert.deepEqual(dayLogToStreakRows(null), []);
  assert.deepEqual(dayLogToStreakRows(undefined), []);
  assert.deepEqual(dayLogToStreakRows(/** @type {any} */ ('not an array')), []);
});

test('dayLogToStreakRows: maps each day to { id, completed: true }', () => {
  assert.deepEqual(dayLogToStreakRows([100, 101, 102]), [
    { id: 100, completed: true },
    { id: 101, completed: true },
    { id: 102, completed: true },
  ]);
});

test('dayLogToStreakRows: dedupes + sorts (defends against hand-edited state)', () => {
  assert.deepEqual(dayLogToStreakRows([102, 100, 100, 101]), [
    { id: 100, completed: true },
    { id: 101, completed: true },
    { id: 102, completed: true },
  ]);
});

test('dayLogToStreakRows: drops malformed entries (non-integer, negative, NaN, string)', () => {
  assert.deepEqual(dayLogToStreakRows([100, 'oops', -5, 1.5, NaN, 101]), [
    { id: 100, completed: true },
    { id: 101, completed: true },
  ]);
});

test('dayLogToStreakRows feeds computeStreak — full pipeline matches server expected behaviour', () => {
  // Mirrors api/src/lib/streakCompute.test.js's same-named pipeline test
  // — same input log, same expected streak numbers. Drift = CI failure.
  const log = [100, 101, 102, /* gap on 103 */ 104, 105];
  const rows = dayLogToStreakRows(log);
  const r = computeStreak({ rows, latestId: 105 });
  assert.equal(r.maxStreak, 3);     // 100-101-102
  assert.equal(r.currentStreak, 2); // 104-105 (today is 105)
  assert.equal(r.totalPlayed, 5);   // 5 distinct days
});
