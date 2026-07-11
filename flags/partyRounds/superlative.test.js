import { test } from 'node:test';
import assert from 'node:assert/strict';
import population from '../metrics/population.json' with { type: 'json' };
import { id, generate, isCorrect } from './superlative.js';

/** Raw value map so the test can judge extremes independently of the module. */
const POP = /** @type {Record<string, number>} */ (population.values);

/** A pool of well-populated sovereigns, all present in population.json. */
const POOL = ['cn', 'in', 'us', 'id', 'pk', 'ng', 'br', 'bd', 'ru', 'jp', 'mx', 'de']
  .map((code) => ({ code }));

/**
 * A tiny seeded RNG so the draws are deterministic in tests.
 * @param {number} seed
 * @returns {() => number}
 */
function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

test('id is stable', () => {
  assert.equal(id, 'superlative');
});

test('generate: four distinct options, answer among them, prompt is a direction', () => {
  for (let i = 0; i < 100; i++) {
    const q = generate(POOL, undefined, seeded(i + 1));
    assert.equal(q.options.length, 4);
    assert.equal(new Set(q.options).size, 4, 'options are distinct');
    assert.ok(q.options.includes(q.answer), 'the answer is among the options');
    assert.ok(q.prompt === 'most' || q.prompt === 'least', `bad prompt ${q.prompt}`);
  }
});

test('generate: the answer is the strict extreme of the four in the stated direction', () => {
  for (let i = 0; i < 200; i++) {
    const q = generate(POOL, undefined, seeded(i + 500));
    const values = q.options.map((c) => POP[c]);
    const target = q.prompt === 'most' ? Math.max(...values) : Math.min(...values);
    // strict: exactly one option holds the extreme value, and it is the answer
    assert.equal(values.filter((v) => v === target).length, 1, 'extreme is unambiguous');
    assert.equal(POP[q.answer], target, `answer is not the ${q.prompt} populous`);
  }
});

test('generate: both directions occur across seeds (the most/least coin-flip)', () => {
  const seen = new Set();
  // Spread the seeds (MINSTD multiplier) so the first RNG draw — which decides
  // the direction — lands on both sides of 0.5; sequential seeds happen to share
  // a band and would only ever show one direction.
  for (let i = 0; i < 200 && seen.size < 2; i++) seen.add(generate(POOL, undefined, seeded(i * 16807 + 1)).prompt);
  assert.equal(seen.size, 2, 'saw both most and least');
});

test('generate: only draws codes that carry a population value', () => {
  const pool = [...POOL, { code: 'zz' }, { code: 'aq' }]; // aq (Antarctica) is omitted from population.json
  for (let i = 0; i < 100; i++) {
    const q = generate(pool, undefined, seeded(i + 900));
    for (const code of q.options) {
      assert.ok(Object.prototype.hasOwnProperty.call(POP, code), `${code} has no population value`);
    }
  }
});

test('generate: honours the exclude set so a game does not repeat a country', () => {
  const exclude = new Set(['cn', 'in', 'us', 'id']); // 8 of 12 remain, above the 4 needed
  for (let i = 0; i < 100; i++) {
    const q = generate(POOL, exclude, seeded(i + 1300));
    assert.ok(!exclude.has(q.answer), `answer ${q.answer} was already used`);
  }
});

test('generate: falls back to the full valued set when exclude would starve it', () => {
  const exclude = new Set(POOL.map((c) => c.code)); // everything excluded
  const q = generate(POOL, exclude, seeded(7)); // must not throw
  assert.equal(q.options.length, 4);
});

test('generate: deterministic under a seeded rng', () => {
  const a = generate(POOL, undefined, seeded(42));
  const b = generate(POOL, undefined, seeded(42));
  assert.deepEqual(a, b);
});

test('isCorrect: only the answer code is correct', () => {
  const q = { prompt: /** @type {'most'} */ ('most'), options: ['cn', 'in', 'us', 'de'], answer: 'cn' };
  assert.equal(isCorrect(q, 'cn'), true);
  assert.equal(isCorrect(q, 'in'), false);
  assert.equal(isCorrect(q, 'zz'), false);
});

// ---- area instance (the km² twin, id 'superlative-area') --------------------

test('areaRound: id and a correct extreme-by-area answer', async () => {
  const { areaRound } = await import('./superlative.js');
  const areaJson = (await import('../metrics/area.json', { with: { type: 'json' } })).default;
  const AREA = /** @type {Record<string, number>} */ (areaJson.values);
  assert.equal(areaRound.id, 'superlative-area');
  // Large, area-distinct sovereigns, all present in area.json.
  const pool = ['ru', 'ca', 'cn', 'us', 'br', 'au', 'in', 'ar', 'kz', 'dz', 'mn', 'nl'].map((code) => ({ code }));
  for (let i = 0; i < 100; i++) {
    const q = areaRound.generate(pool, undefined, seeded(i + 1));
    assert.equal(q.options.length, 4);
    assert.ok(q.options.includes(q.answer), 'answer among options');
    const vals = q.options.map((c) => AREA[c]);
    const extreme = q.prompt === 'most' ? Math.max(...vals) : Math.min(...vals);
    assert.equal(AREA[q.answer], extreme, `seed ${i}: answer must be the ${q.prompt}-area option`);
  }
});

// ---- density instance (people per km², id 'superlative-density') ------------

test('densityRound: id and a correct extreme-by-density answer', async () => {
  const { densityRound } = await import('./superlative.js');
  const densityJson = (await import('../metrics/density.json', { with: { type: 'json' } })).default;
  const DENSITY = /** @type {Record<string, number>} */ (densityJson.values);
  assert.equal(densityRound.id, 'superlative-density');
  // Density-distinct sovereigns spanning ~4 orders of magnitude, all in density.json.
  const pool = ['mc', 'sg', 'bd', 'nl', 'mn', 'au', 'ca', 'ru', 'na', 'kz', 'in', 'jp'].map((code) => ({ code }));
  for (let i = 0; i < 100; i++) {
    const q = densityRound.generate(pool, undefined, seeded(i + 1));
    assert.equal(q.options.length, 4);
    assert.ok(q.options.includes(q.answer), 'answer among options');
    const vals = q.options.map((c) => DENSITY[c]);
    const extreme = q.prompt === 'most' ? Math.max(...vals) : Math.min(...vals);
    assert.equal(DENSITY[q.answer], extreme, `seed ${i}: answer must be the ${q.prompt}-density option`);
  }
});
