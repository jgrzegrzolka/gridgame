import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PLAN, totalRounds, poolIdForRound } from './partyPlan.js';

test('DEFAULT_PLAN: 5 sovereign then 5 non-sovereign', () => {
  assert.deepEqual(DEFAULT_PLAN, [
    { poolId: 'sovereign', rounds: 5 },
    { poolId: 'nonSovereign', rounds: 5 },
  ]);
  assert.equal(totalRounds(DEFAULT_PLAN), 10);
});

test('poolIdForRound: rounds 0-4 sovereign, 5-9 non-sovereign', () => {
  for (let i = 0; i <= 4; i++) assert.equal(poolIdForRound(DEFAULT_PLAN, i), 'sovereign', `round ${i}`);
  for (let i = 5; i <= 9; i++) assert.equal(poolIdForRound(DEFAULT_PLAN, i), 'nonSovereign', `round ${i}`);
});

test('poolIdForRound: an index past the end clamps to the last segment', () => {
  assert.equal(poolIdForRound(DEFAULT_PLAN, 10), 'nonSovereign');
  assert.equal(poolIdForRound(DEFAULT_PLAN, 99), 'nonSovereign');
});

test('totalRounds / poolIdForRound work for an arbitrary plan', () => {
  const plan = [{ poolId: 'a', rounds: 2 }, { poolId: 'b', rounds: 3 }];
  assert.equal(totalRounds(plan), 5);
  assert.equal(poolIdForRound(plan, 0), 'a');
  assert.equal(poolIdForRound(plan, 1), 'a');
  assert.equal(poolIdForRound(plan, 2), 'b');
  assert.equal(poolIdForRound(plan, 4), 'b');
});
