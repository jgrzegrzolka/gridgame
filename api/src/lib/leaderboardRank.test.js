const test = require('node:test');
const assert = require('node:assert/strict');

const { rankCmpClause, findMineInTop, computeYou } = require('./leaderboardRank');

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
