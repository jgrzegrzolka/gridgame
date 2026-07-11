import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildMetricTierItems, METRIC_TIER_REGISTRY } from './metricTiers.js';
import { POPULATION_BREAKS_FOR_RANDOM } from './engine.js';

/** Hand-built population set spanning the breakpoints, plus one country with
 * no population field (the sparse case the predicate must skip). */
const FIX = [
  { code: 'big', population: 150_000_000 }, // >=100M, >=50M, >=10M
  { code: 'mid', population: 30_000_000 }, //          >=10M
  { code: 'sml', population: 3_000_000 }, //  <=20M, <=5M
  { code: 'tny', population: 500_000 }, //    <=20M, <=5M, <=1M
  { code: 'nul' }, // no population — matches no threshold
];

test('builds one item per non-empty breakpoint, breakpoint order', () => {
  const items = buildMetricTierItems('population', /** @type {any} */ (FIX));
  // Every population break has at least one match in the fixture, so all six survive.
  assert.equal(items.length, POPULATION_BREAKS_FOR_RANDOM.length);
  assert.deepEqual(
    items.map((it) => it.value),
    ['>=10000000', '>=50000000', '>=100000000', '<=20000000', '<=5000000', '<=1000000'],
  );
});

test('counts via the canonical predicate and skips countries with no value', () => {
  const items = buildMetricTierItems('population', /** @type {any} */ (FIX));
  const by = Object.fromEntries(items.map((it) => [it.value, it.count]));
  assert.equal(by['>=100000000'], 1); // big
  assert.equal(by['>=50000000'], 1); // big
  assert.equal(by['>=10000000'], 2); // big, mid
  assert.equal(by['<=20000000'], 2); // sml, tny
  assert.equal(by['<=5000000'], 2); // sml, tny
  assert.equal(by['<=1000000'], 1); // tny
  // 'nul' (no population) never counted toward any tier.
});

test('drops 0-count tiers so only playable filters are offered', () => {
  // Only huge countries: the small-tier breakpoints match nothing and vanish.
  const items = buildMetricTierItems('population', /** @type {any} */ ([
    { code: 'a', population: 200_000_000 },
    { code: 'b', population: 120_000_000 },
  ]));
  assert.deepEqual(items.map((it) => it.value), ['>=10000000', '>=50000000', '>=100000000']);
});

test('unknown metric key yields no tiers (no throw)', () => {
  assert.deepEqual(buildMetricTierItems('gdp', /** @type {any} */ (FIX)), []);
});

test('registry entries expose breaks + a factory whose predicate is callable', () => {
  for (const [key, entry] of Object.entries(METRIC_TIER_REGISTRY)) {
    assert.ok(Array.isArray(entry.breaks) && entry.breaks.length > 0, `${key} has breaks`);
    const { op, n } = entry.breaks[0];
    const cat = entry.factory(op, n);
    assert.equal(typeof cat.predicate, 'function', `${key} factory returns a predicate`);
  }
});
