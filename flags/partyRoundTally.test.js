import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyTally, addQuestionToTally, chipsFor } from './partyRoundTally.js';
import { scoreQuestionDetailed, CORRECT_POINTS, SPEED_BONUS, SOLE_SURVIVOR_BONUS, FINAL_ROUND_MULTIPLIER } from './partyScore.js';

/**
 * The reveal's `breakdown` field, built exactly the way the room builds it.
 * @param {Array<{ playerId: string, correct: boolean }>} buzzes
 * @param {{ applySpeedBonus?: boolean, applySoloBonus?: boolean, multiplier?: number }} [opts]
 */
function breakdownOf(buzzes, opts) {
  /** @type {Record<string, { base: number, speed: number, solo: number }>} */
  const out = {};
  for (const [id, a] of Object.entries(scoreQuestionDetailed(buzzes, opts))) {
    out[id] = { base: a.base, speed: a.speed, solo: a.solo };
  }
  return out;
}

test('an empty tally has nothing in it and nothing to draw', () => {
  assert.deepEqual(emptyTally(), {});
  assert.deepEqual(chipsFor(undefined), []);
});

test('accumulates each bucket across a round', () => {
  const buzzes = [
    { playerId: 'a', correct: true },
    { playerId: 'b', correct: true },
    { playerId: 'c', correct: false },
  ];
  let t = emptyTally();
  for (let i = 0; i < 5; i += 1) t = addQuestionToTally(t, breakdownOf(buzzes));
  assert.deepEqual(t.a, { base: CORRECT_POINTS * 5, speed: SPEED_BONUS[0] * 5, solo: 0 });
  assert.deepEqual(t.b, { base: CORRECT_POINTS * 5, speed: SPEED_BONUS[1] * 5, solo: 0 });
  assert.deepEqual(t.c, { base: 0, speed: 0, solo: 0 });
});

test('does not mutate the tally it was given', () => {
  // The page holds the tally across renders, and render() re-runs on every clock
  // tick — an in-place add would count each question again on every tick.
  const first = addQuestionToTally(emptyTally(), { a: { base: 10, speed: 5, solo: 0 } });
  const second = addQuestionToTally(first, { a: { base: 10, speed: 0, solo: 0 } });
  assert.deepEqual(first.a, { base: 10, speed: 5, solo: 0 }, 'the earlier tally is untouched');
  assert.deepEqual(second.a, { base: 20, speed: 5, solo: 0 });
});

test('a player who never buzzed simply is not in the tally', () => {
  const t = addQuestionToTally(emptyTally(), { a: { base: 10, speed: 0, solo: 0 } });
  assert.equal(t.b, undefined);
});

test('the sole survivor bonus keeps its own bucket instead of being read as speed', () => {
  // The reason the breakdown moved onto the wire: SOLE_SURVIVOR_BONUS equals
  // SPEED_BONUS[0], so this player's 20 is "10 + 5 + 5" and no arithmetic on the
  // total alone could ever have told the last two apart.
  const t = addQuestionToTally(emptyTally(), breakdownOf([
    { playerId: 'a', correct: true },
    { playerId: 'b', correct: false },
  ]));
  assert.deepEqual(t.a, { base: CORRECT_POINTS, speed: SPEED_BONUS[0], solo: SOLE_SURVIVOR_BONUS });
  assert.deepEqual(chipsFor(t.a).map((c) => c.kind), ['base', 'speed', 'solo']);
});

test('a double round arrives already scaled', () => {
  const t = addQuestionToTally(emptyTally(), breakdownOf(
    [{ playerId: 'a', correct: true }, { playerId: 'b', correct: true }],
    { multiplier: FINAL_ROUND_MULTIPLIER },
  ));
  assert.deepEqual(t.a, {
    base: CORRECT_POINTS * FINAL_ROUND_MULTIPLIER,
    speed: SPEED_BONUS[0] * FINAL_ROUND_MULTIPLIER,
    solo: 0,
  });
});

test('a reveal with no breakdown tallies nothing rather than throwing', () => {
  // A client that outlives a server rollback: the chips are decoration, and no
  // chips beats a broken standings screen.
  assert.deepEqual(addQuestionToTally(emptyTally(), undefined), {});
  assert.deepEqual(addQuestionToTally(emptyTally(), { a: {} }).a, { base: 0, speed: 0, solo: 0 });
  assert.deepEqual(addQuestionToTally(/** @type {any} */ (null), { a: { base: 10 } }).a, { base: 10, speed: 0, solo: 0 });
});

test('chips render base, then speed, then solo, and never a zero', () => {
  assert.deepEqual(chipsFor({ base: 30, speed: 8, solo: 5 }), [
    { kind: 'base', value: 30 },
    { kind: 'speed', value: 8 },
    { kind: 'solo', value: 5 },
  ]);
  assert.deepEqual(chipsFor({ base: 20, speed: 0, solo: 0 }), [{ kind: 'base', value: 20 }]);
  assert.deepEqual(chipsFor({ base: 0, speed: 0, solo: 0 }), []);
});

test('the chips always add up to the round gain shown beside them', () => {
  // The break only paints chips when their sum equals the round gain, so drift
  // here hides the whole breakdown rather than showing a wrong one.
  const rounds = [
    [{ playerId: 'a', correct: true }, { playerId: 'b', correct: true }],
    [{ playerId: 'a', correct: true }, { playerId: 'b', correct: false }],
    [{ playerId: 'a', correct: false }, { playerId: 'b', correct: true }],
  ];
  let t = emptyTally();
  let gain = 0;
  for (const buzzes of rounds) {
    const awards = scoreQuestionDetailed(buzzes);
    gain += awards.a ? awards.a.total : 0;
    t = addQuestionToTally(t, breakdownOf(buzzes));
  }
  assert.equal(chipsFor(t.a).reduce((s, c) => s + c.value, 0), gain);
});
