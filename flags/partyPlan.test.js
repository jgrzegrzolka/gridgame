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
  distributeWorldFacts,
  buildPartyPlan,
} from './partyPlan.js';

/** Small seeded LCG so the shuffle-based helpers are deterministic in tests.
 *  @param {number} seed */
function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

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
    'flags-all': 4, 'flags-territories': 4, 'map-outlines': 4, 'superlative-pop': 4, 'superlative-area': 0, 'superlative-density': 0, 'superlative-gdp': 0, 'superlative-gdppc': 0, 'superlative-coffee': 0, 'superlative-wine': 0, 'superlative-cocoa': 0, 'superlative-banana': 0, 'superlative-apple': 0, 'superlative-elevation': 0, 'superlative-coastline': 0, 'superlative-forest': 0, 'superlative-oil': 0,
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

// ---- grouped setup: picture trio vs the world-metric family ----

test('PARTY_MODES: split into a fixed picture trio and the metric family', () => {
  assert.deepEqual(PICTURE_MODES.map((m) => m.id), ['flags-all', 'flags-territories', 'map-outlines']);
  assert.deepEqual(METRIC_MODES.map((m) => m.id), ['superlative-pop', 'superlative-area', 'superlative-density', 'superlative-gdp', 'superlative-gdppc', 'superlative-coffee', 'superlative-wine', 'superlative-cocoa', 'superlative-banana', 'superlative-apple', 'superlative-elevation', 'superlative-coastline', 'superlative-forest', 'superlative-oil']);
  for (const m of PICTURE_MODES) assert.equal(m.group, 'picture');
  for (const m of METRIC_MODES) assert.equal(m.group, 'metric');
});

test('distributeWorldFacts: no metrics or n<=0 yields []', () => {
  assert.deepEqual(distributeWorldFacts(4, [], seeded(1)), []);
  assert.deepEqual(distributeWorldFacts(0, ['superlative-pop'], seeded(1)), []);
  assert.deepEqual(distributeWorldFacts(-3, ['superlative-pop'], seeded(1)), []);
});

test('distributeWorldFacts: deals exactly n rounds, only from enabled metrics', () => {
  const deal = distributeWorldFacts(7, ['superlative-pop', 'superlative-area'], seeded(42));
  assert.equal(deal.length, 7);
  for (const id of deal) assert.ok(['superlative-pop', 'superlative-area'].includes(id));
});

test('distributeWorldFacts: balances the deal (counts differ by at most one)', () => {
  const deal = distributeWorldFacts(7, ['superlative-pop', 'superlative-area', 'superlative-density'], seeded(7));
  /** @type {Record<string, number>} */
  const counts = {};
  for (const id of deal) counts[id] = (counts[id] || 0) + 1;
  const vals = Object.values(counts);
  assert.equal(vals.reduce((a, b) => a + b, 0), 7);
  assert.ok(Math.max(...vals) - Math.min(...vals) <= 1, `unbalanced: ${JSON.stringify(counts)}`);
  // 6 across 3 is a perfect 2/2/2
  const even = distributeWorldFacts(6, ['superlative-pop', 'superlative-area', 'superlative-density'], seeded(3));
  /** @type {Record<string, number>} */
  const c2 = {};
  for (const id of even) c2[id] = (c2[id] || 0) + 1;
  assert.deepEqual(Object.values(c2).sort(), [2, 2, 2]);
});

test('distributeWorldFacts: drops unknown / non-metric ids', () => {
  const deal = distributeWorldFacts(4, ['superlative-pop', 'flags-all', 'nope'], seeded(9));
  assert.equal(deal.length, 4);
  for (const id of deal) assert.equal(id, 'superlative-pop');
});

test('distributeWorldFacts: deterministic under a seeded rng', () => {
  const a = distributeWorldFacts(6, ['superlative-pop', 'superlative-area', 'superlative-density'], seeded(123));
  const b = distributeWorldFacts(6, ['superlative-pop', 'superlative-area', 'superlative-density'], seeded(123));
  assert.deepEqual(a, b);
});

test('buildPartyPlan: picture modes become one segment each, off/zero dropped', () => {
  const plan = buildPartyPlan({
    picture: {
      'flags-all': { on: true, n: 3 },
      'flags-territories': { on: false, n: 2 },
      'map-outlines': { on: true, n: 4 },
    },
    facts: { on: false, n: 4, metrics: {} },
  }, seeded(1));
  assert.deepEqual(plan, [
    { poolId: 'sovereign', roundId: 'flagPick', rounds: 3 },
    { poolId: 'sovereign', roundId: 'mapPick', rounds: 4 },
  ]);
});

test('buildPartyPlan: world-facts expands to n one-round metric segments', () => {
  const plan = buildPartyPlan({
    picture: { 'flags-all': { on: true, n: 2 } },
    facts: { on: true, n: 5, metrics: { 'superlative-pop': true, 'superlative-area': true } },
  }, seeded(5));
  assert.equal(totalRounds(plan), 7); // 2 flag + 5 facts
  const factsSegs = plan.filter((s) => s.roundId.startsWith('superlative'));
  assert.equal(factsSegs.reduce((sum, s) => sum + s.rounds, 0), 5);
  for (const s of factsSegs) {
    assert.equal(s.rounds, 1);
    assert.ok(['superlative', 'superlative-area'].includes(s.roundId));
  }
});

test('buildPartyPlan: facts on but no metric enabled contributes nothing', () => {
  const plan = buildPartyPlan({
    picture: { 'map-outlines': { on: true, n: 3 } },
    facts: { on: true, n: 4, metrics: { 'superlative-pop': false } },
  }, seeded(2));
  assert.deepEqual(plan, [{ poolId: 'sovereign', roundId: 'mapPick', rounds: 3 }]);
});

test('buildPartyPlan: output always survives validatePlan', () => {
  const plan = buildPartyPlan({
    picture: {
      'flags-all': { on: true, n: 3 },
      'flags-territories': { on: true, n: 2 },
      'map-outlines': { on: true, n: 2 },
    },
    facts: { on: true, n: 4, metrics: { 'superlative-pop': true, 'superlative-area': true, 'superlative-density': true } },
  }, seeded(11));
  const cleaned = validatePlan(plan);
  assert.ok(cleaned, 'built plan should validate');
  assert.equal(totalRounds(/** @type {any} */ (cleaned)), totalRounds(plan));
});

test('buildPartyPlan: deterministic under a seeded rng', () => {
  const setup = {
    picture: { 'flags-all': { on: true, n: 2 } },
    facts: { on: true, n: 6, metrics: { 'superlative-pop': true, 'superlative-area': true, 'superlative-density': true } },
  };
  assert.deepEqual(buildPartyPlan(setup, seeded(99)), buildPartyPlan(setup, seeded(99)));
});
