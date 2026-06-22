const test = require('node:test');
const assert = require('node:assert/strict');
const { computeStreak, submissionsToStreakRows, dayLogToStreakRows } = require('./streakCompute');

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
  assert.deepEqual(computeStreak({ rows: [{ id: 5, completed: true }] }), {
    currentStreak: 1,
    maxStreak: 1,
    winPercent: 100,
    totalPlayed: 1,
    totalCompleted: 1,
  });
});

test('streakCompute: single uncompleted row — streak 0, win 0%', () => {
  assert.deepEqual(computeStreak({ rows: [{ id: 5, completed: false }] }), {
    currentStreak: 0,
    maxStreak: 0,
    winPercent: 0,
    totalPlayed: 1,
    totalCompleted: 0,
  });
});

test('streakCompute: all completed, consecutive — current = max = total', () => {
  const rows = [1, 2, 3, 4, 5].map((id) => ({ id, completed: true }));
  assert.deepEqual(computeStreak({ rows }), {
    currentStreak: 5,
    maxStreak: 5,
    winPercent: 100,
    totalPlayed: 5,
    totalCompleted: 5,
  });
});

test('streakCompute: all missed — streak 0, win 0%', () => {
  const rows = [1, 2, 3].map((id) => ({ id, completed: false }));
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
    { id: 1, completed: true },
    { id: 2, completed: true },
    { id: 3, completed: false },
    { id: 4, completed: true },
    { id: 5, completed: true },
  ];
  assert.deepEqual(computeStreak({ rows }), {
    currentStreak: 2,
    maxStreak: 2,
    winPercent: 80,
    totalPlayed: 5,
    totalCompleted: 4,
  });
});

test('streakCompute: streak broken by a missing id (gap, no failed row)', () => {
  // ✓ ✓ _ ✓ — skipped #3 entirely; current=1, max=2
  const rows = [
    { id: 1, completed: true },
    { id: 2, completed: true },
    { id: 4, completed: true },
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
    { id: 1, completed: true },
    { id: 2, completed: true },
    { id: 3, completed: true },
    { id: 4, completed: false },
  ];
  assert.deepEqual(computeStreak({ rows }), {
    currentStreak: 0,
    maxStreak: 3,
    winPercent: 75,
    totalPlayed: 4,
    totalCompleted: 3,
  });
});

test('streakCompute: latestId ahead of last row — current resets to 0 (missed today)', () => {
  // Last played id is 3, but today's id is 5 → player missed 4 and 5.
  const rows = [
    { id: 1, completed: true },
    { id: 2, completed: true },
    { id: 3, completed: true },
  ];
  const out = computeStreak({ rows, latestId: 5 });
  assert.equal(out.currentStreak, 0);
  assert.equal(out.maxStreak, 3);
});

test('streakCompute: latestId equals last row — streak counts normally', () => {
  // Player just showed up today — streak alive.
  const rows = [
    { id: 8, completed: true },
    { id: 9, completed: true },
    { id: 10, completed: true },
  ];
  const out = computeStreak({ rows, latestId: 10 });
  assert.equal(out.currentStreak, 3);
});

test('streakCompute: unsorted input — sorts internally', () => {
  const rows = [
    { id: 3, completed: true },
    { id: 1, completed: true },
    { id: 2, completed: true },
  ];
  const out = computeStreak({ rows });
  assert.equal(out.currentStreak, 3);
  assert.equal(out.maxStreak, 3);
});

test('streakCompute: winPercent rounds — 2 of 3 = 67%', () => {
  const rows = [
    { id: 1, completed: true },
    { id: 2, completed: true },
    { id: 3, completed: false },
  ];
  assert.equal(computeStreak({ rows }).winPercent, 67);
});

test('streakCompute: does not mutate the input array', () => {
  const rows = [
    { id: 3, completed: true },
    { id: 1, completed: true },
    { id: 2, completed: true },
  ];
  const snapshot = rows.map((r) => ({ ...r }));
  computeStreak({ rows });
  assert.deepEqual(rows, snapshot);
});

// --- submissionsToStreakRows ---

test('submissionsToStreakRows: empty docs → empty rows', () => {
  assert.deepEqual(submissionsToStreakRows([], () => 0), []);
});

test('submissionsToStreakRows: maps each doc to its day, sorts ascending', () => {
  const docs = [
    { submittedAt: 30 },
    { submittedAt: 10 },
    { submittedAt: 20 },
  ];
  // Day is just submittedAt directly for this fake dayFn.
  const out = submissionsToStreakRows(docs, (ms) => ms);
  assert.deepEqual(out, [
    { id: 10, completed: true },
    { id: 20, completed: true },
    { id: 30, completed: true },
  ]);
});

test('submissionsToStreakRows: dedupes same-day submissions into one row', () => {
  // Three submissions, all on day 7 — collapse to one row.
  const docs = [
    { submittedAt: 100 },
    { submittedAt: 200 },
    { submittedAt: 300 },
  ];
  const out = submissionsToStreakRows(docs, () => 7);
  assert.deepEqual(out, [{ id: 7, completed: true }]);
});

test('submissionsToStreakRows: archive backfill — three puzzles in one day = streak 1', () => {
  // The bug Jan caught: doing archive puzzles #1, #2, #3 today gives
  // three rows in dailyResults but they all map to the same day. The
  // streak math sees one row, currentStreak = 1.
  const today = 100;
  const docs = [
    { submittedAt: today * 86_400_000 + 1 * 3_600_000 }, // puzzle 1, 1am
    { submittedAt: today * 86_400_000 + 2 * 3_600_000 }, // puzzle 2, 2am
    { submittedAt: today * 86_400_000 + 3 * 3_600_000 }, // puzzle 3, 3am
  ];
  // dayFn: integer-divide by ms-per-day.
  const out = submissionsToStreakRows(docs, (ms) => Math.floor(ms / 86_400_000));
  assert.deepEqual(out, [{ id: today, completed: true }]);
  assert.equal(computeStreak({ rows: out, latestId: today }).currentStreak, 1);
});

test('submissionsToStreakRows: consecutive days produce streak = run length', () => {
  // Player submits one puzzle each day for three days.
  const docs = [
    { submittedAt: 100 * 86_400_000 + 12 * 3_600_000 },
    { submittedAt: 101 * 86_400_000 + 12 * 3_600_000 },
    { submittedAt: 102 * 86_400_000 + 12 * 3_600_000 },
  ];
  const out = submissionsToStreakRows(docs, (ms) => Math.floor(ms / 86_400_000));
  assert.deepEqual(out, [
    { id: 100, completed: true },
    { id: 101, completed: true },
    { id: 102, completed: true },
  ]);
  assert.equal(computeStreak({ rows: out, latestId: 102 }).currentStreak, 3);
});

test('submissionsToStreakRows: skipped day breaks the streak (gap in day numbers)', () => {
  // Player played day 100 and day 102; day 101 missed.
  const docs = [
    { submittedAt: 100 * 86_400_000 },
    { submittedAt: 102 * 86_400_000 },
  ];
  const out = submissionsToStreakRows(docs, (ms) => Math.floor(ms / 86_400_000));
  assert.equal(computeStreak({ rows: out, latestId: 102 }).currentStreak, 1);
  assert.equal(computeStreak({ rows: out, latestId: 102 }).maxStreak, 1);
});

test('submissionsToStreakRows: non-numeric submittedAt is dropped', () => {
  const docs = [
    { submittedAt: 'oops' },
    { submittedAt: null },
    { submittedAt: undefined },
    { /* missing */ },
    { submittedAt: 100 },
  ];
  const out = submissionsToStreakRows(docs, (ms) => ms);
  assert.deepEqual(out, [{ id: 100, completed: true }]);
});

test('submissionsToStreakRows: dayFn returning null is dropped', () => {
  // Defensive: a real dayFn (warsawDayNumber) returns null on invalid
  // input. Even if a non-numeric submittedAt slips past the type guard
  // (it can't today, but the shape is honest), the null filter saves us.
  const docs = [
    { submittedAt: 100 },
    { submittedAt: 200 },
  ];
  const out = submissionsToStreakRows(docs, (ms) => (ms === 100 ? null : ms));
  assert.deepEqual(out, [{ id: 200, completed: true }]);
});

// --- dayLogToStreakRows (Feature S Phase 4) ------------------------------
// Replaces the pre-Phase-4 quizPlayEventsToStreakRows. Input is now the
// quiz60sDayLog from syncBlob.engagement (a sorted+deduped number[] from
// flags/engagementCounters.js#bumpQuiz60sDay), not engagementEvents rows.

test('dayLogToStreakRows: empty/non-array input → []', () => {
  assert.deepEqual(dayLogToStreakRows([]), []);
  assert.deepEqual(dayLogToStreakRows(null), []);
  assert.deepEqual(dayLogToStreakRows(undefined), []);
  assert.deepEqual(dayLogToStreakRows(/** @type {any} */ ({})), []);
  assert.deepEqual(dayLogToStreakRows(/** @type {any} */ ('not an array')), []);
});

test('dayLogToStreakRows: maps each day number to { id, completed: true }', () => {
  assert.deepEqual(dayLogToStreakRows([100, 101, 102]), [
    { id: 100, completed: true },
    { id: 101, completed: true },
    { id: 102, completed: true },
  ]);
});

test('dayLogToStreakRows: dedupes same-day entries (the client should already, but defensive against hand-edited blobs)', () => {
  assert.deepEqual(dayLogToStreakRows([100, 100, 101]), [
    { id: 100, completed: true },
    { id: 101, completed: true },
  ]);
});

test('dayLogToStreakRows: returns rows sorted ascending regardless of input order', () => {
  assert.deepEqual(dayLogToStreakRows([102, 100, 101]), [
    { id: 100, completed: true },
    { id: 101, completed: true },
    { id: 102, completed: true },
  ]);
});

test('dayLogToStreakRows: malformed entries silently skipped (non-integer, negative, NaN, string)', () => {
  assert.deepEqual(dayLogToStreakRows([100, 'oops', -5, 1.5, NaN, 101]), [
    { id: 100, completed: true },
    { id: 101, completed: true },
  ]);
});

test('dayLogToStreakRows feeds computeStreak — full pipeline matches expected streak math', () => {
  // Mirrors the pre-Phase-4 quizPlayEventsToStreakRows pipeline test —
  // same input, same expected streak numbers, just sourced from a day
  // log instead of typed events.
  const log = [100, 101, 102, /* gap on 103 */ 104, 105];
  const rows = dayLogToStreakRows(log);
  const result = computeStreak({ rows, latestId: 105 });
  assert.equal(result.maxStreak, 3);     // 100-101-102
  assert.equal(result.currentStreak, 2); // 104-105 (today is 105)
  assert.equal(result.totalPlayed, 5);   // 5 distinct days
});
