import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  METRIC_CUT_GROUPS,
  cutsFor,
  resolveCut,
  subjectFor,
  isSecondaryCut,
  chipMetrics,
} from './metricCuts.js';
import { METRIC_FILES } from './metrics/index.js';
import { METRIC_ICONS, METRIC_HUES, METRIC_SHORT } from './metricVisuals.js';

const REGISTERED = new Set(METRIC_FILES.map((m) => m.key));

// ---- the catalog itself -------------------------------------------------

test('every cut names a metric that actually exists', () => {
  // A typo here would render a chip that reads an undefined data file and
  // silently shows an empty lens.
  for (const g of METRIC_CUT_GROUPS) {
    assert.ok(REGISTERED.has(g.subjectKey), `subject "${g.subjectKey}" is not in METRIC_FILES`);
    for (const c of g.cuts) {
      assert.ok(REGISTERED.has(c.key), `cut "${c.key}" is not in METRIC_FILES`);
    }
  }
});

test("a group's subject IS its total cut", () => {
  // The invariant the whole design rests on: no synthetic ids, so the chip
  // keeps the icon / hue / i18n / tiers it already had.
  for (const g of METRIC_CUT_GROUPS) {
    const total = g.cuts.find((c) => c.cut === 'total');
    assert.ok(total, `group "${g.subjectKey}" has no total cut`);
    assert.equal(total.key, g.subjectKey);
  }
});

test('every group offers exactly one total and one per cut', () => {
  for (const g of METRIC_CUT_GROUPS) {
    assert.deepEqual(g.cuts.map((c) => c.cut), ['total', 'per']);
  }
});

test('no metric belongs to two groups', () => {
  const seen = new Set();
  for (const g of METRIC_CUT_GROUPS) {
    for (const c of g.cuts) {
      assert.ok(!seen.has(c.key), `"${c.key}" is a cut of more than one subject`);
      seen.add(c.key);
    }
  }
});

test('every cut carries a translatable label', () => {
  for (const g of METRIC_CUT_GROUPS) {
    for (const c of g.cuts) {
      assert.equal(typeof c.label.key, 'string');
      assert.ok(c.label.key.startsWith('flagsdata.'), c.label.key);
      assert.ok(c.label.fallback.length > 0);
    }
  }
});

test('the five known subjects are grouped and nothing else is', () => {
  assert.deepEqual(
    METRIC_CUT_GROUPS.map((g) => g.subjectKey),
    ['population', 'gdp', 'nobel', 'summerMedals', 'winterMedals'],
  );
});

test('density is cut per area, not per person', () => {
  // Population/km² is the one group whose divisor is not people. Getting this
  // wrong would label the density view "Per person", which is nonsense.
  const pop = METRIC_CUT_GROUPS.find((g) => g.subjectKey === 'population');
  if (!pop) throw new Error('population group is missing');
  const per = pop.cuts.find((c) => c.cut === 'per');
  if (!per) throw new Error('population has no per cut');
  assert.equal(per.key, 'density');
  assert.equal(per.label.key, 'flagsdata.cutPerArea');
});

test('a per-capita-only metric is not a cut of anything', () => {
  // Beer / meat / tourism / electricity / McDonald's exist only normalised.
  // Grouping them would render a cut control with nothing to switch to.
  for (const key of ['beerPerCapita', 'meatPerCapita', 'tourismPerCapita', 'electricityPerCapita', 'mcdonaldsPerMillion', 'sheepPerCapita', 'cattlePerCapita', 'alcoholPerCapita']) {
    assert.equal(cutsFor(key), null, key);
    assert.equal(isSecondaryCut(key), false, key);
  }
});

// ---- lookups ------------------------------------------------------------

test('cutsFor returns the pair for a subject and null for an ordinary metric', () => {
  assert.equal(cutsFor('gdp')?.length, 2);
  assert.equal(cutsFor('coffee'), null);
  assert.equal(cutsFor(null), null);
});

test('cutsFor is null for a secondary cut, which is never a chip', () => {
  // You reach gdpPerCapita through the gdp chip; it is not a chip itself, so
  // it must not report a cut control of its own.
  assert.equal(cutsFor('gdpPerCapita'), null);
});

test('resolveCut maps a chip and a cut to the metric that is read', () => {
  assert.equal(resolveCut('gdp', 'total'), 'gdp');
  assert.equal(resolveCut('gdp', 'per'), 'gdpPerCapita');
  assert.equal(resolveCut('population', 'per'), 'density');
  assert.equal(resolveCut('summerMedals', 'per'), 'summerMedalsPerCapita');
  assert.equal(resolveCut('winterMedals', 'per'), 'winterMedalsPerCapita');
});

test('resolveCut defaults to the total cut', () => {
  assert.equal(resolveCut('nobel'), 'nobel');
});

test('resolveCut is identity for an ungrouped metric, whatever the cut', () => {
  // The caller resolves unconditionally, so asking a single-view metric for
  // its 'per' cut must return the metric rather than null.
  assert.equal(resolveCut('coffee', 'total'), 'coffee');
  assert.equal(resolveCut('coffee', 'per'), 'coffee');
  assert.equal(resolveCut(null, 'per'), null);
});

test('subjectFor points a metric at the chip that reaches it', () => {
  assert.equal(subjectFor('gdpPerCapita'), 'gdp');
  assert.equal(subjectFor('density'), 'population');
  assert.equal(subjectFor('winterMedalsPerCapita'), 'winterMedals');
  assert.equal(subjectFor('coffee'), 'coffee');
  assert.equal(subjectFor(null), null);
});

test('subjectFor is stable on a subject key', () => {
  for (const g of METRIC_CUT_GROUPS) assert.equal(subjectFor(g.subjectKey), g.subjectKey);
});

test('isSecondaryCut is true only for the hidden halves', () => {
  assert.equal(isSecondaryCut('density'), true);
  assert.equal(isSecondaryCut('population'), false);
  assert.equal(isSecondaryCut('coffee'), false);
});

// ---- the chip row -------------------------------------------------------

test('chipMetrics drops exactly the five secondary cuts', () => {
  const chips = chipMetrics(METRIC_FILES);
  assert.equal(chips.length, METRIC_FILES.length - 5);
  const dropped = METRIC_FILES.filter((m) => !chips.includes(m)).map((m) => m.key);
  assert.deepEqual(dropped.sort(), [
    'density',
    'gdpPerCapita',
    'nobelPerCapita',
    'summerMedalsPerCapita',
    'winterMedalsPerCapita',
  ]);
});

test('chipMetrics keeps registry order', () => {
  const chips = chipMetrics(METRIC_FILES).map((m) => m.key);
  const expected = METRIC_FILES.map((m) => m.key).filter((k) => !isSecondaryCut(k));
  assert.deepEqual(chips, expected);
});

test('every remaining chip is still reachable, and so is every dropped metric', () => {
  // The completeness contract: no metric may become unreachable. A chip
  // reaches itself; a dropped one is reached through its subject's cut.
  const reachable = new Set();
  for (const m of chipMetrics(METRIC_FILES)) {
    const cuts = cutsFor(m.key);
    if (cuts) for (const c of cuts) reachable.add(c.key);
    else reachable.add(m.key);
  }
  for (const m of METRIC_FILES) {
    assert.ok(reachable.has(m.key), `"${m.key}" fell out of the chip row entirely`);
  }
});

test('every chip still has its icon, hue and short label', () => {
  // metricVisuals.test.js pins this for METRIC_FILES; this pins that the row
  // we actually render is a subset that kept its visuals.
  for (const m of chipMetrics(METRIC_FILES)) {
    assert.ok(METRIC_ICONS[m.key], `no icon for "${m.key}"`);
    assert.ok(METRIC_HUES[m.key], `no hue for "${m.key}"`);
    assert.ok(METRIC_SHORT[m.key], `no short label for "${m.key}"`);
  }
});

test('a secondary cut keeps its own visuals for the panel lead', () => {
  // The panel names the resolved metric, so the hidden halves still need
  // their icon and hue even though no chip renders them.
  for (const g of METRIC_CUT_GROUPS) {
    for (const c of g.cuts) {
      assert.ok(METRIC_ICONS[c.key], `no icon for "${c.key}"`);
      assert.ok(METRIC_HUES[c.key], `no hue for "${c.key}"`);
    }
  }
});
