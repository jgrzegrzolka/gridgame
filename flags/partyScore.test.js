import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CORRECT_POINTS,
  SPEED_BONUS,
  FINAL_ROUND_MULTIPLIER,
  speedBonusForRank,
  scoreQuestion,
  scoreQuestionDetailed,
  SOLE_SURVIVOR_BONUS,
} from './partyScore.js';

test('speedBonusForRank: follows the curve, then 0 past the end', () => {
  assert.equal(speedBonusForRank(0), SPEED_BONUS[0]);
  assert.equal(speedBonusForRank(1), SPEED_BONUS[1]);
  assert.equal(speedBonusForRank(2), SPEED_BONUS[2]);
  assert.equal(speedBonusForRank(3), 0);
  assert.equal(speedBonusForRank(99), 0);
});

test('scoreQuestion: correct answers get base + decaying speed bonus in arrival order', () => {
  const points = scoreQuestion([
    { playerId: 'a', correct: true },
    { playerId: 'b', correct: true },
    { playerId: 'c', correct: true },
    { playerId: 'd', correct: true },
  ]);
  assert.equal(points.a, CORRECT_POINTS + 5);
  assert.equal(points.b, CORRECT_POINTS + 3);
  assert.equal(points.c, CORRECT_POINTS + 1);
  assert.equal(points.d, CORRECT_POINTS + 0);
});

test('scoreQuestion: wrong answers score 0 and do not consume a speed rank', () => {
  const points = scoreQuestion([
    { playerId: 'a', correct: false },
    { playerId: 'b', correct: true },
    { playerId: 'c', correct: true },
  ]);
  assert.equal(points.a, 0);
  // b is the FIRST correct answer despite buzzing second — a's wrong buzz
  // must not steal the rank-0 bonus.
  assert.equal(points.b, CORRECT_POINTS + 5);
  assert.equal(points.c, CORRECT_POINTS + 3);
});

test('scoreQuestion: solo (applySpeedBonus false) awards base only', () => {
  const points = scoreQuestion([{ playerId: 'solo', correct: true }], {
    applySpeedBonus: false,
  });
  assert.equal(points.solo, CORRECT_POINTS);
});

test('scoreQuestion: empty question scores nobody', () => {
  assert.deepEqual(scoreQuestion([]), {});
});

test('scoreQuestion: the multiplier scales base + speed bonus, wrong stays 0', () => {
  const buzzes = [
    { playerId: 'a', correct: true },   // base + speed[0]
    { playerId: 'b', correct: false },  // 0
    { playerId: 'c', correct: true },   // base + speed[1]
  ];
  const doubled = scoreQuestion(buzzes, { multiplier: FINAL_ROUND_MULTIPLIER });
  assert.equal(doubled.a, (CORRECT_POINTS + SPEED_BONUS[0]) * FINAL_ROUND_MULTIPLIER);
  assert.equal(doubled.b, 0, 'a wrong answer is 0 regardless of the multiplier');
  assert.equal(doubled.c, (CORRECT_POINTS + SPEED_BONUS[1]) * FINAL_ROUND_MULTIPLIER);
});

test('scoreQuestion: multiplier defaults to 1 (unchanged scoring)', () => {
  const buzzes = [{ playerId: 'a', correct: true }];
  assert.deepEqual(scoreQuestion(buzzes), scoreQuestion(buzzes, { multiplier: 1 }));
});

test('FINAL_ROUND_MULTIPLIER is 2', () => {
  assert.equal(FINAL_ROUND_MULTIPLIER, 2);
});

// ---- Iteration 12 phase 5: the itemised award + sole survivor ----

test('scoreQuestionDetailed: total is always base + speed + solo', () => {
  const awards = scoreQuestionDetailed([
    { playerId: 'a', correct: true },
    { playerId: 'b', correct: true },
    { playerId: 'c', correct: false },
  ]);
  for (const award of Object.values(awards)) {
    assert.equal(award.total, award.base + award.speed + award.solo);
  }
});

test('scoreQuestionDetailed: scoreQuestion is exactly its totals', () => {
  // scoreQuestion is a projection, not a second implementation — the room's seat
  // arithmetic and the reveal's chips must never be able to disagree.
  const buzzes = [
    { playerId: 'a', correct: true },
    { playerId: 'b', correct: false },
    { playerId: 'c', correct: true },
  ];
  for (const opts of [{}, { multiplier: 2 }, { applySpeedBonus: false }]) {
    const totals = scoreQuestion(buzzes, opts);
    const detailed = scoreQuestionDetailed(buzzes, opts);
    for (const [id, award] of Object.entries(detailed)) assert.equal(totals[id], award.total);
    assert.deepEqual(Object.keys(totals).sort(), Object.keys(detailed).sort());
  }
});

test('sole survivor: the only correct player gets the bonus', () => {
  const awards = scoreQuestionDetailed([
    { playerId: 'a', correct: true },
    { playerId: 'b', correct: false },
    { playerId: 'c', correct: false },
  ]);
  assert.equal(awards.a.solo, SOLE_SURVIVOR_BONUS);
  assert.equal(awards.a.total, CORRECT_POINTS + SPEED_BONUS[0] + SOLE_SURVIVOR_BONUS);
  assert.equal(awards.b.solo, 0);
});

test('sole survivor: two correct answers means nobody was the only one', () => {
  const awards = scoreQuestionDetailed([
    { playerId: 'a', correct: true },
    { playerId: 'b', correct: true },
  ]);
  assert.equal(awards.a.solo, 0);
  assert.equal(awards.b.solo, 0);
});

test('sole survivor: counts across the whole question, not per buzz order', () => {
  // The lone correct answer arriving last must still be recognised — the bonus is
  // decided by how many got it right, which isn't known until every buzz is in.
  const awards = scoreQuestionDetailed([
    { playerId: 'a', correct: false },
    { playerId: 'b', correct: false },
    { playerId: 'c', correct: true },
  ]);
  assert.equal(awards.c.solo, SOLE_SURVIVOR_BONUS);
});

test('sole survivor: off in solo play, like the speed bonus', () => {
  // One seat: there is nobody to be the only one against.
  const awards = scoreQuestionDetailed([{ playerId: 'a', correct: true }], { applySpeedBonus: false });
  assert.equal(awards.a.solo, 0);
  assert.equal(awards.a.speed, 0);
  assert.equal(awards.a.total, CORRECT_POINTS);
});

test('sole survivor: doubles on the Decider like every other point', () => {
  const awards = scoreQuestionDetailed(
    [{ playerId: 'a', correct: true }, { playerId: 'b', correct: false }],
    { multiplier: FINAL_ROUND_MULTIPLIER },
  );
  assert.equal(awards.a.solo, SOLE_SURVIVOR_BONUS * FINAL_ROUND_MULTIPLIER);
  assert.equal(awards.a.total, (CORRECT_POINTS + SPEED_BONUS[0] + SOLE_SURVIVOR_BONUS) * FINAL_ROUND_MULTIPLIER);
});

test('a wrong answer earns nothing in every bucket', () => {
  const awards = scoreQuestionDetailed([{ playerId: 'a', correct: false }, { playerId: 'b', correct: true }]);
  assert.deepEqual(awards.a, { base: 0, speed: 0, solo: 0, total: 0 });
});
