const { test } = require('node:test');
const assert = require('node:assert/strict');

const { computeTttSignals } = require('./tttCompute');

const ZERO = {
  tttGamesPlayed: 0,
  hasWonTtt: false,
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

test('counters sum across opponents (multiple rows)', () => {
  const r = computeTttSignals([
    { m3x3: { wins: 2, losses: 1 } },
    { m3x3: { wins: 0, losses: 3 } },
    { m3x3: { draws: 5 } },
  ]);
  assert.equal(r.tttGamesPlayed, 11);
});

test('win only → hasWonTtt true', () => {
  const r = computeTttSignals([{ m3x3: { wins: 1, losses: 0, draws: 0 } }]);
  assert.equal(r.hasWonTtt, true);
  assert.equal(r.hasLostTtt, false);
});

test('loss only → hasLostTtt true, hasWonTtt false', () => {
  const r = computeTttSignals([{ m3x3: { wins: 0, losses: 1 } }]);
  assert.equal(r.hasLostTtt, true);
  assert.equal(r.hasWonTtt, false);
});

test('mixed across two opponents → both flags true', () => {
  const rows = [
    { m3x3: { wins: 2, losses: 0, draws: 1 } },
    { m3x3: { wins: 0, losses: 3, draws: 0 } },
  ];
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
  const rows = [{ m3x3: { wins: 'oops', losses: -3, draws: NaN } }];
  const r = computeTttSignals(rows);
  assert.equal(r.tttGamesPlayed, 0);
  assert.equal(r.hasWonTtt, false);
  assert.equal(r.hasLostTtt, false);
});

test('row with no m3x3 is tolerated (silently zero)', () => {
  const r = computeTttSignals([{}]);
  assert.deepEqual(r, ZERO);
});

test('row with a non-object m3x3 field is skipped', () => {
  const rows = [{ m3x3: /** @type {any} */ ('oops') }];
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
// Legacy rows. The 9×9 board is gone, but rows written while it existed can
// still carry an `m9x9` sub-object until the strip script runs (and a row
// re-read mid-strip could carry one after). Those games must not count toward
// any badge, and must never leak into the 3×3 totals.
// ---------------------------------------------------------------------------

test('a legacy m9x9 sub-object is ignored entirely', () => {
  const r = computeTttSignals([{
    m3x3: { wins: 1, losses: 2, draws: 1 },
    m9x9: { wins: 4, losses: 1, draws: 0 },
  }]);
  assert.equal(r.tttGamesPlayed, 4, 'only the m3x3 games count');
  assert.equal(r.hasWonTtt, true);
  assert.equal(r.hasLostTtt, true);
});

test('a row carrying only legacy m9x9 counters reads as no games at all', () => {
  const r = computeTttSignals([{ m9x9: { wins: 3, losses: 2, draws: 1 } }]);
  assert.deepEqual(r, ZERO, 'a 9×9-only row earns nothing');
});
