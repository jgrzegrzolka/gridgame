import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { createMetric } from './metrics.js';
import { attachCoffees, attachTeas, attachSugarcanes, attachGolds, attachOliveOils, attachHoneys, attachWines, attachCocoas, attachBananas, attachApples, attachOils, attachRices, attachCoals, attachCoastlines, attachForests, attachSheepPerCapitas, attachCattlePerCapitas, attachBeerPerCapitas, attachAlcoholPerCapitas, attachMeatPerCapitas, attachBorders, attachTourismPerCapitas, attachElectricityPerCapitas } from './group.js';
import { METRIC_FILES } from './metrics/index.js';

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
const TEA = /** @type {import('./metrics.js').MetricData} */ (load('metrics/tea.json'));
const SUGARCANE = /** @type {import('./metrics.js').MetricData} */ (load('metrics/sugarcane.json'));
const GOLD = /** @type {import('./metrics.js').MetricData} */ (load('metrics/gold.json'));
const OLIVE_OIL = /** @type {import('./metrics.js').MetricData} */ (load('metrics/oliveOil.json'));
const HONEY = /** @type {import('./metrics.js').MetricData} */ (load('metrics/honey.json'));
const WINE = /** @type {import('./metrics.js').MetricData} */ (load('metrics/wine.json'));
const COCOA = /** @type {import('./metrics.js').MetricData} */ (load('metrics/cocoa.json'));
const BANANA = /** @type {import('./metrics.js').MetricData} */ (load('metrics/banana.json'));
const APPLE = /** @type {import('./metrics.js').MetricData} */ (load('metrics/apple.json'));
const OIL = /** @type {import('./metrics.js').MetricData} */ (load('metrics/oil.json'));
const RICE = /** @type {import('./metrics.js').MetricData} */ (load('metrics/rice.json'));
const COAL = /** @type {import('./metrics.js').MetricData} */ (load('metrics/coal.json'));
const ELEVATION = /** @type {import('./metrics.js').MetricData} */ (load('metrics/elevation.json'));
const COASTLINE = /** @type {import('./metrics.js').MetricData} */ (load('metrics/coastline.json'));
const FOREST = /** @type {import('./metrics.js').MetricData} */ (load('metrics/forest.json'));
const SHEEP_PC = /** @type {import('./metrics.js').MetricData} */ (load('metrics/sheepPerCapita.json'));
const CATTLE_PC = /** @type {import('./metrics.js').MetricData} */ (load('metrics/cattlePerCapita.json'));
const BEER_PC = /** @type {import('./metrics.js').MetricData} */ (load('metrics/beerPerCapita.json'));
const ALCOHOL_PC = /** @type {import('./metrics.js').MetricData} */ (load('metrics/alcoholPerCapita.json'));
const MEAT_PC = /** @type {import('./metrics.js').MetricData} */ (load('metrics/meatPerCapita.json'));
const BORDERS = /** @type {import('./metrics.js').MetricData} */ (load('metrics/borders.json'));
const CORRUPTION = /** @type {import('./metrics.js').MetricData} */ (load('metrics/corruption.json'));
const TEMPERATURE = /** @type {import('./metrics.js').MetricData} */ (load('metrics/temperature.json'));
const HAPPINESS = /** @type {import('./metrics.js').MetricData} */ (load('metrics/happiness.json'));
const TOURISM_PC = /** @type {import('./metrics.js').MetricData} */ (load('metrics/tourismPerCapita.json'));
const ELECTRICITY_PC = /** @type {import('./metrics.js').MetricData} */ (load('metrics/electricityPerCapita.json'));
const MCDONALDS = /** @type {import('./metrics.js').MetricData} */ (load('metrics/mcdonaldsPerMillion.json'));

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

// ---- real sheepPerCapita.json schema + integration gate (derived, intensive) --

test('sheepPerCapita is a valid, self-describing metric file', () => {
  assert.equal(SHEEP_PC.key, 'sheepPerCapita');
  assert.equal(typeof SHEEP_PC.label, 'string');
  assert.equal(typeof SHEEP_PC.unit, 'string');
  // A rate spanning 0.0074 to ~135, rendered with 2 significant figures (keeping
  // the whole integer part) so it reads well at both ends, not a fixed decimal.
  assert.equal(SHEEP_PC.format, 'sig2');
  assert.equal(typeof SHEEP_PC.source, 'string');
  assert.equal(typeof SHEEP_PC.year, 'number');
  assert.equal(typeof SHEEP_PC.values, 'object');
  // Dense derived (sheep / population), like density / gdpPerCapita: no absence
  // hint. A place with no sheep, or an uninhabited one, carries a real 0.
  assert.equal(SHEEP_PC.absence, undefined);
});

test('every sheepPerCapita value is a non-negative finite number', () => {
  for (const [code, v] of Object.entries(SHEEP_PC.values)) {
    assert.equal(Number.isFinite(v), true, `${code} not finite: ${v}`);
    assert.ok(v >= 0, `${code} negative: ${v}`);
  }
});

test('every real place has a sheepPerCapita; only non-places have none', () => {
  // Derived from sheep / population, both dense. A real place with no sheep
  // carries 0, and the uninhabited ones (population 0) carry 0 rather than a
  // divide-by-zero drop, so the "no data = not a place" invariant holds.
  const values = SHEEP_PC.values;
  for (const c of COUNTRIES) {
    if (c.category === 'other') {
      assert.ok(!(c.code in values), `org ${c.code} should have no sheepPerCapita value`);
    } else {
      assert.ok(c.code in values, `real place ${c.code} (${c.continent}) has no sheepPerCapita value`);
    }
  }
});

test('uninhabited places carry 0 sheepPerCapita, not a divide-by-zero drop', () => {
  // Bouvet, Heard, Clipperton have population 0; they must still be present at 0.
  for (const code of ['bv', 'hm', 'cp']) {
    assert.equal(SHEEP_PC.values[code], 0, `${code} should be 0, not missing/NaN`);
  }
});

test('createMetric over sheepPerCapita ranks the world size-independently', () => {
  const sheep = createMetric(SHEEP_PC, COUNTRIES);
  // The Falklands is the extreme: ~500,000 sheep over ~3,700 people, a tiny
  // territory topping every large country, the intensive property this metric
  // exists for. Its value is well over 100 sheep/person.
  assert.equal(sheep.topN('world', 1)[0].code, 'fk');
  assert.ok(/** @type {number} */ (sheep.valueOf('fk')) > 100);
  // The "more sheep than people" club (value >= 1) is small and famous: New
  // Zealand, Mongolia, Australia, Uruguay all sit there; a giant like China does
  // not (many sheep, but far more people).
  assert.ok(/** @type {number} */ (sheep.valueOf('nz')) >= 1);
  assert.ok(/** @type {number} */ (sheep.valueOf('cn')) < 1);
});

test('attachSheepPerCapitas fills every real place (no-sheep at 0), orgs stay bare', () => {
  // Dense-metric denormalizer: every real place ends up with a numeric field
  // (a place with no sheep at 0), and only non-place orgs are left without it.
  const rows = COUNTRIES.map((c) => ({ code: c.code, category: c.category }));
  attachSheepPerCapitas(/** @type {any} */ (rows), SHEEP_PC.values);
  const byCode = new Map(rows.map((r) => [r.code, r]));
  for (const c of COUNTRIES) {
    const row = /** @type {any} */ (byCode.get(c.code));
    if (c.category === 'other') {
      assert.equal(row.sheepPerCapita, undefined, `org ${c.code} should have no sheepPerCapita field`);
    } else {
      assert.equal(typeof row.sheepPerCapita, 'number', `real place ${c.code} has no sheepPerCapita value`);
    }
  }
  assert.equal(/** @type {any} */ (byCode.get('fk')).sheepPerCapita, SHEEP_PC.values.fk);
  assert.equal(/** @type {any} */ (byCode.get('sg')).sheepPerCapita, 0); // Singapore has no sheep
});

// ---- real cattlePerCapita.json schema + integration gate (derived, intensive) --

test('cattlePerCapita is a valid, self-describing metric file', () => {
  assert.equal(CATTLE_PC.key, 'cattlePerCapita');
  assert.equal(typeof CATTLE_PC.label, 'string');
  assert.equal(typeof CATTLE_PC.unit, 'string');
  // A rate spanning ~0.0001 to ~3.5, rendered with 2 significant figures.
  assert.equal(CATTLE_PC.format, 'sig2');
  assert.equal(typeof CATTLE_PC.source, 'string');
  assert.equal(typeof CATTLE_PC.year, 'number');
  assert.equal(typeof CATTLE_PC.values, 'object');
  // Dense derived (cattle / population), like the sheep twin: no absence hint.
  assert.equal(CATTLE_PC.absence, undefined);
});

test('every cattlePerCapita value is a non-negative finite number', () => {
  for (const [code, v] of Object.entries(CATTLE_PC.values)) {
    assert.equal(Number.isFinite(v), true, `${code} not finite: ${v}`);
    assert.ok(v >= 0, `${code} negative: ${v}`);
  }
});

test('every real place has a cattlePerCapita; only non-places have none', () => {
  // Derived from cattle / population, both dense. A real place with no cattle
  // carries 0, and the uninhabited ones (population 0) carry 0 rather than a
  // divide-by-zero drop, so the "no data = not a place" invariant holds.
  const values = CATTLE_PC.values;
  for (const c of COUNTRIES) {
    if (c.category === 'other') {
      assert.ok(!(c.code in values), `org ${c.code} should have no cattlePerCapita value`);
    } else {
      assert.ok(c.code in values, `real place ${c.code} (${c.continent}) has no cattlePerCapita value`);
    }
  }
});

test('uninhabited places carry 0 cattlePerCapita, not a divide-by-zero drop', () => {
  for (const code of ['bv', 'hm', 'cp']) {
    assert.equal(CATTLE_PC.values[code], 0, `${code} should be 0, not missing/NaN`);
  }
});

test('createMetric over cattlePerCapita ranks the world size-independently', () => {
  const cattle = createMetric(CATTLE_PC, COUNTRIES);
  // Uruguay is the extreme: ~12M cattle over ~3.4M people, more cows than people,
  // a small country topping every giant. Its value is well over 3.
  assert.equal(cattle.topN('world', 1)[0].code, 'uy');
  assert.ok(/** @type {number} */ (cattle.valueOf('uy')) > 3);
  // The "more cattle than people" club (value >= 1) is small and famous: New
  // Zealand, Argentina, Brazil all sit there; a giant like China does not.
  assert.ok(/** @type {number} */ (cattle.valueOf('nz')) >= 1);
  assert.ok(/** @type {number} */ (cattle.valueOf('cn')) < 1);
});

test('attachCattlePerCapitas fills every real place (no-cattle at 0), orgs stay bare', () => {
  const rows = COUNTRIES.map((c) => ({ code: c.code, category: c.category }));
  attachCattlePerCapitas(/** @type {any} */ (rows), CATTLE_PC.values);
  const byCode = new Map(rows.map((r) => [r.code, r]));
  for (const c of COUNTRIES) {
    const row = /** @type {any} */ (byCode.get(c.code));
    if (c.category === 'other') {
      assert.equal(row.cattlePerCapita, undefined, `org ${c.code} should have no cattlePerCapita field`);
    } else {
      assert.equal(typeof row.cattlePerCapita, 'number', `real place ${c.code} has no cattlePerCapita value`);
    }
  }
  assert.equal(/** @type {any} */ (byCode.get('uy')).cattlePerCapita, CATTLE_PC.values.uy);
  assert.equal(/** @type {any} */ (byCode.get('sg')).cattlePerCapita, 0); // Singapore has no cattle
});

// ---- real beerPerCapita.json schema + the absence:'unknown' contract -------

test('beerPerCapita is a valid, self-describing metric file with absence:unknown', () => {
  assert.equal(BEER_PC.key, 'beerPerCapita');
  assert.equal(typeof BEER_PC.label, 'string');
  assert.equal(typeof BEER_PC.unit, 'string');
  // Whole litres of beer (0..~131), rendered plain.
  assert.equal(BEER_PC.format, 'plain');
  assert.equal(typeof BEER_PC.source, 'string');
  assert.equal(typeof BEER_PC.year, 'number');
  assert.equal(typeof BEER_PC.values, 'object');
  // The first metric whose absence means "unknown" (WHO does not measure every
  // real place), not "zero" and not "dense". This hint documents that; nothing at
  // runtime infers a value from it (the attacher just leaves the gap bare).
  assert.equal(BEER_PC.absence, 'unknown');
});

test('every beerPerCapita value is a non-negative finite number', () => {
  for (const [code, v] of Object.entries(BEER_PC.values)) {
    assert.equal(Number.isFinite(v), true, `${code} not finite: ${v}`);
    assert.ok(v >= 0, `${code} negative: ${v}`);
  }
});

test('beerPerCapita covers only real places, never orgs; the gap is genuine (absence:unknown)', () => {
  // Unlike the dense metrics, NOT every real place has a value: WHO measures ~189
  // sovereign states but not sub-national parts / small territories. So the
  // invariant is one-directional: every key is a real place, and no org has one.
  // The uncovered real places are the honest "unknown" gap, blocked by the guard.
  const realCodes = new Set(COUNTRIES.filter((c) => c.category !== 'other').map((c) => c.code));
  for (const code of Object.keys(BEER_PC.values)) {
    assert.ok(realCodes.has(code), `beer value for non-real place ${code}`);
  }
  for (const c of COUNTRIES) {
    if (c.category === 'other') {
      assert.ok(!(c.code in BEER_PC.values), `org ${c.code} should have no beerPerCapita value`);
    }
  }
  // Coverage is broad (every sovereign) but deliberately not total.
  const covered = COUNTRIES.filter((c) => c.category !== 'other' && c.code in BEER_PC.values).length;
  assert.ok(covered >= 180, `expected ~189 covered real places, got ${covered}`);
  assert.ok(covered < realCodes.size, 'beer must NOT be dense: some real places are the unknown gap');
  // A sovereign is always covered; a sub-national part / territory is the gap.
  assert.ok('cz' in BEER_PC.values, 'Czechia (sovereign) must be covered');
  assert.ok(!('gb-wls' in BEER_PC.values), 'Wales (sub-national) is unknown, must be absent');
  assert.ok(!('gl' in BEER_PC.values), 'Greenland (territory) is unknown, must be absent');
});

test('createMetric over beerPerCapita ranks Czechia top, dry states at 0', () => {
  const beer = createMetric(BEER_PC, COUNTRIES);
  // Czechia is the world's top beer drinker, a fixture of the trivia.
  assert.equal(beer.topN('world', 1)[0].code, 'cz');
  assert.ok(/** @type {number} */ (beer.valueOf('cz')) > 100);
  // Germany is famously high; a dry state records ~none.
  assert.ok(/** @type {number} */ (beer.valueOf('de')) > 50);
  assert.equal(beer.valueOf('sa'), 0); // Saudi Arabia
});

test('attachBeerPerCapitas fills covered real places, leaves the unknown gap + orgs bare', () => {
  const rows = COUNTRIES.map((c) => ({ code: c.code, category: c.category }));
  attachBeerPerCapitas(/** @type {any} */ (rows), BEER_PC.values);
  const byCode = new Map(rows.map((r) => [r.code, r]));
  // Covered sovereign gets the number.
  assert.equal(/** @type {any} */ (byCode.get('cz')).beerPerCapita, BEER_PC.values.cz);
  // Unknown-gap real place stays bare (no false 0) so the guard reads "no data".
  assert.equal(/** @type {any} */ (byCode.get('gb-wls')).beerPerCapita, undefined);
  // Org stays bare too.
  const anOrg = COUNTRIES.find((c) => c.category === 'other');
  assert.equal(/** @type {any} */ (byCode.get(/** @type {any} */ (anOrg).code)).beerPerCapita, undefined);
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

// ---- real tea.json schema + the sparse absence:'zero' contract (coffee's twin)

test('tea is a valid, self-describing metric file with an absence hint', () => {
  assert.equal(TEA.key, 'tea');
  assert.equal(typeof TEA.label, 'string');
  assert.equal(typeof TEA.unit, 'string');
  assert.ok(TEA.format === 'compact' || TEA.format === 'decimal1', 'valid format hint');
  assert.equal(typeof TEA.source, 'string');
  assert.equal(typeof TEA.year, 'number');
  assert.equal(typeof TEA.values, 'object');
  // Tea is sparse like coffee: the file must declare absence:'zero' so the
  // loader defaults missing real places to 0 (not "no data").
  assert.equal(TEA.absence, 'zero');
});

test('every tea value is a positive integer (tonnes, sub-tonne producers dropped)', () => {
  for (const [code, v] of Object.entries(TEA.values)) {
    assert.equal(Number.isInteger(v), true, `${code} not an integer: ${v}`);
    assert.ok(v >= 1, `${code} listed but not >= 1: ${v}`);
  }
});

test('every tea key is a real (non-other) country — never an org', () => {
  const byCode = new Map(COUNTRIES.map((c) => [c.code, c]));
  for (const code of Object.keys(TEA.values)) {
    const c = byCode.get(code);
    assert.ok(c, `tea key ${code} is not in countries.json`);
    assert.notEqual(c.category, 'other', `tea key ${code} is an "other" entry`);
  }
});

test("absence:'zero' contract: attachTeas fills every real place, orgs stay bare", () => {
  const rows = COUNTRIES.map((c) => ({ code: c.code, category: c.category }));
  attachTeas(/** @type {any} */ (rows), TEA.values);
  const byCode = new Map(rows.map((r) => [r.code, r]));
  for (const c of COUNTRIES) {
    const row = /** @type {any} */ (byCode.get(c.code));
    if (c.category === 'other') {
      assert.equal(row.tea, undefined, `org ${c.code} should have no tea field`);
    } else {
      assert.equal(typeof row.tea, 'number', `real place ${c.code} has no tea value`);
    }
  }
  // A listed grower keeps its value; a real non-grower reads exactly 0.
  assert.equal(/** @type {any} */ (byCode.get('cn')).tea, TEA.values.cn);
  assert.equal(/** @type {any} */ (byCode.get('de')).tea, 0); // Germany grows none
});

test('createMetric over tea stays sparse: it ranks growers only', () => {
  const tea = createMetric(TEA, COUNTRIES);
  assert.equal(tea.topN('world', 1)[0].code, 'cn'); // China, the largest
  assert.equal(tea.rankOf('in', 'world'), 2); // India second
  assert.equal(tea.has('de'), false); // Germany isn't a grower → out of the ranking
});

// ---- real sugarcane.json schema + the sparse absence:'zero' contract --------

test('sugarcane is a valid, self-describing metric file with an absence hint', () => {
  assert.equal(SUGARCANE.key, 'sugarcane');
  assert.equal(typeof SUGARCANE.label, 'string');
  assert.equal(typeof SUGARCANE.unit, 'string');
  assert.ok(SUGARCANE.format === 'compact' || SUGARCANE.format === 'decimal1', 'valid format hint');
  assert.equal(typeof SUGARCANE.source, 'string');
  assert.equal(typeof SUGARCANE.year, 'number');
  assert.equal(typeof SUGARCANE.values, 'object');
  // Sparse like coffee/tea: the file must declare absence:'zero' so the loader
  // defaults missing real places to 0 (not "no data").
  assert.equal(SUGARCANE.absence, 'zero');
});

test('every sugarcane value is a positive integer (tonnes, sub-tonne producers dropped)', () => {
  for (const [code, v] of Object.entries(SUGARCANE.values)) {
    assert.equal(Number.isInteger(v), true, `${code} not an integer: ${v}`);
    assert.ok(v >= 1, `${code} listed but not >= 1: ${v}`);
  }
});

test('every sugarcane key is a real (non-other) country — never an org', () => {
  const byCode = new Map(COUNTRIES.map((c) => [c.code, c]));
  for (const code of Object.keys(SUGARCANE.values)) {
    const c = byCode.get(code);
    assert.ok(c, `sugarcane key ${code} is not in countries.json`);
    assert.notEqual(c.category, 'other', `sugarcane key ${code} is an "other" entry`);
  }
});

test("absence:'zero' contract: attachSugarcanes fills every real place, orgs stay bare", () => {
  const rows = COUNTRIES.map((c) => ({ code: c.code, category: c.category }));
  attachSugarcanes(/** @type {any} */ (rows), SUGARCANE.values);
  const byCode = new Map(rows.map((r) => [r.code, r]));
  for (const c of COUNTRIES) {
    const row = /** @type {any} */ (byCode.get(c.code));
    if (c.category === 'other') {
      assert.equal(row.sugarcane, undefined, `org ${c.code} should have no sugarcane field`);
    } else {
      assert.equal(typeof row.sugarcane, 'number', `real place ${c.code} has no sugarcane value`);
    }
  }
  // A listed grower keeps its value; a real non-grower reads exactly 0.
  assert.equal(/** @type {any} */ (byCode.get('br')).sugarcane, SUGARCANE.values.br);
  assert.equal(/** @type {any} */ (byCode.get('de')).sugarcane, 0); // Germany grows none
});

test('createMetric over sugarcane stays sparse: it ranks growers only', () => {
  const sugarcane = createMetric(SUGARCANE, COUNTRIES);
  assert.equal(sugarcane.topN('world', 1)[0].code, 'br'); // Brazil, the largest
  assert.equal(sugarcane.rankOf('in', 'world'), 2); // India second
  assert.equal(sugarcane.has('de'), false); // Germany isn't a grower → out of the ranking
});

// ---- real gold.json schema + the sparse absence:'zero' contract -------------

test('gold is a valid, self-describing metric file with an absence hint', () => {
  assert.equal(GOLD.key, 'gold');
  assert.equal(typeof GOLD.label, 'string');
  assert.equal(typeof GOLD.unit, 'string');
  assert.ok(GOLD.format === 'compact' || GOLD.format === 'decimal1', 'valid format hint');
  assert.equal(typeof GOLD.source, 'string');
  assert.equal(typeof GOLD.year, 'number');
  assert.equal(typeof GOLD.values, 'object');
  // Sparse like coffee: the file must declare absence:'zero' so the loader
  // defaults missing real places to 0 (not "no data").
  assert.equal(GOLD.absence, 'zero');
});

test('every gold value is a positive integer (whole tonnes)', () => {
  for (const [code, v] of Object.entries(GOLD.values)) {
    assert.equal(Number.isInteger(v), true, `${code} not an integer: ${v}`);
    assert.ok(v >= 1, `${code} listed but not >= 1: ${v}`);
  }
});

test('every gold key is a real (non-other) country — never an org', () => {
  const byCode = new Map(COUNTRIES.map((c) => [c.code, c]));
  for (const code of Object.keys(GOLD.values)) {
    const c = byCode.get(code);
    assert.ok(c, `gold key ${code} is not in countries.json`);
    assert.notEqual(c.category, 'other', `gold key ${code} is an "other" entry`);
  }
});

test("absence:'zero' contract: attachGolds fills every real place, orgs stay bare", () => {
  const rows = COUNTRIES.map((c) => ({ code: c.code, category: c.category }));
  attachGolds(/** @type {any} */ (rows), GOLD.values);
  const byCode = new Map(rows.map((r) => [r.code, r]));
  for (const c of COUNTRIES) {
    const row = /** @type {any} */ (byCode.get(c.code));
    if (c.category === 'other') {
      assert.equal(row.gold, undefined, `org ${c.code} should have no gold field`);
    } else {
      assert.equal(typeof row.gold, 'number', `real place ${c.code} has no gold value`);
    }
  }
  // A listed producer keeps its value; a real non-producer reads exactly 0.
  assert.equal(/** @type {any} */ (byCode.get('cn')).gold, GOLD.values.cn);
  assert.equal(/** @type {any} */ (byCode.get('de')).gold, 0); // Germany mines none
});

test('createMetric over gold stays sparse: it ranks producers only', () => {
  const gold = createMetric(GOLD, COUNTRIES);
  assert.equal(gold.topN('world', 1)[0].code, 'cn'); // China, the largest
  assert.equal(gold.rankOf('ru', 'world'), 2); // Russia second
  assert.equal(gold.has('de'), false); // Germany isn't a producer → out of the ranking
});

// ---- real oliveOil.json schema + the sparse absence:'zero' contract ---------

test('oliveOil is a valid, self-describing metric file with an absence hint', () => {
  assert.equal(OLIVE_OIL.key, 'oliveOil');
  assert.equal(typeof OLIVE_OIL.label, 'string');
  assert.equal(typeof OLIVE_OIL.unit, 'string');
  assert.ok(OLIVE_OIL.format === 'compact' || OLIVE_OIL.format === 'decimal1', 'valid format hint');
  assert.equal(typeof OLIVE_OIL.source, 'string');
  assert.equal(typeof OLIVE_OIL.year, 'number');
  assert.equal(typeof OLIVE_OIL.values, 'object');
  // Sparse like coffee: the file must declare absence:'zero' so the loader
  // defaults missing real places to 0 (not "no data").
  assert.equal(OLIVE_OIL.absence, 'zero');
});

test('every oliveOil value is a positive integer (whole tonnes)', () => {
  for (const [code, v] of Object.entries(OLIVE_OIL.values)) {
    assert.equal(Number.isInteger(v), true, `${code} not an integer: ${v}`);
    assert.ok(v >= 1, `${code} listed but not >= 1: ${v}`);
  }
});

test('every oliveOil key is a real (non-other) country — never an org', () => {
  const byCode = new Map(COUNTRIES.map((c) => [c.code, c]));
  for (const code of Object.keys(OLIVE_OIL.values)) {
    const c = byCode.get(code);
    assert.ok(c, `oliveOil key ${code} is not in countries.json`);
    assert.notEqual(c.category, 'other', `oliveOil key ${code} is an "other" entry`);
  }
});

test("absence:'zero' contract: attachOliveOils fills every real place, orgs stay bare", () => {
  const rows = COUNTRIES.map((c) => ({ code: c.code, category: c.category }));
  attachOliveOils(/** @type {any} */ (rows), OLIVE_OIL.values);
  const byCode = new Map(rows.map((r) => [r.code, r]));
  for (const c of COUNTRIES) {
    const row = /** @type {any} */ (byCode.get(c.code));
    if (c.category === 'other') {
      assert.equal(row.oliveOil, undefined, `org ${c.code} should have no oliveOil field`);
    } else {
      assert.equal(typeof row.oliveOil, 'number', `real place ${c.code} has no oliveOil value`);
    }
  }
  // A listed producer keeps its value; a real non-producer reads exactly 0.
  assert.equal(/** @type {any} */ (byCode.get('es')).oliveOil, OLIVE_OIL.values.es);
  assert.equal(/** @type {any} */ (byCode.get('de')).oliveOil, 0); // Germany makes none
});

test('createMetric over oliveOil stays sparse: it ranks producers only', () => {
  const oliveOil = createMetric(OLIVE_OIL, COUNTRIES);
  assert.equal(oliveOil.topN('world', 1)[0].code, 'es'); // Spain, the largest
  assert.equal(oliveOil.rankOf('it', 'world'), 2); // Italy second
  assert.equal(oliveOil.has('de'), false); // Germany isn't a producer → out of the ranking
});

// ---- real honey.json schema + the sparse absence:'zero' contract ------------

test('honey is a valid, self-describing metric file with an absence hint', () => {
  assert.equal(HONEY.key, 'honey');
  assert.equal(typeof HONEY.label, 'string');
  assert.equal(typeof HONEY.unit, 'string');
  assert.ok(HONEY.format === 'compact' || HONEY.format === 'decimal1', 'valid format hint');
  assert.equal(typeof HONEY.source, 'string');
  assert.equal(typeof HONEY.year, 'number');
  assert.equal(typeof HONEY.values, 'object');
  // Sparse like coffee: the file must declare absence:'zero' so the loader
  // defaults missing real places to 0 (not "no data").
  assert.equal(HONEY.absence, 'zero');
});

test('every honey value is a positive integer (whole tonnes)', () => {
  for (const [code, v] of Object.entries(HONEY.values)) {
    assert.equal(Number.isInteger(v), true, `${code} not an integer: ${v}`);
    assert.ok(v >= 1, `${code} listed but not >= 1: ${v}`);
  }
});

test('every honey key is a real (non-other) country — never an org', () => {
  const byCode = new Map(COUNTRIES.map((c) => [c.code, c]));
  for (const code of Object.keys(HONEY.values)) {
    const c = byCode.get(code);
    assert.ok(c, `honey key ${code} is not in countries.json`);
    assert.notEqual(c.category, 'other', `honey key ${code} is an "other" entry`);
  }
});

test("absence:'zero' contract: attachHoneys fills every real place, orgs stay bare", () => {
  const rows = COUNTRIES.map((c) => ({ code: c.code, category: c.category }));
  attachHoneys(/** @type {any} */ (rows), HONEY.values);
  const byCode = new Map(rows.map((r) => [r.code, r]));
  for (const c of COUNTRIES) {
    const row = /** @type {any} */ (byCode.get(c.code));
    if (c.category === 'other') {
      assert.equal(row.honey, undefined, `org ${c.code} should have no honey field`);
    } else {
      assert.equal(typeof row.honey, 'number', `real place ${c.code} has no honey value`);
    }
  }
  // A listed producer keeps its value; a real non-producer reads exactly 0.
  assert.equal(/** @type {any} */ (byCode.get('cn')).honey, HONEY.values.cn);
  assert.equal(/** @type {any} */ (byCode.get('jp')).honey, 0); // Japan makes little; not in the top 55 → 0
});

test('createMetric over honey stays sparse: it ranks producers only', () => {
  const honey = createMetric(HONEY, COUNTRIES);
  assert.equal(honey.topN('world', 1)[0].code, 'cn'); // China, the largest
  assert.equal(honey.rankOf('tr', 'world'), 2); // Türkiye second
  assert.equal(honey.has('jp'), false); // Japan isn't in the itemized producers → out of the ranking
});

// ---- real wine.json schema + the sparse absence:'zero' contract ------------

test('wine is a valid, self-describing metric file with an absence hint', () => {
  assert.equal(WINE.key, 'wine');
  assert.equal(typeof WINE.label, 'string');
  assert.equal(typeof WINE.unit, 'string');
  assert.ok(WINE.format === 'compact' || WINE.format === 'decimal1', 'valid format hint');
  assert.equal(typeof WINE.source, 'string');
  assert.equal(typeof WINE.year, 'number');
  assert.equal(typeof WINE.values, 'object');
  // Sparse like coffee: producers only, absence means "makes none" → 0, so
  // the loader knows to default missing real places to 0 (not "no data").
  assert.equal(WINE.absence, 'zero');
});

test('every wine value is a positive integer (tonnes, sub-tonne producers dropped)', () => {
  // Whole tonnes; the map lists producers only, so every listed value is >= 1
  // (a producer rounding below 1 tonne is dropped and falls to the 0 default).
  for (const [code, v] of Object.entries(WINE.values)) {
    assert.equal(Number.isInteger(v), true, `${code} not an integer: ${v}`);
    assert.ok(v >= 1, `${code} listed but not >= 1: ${v}`);
  }
});

test('every wine key is a real (non-other) country, never an org', () => {
  const byCode = new Map(COUNTRIES.map((c) => [c.code, c]));
  for (const code of Object.keys(WINE.values)) {
    const c = byCode.get(code);
    assert.ok(c, `wine key ${code} is not in countries.json`);
    assert.notEqual(c.category, 'other', `wine key ${code} is an "other" entry`);
  }
});

test("absence:'zero' contract: attachWines fills every real place, orgs stay bare", () => {
  // The sparse-metric invariant the TTT no-data guard leans on: after the loader
  // runs, EVERY real place carries a numeric .wine (makers their tonnage,
  // non-makers 0), and only non-place orgs are left without the field. This is
  // what makes "no data" mean exactly "not a place" for a sparse metric.
  const rows = COUNTRIES.map((c) => ({ code: c.code, category: c.category }));
  attachWines(/** @type {any} */ (rows), WINE.values);
  const byCode = new Map(rows.map((r) => [r.code, r]));
  for (const c of COUNTRIES) {
    const row = /** @type {any} */ (byCode.get(c.code));
    if (c.category === 'other') {
      assert.equal(row.wine, undefined, `org ${c.code} should have no wine field`);
    } else {
      assert.equal(typeof row.wine, 'number', `real place ${c.code} has no wine value`);
    }
  }
  // Spot-check the two ends: a listed maker keeps its value, a real non-maker
  // reads exactly 0 (a fair wrong guess, not a data gap).
  assert.equal(/** @type {any} */ (byCode.get('fr')).wine, WINE.values.fr);
  assert.equal(/** @type {any} */ (byCode.get('jp')).wine, WINE.values.jp);
  assert.equal(/** @type {any} */ (byCode.get('af')).wine, 0); // Afghanistan makes none
});

test('createMetric over wine stays sparse: it ranks makers only', () => {
  // Deliberate split: the lens / superlative rounds read the raw sparse map, so
  // "biggest producer" is France and a non-maker has NO rank (rather than a
  // 180-way tie at 0). The 0-fill lives only in the denormalized threshold field.
  const wine = createMetric(WINE, COUNTRIES);
  assert.equal(wine.topN('world', 1)[0].code, 'fr'); // France, the largest
  assert.equal(wine.rankOf('it', 'world'), 2); // Italy second
  assert.equal(wine.has('af'), false); // Afghanistan isn't a maker → out of the ranking
});

// ---- real cocoa.json schema + the sparse absence:'zero' contract -----------

test('cocoa is a valid, self-describing metric file with an absence hint', () => {
  assert.equal(COCOA.key, 'cocoa');
  assert.equal(typeof COCOA.label, 'string');
  assert.equal(typeof COCOA.unit, 'string');
  assert.ok(COCOA.format === 'compact' || COCOA.format === 'decimal1', 'valid format hint');
  assert.equal(typeof COCOA.source, 'string');
  assert.equal(typeof COCOA.year, 'number');
  assert.equal(typeof COCOA.values, 'object');
  // Sparse like coffee / wine: growers only, absence means "grows none" → 0.
  assert.equal(COCOA.absence, 'zero');
});

test('every cocoa value is a positive integer (tonnes, sub-tonne growers dropped)', () => {
  for (const [code, v] of Object.entries(COCOA.values)) {
    assert.equal(Number.isInteger(v), true, `${code} not an integer: ${v}`);
    assert.ok(v >= 1, `${code} listed but not >= 1: ${v}`);
  }
});

test('every cocoa key is a real (non-other) country, never an org', () => {
  const byCode = new Map(COUNTRIES.map((c) => [c.code, c]));
  for (const code of Object.keys(COCOA.values)) {
    const c = byCode.get(code);
    assert.ok(c, `cocoa key ${code} is not in countries.json`);
    assert.notEqual(c.category, 'other', `cocoa key ${code} is an "other" entry`);
  }
});

test("absence:'zero' contract: attachCocoas fills every real place, orgs stay bare", () => {
  const rows = COUNTRIES.map((c) => ({ code: c.code, category: c.category }));
  attachCocoas(/** @type {any} */ (rows), COCOA.values);
  const byCode = new Map(rows.map((r) => [r.code, r]));
  for (const c of COUNTRIES) {
    const row = /** @type {any} */ (byCode.get(c.code));
    if (c.category === 'other') {
      assert.equal(row.cocoa, undefined, `org ${c.code} should have no cocoa field`);
    } else {
      assert.equal(typeof row.cocoa, 'number', `real place ${c.code} has no cocoa value`);
    }
  }
  // A listed grower keeps its value, a real non-grower reads exactly 0.
  assert.equal(/** @type {any} */ (byCode.get('ci')).cocoa, COCOA.values.ci);
  assert.equal(/** @type {any} */ (byCode.get('af')).cocoa, 0); // Afghanistan grows none
});

test('createMetric over cocoa stays sparse: it ranks growers only', () => {
  const cocoa = createMetric(COCOA, COUNTRIES);
  assert.equal(cocoa.topN('world', 1)[0].code, 'ci'); // Côte d'Ivoire, the largest
  assert.equal(cocoa.rankOf('id', 'world'), 2); // Indonesia second
  assert.equal(cocoa.has('af'), false); // Afghanistan isn't a grower → out of the ranking
});

// ---- real banana.json schema + the sparse absence:'zero' contract ----------

test('banana is a valid, self-describing metric file with an absence hint', () => {
  assert.equal(BANANA.key, 'banana');
  assert.equal(typeof BANANA.label, 'string');
  assert.equal(typeof BANANA.unit, 'string');
  assert.ok(BANANA.format === 'compact' || BANANA.format === 'decimal1', 'valid format hint');
  assert.equal(typeof BANANA.source, 'string');
  assert.equal(typeof BANANA.year, 'number');
  assert.equal(typeof BANANA.values, 'object');
  // Sparse like the other crops: producers only, absence means "grows none" → 0.
  assert.equal(BANANA.absence, 'zero');
});

test('every banana value is a positive integer (tonnes, sub-tonne producers dropped)', () => {
  for (const [code, v] of Object.entries(BANANA.values)) {
    assert.equal(Number.isInteger(v), true, `${code} not an integer: ${v}`);
    assert.ok(v >= 1, `${code} listed but not >= 1: ${v}`);
  }
});

test('every banana key is a real (non-other) country, never an org', () => {
  const byCode = new Map(COUNTRIES.map((c) => [c.code, c]));
  for (const code of Object.keys(BANANA.values)) {
    const c = byCode.get(code);
    assert.ok(c, `banana key ${code} is not in countries.json`);
    assert.notEqual(c.category, 'other', `banana key ${code} is an "other" entry`);
  }
});

test("absence:'zero' contract: attachBananas fills every real place, orgs stay bare", () => {
  const rows = COUNTRIES.map((c) => ({ code: c.code, category: c.category }));
  attachBananas(/** @type {any} */ (rows), BANANA.values);
  const byCode = new Map(rows.map((r) => [r.code, r]));
  for (const c of COUNTRIES) {
    const row = /** @type {any} */ (byCode.get(c.code));
    if (c.category === 'other') {
      assert.equal(row.banana, undefined, `org ${c.code} should have no banana field`);
    } else {
      assert.equal(typeof row.banana, 'number', `real place ${c.code} has no banana value`);
    }
  }
  assert.equal(/** @type {any} */ (byCode.get('in')).banana, BANANA.values.in);
  assert.equal(/** @type {any} */ (byCode.get('af')).banana, 0); // Afghanistan grows none
});

// ---- real apple.json schema + the sparse absence:'zero' contract -----------

test('apple is a valid, self-describing metric file with an absence hint', () => {
  assert.equal(APPLE.key, 'apple');
  assert.equal(typeof APPLE.label, 'string');
  assert.equal(typeof APPLE.unit, 'string');
  assert.ok(APPLE.format === 'compact' || APPLE.format === 'decimal1', 'valid format hint');
  assert.equal(typeof APPLE.source, 'string');
  assert.equal(typeof APPLE.year, 'number');
  assert.equal(typeof APPLE.values, 'object');
  // Sparse like the other crops: producers only, absence means "grows none" → 0.
  assert.equal(APPLE.absence, 'zero');
});

test('every apple value is a positive integer (tonnes, sub-tonne producers dropped)', () => {
  for (const [code, v] of Object.entries(APPLE.values)) {
    assert.equal(Number.isInteger(v), true, `${code} not an integer: ${v}`);
    assert.ok(v >= 1, `${code} listed but not >= 1: ${v}`);
  }
});

test('every apple key is a real (non-other) country, never an org', () => {
  const byCode = new Map(COUNTRIES.map((c) => [c.code, c]));
  for (const code of Object.keys(APPLE.values)) {
    const c = byCode.get(code);
    assert.ok(c, `apple key ${code} is not in countries.json`);
    assert.notEqual(c.category, 'other', `apple key ${code} is an "other" entry`);
  }
});

test("absence:'zero' contract: attachApples fills every real place, orgs stay bare", () => {
  const rows = COUNTRIES.map((c) => ({ code: c.code, category: c.category }));
  attachApples(/** @type {any} */ (rows), APPLE.values);
  const byCode = new Map(rows.map((r) => [r.code, r]));
  for (const c of COUNTRIES) {
    const row = /** @type {any} */ (byCode.get(c.code));
    if (c.category === 'other') {
      assert.equal(row.apple, undefined, `org ${c.code} should have no apple field`);
    } else {
      assert.equal(typeof row.apple, 'number', `real place ${c.code} has no apple value`);
    }
  }
  assert.equal(/** @type {any} */ (byCode.get('cn')).apple, APPLE.values.cn);
  assert.equal(/** @type {any} */ (byCode.get('ng')).apple, 0); // Nigeria grows none
});

test('createMetric over apple stays sparse: it ranks producers only', () => {
  const apple = createMetric(APPLE, COUNTRIES);
  assert.equal(apple.topN('world', 1)[0].code, 'cn'); // China, the largest
  assert.equal(apple.rankOf('us', 'world'), 2); // United States second
  assert.equal(apple.has('ng'), false); // Nigeria grows none: no rank, not a 0
});

// ---- real oil.json schema + the sparse absence:'zero' contract -------------

test('oil is a valid, self-describing metric file with an absence hint', () => {
  assert.equal(OIL.key, 'oil');
  assert.equal(typeof OIL.label, 'string');
  assert.equal(typeof OIL.unit, 'string');
  assert.ok(OIL.format === 'compact' || OIL.format === 'decimal1', 'valid format hint');
  assert.equal(typeof OIL.source, 'string');
  assert.equal(typeof OIL.year, 'number');
  assert.equal(typeof OIL.values, 'object');
  // Sparse like the crops: producers only, absence means "pumps none" → 0.
  assert.equal(OIL.absence, 'zero');
});

test('every oil value is a positive integer (TWh, sub-1-TWh producers dropped)', () => {
  for (const [code, v] of Object.entries(OIL.values)) {
    assert.equal(Number.isInteger(v), true, `${code} not an integer: ${v}`);
    assert.ok(v >= 1, `${code} listed but not >= 1: ${v}`);
  }
});

test('every oil key is a real (non-other) country, never an org', () => {
  const byCode = new Map(COUNTRIES.map((c) => [c.code, c]));
  for (const code of Object.keys(OIL.values)) {
    const c = byCode.get(code);
    assert.ok(c, `oil key ${code} is not in countries.json`);
    assert.notEqual(c.category, 'other', `oil key ${code} is an "other" entry`);
  }
});

test("absence:'zero' contract: attachOils fills every real place, orgs stay bare", () => {
  const rows = COUNTRIES.map((c) => ({ code: c.code, category: c.category }));
  attachOils(/** @type {any} */ (rows), OIL.values);
  const byCode = new Map(rows.map((r) => [r.code, r]));
  for (const c of COUNTRIES) {
    const row = /** @type {any} */ (byCode.get(c.code));
    if (c.category === 'other') {
      assert.equal(row.oil, undefined, `org ${c.code} should have no oil field`);
    } else {
      assert.equal(typeof row.oil, 'number', `real place ${c.code} has no oil value`);
    }
  }
  assert.equal(/** @type {any} */ (byCode.get('us')).oil, OIL.values.us);
  assert.equal(/** @type {any} */ (byCode.get('ch')).oil, 0); // Switzerland pumps none
});

test('createMetric over oil stays sparse: it ranks producers only', () => {
  const oil = createMetric(OIL, COUNTRIES);
  assert.equal(oil.topN('world', 1)[0].code, 'us'); // United States, the largest
  assert.equal(oil.rankOf('ru', 'world'), 2); // Russia second
  assert.equal(oil.has('ch'), false); // Switzerland pumps none: no rank, not a 0
});

// ---- real rice.json schema + the sparse absence:'zero' contract ------------

test('rice is a valid, self-describing metric file with an absence hint', () => {
  assert.equal(RICE.key, 'rice');
  assert.equal(typeof RICE.label, 'string');
  assert.equal(typeof RICE.unit, 'string');
  assert.ok(RICE.format === 'compact' || RICE.format === 'decimal1', 'valid format hint');
  assert.equal(typeof RICE.source, 'string');
  assert.equal(typeof RICE.year, 'number');
  assert.equal(typeof RICE.values, 'object');
  // Sparse like the other crops: growers only, absence means "grows none" → 0.
  assert.equal(RICE.absence, 'zero');
});

test('every rice value is a positive integer (tonnes, sub-tonne growers dropped)', () => {
  for (const [code, v] of Object.entries(RICE.values)) {
    assert.equal(Number.isInteger(v), true, `${code} not an integer: ${v}`);
    assert.ok(v >= 1, `${code} listed but not >= 1: ${v}`);
  }
});

test('every rice key is a real (non-other) country, never an org', () => {
  const byCode = new Map(COUNTRIES.map((c) => [c.code, c]));
  for (const code of Object.keys(RICE.values)) {
    const c = byCode.get(code);
    assert.ok(c, `rice key ${code} is not in countries.json`);
    assert.notEqual(c.category, 'other', `rice key ${code} is an "other" entry`);
  }
});

test("absence:'zero' contract: attachRices fills every real place, orgs stay bare", () => {
  const rows = COUNTRIES.map((c) => ({ code: c.code, category: c.category }));
  attachRices(/** @type {any} */ (rows), RICE.values);
  const byCode = new Map(rows.map((r) => [r.code, r]));
  for (const c of COUNTRIES) {
    const row = /** @type {any} */ (byCode.get(c.code));
    if (c.category === 'other') {
      assert.equal(row.rice, undefined, `org ${c.code} should have no rice field`);
    } else {
      assert.equal(typeof row.rice, 'number', `real place ${c.code} has no rice value`);
    }
  }
  assert.equal(/** @type {any} */ (byCode.get('in')).rice, RICE.values.in);
  assert.equal(/** @type {any} */ (byCode.get('ca')).rice, 0); // Canada grows none
});

test('createMetric over rice stays sparse: it ranks growers only', () => {
  const rice = createMetric(RICE, COUNTRIES);
  assert.equal(rice.topN('world', 1)[0].code, 'in'); // India, the largest
  assert.equal(rice.rankOf('cn', 'world'), 2); // China second
  assert.equal(rice.has('ca'), false); // Canada grows none: no rank, not a 0
});

// ---- real coal.json schema + the sparse absence:'zero' contract ------------

test('coal is a valid, self-describing metric file with an absence hint', () => {
  assert.equal(COAL.key, 'coal');
  assert.equal(typeof COAL.label, 'string');
  assert.equal(typeof COAL.unit, 'string');
  assert.ok(COAL.format === 'compact' || COAL.format === 'decimal1', 'valid format hint');
  assert.equal(typeof COAL.source, 'string');
  assert.equal(typeof COAL.year, 'number');
  assert.equal(typeof COAL.values, 'object');
  // Sparse like oil / the crops: producers only, absence means "mines none" → 0.
  assert.equal(COAL.absence, 'zero');
});

test('every coal value is a positive integer (TWh, sub-1-TWh producers dropped)', () => {
  for (const [code, v] of Object.entries(COAL.values)) {
    assert.equal(Number.isInteger(v), true, `${code} not an integer: ${v}`);
    assert.ok(v >= 1, `${code} listed but not >= 1: ${v}`);
  }
});

test('every coal key is a real (non-other) country, never an org', () => {
  const byCode = new Map(COUNTRIES.map((c) => [c.code, c]));
  for (const code of Object.keys(COAL.values)) {
    const c = byCode.get(code);
    assert.ok(c, `coal key ${code} is not in countries.json`);
    assert.notEqual(c.category, 'other', `coal key ${code} is an "other" entry`);
  }
});

test("absence:'zero' contract: attachCoals fills every real place, orgs stay bare", () => {
  const rows = COUNTRIES.map((c) => ({ code: c.code, category: c.category }));
  attachCoals(/** @type {any} */ (rows), COAL.values);
  const byCode = new Map(rows.map((r) => [r.code, r]));
  for (const c of COUNTRIES) {
    const row = /** @type {any} */ (byCode.get(c.code));
    if (c.category === 'other') {
      assert.equal(row.coal, undefined, `org ${c.code} should have no coal field`);
    } else {
      assert.equal(typeof row.coal, 'number', `real place ${c.code} has no coal value`);
    }
  }
  assert.equal(/** @type {any} */ (byCode.get('cn')).coal, COAL.values.cn);
  assert.equal(/** @type {any} */ (byCode.get('fr')).coal, 0); // France mines none
});

test('createMetric over coal stays sparse: it ranks producers only', () => {
  const coal = createMetric(COAL, COUNTRIES);
  assert.equal(coal.topN('world', 1)[0].code, 'cn'); // China, the largest
  assert.equal(coal.rankOf('in', 'world'), 2); // India second
  assert.equal(coal.has('fr'), false); // France mines none: no rank, not a 0
});

test('createMetric over banana stays sparse: it ranks producers only', () => {
  const banana = createMetric(BANANA, COUNTRIES);
  assert.equal(banana.topN('world', 1)[0].code, 'in'); // India, the largest
  assert.equal(banana.rankOf('cn', 'world'), 2); // China second
  assert.equal(banana.has('af'), false); // Afghanistan isn't a producer → out of the ranking
});

// ---- real elevation.json schema + integration gate (dense, two-directional) --

test('elevation is a valid, self-describing metric file with the plain format', () => {
  assert.equal(ELEVATION.key, 'elevation');
  assert.equal(typeof ELEVATION.label, 'string');
  assert.equal(typeof ELEVATION.unit, 'string');
  // Elevation renders exact metres, not compact: Everest / K2 / Kangchenjunga
  // must stay distinguishable (8,849 vs 8,611 vs 8,586, not a shared "8.6K").
  assert.equal(ELEVATION.format, 'plain');
  assert.equal(typeof ELEVATION.source, 'string');
  assert.equal(typeof ELEVATION.year, 'number');
  assert.equal(typeof ELEVATION.values, 'object');
  // Dense, like area / GDP: no absence hint (absence would mean "unsourced",
  // never zero, since no real place sits at sea level).
  assert.equal(ELEVATION.absence, undefined);
});

test('every elevation value is a positive integer (whole metres, above sea level)', () => {
  // Whole metres; a highest point is by definition above sea level, so the floor
  // is 1 (the Maldives, the lowest highpoint on Earth, rounds to 2 m).
  for (const [code, v] of Object.entries(ELEVATION.values)) {
    assert.equal(Number.isInteger(v), true, `${code} not an integer: ${v}`);
    assert.ok(v >= 1, `${code} not >= 1: ${v}`);
  }
});

test('every real place has an elevation; only non-places have none', () => {
  // Same "no data = not a place" invariant the TTT guard leans on (metricDataGap).
  const values = ELEVATION.values;
  for (const c of COUNTRIES) {
    if (c.category === 'other') {
      assert.ok(!(c.code in values), `org ${c.code} should have no elevation value`);
    } else {
      assert.ok(c.code in values, `real place ${c.code} (${c.continent}) has no elevation value`);
    }
  }
});

test('createMetric over elevation ranks both extremes plausibly', () => {
  const elevation = createMetric(ELEVATION, COUNTRIES);
  // Everest is the highest point on Earth: Nepal and China share it at 8,849 m,
  // ties broken by code, so China (cn) leads Nepal (np).
  assert.equal(elevation.topN('world', 1)[0].code, 'cn');
  assert.equal(elevation.valueOf('cn'), 8849);
  // The two-directional draw: the lowest highpoint is the Maldives.
  const world = elevation.ranked('world');
  assert.equal(world[world.length - 1].code, 'mv');
  // Pakistan (K2) outranks India (Kangchenjunga), the world's #2 and #3 peaks.
  const pk = elevation.rankOf('pk', 'world');
  const ind = elevation.rankOf('in', 'world');
  assert.ok(pk !== null && ind !== null && pk < ind);
});

// ---- real coastline.json schema + integration gate (dense, landlocked = 0) --

test('coastline is a valid, self-describing metric file with the plain format', () => {
  assert.equal(COASTLINE.key, 'coastline');
  assert.equal(typeof COASTLINE.label, 'string');
  assert.equal(typeof COASTLINE.unit, 'string');
  // Coastline renders exact kilometres, not compact: Canada (202,080) and the
  // archipelago giants must stay distinguishable, not a shared "50K–200K".
  assert.equal(COASTLINE.format, 'plain');
  assert.equal(typeof COASTLINE.source, 'string');
  assert.equal(typeof COASTLINE.year, 'number');
  assert.equal(typeof COASTLINE.values, 'object');
  // Dense, like area / elevation: no absence hint. Unlike the crops, a missing
  // value would mean "unsourced", never zero — a landlocked place carries a
  // real, explicit 0 in the map rather than being omitted.
  assert.equal(COASTLINE.absence, undefined);
});

test('every coastline value is a non-negative integer (whole km; landlocked = 0)', () => {
  // Whole km; the floor is 0 (a landlocked place genuinely has no coast), so
  // unlike elevation the valid minimum is 0, not 1.
  for (const [code, v] of Object.entries(COASTLINE.values)) {
    assert.equal(Number.isInteger(v), true, `${code} not an integer: ${v}`);
    assert.ok(v >= 0, `${code} negative: ${v}`);
  }
});

test('every real place has a coastline; only non-places have none', () => {
  // Same "no data = not a place" invariant the TTT guard leans on (metricDataGap).
  // Landlocked places are present at 0, not omitted, so the invariant holds.
  const values = COASTLINE.values;
  for (const c of COUNTRIES) {
    if (c.category === 'other') {
      assert.ok(!(c.code in values), `org ${c.code} should have no coastline value`);
    } else {
      assert.ok(c.code in values, `real place ${c.code} (${c.continent}) has no coastline value`);
    }
  }
});

test('a landlocked place carries an explicit 0, not a missing value', () => {
  // The distinguishing feature of this dense metric: 0 is a real, sourced value.
  for (const code of ['ch', 'bo', 'np', 'xk', 'va']) {
    assert.equal(COASTLINE.values[code], 0, `${code} should be 0, not missing`);
  }
});

test('createMetric over coastline ranks the world plausibly', () => {
  const coastline = createMetric(COASTLINE, COUNTRIES);
  // Canada has by far the longest coastline on Earth.
  assert.equal(coastline.topN('world', 1)[0].code, 'ca');
  assert.equal(coastline.valueOf('ca'), 202080);
  // Indonesia is the archipelago runner-up among sovereign states.
  assert.equal(coastline.rankOf('id', 'sovereign'), 2);
});

test("attachCoastlines fills every real place (landlocked at 0), orgs stay bare", () => {
  // Dense-metric denormalizer: every real place ends up with a numeric field
  // (landlocked ones at 0), and only non-place orgs are left without it.
  const rows = COUNTRIES.map((c) => ({ code: c.code, category: c.category }));
  attachCoastlines(/** @type {any} */ (rows), COASTLINE.values);
  const byCode = new Map(rows.map((r) => [r.code, r]));
  for (const c of COUNTRIES) {
    const row = /** @type {any} */ (byCode.get(c.code));
    if (c.category === 'other') {
      assert.equal(row.coastline, undefined, `org ${c.code} should have no coastline field`);
    } else {
      assert.equal(typeof row.coastline, 'number', `real place ${c.code} has no coastline value`);
    }
  }
  assert.equal(/** @type {any} */ (byCode.get('ca')).coastline, COASTLINE.values.ca);
  assert.equal(/** @type {any} */ (byCode.get('ch')).coastline, 0); // Switzerland is landlocked
});

// ---- real forest.json schema + integration gate (dense, intensive, treeless = 0) --

test('forest is a valid, self-describing metric file with the decimal1 format', () => {
  assert.equal(FOREST.key, 'forest');
  assert.equal(typeof FOREST.label, 'string');
  assert.equal(typeof FOREST.unit, 'string');
  // Forest cover is a share of land area (0.0–96.6), so it renders with one
  // decimal, not compact or plain-integer.
  assert.equal(FOREST.format, 'decimal1');
  assert.equal(typeof FOREST.source, 'string');
  assert.equal(typeof FOREST.year, 'number');
  assert.equal(typeof FOREST.values, 'object');
  // Dense, like area / coastline: no absence hint. A missing value would mean
  // "unsourced", never zero — a treeless place carries a real, explicit 0.0.
  assert.equal(FOREST.absence, undefined);
});

test('every forest value is a finite percentage in [0, 100]', () => {
  // Intensive metric: a share of land area, so unlike the extensive metrics the
  // valid range is bounded at 100, and fractional values are the norm.
  for (const [code, v] of Object.entries(FOREST.values)) {
    assert.equal(Number.isFinite(v), true, `${code} not finite: ${v}`);
    assert.ok(v >= 0 && v <= 100, `${code} out of [0,100]: ${v}`);
  }
});

test('every real place has a forest value; only non-places have none', () => {
  // Same "no data = not a place" invariant the TTT guard leans on (metricDataGap).
  // Treeless places are present at 0.0, not omitted, so the invariant holds.
  const values = FOREST.values;
  for (const c of COUNTRIES) {
    if (c.category === 'other') {
      assert.ok(!(c.code in values), `org ${c.code} should have no forest value`);
    } else {
      assert.ok(c.code in values, `real place ${c.code} (${c.continent}) has no forest value`);
    }
  }
});

test('a treeless place carries an explicit 0, not a missing value', () => {
  // The distinguishing feature of this dense metric: 0.0 is a real, sourced value
  // (desert / ice / city-state), not a data gap.
  for (const code of ['eg', 'gl', 'qa', 'aq', 'va']) {
    assert.equal(FOREST.values[code], 0, `${code} should be 0, not missing`);
  }
});

test('createMetric over forest ranks the world plausibly and size-independently', () => {
  const forest = createMetric(FOREST, COUNTRIES);
  // French Guiana is the most forested place on Earth (~96.6%), a tiny territory
  // outranking every giant — the size-decoupled property this metric exists for.
  assert.equal(forest.topN('world', 1)[0].code, 'gf');
  // Among sovereign states the top three are Suriname, then the F.S. Micronesia /
  // Gabon cluster — all small, none a large country.
  assert.equal(forest.topN('sovereign', 1)[0].code, 'sr');
  // A giant sits mid-pack, not at the top: Australia is well below the leaders.
  assert.ok(/** @type {number} */ (forest.rankOf('au', 'world')) > 100);
});

test('attachForests fills every real place (treeless at 0), orgs stay bare', () => {
  // Dense-metric denormalizer: every real place ends up with a numeric field
  // (treeless ones at 0.0), and only non-place orgs are left without it.
  const rows = COUNTRIES.map((c) => ({ code: c.code, category: c.category }));
  attachForests(/** @type {any} */ (rows), FOREST.values);
  const byCode = new Map(rows.map((r) => [r.code, r]));
  for (const c of COUNTRIES) {
    const row = /** @type {any} */ (byCode.get(c.code));
    if (c.category === 'other') {
      assert.equal(row.forest, undefined, `org ${c.code} should have no forest field`);
    } else {
      assert.equal(typeof row.forest, 'number', `real place ${c.code} has no forest value`);
    }
  }
  assert.equal(/** @type {any} */ (byCode.get('gf')).forest, FOREST.values.gf);
  assert.equal(/** @type {any} */ (byCode.get('eg')).forest, 0); // Egypt is effectively treeless
});

// ---- guard: the party server can't loop METRIC_FILES (static imports for the
// Cloudflare bundle), so it hand-lists each metric. That's the one attach site
// the `attachMetrics` refactor couldn't make zero-edit, and it isn't otherwise
// unit-tested, so a new metric silently misfires online TTT until someone plays
// a puzzle with that axis. Scan its source to prove every metric is wired.
test('party/server.js attaches every registered metric (static-import site)', () => {
  const src = readFileSync(join(HERE, '..', 'party', 'server.js'), 'utf-8');
  for (const { key, file } of METRIC_FILES) {
    assert.ok(src.includes(`metrics/${file}`), `party/server.js does not import ${file}`);
    assert.ok(src.includes(`${key}: ${key}.values`), `party/server.js does not pass ${key} to attachMetrics`);
  }
});

// ---- real alcoholPerCapita.json schema + the absence:'unknown' contract -----

test('alcoholPerCapita is a valid, self-describing metric file with absence:unknown', () => {
  assert.equal(ALCOHOL_PC.key, 'alcoholPerCapita');
  assert.equal(typeof ALCOHOL_PC.label, 'string');
  assert.equal(typeof ALCOHOL_PC.unit, 'string');
  // Litres of pure alcohol (0..~13), one decimal.
  assert.equal(ALCOHOL_PC.format, 'decimal1');
  assert.equal(typeof ALCOHOL_PC.source, 'string');
  assert.equal(typeof ALCOHOL_PC.year, 'number');
  assert.equal(typeof ALCOHOL_PC.values, 'object');
  // absence:'unknown' like beer: WHO does not measure every real place.
  assert.equal(ALCOHOL_PC.absence, 'unknown');
});

test('every alcoholPerCapita value is a non-negative finite number', () => {
  for (const [code, v] of Object.entries(ALCOHOL_PC.values)) {
    assert.equal(Number.isFinite(v), true, `${code} not finite: ${v}`);
    assert.ok(v >= 0, `${code} negative: ${v}`);
  }
});

test('alcoholPerCapita covers only real places, never orgs; the gap is genuine (absence:unknown)', () => {
  const realCodes = new Set(COUNTRIES.filter((c) => c.category !== 'other').map((c) => c.code));
  for (const code of Object.keys(ALCOHOL_PC.values)) {
    assert.ok(realCodes.has(code), `alcohol value for non-real place ${code}`);
  }
  for (const c of COUNTRIES) {
    if (c.category === 'other') {
      assert.ok(!(c.code in ALCOHOL_PC.values), `org ${c.code} should have no alcoholPerCapita value`);
    }
  }
  const covered = COUNTRIES.filter((c) => c.category !== 'other' && c.code in ALCOHOL_PC.values).length;
  assert.ok(covered >= 180, `expected ~189 covered real places, got ${covered}`);
  assert.ok(covered < realCodes.size, 'alcohol must NOT be dense: some real places are the unknown gap');
  assert.ok('cz' in ALCOHOL_PC.values, 'Czechia (sovereign) must be covered');
  assert.ok(!('gb-wls' in ALCOHOL_PC.values), 'Wales (sub-national) is unknown, must be absent');
  assert.ok(!('gl' in ALCOHOL_PC.values), 'Greenland (territory) is unknown, must be absent');
});

test('createMetric over alcoholPerCapita ranks a European heavyweight top, dry states at 0', () => {
  const alcohol = createMetric(ALCOHOL_PC, COUNTRIES);
  // Lithuania is the top recorded per-capita drinker in this snapshot.
  assert.equal(alcohol.topN('world', 1)[0].code, 'lt');
  assert.ok(/** @type {number} */ (alcohol.valueOf('lt')) >= 12);
  assert.ok(/** @type {number} */ (alcohol.valueOf('de')) >= 10);
  assert.equal(alcohol.valueOf('kw'), 0); // Kuwait, a fully dry state
});

test('attachAlcoholPerCapitas fills covered real places, leaves the unknown gap + orgs bare', () => {
  const rows = COUNTRIES.map((c) => ({ code: c.code, category: c.category }));
  attachAlcoholPerCapitas(/** @type {any} */ (rows), ALCOHOL_PC.values);
  const byCode = new Map(rows.map((r) => [r.code, r]));
  assert.equal(/** @type {any} */ (byCode.get('cz')).alcoholPerCapita, ALCOHOL_PC.values.cz);
  assert.equal(/** @type {any} */ (byCode.get('gb-wls')).alcoholPerCapita, undefined);
  const anOrg = COUNTRIES.find((c) => c.category === 'other');
  assert.equal(/** @type {any} */ (byCode.get(/** @type {any} */ (anOrg).code)).alcoholPerCapita, undefined);
});

// ---- real meatPerCapita.json schema + the absence:'unknown' contract --------

test('meatPerCapita is a valid, self-describing metric file with absence:unknown', () => {
  assert.equal(MEAT_PC.key, 'meatPerCapita');
  assert.equal(typeof MEAT_PC.label, 'string');
  assert.equal(typeof MEAT_PC.unit, 'string');
  // Whole kg of meat (0..~124), plain.
  assert.equal(MEAT_PC.format, 'plain');
  assert.equal(typeof MEAT_PC.source, 'string');
  assert.equal(typeof MEAT_PC.year, 'number');
  assert.equal(typeof MEAT_PC.values, 'object');
  assert.equal(MEAT_PC.absence, 'unknown');
});

test('every meatPerCapita value is a non-negative integer', () => {
  for (const [code, v] of Object.entries(MEAT_PC.values)) {
    assert.equal(Number.isInteger(v), true, `${code} not an integer: ${v}`);
    assert.ok(v >= 0, `${code} negative: ${v}`);
  }
});

test('meatPerCapita covers only real places, never orgs; the gap is genuine (absence:unknown)', () => {
  const realCodes = new Set(COUNTRIES.filter((c) => c.category !== 'other').map((c) => c.code));
  for (const code of Object.keys(MEAT_PC.values)) {
    assert.ok(realCodes.has(code), `meat value for non-real place ${code}`);
  }
  for (const c of COUNTRIES) {
    if (c.category === 'other') {
      assert.ok(!(c.code in MEAT_PC.values), `org ${c.code} should have no meatPerCapita value`);
    }
  }
  const covered = COUNTRIES.filter((c) => c.category !== 'other' && c.code in MEAT_PC.values).length;
  assert.ok(covered >= 180, `expected ~189 covered real places, got ${covered}`);
  assert.ok(covered < realCodes.size, 'meat must NOT be dense: some real places are the unknown gap');
});

test('createMetric over meatPerCapita ranks the United States top, low-meat diets at the bottom', () => {
  const meat = createMetric(MEAT_PC, COUNTRIES);
  assert.equal(meat.topN('world', 1)[0].code, 'us');
  assert.ok(/** @type {number} */ (meat.valueOf('us')) > 100);
  assert.ok(/** @type {number} */ (meat.valueOf('in')) < 10); // India, famously low
});

test('attachMeatPerCapitas fills covered real places, leaves the unknown gap + orgs bare', () => {
  const rows = COUNTRIES.map((c) => ({ code: c.code, category: c.category }));
  attachMeatPerCapitas(/** @type {any} */ (rows), MEAT_PC.values);
  const byCode = new Map(rows.map((r) => [r.code, r]));
  assert.equal(/** @type {any} */ (byCode.get('us')).meatPerCapita, MEAT_PC.values.us);
  assert.equal(/** @type {any} */ (byCode.get('gb-wls')).meatPerCapita, undefined);
  const anOrg = COUNTRIES.find((c) => c.category === 'other');
  assert.equal(/** @type {any} */ (byCode.get(/** @type {any} */ (anOrg).code)).meatPerCapita, undefined);
});

// ---- real borders.json schema + the dense contract --------------------------

test('borders is a valid, self-describing dense metric file', () => {
  assert.equal(BORDERS.key, 'borders');
  assert.equal(typeof BORDERS.label, 'string');
  assert.equal(typeof BORDERS.unit, 'string');
  assert.equal(BORDERS.format, 'plain');
  assert.equal(typeof BORDERS.source, 'string');
  assert.equal(typeof BORDERS.year, 'number');
  assert.equal(typeof BORDERS.values, 'object');
  // Dense (like area): no absence hint. Every real place has a true count.
  assert.equal(BORDERS.absence, undefined);
});

test('every borders value is a non-negative integer', () => {
  for (const [code, v] of Object.entries(BORDERS.values)) {
    assert.equal(Number.isInteger(v), true, `${code} not an integer: ${v}`);
    assert.ok(v >= 0, `${code} negative: ${v}`);
  }
});

test('every real place has a borders value; only non-places have none', () => {
  const values = BORDERS.values;
  for (const c of COUNTRIES) {
    if (c.category === 'other') {
      assert.ok(!(c.code in values), `org ${c.code} should have no borders value`);
    } else {
      assert.ok(c.code in values, `real place ${c.code} (${c.continent}) has no borders value`);
    }
  }
});

test('createMetric over borders ranks Russia/China top at 14, islands at 0', () => {
  const b = createMetric(BORDERS, COUNTRIES);
  // Russia and China tie at 14 (the world maximum); the code tie-break puts cn first.
  assert.equal(b.topN('world', 1)[0].code, 'cn');
  assert.equal(b.valueOf('ru'), 14);
  assert.equal(b.valueOf('br'), 10); // Brazil borders all but Chile and Ecuador
  assert.equal(b.valueOf('is'), 0); // Iceland, an island, borders nobody
});

test('attachBorders fills every real place (islands at 0), orgs stay bare', () => {
  const rows = COUNTRIES.map((c) => ({ code: c.code, category: c.category }));
  attachBorders(/** @type {any} */ (rows), BORDERS.values);
  const byCode = new Map(rows.map((r) => [r.code, r]));
  for (const c of COUNTRIES) {
    const row = /** @type {any} */ (byCode.get(c.code));
    if (c.category === 'other') {
      assert.equal(row.borders, undefined, `org ${c.code} should have no borders field`);
    } else {
      assert.equal(typeof row.borders, 'number', `real place ${c.code} has no borders value`);
    }
  }
  assert.equal(/** @type {any} */ (byCode.get('cn')).borders, 14);
  assert.equal(/** @type {any} */ (byCode.get('is')).borders, 0); // Iceland has no land border
});

// ---- real corruption.json schema + the absence:'unknown' contract ----------
// CPI: 0 (highly corrupt) .. 100 (very clean), so HIGHER = LESS corrupt. Only
// ~180 sovereign states are scored; microstates / sub-national parts / small
// territories are the honest "unknown" gap (like beerPerCapita).

test('corruption is a valid, self-describing metric file with absence:unknown', () => {
  assert.equal(CORRUPTION.key, 'corruption');
  assert.equal(typeof CORRUPTION.label, 'string');
  assert.equal(typeof CORRUPTION.unit, 'string');
  // Whole scores 0..100, rendered plain.
  assert.equal(CORRUPTION.format, 'plain');
  assert.equal(typeof CORRUPTION.source, 'string');
  assert.equal(typeof CORRUPTION.year, 'number');
  assert.equal(typeof CORRUPTION.values, 'object');
  // Absence means "TI does not score this place", not 0 (0 would read as
  // maximally corrupt). The attacher (none yet) would leave the gap bare.
  assert.equal(CORRUPTION.absence, 'unknown');
});

test('every corruption value is an integer in [0, 100]', () => {
  for (const [code, v] of Object.entries(CORRUPTION.values)) {
    assert.equal(Number.isInteger(v), true, `${code} not an integer: ${v}`);
    assert.ok(v >= 0 && v <= 100, `${code} out of [0,100]: ${v}`);
  }
});

test('corruption covers only real places, never orgs; the gap is genuine (absence:unknown)', () => {
  const realCodes = new Set(COUNTRIES.filter((c) => c.category !== 'other').map((c) => c.code));
  for (const code of Object.keys(CORRUPTION.values)) {
    assert.ok(realCodes.has(code), `corruption value for non-real place ${code}`);
  }
  for (const c of COUNTRIES) {
    if (c.category === 'other') {
      assert.ok(!(c.code in CORRUPTION.values), `org ${c.code} should have no corruption value`);
    }
  }
  // Broad sovereign coverage, but deliberately not total.
  const covered = COUNTRIES.filter((c) => c.category !== 'other' && c.code in CORRUPTION.values).length;
  assert.ok(covered >= 175, `expected ~180 scored real places, got ${covered}`);
  assert.ok(covered < realCodes.size, 'corruption must NOT be dense: some real places are the unknown gap');
  // A scored sovereign is present; a sub-national part / uncovered territory is the gap.
  assert.ok('dk' in CORRUPTION.values, 'Denmark (sovereign) must be scored');
  assert.ok(!('gb-wls' in CORRUPTION.values), 'Wales (sub-national) is unknown, must be absent');
  assert.ok(!('gl' in CORRUPTION.values), 'Greenland (territory) is unknown, must be absent');
});

test('createMetric over corruption ranks the cleanest top, the most corrupt at the floor', () => {
  const cpi = createMetric(CORRUPTION, COUNTRIES);
  // Denmark is the cleanest (highest score); Finland is second.
  assert.equal(cpi.topN('world', 1)[0].code, 'dk');
  assert.equal(cpi.valueOf('dk'), 89);
  assert.equal(cpi.rankOf('fi', 'world'), 2);
  // The floor is a 9-point tie between Somalia and South Sudan.
  const bottom = cpi.bottomN('world', 2).map((r) => r.code).sort();
  assert.deepEqual(bottom, ['so', 'ss']);
  assert.equal(cpi.valueOf('so'), 9);
});

// ---- real temperature.json schema + the dense contract ----------------------
// The first metric whose values can be NEGATIVE (climate normals in Celsius),
// so the numeric test checks Number.isFinite, not `>= 0`. Temperature is a
// physical fact, so the metric is DENSE: the country-level table (~234 places)
// plus hand-filled sub-national parts / territories / polar islands cover every
// real place. Only org flags (category 'other') have no value.

test('temperature is a valid, self-describing metric file (dense, no absence)', () => {
  assert.equal(TEMPERATURE.key, 'temperature');
  assert.equal(typeof TEMPERATURE.label, 'string');
  assert.equal(typeof TEMPERATURE.unit, 'string');
  // Celsius, one decimal (30.4, -3.8).
  assert.equal(TEMPERATURE.format, 'decimal1');
  assert.equal(typeof TEMPERATURE.source, 'string');
  assert.equal(typeof TEMPERATURE.year, 'number');
  assert.equal(typeof TEMPERATURE.values, 'object');
  // Dense metric: no `absence` hint (a missing value means a non-place, not
  // an unknown real place). Filling every real place keeps the TTT no-data
  // guard blocking only org flags.
  assert.equal(TEMPERATURE.absence, undefined);
});

test('every temperature value is a finite number (negatives allowed)', () => {
  // Unlike every other metric, a value may be below 0: the cold floor
  // (Greenland ~-18.7, Svalbard ~-6.8, Russia ~-3.8) is real, not an error.
  let sawNegative = false;
  for (const [code, v] of Object.entries(TEMPERATURE.values)) {
    assert.equal(Number.isFinite(v), true, `${code} not finite: ${v}`);
    if (v < 0) sawNegative = true;
  }
  assert.ok(sawNegative, 'expected some sub-zero climate normals');
});

test('temperature is dense: every real place has a value, only orgs are absent', () => {
  const realCodes = new Set(COUNTRIES.filter((c) => c.category !== 'other').map((c) => c.code));
  for (const code of Object.keys(TEMPERATURE.values)) {
    assert.ok(realCodes.has(code), `temperature value for non-real place ${code}`);
  }
  for (const c of COUNTRIES) {
    if (c.category === 'other') {
      assert.ok(!(c.code in TEMPERATURE.values), `org ${c.code} should have no temperature value`);
    }
  }
  // Dense: every real place carries a value so the TTT no-data guard blocks
  // only org flags. Temperature is a physical fact, so this is honest (unlike a
  // survey metric, no real place is a genuine "unknown").
  const covered = COUNTRIES.filter((c) => c.category !== 'other' && c.code in TEMPERATURE.values).length;
  assert.equal(covered, realCodes.size, `every real place must have a temperature, got ${covered}/${realCodes.size}`);
  // A country and a sub-national part are both present now.
  assert.ok('sg' in TEMPERATURE.values, 'Singapore (country) must be covered');
  assert.ok('gb-wls' in TEMPERATURE.values, 'Wales (sub-national) must be filled');
});

test('createMetric over temperature ranks the hottest top and the coldest at the floor', () => {
  const temp = createMetric(TEMPERATURE, COUNTRIES);
  // Burkina Faso is the hottest place; Antarctica is the coldest now that the
  // metric is dense (its hand-filled -49 sits below Greenland's -18.68).
  assert.equal(temp.topN('world', 1)[0].code, 'bf');
  assert.ok(/** @type {number} */ (temp.valueOf('bf')) > 30);
  assert.equal(temp.bottomN('world', 1)[0].code, 'aq');
  assert.ok(/** @type {number} */ (temp.valueOf('aq')) < -40);
});

// ---- real happiness.json schema + the absence:'unknown' contract -----------
// World Happiness Report ladder score. The Gallup World Poll reaches ~147
// countries, the thinnest coverage in the family; everywhere it does not survey
// is the honest "unknown" gap (0 is the ladder's worst-life floor, not "no data").

test('happiness is a valid, self-describing metric file with absence:unknown', () => {
  assert.equal(HAPPINESS.key, 'happiness');
  assert.equal(typeof HAPPINESS.label, 'string');
  assert.equal(typeof HAPPINESS.unit, 'string');
  // Ladder score, one decimal on display (7.7); three decimals stored.
  assert.equal(HAPPINESS.format, 'decimal1');
  assert.equal(typeof HAPPINESS.source, 'string');
  assert.equal(typeof HAPPINESS.year, 'number');
  assert.equal(typeof HAPPINESS.values, 'object');
  // Absence means "not surveyed", not 0 (0 is the ladder's worst-life floor).
  assert.equal(HAPPINESS.absence, 'unknown');
});

test('every happiness value is a finite number in [0, 10]', () => {
  for (const [code, v] of Object.entries(HAPPINESS.values)) {
    assert.equal(Number.isFinite(v), true, `${code} not finite: ${v}`);
    assert.ok(v >= 0 && v <= 10, `${code} out of ladder range [0,10]: ${v}`);
  }
});

test('happiness covers only real places, never orgs; the gap is genuine (absence:unknown)', () => {
  const realCodes = new Set(COUNTRIES.filter((c) => c.category !== 'other').map((c) => c.code));
  for (const code of Object.keys(HAPPINESS.values)) {
    assert.ok(realCodes.has(code), `happiness value for non-real place ${code}`);
  }
  for (const c of COUNTRIES) {
    if (c.category === 'other') {
      assert.ok(!(c.code in HAPPINESS.values), `org ${c.code} should have no happiness value`);
    }
  }
  // Real but deliberately thin coverage (the survey's reach), never total.
  const covered = COUNTRIES.filter((c) => c.category !== 'other' && c.code in HAPPINESS.values).length;
  assert.ok(covered >= 140, `expected ~147 surveyed real places, got ${covered}`);
  assert.ok(covered < realCodes.size, 'happiness must NOT be dense: unsurveyed real places are the unknown gap');
  // A surveyed country is present; a territory / sub-national part is the gap.
  assert.ok('fi' in HAPPINESS.values, 'Finland (surveyed) must be covered');
  assert.ok(!('gl' in HAPPINESS.values), 'Greenland (territory) is unsurveyed, must be absent');
  assert.ok(!('gb-wls' in HAPPINESS.values), 'Wales (sub-national) is unsurveyed, must be absent');
});

test('createMetric over happiness ranks Finland top and Afghanistan at the floor', () => {
  const hap = createMetric(HAPPINESS, COUNTRIES);
  // Finland has led for years; Denmark is second.
  assert.equal(hap.topN('world', 1)[0].code, 'fi');
  assert.equal(hap.rankOf('dk', 'world'), 2);
  // Afghanistan is the lowest life evaluation on record here.
  assert.equal(hap.bottomN('world', 1)[0].code, 'af');
  assert.ok(/** @type {number} */ (hap.valueOf('af')) < 2);
});

// ---- real tourismPerCapita.json schema + the absence:'unknown' contract -----

test('tourismPerCapita is a valid, self-describing metric file with absence:unknown', () => {
  assert.equal(TOURISM_PC.key, 'tourismPerCapita');
  assert.equal(typeof TOURISM_PC.label, 'string');
  assert.equal(typeof TOURISM_PC.unit, 'string');
  // A rate spanning ~0.01 to ~102 arrivals per resident, rendered with 2
  // significant figures like the sheep/cattle-per-capita rates.
  assert.equal(TOURISM_PC.format, 'sig2');
  assert.equal(typeof TOURISM_PC.source, 'string');
  assert.equal(typeof TOURISM_PC.year, 'number');
  assert.equal(typeof TOURISM_PC.values, 'object');
  // absence:'unknown' — the states the World Bank has no arrivals figure for
  // (conflict / closed economies) carry no value, NOT 0.
  assert.equal(TOURISM_PC.absence, 'unknown');
});

test('every tourismPerCapita value is a non-negative finite number', () => {
  for (const [code, v] of Object.entries(TOURISM_PC.values)) {
    assert.equal(Number.isFinite(v), true, `${code} not finite: ${v}`);
    assert.ok(v >= 0, `${code} negative: ${v}`);
  }
});

test('tourismPerCapita covers only real places, never orgs; the gap is genuine (absence:unknown)', () => {
  // NOT dense: the World Bank reports arrivals for ~186 real places but not for
  // the states it has no figure from. So every key is a real place, no org has
  // one, and the uncovered real places are the honest "unknown" gap.
  const realCodes = new Set(COUNTRIES.filter((c) => c.category !== 'other').map((c) => c.code));
  for (const code of Object.keys(TOURISM_PC.values)) {
    assert.ok(realCodes.has(code), `tourism value for non-real place ${code}`);
  }
  for (const c of COUNTRIES) {
    if (c.category === 'other') {
      assert.ok(!(c.code in TOURISM_PC.values), `org ${c.code} should have no tourismPerCapita value`);
    }
  }
  const covered = COUNTRIES.filter((c) => c.category !== 'other' && c.code in TOURISM_PC.values).length;
  assert.ok(covered >= 180, `expected ~186 covered real places, got ${covered}`);
  assert.ok(covered < realCodes.size, 'tourism must NOT be dense: some real places are the unknown gap');
  // A tourist magnet is covered; a state with no World Bank figure is the gap.
  assert.ok('ad' in TOURISM_PC.values, 'Andorra must be covered');
  assert.ok(!('kp' in TOURISM_PC.values), 'North Korea (no figure) must be absent');
});

test('createMetric over tourismPerCapita ranks the micro-states top, size-independently', () => {
  const tourism = createMetric(TOURISM_PC, COUNTRIES);
  // Andorra is the extreme: ~8M arrivals over ~80k residents, a tiny place topping
  // every large country, the intensive property this metric exists for.
  assert.equal(tourism.topN('world', 1)[0].code, 'ad');
  assert.ok(/** @type {number} */ (tourism.valueOf('ad')) > 50);
  // The "more arrivals than residents" club is small tourist states; a giant like
  // India sits far below 1 (many visitors, far more residents).
  assert.ok(/** @type {number} */ (tourism.valueOf('hr')) >= 1); // Croatia
  assert.ok(/** @type {number} */ (tourism.valueOf('in')) < 1);  // India
});

test('attachTourismPerCapitas fills covered real places, leaves the unknown gap + orgs bare', () => {
  const rows = COUNTRIES.map((c) => ({ code: c.code, category: c.category }));
  attachTourismPerCapitas(/** @type {any} */ (rows), TOURISM_PC.values);
  const byCode = new Map(rows.map((r) => [r.code, r]));
  assert.equal(/** @type {any} */ (byCode.get('ad')).tourismPerCapita, TOURISM_PC.values.ad);
  // Unknown-gap real place stays bare (no false 0) so the guard reads "no data".
  assert.equal(/** @type {any} */ (byCode.get('kp')).tourismPerCapita, undefined);
  const anOrg = COUNTRIES.find((c) => c.category === 'other');
  assert.equal(/** @type {any} */ (byCode.get(/** @type {any} */ (anOrg).code)).tourismPerCapita, undefined);
});

// ---- real electricityPerCapita.json schema + the absence:'unknown' contract --

test('electricityPerCapita is a valid, self-describing metric file with absence:unknown', () => {
  assert.equal(ELECTRICITY_PC.key, 'electricityPerCapita');
  assert.equal(typeof ELECTRICITY_PC.label, 'string');
  assert.equal(typeof ELECTRICITY_PC.unit, 'string');
  // kWh per person over a wide range (14..~49,000), rendered compact.
  assert.equal(ELECTRICITY_PC.format, 'compact');
  assert.equal(typeof ELECTRICITY_PC.source, 'string');
  assert.equal(typeof ELECTRICITY_PC.year, 'number');
  assert.equal(typeof ELECTRICITY_PC.values, 'object');
  // absence:'unknown' — the micro-states the World Bank does not meter carry no
  // value, NOT 0.
  assert.equal(ELECTRICITY_PC.absence, 'unknown');
});

test('every electricityPerCapita value is a non-negative finite number', () => {
  for (const [code, v] of Object.entries(ELECTRICITY_PC.values)) {
    assert.equal(Number.isFinite(v), true, `${code} not finite: ${v}`);
    assert.ok(v >= 0, `${code} negative: ${v}`);
  }
});

test('electricityPerCapita covers only real places, never orgs; the gap is genuine (absence:unknown)', () => {
  const realCodes = new Set(COUNTRIES.filter((c) => c.category !== 'other').map((c) => c.code));
  for (const code of Object.keys(ELECTRICITY_PC.values)) {
    assert.ok(realCodes.has(code), `electricity value for non-real place ${code}`);
  }
  for (const c of COUNTRIES) {
    if (c.category === 'other') {
      assert.ok(!(c.code in ELECTRICITY_PC.values), `org ${c.code} should have no electricityPerCapita value`);
    }
  }
  const covered = COUNTRIES.filter((c) => c.category !== 'other' && c.code in ELECTRICITY_PC.values).length;
  assert.ok(covered >= 140, `expected ~149 covered real places, got ${covered}`);
  assert.ok(covered < realCodes.size, 'electricity must NOT be dense: some real places are the unknown gap');
  assert.ok('is' in ELECTRICITY_PC.values, 'Iceland must be covered');
  assert.ok(!('ad' in ELECTRICITY_PC.values), 'Andorra (unmetered by the World Bank) must be absent');
});

test('createMetric over electricityPerCapita ranks Iceland top, size-independently', () => {
  const elec = createMetric(ELECTRICITY_PC, COUNTRIES);
  // Iceland leads by a wide margin (geothermal power + aluminium smelting), a tiny
  // country topping every giant.
  assert.equal(elec.topN('world', 1)[0].code, 'is');
  assert.ok(/** @type {number} */ (elec.valueOf('is')) > 40000);
  // The big populous countries sit mid-table, the intensive property this exists for.
  assert.ok(/** @type {number} */ (elec.valueOf('cn')) < /** @type {number} */ (elec.valueOf('no'))); // China < Norway
});

test('attachElectricityPerCapitas fills covered real places, leaves the unknown gap + orgs bare', () => {
  const rows = COUNTRIES.map((c) => ({ code: c.code, category: c.category }));
  attachElectricityPerCapitas(/** @type {any} */ (rows), ELECTRICITY_PC.values);
  const byCode = new Map(rows.map((r) => [r.code, r]));
  assert.equal(/** @type {any} */ (byCode.get('is')).electricityPerCapita, ELECTRICITY_PC.values.is);
  assert.equal(/** @type {any} */ (byCode.get('ad')).electricityPerCapita, undefined);
  const anOrg = COUNTRIES.find((c) => c.category === 'other');
  assert.equal(/** @type {any} */ (byCode.get(/** @type {any} */ (anOrg).code)).electricityPerCapita, undefined);
});

// ---- real mcdonaldsPerMillion.json: the three-state absence contract --------
//
// This metric is the only one with THREE absence states rather than two, so its
// tests are about telling them apart. A place either (1) has a count, (2) has
// no McDonald's at all and carries an explicit 0, or (3) is folded into another
// market's row and is genuinely unknown. State 2 is the metric's whole point
// (Iceland and Bolivia lost theirs, and that is the trivia); state 3 must never
// be confused with it, because calling Monaco "no McDonald's" is just wrong.

test('mcdonaldsPerMillion is a valid, self-describing metric file with absence:unknown', () => {
  assert.equal(MCDONALDS.key, 'mcdonaldsPerMillion');
  assert.equal(typeof MCDONALDS.label, 'string');
  assert.equal(typeof MCDONALDS.unit, 'string');
  // A small rate (0..~70 restaurants per million), so one decimal.
  assert.equal(MCDONALDS.format, 'decimal1');
  assert.equal(typeof MCDONALDS.source, 'string');
  assert.equal(typeof MCDONALDS.year, 'number');
  assert.equal(typeof MCDONALDS.values, 'object');
  // NOT absence:'zero', even though real zeros are abundant. The folded markets
  // (state 3) have restaurants with no published count, so a blanket zero-fill
  // would assert something false about them.
  assert.equal(MCDONALDS.absence, 'unknown');
});

test('every mcdonaldsPerMillion value is a non-negative finite number', () => {
  for (const [code, v] of Object.entries(MCDONALDS.values)) {
    assert.equal(Number.isFinite(v), true, `${code} not finite: ${v}`);
    assert.ok(v >= 0, `${code} negative: ${v}`);
  }
});

test('mcdonaldsPerMillion covers only real places, never orgs', () => {
  const realCodes = new Set(COUNTRIES.filter((c) => c.category !== 'other').map((c) => c.code));
  for (const code of Object.keys(MCDONALDS.values)) {
    assert.ok(realCodes.has(code), `mcdonalds value for non-real place ${code}`);
  }
  for (const c of COUNTRIES) {
    if (c.category === 'other') {
      assert.ok(!(c.code in MCDONALDS.values), `org ${c.code} should have no value`);
    }
  }
  // Near-total coverage: only the folded markets are missing, so this sits far
  // above a survey metric like beer (~189) and just below dense.
  const covered = COUNTRIES.filter((c) => c.category !== 'other' && c.code in MCDONALDS.values).length;
  assert.ok(covered >= 240, `expected ~248 covered real places, got ${covered}`);
  assert.ok(covered < realCodes.size, 'must NOT be dense: the folded markets are the gap');
});

test('absence state 2: a country with no McDonald\'s carries an explicit 0, not a gap', () => {
  // The withdrawals, which are the best trivia in the metric. If any of these
  // ever reads undefined, the "which countries have none" answer silently loses
  // its most interesting entries and the guard starts blocking them instead.
  for (const code of ['is', 'bo', 'ru', 'by', 'kz', 'lk', 'jm', 'mk', 'me', 'sm']) {
    assert.equal(MCDONALDS.values[code], 0, `${code} withdrew, must be an explicit 0`);
  }
  // Never-present countries are zeros too, not gaps.
  for (const code of ['ir', 'kp', 'ng', 'ke', 'bd', 'np', 'mn']) {
    assert.equal(MCDONALDS.values[code], 0, `${code} has none, must be an explicit 0`);
  }
});

test('absence state 3: a market folded into another row is absent, NOT zero', () => {
  // These places DO have McDonald's; the source publishes no standalone count
  // for them. Encoding them as 0 would be a factual error, so they must read
  // "no data" instead. This is the reason the metric is absence:'unknown'.
  for (const code of ['mc', 'ad', 'li', 'cu', 'gi', 'im', 'je', 'fj', 'gu']) {
    assert.ok(!(code in MCDONALDS.values), `${code} is folded into a parent market, must be absent`);
  }
});

test('createMetric over mcdonaldsPerMillion: the #1 is not the country with the most outlets', () => {
  const mcd = createMetric(MCDONALDS, COUNTRIES);
  // The whole point of making this intensive. The US has by far the most
  // restaurants (13,706) and China is second by count, yet neither leads here.
  const topSovereign = mcd.topN('un_member', 3).map((c) => c.code);
  assert.ok(topSovereign.includes('au'), `expected Australia near the top, got ${topSovereign}`);
  assert.ok(topSovereign.includes('us'), `expected the US near the top, got ${topSovereign}`);
  // The populous giants sit far down despite huge absolute counts.
  assert.ok(/** @type {number} */ (mcd.valueOf('cn')) < 10, 'China must rank low per head');
  assert.ok(/** @type {number} */ (mcd.valueOf('in')) < 5, 'India must rank low per head');
  // Australia and the US are within ~1% of each other, so their ORDER is not
  // pinned here on purpose: the counts drift 2-7% a year and the lead can flip
  // between annual releases. Pinning it would make a refresh fail spuriously.
  const au = /** @type {number} */ (mcd.valueOf('au'));
  const us = /** @type {number} */ (mcd.valueOf('us'));
  assert.ok(Math.abs(au - us) / us < 0.05, 'AU and US are expected to be near-tied at the top');
});
