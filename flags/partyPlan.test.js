import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_PLAN,
  totalQuestions,
  poolIdAt,
  questionIdAt,
  PARTY_MODES,
  MAX_QUESTIONS_PER_MODE,
  MAX_TOTAL_QUESTIONS,
  countsForPlan,
  planFromModeCounts,
  validatePlan,
  PICTURE_MODES,
  METRIC_MODES,
  buildPartyPlan,
  ROUND_QUESTIONS,
  roundIndexAt,
  roundCount,
  isRoundEnd,
  isRoundBoundary,
  isRoundStart,
  isFinalRound,
} from './partyPlan.js';

test('DEFAULT_PLAN: 4 of each — sovereign flag, non-sovereign flag, sovereign map, superlative', () => {
  assert.deepEqual(DEFAULT_PLAN, [
    { poolId: 'sovereign', questionId: 'flagPick', questions: 4 },
    { poolId: 'nonSovereign', questionId: 'flagPick', questions: 4 },
    { poolId: 'sovereign', questionId: 'mapPick', questions: 4 },
    { poolId: 'sovereign', questionId: 'superlative', questions: 4 },
  ]);
  assert.equal(totalQuestions(DEFAULT_PLAN), 16);
});

test('poolIdAt: non-sovereign only for 4-7, sovereign elsewhere', () => {
  for (let i = 0; i <= 3; i++) assert.equal(poolIdAt(DEFAULT_PLAN, i), 'sovereign', `question ${i}`);
  for (let i = 4; i <= 7; i++) assert.equal(poolIdAt(DEFAULT_PLAN, i), 'nonSovereign', `question ${i}`);
  for (let i = 8; i <= 15; i++) assert.equal(poolIdAt(DEFAULT_PLAN, i), 'sovereign', `question ${i}`);
});

test('questionIdAt: flag-pick 0-7, map 8-11, superlative 12-15', () => {
  for (let i = 0; i <= 7; i++) assert.equal(questionIdAt(DEFAULT_PLAN, i), 'flagPick', `question ${i}`);
  for (let i = 8; i <= 11; i++) assert.equal(questionIdAt(DEFAULT_PLAN, i), 'mapPick', `question ${i}`);
  for (let i = 12; i <= 15; i++) assert.equal(questionIdAt(DEFAULT_PLAN, i), 'superlative', `question ${i}`);
});

test('past the end clamps to the last segment (pool and question)', () => {
  assert.equal(poolIdAt(DEFAULT_PLAN, 16), 'sovereign');
  assert.equal(questionIdAt(DEFAULT_PLAN, 99), 'superlative');
});

test('totalQuestions / poolIdAt / questionIdAt work for an arbitrary plan', () => {
  const plan = [
    { poolId: 'a', questionId: 'x', questions: 2 },
    { poolId: 'b', questionId: 'y', questions: 3 },
  ];
  assert.equal(totalQuestions(plan), 5);
  assert.equal(poolIdAt(plan, 0), 'a');
  assert.equal(questionIdAt(plan, 1), 'x');
  assert.equal(poolIdAt(plan, 2), 'b');
  assert.equal(questionIdAt(plan, 4), 'y');
});

// ---- mode catalog + host-configurable plans ----

test('PARTY_MODES: every DEFAULT_PLAN segment maps to a catalog mode', () => {
  for (const seg of DEFAULT_PLAN) {
    const m = PARTY_MODES.find((x) => x.questionId === seg.questionId && x.poolId === seg.poolId);
    assert.ok(m, `no catalog mode for ${seg.questionId}/${seg.poolId}`);
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
  const counts = countsForPlan([{ poolId: 'sovereign', questionId: 'mapPick', questions: 4 }]);
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
    { poolId: 'nonSovereign', questionId: 'flagPick', questions: 2 },
    { poolId: 'sovereign', questionId: 'mapPick', questions: MAX_QUESTIONS_PER_MODE },
  ]);
});

test('validatePlan: a clean plan passes through unchanged', () => {
  assert.deepEqual(validatePlan(DEFAULT_PLAN), DEFAULT_PLAN);
});

test('validatePlan: drops segments with an unknown mode or a bad count', () => {
  const dirty = [
    { poolId: 'sovereign', questionId: 'flagPick', questions: 2 },   // ok
    { poolId: 'sovereign', questionId: 'nopeQuestion', questions: 3 },  // unknown questionId
    { poolId: 'atlantis', questionId: 'flagPick', questions: 3 },    // unknown poolId
    { poolId: 'sovereign', questionId: 'mapPick', questions: 0 },    // count < 1
    { poolId: 'sovereign', questionId: 'mapPick', questions: 2.5 },  // non-integer
    { poolId: 'sovereign', questionId: 'mapPick', questions: 4 },    // ok
  ];
  assert.deepEqual(validatePlan(dirty), [
    { poolId: 'sovereign', questionId: 'flagPick', questions: 2 },
    { poolId: 'sovereign', questionId: 'mapPick', questions: 4 },
  ]);
});

test('validatePlan: caps the running total at MAX_TOTAL_QUESTIONS', () => {
  // Enough max-size segments to overshoot the total cap regardless of how the
  // per-mode / total constants are tuned. validatePlan doesn't dedupe modes, so
  // repeating a valid one is fine.
  const segments = Math.ceil(MAX_TOTAL_QUESTIONS / MAX_QUESTIONS_PER_MODE) + 1;
  const huge = Array.from({ length: segments }, () => (
    { poolId: 'sovereign', questionId: 'flagPick', questions: MAX_QUESTIONS_PER_MODE }
  ));
  const out = validatePlan(huge);
  assert.equal(totalQuestions(/** @type {any} */ (out)), MAX_TOTAL_QUESTIONS);
});

test('validatePlan: non-array, empty, or all-invalid input returns null', () => {
  assert.equal(validatePlan(null), null);
  assert.equal(validatePlan('nope'), null);
  assert.equal(validatePlan(undefined), null);
  assert.equal(validatePlan([]), null);
  assert.equal(validatePlan([{ poolId: 'x', questionId: 'y', questions: 3 }]), null);
});

// ---- grouped setup: picture trio vs the world-metric family ----

test('PARTY_MODES: split into a fixed picture trio and the metric family', () => {
  assert.deepEqual(PICTURE_MODES.map((m) => m.id), ['flags-all', 'flags-territories', 'map-outlines']);
  assert.deepEqual(METRIC_MODES.map((m) => m.id), ['superlative-pop', 'superlative-area', 'superlative-density', 'superlative-gdp', 'superlative-gdppc', 'superlative-coffee', 'superlative-wine', 'superlative-cocoa', 'superlative-banana', 'superlative-apple', 'superlative-elevation', 'superlative-coastline', 'superlative-forest', 'superlative-oil', 'superlative-rice', 'superlative-coal', 'superlative-sheep', 'superlative-cattle', 'superlative-beer', 'superlative-tea', 'superlative-sugarcane', 'superlative-gold', 'superlative-alcohol', 'superlative-meat', 'superlative-borders', 'superlative-olive-oil', 'superlative-honey', 'superlative-temperature', 'superlative-happiness', 'superlative-corruption', 'superlative-tourism', 'superlative-electricity']);
  for (const m of PICTURE_MODES) assert.equal(m.group, 'picture');
  for (const m of METRIC_MODES) assert.equal(m.group, 'metric');
});

test('buildPartyPlan: each on picture mode is one ROUND_QUESTIONS round, off dropped', () => {
  const plan = buildPartyPlan({
    picture: {
      'flags-all': { on: true },
      'flags-territories': { on: false },
      'map-outlines': { on: true },
    },
    facts: { metrics: {} },
  });
  assert.deepEqual(plan, [
    { poolId: 'sovereign', questionId: 'flagPick', questions: ROUND_QUESTIONS },
    { poolId: 'sovereign', questionId: 'mapPick', questions: ROUND_QUESTIONS },
  ]);
});

test('buildPartyPlan: each enabled statistic is its own ROUND_QUESTIONS round', () => {
  const plan = buildPartyPlan({
    picture: { 'flags-all': { on: true } },
    facts: { metrics: { 'superlative-pop': true, 'superlative-coffee': true } },
  });
  assert.deepEqual(plan, [
    { poolId: 'sovereign', questionId: 'flagPick', questions: ROUND_QUESTIONS },
    { poolId: 'sovereign', questionId: 'superlative', questions: ROUND_QUESTIONS },       // population
    { poolId: 'sovereign', questionId: 'superlative-coffee', questions: ROUND_QUESTIONS },
  ]);
  // three enabled modes = three whole rounds
  assert.equal(roundCount(plan), 3);
  // every stat round is one metric only (never mixed)
  for (const s of plan) assert.equal(s.questions, ROUND_QUESTIONS);
});

test('buildPartyPlan: statistic rounds follow the catalog order, after the picture rounds', () => {
  const plan = buildPartyPlan({
    picture: { 'map-outlines': { on: true } },
    facts: { metrics: { 'superlative-area': true, 'superlative-pop': true } }, // pop precedes area in the catalog
  });
  assert.deepEqual(plan.map((s) => s.questionId), ['mapPick', 'superlative', 'superlative-area']);
});

test('buildPartyPlan: no metric enabled contributes no stat rounds', () => {
  const plan = buildPartyPlan({
    picture: { 'map-outlines': { on: true } },
    facts: { metrics: { 'superlative-pop': false } },
  });
  assert.deepEqual(plan, [{ poolId: 'sovereign', questionId: 'mapPick', questions: ROUND_QUESTIONS }]);
});

test('buildPartyPlan: roundCount equals enabled picture modes + enabled statistics', () => {
  const plan = buildPartyPlan({
    picture: { 'flags-all': { on: true }, 'flags-territories': { on: true }, 'map-outlines': { on: false } },
    facts: { metrics: { 'superlative-pop': true, 'superlative-area': true, 'superlative-gdp': true } },
  });
  // 2 picture + 3 statistics = 5 rounds
  assert.equal(roundCount(plan), 5);
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
  assert.equal(totalQuestions(/** @type {any} */ (cleaned)), totalQuestions(plan));
});

// ---- rounds (Iteration 8) ----

test('ROUND_QUESTIONS is 5', () => {
  assert.equal(ROUND_QUESTIONS, 5);
});

test('roundIndexAt: 0-4 -> 0, 5-9 -> 1, 10-14 -> 2', () => {
  assert.deepEqual([0, 1, 4, 5, 9, 10, 14].map(roundIndexAt), [0, 0, 0, 1, 1, 2, 2]);
});

test('roundCount: one round per 5 questions, final short round questions up', () => {
  const three = [{ poolId: 'sovereign', questionId: 'flagPick', questions: 15 }];
  assert.equal(roundCount(three), 3);
  // three whole 5-question segments = 3 rounds
  assert.equal(roundCount([
    { poolId: 'sovereign', questionId: 'flagPick', questions: 5 },
    { poolId: 'nonSovereign', questionId: 'flagPick', questions: 5 },
    { poolId: 'sovereign', questionId: 'mapPick', questions: 5 },
  ]), 3);
  // a stray short tail still counts as its own round
  assert.equal(roundCount([{ poolId: 'sovereign', questionId: 'flagPick', questions: 7 }]), 2);
});

test('isRoundEnd: true at each 5-question boundary except the game\'s final question', () => {
  const plan = [{ poolId: 'sovereign', questionId: 'flagPick', questions: 15 }]; // 3 rounds, 15 questions
  const ends = [];
  for (let i = 0; i < totalQuestions(plan); i++) if (isRoundEnd(plan, i)) ends.push(i);
  // breaks after question 4 (end of round 1) and question 9 (end of round 2), NOT question 14 (final board)
  assert.deepEqual(ends, [4, 9]);
});

test('isRoundEnd fires exactly roundCount - 1 times', () => {
  const plan = [{ poolId: 'sovereign', questionId: 'flagPick', questions: 20 }]; // 4 rounds
  let breaks = 0;
  for (let i = 0; i < totalQuestions(plan); i++) if (isRoundEnd(plan, i)) breaks++;
  assert.equal(breaks, roundCount(plan) - 1);
});

test('isRoundEnd: a single short round never breaks (nothing follows it)', () => {
  const plan = [{ poolId: 'sovereign', questionId: 'flagPick', questions: 3 }];
  assert.equal(isRoundEnd(plan, 2), false);
});

test('isRoundBoundary: keyed on index + total, matches isRoundEnd for a plan', () => {
  const plan = [{ poolId: 'sovereign', questionId: 'flagPick', questions: 15 }]; // 15 questions
  for (let i = 0; i < 15; i++) {
    assert.equal(isRoundBoundary(i, 15), isRoundEnd(plan, i), `question ${i}`);
  }
  // the client's view: boundaries at 4 and 9, never at the final question 14
  assert.equal(isRoundBoundary(4, 15), true);
  assert.equal(isRoundBoundary(9, 15), true);
  assert.equal(isRoundBoundary(14, 15), false);
});

test('isRoundStart: true on the first question of every round, including the opener', () => {
  // 15 questions = 3 rounds; round starts are the first question of rounds 1, 2 and 3.
  const starts = [];
  for (let i = 0; i < 15; i++) if (isRoundStart(i, 15)) starts.push(i);
  assert.deepEqual(starts, [0, 5, 10]);
  // the opening round's first question (0) now gets the card too (the "get ready" beat)
  assert.equal(isRoundStart(0, 15), true);
  // mid-round questions are never starts
  assert.equal(isRoundStart(6, 15), false);
});

test('isRoundStart fires exactly roundCount times, one per round', () => {
  for (const total of [5, 10, 15, 20, 25]) {
    let starts = 0;
    for (let i = 0; i < total; i++) if (isRoundStart(i, total)) starts++;
    assert.equal(starts, Math.ceil(total / 5), `total ${total}`);
  }
});

test('isRoundStart: a single-round game still announces its one round at question 0', () => {
  assert.equal(isRoundStart(0, 5), true);
  for (let i = 1; i < 5; i++) assert.equal(isRoundStart(i, 5), false, `question ${i}`);
});

test('isFinalRound: true only for questions in the last round', () => {
  // 15 questions = 3 rounds; the final round is questions 10-14.
  for (let i = 0; i < 10; i++) assert.equal(isFinalRound(i, 15), false, `question ${i}`);
  for (let i = 10; i < 15; i++) assert.equal(isFinalRound(i, 15), true, `question ${i}`);
});

test('isFinalRound: a single-round game has no final round (nothing to contrast)', () => {
  assert.equal(isFinalRound(0, 5), false);
  assert.equal(isFinalRound(4, 5), false);
  // two rounds: the second is the final one
  assert.equal(isFinalRound(4, 10), false);
  assert.equal(isFinalRound(5, 10), true);
});
