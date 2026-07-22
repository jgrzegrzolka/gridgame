import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CORRECT_POINTS,
  speedBonusForRank,
  scoreQuestion,
  scoreQuestionDetailed,
  SOLE_SURVIVOR_BONUS,
  CLOSENESS_LADDER,
  closenessForRank,
  wasFastest,
} from './partyScore.js';

test('speedBonusForRank: sized to the race — every correct seat scores, winner bumped', () => {
  // Six correct -> 6/4/3/2/1/0 by arrival. The fastest gets a winner bump (6, not
  // 5), so first place always clears second by two.
  assert.deepEqual([0, 1, 2, 3, 4, 5].map((r) => speedBonusForRank(r, 6)), [6, 4, 3, 2, 1, 0]);
  // Three correct -> 3/1/0. Two correct -> 2/0.
  assert.deepEqual([0, 1, 2].map((r) => speedBonusForRank(r, 3)), [3, 1, 0]);
  assert.deepEqual([0, 1].map((r) => speedBonusForRank(r, 2)), [2, 0]);
});

test('speedBonusForRank: no race means no bonus, and out-of-range pays 0', () => {
  assert.equal(speedBonusForRank(0, 1), 0, 'a lone correct answer beat nobody');
  assert.equal(speedBonusForRank(0, 0), 0);
  assert.equal(speedBonusForRank(6, 6), 0, 'rank past the field');
  assert.equal(speedBonusForRank(-1, 6), 0);
});

test('scoreQuestion: correct answers get base + a speed bonus that reaches everyone', () => {
  const points = scoreQuestion([
    { playerId: 'a', correct: true },
    { playerId: 'b', correct: true },
    { playerId: 'c', correct: true },
    { playerId: 'd', correct: true },
    { playerId: 'e', correct: true },
    { playerId: 'f', correct: true },
  ]);
  // Six correct: base 5 + speed 6/4/3/2/1/0.
  assert.equal(points.a, CORRECT_POINTS + 6);
  assert.equal(points.b, CORRECT_POINTS + 4);
  assert.equal(points.c, CORRECT_POINTS + 3);
  assert.equal(points.d, CORRECT_POINTS + 2);
  assert.equal(points.e, CORRECT_POINTS + 1);
  assert.equal(points.f, CORRECT_POINTS + 0);
});

test('scoreQuestion: wrong answers score 0 and do not consume a speed rank', () => {
  const points = scoreQuestion([
    { playerId: 'a', correct: false },
    { playerId: 'b', correct: true },
    { playerId: 'c', correct: true },
  ]);
  assert.equal(points.a, 0);
  // Two correct, so the ladder is sized to 2 (2/0). b is first correct despite
  // buzzing second — a's wrong buzz must not steal the winner bump.
  assert.equal(points.b, CORRECT_POINTS + 2);
  assert.equal(points.c, CORRECT_POINTS + 0);
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

test('scoreQuestionDetailed: total is always base + speed + solo + closeness', () => {
  const awards = scoreQuestionDetailed([
    { playerId: 'a', correct: true },
    { playerId: 'b', correct: true },
    { playerId: 'c', correct: false, rank: 1 },
  ]);
  for (const award of Object.values(awards)) {
    assert.equal(award.total, award.base + award.speed + award.solo + award.closeness);
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

test('sole survivor: the only correct player gets the small bonus, no speed', () => {
  const awards = scoreQuestionDetailed([
    { playerId: 'a', correct: true },
    { playerId: 'b', correct: false },
    { playerId: 'c', correct: false },
  ]);
  assert.equal(awards.a.solo, SOLE_SURVIVOR_BONUS);
  assert.equal(awards.a.solo, 1, 'sole survivor is worth exactly 1 now');
  // No speed: being "first" among one correct answer means beating nobody.
  assert.equal(awards.a.speed, 0);
  assert.equal(awards.a.fastest, false, 'nobody is fastest without a race');
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
  const awards = scoreQuestionDetailed([
    { playerId: 'a', correct: false },
    { playerId: 'b', correct: false },
    { playerId: 'c', correct: true },
  ]);
  assert.equal(awards.c.solo, SOLE_SURVIVOR_BONUS);
});

test('sole survivor: off in solo play, like the speed bonus', () => {
  const awards = scoreQuestionDetailed([{ playerId: 'a', correct: true }], { applySpeedBonus: false });
  assert.equal(awards.a.solo, 0);
  assert.equal(awards.a.speed, 0);
  assert.equal(awards.a.total, CORRECT_POINTS);
});

test('a wrong answer earns nothing in every bucket when the question has no ranking', () => {
  const awards = scoreQuestionDetailed([{ playerId: 'a', correct: false }, { playerId: 'b', correct: true }]);
  assert.deepEqual(awards.a, { base: 0, speed: 0, solo: 0, closeness: 0, fastest: false, total: 0 });
});

// ---- ranked (world-facts) questions ----

test('ranked: the exact answer pays the top of the closeness ladder, as base', () => {
  // A ranked question scores through the ladder, so a right pick is worth
  // CLOSENESS_LADDER[0] (6) rather than the flat CORRECT_POINTS (5) — reading a
  // four-way ranking earns a touch more than a right/wrong flag. It still lands
  // in `base` ("you were right"), never `closeness`.
  const awards = scoreQuestionDetailed([
    { playerId: 'right', correct: true, rank: 0 },
    { playerId: 'near', correct: false, rank: 1 },
  ]);
  assert.equal(awards.right.base, CLOSENESS_LADDER[0]);
  assert.equal(awards.right.base, 6);
  assert.equal(awards.right.closeness, 0);
});

test('closeness: the ladder is 6/3/2/0 and a right pick out-scores the closest wrong one', () => {
  // The whole reason the ladder tops out below nothing awkward: base (6) sits
  // above runner-up (3), so being right always beats being close.
  assert.deepEqual(CLOSENESS_LADDER, [6, 3, 2, 0]);
  assert.ok(CLOSENESS_LADDER[0] > CLOSENESS_LADDER[1], 'right beats close');
});

test('closeness: rank 0 and out-of-range ranks pay nothing through closeness', () => {
  // Rank 0 is the answer and is paid through `base`; paying it here too would
  // double-count. Non-integers and overshoot are defensive.
  assert.equal(closenessForRank(0), 0);
  assert.equal(closenessForRank(undefined), 0);
  assert.equal(closenessForRank(4), 0);
  assert.equal(closenessForRank(-1), 0);
  assert.equal(closenessForRank(1.5), 0);
});

test('closeness: a near miss pays by how near, and lands in its own bucket', () => {
  const awards = scoreQuestionDetailed([
    { playerId: 'right', correct: true, rank: 0 },
    { playerId: 'near', correct: false, rank: 1 },
    { playerId: 'far', correct: false, rank: 2 },
    { playerId: 'last', correct: false, rank: 3 },
  ]);
  assert.deepEqual(awards.near, { base: 0, speed: 0, solo: 0, closeness: 3, fastest: false, total: 3 });
  assert.deepEqual(awards.far, { base: 0, speed: 0, solo: 0, closeness: 2, fastest: false, total: 2 });
  assert.deepEqual(awards.last, { base: 0, speed: 0, solo: 0, closeness: 0, fastest: false, total: 0 });
});

test('closeness: a near miss earns no speed bonus, however fast it arrived', () => {
  // Speed ranks among the EXACT-correct only. Paying it on a near miss would
  // reward buzzing fast on a question you did not know.
  const awards = scoreQuestionDetailed([
    { playerId: 'fastWrong', correct: false, rank: 1 },
    { playerId: 'right1', correct: true, rank: 0 },
    { playerId: 'right2', correct: true, rank: 0 },
  ]);
  assert.equal(awards.fastWrong.speed, 0);
  assert.equal(awards.fastWrong.total, CLOSENESS_LADDER[1]);
  // Two exact-correct is a real race (K=2), so the winner bump pays.
  assert.equal(awards.right1.speed, speedBonusForRank(0, 2), 'the actual race still pays');
});

test('closeness: a near miss does not block the sole-survivor bonus', () => {
  const awards = scoreQuestionDetailed([
    { playerId: 'a', correct: false, rank: 1 },
    { playerId: 'b', correct: true, rank: 0 },
  ]);
  assert.equal(awards.b.solo, SOLE_SURVIVOR_BONUS);
  assert.equal(awards.a.closeness, CLOSENESS_LADDER[1]);
});

test('closeness: scoreQuestion projects the same totals as the detailed scorer', () => {
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

test('the winner of a bigger race wins a bigger prize, and a lone correct is modest', () => {
  // The design the rebalance buys: with K correct the winner earns CORRECT_POINTS
  // + K, so an easy question everyone gets (big K) becomes a real race, while a
  // lone correct answer tops out at CORRECT_POINTS + 1 (down from the old 15).
  // Everyone in the race still banks at least the base, so a big K is not a
  // blow-open — it lifts the whole field, not just the winner.
  for (let correct = 2; correct <= 6; correct++) {
    const buzzes = [];
    for (let i = 0; i < 6; i++) buzzes.push({ playerId: 'p' + i, correct: i < correct });
    const awards = scoreQuestionDetailed(buzzes);
    const top = Math.max(...Object.values(awards).map((a) => a.total));
    assert.equal(top, CORRECT_POINTS + correct, `${correct} correct -> winner scores ${CORRECT_POINTS + correct}`);
  }
  const lone = scoreQuestionDetailed([
    { playerId: 'a', correct: true },
    { playerId: 'b', correct: false },
    { playerId: 'c', correct: false },
  ]);
  assert.equal(Math.max(...Object.values(lone).map((a) => a.total)), CORRECT_POINTS + SOLE_SURVIVOR_BONUS);
});

test('only ONE player is ever tagged Fastest, via the explicit flag', () => {
  const awards = scoreQuestionDetailed([
    { playerId: 'first', correct: true },
    { playerId: 'second', correct: true },
    { playerId: 'third', correct: true },
    { playerId: 'fourth', correct: true },
  ]);
  const tagged = Object.entries(awards).filter(([, a]) => wasFastest(a)).map(([id]) => id);
  assert.deepEqual(tagged, ['first'], 'exactly the seat that actually arrived first');
  // ...and the also-rans keep their points, they just are not called Fastest.
  assert.ok(awards.second.speed > 0, 'second still earns a speed bonus');
  assert.equal(wasFastest(awards.second), false);
});

test('wasFastest is false when there was no race at all', () => {
  const alone = scoreQuestionDetailed([
    { playerId: 'a', correct: true },
    { playerId: 'b', correct: false },
  ]);
  assert.equal(wasFastest(alone.a), false);
  assert.equal(wasFastest(alone.b), false);
  const solo = scoreQuestionDetailed([{ playerId: 'a', correct: true }], { applySpeedBonus: false });
  assert.equal(wasFastest(solo.a), false);
});

test('the speed ladder strictly decreases by arrival, which is what makes wasFastest sound', () => {
  // wasFastest is now an explicit flag, but the ladder must still hand the fastest
  // a strictly-greater bonus than anyone else, or two seats could sensibly claim
  // the badge. Walk a few race sizes and pin the monotonic drop + winner bump.
  for (const k of [2, 3, 4, 6]) {
    for (let r = 1; r < k; r++) {
      assert.ok(speedBonusForRank(r - 1, k) > speedBonusForRank(r, k),
        `ladder must strictly decrease at K=${k}: rank ${r - 1} vs ${r}`);
    }
    assert.ok(speedBonusForRank(0, k) - speedBonusForRank(1, k) >= 2, `winner bump at K=${k}`);
  }
});
