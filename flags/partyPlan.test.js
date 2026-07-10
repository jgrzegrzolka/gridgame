import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PLAN, totalRounds, poolIdForRound, roundIdForRound } from './partyPlan.js';

test('DEFAULT_PLAN: 3 sovereign flag-pick, 3 non-sovereign flag-pick, 5 sovereign map', () => {
  assert.deepEqual(DEFAULT_PLAN, [
    { poolId: 'sovereign', roundId: 'flagPick', rounds: 3 },
    { poolId: 'nonSovereign', roundId: 'flagPick', rounds: 3 },
    { poolId: 'sovereign', roundId: 'mapPick', rounds: 5 },
  ]);
  assert.equal(totalRounds(DEFAULT_PLAN), 11);
});

test('poolIdForRound: sovereign 0-2, non-sovereign 3-5, sovereign 6-10', () => {
  for (let i = 0; i <= 2; i++) assert.equal(poolIdForRound(DEFAULT_PLAN, i), 'sovereign', `round ${i}`);
  for (let i = 3; i <= 5; i++) assert.equal(poolIdForRound(DEFAULT_PLAN, i), 'nonSovereign', `round ${i}`);
  for (let i = 6; i <= 10; i++) assert.equal(poolIdForRound(DEFAULT_PLAN, i), 'sovereign', `round ${i}`);
});

test('roundIdForRound: flag-pick for rounds 0-5, map for 6-10', () => {
  for (let i = 0; i <= 5; i++) assert.equal(roundIdForRound(DEFAULT_PLAN, i), 'flagPick', `round ${i}`);
  for (let i = 6; i <= 10; i++) assert.equal(roundIdForRound(DEFAULT_PLAN, i), 'mapPick', `round ${i}`);
});

test('past the end clamps to the last segment (pool and round)', () => {
  assert.equal(poolIdForRound(DEFAULT_PLAN, 11), 'sovereign');
  assert.equal(roundIdForRound(DEFAULT_PLAN, 99), 'mapPick');
});

test('totalRounds / poolIdForRound / roundIdForRound work for an arbitrary plan', () => {
  const plan = [
    { poolId: 'a', roundId: 'x', rounds: 2 },
    { poolId: 'b', roundId: 'y', rounds: 3 },
  ];
  assert.equal(totalRounds(plan), 5);
  assert.equal(poolIdForRound(plan, 0), 'a');
  assert.equal(roundIdForRound(plan, 1), 'x');
  assert.equal(poolIdForRound(plan, 2), 'b');
  assert.equal(roundIdForRound(plan, 4), 'y');
});
