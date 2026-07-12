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

// ---- gdp instance (total economy in US$, id 'superlative-gdp') --------------

test('gdpRound: id and a correct extreme-by-gdp answer', async () => {
  const { gdpRound } = await import('./superlative.js');
  const gdpJson = (await import('../metrics/gdp.json', { with: { type: 'json' } })).default;
  const GDP = /** @type {Record<string, number>} */ (gdpJson.values);
  assert.equal(gdpRound.id, 'superlative-gdp');
  // GDP-distinct sovereigns spanning many orders of magnitude, all in gdp.json.
  const pool = ['us', 'cn', 'jp', 'de', 'in', 'br', 'ng', 'gh', 'is', 'fj', 'to', 'ws'].map((code) => ({ code }));
  for (let i = 0; i < 100; i++) {
    const q = gdpRound.generate(pool, undefined, seeded(i + 1));
    assert.equal(q.options.length, 4);
    assert.ok(q.options.includes(q.answer), 'answer among options');
    const vals = q.options.map((c) => GDP[c]);
    const extreme = q.prompt === 'most' ? Math.max(...vals) : Math.min(...vals);
    assert.equal(GDP[q.answer], extreme, `seed ${i}: answer must be the ${q.prompt}-gdp option`);
  }
});

// ---- gdp-per-capita instance (US$ per head, id 'superlative-gdppc') ---------

test('gdpPerCapitaRound: id and a correct extreme-by-gdp-per-capita answer', async () => {
  const { gdpPerCapitaRound } = await import('./superlative.js');
  const pcJson = (await import('../metrics/gdpPerCapita.json', { with: { type: 'json' } })).default;
  const PC = /** @type {Record<string, number>} */ (pcJson.values);
  assert.equal(gdpPerCapitaRound.id, 'superlative-gdppc');
  // Per-capita-distinct sovereigns spanning ~3 orders of magnitude, all in gdpPerCapita.json.
  const pool = ['lu', 'no', 'us', 'de', 'cn', 'in', 'ng', 'et', 'bi', 'mw', 'cd', 'ne'].map((code) => ({ code }));
  for (let i = 0; i < 100; i++) {
    const q = gdpPerCapitaRound.generate(pool, undefined, seeded(i + 1));
    assert.equal(q.options.length, 4);
    assert.ok(q.options.includes(q.answer), 'answer among options');
    const vals = q.options.map((c) => PC[c]);
    const extreme = q.prompt === 'most' ? Math.max(...vals) : Math.min(...vals);
    assert.equal(PC[q.answer], extreme, `seed ${i}: answer must be the ${q.prompt}-per-capita option`);
  }
});

// ---- coffee instance (green-coffee tonnes, id 'superlative-coffee') ---------

test('coffeeRound: biggest-only, correct extreme-by-coffee answer, growers only', async () => {
  const { coffeeRound } = await import('./superlative.js');
  const coffeeJson = (await import('../metrics/coffee.json', { with: { type: 'json' } })).default;
  const COF = /** @type {Record<string, number>} */ (coffeeJson.values);
  assert.equal(coffeeRound.id, 'superlative-coffee');
  // Coffee-distinct sovereign GROWERS spanning many orders of magnitude, all in
  // coffee.json. A non-grower (e.g. Germany) mixed in must be dropped by the
  // round's `metric.has` filter, never appear as an option.
  const pool = ['br', 'vn', 'co', 'et', 'in', 'mx', 'pe', 'gt', 'cu', 'th', 'rw', 'bo', 'de'].map((code) => ({ code }));
  for (let i = 0; i < 100; i++) {
    const q = coffeeRound.generate(pool, undefined, seeded(i + 1));
    assert.equal(q.options.length, 4);
    // Coffee is locked to 'most' — "smallest grower" is an obscure question, so
    // it's never dealt (Jan). Every round asks for the biggest producer.
    assert.equal(q.prompt, 'most', `seed ${i}: coffee is biggest-only, never 'least'`);
    assert.ok(q.options.includes(q.answer), 'answer among options');
    assert.ok(!q.options.includes('de'), 'a non-grower is never an option (sparse metric.has filter)');
    const vals = q.options.map((c) => COF[c]);
    assert.equal(COF[q.answer], Math.max(...vals), `seed ${i}: answer must be the biggest-coffee option`);
  }
});

// ---- wine instance (wine tonnes, id 'superlative-wine') ---------------------

test('wineRound: biggest-only, correct extreme-by-wine answer, makers only', async () => {
  const { wineRound } = await import('./superlative.js');
  const wineJson = (await import('../metrics/wine.json', { with: { type: 'json' } })).default;
  const WIN = /** @type {Record<string, number>} */ (wineJson.values);
  assert.equal(wineRound.id, 'superlative-wine');
  // Wine-distinct sovereign MAKERS spanning many orders of magnitude, all in
  // wine.json. A non-maker (e.g. Afghanistan) mixed in must be dropped by the
  // round's `metric.has` filter, never appear as an option.
  const pool = ['fr', 'it', 'es', 'us', 'cn', 'cl', 'au', 'za', 'ar', 'pt', 'de', 'af'].map((code) => ({ code }));
  for (let i = 0; i < 100; i++) {
    const q = wineRound.generate(pool, undefined, seeded(i + 1));
    assert.equal(q.options.length, 4);
    // Wine is locked to 'most'; "smallest maker" is an obscure question, so
    // it's never dealt. Every round asks for the biggest producer.
    assert.equal(q.prompt, 'most', `seed ${i}: wine is biggest-only, never 'least'`);
    assert.ok(q.options.includes(q.answer), 'answer among options');
    assert.ok(!q.options.includes('af'), 'a non-maker is never an option (sparse metric.has filter)');
    const vals = q.options.map((c) => WIN[c]);
    assert.equal(WIN[q.answer], Math.max(...vals), `seed ${i}: answer must be the biggest-wine option`);
  }
});

// ---- cocoa instance (cocoa-bean tonnes, id 'superlative-cocoa') -------------

test('cocoaRound: biggest-only, correct extreme-by-cocoa answer, growers only', async () => {
  const { cocoaRound } = await import('./superlative.js');
  const cocoaJson = (await import('../metrics/cocoa.json', { with: { type: 'json' } })).default;
  const COC = /** @type {Record<string, number>} */ (cocoaJson.values);
  assert.equal(cocoaRound.id, 'superlative-cocoa');
  // Cocoa-distinct sovereign GROWERS spanning many orders of magnitude, all in
  // cocoa.json. A non-grower (e.g. Afghanistan) mixed in must be dropped by the
  // round's `metric.has` filter, never appear as an option.
  const pool = ['ci', 'id', 'gh', 'ec', 'ng', 'cm', 'br', 'pe', 'sl', 'co', 'af'].map((code) => ({ code }));
  for (let i = 0; i < 100; i++) {
    const q = cocoaRound.generate(pool, undefined, seeded(i + 1));
    assert.equal(q.options.length, 4);
    // Cocoa is locked to 'most'; "smallest grower" is an obscure question, so
    // it's never dealt. Every round asks for the biggest producer.
    assert.equal(q.prompt, 'most', `seed ${i}: cocoa is biggest-only, never 'least'`);
    assert.ok(q.options.includes(q.answer), 'answer among options');
    assert.ok(!q.options.includes('af'), 'a non-grower is never an option (sparse metric.has filter)');
    const vals = q.options.map((c) => COC[c]);
    assert.equal(COC[q.answer], Math.max(...vals), `seed ${i}: answer must be the biggest-cocoa option`);
  }
});

// ---- banana instance (banana tonnes, id 'superlative-banana') ---------------

test('bananaRound: biggest-only, correct extreme-by-banana answer, producers only', async () => {
  const { bananaRound } = await import('./superlative.js');
  const bananaJson = (await import('../metrics/banana.json', { with: { type: 'json' } })).default;
  const BAN = /** @type {Record<string, number>} */ (bananaJson.values);
  assert.equal(bananaRound.id, 'superlative-banana');
  // Banana-distinct sovereign PRODUCERS spanning many orders of magnitude, all in
  // banana.json. A non-producer (e.g. Afghanistan) mixed in must be dropped by
  // the round's `metric.has` filter, never appear as an option.
  const pool = ['in', 'cn', 'id', 'ec', 'br', 'ng', 'ph', 'gt', 'ke', 'cr', 'af'].map((code) => ({ code }));
  for (let i = 0; i < 100; i++) {
    const q = bananaRound.generate(pool, undefined, seeded(i + 1));
    assert.equal(q.options.length, 4);
    // Banana is locked to 'most'; every round asks for the biggest producer.
    assert.equal(q.prompt, 'most', `seed ${i}: banana is biggest-only, never 'least'`);
    assert.ok(q.options.includes(q.answer), 'answer among options');
    assert.ok(!q.options.includes('af'), 'a non-producer is never an option (sparse metric.has filter)');
    const vals = q.options.map((c) => BAN[c]);
    assert.equal(BAN[q.answer], Math.max(...vals), `seed ${i}: answer must be the biggest-banana option`);
  }
});

// ---- elevation instance (highest point in metres, id 'superlative-elevation') ---

test('elevationRound: two-directional, correct extreme-by-elevation answer', async () => {
  const { elevationRound } = await import('./superlative.js');
  const elevJson = (await import('../metrics/elevation.json', { with: { type: 'json' } })).default;
  const ELEV = /** @type {Record<string, number>} */ (elevJson.values);
  assert.equal(elevationRound.id, 'superlative-elevation');
  // Elevation-distinct sovereigns spanning three orders of magnitude, all in
  // elevation.json (Nepal 8849 ... Maldives 2). Dense metric: every code has a value.
  const pool = ['np', 'cl', 'ke', 'ch', 'ma', 'gb', 'de', 'nl', 'dk', 'mv', 'tv', 'bh'].map((code) => ({ code }));
  for (let i = 0; i < 100; i++) {
    const q = elevationRound.generate(pool, undefined, seeded(i + 1));
    assert.equal(q.options.length, 4);
    assert.ok(q.options.includes(q.answer), 'answer among options');
    const vals = q.options.map((c) => ELEV[c]);
    const extreme = q.prompt === 'most' ? Math.max(...vals) : Math.min(...vals);
    assert.equal(ELEV[q.answer], extreme, `seed ${i}: answer must be the ${q.prompt}-elevation option`);
  }
  // Unlike coffee (locked to 'most'), elevation is two-directional: the direction
  // is a live coin flip on the first rng byte, so both the highest peak and the
  // fun lowest highpoint get dealt. Drive it directly with a controlled first
  // byte to prove neither direction is suppressed.
  const firstThen = (/** @type {number} */ first, /** @type {() => number} */ rest) => {
    let n = 0;
    return () => (n++ === 0 ? first : rest());
  };
  assert.equal(elevationRound.generate(pool, undefined, firstThen(0.1, seeded(1))).prompt, 'least');
  assert.equal(elevationRound.generate(pool, undefined, firstThen(0.9, seeded(1))).prompt, 'most');
});
