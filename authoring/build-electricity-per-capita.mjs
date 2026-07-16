/**
 * Regenerates flags/metrics/electricityPerCapita.json: electric power consumption
 * per person, in kilowatt-hours per year.
 *
 * Like the drink / meat per-capita metrics, this one is NOT derived over
 * population.json: the World Bank figure is already per-capita. The build is a
 * straight embed of RAW_ELECTRICITY below.
 *
 * DATA CONTRACT (`absence: 'unknown'`). The World Bank reports consumption for ~149
 * real places, essentially every country with a metered national grid, but not for
 * many micro-states / small territories (Andorra, Monaco, Liechtenstein, San Marino
 * and much of the Pacific / Caribbean) nor for sub-national parts. A place with no
 * figure DOES use electricity, we just have no measured per-capita value, so it is
 * genuinely UNKNOWN, not zero. Those real places are left out of `values` and read
 * "no data" on an electricity cell, which is correct: the metricDataGap guard blocks
 * exactly the places we cannot rank. The party round is sovereign-scoped and
 * zero-filtered, so the gap never surfaces there.
 *
 * SOURCE. World Bank indicator EG.USE.ELEC.KH.PC, "Electric power consumption (kWh
 * per capita)", latest available year per country (2023-2024 for most). Iceland
 * leads by a wide margin (~49,000 kWh, cheap geothermal power feeding aluminium
 * smelters), then Norway and the Gulf petro-states; the size-independent property
 * is the point: the big populous countries (China ~6,500, India ~1,200) sit
 * mid-table or below, while a tiny high-consumption state tops the list.
 *
 * To refresh: re-pull EG.USE.ELEC.KH.PC (latest year per country), remap the World
 * Bank ISO3 to our alpha-2, and update RAW_ELECTRICITY. No network call here, so
 * this is deterministic. See DATA_FEATURE.md and the add-world-metric skill.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..');
const METRICS = join(REPO, 'flags', 'metrics');
const YEAR = 2023;

/**
 * Electric power consumption, kWh per capita per year, World Bank EG.USE.ELEC.KH.PC,
 * latest year per country, keyed by our ISO 3166-1 alpha-2 flag code. A real place
 * absent here has no World Bank figure and stays "no data" (absence: 'unknown'); it
 * is NOT treated as 0.
 * @type {Record<string, number>}
 */
const RAW_ELECTRICITY = {
  ae: 15285, al: 2892, am: 2386, ao: 379, ar: 2822, at: 7897, au: 9801, az: 2367, ba: 3677,
  bd: 603, be: 7099, bf: 133, bg: 5361, bh: 23120, bj: 115, bn: 10674, bo: 890, br: 3068,
  bw: 1641, by: 4198, ca: 14093, cd: 129, cg: 338, ch: 7117, ci: 354, cl: 4373, cm: 226,
  cn: 6524, co: 1551, cr: 2282, cu: 1462, cw: 5276, cy: 3842, cz: 5877, de: 6109, dk: 6165,
  do: 1867, dz: 1828, ec: 1676, ee: 5298, eg: 1493, er: 123, es: 5196, et: 113, fi: 14819,
  fr: 6447, ga: 1023, gb: 4195, ge: 3382, gh: 565, gi: 5017, gq: 792, gr: 4686, gt: 733,
  hk: 6359, hn: 752, hr: 4484, ht: 76, hu: 4812, id: 1445, ie: 6298, il: 7186, in: 1182,
  iq: 1377, ir: 3815, is: 48998, it: 5137, jm: 1205, jo: 1858, jp: 7530, ke: 195, kg: 2069,
  kh: 932, kp: 789, kr: 11350, kw: 16496, kz: 5146, la: 1665, lb: 975, lk: 644, lt: 4387,
  lu: 11662, lv: 3768, ly: 3796, ma: 997, md: 2412, me: 4564, mg: 80, mk: 3320, mm: 368,
  mn: 2728, mt: 5013, mu: 2465, mx: 2658, my: 5084, mz: 391, na: 1232, ne: 68, ng: 144,
  ni: 641, nl: 6386, no: 23673, np: 351, nz: 7989, om: 8203, pa: 2715, pe: 1595, ph: 925,
  pk: 518, pl: 4370, pt: 5294, py: 2389, qa: 19963, ro: 2585, rs: 5090, ru: 7285, rw: 77,
  sa: 11911, sd: 223, se: 12226, sg: 9750, si: 6450, sk: 4675, sn: 410, sr: 2897, ss: 48,
  sv: 1137, sy: 854, sz: 1200, td: 14, tg: 246, th: 2965, tj: 1497, tm: 2778, tn: 1629,
  tr: 3731, tt: 6664, tz: 135, ua: 2516, ug: 95, us: 12839, uy: 3790, uz: 2059, ve: 1953,
  vn: 2585, ye: 90, za: 3247, zm: 727, zw: 504,
};

function main() {
  const countries = JSON.parse(readFileSync(join(REPO, 'flags', 'countries.json'), 'utf-8'));
  const realCodes = new Set(countries.filter((c) => c.category !== 'other').map((c) => c.code));

  /** @type {Record<string, number>} */
  const values = {};
  const dropped = [];
  for (const [code, kwh] of Object.entries(RAW_ELECTRICITY)) {
    if (!realCodes.has(code)) {
      dropped.push(code);
      continue;
    }
    values[code] = Math.round(kwh); // whole kWh; the 'compact' format renders 49.0K / 12.8K / 68
  }

  const sorted = {};
  for (const code of Object.keys(values).sort()) sorted[code] = values[code];

  const metric = {
    key: 'electricityPerCapita',
    label: 'Electricity use per capita',
    unit: 'kWh/person',
    // 'compact' -> 49.0K / 23.7K / 1.2K / 68, the readable form for a range that
    // spans 14 to ~49,000 kWh.
    format: 'compact',
    // absence: 'unknown' -> a real place missing from `values` (the micro-states and
    // small territories the World Bank does not meter) is genuinely unknown, NOT
    // zero. It reads "no data" and the metricDataGap guard blocks it.
    absence: 'unknown',
    source:
      `World Bank EG.USE.ELEC.KH.PC (electric power consumption, kWh per capita), ` +
      `latest year per country (${YEAR}-2024 for most). Iceland leads by a wide ` +
      `margin (cheap geothermal power feeding aluminium smelters), then Norway and ` +
      `the Gulf states; the big populous countries sit mid-table, the intensive ` +
      `property this metric exists for. The micro-states / small territories the ` +
      `World Bank does not meter carry no value (absence: unknown)`,
    year: YEAR,
    values: sorted,
  };

  const outPath = join(METRICS, 'electricityPerCapita.json');
  writeFileSync(outPath, JSON.stringify(metric, null, 2) + '\n', 'utf-8');

  console.log(`Wrote ${outPath}`);
  console.log(`  values: ${Object.keys(sorted).length} (World Bank-covered real places) | absence: unknown for the rest`);
  if (dropped.length) console.error(`  electricity codes not in countries.json (dropped): ${dropped.join(', ')}`);
}

main();
