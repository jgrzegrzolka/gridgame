const { test } = require('node:test');
const assert = require('node:assert/strict');

const { computeTttSignals } = require('./tttCompute');

const ZERO = { hasPlayedTtt: false, hasWonTtt: false, hasLostTtt: false };

test('null / undefined / empty input → all false', () => {
  assert.deepEqual(computeTttSignals(null), ZERO);
  assert.deepEqual(computeTttSignals(undefined), ZERO);
  assert.deepEqual(computeTttSignals([]), ZERO);
});

test('any row at all → hasPlayedTtt true (even with zero counters)', () => {
  // Defensive: a freshly-created tttPairs row before any actual game
  // result is recorded shouldn\'t happen, but if it does, the row\'s
  // existence is the "played" signal.
  const r = computeTttSignals([{ m3x3: { wins: 0, losses: 0, draws: 0 } }]);
  assert.equal(r.hasPlayedTtt, true);
  assert.equal(r.hasWonTtt, false);
  assert.equal(r.hasLostTtt, false);
});

test('3x3 win only → hasWonTtt true, hasLostTtt false', () => {
  const r = computeTttSignals([{ m3x3: { wins: 1, losses: 0, draws: 0 } }]);
  assert.equal(r.hasWonTtt, true);
  assert.equal(r.hasLostTtt, false);
});

test('9x9 win only → hasWonTtt true (9x9 counters count)', () => {
  const r = computeTttSignals([{ m9x9: { wins: 3, losses: 0, draws: 0 } }]);
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
    { m3x3: { wins: 2, losses: 0, draws: 1 } },   // opponent A — wins only
    { m9x9: { wins: 0, losses: 3, draws: 0 } },   // opponent B — losses only
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

test('draws-only row → hasPlayedTtt true but neither win nor loss flag', () => {
  // Draw is a third outcome — doesn\'t qualify for either binary tier.
  const r = computeTttSignals([{ m3x3: { wins: 0, losses: 0, draws: 5 } }]);
  assert.equal(r.hasPlayedTtt, true);
  assert.equal(r.hasWonTtt, false);
  assert.equal(r.hasLostTtt, false);
});

test('non-numeric / negative counters are ignored (defensive)', () => {
  const rows = [{
    m3x3: { wins: 'oops', losses: -3, draws: NaN },
    m9x9: { wins: 0, losses: 0 },
  }];
  const r = computeTttSignals(rows);
  assert.equal(r.hasPlayedTtt, true);
  assert.equal(r.hasWonTtt, false);
  assert.equal(r.hasLostTtt, false);
});

test('row with neither m3x3 nor m9x9 is tolerated (silently empty)', () => {
  const r = computeTttSignals([{}]);
  assert.equal(r.hasPlayedTtt, true);
  assert.equal(r.hasWonTtt, false);
  assert.equal(r.hasLostTtt, false);
});

test('row with non-object m3x3 / m9x9 fields is skipped', () => {
  const rows = [{
    m3x3: /** @type {any} */ ('oops'),
    m9x9: /** @type {any} */ (42),
  }];
  const r = computeTttSignals(rows);
  assert.equal(r.hasPlayedTtt, true);
  assert.equal(r.hasWonTtt, false);
  assert.equal(r.hasLostTtt, false);
});

test('null individual rows are skipped, real ones still counted', () => {
  const rows = [null, undefined, { m3x3: { wins: 1 } }];
  const r = computeTttSignals(rows);
  assert.equal(r.hasPlayedTtt, true);
  assert.equal(r.hasWonTtt, true);
});
