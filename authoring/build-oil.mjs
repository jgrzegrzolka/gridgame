/**
 * Regenerates flags/metrics/oil.json: oil production per country (terawatt-hours).
 *
 * Oil is a *sparse* world metric, the sixth after the five crops and the first
 * extractive one: only ~92 real places pump any oil at all (the Gulf, Russia,
 * the US, the North Sea, west Africa, Venezuela, ...), and every real place NOT
 * in the table produces none. Source: the Energy Institute Statistical Review of
 * World Energy via Our World in Data ("oil-production-by-country"), which reports
 * output in **terawatt-hours (TWh)** of energy, not barrels. We keep the source
 * unit rather than convert to barrels/day (which would bake in an assumed
 * energy-density factor). The US leads (9,977 TWh), then Russia and Saudi Arabia.
 *
 * DATA CONTRACT. Oil is *sparse* with `absence: 'zero'`, exactly like the crops.
 * The emitted file lists producers only and carries the hint; the loader
 * (`attachOils` -> `attachZeroFilledMetric` in group.js) defaults every real
 * place (`category !== 'other'`) missing from the map to 0, leaving only the
 * non-place org flags without the field. A country that pumps no oil is a *fair
 * wrong guess* on an "oil >= 100 TWh" cell, NOT a data gap. The lens and the
 * superlative round read the raw sparse map instead (`createMetric`), ranking
 * producers only.
 *
 * Values are whole TWh; a producer that rounds below 1 TWh (a handful of tiny
 * ones: Georgia, Israel, Jordan, Slovakia, ...) falls to the absence=0 default.
 * Sorted by code for minimal refresh diffs.
 *
 * Snapshot, not a live fetch: OWID's CSV column names aren't a stable API, so
 * the figures are embedded below (the same hand-maintained-table pattern as
 * build-apple.mjs). To refresh: re-pull
 *   https://ourworldindata.org/grapher/oil-production-by-country.csv?csvType=full
 * take each country's latest year, and update RAW_TWH + YEAR. NOTE: the major
 * producers carry 2024 figures, but ~half the minor producers only have data
 * through 2016 in this dataset (their series stops there). Those stale figures
 * are each producer's latest available year; none is large enough to change the
 * top of any tier or a superlative answer set.
 *
 * See DATA_FEATURE.md "Feature DS" and the add-world-metric skill for the map.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..');
const YEAR = 2024;

/**
 * Oil production, terawatt-hours, keyed by our ISO 3166-1 alpha-2 flag code (via
 * Our World in Data's Energy Institute mirror). Producers only: a real place
 * absent here pumps none and defaults to 0 at load. Major producers are 2024;
 * many minor ones are their latest available year (2016). Raw figures, rounded
 * to whole TWh on emit.
 * @type {Record<string, number>}
 */
const RAW_TWH = {
  ae: 2090.4568, al: 15.398286, ao: 667.38336, ar: 681.964, at: 9.799419, au: 173.42554,
  az: 339.21222, bb: 0.6298658, bd: 2.5744076, bg: 0.63115054, bh: 35.98855, bn: 56.392567,
  bo: 40.733498, br: 2117.55, by: 20.621525, bz: 1.230121, ca: 3372.0725, cd: 12.623009,
  cg: 159.2947, ci: 31.034172, cl: 3.1906345, cm: 58.748592, cn: 2475.9224, co: 474.5787,
  cu: 34.205326, cz: 1.5559578, de: 29.638956, dk: 34.374386, dz: 689.2734, ec: 297.0753,
  eg: 362.1526, es: 1.6546475, fr: 10.533187, ga: 130.43419, gb: 353.53622, ge: 0.25250837,
  gh: 62.68366, gq: 50.43882, gr: 2.0183053, gt: 5.7314787, gy: 357.68057, hr: 8.957631,
  hu: 12.577218, id: 347.9637, il: 0.24786466, in: 382.46527, iq: 2507.6987, ir: 2726.6675,
  it: 51.81511, jo: 0.014079887, jp: 6.197832, kg: 0.6312711, kw: 1520.7142, kz: 1018.30536,
  lt: 1.2625422, ly: 648.06055, ma: 0.0985592, mm: 9.787949, mn: 15.115269, mr: 3.0398915,
  mx: 1120.788, my: 279.86264, ne: 8.276316, ng: 917.5369, nl: 14.757731, no: 998.7788,
  nz: 22.911379, om: 557.4839, pe: 60.667477, pg: 33.704975, ph: 12.671898, pk: 54.909622,
  pl: 12.56077, qa: 877.8503, ro: 33.343212, rs: 12.969845, ru: 6121.835, sa: 5933.262,
  sd: 21.613846, si: 0.0031386414, sk: 0.13336793, sr: 11.535729, ss: 49.68767, sy: 19.277864,
  td: 78.396484, th: 144.10544, tj: 0.1136288, tl: 28.175007, tm: 104.78281, tn: 17.282179,
  tr: 31.756136, tt: 39.361076, tw: 0.14531969, ua: 28.340725, us: 9977.384, uz: 22.419151,
  ve: 576.0134, vn: 98.90096, ye: 20.717709, za: 2.7119992,
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
    key: 'oil',
    label: 'Oil production',
    unit: 'TWh',
    // 'compact' -> 9.98K / 2.51K / 998 TWh.
    format: 'compact',
    // Sparse: producers only, with the rest defaulted to 0 at load.
    absence: 'zero',
    source:
      'Energy Institute Statistical Review of World Energy via Our World in ' +
      'Data (oil production, TWh). Major producers are 2024; many minor ' +
      'producers carry their latest available year (2016). Rounded to whole TWh',
    year: YEAR,
    values: sorted,
  };

  const outPath = join(REPO, 'flags', 'metrics', 'oil.json');
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
