/**
 * Regenerates flags/metrics/alcoholPerCapita.json: total alcohol drunk per
 * person, in litres of PURE ALCOHOL per adult (15+) per year. The size-independent
 * companion to beer-per-capita: beer is one beverage type, this is the whole lot
 * (beer + wine + spirits + other), so the two rank differently (a wine or spirits
 * culture can sit high here while low on beer).
 *
 * DATA CONTRACT (`absence: 'unknown'`, the same as beer). WHO measures ~189
 * countries, essentially every sovereign state, but NOT sub-national parts (the UK
 * home nations, Spanish regions) or most small territories (Greenland, Hong Kong,
 * Faroe, Gibraltar, ...). A territory does drink, we just do not have a figure, so
 * its value is genuinely UNKNOWN, not zero. Those real places are left out of
 * `values` and read "no data" on an alcohol cell, which is correct: the
 * metricDataGap guard blocks exactly the places we cannot rank. The covered set is
 * kept identical to beer-per-capita's on purpose, so the two per-capita drink
 * metrics have matching coverage and the same absence gap.
 *
 * SOURCE. WHO Global Information System on Alcohol and Health (GISAH), "Total
 * (recorded) alcohol per capita (15+) consumption", litres of pure alcohol,
 * latest available year per country (~2019). Recorded consumption only (excludes
 * home-brew / smuggled / tourist), so it reads lower than the total-including-
 * unrecorded figure some tables cite (e.g. Moldova's recorded ~12.9 vs a
 * total ~15). The ranking is what carries the metric: the top is the European
 * heavyweights (Lithuania, Nigeria's recorded ~9 aside, Ireland, Latvia, Moldova,
 * Czechia, Romania, Slovenia, France, Portugal, Germany, Croatia), the dry states
 * (Saudi Arabia, Iran, Kuwait, Libya, Somalia, ...) sit at 0.
 *
 * To refresh: re-pull the GISAH total-recorded-APC series (latest year per
 * country), remap ISO3 -> our alpha-2, and update RECORDED_APC. No network call
 * here, so this is deterministic. See DATA_FEATURE.md and the add-world-metric
 * skill.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..');
const METRICS = join(REPO, 'flags', 'metrics');
const YEAR = 2019;

/**
 * WHO total recorded alcohol per capita, litres of PURE ALCOHOL per adult (15+),
 * ~2019, keyed by our ISO 3166-1 alpha-2 flag code. A real place absent here has
 * no WHO figure and stays "no data" (absence: 'unknown'); it is NOT treated as 0.
 * Coverage mirrors beerPerCapita's key set.
 * @type {Record<string, number>}
 */
const RECORDED_APC = {
  ad: 10, ae: 0.9, af: 0, ag: 6.5, al: 4.4, am: 3.8, ao: 4.8, ar: 8.5, at: 11.9,
  au: 9.5, az: 0.8, ba: 5.7, bb: 6.7, bd: 0, be: 10.8, bf: 4.3, bg: 11.2, bh: 1.5,
  bi: 4.6, bj: 1.8, bn: 0.5, bo: 4.8, br: 6.7, bs: 5.7, bt: 0.6, bw: 6.1, by: 11.2,
  bz: 5.3, ca: 8.9, cd: 2.5, cf: 3, cg: 4.6, ch: 10, ci: 2.5, ck: 8,
  cl: 7.9, cm: 8, cn: 7.1, co: 5.2, cr: 4, cu: 5.2, cv: 4.5, cy: 9.3,
  cz: 12.7, de: 12.2, dj: 1, dk: 10.4, dm: 6.6, do: 4.9, dz: 0.9, ec: 4.2, ee: 11.6,
  eg: 0.2, er: 1, es: 10.5, et: 3, fi: 10.7, fj: 2.5, fm: 2, fr: 12.3,
  ga: 6.5, gb: 11.4, gd: 8, ge: 7.7, gh: 2.7, gm: 2.4, gn: 1, gq: 8.5,
  gr: 10.4, gt: 2.7, gw: 4, gy: 5.5, hn: 3, hr: 12, ht: 3, hu: 11.4,
  id: 0.3, ie: 13, il: 3.1, in: 5.7, iq: 0.4, ir: 0, is: 9.1, it: 8, jm: 4.1,
  jo: 0.5, jp: 8, ke: 3.4, kg: 6.2, kh: 6.7, ki: 2, km: 0.2, kn: 8,
  kp: 3.6, kr: 10.2, kw: 0, kz: 7.7, la: 10.4, lb: 1.9, lc: 9, lk: 4.3, lr: 5,
  ls: 5, lt: 13.2, lu: 11, lv: 12.9, ly: 0, ma: 0.9, md: 12.9, me: 9.7, mg: 1.6,
  mk: 6, ml: 1, mm: 4.8, mn: 8, mr: 0, mt: 8.2, mu: 5.5, mv: 1.4, mw: 2.5,
  mx: 6.5, my: 1, mz: 3, na: 6.8, ne: 0.3, ng: 9.1, ni: 5, nl: 9.7,
  no: 7.5, np: 2, nr: 3, nu: 8, nz: 10.7, om: 0.9, pa: 7.9, pe: 6.3, pg: 1.5,
  ph: 6.8, pk: 0.3, pl: 11.6, pt: 12.3, py: 7.2, qa: 1.4, ro: 12.6, rs: 9.6,
  ru: 11.7, rw: 9, sa: 0.2, sb: 1.2, sc: 9, sd: 0, se: 9, sg: 2, si: 12.6,
  sk: 11.5, sl: 4, sn: 0.6, so: 0, sr: 5.5, st: 5, sv: 3.7, sy: 1, sz: 5.5,
  td: 2, tg: 3.5, th: 8.3, tj: 1.9, tl: 1, tm: 5, tn: 1.5, to: 1,
  tr: 2, tt: 6.7, tv: 1.5, tz: 9.4, ua: 8.6, ug: 9.5, us: 9.8, uy: 10.8, uz: 2.7,
  vc: 6.9, ve: 5.6, vn: 8.3, vu: 1, ws: 2.5, ye: 0.1, za: 9.3, zm: 4.8, zw: 4.8,
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
  for (const [code, apc] of Object.entries(RECORDED_APC)) {
    if (!realCodes.has(code)) {
      unknownCode.push(code);
      continue;
    }
    // Keep one decimal so the ranking is exact; the 'decimal1' display format
    // renders it as e.g. 12.7 litres.
    values[code] = Math.round(apc * 10) / 10;
  }

  const sorted = {};
  for (const code of Object.keys(values).sort()) sorted[code] = values[code];

  const metric = {
    key: 'alcoholPerCapita',
    label: 'Alcohol per capita',
    unit: 'litres of pure alcohol/person',
    // 'decimal1' -> one decimal (12.7, 9.5, 0.0). The range is 0..13, so a
    // compact/2-sig-fig format would hide the exact figure.
    format: 'decimal1',
    // absence: 'unknown' -> a real place missing from `values` (the small
    // territories + sub-national parts WHO does not measure) is genuinely unknown,
    // NOT zero. It reads "no data" and the metricDataGap guard blocks it. Same
    // contract as beerPerCapita; see the build header and DATA_FEATURE.md.
    absence: 'unknown',
    source:
      `WHO Global Information System on Alcohol and Health (GISAH), total ` +
      `recorded alcohol per capita (15+), litres of pure alcohol, ~${YEAR}. ` +
      `Recorded consumption only, so lower than totals that add unrecorded / ` +
      `home-brew. Coverage mirrors beerPerCapita; the territories / sub-national ` +
      `places WHO does not measure carry no value (absence: unknown)`,
    year: YEAR,
    values: sorted,
  };

  const outPath = join(METRICS, 'alcoholPerCapita.json');
  writeFileSync(outPath, JSON.stringify(metric, null, 2) + '\n', 'utf-8');

  console.log(`Wrote ${outPath}`);
  console.log(
    `  values: ${Object.keys(sorted).length} (WHO-covered real places) | ` +
      `absence: unknown for the rest`,
  );
  if (unknownCode.length) {
    console.error(`  alcohol codes not in countries.json (dropped): ${unknownCode.join(', ')}`);
  }
}

main();
