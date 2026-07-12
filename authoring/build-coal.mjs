/**
 * Regenerates flags/metrics/coal.json: coal production per country (terawatt-hours).
 *
 * Coal is a *sparse* world metric, the second extractive one after oil: only
 * ~59 real places mine any coal (China dominant, then the Asia-Pacific and the
 * old industrial heartlands), the rest produce none. Source: the Energy
 * Institute Statistical Review of World Energy via Our World in Data
 * ("coal-production-by-country"), reported in **terawatt-hours (TWh)** of energy,
 * not tonnes. We keep the source unit (the same choice as oil), which also lets
 * coal and oil share the `twhLabel` threshold text. China is in a league of its
 * own (26,245 TWh, roughly 5x #2 India), then Indonesia, Australia, the US,
 * Russia, South Africa.
 *
 * DATA CONTRACT. Coal is *sparse* with `absence: 'zero'`, exactly like oil and
 * the crops. The emitted file lists producers only and carries the hint; the
 * loader (`attachCoals` -> `attachZeroFilledMetric` in group.js) defaults every
 * real place (`category !== 'other'`) missing from the map to 0, leaving only
 * the non-place org flags without the field. A country that mines no coal is a
 * *fair wrong guess* on a "coal >= 100 TWh" cell, NOT a data gap. The lens and
 * the superlative round read the raw sparse map instead (`createMetric`),
 * ranking producers only.
 *
 * Values are whole TWh; a producer that rounds below 1 TWh (Argentina, DR Congo,
 * Spain, Malawi, Nigeria, Nepal) falls to the absence=0 default. Sorted by code
 * for minimal refresh diffs.
 *
 * Snapshot, not a live fetch: OWID's CSV column names aren't a stable API, so
 * the figures are embedded below (the same hand-maintained-table pattern as
 * build-oil.mjs). To refresh: re-pull
 *   https://ourworldindata.org/grapher/coal-production-by-country.csv?csvType=full
 * take each country's latest year, and update RAW_TWH + YEAR. NOTE: the major
 * producers carry 2024 figures, but ~29 minor producers only have data through
 * 2016 in this dataset (their series stops there). Those stale figures are each
 * producer's latest available year; none is large enough to move a tier or a
 * superlative answer set.
 *
 * See DATA_FEATURE.md "Feature DU" and the add-world-metric skill for the map.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..');
const YEAR = 2024;

/**
 * Coal production, terawatt-hours, keyed by our ISO 3166-1 alpha-2 flag code
 * (via Our World in Data's Energy Institute mirror). Producers only: a real
 * place absent here mines none and defaults to 0 at load. Major producers are
 * 2024; ~29 minor ones are their latest available year (2016). Raw figures,
 * rounded to whole TWh on emit.
 * @type {Record<string, number>}
 */
const RAW_TWH = {
  af: 9.858067, ar: 0.16627173, au: 3282.5737, ba: 27.600441, bd: 5.530092, bg: 29.194603,
  br: 29.820864, bt: 0.57309777, bw: 12.277275, ca: 317.5997, cd: 0.06172564, cl: 13.514451,
  cn: 26245.023, co: 421.39136, cz: 95.78524, de: 228.7621, es: 0.22596927, gb: 0.83244276,
  ge: 1.4751356, gr: 9.202575, hu: 7.375239, id: 4714.217, in: 5015.149, ir: 10.350729,
  jp: 3.6518202, kg: 8.382435, kp: 233.82419, kr: 2.979885, kz: 540.0153, la: 20.10704,
  me: 3.7681239, mk: 9.1325445, mm: 2.7527988, mn: 563.77716, mw: 0.31454292, mx: 35.857372,
  my: 15.134934, mz: 49.598526, ne: 1.6459705, ng: 0.347325, no: 6.726947, np: 0.09900859,
  nz: 17.606146, pe: 3.579629, ph: 78.16815, pk: 99.37662, pl: 385.9311, ro: 22.285677,
  rs: 62.656925, ru: 2533.1672, si: 11.54076, sk: 5.5350966, sz: 1.1295636, th: 36.73458,
  tj: 9.007443, tr: 207.79161, tz: 2.0839493, ua: 105.56367, us: 2947.8413, uz: 24.830193,
  ve: 1.8474829, vn: 285.44888, za: 1545.1984, zm: 0.9062308, zw: 43.47537,
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
  const dropped = []; // producers that round below 1 TWh
  const unknownCode = []; // producer codes not present as a real place
  for (const [code, raw] of Object.entries(RAW_TWH)) {
    if (!realCodes.has(code)) {
      unknownCode.push(code);
      continue;
    }
    const twh = Math.round(raw);
    if (twh < 1) {
      dropped.push(code);
      continue;
    }
    values[code] = twh;
  }

  // Stable, code-sorted output for minimal refresh diffs.
  const sorted = {};
  for (const code of Object.keys(values).sort()) sorted[code] = values[code];

  const metric = {
    key: 'coal',
    label: 'Coal production',
    unit: 'TWh',
    // 'compact' -> 26.2K / 5.02K / 421 TWh.
    format: 'compact',
    // Sparse: producers only, with the rest defaulted to 0 at load.
    absence: 'zero',
    source:
      'Energy Institute Statistical Review of World Energy via Our World in ' +
      'Data (coal production, TWh). Major producers are 2024; ~29 minor ' +
      'producers carry their latest available year (2016). Rounded to whole TWh',
    year: YEAR,
    values: sorted,
  };

  const outPath = join(REPO, 'flags', 'metrics', 'coal.json');
  writeFileSync(outPath, JSON.stringify(metric, null, 2) + '\n', 'utf-8');

  console.log(`Wrote ${outPath}`);
  console.log(
    `  producers: ${Object.keys(sorted).length} ` +
      `(dropped <1 TWh ${dropped.length ? dropped.join(',') : 'none'}) | ` +
      `real places ${realCodes.size} -> the rest default to 0 at load`,
  );
  if (unknownCode.length) {
    console.error(
      `  producer codes not in countries.json (dropped): ${unknownCode.join(', ')}`,
    );
  }
}

main();
