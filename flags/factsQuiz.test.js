import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createFactsQuiz } from './factsQuiz.js';
import { SUPERLATIVE_METRICS, superlativeMetricByKey } from './partyQuestions/superlativeCatalog.js';

/** Deterministic rng so a failure is reproducible. @param {number} seed */
function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

/**
 * A metric whose values are powers of ten over the given codes, so every quartet
 * has an unambiguous extreme and the GAP_RATIO gate is always satisfied.
 * @param {string} key
 * @param {string[]} codes
 * @param {Partial<import('./metrics.js').MetricData>} [over]
 */
function metricOver(key, codes, over = {}) {
  /** @type {Record<string, number>} */
  const values = {};
  codes.forEach((c, i) => { values[c] = 10 ** (i + 1); });
  return { key, label: key, unit: 'x', source: 'test', year: 2026, values, ...over };
}

const CODES = ['aa', 'bb', 'cc', 'dd', 'ee', 'ff', 'gg', 'hh', 'ii', 'jj', 'kk', 'll'];
/** @type {any[]} */
const POOL = CODES.map((code) => ({ code, name: code.toUpperCase(), continent: 'Europe' }));

/** @param {string[]} keys */
function loaded(keys) {
  return keys.map((k) => {
    const entry = superlativeMetricByKey(k);
    assert.ok(entry, `no catalog entry for ${k}`);
    return { entry, data: metricOver(k, CODES) };
  });
}

test('with no limit the deck never runs dry — nothing to exhaust', () => {
  const quiz = createFactsQuiz({ metrics: loaded(['population']), pool: POOL, rng: seeded(1) });
  for (let i = 0; i < 400; i++) {
    assert.ok(quiz.next(), 'unbounded facts must keep generating');
  }
});

test('a `limit` ends the round after exactly that many questions', () => {
  // The count-mode contract. `flagQuiz/page.js` ends a round when `next()`
  // returns null and has no other stopping condition, so without this an
  // untimed 20-question round would run forever — which is why the deck had no
  // untimed mode at all before the limit existed.
  const quiz = createFactsQuiz({ metrics: loaded(['population']), pool: POOL, rng: seeded(3), limit: 20 });
  for (let i = 0; i < 20; i++) {
    assert.ok(quiz.next(), `question ${i + 1} of 20 must be served`);
  }
  assert.equal(quiz.next(), null, 'the 21st question ends the round');
  assert.equal(quiz.next(), null, 'and it stays ended');
});

test('`peek` stops warming flags once the last question has been served', () => {
  // peek() drives the image prefetch. Warming a 21st question we will never
  // render would be a wasted request on the exact frame the result screen
  // wants the network.
  const quiz = createFactsQuiz({ metrics: loaded(['population']), pool: POOL, rng: seeded(4), limit: 3 });
  assert.ok(quiz.peek(), 'the first question is warm before it is served');
  quiz.next();
  quiz.next();
  assert.ok(quiz.peek(), 'question 3 is still coming');
  quiz.next();
  assert.equal(quiz.peek(), null, 'nothing left to warm');
});

test('`total` reports the round length when bounded, so the progress bar has a real denominator', () => {
  const bounded = createFactsQuiz({ metrics: loaded(['population']), pool: POOL, rng: seeded(5), limit: 20 });
  assert.equal(bounded.total, 20);
});

test('a question offers four distinct countries with the answer among them', () => {
  const quiz = createFactsQuiz({ metrics: loaded(['population']), pool: POOL, rng: seeded(1) });
  for (let i = 0; i < 30; i++) {
    const q = quiz.next();
    assert.ok(q, 'facts must never run dry — it has nothing to exhaust');
    assert.equal(q.choices.length, 4);
    assert.equal(new Set(q.choices.map((c) => c.code)).size, 4, 'choices are distinct');
    assert.ok(q.choices.some((c) => c.code === q.answer.code), 'the answer is on the board');
  }
});

test('the answer really is the extreme of the four, in the stated direction', () => {
  const data = metricOver('population', CODES);
  const entry = superlativeMetricByKey('population');
  assert.ok(entry);
  const quiz = createFactsQuiz({ metrics: [{ entry, data }], pool: POOL, rng: seeded(7) });
  for (let i = 0; i < 50; i++) {
    const q = /** @type {any} */ (quiz.next());
    const vals = q.choices.map((/** @type {any} */ c) => data.values[c.code]);
    const want = q.prompt.direction === 'most' ? Math.max(...vals) : Math.min(...vals);
    assert.equal(data.values[q.answer.code], want,
      `answer must be the ${q.prompt.direction} option`);
  }
});

// The whole reason this deck routes through the catalog rather than ranking the
// metric itself. A locked metric asked "least" is the silent-wrong-question bug.
test('a direction-locked metric is only ever asked in its locked direction', () => {
  const coffee = superlativeMetricByKey('coffee');
  assert.ok(coffee);
  assert.equal(coffee.direction, 'most');
  const quiz = createFactsQuiz({
    metrics: [{ entry: coffee, data: metricOver('coffee', CODES) }], pool: POOL, rng: seeded(3),
  });
  for (let i = 0; i < 40; i++) {
    const q = /** @type {any} */ (quiz.next());
    assert.equal(q.prompt.direction, 'most', 'coffee is most-only');
    assert.equal(q.prompt.hint.fallback, 'Largest coffee production');
  }
});

test('a two-directional metric asks both ways, with the matching label', () => {
  const forest = superlativeMetricByKey('forest');
  assert.ok(forest);
  const quiz = createFactsQuiz({
    metrics: [{ entry: forest, data: metricOver('forest', CODES) }], pool: POOL, rng: seeded(5),
  });
  const seen = new Set();
  for (let i = 0; i < 60; i++) {
    const q = /** @type {any} */ (quiz.next());
    seen.add(q.prompt.direction);
    // The label must match the direction actually asked — showing "Most
    // forested" over a "least" question is the mis-scoring failure.
    assert.equal(q.prompt.hint.fallback,
      q.prompt.direction === 'most' ? 'Most forested' : 'Least forested');
  }
  assert.deepEqual([...seen].sort(), ['least', 'most'], 'both directions get dealt');
});

// The catalog's zero-filter has to reach the deck, or "least forested" starts
// drawing quartets tied at 0.0% — a question with no answer.
test('a zero-filtered metric never offers a real zero', () => {
  const forest = superlativeMetricByKey('forest');
  assert.ok(forest);
  assert.equal(forest.zeroFiltered, true);
  const data = metricOver('forest', CODES);
  // Half the pool is treeless.
  const treeless = ['gg', 'hh', 'ii', 'jj', 'kk', 'll'];
  for (const c of treeless) data.values[c] = 0;
  const quiz = createFactsQuiz({ metrics: [{ entry: forest, data }], pool: POOL, rng: seeded(11) });
  for (let i = 0; i < 60; i++) {
    const q = /** @type {any} */ (quiz.next());
    for (const c of q.choices) {
      assert.ok(!treeless.includes(c.code), `zero-valued ${c.code} was offered`);
    }
  }
});

test('a sparse metric only offers countries it has a value for', () => {
  const coffee = superlativeMetricByKey('coffee');
  assert.ok(coffee);
  const growers = ['aa', 'bb', 'cc', 'dd', 'ee'];
  const data = metricOver('coffee', growers); // the other seven have no value
  const quiz = createFactsQuiz({ metrics: [{ entry: coffee, data }], pool: POOL, rng: seeded(13) });
  for (let i = 0; i < 40; i++) {
    const q = /** @type {any} */ (quiz.next());
    for (const c of q.choices) assert.ok(growers.includes(c.code), `${c.code} has no coffee value`);
  }
});

test('peek shows the next question without consuming it', () => {
  const quiz = createFactsQuiz({ metrics: loaded(['population']), pool: POOL, rng: seeded(2) });
  const peeked = quiz.peek();
  assert.deepEqual(quiz.peek(), peeked, 'peek is idempotent');
  assert.deepEqual(quiz.next(), peeked, 'next returns what peek showed');
  assert.notDeepEqual(quiz.peek(), peeked, 'and then peek moves on');
});

test('metrics are drawn without replacement, so a run spreads across the catalog', () => {
  // Three metrics, nine questions: each must come up exactly three times. A
  // naive per-question random pick would let one metric dominate a 60s run.
  const metrics = loaded(['population', 'area', 'forest']);
  const quiz = createFactsQuiz({ metrics, pool: POOL, rng: seeded(17) });
  /** @type {Record<string, number>} */
  const counts = {};
  for (let i = 0; i < 9; i++) {
    const q = /** @type {any} */ (quiz.next());
    counts[q.prompt.metricKey] = (counts[q.prompt.metricKey] || 0) + 1;
  }
  assert.deepEqual(counts, { population: 3, area: 3, forest: 3 });
});

test('a country does not repeat as the answer within a short stretch', () => {
  const quiz = createFactsQuiz({ metrics: loaded(['population']), pool: POOL, rng: seeded(19) });
  const answers = [];
  for (let i = 0; i < 8; i++) answers.push(/** @type {any} */ (quiz.next()).answer.code);
  assert.equal(new Set(answers).size, answers.length, 'no repeat inside the recent window');
});

test('the prompt carries the metric identity the icon and hue key off', () => {
  const quiz = createFactsQuiz({ metrics: loaded(['forest']), pool: POOL, rng: seeded(23) });
  const q = /** @type {any} */ (quiz.next());
  assert.equal(q.prompt.metricKey, 'forest');
  assert.equal(q.prompt.questionId, 'superlative-forest');
});

test('it refuses to build without metrics or with too small a pool', () => {
  assert.throws(() => createFactsQuiz({ metrics: [], pool: POOL }), /no metrics/);
  assert.throws(
    () => createFactsQuiz({ metrics: loaded(['population']), pool: POOL.slice(0, 3) }),
    /at least 4/,
  );
});

test('addToCabinet is accepted and inert — Facts has no pool to exhaust', () => {
  const quiz = createFactsQuiz({ metrics: loaded(['population']), pool: POOL, rng: seeded(29) });
  const q = /** @type {any} */ (quiz.next());
  quiz.addToCabinet(q.answer);
  // The page calls this on a wrong answer in 60s mode; it must not throw, and it
  // must not change what comes next.
  const peeked = quiz.peek();
  assert.deepEqual(quiz.next(), peeked);
});

test('every catalog metric can build a question', () => {
  // A metric whose values file the deck can't rank would surface as a dead round
  // only for players unlucky enough to draw it.
  for (const entry of SUPERLATIVE_METRICS) {
    const quiz = createFactsQuiz({
      metrics: [{ entry, data: metricOver(entry.key, CODES) }], pool: POOL, rng: seeded(31),
    });
    const q = quiz.next();
    assert.ok(q, `${entry.key}: produced no question`);
    assert.equal(q.choices.length, 4, `${entry.key}: not four choices`);
    assert.ok(q.prompt.hint.fallback.length > 0, `${entry.key}: no criterion label`);
  }
});
