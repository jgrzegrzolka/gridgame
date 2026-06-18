const test = require('node:test');
const assert = require('node:assert/strict');
const { computeStreak, submissionsToStreakRows, quizPlayEventsToStreakRows } = require('./streakCompute');

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

// --- quizPlayEventsToStreakRows -------------------------------------------

test('quizPlayEventsToStreakRows: empty/non-array input → []', () => {
  assert.deepEqual(quizPlayEventsToStreakRows([], '60s'), []);
  assert.deepEqual(quizPlayEventsToStreakRows(null, '60s'), []);
  assert.deepEqual(quizPlayEventsToStreakRows(undefined, '60s'), []);
});

test('quizPlayEventsToStreakRows: filters by kind="quiz_play"', () => {
  const events = [
    { kind: 'share', payload: { surface: 'flagquiz' }, dayId: 100 },
    { kind: 'daily_start', payload: { puzzleId: 12 }, dayId: 100 },
    { kind: 'quiz_play', payload: { mode: '60s' }, dayId: 100 },
  ];
  assert.deepEqual(quizPlayEventsToStreakRows(events, '60s'), [{ id: 100, completed: true }]);
});

test('quizPlayEventsToStreakRows: filters by requested mode', () => {
  const events = [
    { kind: 'quiz_play', payload: { mode: '60s' }, dayId: 100 },
    { kind: 'quiz_play', payload: { mode: 'all' }, dayId: 100 },
    { kind: 'quiz_play', payload: { mode: '60s' }, dayId: 101 },
  ];
  assert.deepEqual(quizPlayEventsToStreakRows(events, '60s'), [
    { id: 100, completed: true },
    { id: 101, completed: true },
  ]);
  assert.deepEqual(quizPlayEventsToStreakRows(events, 'all'), [{ id: 100, completed: true }]);
});

test('quizPlayEventsToStreakRows: dedupes same-day events (deterministic id should prevent dupes at write time anyway)', () => {
  const events = [
    { kind: 'quiz_play', payload: { mode: '60s' }, dayId: 100 },
    { kind: 'quiz_play', payload: { mode: '60s' }, dayId: 100 },
    { kind: 'quiz_play', payload: { mode: '60s' }, dayId: 101 },
  ];
  assert.deepEqual(quizPlayEventsToStreakRows(events, '60s'), [
    { id: 100, completed: true },
    { id: 101, completed: true },
  ]);
});

test('quizPlayEventsToStreakRows: returns rows sorted ascending by dayId regardless of input order', () => {
  const events = [
    { kind: 'quiz_play', payload: { mode: '60s' }, dayId: 102 },
    { kind: 'quiz_play', payload: { mode: '60s' }, dayId: 100 },
    { kind: 'quiz_play', payload: { mode: '60s' }, dayId: 101 },
  ];
  assert.deepEqual(quizPlayEventsToStreakRows(events, '60s'), [
    { id: 100, completed: true },
    { id: 101, completed: true },
    { id: 102, completed: true },
  ]);
});

test('quizPlayEventsToStreakRows: malformed rows are silently skipped (no crash)', () => {
  const events = [
    null,
    undefined,
    { kind: 'quiz_play' },                                    // missing payload
    { kind: 'quiz_play', payload: null },                     // null payload
    { kind: 'quiz_play', payload: { mode: '60s' } },          // missing dayId
    { kind: 'quiz_play', payload: { mode: '60s' }, dayId: 'oops' }, // non-numeric
    { kind: 'quiz_play', payload: { mode: '60s' }, dayId: 100 }, // good
  ];
  assert.deepEqual(quizPlayEventsToStreakRows(events, '60s'), [{ id: 100, completed: true }]);
});

test('quizPlayEventsToStreakRows feeds computeStreak — full pipeline matches expected streak math', () => {
  const events = [
    { kind: 'quiz_play', payload: { mode: '60s' }, dayId: 100 },
    { kind: 'quiz_play', payload: { mode: '60s' }, dayId: 101 },
    { kind: 'quiz_play', payload: { mode: '60s' }, dayId: 102 },
    // gap on 103
    { kind: 'quiz_play', payload: { mode: '60s' }, dayId: 104 },
    { kind: 'quiz_play', payload: { mode: '60s' }, dayId: 105 },
  ];
  const rows = quizPlayEventsToStreakRows(events, '60s');
  const result = computeStreak({ rows, latestId: 105 });
  assert.equal(result.maxStreak, 3);     // 100-101-102
  assert.equal(result.currentStreak, 2); // 104-105 (today is 105)
  assert.equal(result.totalPlayed, 5);   // 5 distinct days
});
