const { test } = require('node:test');
const assert = require('node:assert/strict');

const { computeQuiz } = require('./quizCompute');

// Test-fixture pool sizes — kept distinct from the production map so
// fixture changes don't quietly mask real drift. Production sizes
// live in `dailyMe.js` and are pinned by `flags/countries.test.js`.
const POOL = {
  countries: 195,
  europe: 45,
  asia: 47,
  africa: 54,
  'north-america': 23,
  'south-america': 12,
  oceania: 14,
};

const ZERO = {
  quizAttempts60s: 0,
  quizVariantsTouched60s: 0,
  quizBestScore60s: 0,
  quiz60sClearedVariants: [],
};

test('null doc → empty result', () => {
  assert.deepEqual(computeQuiz(null, POOL), ZERO);
});

test('doc without `records` → empty result', () => {
  assert.deepEqual(computeQuiz({}, POOL), ZERO);
});

test('records map empty → empty result', () => {
  assert.deepEqual(computeQuiz({ records: {} }, POOL), ZERO);
});

test('endurance-mode (`all`) entries are ignored (this lib is 60s-only)', () => {
  const out = computeQuiz({
    records: {
      'europe:all:sov': { score: 50, attempts: 3 },
      'africa:all:sov': { score: 40, attempts: 2 },
    },
  }, POOL);
  assert.deepEqual(out, ZERO);
});

test('attempts sum across every 60s configKey, ignoring mode `all`', () => {
  const out = computeQuiz({
    records: {
      'europe:60s:sov': { score: 5, attempts: 3 },
      'europe:60s:all': { score: 4, attempts: 2 },
      'asia:60s:sov': { score: 10, attempts: 7 },
      'asia:all:sov': { score: 30, attempts: 99 }, // ignored
    },
  }, POOL);
  assert.equal(out.quizAttempts60s, 12);
});

test('variants touched counts distinct variant keys across both includeAll values', () => {
  const out = computeQuiz({
    records: {
      'europe:60s:sov': { score: 1, attempts: 1 },
      'europe:60s:all': { score: 2, attempts: 1 }, // same variant → counted once
      'asia:60s:sov': { score: 3, attempts: 1 },
      'africa:60s:all': { score: 4, attempts: 1 },
    },
  }, POOL);
  assert.equal(out.quizVariantsTouched60s, 3);
});

test('best score takes the max across every 60s configKey', () => {
  const out = computeQuiz({
    records: {
      'europe:60s:sov': { score: 10, attempts: 1 },
      'asia:60s:sov': { score: 25, attempts: 1 },
      'africa:60s:all': { score: 22, attempts: 1 },
    },
  }, POOL);
  assert.equal(out.quizBestScore60s, 25);
});

test('cleared: score >= sov pool size → variant qualifies regardless of which includeAll variant was played', () => {
  const out = computeQuiz({
    records: {
      // Cleared Oceania (14) via the all-pool play
      'oceania:60s:all': { score: 14, attempts: 1 },
      // Cleared SA (12) via sov-pool play
      'south-america:60s:sov': { score: 12, attempts: 1 },
      // Almost-cleared Europe (44 < 45)
      'europe:60s:sov': { score: 44, attempts: 1 },
    },
  }, POOL);
  assert.deepEqual(out.quiz60sClearedVariants, ['oceania', 'south-america']);
});

test('cleared: best across includeAll is what counts (sov play below threshold + all play at threshold → cleared)', () => {
  const out = computeQuiz({
    records: {
      'oceania:60s:sov': { score: 13, attempts: 1 }, // below threshold
      'oceania:60s:all': { score: 14, attempts: 1 }, // meets threshold
    },
  }, POOL);
  assert.deepEqual(out.quiz60sClearedVariants, ['oceania']);
});

test('cleared variants returned in sorted order (deterministic for downstream consumers)', () => {
  const out = computeQuiz({
    records: {
      'south-america:60s:sov': { score: 12, attempts: 1 },
      'oceania:60s:sov': { score: 14, attempts: 1 },
      'asia:60s:sov': { score: 47, attempts: 1 },
    },
  }, POOL);
  assert.deepEqual(out.quiz60sClearedVariants, ['asia', 'oceania', 'south-america']);
});

test('cleared: a variant not in the pool-size map is silently skipped (drift safety net)', () => {
  const out = computeQuiz({
    records: {
      'atlantis:60s:sov': { score: 999, attempts: 1 },
      'oceania:60s:sov': { score: 14, attempts: 1 },
    },
  }, POOL);
  // Unknown variant doesn't crash; known variant still qualifies.
  assert.deepEqual(out.quiz60sClearedVariants, ['oceania']);
});

test('malformed configKey (wrong segment count) is skipped, not crashed', () => {
  const out = computeQuiz({
    records: {
      'bad-key': { score: 100, attempts: 5 },
      'europe:60s:sov': { score: 10, attempts: 1 },
    },
  }, POOL);
  assert.equal(out.quizAttempts60s, 1);
  assert.equal(out.quizBestScore60s, 10);
});

test('non-numeric score is ignored for best/cleared, but attempts still counts', () => {
  const out = computeQuiz({
    records: {
      'europe:60s:sov': { score: 'oops', attempts: 3 },
    },
  }, POOL);
  assert.equal(out.quizAttempts60s, 3);
  assert.equal(out.quizBestScore60s, 0);
  assert.deepEqual(out.quiz60sClearedVariants, []);
});

test('full snapshot: every counter fires, every variant cleared', () => {
  const out = computeQuiz({
    records: {
      'countries:60s:sov':     { score: 200, attempts: 10 },
      'europe:60s:sov':        { score: 45,  attempts: 10 },
      'asia:60s:sov':          { score: 47,  attempts: 10 },
      'africa:60s:sov':        { score: 54,  attempts: 10 },
      'north-america:60s:sov': { score: 23,  attempts: 10 },
      'south-america:60s:sov': { score: 12,  attempts: 10 },
      'oceania:60s:sov':       { score: 14,  attempts: 10 },
    },
  }, POOL);
  assert.equal(out.quizAttempts60s, 70);
  assert.equal(out.quizVariantsTouched60s, 7);
  assert.equal(out.quizBestScore60s, 200);
  assert.deepEqual(out.quiz60sClearedVariants.sort(), [
    'africa', 'asia', 'countries', 'europe', 'north-america', 'oceania', 'south-america',
  ]);
});
