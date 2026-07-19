import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CORRECT_POINTS,
  SPEED_BONUS,
  speedBonusForRank,
  scoreQuestion,
  scoreQuestionDetailed,
  SOLE_SURVIVOR_BONUS,
  CLOSENESS_LADDER,
  closenessForRank,
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
  for (const opts of [{}, { applySpeedBonus: false }, { applySoloBonus: false }]) {
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
  // No speed: being "first" among one correct answer means beating nobody.
  assert.equal(awards.a.speed, 0);
  assert.equal(awards.a.total, CORRECT_POINTS + SOLE_SURVIVOR_BONUS);
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

test('a wrong answer earns nothing in every bucket when the question has no ranking', () => {
  // No `rank` on the buzz — flag-pick and map-pick are right-or-wrong, so
  // closeness must stay 0 and this path must behave exactly as it always has.
  const awards = scoreQuestionDetailed([{ playerId: 'a', correct: false }, { playerId: 'b', correct: true }]);
  assert.deepEqual(awards.a, { base: 0, speed: 0, solo: 0, closeness: 0, total: 0 });
});

test('closeness: the ladder agrees with CORRECT_POINTS at rank 0', () => {
  // The ladder is written 10/5/2/0 because that is what a player reads off the
  // reveal chart. Index 0 is paid as `base`, so if these two ever drift the
  // chart would print a number the scorer does not award.
  assert.equal(CLOSENESS_LADDER[0], CORRECT_POINTS);
});

test('closeness: rank 0 and out-of-range ranks pay nothing', () => {
  // Rank 0 is the answer and is paid through `base`; paying it here too would
  // double-count. Non-integers and overshoot are defensive, not expected.
  assert.equal(closenessForRank(0), 0);
  assert.equal(closenessForRank(undefined), 0);
  assert.equal(closenessForRank(4), 0);
  assert.equal(closenessForRank(-1), 0);
  assert.equal(closenessForRank(1.5), 0);
});

test('closeness: a near miss pays, and lands in its own bucket', () => {
  const awards = scoreQuestionDetailed([
    { playerId: 'right', correct: true, rank: 0 },
    { playerId: 'near', correct: false, rank: 1 },
    { playerId: 'far', correct: false, rank: 2 },
    { playerId: 'last', correct: false, rank: 3 },
  ]);
  assert.deepEqual(awards.near, { base: 0, speed: 0, solo: 0, closeness: 5, total: 5 });
  assert.deepEqual(awards.far, { base: 0, speed: 0, solo: 0, closeness: 2, total: 2 });
  assert.deepEqual(awards.last, { base: 0, speed: 0, solo: 0, closeness: 0, total: 0 });
  // The correct pick is paid as base, never as closeness — that separation is
  // what lets the break's chips say "right" vs "close" rather than one number.
  assert.equal(awards.right.base, CORRECT_POINTS);
  assert.equal(awards.right.closeness, 0);
});

test('closeness: a near miss earns no speed bonus, however fast it arrived', () => {
  // Speed ranks among CORRECT answers. Paying it on a near miss would reward
  // buzzing fast on a question you did not know, which is the opposite of what
  // the speed bonus is for.
  // Two correct, so a race genuinely happened and the control below is
  // meaningful — with a single correct answer nobody gets speed at all now.
  const awards = scoreQuestionDetailed([
    { playerId: 'fastWrong', correct: false, rank: 1 },
    { playerId: 'right1', correct: true, rank: 0 },
    { playerId: 'right2', correct: true, rank: 0 },
  ]);
  assert.equal(awards.fastWrong.speed, 0);
  assert.equal(awards.fastWrong.total, CLOSENESS_LADDER[1]);
  assert.equal(awards.right1.speed, SPEED_BONUS[0], 'the actual race still pays');
});

test('closeness: a near miss does not block the sole-survivor bonus', () => {
  // Sole survivor means "the only one who got it RIGHT". Someone scoring
  // closeness points is still wrong, so the lone correct player keeps the bonus.
  const awards = scoreQuestionDetailed([
    { playerId: 'a', correct: false, rank: 1 },
    { playerId: 'b', correct: true, rank: 0 },
  ]);
  assert.equal(awards.b.solo, SOLE_SURVIVOR_BONUS);
  assert.equal(awards.a.closeness, CLOSENESS_LADDER[1]);
});

test('closeness: scoreQuestion projects the same totals as the detailed scorer', () => {
  // scoreQuestion is a projection, not a second implementation. Closeness has to
  // reach the room's seat arithmetic through it or near misses would show on the
  // reveal and never touch anyone's score.
  const buzzes = [
    { playerId: 'a', correct: false, rank: 1 },
    { playerId: 'b', correct: true, rank: 0 },
    { playerId: 'c', correct: false, rank: 3 },
  ];
  const flat = scoreQuestion(buzzes);
  const detailed = scoreQuestionDetailed(buzzes);
  for (const id of Object.keys(detailed)) assert.equal(flat[id], detailed[id].total);
  assert.equal(flat.a, CLOSENESS_LADDER[1]);
});

test('no race, no race bonus: a lone correct answer earns no speed', () => {
  // Being 'first' among one correct answer means having beaten nobody. This
  // used to pay SPEED_BONUS[0] on top of the sole-survivor bonus, making that
  // question worth 20 against everyone else's 0 -- and it fires on ~24% of
  // four-player questions, so it was the most common way a board blew open.
  const alone = scoreQuestionDetailed([
    { playerId: 'a', correct: true },
    { playerId: 'b', correct: false },
    { playerId: 'c', correct: false },
    { playerId: 'd', correct: false },
  ]);
  assert.equal(alone.a.speed, 0);
  assert.equal(alone.a.total, CORRECT_POINTS + SOLE_SURVIVOR_BONUS);

  // Two correct is a real race, and the winner of it is paid.
  const raced = scoreQuestionDetailed([
    { playerId: 'a', correct: true },
    { playerId: 'b', correct: true },
    { playerId: 'c', correct: false },
    { playerId: 'd', correct: false },
  ]);
  assert.equal(raced.a.speed, SPEED_BONUS[0]);
  assert.equal(raced.b.speed, SPEED_BONUS[1]);
  assert.equal(raced.a.solo, 0, 'two correct is not a sole survivor');
});

test('the biggest possible swing on a question is the same however many knew it', () => {
  // The real complaint this fixed: the sole-survivor case was the ONLY outcome
  // that could exceed a 15-point swing, and the excess was exactly the
  // unearned speed bonus. Walk every outcome and pin that the top payout never
  // exceeds a correct answer plus one bonus.
  const cap = CORRECT_POINTS + Math.max(SPEED_BONUS[0], SOLE_SURVIVOR_BONUS);
  for (let correct = 1; correct <= 4; correct++) {
    const buzzes = [];
    for (let i = 0; i < 4; i++) buzzes.push({ playerId: 'p' + i, correct: i < correct });
    const awards = scoreQuestionDetailed(buzzes);
    const top = Math.max(...Object.values(awards).map((a) => a.total));
    assert.ok(top <= cap,
      `${correct} correct pays a top score of ${top}, above the ${cap} cap`);
  }
});
