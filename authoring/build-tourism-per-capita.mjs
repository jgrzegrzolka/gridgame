/**
 * Regenerates flags/metrics/tourismPerCapita.json: international tourist arrivals
 * per resident per year.
 *
 * DERIVED metric, like density / gdpPerCapita: the embedded RAW_ARRIVALS below is
 * the ABSOLUTE arrival count per country; this build divides it by population.json
 * to get the per-resident rate. Storing the rate (not the raw count) is what makes
 * the metric intensive: a small tourist magnet tops a big country, which is the
 * whole point (Andorra ~102 arrivals per resident, while the US sits near 0.5).
 *
 * DATA CONTRACT (`absence: 'unknown'`, like the drink / meat metrics). The World
 * Bank reports arrivals for ~186 real places, but not for the states it cannot get
 * a figure from (conflict / closed economies: Afghanistan, North Korea, Libya,
 * Venezuela, Somalia, ...) nor for every tiny sub-national part. Those real places
 * are left out of `values` and read "no data" on a tourism cell, which is correct:
 * a country DOES receive some tourists, we just have no measured figure, so the
 * value is genuinely UNKNOWN, not zero. (Contrast the crops, `absence: 'zero'`,
 * where a missing place really does produce none.) The party round is
 * sovereign-scoped and zero-filtered, so the gap never surfaces there.
 *
 * SOURCE. World Bank indicator ST.INT.ARVL, "International tourism, number of
 * arrivals", latest pre-pandemic normal year: 2019 for all but seven places that
 * only report through 2018. 2019 is used deliberately over 2020-2022 (the pandemic
 * collapse would rank countries by how hard COVID hit them, not by how touristed
 * they are) and gives the broadest clean coverage. The arrival counts are divided
 * by the current population.json, a small year mismatch that never changes the
 * ranking. Andorra, Monaco, San Marino, Sint Maarten and the Caribbean micro-states
 * lead; the big countries sit near the bottom per resident.
 *
 * To refresh: re-pull ST.INT.ARVL (latest normal year per country), remap the World
 * Bank ISO3 to our alpha-2, and update RAW_ARRIVALS. No network call here, so this
 * is deterministic. See DATA_FEATURE.md and the add-world-metric skill.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..');
const METRICS = join(REPO, 'flags', 'metrics');
const YEAR = 2019;

/**
 * International tourist arrivals per year (absolute count), World Bank ST.INT.ARVL,
 * 2019 (a handful of places at 2018), keyed by our ISO 3166-1 alpha-2 flag code.
 * A real place absent here has no World Bank figure and stays "no data"
 * (absence: 'unknown'); it is NOT treated as 0.
 * @type {Record<string, number>}
 */
const RAW_ARRIVALS = {
  ad: 8235000, ae: 25282000, ag: 1035000, al: 6406000, am: 1894000, ao: 218000, ar: 7399000, as: 19200, at: 31884000,
  au: 9466000,
  aw: 1951000, az: 3170000, ba: 1198000, bb: 966000, bd: 323000, be: 9343000, bf: 143000, bg: 12552000, bh: 11061000,
  bj: 337000, bm: 805000, bn: 4449000, bo: 1239000, br: 6353000, bs: 7250000, bt: 316000, bw: 1830000, by: 11832000,
  bz: 1674000, ca: 32430000, cf: 87000, cg: 158000, ch: 11818000, ci: 2070000, cl: 5431000, cm: 1021000, cn: 162538000,
  co: 4531000, cr: 3366000, cu: 4276000, cv: 758000, cw: 1293000, cy: 4117000, cz: 37202000, de: 39563000, dk: 33093000,
  dm: 322000, do: 7550000, dz: 2371000, ec: 2108000, ee: 6103000, eg: 13026000, es: 126170000, et: 812000, fi: 3290000,
  fj: 969000, fm: 18000, fr: 217877000, gb: 40857000, gd: 526000, ge: 7726000, gm: 620000, gr: 34005000, gt: 2560000,
  gu: 1667000, gw: 52400, gy: 315000, hk: 55913000, hn: 2315000, hr: 60021000, ht: 938000, hu: 61397000, id: 16107000,
  ie: 10951000, il: 4905000, in: 17914000, ir: 9107000, is: 2202000, it: 95399000, jm: 4233000, jo: 5361000, jp: 31881000,
  ke: 2049000, kg: 8508000, kh: 6611000, ki: 12000, km: 45100, kn: 1107000, kr: 17503000, kw: 8565000, ky: 2334000,
  kz: 8515000, la: 4791000, lb: 1936000, lc: 1220000, li: 98100, lk: 2027000, ls: 1142000, lt: 6150000, lu: 1041000,
  lv: 8342000, ma: 13109000, mc: 363000, md: 174000, me: 2510000, mg: 486000, mh: 6100, mk: 758000, ml: 217000,
  mm: 4364000, mn: 637000, mo: 39406000, mp: 487000, mt: 3519000, mu: 1418000, mv: 1703000, mw: 871000, mx: 97406000,
  my: 26101000, mz: 2033000, na: 1651000, nc: 130000, ne: 192000, ni: 1455000, nl: 20129000, no: 5879000, np: 1197000,
  nz: 3888000, om: 3506000, pa: 2494000, pe: 5275000, pf: 300000, pg: 211000, ph: 8261000, pl: 88515000, pr: 4931000,
  ps: 688000, pt: 17283000, pw: 94000, py: 4368000, qa: 2136500, ro: 12815000, rs: 1847000, ru: 24419000, rw: 1634000,
  sa: 20292000, sb: 28900, sc: 428000, sd: 836000, se: 7616000, sg: 19116000, si: 4702000, sk: 15299000, sl: 71000,
  sm: 1904000, st: 33400, sv: 2639000, sx: 1952000, sy: 2424000, sz: 1226000, tc: 1599000, td: 81000, tg: 876000,
  th: 39916000, tj: 1035000, tl: 74800, tn: 9429000, to: 94000, tr: 51747000, tt: 480000, tv: 3600, tz: 1527000,
  ua: 13710000, ug: 1543000, us: 165478000, uy: 3480000, uz: 6749000, vc: 392000, vg: 302400, vi: 2074000, vn: 18009000,
  vu: 256000, ws: 181000, za: 14797000, zm: 1266000, zw: 2294000,
};

function main() {
  const countries = JSON.parse(readFileSync(join(REPO, 'flags', 'countries.json'), 'utf-8'));
  const realCodes = new Set(countries.filter((c) => c.category !== 'other').map((c) => c.code));
  const population = JSON.parse(readFileSync(join(METRICS, 'population.json'), 'utf-8')).values;

  /** @type {Record<string, number>} */
  const values = {};
  const dropped = [];
  for (const [code, arrivals] of Object.entries(RAW_ARRIVALS)) {
    if (!realCodes.has(code)) {
      dropped.push(code);
      continue;
    }
    const pop = population[code];
    if (!pop) continue; // no population to divide by (should not happen for a real place)
    // Arrivals per resident, two decimals: the ranking spans 0..~102, so two
    // decimals keep the tiny end (India ~0.01) distinct while the 'sig2' display
    // format rounds for the tile.
    values[code] = Math.round((arrivals / pop) * 100) / 100;
  }

  const sorted = {};
  for (const code of Object.keys(values).sort()) sorted[code] = values[code];

  const metric = {
    key: 'tourismPerCapita',
    label: 'Tourist arrivals per capita',
    unit: 'arrivals/person',
    // 'sig2' -> 2 significant figures keeping the whole integer part, like the
    // sheep/cattle-per-capita rates, so 102 reads as "100", 15.5 as "16", and the
    // tiny 0.01 tail stays visible rather than flattening to "0.0".
    format: 'sig2',
    // absence: 'unknown' -> a real place missing from `values` (the states the
    // World Bank has no arrivals figure for) is genuinely unknown, NOT zero. It
    // reads "no data" and the metricDataGap guard blocks it. See DATA_FEATURE.md.
    absence: 'unknown',
    source:
      `World Bank ST.INT.ARVL (international tourism, number of arrivals), ${YEAR} ` +
      `(the last pre-pandemic normal year; a handful of places at 2018), divided by ` +
      `population to give arrivals per resident. 2019 is used over the COVID-collapse ` +
      `years so the ranking reflects how touristed a place is, not how hard the ` +
      `pandemic hit it. The states the World Bank has no figure for (conflict / ` +
      `closed economies) carry no value (absence: unknown)`,
    year: YEAR,
    values: sorted,
  };

  const outPath = join(METRICS, 'tourismPerCapita.json');
  writeFileSync(outPath, JSON.stringify(metric, null, 2) + '\n', 'utf-8');

  console.log(`Wrote ${outPath}`);
  console.log(`  values: ${Object.keys(sorted).length} (World Bank-covered real places) | absence: unknown for the rest`);
  if (dropped.length) console.error(`  arrival codes not in countries.json (dropped): ${dropped.join(', ')}`);
}

main();
