const test = require('node:test');
const assert = require('node:assert/strict');

const {
  rankCmpClause,
  findMineInTop,
  computeYou,
  qualifiesForLeaderboard,
  beats,
  cmpEntries,
  dedupByDevice,
  rankInSorted,
} = require('./leaderboardRank');

test('rankCmpClause: timed mode → strictly higher score OR equal-faster wins', () => {
  const clause = rankCmpClause(false);
  assert.match(clause, /c\.score > @s/);
  assert.match(clause, /c\.score = @s AND c\.durationMs < @d/);
});

test('rankCmpClause: endurance mode → strictly lower score OR equal-faster wins', () => {
  const clause = rankCmpClause(true);
  assert.match(clause, /c\.score < @s/);
  assert.match(clause, /c\.score = @s AND c\.durationMs < @d/);
});

test('rankCmpClause: the two directions are distinct (regression: flip stays a flip)', () => {
  // Pins the cmp-direction invariant. A refactor that conflates the two
  // branches would silently rank one mode in the wrong direction; this
  // test would catch it on every PR.
  assert.notEqual(rankCmpClause(true), rankCmpClause(false));
});

test('findMineInTop: returns the caller row when present', () => {
  const top = [
    { deviceId: 'd1', score: 20, durationMs: 30_000 },
    { deviceId: 'd2', score: 18, durationMs: 40_000 },
  ];
  assert.deepEqual(findMineInTop(top, 'd2'), { deviceId: 'd2', score: 18, durationMs: 40_000 });
});

test('findMineInTop: returns null when caller missing or deviceId not supplied', () => {
  const top = [{ deviceId: 'd1', score: 20, durationMs: 30_000 }];
  assert.equal(findMineInTop(top, 'd2'), null);
  assert.equal(findMineInTop(top, null), null);
  assert.equal(findMineInTop(top, ''), null);
});

test('computeYou: mine + ahead=3 → rank 4 with the caller score/duration', () => {
  const you = computeYou({ mine: { score: 12, durationMs: 55_000 }, ahead: 3 });
  assert.deepEqual(you, { rank: 4, score: 12, durationMs: 55_000 });
});

test('computeYou: ahead=0 → rank 1 (the caller is the leader)', () => {
  const you = computeYou({ mine: { score: 20, durationMs: 30_000 }, ahead: 0 });
  assert.equal(you?.rank, 1);
});

test('computeYou: COUNT returned null/undefined → treated as 0 ahead → rank 1', () => {
  // The Cosmos REST client can return ok=true with an empty docs array if
  // the COUNT query fizzled; we still want a sensible `you` for the player
  // who already finished. Pinning rank=1 as the failure-mode default.
  assert.equal(computeYou({ mine: { score: 10, durationMs: 50_000 }, ahead: null })?.rank, 1);
  assert.equal(computeYou({ mine: { score: 10, durationMs: 50_000 }, ahead: undefined })?.rank, 1);
});

test('computeYou: no mine → null (caller has no row today, e.g. submit failed)', () => {
  assert.equal(computeYou({ mine: null, ahead: 5 }), null);
});

test('qualifiesForLeaderboard: timed mode (higherWins) excludes score=0', () => {
  // 0 correct in 60s is the worst possible — keep it off the board.
  assert.equal(qualifiesForLeaderboard({ score: 0, lowerWins: false }), false);
  assert.equal(qualifiesForLeaderboard({ score: 1, lowerWins: false }), true);
  assert.equal(qualifiesForLeaderboard({ score: 50, lowerWins: false }), true);
});

test('qualifiesForLeaderboard: count mode (lowerWins) keeps score=0 — perfect round', () => {
  // 0 mistakes in endurance/count mode is the IDEAL result. Keep it.
  assert.equal(qualifiesForLeaderboard({ score: 0, lowerWins: true }), true);
  assert.equal(qualifiesForLeaderboard({ score: 1, lowerWins: true }), true);
  assert.equal(qualifiesForLeaderboard({ score: 50, lowerWins: true }), true);
});

// --- beats / cmpEntries / dedupByDevice / rankInSorted -------------

test('beats: higher score wins in timed mode', () => {
  assert.equal(beats({ score: 20, durationMs: 30000 }, { score: 19, durationMs: 1 }, false), true);
});

test('beats: lower score wins in endurance mode', () => {
  assert.equal(beats({ score: 1, durationMs: 30000 }, { score: 5, durationMs: 1 }, true), true);
});

test('beats: equal score → faster duration wins (both modes)', () => {
  assert.equal(beats({ score: 20, durationMs: 30000 }, { score: 20, durationMs: 40000 }, false), true);
  assert.equal(beats({ score: 1, durationMs: 30000 }, { score: 1, durationMs: 40000 }, true), true);
});

test('beats: identical rows never beat each other', () => {
  const a = { score: 20, durationMs: 30000 };
  const b = { score: 20, durationMs: 30000 };
  assert.equal(beats(a, b, false), false);
  assert.equal(beats(b, a, false), false);
});

test('cmpEntries: sort produces best-first order in timed mode', () => {
  const rows = [
    { deviceId: 'd1', score: 10, durationMs: 50000 },
    { deviceId: 'd2', score: 20, durationMs: 50000 },
    { deviceId: 'd3', score: 15, durationMs: 50000 },
  ];
  rows.sort((a, b) => cmpEntries(a, b, false));
  assert.deepEqual(rows.map((r) => r.deviceId), ['d2', 'd3', 'd1']);
});

test('cmpEntries: sort produces best-first order in endurance mode', () => {
  const rows = [
    { deviceId: 'd1', score: 10, durationMs: 50000 },
    { deviceId: 'd2', score: 20, durationMs: 50000 },
    { deviceId: 'd3', score: 0, durationMs: 50000 },
  ];
  rows.sort((a, b) => cmpEntries(a, b, true));
  assert.deepEqual(rows.map((r) => r.deviceId), ['d3', 'd1', 'd2']);
});

test('dedupByDevice: keeps the better row when the same device appears twice', () => {
  // Same player from today + yesterday — keep today's higher score.
  const rows = [
    { deviceId: 'd1', score: 15, durationMs: 40000, source: 'yesterday' },
    { deviceId: 'd1', score: 20, durationMs: 50000, source: 'today' },
    { deviceId: 'd2', score: 18, durationMs: 30000, source: 'today' },
  ];
  const out = dedupByDevice(rows, false);
  assert.equal(out.length, 2);
  const d1 = out.find((r) => r.deviceId === 'd1');
  assert.equal(d1?.score, 20);
  assert.equal(d1?.source, 'today');
});

test('dedupByDevice: respects mode direction on ties — equal score, faster wins', () => {
  const rows = [
    { deviceId: 'd1', score: 20, durationMs: 50000 },
    { deviceId: 'd1', score: 20, durationMs: 30000 },
  ];
  const out = dedupByDevice(rows, false);
  assert.equal(out.length, 1);
  assert.equal(out[0].durationMs, 30000);
});

test('dedupByDevice: empty input → empty output', () => {
  assert.deepEqual(dedupByDevice([], false), []);
});

test('rankInSorted: finds caller, 1-based', () => {
  const sorted = [
    { deviceId: 'd1' },
    { deviceId: 'd2' },
    { deviceId: 'd3' },
  ];
  assert.equal(rankInSorted(sorted, 'd1'), 1);
  assert.equal(rankInSorted(sorted, 'd2'), 2);
  assert.equal(rankInSorted(sorted, 'd3'), 3);
});

test('rankInSorted: missing caller → null', () => {
  const sorted = [{ deviceId: 'd1' }, { deviceId: 'd2' }];
  assert.equal(rankInSorted(sorted, 'd99'), null);
});
