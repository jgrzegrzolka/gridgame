import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CORRECT_POINTS,
  SPEED_BONUS,
  speedBonusForRank,
  scoreRound,
} from './partyScore.js';

test('speedBonusForRank: follows the curve, then 0 past the end', () => {
  assert.equal(speedBonusForRank(0), SPEED_BONUS[0]);
  assert.equal(speedBonusForRank(1), SPEED_BONUS[1]);
  assert.equal(speedBonusForRank(2), SPEED_BONUS[2]);
  assert.equal(speedBonusForRank(3), 0);
  assert.equal(speedBonusForRank(99), 0);
});

test('scoreRound: correct answers get base + decaying speed bonus in arrival order', () => {
  const points = scoreRound([
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

test('scoreRound: wrong answers score 0 and do not consume a speed rank', () => {
  const points = scoreRound([
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

test('scoreRound: solo (applySpeedBonus false) awards base only', () => {
  const points = scoreRound([{ playerId: 'solo', correct: true }], {
    applySpeedBonus: false,
  });
  assert.equal(points.solo, CORRECT_POINTS);
});

test('scoreRound: empty round scores nobody', () => {
  assert.deepEqual(scoreRound([]), {});
});
