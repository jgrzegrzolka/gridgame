import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { createMetric } from './metrics.js';

/** @typedef {{ code: string, continent: string, statehood: string, category?: string }} Row */

const HERE = dirname(fileURLToPath(import.meta.url));
const load = (/** @type {string} */ p) => JSON.parse(readFileSync(join(HERE, p), 'utf-8'));
const COUNTRIES = /** @type {Row[]} */ (load('countries.json'));
const POPULATION = /** @type {import('./metrics.js').MetricData} */ (load('metrics/population.json'));

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

test('every population value is a positive integer', () => {
  for (const [code, v] of Object.entries(POPULATION.values)) {
    assert.equal(Number.isInteger(v), true, `${code} not an integer: ${v}`);
    assert.ok(v > 0, `${code} not positive: ${v}`);
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

test('population covers the vast majority of real places (sparse tail only)', () => {
  const real = COUNTRIES.filter((c) => c.category !== 'other');
  const covered = Object.keys(POPULATION.values).length;
  // ~262 real places, a handful of uninhabited places intentionally omitted
  assert.ok(covered >= real.length - 12, `only ${covered}/${real.length} covered`);
});

test('createMetric over real data ranks the world plausibly', () => {
  const pop = createMetric(POPULATION, COUNTRIES);
  const top2 = pop.topN('world', 2).map((r) => r.code);
  assert.deepEqual(top2.sort(), ['cn', 'in']); // China + India, order-agnostic
  assert.equal(pop.rankOf('va', 'world') !== null, true);
  // UN-member scope excludes territories like Hong Kong from the ranking
  assert.equal(pop.rankOf('hk', 'un_member'), null);
});
