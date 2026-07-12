import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { createMetric } from './metrics.js';
import { attachCoffees } from './group.js';

/** @typedef {{ code: string, continent: string, statehood: string, category?: string }} Row */

const HERE = dirname(fileURLToPath(import.meta.url));
const load = (/** @type {string} */ p) => JSON.parse(readFileSync(join(HERE, p), 'utf-8'));
const COUNTRIES = /** @type {Row[]} */ (load('countries.json'));
const POPULATION = /** @type {import('./metrics.js').MetricData} */ (load('metrics/population.json'));
const AREA = /** @type {import('./metrics.js').MetricData} */ (load('metrics/area.json'));
const DENSITY = /** @type {import('./metrics.js').MetricData} */ (load('metrics/density.json'));
const GDP = /** @type {import('./metrics.js').MetricData} */ (load('metrics/gdp.json'));
const GDP_PER_CAPITA = /** @type {import('./metrics.js').MetricData} */ (load('metrics/gdpPerCapita.json'));
const COFFEE = /** @type {import('./metrics.js').MetricData} */ (load('metrics/coffee.json'));

// ---- fixture-driven logic (small, hand-checkable) --------------------------

/** 6 places: 4 UN members split across two continents, plus a territory. */
const FIX_COUNTRIES = [
  { code: 'aa', continent: 'Europe', statehood: 'un_member' },
  { code: 'bb', continent: 'Europe', statehood: 'un_member' },
  { code: 'cc', continent: 'Europe', statehood: 'territory' },
  { code: 'dd', continent: 'Asia', statehood: 'un_member' },
  { code: 'ee', continent: 'Asia', statehood: 'un_member' },
  { code: 'ff', continent: 'Asia', statehood: 'un_member' }, // no value
];
// ff has no value on purpose — the map is sparse.
const FIX = {
  key: 'fix',
  label: 'Fixture',
  unit: 'things',
  source: 'test',
  year: 2000,
  values: { aa: 100, bb: 50, cc: 40, dd: 30, ee: 30 },
};

const fx = createMetric(FIX, FIX_COUNTRIES);

test('valueOf / has respect the sparse value map', () => {
  assert.equal(fx.valueOf('aa'), 100);
  assert.equal(fx.has('aa'), true);
  assert.equal(fx.valueOf('ff'), undefined);
  assert.equal(fx.has('ff'), false);
});

test('ranked(world) is highest-first, ties broken by code', () => {
  assert.deepEqual(
    fx.ranked('world').map((r) => r.code),
    ['aa', 'bb', 'cc', 'dd', 'ee'], // dd/ee tie at 30 → dd before ee by code
  );
});

test('scope filters by continent and by UN membership', () => {
  assert.deepEqual(
    fx.ranked('Europe').map((r) => r.code),
    ['aa', 'bb', 'cc'],
  );
  assert.deepEqual(
    fx.ranked('un_member').map((r) => r.code),
    ['aa', 'bb', 'dd', 'ee'], // cc is a territory → excluded
  );
});

test('sovereign scope keeps observers, drops territories and non-UN states', () => {
  const rows = [
    { code: 'aa', continent: 'Europe', statehood: 'un_member' },
    { code: 'va', continent: 'Europe', statehood: 'un_observer' }, // sovereign (observer)
    { code: 'xk', continent: 'Europe', statehood: 'non_un' },      // not sovereign
    { code: 'cc', continent: 'Europe', statehood: 'territory' },   // not sovereign
    { code: 'oo', continent: 'Europe', category: 'other' },        // org flag, not sovereign
  ];
  const m = createMetric(
    { key: 'm', label: 'M', unit: 'u', source: 't', year: 2000,
      values: { aa: 100, va: 90, xk: 80, cc: 70, oo: 60 } },
    rows,
  );
  assert.deepEqual(m.ranked('sovereign').map((r) => r.code), ['aa', 'va']);
  assert.equal(m.rankOf('va', 'sovereign'), 2);
  assert.equal(m.rankOf('cc', 'sovereign'), null); // territory has a value but no rank
  assert.equal(m.rankOf('xk', 'sovereign'), null);
});

test('topN and bottomN slice within scope, in the right order', () => {
  assert.deepEqual(fx.topN('world', 2).map((r) => r.code), ['aa', 'bb']);
  // bottomN is lowest-first
  assert.deepEqual(fx.bottomN('world', 2).map((r) => r.code), ['ee', 'dd']);
  assert.deepEqual(fx.topN('Europe', 1).map((r) => r.code), ['aa']);
});

test('rankOf is 1-based within scope, null when out of scope or valueless', () => {
  assert.equal(fx.rankOf('aa', 'world'), 1);
  assert.equal(fx.rankOf('dd', 'world'), 4);
  assert.equal(fx.rankOf('aa', 'un_member'), 1);
  assert.equal(fx.rankOf('dd', 'un_member'), 3); // cc dropped, so dd moves up
  assert.equal(fx.rankOf('cc', 'un_member'), null); // territory, out of scope
  assert.equal(fx.rankOf('ff', 'world'), null); // no value
});

test('tierOf splits the scope into thirds', () => {
  // world ranked: aa bb cc dd ee (L=5). Boundaries at L/3≈1.67 and 2L/3≈3.33:
  // i<1.67 → high (aa,bb); i<3.33 → mid (cc,dd); else low (ee).
  assert.equal(fx.tierOf('aa', 'world'), 'high'); // i=0
  assert.equal(fx.tierOf('bb', 'world'), 'high'); // i=1
  assert.equal(fx.tierOf('cc', 'world'), 'mid'); // i=2
  assert.equal(fx.tierOf('ee', 'world'), 'low'); // i=4
  assert.equal(fx.tierOf('ff', 'world'), null);
});

test('compare orders by value and guards missing values', () => {
  assert.equal(fx.compare('aa', 'bb'), 1); // 100 > 50
  assert.equal(fx.compare('bb', 'aa'), -1);
  assert.equal(fx.compare('dd', 'ee'), 0); // equal
  assert.equal(fx.compare('aa', 'ff'), null); // ff has no value
});

test('passthrough metadata is exposed', () => {
  assert.equal(fx.label, 'Fixture');
  assert.equal(fx.unit, 'things');
  assert.equal(fx.year, 2000);
});

// ---- real population.json schema + integration gate ------------------------

test('population.json has self-describing metadata', () => {
  assert.equal(POPULATION.key, 'population');
  assert.equal(typeof POPULATION.label, 'string');
  assert.equal(typeof POPULATION.unit, 'string');
  assert.ok(POPULATION.format === 'compact' || POPULATION.format === 'decimal1', 'valid format hint');
  assert.equal(typeof POPULATION.source, 'string');
  assert.equal(typeof POPULATION.year, 'number');
  assert.equal(typeof POPULATION.values, 'object');
});

test('createMetric defaults format to compact when absent', () => {
  const bare = createMetric(
    { key: 'x', label: 'X', unit: 'u', source: 't', year: 2000, values: {} },
    [],
  );
  assert.equal(bare.format, 'compact');
});

test('every population value is a non-negative integer', () => {
  // 0 is valid: truly-uninhabited real places (Bouvet, Heard, Clipperton) carry
  // 0 rather than being omitted, so a metric "no data" reads only for non-places.
  for (const [code, v] of Object.entries(POPULATION.values)) {
    assert.equal(Number.isInteger(v), true, `${code} not an integer: ${v}`);
    assert.ok(v >= 0, `${code} negative: ${v}`);
  }
});

test('every population key is a real (non-other) country', () => {
  const byCode = new Map(COUNTRIES.map((c) => [c.code, c]));
  for (const code of Object.keys(POPULATION.values)) {
    const c = byCode.get(code);
    assert.ok(c, `population key ${code} is not in countries.json`);
    assert.notEqual(c.category, 'other', `population key ${code} is an "other" entry`);
  }
});

test('every real place has a population value; only non-places have none', () => {
  // The invariant the "no data" guard leans on: a metric value exists for every
  // real place (uninhabited ones carry 0), and never for an org, so "no data"
  // means exactly "not a place" — see the TTT picker guard (metricDataGap).
  const values = POPULATION.values;
  for (const c of COUNTRIES) {
    if (c.category === 'other') {
      assert.ok(!(c.code in values), `org ${c.code} should have no population value`);
    } else {
      assert.ok(c.code in values, `real place ${c.code} (${c.continent}) has no population value`);
    }
  }
});

test('createMetric over real data ranks the world plausibly', () => {
  const pop = createMetric(POPULATION, COUNTRIES);
  const top2 = pop.topN('world', 2).map((r) => r.code);
  assert.deepEqual(top2.sort(), ['cn', 'in']); // China + India, order-agnostic
  assert.equal(pop.rankOf('va', 'world') !== null, true);
  // UN-member scope excludes territories like Hong Kong from the ranking
  assert.equal(pop.rankOf('hk', 'un_member'), null);
});

// ---- real area.json schema + integration gate ------------------------------

test('area is a valid, self-describing metric file', () => {
  assert.equal(AREA.key, 'area');
  assert.equal(typeof AREA.label, 'string');
  assert.equal(typeof AREA.unit, 'string');
  assert.ok(AREA.format === 'compact' || AREA.format === 'decimal1', 'valid format hint');
  assert.equal(typeof AREA.source, 'string');
  assert.equal(typeof AREA.year, 'number');
  assert.equal(typeof AREA.values, 'object');
});

test('every area value is a non-negative finite number', () => {
  // Unlike population, area is NOT integer-only: microstates are under 1 km²
  // (Vatican ~0.49), so a fractional value is valid. The floor is 0, never < 0.
  for (const [code, v] of Object.entries(AREA.values)) {
    assert.equal(Number.isFinite(v), true, `${code} not finite: ${v}`);
    assert.ok(v >= 0, `${code} negative: ${v}`);
  }
});

test('every real place has an area; only non-places have none', () => {
  // Same "no data = not a place" invariant the TTT guard leans on (metricDataGap).
  const values = AREA.values;
  for (const c of COUNTRIES) {
    if (c.category === 'other') {
      assert.ok(!(c.code in values), `org ${c.code} should have no area value`);
    } else {
      assert.ok(c.code in values, `real place ${c.code} (${c.continent}) has no area value`);
    }
  }
});

test('createMetric over real area ranks the world plausibly', () => {
  const area = createMetric(AREA, COUNTRIES);
  // Russia is the largest country; Vatican the smallest place.
  assert.equal(area.topN('world', 1)[0].code, 'ru');
  const world = area.ranked('world');
  assert.equal(world[world.length - 1].code, 'va');
});

// ---- real density.json schema + integration gate (derived metric) ----------

test('density is a valid, self-describing metric file', () => {
  assert.equal(DENSITY.key, 'density');
  assert.equal(typeof DENSITY.label, 'string');
  assert.equal(typeof DENSITY.unit, 'string');
  assert.ok(DENSITY.format === 'compact' || DENSITY.format === 'decimal1', 'valid format hint');
  assert.equal(typeof DENSITY.source, 'string');
  assert.equal(typeof DENSITY.values, 'object');
});

test('every density value is a non-negative finite number', () => {
  for (const [code, v] of Object.entries(DENSITY.values)) {
    assert.equal(Number.isFinite(v), true, `${code} not finite: ${v}`);
    assert.ok(v >= 0, `${code} negative: ${v}`);
  }
});

test('every real place has a density; only non-places have none', () => {
  const values = DENSITY.values;
  for (const c of COUNTRIES) {
    if (c.category === 'other') {
      assert.ok(!(c.code in values), `org ${c.code} should have no density value`);
    } else {
      assert.ok(c.code in values, `real place ${c.code} (${c.continent}) has no density value`);
    }
  }
});

test('density equals population / area for a sample country', () => {
  // Derived-metric contract: a spot-check that the build actually divides.
  const pop = /** @type {Record<string, number>} */ (POPULATION.values);
  const area = /** @type {Record<string, number>} */ (AREA.values);
  const dens = /** @type {Record<string, number>} */ (DENSITY.values);
  const expected = Math.round((pop.mc / area.mc) * 100) / 100; // Monaco
  assert.equal(dens.mc, expected);
});

test('createMetric over real density ranks the world plausibly', () => {
  const density = createMetric(DENSITY, COUNTRIES);
  // Macau / Monaco are the densest places on earth.
  assert.ok(['mo', 'mc'].includes(density.topN('world', 1)[0].code));
});

// ---- real gdp.json schema + integration gate (universal metric) ------------

test('gdp is a valid, self-describing metric file', () => {
  assert.equal(GDP.key, 'gdp');
  assert.equal(typeof GDP.label, 'string');
  assert.equal(typeof GDP.unit, 'string');
  assert.ok(GDP.format === 'compact' || GDP.format === 'decimal1', 'valid format hint');
  assert.equal(typeof GDP.source, 'string');
  assert.equal(typeof GDP.year, 'number');
  assert.equal(typeof GDP.values, 'object');
});

test('every gdp value is a non-negative finite number', () => {
  // 0 is valid: the uninhabited territories (Antarctica, Bouvet, ...) carry 0
  // deliberately — no permanent economy — rather than being omitted, so a metric
  // "no data" reads only for non-places. GDP is never negative.
  for (const [code, v] of Object.entries(GDP.values)) {
    assert.equal(Number.isFinite(v), true, `${code} not finite: ${v}`);
    assert.ok(v >= 0, `${code} negative: ${v}`);
  }
});

test('every real place has a gdp; only non-places have none', () => {
  // GDP is *universal*: every real place is sourced or hand-filled, so the "no
  // data = not a place" invariant the TTT guard leans on (metricDataGap) holds.
  const values = GDP.values;
  for (const c of COUNTRIES) {
    if (c.category === 'other') {
      assert.ok(!(c.code in values), `org ${c.code} should have no gdp value`);
    } else {
      assert.ok(c.code in values, `real place ${c.code} (${c.continent}) has no gdp value`);
    }
  }
});

test('createMetric over real gdp ranks the world plausibly', () => {
  const gdp = createMetric(GDP, COUNTRIES);
  // The United States is the largest economy.
  assert.equal(gdp.topN('world', 1)[0].code, 'us');
  assert.equal(gdp.rankOf('cn', 'world'), 2); // China second
});

// ---- real gdpPerCapita.json schema + integration gate (derived metric) -----

test('gdpPerCapita is a valid, self-describing metric file', () => {
  assert.equal(GDP_PER_CAPITA.key, 'gdpPerCapita');
  assert.equal(typeof GDP_PER_CAPITA.label, 'string');
  assert.equal(typeof GDP_PER_CAPITA.unit, 'string');
  assert.ok(
    GDP_PER_CAPITA.format === 'compact' || GDP_PER_CAPITA.format === 'decimal1',
    'valid format hint',
  );
  assert.equal(typeof GDP_PER_CAPITA.source, 'string');
  assert.equal(typeof GDP_PER_CAPITA.values, 'object');
});

test('every gdpPerCapita value is a non-negative finite number', () => {
  for (const [code, v] of Object.entries(GDP_PER_CAPITA.values)) {
    assert.equal(Number.isFinite(v), true, `${code} not finite: ${v}`);
    assert.ok(v >= 0, `${code} negative: ${v}`);
  }
});

test('every real place has a gdpPerCapita; only non-places have none', () => {
  // Derived from gdp / population, both dense. Uninhabited places (population 0)
  // carry 0 rather than a divide-by-zero drop, so the metric stays dense.
  const values = GDP_PER_CAPITA.values;
  for (const c of COUNTRIES) {
    if (c.category === 'other') {
      assert.ok(!(c.code in values), `org ${c.code} should have no gdpPerCapita value`);
    } else {
      assert.ok(c.code in values, `real place ${c.code} (${c.continent}) has no gdpPerCapita value`);
    }
  }
});

test('gdpPerCapita equals gdp / population for a sample country', () => {
  // Derived-metric contract: a spot-check that the build actually divides.
  const gdp = /** @type {Record<string, number>} */ (GDP.values);
  const pop = /** @type {Record<string, number>} */ (POPULATION.values);
  const pc = /** @type {Record<string, number>} */ (GDP_PER_CAPITA.values);
  const expected = Math.round(gdp.lu / pop.lu); // Luxembourg
  assert.equal(pc.lu, expected);
});

test('uninhabited places carry 0 gdpPerCapita, not a divide-by-zero drop', () => {
  // Bouvet, Heard, Clipperton have population 0; they must still be present at 0.
  for (const code of ['bv', 'hm', 'cp']) {
    assert.equal(GDP_PER_CAPITA.values[code], 0, `${code} should be 0, not missing/NaN`);
  }
});

// ---- real coffee.json schema + the sparse absence:'zero' contract ----------

test('coffee is a valid, self-describing metric file with an absence hint', () => {
  assert.equal(COFFEE.key, 'coffee');
  assert.equal(typeof COFFEE.label, 'string');
  assert.equal(typeof COFFEE.unit, 'string');
  assert.ok(COFFEE.format === 'compact' || COFFEE.format === 'decimal1', 'valid format hint');
  assert.equal(typeof COFFEE.source, 'string');
  assert.equal(typeof COFFEE.year, 'number');
  assert.equal(typeof COFFEE.values, 'object');
  // Coffee is the first sparse metric: the file must declare absence:'zero' so
  // the loader knows to default missing real places to 0 (not "no data").
  assert.equal(COFFEE.absence, 'zero');
});

test('every coffee value is a positive integer (tonnes, sub-tonne producers dropped)', () => {
  // Whole tonnes; the map lists producers only, so every listed value is >= 1
  // (a producer rounding below 1 tonne is dropped and falls to the 0 default).
  for (const [code, v] of Object.entries(COFFEE.values)) {
    assert.equal(Number.isInteger(v), true, `${code} not an integer: ${v}`);
    assert.ok(v >= 1, `${code} listed but not >= 1: ${v}`);
  }
});

test('every coffee key is a real (non-other) country — never an org', () => {
  const byCode = new Map(COUNTRIES.map((c) => [c.code, c]));
  for (const code of Object.keys(COFFEE.values)) {
    const c = byCode.get(code);
    assert.ok(c, `coffee key ${code} is not in countries.json`);
    assert.notEqual(c.category, 'other', `coffee key ${code} is an "other" entry`);
  }
});

test("absence:'zero' contract: attachCoffees fills every real place, orgs stay bare", () => {
  // The sparse-metric invariant the TTT no-data guard leans on: after the loader
  // runs, EVERY real place carries a numeric .coffee (growers their tonnage,
  // non-growers 0), and only non-place orgs are left without the field. This is
  // what makes "no data" mean exactly "not a place" for a sparse metric.
  const rows = COUNTRIES.map((c) => ({ code: c.code, category: c.category }));
  attachCoffees(/** @type {any} */ (rows), COFFEE.values);
  const byCode = new Map(rows.map((r) => [r.code, r]));
  for (const c of COUNTRIES) {
    const row = /** @type {any} */ (byCode.get(c.code));
    if (c.category === 'other') {
      assert.equal(row.coffee, undefined, `org ${c.code} should have no coffee field`);
    } else {
      assert.equal(typeof row.coffee, 'number', `real place ${c.code} has no coffee value`);
    }
  }
  // Spot-check the two ends: a listed grower keeps its value, a real non-grower
  // reads exactly 0 (a fair wrong guess, not a data gap).
  assert.equal(/** @type {any} */ (byCode.get('br')).coffee, COFFEE.values.br);
  assert.equal(/** @type {any} */ (byCode.get('de')).coffee, 0); // Germany grows none
});

test('createMetric over coffee stays sparse: it ranks growers only', () => {
  // Deliberate split: the lens / superlative rounds read the raw sparse map, so
  // "biggest producer" is Brazil and a non-grower has NO rank (rather than a
  // 180-way tie at 0). The 0-fill lives only in the denormalized threshold field.
  const coffee = createMetric(COFFEE, COUNTRIES);
  assert.equal(coffee.topN('world', 1)[0].code, 'br'); // Brazil, the largest
  assert.equal(coffee.rankOf('vn', 'world'), 2); // Vietnam second
  assert.equal(coffee.has('de'), false); // Germany isn't a grower → out of the ranking
});
