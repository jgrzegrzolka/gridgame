import { test } from 'node:test';
import assert from 'node:assert/strict';
import population from '../metrics/population.json' with { type: 'json' };
import { id, generate, isCorrect } from './superlative.js';
import * as superlative from './superlative.js';
import { SUPERLATIVE_METRICS } from './superlativeCatalog.js';
import { METRIC_FILES } from '../metrics/index.js';

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

// This module's whole job is now to bring the data the catalog names. A catalog
// entry with no `DATA` entry throws at import (the question could never resolve a
// value), but the reverse — data for a metric no catalog entry asks about — is
// silent dead weight, so pin both directions. Together with the catalog's own
// drift test this chains: metrics/index.js <-> catalog <-> DATA.
test('every catalog metric is built, and every built question is in the catalog', () => {
  for (const m of SUPERLATIVE_METRICS) {
    const question = roundFor(m.questionId);
    assert.ok(question, `catalog names "${m.key}" (${m.questionId}) but no question was built for it`);
    assert.equal(typeof question.generate, 'function', `${m.key}: question cannot generate`);
    assert.equal(typeof question.isCorrect, 'function', `${m.key}: question cannot score`);
  }
});

// The one that matters, and the one my first attempt got wrong. `QUESTIONS` is
// built FROM the catalog, so any test that counts "built questions" against
// `SUPERLATIVE_METRICS.length` is tautological: retire a catalog entry and both
// sides drop together while `export const honeyQuestion = QUESTIONS.honey;` is left
// behind as `undefined`. That is not a cosmetic leftover —
// `party/partyGameServer.js:41` lists these exports BY NAME and reads `.id` off
// each to build its registry, so an undefined one throws at module load and
// EVERY Flag Party room dies, flag-pick and map-pick included.
//
// Verified by mutation: retiring honey from the catalog while leaving its export
// dangling left this file green except for honey's own legacy per-metric test —
// exactly the test a dev deletes when retiring a metric.
test('every *Question export is a live question the catalog claims', () => {
  const roundExports = exportedEntries().filter(([name]) => name.endsWith('Question'));
  for (const [name, question] of roundExports) {
    assert.ok(question,
      `export "${name}" is undefined — its catalog entry is gone but the export was left behind. `
      + 'party/partyGameServer.js reads .id off it and throws at import, killing every room.');
    assert.equal(typeof question.id, 'string', `export "${name}" is not a question`);
    assert.equal(typeof question.generate, 'function', `export "${name}" cannot generate`);
    assert.ok(SUPERLATIVE_METRICS.some((m) => m.questionId === question.id),
      `export "${name}" deals question "${question.id}" that no catalog entry claims`);
  }
  // All but population, which is exported flat rather than as a `<key>Question`.
  assert.equal(roundExports.length, SUPERLATIVE_METRICS.length - 1,
    'every catalog metric but population needs exactly one <key>Question export');
});

/** This module's exports, as opaque entries: the checker sees a union of string
 *  (the flat `id`), two functions, and 31 question objects, so probing `.id` needs
 *  the cast. @returns {[string, any][]} */
const exportedEntries = () => /** @type {[string, any][]} */ (Object.entries(superlative));

/** @returns {any[]} */
const exportedValues = () => exportedEntries().map(([, v]) => v);

/** The question for a catalog entry. The population question is exported FLAT (id /
 *  generate / isCorrect, the shape it shipped in before there was a second
 *  metric), so reassemble it; every other metric exports a question object.
 *  @param {string} questionId */
const roundFor = (questionId) => (
  questionId === id
    ? { id, generate, isCorrect }
    : exportedValues().find((r) => r && r.id === questionId)
);

/** A metric's raw values map, loaded the way the module itself does.
 *  @param {string} key @returns {Promise<Record<string, number>>} */
async function valuesOf(key) {
  const file = /** @type {{ key: string, file: string }} */ (
    METRIC_FILES.find((f) => f.key === key)
  ).file;
  const json = (await import(`../metrics/${file}`, { with: { type: 'json' } })).default;
  return json.values;
}

// The direction lock and the zero-filter used to be written per metric, right
// beside the data. They're read from the catalog now, so pin that every entry
// really got its rule applied. Without this, a builder that ignored `direction`
// would be caught only by the ~20 per-metric tests below that happen to assert
// it — and a NEW metric would ship with no such test at all.
test('every direction-locked metric only ever deals its locked direction', async () => {
  for (const m of SUPERLATIVE_METRICS) {
    if (!m.direction) continue;
    const values = await valuesOf(m.key);
    // Distinct-valued codes so a quartet always has an unambiguous extreme.
    const seen = new Set();
    const pool = Object.entries(values)
      .filter(([, v]) => v > 0 && !seen.has(v) && seen.add(v))
      .slice(0, 12)
      .map(([code]) => ({ code }));
    assert.ok(pool.length >= 4, `${m.key}: need 4+ distinct values to test`);
    for (let i = 0; i < 20; i++) {
      const q = roundFor(m.questionId).generate(pool, undefined, seeded(i + 1));
      assert.equal(q.prompt, m.direction,
        `${m.key} is locked to '${m.direction}' but dealt '${q.prompt}'`);
    }
  }
});

// The other catalog rule. A real 0 must never be selectable on a zero-filtered
// metric — that's what keeps "least forested" from drawing four countries that
// all sit at 0.0% and tie.
test('every zero-filtered metric excludes its real zeros from selection', async () => {
  let checked = 0;
  for (const m of SUPERLATIVE_METRICS) {
    if (!m.zeroFiltered) continue;
    const values = await valuesOf(m.key);
    const zeros = Object.entries(values).filter(([, v]) => v === 0).map(([code]) => code);
    if (zeros.length === 0) continue; // zero-filtered defensively; nothing to prove
    checked++;
    const nonZero = Object.entries(values)
      .filter(([, v]) => v > 0)
      .slice(0, 6)
      .map(([code]) => ({ code }));
    const pool = [...nonZero, ...zeros.slice(0, 6).map((code) => ({ code }))];
    for (let i = 0; i < 40; i++) {
      const q = roundFor(m.questionId).generate(pool, undefined, seeded(i + 1));
      for (const opt of q.options) {
        assert.ok(!zeros.includes(opt), `${m.key}: zero-valued ${opt} was offered as an option`);
      }
    }
  }
  assert.ok(checked >= 5, `expected several metrics with real zeros, checked ${checked}`);
});

// The converse of the direction lock. Without it, `direction: 'most'` on every
// entry would satisfy the lock test above while silently halving the question
// space of the eleven metrics whose low pole is a real question (the Maldives'
// lowest highpoint, Afghanistan's happiness floor, the coldest place).
test('every two-directional metric deals both directions', async () => {
  // Drive the first rng byte, which is the direction coin flip. Spreading seeds
  // and hoping is what made the population version of this test flaky.
  const firstThen = (/** @type {number} */ first, /** @type {() => number} */ rest) => {
    let n = 0;
    return () => (n++ === 0 ? first : rest());
  };
  let checked = 0;
  for (const m of SUPERLATIVE_METRICS) {
    if (m.direction !== null) continue;
    checked++;
    const values = await valuesOf(m.key);
    const seen = new Set();
    const pool = Object.entries(values)
      .filter(([, v]) => v > 0 && !seen.has(v) && seen.add(v))
      .slice(0, 12)
      .map(([code]) => ({ code }));
    assert.ok(pool.length >= 4, `${m.key}: need 4+ distinct values to test`);
    const question = roundFor(m.questionId);
    assert.equal(question.generate(pool, undefined, firstThen(0.1, seeded(1))).prompt, 'least',
      `${m.key} is two-directional but never deals 'least'`);
    assert.equal(question.generate(pool, undefined, firstThen(0.9, seeded(1))).prompt, 'most',
      `${m.key} is two-directional but never deals 'most'`);
  }
  // A floor, not an exact count: the loop must not pass vacuously. Pinning the
  // exact number would fail on every new two-directional metric, which teaches
  // bumping the constant rather than reading the test.
  assert.ok(checked >= 5, `expected several two-directional metrics, checked ${checked}`);
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

test('generate: never puts two flag lookalikes among the four options', async () => {
  const { lookalikesOf } = await import('../quiz.js');
  // A pool laced with lookalike pairs (id/mc, ro/td, ie/ci) plus enough distinct
  // sovereigns that the guard never has to fall back — so co-occurrence would be
  // a real defect, not an unavoidable tiny-pool draw. All carry a population value.
  const pool = ['id', 'mc', 'ro', 'td', 'ie', 'ci', 'us', 'br', 'cn', 'in', 'ru', 'jp', 'de', 'fr']
    .map((code) => ({ code }));
  for (let i = 0; i < 300; i++) {
    const q = generate(pool, undefined, seeded(i + 1));
    const groups = q.options.map((c) => lookalikesOf(c).join(','));
    assert.equal(new Set(groups).size, q.options.length,
      `seed ${i}: two indistinguishable flags co-occur in [${q.options.join(', ')}]`);
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

test('areaQuestion: id and a correct extreme-by-area answer', async () => {
  const { areaQuestion } = await import('./superlative.js');
  const areaJson = (await import('../metrics/area.json', { with: { type: 'json' } })).default;
  const AREA = /** @type {Record<string, number>} */ (areaJson.values);
  assert.equal(areaQuestion.id, 'superlative-area');
  // Large, area-distinct sovereigns, all present in area.json.
  const pool = ['ru', 'ca', 'cn', 'us', 'br', 'au', 'in', 'ar', 'kz', 'dz', 'mn', 'nl'].map((code) => ({ code }));
  for (let i = 0; i < 100; i++) {
    const q = areaQuestion.generate(pool, undefined, seeded(i + 1));
    assert.equal(q.options.length, 4);
    assert.ok(q.options.includes(q.answer), 'answer among options');
    const vals = q.options.map((c) => AREA[c]);
    const extreme = q.prompt === 'most' ? Math.max(...vals) : Math.min(...vals);
    assert.equal(AREA[q.answer], extreme, `seed ${i}: answer must be the ${q.prompt}-area option`);
  }
});

// ---- density instance (people per km², id 'superlative-density') ------------

test('densityQuestion: id and a correct extreme-by-density answer', async () => {
  const { densityQuestion } = await import('./superlative.js');
  const densityJson = (await import('../metrics/density.json', { with: { type: 'json' } })).default;
  const DENSITY = /** @type {Record<string, number>} */ (densityJson.values);
  assert.equal(densityQuestion.id, 'superlative-density');
  // Density-distinct sovereigns spanning ~4 orders of magnitude, all in density.json.
  const pool = ['mc', 'sg', 'bd', 'nl', 'mn', 'au', 'ca', 'ru', 'na', 'kz', 'in', 'jp'].map((code) => ({ code }));
  for (let i = 0; i < 100; i++) {
    const q = densityQuestion.generate(pool, undefined, seeded(i + 1));
    assert.equal(q.options.length, 4);
    assert.ok(q.options.includes(q.answer), 'answer among options');
    const vals = q.options.map((c) => DENSITY[c]);
    const extreme = q.prompt === 'most' ? Math.max(...vals) : Math.min(...vals);
    assert.equal(DENSITY[q.answer], extreme, `seed ${i}: answer must be the ${q.prompt}-density option`);
  }
});

// ---- gdp instance (total economy in US$, id 'superlative-gdp') --------------

test('gdpQuestion: id and a correct extreme-by-gdp answer', async () => {
  const { gdpQuestion } = await import('./superlative.js');
  const gdpJson = (await import('../metrics/gdp.json', { with: { type: 'json' } })).default;
  const GDP = /** @type {Record<string, number>} */ (gdpJson.values);
  assert.equal(gdpQuestion.id, 'superlative-gdp');
  // GDP-distinct sovereigns spanning many orders of magnitude, all in gdp.json.
  const pool = ['us', 'cn', 'jp', 'de', 'in', 'br', 'ng', 'gh', 'is', 'fj', 'to', 'ws'].map((code) => ({ code }));
  for (let i = 0; i < 100; i++) {
    const q = gdpQuestion.generate(pool, undefined, seeded(i + 1));
    assert.equal(q.options.length, 4);
    assert.ok(q.options.includes(q.answer), 'answer among options');
    const vals = q.options.map((c) => GDP[c]);
    const extreme = q.prompt === 'most' ? Math.max(...vals) : Math.min(...vals);
    assert.equal(GDP[q.answer], extreme, `seed ${i}: answer must be the ${q.prompt}-gdp option`);
  }
});

// ---- gdp-per-capita instance (US$ per head, id 'superlative-gdppc') ---------

test('gdpPerCapitaQuestion: id and a correct extreme-by-gdp-per-capita answer', async () => {
  const { gdpPerCapitaQuestion } = await import('./superlative.js');
  const pcJson = (await import('../metrics/gdpPerCapita.json', { with: { type: 'json' } })).default;
  const PC = /** @type {Record<string, number>} */ (pcJson.values);
  assert.equal(gdpPerCapitaQuestion.id, 'superlative-gdppc');
  // Per-capita-distinct sovereigns spanning ~3 orders of magnitude, all in gdpPerCapita.json.
  const pool = ['lu', 'no', 'us', 'de', 'cn', 'in', 'ng', 'et', 'bi', 'mw', 'cd', 'ne'].map((code) => ({ code }));
  for (let i = 0; i < 100; i++) {
    const q = gdpPerCapitaQuestion.generate(pool, undefined, seeded(i + 1));
    assert.equal(q.options.length, 4);
    assert.ok(q.options.includes(q.answer), 'answer among options');
    const vals = q.options.map((c) => PC[c]);
    const extreme = q.prompt === 'most' ? Math.max(...vals) : Math.min(...vals);
    assert.equal(PC[q.answer], extreme, `seed ${i}: answer must be the ${q.prompt}-per-capita option`);
  }
});

// ---- coffee instance (green-coffee tonnes, id 'superlative-coffee') ---------

test('coffeeQuestion: biggest-only, correct extreme-by-coffee answer, growers only', async () => {
  const { coffeeQuestion } = await import('./superlative.js');
  const coffeeJson = (await import('../metrics/coffee.json', { with: { type: 'json' } })).default;
  const COF = /** @type {Record<string, number>} */ (coffeeJson.values);
  assert.equal(coffeeQuestion.id, 'superlative-coffee');
  // Coffee-distinct sovereign GROWERS spanning many orders of magnitude, all in
  // coffee.json. A non-grower (e.g. Germany) mixed in must be dropped by the
  // question's `metric.has` filter, never appear as an option.
  const pool = ['br', 'vn', 'co', 'et', 'in', 'mx', 'pe', 'gt', 'cu', 'th', 'rw', 'bo', 'de'].map((code) => ({ code }));
  for (let i = 0; i < 100; i++) {
    const q = coffeeQuestion.generate(pool, undefined, seeded(i + 1));
    assert.equal(q.options.length, 4);
    // Coffee is locked to 'most' — "smallest grower" is an obscure question, so
    // it's never dealt (Jan). Every question asks for the biggest producer.
    assert.equal(q.prompt, 'most', `seed ${i}: coffee is biggest-only, never 'least'`);
    assert.ok(q.options.includes(q.answer), 'answer among options');
    assert.ok(!q.options.includes('de'), 'a non-grower is never an option (sparse metric.has filter)');
    const vals = q.options.map((c) => COF[c]);
    assert.equal(COF[q.answer], Math.max(...vals), `seed ${i}: answer must be the biggest-coffee option`);
  }
});

// ---- tea instance (green-tea-leaf tonnes, id 'superlative-tea') --------------

test('teaQuestion: biggest-only, correct extreme-by-tea answer, growers only', async () => {
  const { teaQuestion } = await import('./superlative.js');
  const teaJson = (await import('../metrics/tea.json', { with: { type: 'json' } })).default;
  const TEA = /** @type {Record<string, number>} */ (teaJson.values);
  assert.equal(teaQuestion.id, 'superlative-tea');
  // Tea-distinct sovereign GROWERS spanning many orders of magnitude, all in
  // tea.json. A non-grower (e.g. Germany) mixed in must be dropped by the question's
  // `metric.has` filter, never appear as an option.
  const pool = ['cn', 'in', 'ke', 'lk', 'tr', 'vn', 'id', 'jp', 'np', 'mm', 'rw', 'ge', 'de'].map((code) => ({ code }));
  for (let i = 0; i < 100; i++) {
    const q = teaQuestion.generate(pool, undefined, seeded(i + 1));
    assert.equal(q.options.length, 4);
    // Tea is locked to 'most' — "smallest grower" is obscure, so it's never dealt.
    assert.equal(q.prompt, 'most', `seed ${i}: tea is biggest-only, never 'least'`);
    assert.ok(q.options.includes(q.answer), 'answer among options');
    assert.ok(!q.options.includes('de'), 'a non-grower is never an option (sparse metric.has filter)');
    const vals = q.options.map((c) => TEA[c]);
    assert.equal(TEA[q.answer], Math.max(...vals), `seed ${i}: answer must be the biggest-tea option`);
  }
});

// ---- sugar cane instance (tonnes of cane, id 'superlative-sugarcane') --------

test('sugarcaneQuestion: biggest-only, correct extreme-by-cane answer, growers only', async () => {
  const { sugarcaneQuestion } = await import('./superlative.js');
  const scJson = (await import('../metrics/sugarcane.json', { with: { type: 'json' } })).default;
  const SC = /** @type {Record<string, number>} */ (scJson.values);
  assert.equal(sugarcaneQuestion.id, 'superlative-sugarcane');
  // Cane-distinct sovereign GROWERS spanning many orders of magnitude, all in
  // sugarcane.json. A non-grower (e.g. Germany) mixed in must be dropped by the
  // question's `metric.has` filter, never appear as an option.
  const pool = ['br', 'in', 'cn', 'th', 'pk', 'mx', 'au', 'us', 'co', 'pe', 'fj', 'bb', 'de'].map((code) => ({ code }));
  for (let i = 0; i < 100; i++) {
    const q = sugarcaneQuestion.generate(pool, undefined, seeded(i + 1));
    assert.equal(q.options.length, 4);
    // Sugar cane is locked to 'most' — "smallest grower" is obscure, never dealt.
    assert.equal(q.prompt, 'most', `seed ${i}: sugarcane is biggest-only, never 'least'`);
    assert.ok(q.options.includes(q.answer), 'answer among options');
    assert.ok(!q.options.includes('de'), 'a non-grower is never an option (sparse metric.has filter)');
    const vals = q.options.map((c) => SC[c]);
    assert.equal(SC[q.answer], Math.max(...vals), `seed ${i}: answer must be the biggest-cane option`);
  }
});

// ---- gold instance (tonnes of mined gold, id 'superlative-gold') -------------

test('goldQuestion: biggest-only, correct extreme-by-gold answer, producers only', async () => {
  const { goldQuestion } = await import('./superlative.js');
  const goldJson = (await import('../metrics/gold.json', { with: { type: 'json' } })).default;
  const GLD = /** @type {Record<string, number>} */ (goldJson.values);
  assert.equal(goldQuestion.id, 'superlative-gold');
  // Gold-distinct sovereign PRODUCERS spanning the range, all in gold.json. A
  // non-producer (e.g. Germany) mixed in must be dropped by the question's
  // `metric.has` filter, never appear as an option.
  // Distinct-value producers (gold has several tied tonnages: 130×3, 100×3,
  // 70×2, 60×3) so every quartet has an unambiguous biggest.
  const pool = ['cn', 'ru', 'au', 'ca', 'us', 'kz', 'uz', 'za', 'br', 'co', 'de'].map((code) => ({ code }));
  for (let i = 0; i < 100; i++) {
    const q = goldQuestion.generate(pool, undefined, seeded(i + 1));
    assert.equal(q.options.length, 4);
    // Gold is locked to 'most' — "smallest producer" is obscure, never dealt.
    assert.equal(q.prompt, 'most', `seed ${i}: gold is biggest-only, never 'least'`);
    assert.ok(q.options.includes(q.answer), 'answer among options');
    assert.ok(!q.options.includes('de'), 'a non-producer is never an option (sparse metric.has filter)');
    const vals = q.options.map((c) => GLD[c]);
    assert.equal(GLD[q.answer], Math.max(...vals), `seed ${i}: answer must be the biggest-gold option`);
  }
});

// ---- olive oil instance (tonnes, id 'superlative-olive-oil') -----------------

test('oliveOilQuestion: biggest-only, correct extreme-by-oil answer, producers only', async () => {
  const { oliveOilQuestion } = await import('./superlative.js');
  const oliveOilJson = (await import('../metrics/oliveOil.json', { with: { type: 'json' } })).default;
  const OIL = /** @type {Record<string, number>} */ (oliveOilJson.values);
  assert.equal(oliveOilQuestion.id, 'superlative-olive-oil');
  // Distinct-value sovereign PRODUCERS spanning the range, all in oliveOil.json
  // (olive oil has some tied tonnages, so pick codes with unambiguous values). A
  // non-producer (e.g. Germany) mixed in must be dropped by the question's
  // `metric.has` filter, never appear as an option.
  const pool = ['es', 'it', 'gr', 'tr', 'tn', 'sy', 'ma', 'pt', 'dz', 'eg', 'de'].map((code) => ({ code }));
  for (let i = 0; i < 100; i++) {
    const q = oliveOilQuestion.generate(pool, undefined, seeded(i + 1));
    assert.equal(q.options.length, 4);
    // Olive oil is locked to 'most' — "smallest producer" is obscure, never dealt.
    assert.equal(q.prompt, 'most', `seed ${i}: oliveOil is biggest-only, never 'least'`);
    assert.ok(q.options.includes(q.answer), 'answer among options');
    assert.ok(!q.options.includes('de'), 'a non-producer is never an option (sparse metric.has filter)');
    const vals = q.options.map((c) => OIL[c]);
    assert.equal(OIL[q.answer], Math.max(...vals), `seed ${i}: answer must be the biggest-oil option`);
  }
});

// ---- honey instance (tonnes, id 'superlative-honey') ------------------------

test('honeyQuestion: biggest-only, correct extreme-by-honey answer, producers only', async () => {
  const { honeyQuestion } = await import('./superlative.js');
  const honeyJson = (await import('../metrics/honey.json', { with: { type: 'json' } })).default;
  const HNY = /** @type {Record<string, number>} */ (honeyJson.values);
  assert.equal(honeyQuestion.id, 'superlative-honey');
  // Distinct-value sovereign PRODUCERS spanning the range, all in honey.json. A
  // non-producer (e.g. Japan, not in the top-55 set) mixed in must be dropped by
  // the question's `metric.has` filter, never appear as an option.
  const pool = ['cn', 'tr', 'ir', 'in', 'ar', 'ru', 'mx', 'ua', 'br', 'us', 'jp'].map((code) => ({ code }));
  for (let i = 0; i < 100; i++) {
    const q = honeyQuestion.generate(pool, undefined, seeded(i + 1));
    assert.equal(q.options.length, 4);
    // Honey is locked to 'most' — "smallest producer" is obscure, never dealt.
    assert.equal(q.prompt, 'most', `seed ${i}: honey is biggest-only, never 'least'`);
    assert.ok(q.options.includes(q.answer), 'answer among options');
    assert.ok(!q.options.includes('jp'), 'a non-producer is never an option (sparse metric.has filter)');
    const vals = q.options.map((c) => HNY[c]);
    assert.equal(HNY[q.answer], Math.max(...vals), `seed ${i}: answer must be the biggest-honey option`);
  }
});

// ---- wine instance (wine tonnes, id 'superlative-wine') ---------------------

test('wineQuestion: biggest-only, correct extreme-by-wine answer, makers only', async () => {
  const { wineQuestion } = await import('./superlative.js');
  const wineJson = (await import('../metrics/wine.json', { with: { type: 'json' } })).default;
  const WIN = /** @type {Record<string, number>} */ (wineJson.values);
  assert.equal(wineQuestion.id, 'superlative-wine');
  // Wine-distinct sovereign MAKERS spanning many orders of magnitude, all in
  // wine.json. A non-maker (e.g. Afghanistan) mixed in must be dropped by the
  // question's `metric.has` filter, never appear as an option.
  const pool = ['fr', 'it', 'es', 'us', 'cn', 'cl', 'au', 'za', 'ar', 'pt', 'de', 'af'].map((code) => ({ code }));
  for (let i = 0; i < 100; i++) {
    const q = wineQuestion.generate(pool, undefined, seeded(i + 1));
    assert.equal(q.options.length, 4);
    // Wine is locked to 'most'; "smallest maker" is an obscure question, so
    // it's never dealt. Every question asks for the biggest producer.
    assert.equal(q.prompt, 'most', `seed ${i}: wine is biggest-only, never 'least'`);
    assert.ok(q.options.includes(q.answer), 'answer among options');
    assert.ok(!q.options.includes('af'), 'a non-maker is never an option (sparse metric.has filter)');
    const vals = q.options.map((c) => WIN[c]);
    assert.equal(WIN[q.answer], Math.max(...vals), `seed ${i}: answer must be the biggest-wine option`);
  }
});

// ---- cocoa instance (cocoa-bean tonnes, id 'superlative-cocoa') -------------

test('cocoaQuestion: biggest-only, correct extreme-by-cocoa answer, growers only', async () => {
  const { cocoaQuestion } = await import('./superlative.js');
  const cocoaJson = (await import('../metrics/cocoa.json', { with: { type: 'json' } })).default;
  const COC = /** @type {Record<string, number>} */ (cocoaJson.values);
  assert.equal(cocoaQuestion.id, 'superlative-cocoa');
  // Cocoa-distinct sovereign GROWERS spanning many orders of magnitude, all in
  // cocoa.json. A non-grower (e.g. Afghanistan) mixed in must be dropped by the
  // question's `metric.has` filter, never appear as an option.
  const pool = ['ci', 'id', 'gh', 'ec', 'ng', 'cm', 'br', 'pe', 'sl', 'co', 'af'].map((code) => ({ code }));
  for (let i = 0; i < 100; i++) {
    const q = cocoaQuestion.generate(pool, undefined, seeded(i + 1));
    assert.equal(q.options.length, 4);
    // Cocoa is locked to 'most'; "smallest grower" is an obscure question, so
    // it's never dealt. Every question asks for the biggest producer.
    assert.equal(q.prompt, 'most', `seed ${i}: cocoa is biggest-only, never 'least'`);
    assert.ok(q.options.includes(q.answer), 'answer among options');
    assert.ok(!q.options.includes('af'), 'a non-grower is never an option (sparse metric.has filter)');
    const vals = q.options.map((c) => COC[c]);
    assert.equal(COC[q.answer], Math.max(...vals), `seed ${i}: answer must be the biggest-cocoa option`);
  }
});

// ---- banana instance (banana tonnes, id 'superlative-banana') ---------------

test('bananaQuestion: biggest-only, correct extreme-by-banana answer, producers only', async () => {
  const { bananaQuestion } = await import('./superlative.js');
  const bananaJson = (await import('../metrics/banana.json', { with: { type: 'json' } })).default;
  const BAN = /** @type {Record<string, number>} */ (bananaJson.values);
  assert.equal(bananaQuestion.id, 'superlative-banana');
  // Banana-distinct sovereign PRODUCERS spanning many orders of magnitude, all in
  // banana.json. A non-producer (e.g. Afghanistan) mixed in must be dropped by
  // the question's `metric.has` filter, never appear as an option.
  const pool = ['in', 'cn', 'id', 'ec', 'br', 'ng', 'ph', 'gt', 'ke', 'cr', 'af'].map((code) => ({ code }));
  for (let i = 0; i < 100; i++) {
    const q = bananaQuestion.generate(pool, undefined, seeded(i + 1));
    assert.equal(q.options.length, 4);
    // Banana is locked to 'most'; every question asks for the biggest producer.
    assert.equal(q.prompt, 'most', `seed ${i}: banana is biggest-only, never 'least'`);
    assert.ok(q.options.includes(q.answer), 'answer among options');
    assert.ok(!q.options.includes('af'), 'a non-producer is never an option (sparse metric.has filter)');
    const vals = q.options.map((c) => BAN[c]);
    assert.equal(BAN[q.answer], Math.max(...vals), `seed ${i}: answer must be the biggest-banana option`);
  }
});

// ---- apple instance (apple tonnes, id 'superlative-apple') ------------------

test('appleQuestion: biggest-only, correct extreme-by-apple answer, producers only', async () => {
  const { appleQuestion } = await import('./superlative.js');
  const appleJson = (await import('../metrics/apple.json', { with: { type: 'json' } })).default;
  const APP = /** @type {Record<string, number>} */ (appleJson.values);
  assert.equal(appleQuestion.id, 'superlative-apple');
  // Apple-distinct sovereign PRODUCERS spanning many orders of magnitude, all in
  // apple.json. A non-producer (e.g. Nigeria) mixed in must be dropped by the
  // question's `metric.has` filter, never appear as an option.
  const pool = ['cn', 'us', 'tr', 'pl', 'it', 'jp', 'nz', 'au', 'ng'].map((code) => ({ code }));
  for (let i = 0; i < 100; i++) {
    const q = appleQuestion.generate(pool, undefined, seeded(i + 1));
    assert.equal(q.options.length, 4);
    // Apple is locked to 'most'; every question asks for the biggest producer.
    assert.equal(q.prompt, 'most', `seed ${i}: apple is biggest-only, never 'least'`);
    assert.ok(q.options.includes(q.answer), 'answer among options');
    assert.ok(!q.options.includes('ng'), 'a non-producer is never an option (sparse metric.has filter)');
    const vals = q.options.map((c) => APP[c]);
    assert.equal(APP[q.answer], Math.max(...vals), `seed ${i}: answer must be the biggest-apple option`);
  }
});

// ---- elevation instance (highest point in metres, id 'superlative-elevation') ---

test('elevationQuestion: two-directional, correct extreme-by-elevation answer', async () => {
  const { elevationQuestion } = await import('./superlative.js');
  const elevJson = (await import('../metrics/elevation.json', { with: { type: 'json' } })).default;
  const ELEV = /** @type {Record<string, number>} */ (elevJson.values);
  assert.equal(elevationQuestion.id, 'superlative-elevation');
  // Elevation-distinct sovereigns spanning three orders of magnitude, all in
  // elevation.json (Nepal 8849 ... Maldives 2). Dense metric: every code has a value.
  const pool = ['np', 'cl', 'ke', 'ch', 'ma', 'gb', 'de', 'nl', 'dk', 'mv', 'tv', 'bh'].map((code) => ({ code }));
  for (let i = 0; i < 100; i++) {
    const q = elevationQuestion.generate(pool, undefined, seeded(i + 1));
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
  assert.equal(elevationQuestion.generate(pool, undefined, firstThen(0.1, seeded(1))).prompt, 'least');
  assert.equal(elevationQuestion.generate(pool, undefined, firstThen(0.9, seeded(1))).prompt, 'most');
});

// ---- temperature instance (°C, id 'superlative-temperature') ----------------

test('temperatureQuestion: two-directional over hot and sub-zero places, correct extreme answer', async () => {
  const { temperatureQuestion } = await import('./superlative.js');
  const tempJson = (await import('../metrics/temperature.json', { with: { type: 'json' } })).default;
  const TEMP = /** @type {Record<string, number>} */ (tempJson.values);
  assert.equal(temperatureQuestion.id, 'superlative-temperature');
  // Temperature-distinct places spanning hot to below freezing, all in
  // temperature.json (dense). Includes negatives so the extreme-pick is proven
  // sign-safe: Burkina 30.4 ... Greenland -18.68.
  const pool = ['bf', 'ae', 'sg', 'gr', 'gb', 'de', 'no', 'is', 'ru', 'ca', 'gl', 'sj'].map((code) => ({ code }));
  for (let i = 0; i < 100; i++) {
    const q = temperatureQuestion.generate(pool, undefined, seeded(i + 1));
    assert.equal(q.options.length, 4);
    assert.ok(q.options.includes(q.answer), 'answer among options');
    const vals = q.options.map((c) => TEMP[c]);
    const extreme = q.prompt === 'most' ? Math.max(...vals) : Math.min(...vals);
    assert.equal(TEMP[q.answer], extreme, `seed ${i}: answer must be the ${q.prompt}-temperature option`);
  }
  // Two-directional: hottest AND coldest both get dealt. Drive the first rng
  // byte directly to prove neither direction is suppressed (negatives included).
  const firstThen = (/** @type {number} */ first, /** @type {() => number} */ rest) => {
    let n = 0;
    return () => (n++ === 0 ? first : rest());
  };
  assert.equal(temperatureQuestion.generate(pool, undefined, firstThen(0.1, seeded(1))).prompt, 'least');
  assert.equal(temperatureQuestion.generate(pool, undefined, firstThen(0.9, seeded(1))).prompt, 'most');
});

// ---- happiness instance (WHR ladder 0-10, id 'superlative-happiness') -------

test('happinessQuestion: two-directional, correct extreme-happiness answer, covered places only', async () => {
  const { happinessQuestion } = await import('./superlative.js');
  const happyJson = (await import('../metrics/happiness.json', { with: { type: 'json' } })).default;
  const HAPPY = /** @type {Record<string, number>} */ (happyJson.values);
  assert.equal(happinessQuestion.id, 'superlative-happiness');
  // Happiness-distinct sovereigns spanning the ladder, all covered by Gallup.
  const pool = ['fi', 'dk', 'is', 'cr', 'us', 'de', 'jp', 'br', 'in', 'ke', 'np', 'af'].map((code) => ({ code }));
  for (const c of pool) assert.ok(c.code in HAPPY, `${c.code} must be covered by happiness.json`);
  for (let i = 0; i < 100; i++) {
    const q = happinessQuestion.generate(pool, undefined, seeded(i + 1));
    assert.equal(q.options.length, 4);
    assert.ok(q.options.includes(q.answer), 'answer among options');
    const vals = q.options.map((c) => HAPPY[c]);
    // Not inverted: 'most' = happiest (max), 'least' = least happy (min).
    const extreme = q.prompt === 'most' ? Math.max(...vals) : Math.min(...vals);
    assert.equal(HAPPY[q.answer], extreme, `seed ${i}: ${q.prompt} answer must be the extreme option`);
  }
});

test('happinessQuestion: deals both directions across seeds', async () => {
  const { happinessQuestion } = await import('./superlative.js');
  const pool = ['fi', 'dk', 'is', 'cr', 'us', 'de', 'jp', 'br', 'in', 'ke', 'np', 'af'].map((code) => ({ code }));
  const firstThen = (/** @type {number} */ first, /** @type {() => number} */ rest) => {
    let n = 0;
    return () => (n++ === 0 ? first : rest());
  };
  assert.equal(happinessQuestion.generate(pool, undefined, firstThen(0.1, seeded(1))).prompt, 'least');
  assert.equal(happinessQuestion.generate(pool, undefined, firstThen(0.9, seeded(1))).prompt, 'most');
});

test('happinessQuestion: the unsurveyed no-data places are excluded from selection', async () => {
  const { happinessQuestion } = await import('./superlative.js');
  const happyJson = (await import('../metrics/happiness.json', { with: { type: 'json' } })).default;
  const HAPPY = /** @type {Record<string, number>} */ (happyJson.values);
  // Four covered places plus codes Gallup does not survey (a sub-national part
  // and polar territories, all absent from happiness.json, absence:'unknown').
  // Those must never surface as an option: the question's metric.has drops them.
  const covered = ['fi', 'dk', 'us', 'jp'];
  const noData = ['gb-wls', 'aq', 'gl'].filter((code) => !(code in HAPPY));
  assert.ok(noData.length >= 1, 'expected at least one uncovered code for the test');
  const pool = [...covered, ...noData].map((code) => ({ code }));
  for (let i = 0; i < 100; i++) {
    const q = happinessQuestion.generate(pool, undefined, seeded(i + 1));
    for (const opt of q.options) assert.ok(!noData.includes(opt), `no-data place ${opt} must be excluded`);
  }
});

// ---- corruption instance (CPI 0-100, id 'superlative-corruption') -----------

test('corruptionQuestion: two-directional, the extreme CPI is the answer, scored places only', async () => {
  const { corruptionQuestion } = await import('./superlative.js');
  const corrJson = (await import('../metrics/corruption.json', { with: { type: 'json' } })).default;
  const CORR = /** @type {Record<string, number>} */ (corrJson.values);
  assert.equal(corruptionQuestion.id, 'superlative-corruption');
  // CPI-distinct sovereigns spanning clean to corrupt, all scored by TI.
  const pool = ['dk', 'fi', 'sg', 'de', 'us', 'jp', 'br', 'in', 'mx', 'ru', 'ng', 'ke'].map((code) => ({ code }));
  for (const c of pool) assert.ok(c.code in CORR, `${c.code} must be scored by corruption.json`);
  for (let i = 0; i < 100; i++) {
    const q = corruptionQuestion.generate(pool, undefined, seeded(i + 1));
    assert.equal(q.options.length, 4);
    assert.ok(q.options.includes(q.answer), 'answer among options');
    const vals = q.options.map((c) => CORR[c]);
    // Question 'most' picks the HIGHEST CPI (shown as "Least corrupt"); 'least'
    // picks the LOWEST CPI (shown as "Most corrupt"). The value comparison here
    // is by CPI, not by the inverted hint wording.
    const extreme = q.prompt === 'most' ? Math.max(...vals) : Math.min(...vals);
    assert.equal(CORR[q.answer], extreme, `seed ${i}: answer must be the ${q.prompt}-CPI option`);
  }
  // Two-directional: both extremes get dealt (the hint layer inverts the CPI
  // orientation into "Most corrupt" / "Least corrupt").
  const firstThen = (/** @type {number} */ first, /** @type {() => number} */ rest) => {
    let n = 0;
    return () => (n++ === 0 ? first : rest());
  };
  assert.equal(corruptionQuestion.generate(pool, undefined, firstThen(0.1, seeded(1))).prompt, 'least');
  assert.equal(corruptionQuestion.generate(pool, undefined, firstThen(0.9, seeded(1))).prompt, 'most');
});

test('corruptionQuestion: the unscored no-data places are excluded from selection', async () => {
  const { corruptionQuestion } = await import('./superlative.js');
  const corrJson = (await import('../metrics/corruption.json', { with: { type: 'json' } })).default;
  const CORR = /** @type {Record<string, number>} */ (corrJson.values);
  // Four scored places plus codes TI does not score (a sub-national part and
  // polar territories, absent from corruption.json). Those must never surface.
  const scored = ['dk', 'fi', 'sg', 'de'];
  const noData = ['gb-wls', 'aq', 'gl'].filter((code) => !(code in CORR));
  assert.ok(noData.length >= 1, 'expected at least one unscored code for the test');
  const pool = [...scored, ...noData].map((code) => ({ code }));
  for (let i = 0; i < 100; i++) {
    const q = corruptionQuestion.generate(pool, undefined, seeded(i + 1));
    for (const opt of q.options) assert.ok(!noData.includes(opt), `no-data place ${opt} must be excluded`);
  }
});

// ---- coastline instance (km of coast, id 'superlative-coastline') -----------

test('coastlineQuestion: two-directional over coastal places, correct extreme answer', async () => {
  const { coastlineQuestion } = await import('./superlative.js');
  const coastJson = (await import('../metrics/coastline.json', { with: { type: 'json' } })).default;
  const COAST = /** @type {Record<string, number>} */ (coastJson.values);
  assert.equal(coastlineQuestion.id, 'superlative-coastline');
  // Coastal sovereigns spanning four orders of magnitude (Canada 202,080 ...
  // Monaco 4). All strictly > 0, so none is filtered out of the question's pool.
  const pool = ['ca', 'id', 'no', 'us', 'gb', 'mx', 'it', 'fr', 'de', 'mc', 'gi', 'be'].map((code) => ({ code }));
  for (let i = 0; i < 100; i++) {
    const q = coastlineQuestion.generate(pool, undefined, seeded(i + 1));
    assert.equal(q.options.length, 4);
    assert.ok(q.options.includes(q.answer), 'answer among options');
    const vals = q.options.map((c) => COAST[c]);
    const extreme = q.prompt === 'most' ? Math.max(...vals) : Math.min(...vals);
    assert.equal(COAST[q.answer], extreme, `seed ${i}: answer must be the ${q.prompt}-coastline option`);
  }
});

test('coastlineQuestion: landlocked (0 km) places are excluded from selection', async () => {
  const { coastlineQuestion } = await import('./superlative.js');
  // The question metric is zero-filtered, so a landlocked code never has a value:
  // even a pool of all-landlocked places falls back to nothing usable and would
  // never surface one as an answer. Give a mixed pool and prove no landlocked
  // code ever appears as an option.
  const landlocked = new Set(['ch', 'at', 'bo', 'np', 'xk', 'hu', 'rs', 'ml', 'td']);
  const pool = ['ca', 'no', 'gb', 'it', 'ch', 'at', 'bo', 'np', 'xk', 'hu'].map((code) => ({ code }));
  for (let i = 0; i < 100; i++) {
    const q = coastlineQuestion.generate(pool, undefined, seeded(i + 1));
    for (const opt of q.options) {
      assert.ok(!landlocked.has(opt), `seed ${i}: landlocked ${opt} must not be an option`);
    }
  }
});

// ---- forest instance (% of land area, id 'superlative-forest') --------------

test('forestQuestion: two-directional over forested places, correct extreme answer', async () => {
  const { forestQuestion } = await import('./superlative.js');
  const forestJson = (await import('../metrics/forest.json', { with: { type: 'json' } })).default;
  const FOREST = /** @type {Record<string, number>} */ (forestJson.values);
  assert.equal(forestQuestion.id, 'superlative-forest');
  // Forested sovereigns with distinct values spanning the range (Suriname 94.5%
  // ... Ireland 11.5%). All strictly > 0, so none is filtered out of the question.
  const pool = ['sr', 'fi', 'jp', 'br', 'ru', 'us', 'cn', 'au', 'ma', 'ie'].map((code) => ({ code }));
  for (let i = 0; i < 100; i++) {
    const q = forestQuestion.generate(pool, undefined, seeded(i + 1));
    assert.equal(q.options.length, 4);
    assert.ok(q.options.includes(q.answer), 'answer among options');
    const vals = q.options.map((c) => FOREST[c]);
    const extreme = q.prompt === 'most' ? Math.max(...vals) : Math.min(...vals);
    assert.equal(FOREST[q.answer], extreme, `seed ${i}: answer must be the ${q.prompt}-forested option`);
  }
});

test('forestQuestion: treeless (0%) places are excluded from selection', async () => {
  const { forestQuestion } = await import('./superlative.js');
  // The question metric is zero-filtered, so a treeless code (desert / ice /
  // city-state at 0.0%) never has a value. Give a mixed pool and prove no
  // treeless code ever surfaces as an option.
  const treeless = new Set(['eg', 'qa', 'gl', 'mc', 'va', 'om', 'nr']);
  const pool = ['fi', 'br', 'ru', 'us', 'eg', 'qa', 'gl', 'mc', 'va', 'om'].map((code) => ({ code }));
  for (let i = 0; i < 100; i++) {
    const q = forestQuestion.generate(pool, undefined, seeded(i + 1));
    for (const opt of q.options) {
      assert.ok(!treeless.has(opt), `seed ${i}: treeless ${opt} must not be an option`);
    }
  }
});

// ---- oil instance (oil production in TWh, id 'superlative-oil') --------------

test('oilQuestion: biggest-only, correct extreme-by-oil answer, producers only', async () => {
  const { oilQuestion } = await import('./superlative.js');
  const oilJson = (await import('../metrics/oil.json', { with: { type: 'json' } })).default;
  const OIL = /** @type {Record<string, number>} */ (oilJson.values);
  assert.equal(oilQuestion.id, 'superlative-oil');
  // Oil-distinct sovereign PRODUCERS spanning many orders of magnitude, all in
  // oil.json. A non-producer (e.g. Switzerland) mixed in must be dropped by the
  // question's `metric.has` filter, never appear as an option.
  const pool = ['us', 'ru', 'sa', 'cn', 'no', 'qa', 'ch'].map((code) => ({ code }));
  for (let i = 0; i < 100; i++) {
    const q = oilQuestion.generate(pool, undefined, seeded(i + 1));
    assert.equal(q.options.length, 4);
    // Oil is locked to 'most'; every question asks for the biggest producer.
    assert.equal(q.prompt, 'most', `seed ${i}: oil is biggest-only, never 'least'`);
    assert.ok(q.options.includes(q.answer), 'answer among options');
    assert.ok(!q.options.includes('ch'), 'a non-producer is never an option (sparse metric.has filter)');
    const vals = q.options.map((c) => OIL[c]);
    assert.equal(OIL[q.answer], Math.max(...vals), `seed ${i}: answer must be the biggest-oil option`);
  }
});

// ---- rice instance (rice paddy tonnes, id 'superlative-rice') ---------------

test('riceQuestion: biggest-only, correct extreme-by-rice answer, growers only', async () => {
  const { riceQuestion } = await import('./superlative.js');
  const riceJson = (await import('../metrics/rice.json', { with: { type: 'json' } })).default;
  const RICE = /** @type {Record<string, number>} */ (riceJson.values);
  assert.equal(riceQuestion.id, 'superlative-rice');
  // Rice-distinct sovereign GROWERS spanning many orders of magnitude, all in
  // rice.json. A non-grower (e.g. Canada) mixed in must be dropped by the question's
  // `metric.has` filter, never appear as an option.
  const pool = ['in', 'cn', 'id', 'vn', 'th', 'jp', 'it', 'ca'].map((code) => ({ code }));
  for (let i = 0; i < 100; i++) {
    const q = riceQuestion.generate(pool, undefined, seeded(i + 1));
    assert.equal(q.options.length, 4);
    // Rice is locked to 'most'; every question asks for the biggest grower.
    assert.equal(q.prompt, 'most', `seed ${i}: rice is biggest-only, never 'least'`);
    assert.ok(q.options.includes(q.answer), 'answer among options');
    assert.ok(!q.options.includes('ca'), 'a non-grower is never an option (sparse metric.has filter)');
    const vals = q.options.map((c) => RICE[c]);
    assert.equal(RICE[q.answer], Math.max(...vals), `seed ${i}: answer must be the biggest-rice option`);
  }
});

// ---- coal instance (coal production in TWh, id 'superlative-coal') -----------

test('coalQuestion: biggest-only, correct extreme-by-coal answer, producers only', async () => {
  const { coalQuestion } = await import('./superlative.js');
  const coalJson = (await import('../metrics/coal.json', { with: { type: 'json' } })).default;
  const COAL = /** @type {Record<string, number>} */ (coalJson.values);
  assert.equal(coalQuestion.id, 'superlative-coal');
  // Coal-distinct sovereign PRODUCERS spanning many orders of magnitude, all in
  // coal.json. A non-producer (e.g. France) mixed in must be dropped by the
  // question's `metric.has` filter, never appear as an option.
  const pool = ['cn', 'in', 'id', 'au', 'us', 'ru', 'za', 'fr'].map((code) => ({ code }));
  for (let i = 0; i < 100; i++) {
    const q = coalQuestion.generate(pool, undefined, seeded(i + 1));
    assert.equal(q.options.length, 4);
    // Coal is locked to 'most'; every question asks for the biggest producer.
    assert.equal(q.prompt, 'most', `seed ${i}: coal is biggest-only, never 'least'`);
    assert.ok(q.options.includes(q.answer), 'answer among options');
    assert.ok(!q.options.includes('fr'), 'a non-producer is never an option (sparse metric.has filter)');
    const vals = q.options.map((c) => COAL[c]);
    assert.equal(COAL[q.answer], Math.max(...vals), `seed ${i}: answer must be the biggest-coal option`);
  }
});

// ---- sheep-per-capita instance (sheep/person, id 'superlative-sheep') --------

test('sheepPerCapitaQuestion: most-only, correct biggest-per-person answer, sheep-raising only', async () => {
  const { sheepPerCapitaQuestion } = await import('./superlative.js');
  const sheepJson = (await import('../metrics/sheepPerCapita.json', { with: { type: 'json' } })).default;
  const SHEEP = /** @type {Record<string, number>} */ (sheepJson.values);
  assert.equal(sheepPerCapitaQuestion.id, 'superlative-sheep');
  // Sheep-raising sovereigns with distinct values spanning the range (Mongolia
  // 7.0 ... Norway 0.39). All strictly > 0, so none is filtered out of the question.
  const pool = ['mn', 'nz', 'au', 'td', 'uy', 'is', 'ie', 'ro', 'gb', 'no'].map((code) => ({ code }));
  for (let i = 0; i < 100; i++) {
    const q = sheepPerCapitaQuestion.generate(pool, undefined, seeded(i + 1));
    assert.equal(q.options.length, 4);
    // Locked to 'most': every question asks for the biggest, never 'least'.
    assert.equal(q.prompt, 'most', `seed ${i}: sheep per capita is most-only, never 'least'`);
    assert.ok(q.options.includes(q.answer), 'answer among options');
    const vals = q.options.map((c) => SHEEP[c]);
    assert.equal(SHEEP[q.answer], Math.max(...vals), `seed ${i}: answer must be the most sheep-per-person option`);
  }
});

test('sheepPerCapitaQuestion: no-sheep (0) places are excluded from selection', async () => {
  const { sheepPerCapitaQuestion } = await import('./superlative.js');
  // The question metric is zero-filtered, so a place with no sheep (Singapore,
  // Japan's negligible flock rounding to 0, Korea, Panama) never has a value.
  // Give a mixed pool and prove no such code ever surfaces as an option.
  const noSheep = new Set(['sg', 'jp', 'kr', 'pa']);
  const pool = ['mn', 'nz', 'au', 'uy', 'sg', 'jp', 'kr', 'pa'].map((code) => ({ code }));
  for (let i = 0; i < 100; i++) {
    const q = sheepPerCapitaQuestion.generate(pool, undefined, seeded(i + 1));
    for (const opt of q.options) {
      assert.ok(!noSheep.has(opt), `seed ${i}: no-sheep ${opt} must not be an option`);
    }
  }
});

// ---- cattle-per-capita instance (cattle/person, id 'superlative-cattle') -----

test('cattlePerCapitaQuestion: most-only, correct biggest-per-person answer, cattle-raising only', async () => {
  const { cattlePerCapitaQuestion } = await import('./superlative.js');
  const cattleJson = (await import('../metrics/cattlePerCapita.json', { with: { type: 'json' } })).default;
  const CATTLE = /** @type {Record<string, number>} */ (cattleJson.values);
  assert.equal(cattlePerCapitaQuestion.id, 'superlative-cattle');
  // Cattle-raising sovereigns with distinct values spanning the range (Uruguay
  // 3.53 ... France 0.24). All strictly > 0, so none is filtered out of the question.
  const pool = ['uy', 'td', 'py', 'nz', 'mn', 'ie', 'ar', 'au', 'br', 'fr'].map((code) => ({ code }));
  for (let i = 0; i < 100; i++) {
    const q = cattlePerCapitaQuestion.generate(pool, undefined, seeded(i + 1));
    assert.equal(q.options.length, 4);
    // Locked to 'most': every question asks for the biggest, never 'least'.
    assert.equal(q.prompt, 'most', `seed ${i}: cattle per capita is most-only, never 'least'`);
    assert.ok(q.options.includes(q.answer), 'answer among options');
    const vals = q.options.map((c) => CATTLE[c]);
    assert.equal(CATTLE[q.answer], Math.max(...vals), `seed ${i}: answer must be the most cattle-per-person option`);
  }
});

test('cattlePerCapitaQuestion: no-cattle (0) places are excluded from selection', async () => {
  const { cattlePerCapitaQuestion } = await import('./superlative.js');
  // The question metric is zero-filtered, so a place with no cattle (Singapore,
  // Monaco, Hong Kong, Vatican) never has a value. Give a mixed pool and prove
  // no such code ever surfaces as an option.
  const noCattle = new Set(['sg', 'mc', 'hk', 'va']);
  const pool = ['uy', 'nz', 'au', 'br', 'sg', 'mc', 'hk', 'va'].map((code) => ({ code }));
  for (let i = 0; i < 100; i++) {
    const q = cattlePerCapitaQuestion.generate(pool, undefined, seeded(i + 1));
    for (const opt of q.options) {
      assert.ok(!noCattle.has(opt), `seed ${i}: no-cattle ${opt} must not be an option`);
    }
  }
});

// ---- beer-per-capita instance (litres of beer/person, id 'superlative-beer') --

test('beerPerCapitaQuestion: most-only, correct biggest-per-person answer, beer-drinking only', async () => {
  const { beerPerCapitaQuestion } = await import('./superlative.js');
  const beerJson = (await import('../metrics/beerPerCapita.json', { with: { type: 'json' } })).default;
  const BEER = /** @type {Record<string, number>} */ (beerJson.values);
  assert.equal(beerPerCapitaQuestion.id, 'superlative-beer');
  // Beer-drinking sovereigns spanning the range (Czechia ~131 ... Japan ~26).
  // All strictly > 0, so none is filtered out of the question.
  const pool = ['cz', 'at', 'de', 'pl', 'br', 'us', 'gb', 'fr', 'it', 'jp'].map((code) => ({ code }));
  for (let i = 0; i < 100; i++) {
    const q = beerPerCapitaQuestion.generate(pool, undefined, seeded(i + 1));
    assert.equal(q.options.length, 4);
    // Locked to 'most': every question asks for the biggest, never 'least'.
    assert.equal(q.prompt, 'most', `seed ${i}: beer per capita is most-only, never 'least'`);
    assert.ok(q.options.includes(q.answer), 'answer among options');
    const vals = q.options.map((c) => BEER[c]);
    assert.equal(BEER[q.answer], Math.max(...vals), `seed ${i}: answer must be the most beer-per-person option`);
  }
});

test('beerPerCapitaQuestion: dry (0) and unknown-gap places are excluded from selection', async () => {
  const { beerPerCapitaQuestion } = await import('./superlative.js');
  // Zero-filtered, so the dry states (Saudi Arabia, Iran, Kuwait, Libya) never
  // have a value; and the absence:'unknown' gap (Wales, Greenland) has none
  // either. Neither should ever surface as an option.
  const excluded = new Set(['sa', 'ir', 'kw', 'ly', 'gb-wls', 'gl']);
  const pool = ['cz', 'de', 'pl', 'br', 'sa', 'ir', 'kw', 'ly', 'gb-wls', 'gl'].map((code) => ({ code }));
  for (let i = 0; i < 100; i++) {
    const q = beerPerCapitaQuestion.generate(pool, undefined, seeded(i + 1));
    for (const opt of q.options) {
      assert.ok(!excluded.has(opt), `seed ${i}: excluded ${opt} must not be an option`);
    }
  }
});

// ---- alcohol-per-capita instance (litres of pure alcohol, 'superlative-alcohol')

test('alcoholPerCapitaQuestion: most-only, correct biggest-per-person answer', async () => {
  const { alcoholPerCapitaQuestion } = await import('./superlative.js');
  const alcJson = (await import('../metrics/alcoholPerCapita.json', { with: { type: 'json' } })).default;
  const ALC = /** @type {Record<string, number>} */ (alcJson.values);
  assert.equal(alcoholPerCapitaQuestion.id, 'superlative-alcohol');
  // Drinking sovereigns spanning the range (Lithuania high ... Italy lower).
  const pool = ['lt', 'ie', 'de', 'fr', 'pl', 'us', 'gb', 'it', 'br', 'jp'].map((code) => ({ code }));
  for (let i = 0; i < 100; i++) {
    const q = alcoholPerCapitaQuestion.generate(pool, undefined, seeded(i + 1));
    assert.equal(q.options.length, 4);
    assert.equal(q.prompt, 'most'); // locked to 'most'
    const answerVal = ALC[q.answer];
    for (const opt of q.options) assert.ok(answerVal >= ALC[opt], `seed ${i}: ${q.answer} not the biggest`);
  }
});

test('alcoholPerCapitaQuestion: dry (0) and unknown-gap places are excluded from selection', async () => {
  const { alcoholPerCapitaQuestion } = await import('./superlative.js');
  // Fully-dry (recorded 0) states + the absence:'unknown' gap (Wales, Greenland).
  const excluded = new Set(['ir', 'kw', 'ly', 'af', 'gb-wls', 'gl']);
  const pool = ['lt', 'de', 'pl', 'br', 'ir', 'kw', 'ly', 'af', 'gb-wls', 'gl'].map((code) => ({ code }));
  for (let i = 0; i < 100; i++) {
    const q = alcoholPerCapitaQuestion.generate(pool, undefined, seeded(i + 1));
    for (const opt of q.options) {
      assert.ok(!excluded.has(opt), `seed ${i}: excluded ${opt} must not be an option`);
    }
  }
});

// ---- meat-per-capita instance (kg of meat, 'superlative-meat') --------------

test('meatPerCapitaQuestion: most-only, correct biggest-per-person answer', async () => {
  const { meatPerCapitaQuestion } = await import('./superlative.js');
  const meatJson = (await import('../metrics/meatPerCapita.json', { with: { type: 'json' } })).default;
  const MEAT = /** @type {Record<string, number>} */ (meatJson.values);
  assert.equal(meatPerCapitaQuestion.id, 'superlative-meat');
  const pool = ['us', 'au', 'ar', 'de', 'fr', 'cn', 'jp', 'in', 'et', 'ng'].map((code) => ({ code }));
  for (let i = 0; i < 100; i++) {
    const q = meatPerCapitaQuestion.generate(pool, undefined, seeded(i + 1));
    assert.equal(q.options.length, 4);
    assert.equal(q.prompt, 'most');
    const answerVal = MEAT[q.answer];
    for (const opt of q.options) assert.ok(answerVal >= MEAT[opt], `seed ${i}: ${q.answer} not the biggest`);
  }
});

// ---- borders instance (land borders, 'superlative-borders') -----------------

test('bordersQuestion: most-only, correct biggest-border answer, islands excluded', async () => {
  const { bordersQuestion } = await import('./superlative.js');
  const borJson = (await import('../metrics/borders.json', { with: { type: 'json' } })).default;
  const BOR = /** @type {Record<string, number>} */ (borJson.values);
  assert.equal(bordersQuestion.id, 'superlative-borders');
  // Land-bordered countries spanning the range (China 14 ... Portugal 1).
  const pool = ['cn', 'ru', 'br', 'de', 'fr', 'pl', 'es', 'us', 'ie', 'pt'].map((code) => ({ code }));
  for (let i = 0; i < 100; i++) {
    const q = bordersQuestion.generate(pool, undefined, seeded(i + 1));
    assert.equal(q.options.length, 4);
    assert.equal(q.prompt, 'most');
    const answerVal = BOR[q.answer];
    for (const opt of q.options) assert.ok(answerVal >= BOR[opt], `seed ${i}: ${q.answer} not the most-bordered`);
  }
});

test('bordersQuestion: 0-border islands are excluded from selection', async () => {
  const { bordersQuestion } = await import('./superlative.js');
  const excluded = new Set(['is', 'jp', 'au', 'nz']); // all border nobody (value 0)
  const pool = ['cn', 'ru', 'de', 'fr', 'is', 'jp', 'au', 'nz'].map((code) => ({ code }));
  for (let i = 0; i < 100; i++) {
    const q = bordersQuestion.generate(pool, undefined, seeded(i + 1));
    for (const opt of q.options) {
      assert.ok(!excluded.has(opt), `seed ${i}: island ${opt} must not be an option`);
    }
  }
});

// ---- tourism-per-capita instance (arrivals per resident, 'superlative-tourism')

test('tourismPerCapitaQuestion: most-only, correct biggest-per-resident answer', async () => {
  const { tourismPerCapitaQuestion } = await import('./superlative.js');
  const tourJson = (await import('../metrics/tourismPerCapita.json', { with: { type: 'json' } })).default;
  const TOUR = /** @type {Record<string, number>} */ (tourJson.values);
  assert.equal(tourismPerCapitaQuestion.id, 'superlative-tourism');
  // Sovereigns spanning the range (Croatia high ... India near zero). All > 0.
  const pool = ['hr', 'me', 'is', 'gr', 'es', 'fr', 'us', 'cn', 'in', 'br'].map((code) => ({ code }));
  for (let i = 0; i < 100; i++) {
    const q = tourismPerCapitaQuestion.generate(pool, undefined, seeded(i + 1));
    assert.equal(q.options.length, 4);
    assert.equal(q.prompt, 'most', `seed ${i}: tourism per capita is most-only, never 'least'`);
    assert.ok(q.options.includes(q.answer), 'answer among options');
    const answerVal = TOUR[q.answer];
    for (const opt of q.options) assert.ok(answerVal >= TOUR[opt], `seed ${i}: ${q.answer} not the biggest`);
  }
});

test('tourismPerCapitaQuestion: zero and unknown-gap places are excluded from selection', async () => {
  const { tourismPerCapitaQuestion } = await import('./superlative.js');
  // Zero-filtered, so the ~0-arrival places (Bangladesh, Chad question to 0) never
  // have a value; and the absence:'unknown' gap (North Korea, Venezuela) has none.
  const excluded = new Set(['bd', 'td', 'kp', 've']);
  const pool = ['hr', 'is', 'gr', 'es', 'bd', 'td', 'kp', 've'].map((code) => ({ code }));
  for (let i = 0; i < 100; i++) {
    const q = tourismPerCapitaQuestion.generate(pool, undefined, seeded(i + 1));
    for (const opt of q.options) {
      assert.ok(!excluded.has(opt), `seed ${i}: excluded ${opt} must not be an option`);
    }
  }
});

// ---- electricity-per-capita instance (kWh per person, 'superlative-electricity')

test('electricityPerCapitaQuestion: most-only, correct biggest-per-person answer', async () => {
  const { electricityPerCapitaQuestion } = await import('./superlative.js');
  const elecJson = (await import('../metrics/electricityPerCapita.json', { with: { type: 'json' } })).default;
  const ELEC = /** @type {Record<string, number>} */ (elecJson.values);
  assert.equal(electricityPerCapitaQuestion.id, 'superlative-electricity');
  // Sovereigns spanning the range (Iceland ~49k ... Chad ~14). All > 0.
  const pool = ['is', 'no', 'qa', 'us', 'cn', 'fr', 'de', 'in', 'et', 'td'].map((code) => ({ code }));
  for (let i = 0; i < 100; i++) {
    const q = electricityPerCapitaQuestion.generate(pool, undefined, seeded(i + 1));
    assert.equal(q.options.length, 4);
    assert.equal(q.prompt, 'most', `seed ${i}: electricity per capita is most-only, never 'least'`);
    assert.ok(q.options.includes(q.answer), 'answer among options');
    const answerVal = ELEC[q.answer];
    for (const opt of q.options) assert.ok(answerVal >= ELEC[opt], `seed ${i}: ${q.answer} not the biggest`);
  }
});

test('electricityPerCapitaQuestion: unknown-gap places are excluded from selection', async () => {
  const { electricityPerCapitaQuestion } = await import('./superlative.js');
  // The absence:'unknown' gap (the micro-states the World Bank does not meter:
  // Andorra, Monaco, Liechtenstein) has no value and must never surface.
  const excluded = new Set(['ad', 'mc', 'li']);
  const pool = ['is', 'no', 'us', 'de', 'ad', 'mc', 'li'].map((code) => ({ code }));
  for (let i = 0; i < 100; i++) {
    const q = electricityPerCapitaQuestion.generate(pool, undefined, seeded(i + 1));
    for (const opt of q.options) {
      assert.ok(!excluded.has(opt), `seed ${i}: excluded ${opt} must not be an option`);
    }
  }
});

test('mcdonaldsPerMillionQuestion: most-only, correct most-per-person answer', async () => {
  const { mcdonaldsPerMillionQuestion } = await import('./superlative.js');
  const mcdJson = (await import('../metrics/mcdonaldsPerMillion.json', { with: { type: 'json' } })).default;
  const MCD = /** @type {Record<string, number>} */ (mcdJson.values);
  assert.equal(mcdonaldsPerMillionQuestion.id, 'superlative-mcdonalds');
  // Sovereigns spanning the range (Australia ~41 ... India ~0.5). All > 0.
  const pool = ['au', 'us', 'ca', 'nz', 'jp', 'fr', 'de', 'br', 'cn', 'in'].map((code) => ({ code }));
  for (let i = 0; i < 100; i++) {
    const q = mcdonaldsPerMillionQuestion.generate(pool, undefined, seeded(i + 1));
    assert.equal(q.options.length, 4);
    assert.equal(q.prompt, 'most', `seed ${i}: McDonald's density is most-only, never 'least'`);
    assert.ok(q.options.includes(q.answer), 'answer among options');
    const answerVal = MCD[q.answer];
    for (const opt of q.options) assert.ok(answerVal >= MCD[opt], `seed ${i}: ${q.answer} not the biggest`);
  }
});

test('mcdonaldsPerMillionQuestion: zeroFiltered keeps McDonald\'s-free countries out', async () => {
  const { mcdonaldsPerMillionQuestion } = await import('./superlative.js');
  // THE test for this metric. Real zeros are the majority of values here (151 of
  // 248), so without zeroFiltered a quartet would routinely be four countries
  // tied at 0 with no answer. These all carry an explicit 0, not a gap, so
  // `metric.has` is true for them and only the zero filter can exclude them.
  const excluded = new Set(['is', 'bo', 'ru', 'ir', 'kp', 'ng', 'bd']);
  const pool = ['au', 'us', 'ca', 'nz', 'is', 'bo', 'ru', 'ir', 'kp', 'ng', 'bd'].map((code) => ({ code }));
  for (let i = 0; i < 100; i++) {
    const q = mcdonaldsPerMillionQuestion.generate(pool, undefined, seeded(i + 1));
    for (const opt of q.options) {
      assert.ok(!excluded.has(opt), `seed ${i}: zero-valued ${opt} must not be an option`);
    }
  }
});

test('mcdonaldsPerMillionQuestion: folded markets are excluded as unknown, not ranked at zero', async () => {
  const { mcdonaldsPerMillionQuestion } = await import('./superlative.js');
  // Monaco / Andorra / Liechtenstein DO have McDonald's, folded into France /
  // Spain / Switzerland's reported rows. They carry no value, so they must never
  // surface. Distinct from the zero case above: these are excluded by `has`.
  const excluded = new Set(['mc', 'ad', 'li']);
  const pool = ['au', 'us', 'ca', 'nz', 'jp', 'mc', 'ad', 'li'].map((code) => ({ code }));
  for (let i = 0; i < 100; i++) {
    const q = mcdonaldsPerMillionQuestion.generate(pool, undefined, seeded(i + 1));
    for (const opt of q.options) {
      assert.ok(!excluded.has(opt), `seed ${i}: folded market ${opt} must not be an option`);
    }
  }
});

test('nobelQuestion: most-only, correct most-laureates answer', async () => {
  const { nobelQuestion } = await import('./superlative.js');
  const nobelJson = (await import('../metrics/nobel.json', { with: { type: 'json' } })).default;
  const N = /** @type {Record<string, number>} */ (nobelJson.values);
  assert.equal(nobelQuestion.id, 'superlative-nobel');
  // Sovereigns spanning the range (US 297 ... Iceland 1). All > 0.
  const pool = ['us', 'gb', 'de', 'fr', 'jp', 'se', 'pl', 'in', 'eg', 'is'].map((code) => ({ code }));
  for (let i = 0; i < 100; i++) {
    const q = nobelQuestion.generate(pool, undefined, seeded(i + 1));
    assert.equal(q.options.length, 4);
    assert.equal(q.prompt, 'most', `seed ${i}: Nobel count is most-only, never 'least'`);
    assert.ok(q.options.includes(q.answer), 'answer among options');
    const answerVal = N[q.answer];
    for (const opt of q.options) assert.ok(answerVal >= N[opt], `seed ${i}: ${q.answer} not the biggest`);
  }
});

test('nobelQuestion: zeroFiltered keeps laureate-free countries out', async () => {
  const { nobelQuestion } = await import('./superlative.js');
  // THE test for this metric. True zeros are the MAJORITY (172 of 262 real
  // places), so without zeroFiltered a quartet would routinely be four countries
  // tied at 0 with no answer. These carry an explicit 0, not a gap, so `has` is
  // true for them and only the zero filter can exclude them.
  const excluded = new Set(['mn', 'kh', 'bo', 'pg', 'tm', 'fj']);
  const pool = ['us', 'gb', 'de', 'se', 'mn', 'kh', 'bo', 'pg', 'tm', 'fj'].map((code) => ({ code }));
  for (let i = 0; i < 100; i++) {
    const q = nobelQuestion.generate(pool, undefined, seeded(i + 1));
    for (const opt of q.options) {
      assert.ok(!excluded.has(opt), `seed ${i}: zero-valued ${opt} must not be an option`);
    }
  }
});

test('nobelPerCapitaQuestion: the #1 is not the country with the most laureates', async () => {
  const { nobelPerCapitaQuestion } = await import('./superlative.js');
  const pcJson = (await import('../metrics/nobelPerCapita.json', { with: { type: 'json' } })).default;
  const PC = /** @type {Record<string, number>} */ (pcJson.values);
  assert.equal(nobelPerCapitaQuestion.id, 'superlative-nobel-pc');
  // The whole point of the intensive cut: against the US, Sweden wins on rate
  // despite the US having ten times as many laureates.
  assert.ok(PC.se > PC.us, 'Sweden must out-rank the US per capita');
  const pool = ['us', 'gb', 'de', 'fr', 'jp', 'se', 'ch', 'no', 'dk', 'at'].map((code) => ({ code }));
  for (let i = 0; i < 100; i++) {
    const q = nobelPerCapitaQuestion.generate(pool, undefined, seeded(i + 1));
    assert.equal(q.prompt, 'most', `seed ${i}: per-capita Nobel is most-only`);
    const answerVal = PC[q.answer];
    for (const opt of q.options) assert.ok(answerVal >= PC[opt], `seed ${i}: ${q.answer} not the biggest`);
  }
});

test('nobelPerCapitaQuestion: zeroFiltered, same true-zero majority as the count', async () => {
  const { nobelPerCapitaQuestion } = await import('./superlative.js');
  const excluded = new Set(['mn', 'kh', 'bo', 'pg', 'tm', 'fj']);
  const pool = ['se', 'ch', 'no', 'dk', 'mn', 'kh', 'bo', 'pg', 'tm', 'fj'].map((code) => ({ code }));
  for (let i = 0; i < 100; i++) {
    const q = nobelPerCapitaQuestion.generate(pool, undefined, seeded(i + 1));
    for (const opt of q.options) {
      assert.ok(!excluded.has(opt), `seed ${i}: zero-valued ${opt} must not be an option`);
    }
  }
});
