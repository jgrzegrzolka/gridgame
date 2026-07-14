/**
 * Regenerates flags/metrics/temperature.json: each place's average annual air
 * temperature, in degrees Celsius.
 *
 * WHY THIS METRIC: it is intensive (a climate normal, independent of country
 * size) and two-directional, both extremes make good questions. Burkina Faso
 * (30.4), Mali (29.21) and the Gulf/Sahel top the world; Greenland (-18.68),
 * Svalbard (-6.78), Russia (-3.79) and Canada (-4.03) are the cold floor.
 * Values can be NEGATIVE, unlike every other metric so far, so the schema test
 * checks `Number.isFinite`, not `>= 0`.
 *
 * DATA CONTRACT (`absence: 'unknown'`, the beerPerCapita pattern). The source
 * is a country-level climatology, so it covers ~234 sovereign states and
 * territories but NOT the sub-national parts (the UK home nations, the Spanish
 * regions) or a few uninhabited / polar places with no country row (Antarctica,
 * Bouvet, Clipperton). Those real places have no figure: their value is
 * genuinely UNKNOWN, not zero (0 C is a real temperature, not "no data"), so
 * they are left out of `values` and read "no data" on a temperature cell. The
 * metricDataGap guard blocks exactly the places we cannot rank.
 *
 * SOURCE. World Bank Climate Change Knowledge Portal, observed annual mean
 * near-surface air temperature, 1991-2020 climate normal, as compiled in the
 * Wikipedia "List of countries by average yearly temperature" table (which
 * mirrors the CCKP figures). Snapshot embedded below, keyed by our ISO 3166-1
 * alpha-2 flag code; no network call, so the build is deterministic. Climate
 * normals move slowly; refresh only when the CCKP baseline period advances.
 *
 * See DATA_FEATURE.md and the add-world-metric skill for the surface map.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..');
// End of the 1991-2020 climate-normal period the CCKP figures describe.
const YEAR = 2020;

/**
 * Average annual air temperature in C (1991-2020 normal), keyed by our alpha-2
 * flag code. Values may be negative. A real place absent here has no
 * country-level figure and stays "no data" (absence: 'unknown'); it is NOT
 * treated as 0 (0 C is a real reading, not a gap).
 * @type {Record<string, number>}
 */
const RAW_TEMP = {
  ad: 8.27, ae: 28.17, af: 13.04, ag: 27.2, ai: 27.71, al: 12.44, am: 7.82, ao: 21.77,
  ar: 16.3, as: 27.38, at: 7.44, au: 22.05, aw: 29.17, az: 12.96, ba: 10.35, bb: 26.61,
  bd: 25.71, be: 10.67, bf: 30.4, bg: 11.35, bh: 27.69, bi: 20.51, bj: 28.02, bm: 21.67,
  bn: 26.95, bo: 20.76, bq: 27.47, br: 25.44, bs: 25.58, bt: 10.38, bw: 22.09, by: 7.45,
  bz: 25.7, ca: -4.03, cd: 24.35, cf: 25.47, cg: 24.74, ch: 6.47, ci: 26.8, ck: 24.71,
  cl: 9.39, cm: 24.8, cn: 7.59, co: 25, cr: 24.83, cu: 25.81, cv: 22.53, cw: 28.4, cx: 26.06,
  cy: 20.01, cz: 8.6, de: 9.59, dj: 28.49, dk: 8.9, dm: 26.83, do: 24.55, dz: 23.6, ec: 21.43,
  ee: 6.34, eg: 23.14, er: 26.63, es: 13.07, et: 23.36, fi: 2.46, fj: 24.68, fm: 27.28,
  fo: 6.6, fr: 11.65, ga: 25.2, gb: 9.24, gd: 26.49, ge: 9.01, gg: 12.09, gh: 27.66, gi: 18.15,
  gl: -18.68, gm: 28.38, gn: 25.86, gq: 24.66, gr: 13.17, gt: 23.65, gu: 27.81, gw: 27.98,
  gy: 26.12, hm: 2.46, hn: 24.72, hr: 11.96, ht: 24.95, hu: 11.5, id: 25.96, ie: 9.73,
  il: 20.25, im: 9.65, in: 24.94, io: 27.61, iq: 22.95, ir: 18.34, is: 1.85, it: 13.02,
  je: 12.27, jm: 25.91, jo: 20.05, jp: 11.78, ke: 25.08, kg: 2.65, kh: 27.41, ki: 27.77,
  km: 23.73, kn: 27.47, kp: 6.98, kr: 12.22, kw: 26.31, ky: 27.82, kz: 7.11, la: 24.16,
  lb: 15.45, lc: 27, li: 7.55, lk: 27.25, lr: 25.45, ls: 12.38, lt: 7.38, lu: 10.02, lv: 6.87,
  ly: 22.81, ma: 18.14, mc: 13.05, md: 10.89, me: 9.93, mf: 27.71, mg: 22.64, mh: 28.01,
  mk: 10.79, ml: 29.21, mm: 23.82, mn: 1.07, mp: 27.6, mr: 28.82, ms: 25.75, mt: 20.06,
  mu: 23.33, mv: 28.11, mw: 22.66, mx: 21.31, my: 26.38, mz: 24.41, na: 20.45, nc: 22.69,
  ne: 28.04, nf: 20.02, ng: 27.3, ni: 25.88, nl: 10.49, no: 2.21, np: 14.5, nr: 27.83,
  nu: 25.03, nz: 10.46, om: 27.64, pa: 25.6, pe: 20.07, pf: 24.3, pg: 24.74, ph: 27.1,
  pk: 21.38, pl: 8.78, pm: 5.72, pn: 20.56, pr: 25.04, ps: 20.04, pt: 15.85, pw: 27.9,
  py: 23.92, qa: 28.02, ro: 10.18, rs: 11.4, ru: -3.79, rw: 20.03, sa: 25.94, sb: 25.92,
  sc: 27.09, sd: 27.95, se: 3.23, sg: 27.68, sh: 18.1, si: 9.86, sj: -6.78, sk: 8.83,
  sl: 26.54, sm: 12.83, sn: 28.9, so: 26.95, sr: 26.58, ss: 27.97, st: 24.49, sv: 25.23,
  sx: 27.71, sy: 18.75, sz: 20.64, tc: 26.29, td: 27.63, tf: 4.11, tg: 27.33, th: 26.85,
  tj: 3.85, tk: 28.71, tl: 24.57, tm: 16.66, tn: 20.53, to: 25.01, tr: 11.66, tt: 26.55,
  tv: 28.62, tz: 22.92, ua: 9.27, ug: 23.25, um: 24.97, us: 9.46, uy: 17.97, uz: 13.06,
  va: 15.2, vc: 26.17, ve: 25.71, vg: 26.7, vi: 26.98, vn: 24.79, vu: 24.44, wf: 27.3,
  ws: 27.58, xk: 10.02, ye: 25.54, za: 18.23, zm: 22.23, zw: 21.9,
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
  const notReal = [];
  for (const [code, t] of Object.entries(RAW_TEMP)) {
    if (!realCodes.has(code)) {
      notReal.push(code);
      continue;
    }
    values[code] = t;
  }

  const sorted = {};
  for (const code of Object.keys(values).sort()) sorted[code] = values[code];

  const metric = {
    key: 'temperature',
    label: 'Average temperature',
    unit: '°C',
    // 'decimal1' -> one decimal place (30.4, -3.8). formatValue handles the
    // negative sign; the stored 2-decimal precision keeps the ranking exact.
    format: 'decimal1',
    // absence: 'unknown' -> a real place missing from `values` (sub-national
    // parts and the polar / uninhabited places with no country row) is genuinely
    // unknown, NOT 0 (0 C is a real temperature). It reads "no data".
    absence: 'unknown',
    source:
      `World Bank Climate Change Knowledge Portal, observed annual mean ` +
      `near-surface air temperature, 1991-2020 climate normal, as compiled in ` +
      `the Wikipedia "List of countries by average yearly temperature" table. ` +
      `Degrees Celsius, one decimal; values may be negative. ~234 countries and ` +
      `territories covered; sub-national parts and a few polar / uninhabited ` +
      `places with no country row carry no value (absence: unknown)`,
    year: YEAR,
    values: sorted,
  };

  const outPath = join(REPO, 'flags', 'metrics', 'temperature.json');
  writeFileSync(outPath, JSON.stringify(metric, null, 2) + '\n', 'utf-8');

  console.log(`Wrote ${outPath}`);
  console.log(
    `  values: ${Object.keys(sorted).length} (covered real places) | ` +
      `absence: unknown for the rest`,
  );
  if (notReal.length) {
    console.error(`  temp codes not in countries.json (dropped): ${notReal.join(', ')}`);
  }
}

main();
