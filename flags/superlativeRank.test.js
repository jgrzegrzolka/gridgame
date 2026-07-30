import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  formatPopulation,
  rankByMetric,
  rankWithinContinent,
  buildPopulationRankNotes,
  buildMetricRankNotes,
  formatMetricShort,
  formatMetricPill,
  buildSuperlativeTileMeta,
  metricFileFor,
} from './superlativeRank.js';
import { METRIC_FILES } from './metrics/index.js';

const HERE = dirname(fileURLToPath(import.meta.url));

const VALUES = {
  in: 1_438_069_596,
  cn: 1_410_710_000,
  us: 336_762_000,
  mx: 129_739_000,
  va: 800,
  tv: 9_816,
  // territory-shaped code with no value would simply be absent
};

const COUNTRIES = [
  { code: 'in' }, { code: 'cn' }, { code: 'us' }, { code: 'mx' },
  { code: 'va' }, { code: 'tv' },
  { code: 'gb-eng' }, // no population value -> excluded from ranking + notes
];

test('formatPopulation: billions, millions, grouped integers (en)', () => {
  assert.equal(formatPopulation(1_438_069_596, 'en'), '1.44 billion');
  assert.equal(formatPopulation(336_762_000, 'en'), '336.8 million');
  assert.equal(formatPopulation(9_816, 'en'), '9,816');
  assert.equal(formatPopulation(800, 'en'), '800');
});

test('formatPopulation: pl uses comma decimals, space thousands, mld/mln', () => {
  assert.equal(formatPopulation(1_438_069_596, 'pl'), '1,44 mld');
  assert.equal(formatPopulation(336_762_000, 'pl'), '336,8 mln');
  assert.equal(formatPopulation(9_816, 'pl'), '9 816');
  assert.equal(formatPopulation(800, 'pl'), '800');
});

test('rankByMetric: descending, #1 = largest value', () => {
  const rank = rankByMetric(COUNTRIES, VALUES);
  assert.equal(rank.get('in'), 1);
  assert.equal(rank.get('cn'), 2);
  assert.equal(rank.get('us'), 3);
  assert.equal(rank.get('mx'), 4);
  assert.equal(rank.get('tv'), 5);
  assert.equal(rank.get('va'), 6);
});

test('rankByMetric: codes without a value are excluded', () => {
  const rank = rankByMetric(COUNTRIES, VALUES);
  assert.equal(rank.has('gb-eng'), false);
  assert.equal(rank.size, 6);
});

test('rankByMetric: ties break alphabetically by code', () => {
  const rank = rankByMetric([{ code: 'zz' }, { code: 'aa' }], { zz: 100, aa: 100 });
  assert.equal(rank.get('aa'), 1);
  assert.equal(rank.get('zz'), 2);
});

test('buildPopulationRankNotes: caption carries figure + world rank', () => {
  const notes = buildPopulationRankNotes(COUNTRIES, VALUES);
  assert.equal(notes.in.en, 'Population: 1.44 billion · #1 in the world');
  assert.equal(notes.in.pl, 'Ludność: 1,44 mld · 1. na świecie');
  assert.equal(notes.mx.en, 'Population: 129.7 million · #4 in the world');
  assert.equal(notes.va.en, 'Population: 800 · #6 in the world');
  assert.equal(notes.va.pl, 'Ludność: 800 · 6. na świecie');
});

test('buildPopulationRankNotes: only sovereign (valued) codes get a note', () => {
  const notes = buildPopulationRankNotes(COUNTRIES, VALUES);
  assert.equal('gb-eng' in notes, false);
  assert.equal(Object.keys(notes).length, 6);
});

/* ---- metric-generic: the gate that #51 fell through ---------------------- */

test('metricFileFor: resolves every metric in the shared registry', () => {
  // The gate used to be `metric === 'population'`, which silently skipped the
  // first area superlative. Every registered metric must resolve, so the badge
  // can never again be a per-metric privilege.
  for (const m of METRIC_FILES) {
    assert.equal(
      metricFileFor({ kind: 'superlative', metric: m.key }),
      m.file,
      `metric ${m.key} must resolve to its data file`,
    );
  }
});

test('metricFileFor: every registry file actually exists on disk', () => {
  for (const m of METRIC_FILES) {
    assert.ok(existsSync(join(HERE, 'metrics', m.file)), `${m.file} missing`);
  }
});

test('metricFileFor: null for non-superlatives and unknown metrics', () => {
  assert.equal(metricFileFor(null), null);
  assert.equal(metricFileFor(undefined), null);
  assert.equal(metricFileFor({ kind: 'manual', metric: 'population' }), null);
  // a plain filter entry — no `kind` at all
  assert.equal(metricFileFor(/** @type {any} */ ({ filter: 'continent:Europe' })), null);
  assert.equal(metricFileFor({ kind: 'superlative', metric: 'notAMetric' }), null);
  assert.equal(metricFileFor({ kind: 'superlative' }), null);
});

test('formatMetricShort: follows the metric file format, not the metric key', () => {
  // compact (population, area, gdp)
  assert.equal(formatMetricShort(16_376_870, 'compact', 'en'), '16.4M');
  assert.equal(formatMetricShort(1_438_069_596, 'compact', 'en'), '1.44B');
  assert.equal(formatMetricShort(27_810_000_000_000, 'compact', 'en'), '27.81T');
  // decimal1 (density, temperature)
  assert.equal(formatMetricShort(68.53, 'decimal1', 'en'), '68.5');
  assert.equal(formatMetricShort(-5.2, 'decimal1', 'en'), '-5.2');
  // plain (elevation)
  assert.equal(formatMetricShort(8849, 'plain', 'en'), '8,849');
});

test('formatMetricShort: pl swaps the decimal mark and the magnitude word', () => {
  assert.equal(formatMetricShort(16_376_870, 'compact', 'pl'), '16,4 mln');
  assert.equal(formatMetricShort(1_438_069_596, 'compact', 'pl'), '1,44 mld');
  assert.equal(formatMetricShort(27_810_000_000_000, 'compact', 'pl'), '27,81 bln');
  assert.equal(formatMetricShort(9_816, 'compact', 'pl'), '9,8 tys');
  assert.equal(formatMetricShort(68.53, 'decimal1', 'pl'), '68,5');
  assert.equal(formatMetricShort(8849, 'plain', 'pl'), '8 849');
  assert.equal(formatMetricShort(800, 'compact', 'pl'), '800');
});

test('formatMetricPill: keeps the compact letter in every language (fits the badge)', () => {
  // en is identical to formatMetricShort — the compact letters are already there.
  assert.equal(formatMetricPill(16_376_870, 'compact', 'en'), '16.4M');
  assert.equal(formatMetricPill(579_500, 'compact', 'en'), '579.5K');
  // pl keeps the LETTER (not "tys"/"mln"/"mld"/"bln"), only the decimal is a comma.
  assert.equal(formatMetricPill(579_500, 'compact', 'pl'), '579,5K');
  assert.equal(formatMetricPill(16_376_870, 'compact', 'pl'), '16,4M');
  assert.equal(formatMetricPill(1_438_069_596, 'compact', 'pl'), '1,44B');
  assert.equal(formatMetricPill(27_810_000_000_000, 'compact', 'pl'), '27,81T');
  assert.equal(formatMetricPill(9_816, 'compact', 'pl'), '9,8K');
  // sub-1000 compact, and the plain / decimal formats still localise as before.
  assert.equal(formatMetricPill(800, 'compact', 'pl'), '800');
  assert.equal(formatMetricPill(8849, 'plain', 'pl'), '8 849');
  assert.equal(formatMetricPill(68.53, 'decimal1', 'pl'), '68,5');
});

test('buildMetricRankNotes: baked note keeps its wording and gains the rank', () => {
  const baked = {
    in: { en: 'Area: 2,973,190 km²', pl: 'Powierzchnia: 2 973 190 km²' },
  };
  const notes = buildMetricRankNotes(COUNTRIES, VALUES, { unit: 'km²', format: 'compact' }, baked);
  assert.equal(notes.in.en, 'Area: 2,973,190 km² · #1 in the world');
  assert.equal(notes.in.pl, 'Powierzchnia: 2 973 190 km² · 1. na świecie');
});

test('buildMetricRankNotes: unbaked distractor still gets a figure + rank', () => {
  // The "Most missed" rail surfaces flags outside the frozen answer set, so
  // they have no baked note — they must still read as something.
  const notes = buildMetricRankNotes(COUNTRIES, VALUES, { unit: 'km²', format: 'compact' }, {});
  assert.equal(notes.us.en, '336.8M km² · #3 in the world');
  assert.equal(notes.us.pl, '336,8 mln km² · 3. na świecie');
});

test('buildMetricRankNotes: no unit → no stray space', () => {
  const notes = buildMetricRankNotes([{ code: 'us' }], VALUES, { format: 'compact' });
  assert.equal(notes.us.en, '336.8M · #1 in the world');
});

// A tiny Europe-scoped roster: fr/es/de are Europe, tr is Asia. Areas descend
// fr > es > de so their in-Europe ranks are 1/2/3; tr is outside the scope.
const EU_COUNTRIES = [
  { code: 'fr', continent: 'Europe' },
  { code: 'es', continent: 'Europe' },
  { code: 'de', continent: 'Europe' },
  { code: 'tr', continent: 'Asia' },
];
const EU_AREA = { fr: 551_695, es: 505_990, de: 357_590, tr: 783_562 };

test('rankWithinContinent: ranks only the scoped continent, empty off-scope', () => {
  const r = rankWithinContinent(EU_COUNTRIES, EU_AREA, 'Europe');
  assert.equal(r.get('fr'), 1);
  assert.equal(r.get('es'), 2);
  assert.equal(r.get('de'), 3);
  assert.equal(r.has('tr'), false); // Asia — not in the Europe pool
  // World scope (or any non-continent) yields no continental ranking.
  assert.equal(rankWithinContinent(EU_COUNTRIES, EU_AREA, 'world').size, 0);
  assert.equal(rankWithinContinent(EU_COUNTRIES, EU_AREA, null).size, 0);
});

test('buildMetricRankNotes: continent scope appends the in-continent rank', () => {
  const notes = buildMetricRankNotes(EU_COUNTRIES, EU_AREA, { unit: 'km²', format: 'plain' }, {}, 'Europe');
  // A European answer: world rank then Europe rank, in both languages.
  assert.equal(notes.es.en, '505,990 km² · #3 in the world · #2 in Europe');
  assert.equal(notes.es.pl, '505 990 km² · 3. na świecie · 2. w Europie');
  // A distractor outside the scoped continent gets the world rank only.
  assert.equal(notes.tr.en, '783,562 km² · #1 in the world');
  assert.equal(notes.tr.pl, '783 562 km² · 1. na świecie');
});

test('buildMetricRankNotes: no continent arg leaves the world-rank-only caption', () => {
  const notes = buildMetricRankNotes(EU_COUNTRIES, EU_AREA, { unit: 'km²', format: 'plain' }, {});
  assert.equal(notes.fr.en, '551,695 km² · #2 in the world');
});

test('buildPopulationRankNotes: continent scope appends the in-continent rank', () => {
  const countries = [
    { code: 'ru', continent: 'Europe' },
    { code: 'de', continent: 'Europe' },
    { code: 'cn', continent: 'Asia' },
  ];
  const pop = { ru: 143_800_000, de: 83_200_000, cn: 1_410_710_000 };
  const notes = buildPopulationRankNotes(countries, pop, 'Europe');
  assert.equal(notes.de.en, 'Population: 83.2 million · #3 in the world · #2 in Europe');
  assert.equal(notes.de.pl, 'Ludność: 83,2 mln · 3. na świecie · 2. w Europie');
  // Asia country in a Europe-scoped puzzle: world rank only, no "in Europe".
  assert.equal(notes.cn.en, 'Population: 1.41 billion · #1 in the world');
});

test('buildSuperlativeTileMeta: rank is 1-based place in the answers array', () => {
  const entry = { answers: ['in', 'cn', 'us', 'id'] };
  const meta = buildSuperlativeTileMeta(entry, VALUES, { format: 'compact' });
  assert.equal(meta.get('in')?.rank, 1);
  assert.equal(meta.get('cn')?.rank, 2);
  assert.equal(meta.get('us')?.rank, 3);
  assert.equal(meta.get('in')?.value, 1_438_069_596);
  assert.equal(meta.get('us')?.value, 336_762_000);
});

test('buildSuperlativeTileMeta: display is the compact pill figure per language', () => {
  // The pill keeps the compact LETTER in Polish too ("1,44B", not "1,44 mld") —
  // the spelled-out word is too wide for the badge and lives only in the zoom
  // caption (buildMetricRankNotes). See formatMetricPill.
  const meta = buildSuperlativeTileMeta({ answers: ['in'] }, VALUES, { format: 'compact' });
  assert.deepEqual(meta.get('in')?.display, { en: '1.44B', pl: '1,44B' });
});

test('buildSuperlativeTileMeta: missing metric value → null figure, rank kept', () => {
  // The number is the mechanic; it must survive a metric gap.
  const meta = buildSuperlativeTileMeta({ answers: ['in', 'zz'] }, VALUES, { format: 'compact' });
  assert.equal(meta.get('zz')?.rank, 2);
  assert.equal(meta.get('zz')?.value, null);
  assert.equal(meta.get('zz')?.display, null);
});

test('buildSuperlativeTileMeta: no answers → empty map', () => {
  assert.equal(buildSuperlativeTileMeta({}, VALUES).size, 0);
});

/* ---- every metric in the registry can actually badge a roster ------------ */

test('every registered metric produces rank badges for a roster of its own top codes', () => {
  // Walk the whole registry, not a sample: take each metric's real values, build
  // a roster from its own top 5, and assert every tile gets a rank AND a
  // rendered figure in both languages. A metric whose file shape drifts (no
  // `values`, a missing `format`) fails here rather than on a live puzzle.
  for (const m of METRIC_FILES) {
    const data = JSON.parse(readFileSync(join(HERE, 'metrics', m.file), 'utf-8'));
    const values = data.values ?? {};
    const top = Object.entries(values)
      .filter(([, v]) => typeof v === 'number')
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([code]) => code);
    assert.ok(top.length > 0, `${m.key}: no numeric values`);
    const meta = buildSuperlativeTileMeta({ answers: top }, values, data);
    top.forEach((code, i) => {
      const cell = meta.get(code);
      assert.equal(cell?.rank, i + 1, `${m.key}/${code}: rank`);
      assert.ok(cell?.display?.en, `${m.key}/${code}: en figure`);
      assert.ok(cell?.display?.pl, `${m.key}/${code}: pl figure`);
    });
  }
});
