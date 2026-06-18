const { test } = require('node:test');
const assert = require('node:assert/strict');

const { computeTttSignals } = require('./tttCompute');

const ZERO = { tttGamesPlayed: 0, hasWonTtt: false, hasLostTtt: false };

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
