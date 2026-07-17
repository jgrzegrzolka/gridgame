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
  PICTURE_MODES,
  METRIC_MODES,
  buildPartyPlan,
  BLOCK_ROUNDS,
  blockIndexForRound,
  blockCount,
  isBlockEnd,
  isBlockBoundary,
  isBlockStart,
  isFinalBlock,
} from './partyPlan.js';

test('DEFAULT_PLAN: 4 of each — sovereign flag, non-sovereign flag, sovereign map, superlative', () => {
  assert.deepEqual(DEFAULT_PLAN, [
    { poolId: 'sovereign', roundId: 'flagPick', rounds: 4 },
    { poolId: 'nonSovereign', roundId: 'flagPick', rounds: 4 },
    { poolId: 'sovereign', roundId: 'mapPick', rounds: 4 },
    { poolId: 'sovereign', roundId: 'superlative', rounds: 4 },
  ]);
  assert.equal(totalRounds(DEFAULT_PLAN), 16);
});

test('poolIdForRound: non-sovereign only for 4-7, sovereign elsewhere', () => {
  for (let i = 0; i <= 3; i++) assert.equal(poolIdForRound(DEFAULT_PLAN, i), 'sovereign', `round ${i}`);
  for (let i = 4; i <= 7; i++) assert.equal(poolIdForRound(DEFAULT_PLAN, i), 'nonSovereign', `round ${i}`);
  for (let i = 8; i <= 15; i++) assert.equal(poolIdForRound(DEFAULT_PLAN, i), 'sovereign', `round ${i}`);
});

test('roundIdForRound: flag-pick 0-7, map 8-11, superlative 12-15', () => {
  for (let i = 0; i <= 7; i++) assert.equal(roundIdForRound(DEFAULT_PLAN, i), 'flagPick', `round ${i}`);
  for (let i = 8; i <= 11; i++) assert.equal(roundIdForRound(DEFAULT_PLAN, i), 'mapPick', `round ${i}`);
  for (let i = 12; i <= 15; i++) assert.equal(roundIdForRound(DEFAULT_PLAN, i), 'superlative', `round ${i}`);
});

test('past the end clamps to the last segment (pool and round)', () => {
  assert.equal(poolIdForRound(DEFAULT_PLAN, 16), 'sovereign');
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

test('countsForPlan: default plan gives 4 / 4 / 4 / 4 keyed by mode id', () => {
  assert.deepEqual(countsForPlan(DEFAULT_PLAN), {
    'flags-all': 4, 'flags-territories': 4, 'map-outlines': 4, 'superlative-pop': 4, 'superlative-area': 0, 'superlative-density': 0, 'superlative-gdp': 0, 'superlative-gdppc': 0, 'superlative-coffee': 0, 'superlative-wine': 0, 'superlative-cocoa': 0, 'superlative-banana': 0, 'superlative-apple': 0, 'superlative-elevation': 0, 'superlative-coastline': 0, 'superlative-forest': 0, 'superlative-oil': 0, 'superlative-rice': 0, 'superlative-coal': 0, 'superlative-sheep': 0, 'superlative-cattle': 0, 'superlative-beer': 0, 'superlative-tea': 0, 'superlative-sugarcane': 0, 'superlative-gold': 0, 'superlative-alcohol': 0, 'superlative-meat': 0, 'superlative-borders': 0, 'superlative-olive-oil': 0, 'superlative-honey': 0, 'superlative-temperature': 0, 'superlative-happiness': 0, 'superlative-corruption': 0, 'superlative-tourism': 0, 'superlative-electricity': 0,
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
  // Enough max-size segments to overshoot the total cap regardless of how the
  // per-mode / total constants are tuned. validatePlan doesn't dedupe modes, so
  // repeating a valid one is fine.
  const segments = Math.ceil(MAX_TOTAL_ROUNDS / MAX_ROUNDS_PER_MODE) + 1;
  const huge = Array.from({ length: segments }, () => (
    { poolId: 'sovereign', roundId: 'flagPick', rounds: MAX_ROUNDS_PER_MODE }
  ));
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

// ---- grouped setup: picture trio vs the world-metric family ----

test('PARTY_MODES: split into a fixed picture trio and the metric family', () => {
  assert.deepEqual(PICTURE_MODES.map((m) => m.id), ['flags-all', 'flags-territories', 'map-outlines']);
  assert.deepEqual(METRIC_MODES.map((m) => m.id), ['superlative-pop', 'superlative-area', 'superlative-density', 'superlative-gdp', 'superlative-gdppc', 'superlative-coffee', 'superlative-wine', 'superlative-cocoa', 'superlative-banana', 'superlative-apple', 'superlative-elevation', 'superlative-coastline', 'superlative-forest', 'superlative-oil', 'superlative-rice', 'superlative-coal', 'superlative-sheep', 'superlative-cattle', 'superlative-beer', 'superlative-tea', 'superlative-sugarcane', 'superlative-gold', 'superlative-alcohol', 'superlative-meat', 'superlative-borders', 'superlative-olive-oil', 'superlative-honey', 'superlative-temperature', 'superlative-happiness', 'superlative-corruption', 'superlative-tourism', 'superlative-electricity']);
  for (const m of PICTURE_MODES) assert.equal(m.group, 'picture');
  for (const m of METRIC_MODES) assert.equal(m.group, 'metric');
});

test('buildPartyPlan: each on picture mode is one BLOCK_ROUNDS block, off dropped', () => {
  const plan = buildPartyPlan({
    picture: {
      'flags-all': { on: true },
      'flags-territories': { on: false },
      'map-outlines': { on: true },
    },
    facts: { metrics: {} },
  });
  assert.deepEqual(plan, [
    { poolId: 'sovereign', roundId: 'flagPick', rounds: BLOCK_ROUNDS },
    { poolId: 'sovereign', roundId: 'mapPick', rounds: BLOCK_ROUNDS },
  ]);
});

test('buildPartyPlan: each enabled statistic is its own BLOCK_ROUNDS block', () => {
  const plan = buildPartyPlan({
    picture: { 'flags-all': { on: true } },
    facts: { metrics: { 'superlative-pop': true, 'superlative-coffee': true } },
  });
  assert.deepEqual(plan, [
    { poolId: 'sovereign', roundId: 'flagPick', rounds: BLOCK_ROUNDS },
    { poolId: 'sovereign', roundId: 'superlative', rounds: BLOCK_ROUNDS },       // population
    { poolId: 'sovereign', roundId: 'superlative-coffee', rounds: BLOCK_ROUNDS },
  ]);
  // three enabled modes = three whole blocks
  assert.equal(blockCount(plan), 3);
  // every stat block is one metric only (never mixed)
  for (const s of plan) assert.equal(s.rounds, BLOCK_ROUNDS);
});

test('buildPartyPlan: statistic blocks follow the catalog order, after the picture blocks', () => {
  const plan = buildPartyPlan({
    picture: { 'map-outlines': { on: true } },
    facts: { metrics: { 'superlative-area': true, 'superlative-pop': true } }, // pop precedes area in the catalog
  });
  assert.deepEqual(plan.map((s) => s.roundId), ['mapPick', 'superlative', 'superlative-area']);
});

test('buildPartyPlan: no metric enabled contributes no stat blocks', () => {
  const plan = buildPartyPlan({
    picture: { 'map-outlines': { on: true } },
    facts: { metrics: { 'superlative-pop': false } },
  });
  assert.deepEqual(plan, [{ poolId: 'sovereign', roundId: 'mapPick', rounds: BLOCK_ROUNDS }]);
});

test('buildPartyPlan: blockCount equals enabled picture modes + enabled statistics', () => {
  const plan = buildPartyPlan({
    picture: { 'flags-all': { on: true }, 'flags-territories': { on: true }, 'map-outlines': { on: false } },
    facts: { metrics: { 'superlative-pop': true, 'superlative-area': true, 'superlative-gdp': true } },
  });
  // 2 picture + 3 statistics = 5 blocks
  assert.equal(blockCount(plan), 5);
});

test('buildPartyPlan: output always survives validatePlan', () => {
  const plan = buildPartyPlan({
    picture: {
      'flags-all': { on: true },
      'flags-territories': { on: true },
      'map-outlines': { on: true },
    },
    facts: { metrics: { 'superlative-pop': true, 'superlative-area': true, 'superlative-density': true } },
  });
  const cleaned = validatePlan(plan);
  assert.ok(cleaned, 'built plan should validate');
  assert.equal(totalRounds(/** @type {any} */ (cleaned)), totalRounds(plan));
});

// ---- blocks (Iteration 8) ----

test('BLOCK_ROUNDS is 5', () => {
  assert.equal(BLOCK_ROUNDS, 5);
});

test('blockIndexForRound: 0-4 -> 0, 5-9 -> 1, 10-14 -> 2', () => {
  assert.deepEqual([0, 1, 4, 5, 9, 10, 14].map(blockIndexForRound), [0, 0, 0, 1, 1, 2, 2]);
});

test('blockCount: one block per 5 rounds, final short block rounds up', () => {
  const three = [{ poolId: 'sovereign', roundId: 'flagPick', rounds: 15 }];
  assert.equal(blockCount(three), 3);
  // three whole 5-round segments = 3 blocks
  assert.equal(blockCount([
    { poolId: 'sovereign', roundId: 'flagPick', rounds: 5 },
    { poolId: 'nonSovereign', roundId: 'flagPick', rounds: 5 },
    { poolId: 'sovereign', roundId: 'mapPick', rounds: 5 },
  ]), 3);
  // a stray short tail still counts as its own block
  assert.equal(blockCount([{ poolId: 'sovereign', roundId: 'flagPick', rounds: 7 }]), 2);
});

test('isBlockEnd: true at each 5-round boundary except the game\'s final round', () => {
  const plan = [{ poolId: 'sovereign', roundId: 'flagPick', rounds: 15 }]; // 3 blocks, 15 rounds
  const ends = [];
  for (let i = 0; i < totalRounds(plan); i++) if (isBlockEnd(plan, i)) ends.push(i);
  // breaks after round 4 (end of block 1) and round 9 (end of block 2), NOT round 14 (final board)
  assert.deepEqual(ends, [4, 9]);
});

test('isBlockEnd fires exactly blockCount - 1 times', () => {
  const plan = [{ poolId: 'sovereign', roundId: 'flagPick', rounds: 20 }]; // 4 blocks
  let breaks = 0;
  for (let i = 0; i < totalRounds(plan); i++) if (isBlockEnd(plan, i)) breaks++;
  assert.equal(breaks, blockCount(plan) - 1);
});

test('isBlockEnd: a single short block never breaks (nothing follows it)', () => {
  const plan = [{ poolId: 'sovereign', roundId: 'flagPick', rounds: 3 }];
  assert.equal(isBlockEnd(plan, 2), false);
});

test('isBlockBoundary: keyed on index + total, matches isBlockEnd for a plan', () => {
  const plan = [{ poolId: 'sovereign', roundId: 'flagPick', rounds: 15 }]; // 15 rounds
  for (let i = 0; i < 15; i++) {
    assert.equal(isBlockBoundary(i, 15), isBlockEnd(plan, i), `round ${i}`);
  }
  // the client's view: boundaries at 4 and 9, never at the final round 14
  assert.equal(isBlockBoundary(4, 15), true);
  assert.equal(isBlockBoundary(9, 15), true);
  assert.equal(isBlockBoundary(14, 15), false);
});

test('isBlockStart: true on the first round of block 2..N, never the opener', () => {
  // 15 rounds = 3 blocks; block starts are the first round of blocks 2 and 3.
  const starts = [];
  for (let i = 0; i < 15; i++) if (isBlockStart(i, 15)) starts.push(i);
  assert.deepEqual(starts, [5, 10]);
  // the opening block's first round (0) is play-start, not an announced switch
  assert.equal(isBlockStart(0, 15), false);
  // mid-block rounds are never starts
  assert.equal(isBlockStart(6, 15), false);
});

test('isBlockStart fires exactly blockCount - 1 times, mirroring isBlockBoundary', () => {
  for (const total of [5, 10, 15, 20, 25]) {
    let starts = 0;
    for (let i = 0; i < total; i++) if (isBlockStart(i, total)) starts++;
    assert.equal(starts, Math.ceil(total / 5) - 1, `total ${total}`);
  }
});

test('isBlockStart: a single-block game never announces a block', () => {
  assert.equal(isBlockStart(0, 5), false);
  for (let i = 0; i < 5; i++) assert.equal(isBlockStart(i, 5), false, `round ${i}`);
});

test('isFinalBlock: true only for rounds in the last block', () => {
  // 15 rounds = 3 blocks; the final block is rounds 10-14.
  for (let i = 0; i < 10; i++) assert.equal(isFinalBlock(i, 15), false, `round ${i}`);
  for (let i = 10; i < 15; i++) assert.equal(isFinalBlock(i, 15), true, `round ${i}`);
});

test('isFinalBlock: a single-block game has no final block (nothing to contrast)', () => {
  assert.equal(isFinalBlock(0, 5), false);
  assert.equal(isFinalBlock(4, 5), false);
  // two blocks: the second is the final one
  assert.equal(isFinalBlock(4, 10), false);
  assert.equal(isFinalBlock(5, 10), true);
});
