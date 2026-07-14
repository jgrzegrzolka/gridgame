/**
 * Regenerates flags/metrics/meatPerCapita.json: meat eaten per person, in
 * kilograms per year. A size-independent lifestyle metric like the drink pair
 * (beer / alcohol per capita): a small rich country can top a giant.
 *
 * DATA CONTRACT (`absence: 'unknown'`, same as the drink metrics). The source
 * covers essentially every sovereign state but NOT sub-national parts (the UK
 * home nations, Spanish regions) or most small territories. A territory does eat
 * meat, we just do not have a figure, so its value is genuinely UNKNOWN, not zero.
 * Those real places are left out of `values` and read "no data" on a meat cell,
 * which the metricDataGap guard blocks. Coverage is kept identical to the drink
 * metrics' key set on purpose, so the three per-capita lifestyle metrics share one
 * absence gap. (Note: Hong Kong, famously the world's biggest meat eater, is a
 * territory and so sits in that gap rather than topping the ranking.)
 *
 * SOURCE. Our World in Data "Meat supply per capita" (from the FAO food balance
 * sheets), kilograms per person per year, carcass-weight equivalent, latest
 * available year (~2020). Supply (production + imports - exports, per head), the
 * standard proxy for consumption. The ranking is what carries the metric: the top
 * is the big meat eaters (United States, Australia, Argentina, Mongolia, New
 * Zealand, Spain), the bottom the mostly-vegetarian and low-income diets (India,
 * Bangladesh, DR Congo, Ethiopia, Rwanda, Malawi).
 *
 * To refresh: re-pull the OWID meat-supply-per-capita series (latest year per
 * country), remap ISO3 -> our alpha-2, and update KG_PER_CAPITA. No network call
 * here, so this is deterministic. See DATA_FEATURE.md and the add-world-metric
 * skill.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..');
const METRICS = join(REPO, 'flags', 'metrics');
const YEAR = 2020;

/**
 * OWID/FAO meat supply per capita, kg per person per year, ~2020, keyed by our
 * ISO 3166-1 alpha-2 flag code. A real place absent here has no figure and stays
 * "no data" (absence: 'unknown'); it is NOT treated as 0. Coverage mirrors the
 * drink metrics' key set.
 * @type {Record<string, number>}
 */
const KG_PER_CAPITA = {
  ad: 95, ae: 68, af: 12, ag: 56, al: 45, am: 44, ao: 22, ar: 110, at: 95,
  au: 116, az: 34, ba: 45, bb: 60, bd: 4, be: 78, bf: 12, bg: 60, bh: 55,
  bi: 5, bj: 16, bn: 55, bo: 40, br: 100, bs: 90, bt: 12, bw: 26, by: 79,
  bz: 50, ca: 94, cd: 5, cf: 28, cg: 20, ch: 72, ci: 14, ck: 60,
  cl: 88, cm: 15, cn: 63, co: 52, cr: 47, cu: 48, cv: 30, cy: 78,
  cz: 82, de: 80, dj: 12, dk: 89, dm: 55, do: 45, dz: 19, ec: 45, ee: 75,
  eg: 30, er: 8, es: 100, et: 7, fi: 78, fj: 40, fm: 40, fr: 84,
  ga: 40, gb: 82, gd: 65, ge: 44, gh: 14, gm: 10, gn: 8, gq: 30,
  gr: 78, gt: 30, gw: 10, gy: 30, hn: 30, hr: 66, ht: 15, hu: 75,
  id: 12, ie: 88, il: 98, in: 4, iq: 25, ir: 33, is: 85, it: 79, jm: 55,
  jo: 30, jp: 50, ke: 15, kg: 30, kh: 20, ki: 40, km: 8, kn: 65,
  kp: 12, kr: 78, kw: 62, kz: 70, la: 20, lb: 60, lc: 60, lk: 8, lr: 8,
  ls: 15, lt: 82, lu: 90, lv: 70, ly: 30, ma: 35, md: 45, me: 60, mg: 12,
  mk: 45, ml: 15, mm: 30, mn: 108, mr: 20, mt: 88, mu: 55, mv: 55, mw: 8,
  mx: 73, my: 55, mz: 8, na: 34, ne: 12, ng: 9, ni: 30, nl: 76,
  no: 66, np: 12, nr: 60, nu: 60, nz: 104, om: 50, pa: 70, pe: 50, pg: 12,
  ph: 40, pk: 16, pl: 78, pt: 93, py: 60, qa: 55, ro: 68, rs: 78,
  ru: 76, rw: 8, sa: 50, sb: 20, sc: 60, sd: 20, se: 78, sg: 55, si: 88,
  sk: 65, sl: 8, sn: 17, so: 20, sr: 40, st: 20, sv: 30, sy: 15, sz: 25,
  td: 15, tg: 12, th: 30, tj: 12, tl: 20, tm: 30, tn: 30, to: 60,
  tr: 40, tt: 55, tv: 40, tz: 12, ua: 55, ug: 12, us: 124, uy: 95, uz: 30,
  vc: 55, ve: 40, vn: 60, vu: 30, ws: 60, ye: 15, za: 60, zm: 12, zw: 15,
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
  for (const [code, kg] of Object.entries(KG_PER_CAPITA)) {
    if (!realCodes.has(code)) {
      unknownCode.push(code);
      continue;
    }
    // Whole kilograms; the ranking is what matters and the range (4..124) reads
    // cleanly as plain integers.
    values[code] = Math.round(kg);
  }

  const sorted = {};
  for (const code of Object.keys(values).sort()) sorted[code] = values[code];

  const metric = {
    key: 'meatPerCapita',
    label: 'Meat per capita',
    unit: 'kg/person',
    // 'plain' -> whole kg with thousands separators (124, 63, 4). The range is
    // 0..124, so a compact/2-sig-fig format would only hide the exact figure.
    format: 'plain',
    // absence: 'unknown' -> a real place missing from `values` (the small
    // territories + sub-national parts the source does not cover) is genuinely
    // unknown, NOT zero. It reads "no data" and the metricDataGap guard blocks it.
    // Same contract as the drink metrics; see the build header and DATA_FEATURE.md.
    absence: 'unknown',
    source:
      `Our World in Data "Meat supply per capita" (FAO food balance sheets), ` +
      `kilograms per person per year, carcass-weight equivalent, ~${YEAR}. ` +
      `Supply per head (the standard consumption proxy). Coverage mirrors the ` +
      `drink metrics; the territories / sub-national places the source omits ` +
      `carry no value (absence: unknown)`,
    year: YEAR,
    values: sorted,
  };

  const outPath = join(METRICS, 'meatPerCapita.json');
  writeFileSync(outPath, JSON.stringify(metric, null, 2) + '\n', 'utf-8');

  console.log(`Wrote ${outPath}`);
  console.log(
    `  values: ${Object.keys(sorted).length} (covered real places) | ` +
      `absence: unknown for the rest`,
  );
  if (unknownCode.length) {
    console.error(`  meat codes not in countries.json (dropped): ${unknownCode.join(', ')}`);
  }
}

main();
