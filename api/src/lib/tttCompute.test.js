const { test } = require('node:test');
const assert = require('node:assert/strict');

const { computeTttSignals } = require('./tttCompute');

const ZERO = {
  tttGamesPlayed: 0,
  tttGamesPlayed9x9: 0,
  hasWonTtt: false,
  hasWon9x9: false,
  hasLostTtt: false,
};

test('null / undefined / empty input → zero result', () => {
  assert.deepEqual(computeTttSignals(null), ZERO);
  assert.deepEqual(computeTttSignals(undefined), ZERO);
  assert.deepEqual(computeTttSignals([]), ZERO);
});

test('single row with zero counters → tttGamesPlayed 0, both flags false', () => {
  // A freshly-created tttPairs row before any actual game result is
  // recorded shouldn't happen, but if it does, no games is no games.
  const r = computeTttSignals([{ m3x3: { wins: 0, losses: 0, draws: 0 } }]);
  assert.equal(r.tttGamesPlayed, 0);
  assert.equal(r.hasWonTtt, false);
  assert.equal(r.hasLostTtt, false);
});

test('wins + losses + draws all sum into tttGamesPlayed', () => {
  const r = computeTttSignals([{ m3x3: { wins: 3, losses: 2, draws: 1 } }]);
  assert.equal(r.tttGamesPlayed, 6);
});

test('counters sum across modes (3x3 + 9x9)', () => {
  const r = computeTttSignals([{
    m3x3: { wins: 1, losses: 2, draws: 1 },
    m9x9: { wins: 4, losses: 1, draws: 0 },
  }]);
  assert.equal(r.tttGamesPlayed, 9);
});

test('counters sum across opponents (multiple rows)', () => {
  const r = computeTttSignals([
    { m3x3: { wins: 2, losses: 1 } },
    { m3x3: { wins: 0, losses: 3 } },
    { m9x9: { draws: 5 } },
  ]);
  assert.equal(r.tttGamesPlayed, 11);
});

test('3x3 win only → hasWonTtt true', () => {
  const r = computeTttSignals([{ m3x3: { wins: 1, losses: 0, draws: 0 } }]);
  assert.equal(r.hasWonTtt, true);
  assert.equal(r.hasLostTtt, false);
});

test('9x9 win only → hasWonTtt true (9x9 counters count)', () => {
  const r = computeTttSignals([{ m9x9: { wins: 3, losses: 0, draws: 0 } }]);
  assert.equal(r.hasWonTtt, true);
});

test('loss only → hasLostTtt true, hasWonTtt false', () => {
  const r = computeTttSignals([{ m3x3: { wins: 0, losses: 1 } }]);
  assert.equal(r.hasLostTtt, true);
  assert.equal(r.hasWonTtt, false);
});

test('mixed across two opponents → both flags true', () => {
  const rows = [
    { m3x3: { wins: 2, losses: 0, draws: 1 } },
    { m9x9: { wins: 0, losses: 3, draws: 0 } },
  ];
  const r = computeTttSignals(rows);
  assert.equal(r.hasWonTtt, true);
  assert.equal(r.hasLostTtt, true);
});

test('mixed across modes for the same opponent → both flags true', () => {
  const rows = [{
    m3x3: { wins: 1, losses: 0 },
    m9x9: { wins: 0, losses: 1 },
  }];
  const r = computeTttSignals(rows);
  assert.equal(r.hasWonTtt, true);
  assert.equal(r.hasLostTtt, true);
});

test('draws-only row → tttGamesPlayed counts them, but neither win nor loss flag', () => {
  const r = computeTttSignals([{ m3x3: { wins: 0, losses: 0, draws: 5 } }]);
  assert.equal(r.tttGamesPlayed, 5);
  assert.equal(r.hasWonTtt, false);
  assert.equal(r.hasLostTtt, false);
});

test('non-numeric / negative counters are ignored (defensive)', () => {
  const rows = [{
    m3x3: { wins: 'oops', losses: -3, draws: NaN },
    m9x9: { wins: 0, losses: 0 },
  }];
  const r = computeTttSignals(rows);
  assert.equal(r.tttGamesPlayed, 0);
  assert.equal(r.hasWonTtt, false);
  assert.equal(r.hasLostTtt, false);
});

test('row with neither m3x3 nor m9x9 is tolerated (silently zero)', () => {
  const r = computeTttSignals([{}]);
  assert.deepEqual(r, ZERO);
});

test('row with non-object m3x3 / m9x9 fields is skipped', () => {
  const rows = [{
    m3x3: /** @type {any} */ ('oops'),
    m9x9: /** @type {any} */ (42),
  }];
  assert.deepEqual(computeTttSignals(rows), ZERO);
});

test('null individual rows are skipped, real ones still counted', () => {
  const rows = [null, undefined, { m3x3: { wins: 1, losses: 2 } }];
  const r = computeTttSignals(rows);
  assert.equal(r.tttGamesPlayed, 3);
  assert.equal(r.hasWonTtt, true);
  assert.equal(r.hasLostTtt, true);
});

// ---------------------------------------------------------------------------
// 9x9-specific signals — drive the "9×9 Player" + "9×9 Winner" achievements.
// ---------------------------------------------------------------------------

test('tttGamesPlayed9x9: sums m9x9 counters only (3x3 plays do not bleed in)', () => {
  const r = computeTttSignals([{
    m3x3: { wins: 10, losses: 10, draws: 10 },
    m9x9: { wins: 2, losses: 1, draws: 1 },
  }]);
  assert.equal(r.tttGamesPlayed, 34);    // sums both modes
  assert.equal(r.tttGamesPlayed9x9, 4);  // 9x9 only — 3x3 counters do NOT leak in
});

test('tttGamesPlayed9x9: 0 when only 3x3 has been played', () => {
  const r = computeTttSignals([{ m3x3: { wins: 5, losses: 5 } }]);
  assert.equal(r.tttGamesPlayed, 10);
  assert.equal(r.tttGamesPlayed9x9, 0);
});

test('tttGamesPlayed9x9: sums across opponents (single-pair view of multiple matchups)', () => {
  const r = computeTttSignals([
    { m9x9: { wins: 1, losses: 0 } },
    { m9x9: { wins: 0, losses: 2, draws: 1 } },
    { m3x3: { wins: 5 } }, // 3x3 — should NOT contribute to 9x9 count
  ]);
  assert.equal(r.tttGamesPlayed9x9, 4);
  assert.equal(r.tttGamesPlayed, 9);
});

test('hasWon9x9: true iff at least one m9x9.win exists', () => {
  // 3x3 wins do not satisfy the 9x9 predicate.
  const onlyM3 = computeTttSignals([{ m3x3: { wins: 10, losses: 0 } }]);
  assert.equal(onlyM3.hasWonTtt, true);
  assert.equal(onlyM3.hasWon9x9, false);

  const m9win = computeTttSignals([{ m9x9: { wins: 1, losses: 0 } }]);
  assert.equal(m9win.hasWonTtt, true);
  assert.equal(m9win.hasWon9x9, true);
});

test('hasWon9x9: false when only 9x9 losses / draws (no wins)', () => {
  const r = computeTttSignals([{ m9x9: { wins: 0, losses: 5, draws: 3 } }]);
  assert.equal(r.hasWon9x9, false);
  // Sanity: but tttGamesPlayed9x9 still reflects those games.
  assert.equal(r.tttGamesPlayed9x9, 8);
});

test('hasWon9x9: true on any 9x9 win across multiple opponents', () => {
  const r = computeTttSignals([
    { m9x9: { wins: 0, losses: 3 } },
    { m9x9: { wins: 0, losses: 1 } },
    { m9x9: { wins: 1, losses: 0 } },  // ← satisfies the predicate
  ]);
  assert.equal(r.hasWon9x9, true);
});
