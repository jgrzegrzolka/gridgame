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

// ---- apple instance (apple tonnes, id 'superlative-apple') ------------------

test('appleRound: biggest-only, correct extreme-by-apple answer, producers only', async () => {
  const { appleRound } = await import('./superlative.js');
  const appleJson = (await import('../metrics/apple.json', { with: { type: 'json' } })).default;
  const APP = /** @type {Record<string, number>} */ (appleJson.values);
  assert.equal(appleRound.id, 'superlative-apple');
  // Apple-distinct sovereign PRODUCERS spanning many orders of magnitude, all in
  // apple.json. A non-producer (e.g. Nigeria) mixed in must be dropped by the
  // round's `metric.has` filter, never appear as an option.
  const pool = ['cn', 'us', 'tr', 'pl', 'it', 'jp', 'nz', 'au', 'ng'].map((code) => ({ code }));
  for (let i = 0; i < 100; i++) {
    const q = appleRound.generate(pool, undefined, seeded(i + 1));
    assert.equal(q.options.length, 4);
    // Apple is locked to 'most'; every round asks for the biggest producer.
    assert.equal(q.prompt, 'most', `seed ${i}: apple is biggest-only, never 'least'`);
    assert.ok(q.options.includes(q.answer), 'answer among options');
    assert.ok(!q.options.includes('ng'), 'a non-producer is never an option (sparse metric.has filter)');
    const vals = q.options.map((c) => APP[c]);
    assert.equal(APP[q.answer], Math.max(...vals), `seed ${i}: answer must be the biggest-apple option`);
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

// ---- coastline instance (km of coast, id 'superlative-coastline') -----------

test('coastlineRound: two-directional over coastal places, correct extreme answer', async () => {
  const { coastlineRound } = await import('./superlative.js');
  const coastJson = (await import('../metrics/coastline.json', { with: { type: 'json' } })).default;
  const COAST = /** @type {Record<string, number>} */ (coastJson.values);
  assert.equal(coastlineRound.id, 'superlative-coastline');
  // Coastal sovereigns spanning four orders of magnitude (Canada 202,080 ...
  // Monaco 4). All strictly > 0, so none is filtered out of the round's pool.
  const pool = ['ca', 'id', 'no', 'us', 'gb', 'mx', 'it', 'fr', 'de', 'mc', 'gi', 'be'].map((code) => ({ code }));
  for (let i = 0; i < 100; i++) {
    const q = coastlineRound.generate(pool, undefined, seeded(i + 1));
    assert.equal(q.options.length, 4);
    assert.ok(q.options.includes(q.answer), 'answer among options');
    const vals = q.options.map((c) => COAST[c]);
    const extreme = q.prompt === 'most' ? Math.max(...vals) : Math.min(...vals);
    assert.equal(COAST[q.answer], extreme, `seed ${i}: answer must be the ${q.prompt}-coastline option`);
  }
});

test('coastlineRound: landlocked (0 km) places are excluded from selection', async () => {
  const { coastlineRound } = await import('./superlative.js');
  // The round metric is zero-filtered, so a landlocked code never has a value:
  // even a pool of all-landlocked places falls back to nothing usable and would
  // never surface one as an answer. Give a mixed pool and prove no landlocked
  // code ever appears as an option.
  const landlocked = new Set(['ch', 'at', 'bo', 'np', 'xk', 'hu', 'rs', 'ml', 'td']);
  const pool = ['ca', 'no', 'gb', 'it', 'ch', 'at', 'bo', 'np', 'xk', 'hu'].map((code) => ({ code }));
  for (let i = 0; i < 100; i++) {
    const q = coastlineRound.generate(pool, undefined, seeded(i + 1));
    for (const opt of q.options) {
      assert.ok(!landlocked.has(opt), `seed ${i}: landlocked ${opt} must not be an option`);
    }
  }
});

// ---- forest instance (% of land area, id 'superlative-forest') --------------

test('forestRound: two-directional over forested places, correct extreme answer', async () => {
  const { forestRound } = await import('./superlative.js');
  const forestJson = (await import('../metrics/forest.json', { with: { type: 'json' } })).default;
  const FOREST = /** @type {Record<string, number>} */ (forestJson.values);
  assert.equal(forestRound.id, 'superlative-forest');
  // Forested sovereigns with distinct values spanning the range (Suriname 94.5%
  // ... Ireland 11.5%). All strictly > 0, so none is filtered out of the round.
  const pool = ['sr', 'fi', 'jp', 'br', 'ru', 'us', 'cn', 'au', 'ma', 'ie'].map((code) => ({ code }));
  for (let i = 0; i < 100; i++) {
    const q = forestRound.generate(pool, undefined, seeded(i + 1));
    assert.equal(q.options.length, 4);
    assert.ok(q.options.includes(q.answer), 'answer among options');
    const vals = q.options.map((c) => FOREST[c]);
    const extreme = q.prompt === 'most' ? Math.max(...vals) : Math.min(...vals);
    assert.equal(FOREST[q.answer], extreme, `seed ${i}: answer must be the ${q.prompt}-forested option`);
  }
});

test('forestRound: treeless (0%) places are excluded from selection', async () => {
  const { forestRound } = await import('./superlative.js');
  // The round metric is zero-filtered, so a treeless code (desert / ice /
  // city-state at 0.0%) never has a value. Give a mixed pool and prove no
  // treeless code ever surfaces as an option.
  const treeless = new Set(['eg', 'qa', 'gl', 'mc', 'va', 'om', 'nr']);
  const pool = ['fi', 'br', 'ru', 'us', 'eg', 'qa', 'gl', 'mc', 'va', 'om'].map((code) => ({ code }));
  for (let i = 0; i < 100; i++) {
    const q = forestRound.generate(pool, undefined, seeded(i + 1));
    for (const opt of q.options) {
      assert.ok(!treeless.has(opt), `seed ${i}: treeless ${opt} must not be an option`);
    }
  }
});

// ---- oil instance (oil production in TWh, id 'superlative-oil') --------------

test('oilRound: biggest-only, correct extreme-by-oil answer, producers only', async () => {
  const { oilRound } = await import('./superlative.js');
  const oilJson = (await import('../metrics/oil.json', { with: { type: 'json' } })).default;
  const OIL = /** @type {Record<string, number>} */ (oilJson.values);
  assert.equal(oilRound.id, 'superlative-oil');
  // Oil-distinct sovereign PRODUCERS spanning many orders of magnitude, all in
  // oil.json. A non-producer (e.g. Switzerland) mixed in must be dropped by the
  // round's `metric.has` filter, never appear as an option.
  const pool = ['us', 'ru', 'sa', 'cn', 'no', 'qa', 'ch'].map((code) => ({ code }));
  for (let i = 0; i < 100; i++) {
    const q = oilRound.generate(pool, undefined, seeded(i + 1));
    assert.equal(q.options.length, 4);
    // Oil is locked to 'most'; every round asks for the biggest producer.
    assert.equal(q.prompt, 'most', `seed ${i}: oil is biggest-only, never 'least'`);
    assert.ok(q.options.includes(q.answer), 'answer among options');
    assert.ok(!q.options.includes('ch'), 'a non-producer is never an option (sparse metric.has filter)');
    const vals = q.options.map((c) => OIL[c]);
    assert.equal(OIL[q.answer], Math.max(...vals), `seed ${i}: answer must be the biggest-oil option`);
  }
});

// ---- rice instance (rice paddy tonnes, id 'superlative-rice') ---------------

test('riceRound: biggest-only, correct extreme-by-rice answer, growers only', async () => {
  const { riceRound } = await import('./superlative.js');
  const riceJson = (await import('../metrics/rice.json', { with: { type: 'json' } })).default;
  const RICE = /** @type {Record<string, number>} */ (riceJson.values);
  assert.equal(riceRound.id, 'superlative-rice');
  // Rice-distinct sovereign GROWERS spanning many orders of magnitude, all in
  // rice.json. A non-grower (e.g. Canada) mixed in must be dropped by the round's
  // `metric.has` filter, never appear as an option.
  const pool = ['in', 'cn', 'id', 'vn', 'th', 'jp', 'it', 'ca'].map((code) => ({ code }));
  for (let i = 0; i < 100; i++) {
    const q = riceRound.generate(pool, undefined, seeded(i + 1));
    assert.equal(q.options.length, 4);
    // Rice is locked to 'most'; every round asks for the biggest grower.
    assert.equal(q.prompt, 'most', `seed ${i}: rice is biggest-only, never 'least'`);
    assert.ok(q.options.includes(q.answer), 'answer among options');
    assert.ok(!q.options.includes('ca'), 'a non-grower is never an option (sparse metric.has filter)');
    const vals = q.options.map((c) => RICE[c]);
    assert.equal(RICE[q.answer], Math.max(...vals), `seed ${i}: answer must be the biggest-rice option`);
  }
});

// ---- coal instance (coal production in TWh, id 'superlative-coal') -----------

test('coalRound: biggest-only, correct extreme-by-coal answer, producers only', async () => {
  const { coalRound } = await import('./superlative.js');
  const coalJson = (await import('../metrics/coal.json', { with: { type: 'json' } })).default;
  const COAL = /** @type {Record<string, number>} */ (coalJson.values);
  assert.equal(coalRound.id, 'superlative-coal');
  // Coal-distinct sovereign PRODUCERS spanning many orders of magnitude, all in
  // coal.json. A non-producer (e.g. France) mixed in must be dropped by the
  // round's `metric.has` filter, never appear as an option.
  const pool = ['cn', 'in', 'id', 'au', 'us', 'ru', 'za', 'fr'].map((code) => ({ code }));
  for (let i = 0; i < 100; i++) {
    const q = coalRound.generate(pool, undefined, seeded(i + 1));
    assert.equal(q.options.length, 4);
    // Coal is locked to 'most'; every round asks for the biggest producer.
    assert.equal(q.prompt, 'most', `seed ${i}: coal is biggest-only, never 'least'`);
    assert.ok(q.options.includes(q.answer), 'answer among options');
    assert.ok(!q.options.includes('fr'), 'a non-producer is never an option (sparse metric.has filter)');
    const vals = q.options.map((c) => COAL[c]);
    assert.equal(COAL[q.answer], Math.max(...vals), `seed ${i}: answer must be the biggest-coal option`);
  }
});
