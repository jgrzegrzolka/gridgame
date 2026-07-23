import { test } from 'node:test';
import assert from 'node:assert/strict';
import { roundBreak, breakOpeningOrder } from './partyBreak.js';

/** @param {Array<[string, number]>} pairs */
const board = (...pairs) => pairs.map(([playerId, score]) => ({ playerId, nickname: playerId.toUpperCase(), score }));

test('first break (prev = null): full score is the gain, no rank deltas, MVP is top gainer', () => {
  const curr = board(['a', 30], ['b', 20], ['c', 10]);
  const { rows, mvp } = roundBreak(null, curr);
  assert.deepEqual(rows.map((r) => r.roundGain), [30, 20, 10]);
  assert.deepEqual(rows.map((r) => r.rankDelta), [null, null, null]);
  assert.equal(mvp, 'a');
});

test('gapToLeader is the leader minus each score, 0 for the leader', () => {
  const { rows } = roundBreak(null, board(['a', 30], ['b', 20], ['c', 5]));
  assert.deepEqual(rows.map((r) => r.gapToLeader), [0, 10, 25]);
});

test('round gain diffs against the previous break, not the whole game', () => {
  const prev = board(['a', 30], ['b', 20], ['c', 10]);
  const curr = board(['c', 40], ['a', 35], ['b', 22]); // c +30, a +5, b +2
  const { rows, mvp } = roundBreak(prev, curr);
  const gain = Object.fromEntries(rows.map((r) => [r.playerId, r.roundGain]));
  assert.deepEqual(gain, { a: 5, b: 2, c: 30 });
  assert.equal(mvp, 'c'); // biggest gainer this round, though not overall leader last break
});

test('rankDelta: positive is a climb, negative a drop, 0 held', () => {
  const prev = board(['a', 30], ['b', 20], ['c', 10]); // ranks a=0 b=1 c=2
  const curr = board(['c', 40], ['a', 35], ['b', 22]); // ranks c=0 a=1 b=2
  const { rows } = roundBreak(prev, curr);
  const delta = Object.fromEntries(rows.map((r) => [r.playerId, r.rankDelta]));
  assert.equal(delta.c, 2);  // 2 -> 0, climbed two
  assert.equal(delta.a, -1); // 0 -> 1, dropped one
  assert.equal(delta.b, -1); // 1 -> 2, dropped one
});

test('a player absent from the previous break has null rankDelta and full-gain from 0', () => {
  const prev = board(['a', 30], ['b', 20]);
  const curr = board(['a', 32], ['c', 15], ['b', 21]); // c is a late join
  const { rows } = roundBreak(prev, curr);
  const c = rows.find((r) => r.playerId === 'c');
  assert.ok(c);
  assert.equal(c.rankDelta, null);
  assert.equal(c.roundGain, 15);
});

test('a round where nobody scored has no MVP', () => {
  const prev = board(['a', 30], ['b', 20]);
  const curr = board(['a', 30], ['b', 20]);
  const { rows, mvp } = roundBreak(prev, curr);
  assert.equal(mvp, null);
  assert.deepEqual(rows.map((r) => r.roundGain), [0, 0]);
});

test('MVP ties break toward the higher total (earlier row in the sorted board)', () => {
  const prev = board(['a', 30], ['b', 10]);
  const curr = board(['a', 40], ['b', 20]); // both +10
  const { mvp } = roundBreak(prev, curr);
  assert.equal(mvp, 'a');
});

test('rows come back in currBoard order', () => {
  const curr = board(['x', 5], ['y', 9], ['z', 1]);
  const { rows } = roundBreak(null, curr);
  assert.deepEqual(rows.map((r) => r.playerId), ['x', 'y', 'z']);
});

test('empty / missing input is safe', () => {
  assert.deepEqual(roundBreak(null, []), { rows: [], mvp: null });
  assert.deepEqual(roundBreak(null, /** @type {any} */ (undefined)), { rows: [], mvp: null });
});

test('prevScore carries the previous break total, so the count-up starts from the right number', () => {
  const prev = board(['a', 30], ['b', 20]);
  const curr = board(['a', 75], ['b', 20]);
  const { rows } = roundBreak(prev, curr);
  assert.deepEqual(rows.map((r) => r.prevScore), [30, 20]);
  assert.deepEqual(rows.map((r) => r.roundGain), [45, 0]);
});

test('a player who was not seated at the last break counts up from 0', () => {
  const prev = board(['a', 30]);
  const curr = board(['a', 40], ['late', 15]);
  const { rows } = roundBreak(prev, curr);
  const late = rows.find((r) => r.playerId === 'late');
  assert.ok(late);
  assert.equal(late.prevScore, 0);
});

test('prevScore is the real prior total even where the gain clamp bites', () => {
  // A score can only go up in play, but the clamp exists — so pin that prevScore
  // is NOT derivable as `score - roundGain` when it does.
  const prev = board(['a', 50]);
  const curr = board(['a', 40]);
  const { rows } = roundBreak(prev, curr);
  assert.equal(rows[0].prevScore, 50);
  assert.equal(rows[0].roundGain, 0);
  assert.notEqual(rows[0].score - rows[0].roundGain, rows[0].prevScore);
});

// --- breakOpeningOrder: the slot order the ledger opens in, before any points ---

test('first break opens ALPHABETICALLY by nickname, not in final score order', () => {
  // Score order is charlie, alice, bob; the opening seat must be alice, bob, charlie
  // so the slide starts from a neutral order and actually moves as points land,
  // rather than opening already-sorted (which read as a pointless shuffle).
  const { rows } = roundBreak(null, board(['charlie', 30], ['alice', 20], ['bob', 10]));
  assert.deepEqual(breakOpeningOrder(rows, false), [1, 2, 0]);
});

test('later breaks open in the PREVIOUS break order (prevScore descending)', () => {
  const prev = board(['a', 30], ['b', 20], ['c', 10]); // a, b, c
  const curr = board(['c', 40], ['a', 35], ['b', 22]); // final order c, a, b
  const { rows } = roundBreak(prev, curr);
  // Opens in last break's order a, b, c -> indices 1, 2, 0 into the final-order rows.
  assert.deepEqual(breakOpeningOrder(rows, true), [1, 2, 0]);
});

test('opening order is name-case- and diacritic-insensitive, numeric-aware, stable on ties', () => {
  /** @param {Array<[string, number]>} pairs nickname/prevScore, final order as given */
  const rows = [
    { playerId: 'p1', nickname: 'Player2', score: 0, prevScore: 0, roundGain: 0, rankDelta: null, gapToLeader: 0 },
    { playerId: 'p2', nickname: 'player10', score: 0, prevScore: 0, roundGain: 0, rankDelta: null, gapToLeader: 0 },
    { playerId: 'p3', nickname: 'Ámy', score: 0, prevScore: 0, roundGain: 0, rankDelta: null, gapToLeader: 0 },
  ];
  // Ámy < Player2 < player10 (base sensitivity folds the accent + case, numeric keeps 2 < 10).
  assert.deepEqual(breakOpeningOrder(rows, false), [2, 0, 1]);
});
