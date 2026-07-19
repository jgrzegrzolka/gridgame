import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyTally, addQuestionToTally, chipsFor } from './partyRoundTally.js';
import { scoreQuestionDetailed, CORRECT_POINTS, SPEED_BONUS, SOLE_SURVIVOR_BONUS } from './partyScore.js';

/**
 * The reveal's `breakdown` field, built exactly the way the room builds it.
 * @param {Array<{ playerId: string, correct: boolean }>} buzzes
 * @param {{ applySpeedBonus?: boolean, applySoloBonus?: boolean }} [opts]
 */
function breakdownOf(buzzes, opts) {
  /** @type {Record<string, { base: number, speed: number, solo: number, closeness: number }>} */
  const out = {};
  for (const [id, a] of Object.entries(scoreQuestionDetailed(buzzes, opts))) {
    out[id] = { base: a.base, speed: a.speed, solo: a.solo, closeness: a.closeness };
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
  assert.deepEqual(t.a, { base: CORRECT_POINTS * 5, speed: SPEED_BONUS[0] * 5, solo: 0, closeness: 0 });
  assert.deepEqual(t.b, { base: CORRECT_POINTS * 5, speed: SPEED_BONUS[1] * 5, solo: 0, closeness: 0 });
  assert.deepEqual(t.c, { base: 0, speed: 0, solo: 0, closeness: 0 });
});

test('does not mutate the tally it was given', () => {
  // The page holds the tally across renders, and render() re-runs on every clock
  // tick — an in-place add would count each question again on every tick.
  const first = addQuestionToTally(emptyTally(), { a: { base: 10, speed: 5, solo: 0 } });
  const second = addQuestionToTally(first, { a: { base: 10, speed: 0, solo: 0 } });
  assert.deepEqual(first.a, { base: 10, speed: 5, solo: 0, closeness: 0 }, 'the earlier tally is untouched');
  assert.deepEqual(second.a, { base: 20, speed: 5, solo: 0, closeness: 0 });
});

test('a player who never buzzed simply is not in the tally', () => {
  const t = addQuestionToTally(emptyTally(), { a: { base: 10, speed: 0, solo: 0 } });
  assert.equal(t.b, undefined);
});

test('the sole survivor bonus keeps its own bucket instead of being read as speed', () => {
  // The reason the breakdown moved onto the wire: SOLE_SURVIVOR_BONUS equals
  // SPEED_BONUS[0], so a 15 is either "10 + 5 speed" or "10 + 5 solo" and no
  // arithmetic on the total alone can tell them apart. Both cases below total
  // 15 and decompose differently, which is the whole argument in two fixtures.
  const alone = addQuestionToTally(emptyTally(), breakdownOf([
    { playerId: 'a', correct: true },
    { playerId: 'b', correct: false },
  ]));
  assert.deepEqual(alone.a, { base: CORRECT_POINTS, speed: 0, solo: SOLE_SURVIVOR_BONUS, closeness: 0 });
  assert.deepEqual(chipsFor(alone.a).map((c) => c.kind), ['base', 'solo']);

  const raced = addQuestionToTally(emptyTally(), breakdownOf([
    { playerId: 'a', correct: true },
    { playerId: 'b', correct: true },
  ]));
  assert.deepEqual(raced.a, { base: CORRECT_POINTS, speed: SPEED_BONUS[0], solo: 0, closeness: 0 });
  assert.deepEqual(chipsFor(raced.a).map((c) => c.kind), ['base', 'speed']);

  // Same total, different story.
  const totalOf = (/** @type {{base:number,speed:number,solo:number,closeness:number}} */ x) => x.base + x.speed + x.solo + x.closeness;
  assert.equal(totalOf(alone.a), totalOf(raced.a));
});

test('a reveal with no breakdown tallies nothing rather than throwing', () => {
  // A client that outlives a server rollback: the chips are decoration, and no
  // chips beats a broken standings screen.
  assert.deepEqual(addQuestionToTally(emptyTally(), undefined), {});
  assert.deepEqual(addQuestionToTally(emptyTally(), { a: {} }).a, { base: 0, speed: 0, solo: 0, closeness: 0 });
  assert.deepEqual(addQuestionToTally(/** @type {any} */ (null), { a: { base: 10 } }).a, { base: 10, speed: 0, solo: 0, closeness: 0 });
});

test('chips render base, then speed, then solo, and never a zero', () => {
  assert.deepEqual(chipsFor({ base: 30, speed: 8, solo: 5, closeness: 0 }), [
    { kind: 'base', value: 30 },
    { kind: 'speed', value: 8 },
    { kind: 'solo', value: 5 },
  ]);
  assert.deepEqual(chipsFor({ base: 20, speed: 0, solo: 0, closeness: 0 }), [{ kind: 'base', value: 20 }]);
  assert.deepEqual(chipsFor({ base: 0, speed: 0, solo: 0, closeness: 0 }), []);
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

test('a near miss accumulates into its own bucket and earns a chip', () => {
  // The reveal chart tells a player they scored for being close; the break has
  // to agree, or the chips stop summing to the round gain.
  const t = addQuestionToTally(emptyTally(), { a: { base: 0, speed: 0, solo: 0, closeness: 5 } });
  assert.deepEqual(t.a, { base: 0, speed: 0, solo: 0, closeness: 5 });
  assert.deepEqual(chipsFor(t.a), [{ kind: 'closeness', value: 5 }]);
});

test('base and closeness can both appear across a round, and both are chipped', () => {
  // They are mutually exclusive per QUESTION, not per round: get one right and
  // come second on the next and you have earned both.
  let t = addQuestionToTally(emptyTally(), { a: { base: 10, speed: 0, solo: 0, closeness: 0 } });
  t = addQuestionToTally(t, { a: { base: 0, speed: 0, solo: 0, closeness: 2 } });
  assert.deepEqual(t.a, { base: 10, speed: 0, solo: 0, closeness: 2 });
  const kinds = chipsFor(t.a).map((c) => c.kind);
  assert.deepEqual(kinds, ['base', 'closeness'], 'closeness is the quietest, so it comes last');
});

test('an older server sending no closeness field contributes nothing, not NaN', () => {
  // A stale PartyKit build predating this change still sends 3-bucket awards.
  // `prev.closeness + undefined` would be NaN and poison the whole round board.
  const t = addQuestionToTally(emptyTally(), { a: { base: 10, speed: 5, solo: 0 } });
  assert.equal(t.a.closeness, 0);
  assert.ok(Number.isFinite(t.a.base + t.a.speed + t.a.solo + t.a.closeness));
});
