/**
 * Regenerates flags/metrics/wine.json: wine production per country.
 *
 * Wine is a *sparse* world metric, like coffee. Only ~80 countries make wine at
 * all, so the source table (FAOSTAT 2023, item 564 "Wine", via Our World in
 * Data's mirror) lists producers only, and every real place NOT in the table
 * makes none.
 *
 * DATA CONTRACT. Wine is *sparse* with `absence: 'zero'`. The emitted file
 * lists producers only, and carries an `absence: 'zero'` hint. The loader
 * (`attachWines` → `attachZeroFilledMetric` in flags/group.js) defaults every
 * real place (`category !== 'other'`) missing from the map to 0, leaving only
 * the non-place org flags without the field. That keeps the "no data == not a
 * place" invariant the TTT picker's no-data guard leans on (a country that
 * makes no wine is a *fair wrong guess* on a "wine >= 1M tonnes" cell, NOT a
 * data gap), without bloating the JSON with ~180 explicit zeros. The lens and
 * the superlative rounds read the raw sparse map instead (`createMetric`), so
 * "smallest producer" ranks the smallest *maker*, not a 180-way tie at zero.
 * See the add-world-metric skill's "absence policy" section.
 *
 * Values are whole tonnes (fractional tonnes are noise at this scale); a
 * producer that rounds below 1 tonne falls to the absence=0 default like any
 * non-maker. Sorted by code for minimal refresh diffs.
 *
 * Snapshot, not a live fetch: OWID's CSV column names aren't a stable API, so
 * the FAOSTAT figures are embedded below (the same hand-maintained-table
 * pattern as build-coffee.mjs). To refresh: re-pull
 *   https://ourworldindata.org/grapher/wine-production.csv?csvType=full
 * take each country's latest year, and update RAW_TONNES + YEAR. A handful of
 * minor producers (Malta, Réunion, Syria, Zimbabwe) have no 2023 row and carry
 * their latest available figure (2006–2020) instead; all are tiny and change no
 * ranking or threshold tier.
 *
 * See DATA_FEATURE.md "Feature DM" and the add-world-metric skill for the map.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..');
const YEAR = 2023;

/**
 * FAOSTAT wine production, tonnes, keyed by our ISO 3166-1 alpha-2 flag code
 * (via Our World in Data's FAOSTAT mirror, item 564). Producers only: a real
 * place absent here makes none and defaults to 0 at load. Predominantly 2023;
 * the four sub-2023 figures (mt/re/sy/zw) are each producer's latest available
 * year. Raw figures, rounded to whole tonnes on emit.
 * @type {Record<string, number>}
 */
const RAW_TONNES = {
  al: 2319.36, am: 14261.6, ar: 881305, at: 233072, au: 964000, az: 12720,
  ba: 4087.34, be: 15998.77, bg: 79001.35, bo: 8000, br: 263943, by: 30700,
  ca: 62731.87, ch: 100954, cl: 1103023, cn: 1761138.9, co: 2271.9, cu: 8920,
  cy: 9141.95, cz: 48800, de: 472195.5, dz: 10967.72, ee: 2135.02, eg: 8079.62,
  es: 2849589, et: 329.42, fr: 4762507, gb: 376.09, ge: 123493, gr: 256909,
  hr: 45500, hu: 292277, il: 2945.39, it: 4249948, jo: 238.6, jp: 47958.29,
  kg: 2017, kz: 25795, lb: 5780.87, lc: 2, lt: 3758.89, lu: 8100,
  lv: 2163.64, ma: 30503.03, md: 133370, me: 8971.8, mg: 7708.21, mk: 45374.72,
  mn: 434.97, mt: 2450, mu: 2821, mx: 46169.56, nz: 360000, pa: 82,
  pe: 81300, pl: 500, pt: 737257, py: 945.94, re: 23, ro: 370000,
  rs: 23370, ru: 481907.03, si: 12588.67, sk: 5868.82, sy: 50, th: 559.61,
  tj: 167.3, tm: 52567.57, tn: 31900, tr: 76927, ua: 67300, us: 2083124.6,
  uy: 50224, uz: 12244.79, ve: 1971, vn: 9991.93, za: 922185, zw: 1750,
};

function main() {
  const countries = JSON.parse(
    readFileSync(join(REPO, 'flags', 'countries.json'), 'utf-8'),
  );
  const realCodes = new Set(
    countries.filter((c) => c.category !== 'other').map((c) => c.code),
  );

  /** @type {Record<string, number>} */
  const values = {};
  const dropped = []; // producers that round below 1 tonne
  const unknownCode = []; // producer codes not present as a real place
  for (const [code, raw] of Object.entries(RAW_TONNES)) {
    if (!realCodes.has(code)) {
      unknownCode.push(code);
      continue;
    }
    const tonnes = Math.round(raw);
    if (tonnes < 1) {
      dropped.push(code);
      continue;
    }
    values[code] = tonnes;
  }

  // Stable, code-sorted output for minimal refresh diffs.
  const sorted = {};
  for (const code of Object.keys(values).sort()) sorted[code] = values[code];

  const metric = {
    key: 'wine',
    label: 'Wine production',
    unit: 'tonnes',
    // 'compact' → 4.76M / 737.26K / 2.32K wine tonnes.
    format: 'compact',
    // Sparse: producers only, with the rest defaulted to 0 at load.
    absence: 'zero',
    source:
      `FAOSTAT ${YEAR} (wine, item 564) via Our World in Data; ` +
      'four minor producers (Malta, Réunion, Syria, Zimbabwe) carry their ' +
      'latest available year (2006–2020). Rounded to whole tonnes',
    year: YEAR,
    values: sorted,
  };

  const outPath = join(REPO, 'flags', 'metrics', 'wine.json');
  writeFileSync(outPath, JSON.stringify(metric, null, 2) + '\n', 'utf-8');

  console.log(`Wrote ${outPath}`);
  console.log(
    `  producers: ${Object.keys(sorted).length} ` +
      `(dropped <1t ${dropped.length ? dropped.join(',') : 'none'}) | ` +
      `real places ${realCodes.size} → the rest default to 0 at load`,
  );
  if (unknownCode.length) {
    console.error(
      `  producer codes not in countries.json (dropped): ${unknownCode.join(', ')}`,
    );
  }
}

main();
