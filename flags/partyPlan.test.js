import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_PLAN,
  totalRounds,
  poolIdForRound,
  roundIdForRound,
  PARTY_MODES,
  MAX_ROUNDS_PER_MODE,
  MAX_TOTAL_ROUNDS,
  countsForPlan,
  planFromModeCounts,
  validatePlan,
} from './partyPlan.js';

test('DEFAULT_PLAN: 3 sovereign flag-pick, 3 non-sovereign flag-pick, 3 sovereign map, 2 superlative', () => {
  assert.deepEqual(DEFAULT_PLAN, [
    { poolId: 'sovereign', roundId: 'flagPick', rounds: 3 },
    { poolId: 'nonSovereign', roundId: 'flagPick', rounds: 3 },
    { poolId: 'sovereign', roundId: 'mapPick', rounds: 3 },
    { poolId: 'sovereign', roundId: 'superlative', rounds: 2 },
  ]);
  assert.equal(totalRounds(DEFAULT_PLAN), 11);
});

test('poolIdForRound: non-sovereign only for 3-5, sovereign elsewhere', () => {
  for (let i = 0; i <= 2; i++) assert.equal(poolIdForRound(DEFAULT_PLAN, i), 'sovereign', `round ${i}`);
  for (let i = 3; i <= 5; i++) assert.equal(poolIdForRound(DEFAULT_PLAN, i), 'nonSovereign', `round ${i}`);
  for (let i = 6; i <= 10; i++) assert.equal(poolIdForRound(DEFAULT_PLAN, i), 'sovereign', `round ${i}`);
});

test('roundIdForRound: flag-pick 0-5, map 6-8, superlative 9-10', () => {
  for (let i = 0; i <= 5; i++) assert.equal(roundIdForRound(DEFAULT_PLAN, i), 'flagPick', `round ${i}`);
  for (let i = 6; i <= 8; i++) assert.equal(roundIdForRound(DEFAULT_PLAN, i), 'mapPick', `round ${i}`);
  for (let i = 9; i <= 10; i++) assert.equal(roundIdForRound(DEFAULT_PLAN, i), 'superlative', `round ${i}`);
});

test('past the end clamps to the last segment (pool and round)', () => {
  assert.equal(poolIdForRound(DEFAULT_PLAN, 11), 'sovereign');
  assert.equal(roundIdForRound(DEFAULT_PLAN, 99), 'superlative');
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

// ---- mode catalog + host-configurable plans ----

test('PARTY_MODES: every DEFAULT_PLAN segment maps to a catalog mode', () => {
  for (const seg of DEFAULT_PLAN) {
    const m = PARTY_MODES.find((x) => x.roundId === seg.roundId && x.poolId === seg.poolId);
    assert.ok(m, `no catalog mode for ${seg.roundId}/${seg.poolId}`);
  }
  // ids are unique and kebab-case
  assert.equal(new Set(PARTY_MODES.map((m) => m.id)).size, PARTY_MODES.length);
  for (const m of PARTY_MODES) assert.match(m.id, /^[a-z]+(-[a-z]+)*$/);
});

test('countsForPlan: default plan gives 3 / 3 / 3 / 2 keyed by mode id', () => {
  assert.deepEqual(countsForPlan(DEFAULT_PLAN), {
    'flags-all': 3, 'flags-territories': 3, 'map-outlines': 3, 'superlative-pop': 2,
  });
});

test('countsForPlan: a mode absent from the plan reads 0', () => {
  const counts = countsForPlan([{ poolId: 'sovereign', roundId: 'mapPick', rounds: 4 }]);
  assert.equal(counts['map-outlines'], 4);
  assert.equal(counts['flags-all'], 0);
  assert.equal(counts['flags-territories'], 0);
  assert.equal(counts['superlative-pop'], 0);
});

test('planFromModeCounts round-trips the default counts back to DEFAULT_PLAN', () => {
  assert.deepEqual(planFromModeCounts(countsForPlan(DEFAULT_PLAN)), DEFAULT_PLAN);
});

test('planFromModeCounts: drops modes at 0, keeps catalog order, clamps per-mode', () => {
  const plan = planFromModeCounts({ 'flags-all': 0, 'flags-territories': 2, 'map-outlines': 99 });
  assert.deepEqual(plan, [
    { poolId: 'nonSovereign', roundId: 'flagPick', rounds: 2 },
    { poolId: 'sovereign', roundId: 'mapPick', rounds: MAX_ROUNDS_PER_MODE },
  ]);
});

test('validatePlan: a clean plan passes through unchanged', () => {
  assert.deepEqual(validatePlan(DEFAULT_PLAN), DEFAULT_PLAN);
});

test('validatePlan: drops segments with an unknown mode or a bad count', () => {
  const dirty = [
    { poolId: 'sovereign', roundId: 'flagPick', rounds: 2 },   // ok
    { poolId: 'sovereign', roundId: 'nopeRound', rounds: 3 },  // unknown roundId
    { poolId: 'atlantis', roundId: 'flagPick', rounds: 3 },    // unknown poolId
    { poolId: 'sovereign', roundId: 'mapPick', rounds: 0 },    // count < 1
    { poolId: 'sovereign', roundId: 'mapPick', rounds: 2.5 },  // non-integer
    { poolId: 'sovereign', roundId: 'mapPick', rounds: 4 },    // ok
  ];
  assert.deepEqual(validatePlan(dirty), [
    { poolId: 'sovereign', roundId: 'flagPick', rounds: 2 },
    { poolId: 'sovereign', roundId: 'mapPick', rounds: 4 },
  ]);
});

test('validatePlan: caps the running total at MAX_TOTAL_ROUNDS', () => {
  const huge = [
    { poolId: 'sovereign', roundId: 'flagPick', rounds: MAX_ROUNDS_PER_MODE },
    { poolId: 'nonSovereign', roundId: 'flagPick', rounds: MAX_ROUNDS_PER_MODE },
    { poolId: 'sovereign', roundId: 'mapPick', rounds: MAX_ROUNDS_PER_MODE },
  ];
  const out = validatePlan(huge);
  assert.equal(totalRounds(/** @type {any} */ (out)), MAX_TOTAL_ROUNDS);
});

test('validatePlan: non-array, empty, or all-invalid input returns null', () => {
  assert.equal(validatePlan(null), null);
  assert.equal(validatePlan('nope'), null);
  assert.equal(validatePlan(undefined), null);
  assert.equal(validatePlan([]), null);
  assert.equal(validatePlan([{ poolId: 'x', roundId: 'y', rounds: 3 }]), null);
});
