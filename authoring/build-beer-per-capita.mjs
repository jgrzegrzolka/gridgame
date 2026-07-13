/**
 * Regenerates flags/metrics/beerPerCapita.json: beer drunk per person, in litres
 * of actual beer per year.
 *
 * Unlike the livestock per-capita metrics (sheep / cattle), this one is NOT
 * derived over population.json: the WHO figure is already per-capita. The build
 * is a straight embed-and-convert of a WHO snapshot.
 *
 * DATA CONTRACT (`absence: 'unknown'`, the first metric to use it). WHO measures
 * ~189 countries, essentially every sovereign state, but NOT sub-national parts
 * (the UK home nations, Spanish regions) or most small territories (Greenland,
 * Hong Kong, Puerto Rico, Faroe, Gibraltar, ...). A territory does drink beer, we
 * just do not have a figure, so its value is genuinely UNKNOWN, not zero. Those
 * ~73 real places are therefore left out of `values` and read "no data" on a beer
 * cell, which is correct: the metricDataGap guard blocks exactly the places we
 * cannot rank. (Contrast the crops, `absence: 'zero'`, where a missing place
 * really does produce none, and the dense metrics where every real place has a
 * value.) The party round is sovereign-scoped, so it never touches the gap.
 *
 * SOURCE. WHO Global Health Observatory indicator SA_0000001400, "Alcohol,
 * recorded per capita (15+) consumption (in litres of pure alcohol), by beverage
 * type", beer, 2024. That figure is litres of PURE ALCOHOL from beer per adult;
 * we convert to litres of BEER at the standard AVG_BEER_ABV assumption below.
 * Because it is *recorded* consumption among adults (15+), it reads lower than
 * tourist-inclusive industry tallies (e.g. Czechia ~131 L here vs the Kirin
 * report's ~184 L). The ranking is what carries the metric: Czechia leads, then
 * Gabon, Austria, Panama, Croatia, Brazil, Poland, Romania, Mexico, Namibia,
 * Germany; the dry states (Saudi Arabia, Iran, Kuwait, Libya, ...) sit at 0.
 *
 * To refresh: re-pull GHO SA_0000001400 (beer, latest year per country), remap
 * ISO3 -> our alpha-2, and update RAW_BEER_ALCOHOL. No network call here, so this
 * is deterministic. See DATA_FEATURE.md and the add-world-metric skill.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..');
const METRICS = join(REPO, 'flags', 'metrics');
const YEAR = 2024;

// Convert litres of pure alcohol to litres of beer: beer is taken at 5% ABV, the
// WHO / OWID convention. A scalar, so it never changes the ranking, only the unit
// the reader sees (6.5 L alcohol -> ~131 L beer).
const AVG_BEER_ABV = 0.05;

/**
 * WHO recorded beer consumption, litres of PURE ALCOHOL per adult (15+), 2024,
 * keyed by our ISO 3166-1 alpha-2 flag code. A real place absent here has no WHO
 * figure and stays "no data" (absence: 'unknown'); it is NOT treated as 0.
 * @type {Record<string, number>}
 */
const RAW_BEER_ALCOHOL = {
  ad: 3.602, ae: 0.535, af: 0, ag: 3.438, al: 1.964, am: 0.582, ao: 1.71, ar: 2.33, at: 6.063,
  au: 3.067, az: 0.356, ba: 4.151, bb: 4.299, bd: 0, be: 3.885, bf: 0.77, bg: 4.649, bh: 0.672,
  bi: 1.362, bj: 0.476, bn: 0, bo: 2.235, br: 5.214, bs: 2.823, bt: 2.58, bw: 4.14, by: 2.459,
  bz: 3.135, ca: 2.871, cd: 0.477, cf: 0.6, cg: 2.557, ch: 2.832, ci: 0.872, ck: 0.512,
  cl: 3.034, cm: 2.75, cn: 1.182, co: 3.068, cr: 2.258, cu: 1.798, cv: 1.331, cy: 2.093,
  cz: 6.531, de: 4.679, dj: 0.051, dk: 3.318, dm: 1.72, do: 2.56, dz: 0.288, ec: 2.103, ee: 4.24,
  eg: 0.051, er: 0.448, es: 4.642, et: 1.074, fi: 3.34, fj: 1.29, fm: 0.596, fr: 2.562,
  ga: 6.272, gb: 3.25, gd: 3.76, ge: 2.202, gh: 0.517, gm: 0.008, gn: 0.279, gq: 2.688,
  gr: 2.413, gt: 2.23, gw: 0.395, gy: 3.992, hn: 1.53, hr: 5.703, ht: 0.303, hu: 3.657,
  id: 0.049, ie: 4.192, il: 1.268, in: 0.252, iq: 0.069, ir: 0, is: 3.964, it: 2.066, jm: 1.14,
  jo: 0.051, jp: 1.319, ke: 0.839, kg: 0.522, kh: 3.325, ki: 0.239, km: 0.034, kn: 4.436,
  kp: 0.072, kr: 1.615, kw: 0, kz: 2.086, la: 3.918, lb: 0.41, lc: 3.964, lk: 0.238, lr: 0.088,
  ls: 2.189, lt: 3.935, lu: 3.925, lv: 4.2, ly: 0, ma: 0.147, md: 1.913, me: 3.093, mg: 0.364,
  mk: 2.454, ml: 0.042, mm: 0.495, mn: 2.908, mr: 0, mt: 2.388, mu: 2.421, mv: 0.015, mw: 0.053,
  mx: 4.871, my: 0.499, mz: 1.127, na: 4.849, ne: 0.056, ng: 0.512, ni: 1.454, nl: 3.436,
  no: 2.531, np: 0.333, nr: 0, nu: 0.357, nz: 3.088, om: 0.154, pa: 5.713, pe: 2.863, pg: 0.398,
  ph: 1.013, pk: 0.004, pl: 5.041, pt: 3.114, py: 3.465, qa: 0.309, ro: 4.892, rs: 4.027,
  ru: 3.373, rw: 1.589, sa: 0, sb: 0.562, sc: 3.707, sd: 0, se: 2.732, sg: 1.29, si: 4.3,
  sk: 2.255, sl: 0.122, sn: 0.152, so: 0, sr: 2.979, st: 0.433, sv: 1.579, sy: 0.014, sz: 1.85,
  td: 0.299, tg: 0.941, th: 2.134, tj: 0.265, tl: 0.181, tm: 0.512, tn: 0.927, to: 0.007,
  tr: 0.917, tt: 2.228, tv: 0, tz: 0.757, ua: 0.826, ug: 0.413, us: 3.613, uy: 1.776, uz: 0.303,
  vc: 3.154, ve: 0.883, vn: 2.951, vu: 0.47, ws: 2.158, ye: 0, za: 3.958, zm: 1.195, zw: 1.251,
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
  const unknownCode = [];
  for (const [code, pureAlcohol] of Object.entries(RAW_BEER_ALCOHOL)) {
    if (!realCodes.has(code)) {
      unknownCode.push(code);
      continue;
    }
    // litres of beer = litres of pure alcohol / ABV; keep one decimal so the
    // ranking is exact, the 'plain' display format rounds to whole litres.
    values[code] = Math.round((pureAlcohol / AVG_BEER_ABV) * 10) / 10;
  }

  const sorted = {};
  for (const code of Object.keys(values).sort()) sorted[code] = values[code];

  const metric = {
    key: 'beerPerCapita',
    label: 'Beer per capita',
    unit: 'litres/person',
    // 'plain' -> whole litres with thousands separators (131, 94, 0). The range is
    // 0..131, so a compact/2-sig-fig format would only hide the exact figure.
    format: 'plain',
    // absence: 'unknown' -> a real place missing from `values` (all the small
    // territories + sub-national parts WHO does not measure) is genuinely unknown,
    // NOT zero. It reads "no data" and the metricDataGap guard blocks it. First
    // metric with this contract; see the build header and DATA_FEATURE.md.
    absence: 'unknown',
    source:
      `WHO Global Health Observatory SA_0000001400 (recorded alcohol per capita ` +
      `15+, beer), ${YEAR}, converted from litres of pure alcohol to litres of ` +
      `beer at ${AVG_BEER_ABV * 100}% ABV. Recorded adult consumption, so lower ` +
      `than tourist-inclusive tallies. ~73 territories / sub-national places WHO ` +
      `does not measure carry no value (absence: unknown)`,
    year: YEAR,
    values: sorted,
  };

  const outPath = join(METRICS, 'beerPerCapita.json');
  writeFileSync(outPath, JSON.stringify(metric, null, 2) + '\n', 'utf-8');

  console.log(`Wrote ${outPath}`);
  console.log(
    `  values: ${Object.keys(sorted).length} (WHO-covered real places) | ` +
      `absence: unknown for the rest`,
  );
  if (unknownCode.length) {
    console.error(`  beer codes not in countries.json (dropped): ${unknownCode.join(', ')}`);
  }
}

main();
