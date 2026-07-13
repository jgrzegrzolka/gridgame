/**
 * Regenerates flags/metrics/cattlePerCapita.json: cattle per person.
 *
 * The bovine twin of sheep-per-capita (build-sheep-per-capita.mjs), and built
 * the same way: a *derived* metric like density / gdpPerCapita, but its
 * numerator (cattle head counts) has no repo metric file, so the FAOSTAT
 * snapshot is embedded below (the hand-maintained-table pattern of
 * build-apple.mjs). For every real place (`category !== 'other'`):
 * cattlePerCapita = cattle / population.
 *
 * DATA CONTRACT (dense, no `absence` hint). Every real place gets a value:
 *   - a real place absent from RAW_CATTLE keeps no cattle -> 0 cattle -> 0 per
 *     capita (a fair wrong guess on a "cattle per person >= 1" cell, not a gap),
 *   - the uninhabited territories carry population 0 (Bouvet, Heard, Clipperton);
 *     rather than dividing by zero they are defined as 0.
 * The emitted file lists ALL real places, exactly like density.json / the sheep
 * metric. The famous "more cows than people" club sits at the top: Uruguay leads
 * the world (~3.5 cattle/person), then Chad, Paraguay, New Zealand, Mongolia,
 * Ireland, Argentina, Australia, Brazil.
 *
 * CATTLE SOURCE. FAOSTAT "Cattle - Stocks (animals)", latest year per country
 * (predominantly 2024) via Our World in Data's cattle-livestock-count-heads
 * dataset (variable 1197932). A handful of sub-2024 rows carry each country's
 * latest available year (French overseas departments 2006, etc.). No curated
 * national-statistics fills: unlike sheep, no missing place has an iconic cattle
 * story (the UK home nations, at 0 here, follow the apple/Spanish-regions
 * precedent), and Cook Islands / Niue come straight from FAOSTAT via the map.
 *
 * To refresh cattle: re-pull OWID variable 1197932 (latest year per entity),
 * remap ISO3 -> our alpha-2, and update RAW_CATTLE. No network call here, so
 * this is deterministic. See DATA_FEATURE.md and the add-world-metric skill.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..');
const METRICS = join(REPO, 'flags', 'metrics');
const YEAR = 2024;

/**
 * Cattle head counts keyed by our ISO 3166-1 alpha-2 flag code. FAOSTAT latest
 * year per country (mostly 2024). A real place absent here defaults to 0 cattle.
 * @type {Record<string, number>}
 */
const RAW_CATTLE = {
  ae: 119098, af: 5555383, ag: 4500, al: 272035, am: 491594, ao: 5200294, ar: 52783892, at: 1820030,
  au: 30372536, az: 2329506, ba: 383331, bb: 11241, bd: 25013000, be: 2153430, bf: 10280515,
  bg: 558770, bh: 7000, bi: 1228356, bj: 2762716, bn: 286, bo: 11245622, br: 238180752, bs: 743,
  bt: 257103, bw: 918057, by: 4097900, bz: 99019, ca: 10985000, cd: 2032019, cf: 4864952, cg: 335224,
  ch: 1533483, ci: 1896358, ck: 233, cl: 2962490, cm: 5941769, cn: 70325504, co: 30344182, cr: 1576149,
  cu: 3250000, cv: 29779, cy: 82680, cz: 1397410, de: 10461290, dj: 317893, dk: 1413860, dm: 13873,
  do: 3030340, dz: 1782454, ec: 3436276, ee: 232390, eg: 2625729, er: 2156877, es: 6173960, et: 71916928,
  fi: 764030, fj: 80720, fm: 18180, fo: 1816, fr: 16478260, ga: 39678, gb: 9411871, gd: 6191,
  ge: 837700, gf: 13386, gh: 2362472, gm: 309195, gn: 9319774, gp: 75830, gq: 5520, gr: 595200,
  gt: 4343871, gw: 742836, gy: 98851, hk: 1570, hn: 2900458, hr: 422000, ht: 1524965, hu: 869900,
  id: 18065156, ie: 6308300, il: 477958, in: 194753472, iq: 2104351, ir: 5600812, is: 76902,
  it: 5765000, jm: 153169, jo: 88819, jp: 3985000, ke: 22435638, kg: 1828768, kh: 2821807, km: 51420,
  kn: 1709, kp: 570727, kr: 3889278, kw: 32136, kz: 7976665, la: 2691000, lb: 75538, lc: 10486,
  lk: 1125450, lr: 43270, ls: 517450, lt: 599770, lu: 180530, lv: 352090, ly: 208931, ma: 2365210,
  md: 98817, me: 67496, mg: 6957211, mk: 143953, ml: 14040120, mm: 10800000, mn: 5074552, mq: 23900,
  mr: 1992320, mt: 13800, mu: 3500, mw: 2307952, mx: 36933200, my: 730318, mz: 2467082, na: 2907986,
  nc: 77281, ne: 20375030, ng: 20943448, ni: 5619536, nl: 3562000, no: 852800, np: 5198388, nu: 113,
  nz: 9516288, om: 446988, pa: 1401169, pe: 5842166, pf: 8097, pg: 90889, ph: 2605517, pk: 57541000,
  pl: 6190930, pr: 218598, ps: 41590, pt: 1486910, py: 13630216, qa: 45424, re: 36372, ro: 1809400,
  rs: 698605, ru: 17373368, rw: 1545688, sa: 534181, sb: 15381, sc: 557, sd: 31256148, se: 1333820,
  sg: 177, si: 453890, sk: 416680, sl: 682125, sn: 3714834, so: 4788212, sr: 28821, ss: 14282839,
  st: 1588, sv: 772208, sy: 826396, sz: 652513, td: 39625904, tg: 477388, th: 4293189, tj: 2789212,
  tl: 238902, tm: 2545439, tn: 495935, to: 12196, tr: 16824208, tt: 35419, tw: 155741, tz: 39053012,
  ua: 2156200, ug: 14723179, us: 87157400, uy: 11960556, uz: 14394476, vc: 2600, ve: 15749209,
  vn: 6212203, vu: 89000, ws: 38349, ye: 1971664, za: 12122027, zm: 4887687, zw: 5741397,
};

function main() {
  const countries = JSON.parse(
    readFileSync(join(REPO, 'flags', 'countries.json'), 'utf-8'),
  );
  const population = JSON.parse(
    readFileSync(join(METRICS, 'population.json'), 'utf-8'),
  );
  const realPlaces = countries.filter((c) => c.category !== 'other');

  /** @type {Record<string, number>} */
  const values = {};
  const unknownCode = [];
  for (const code of Object.keys(RAW_CATTLE)) {
    if (!realPlaces.some((c) => c.code === code)) unknownCode.push(code);
  }
  for (const c of realPlaces) {
    const cattle = RAW_CATTLE[c.code] ?? 0;
    const pop = population.values[c.code];
    if (typeof pop !== 'number') continue; // shouldn't happen: population is dense
    // Uninhabited places (pop 0): per-capita is 0, not a divide-by-zero drop.
    // 3 decimals keeps small producers rankable; display format is 2 sig figs.
    values[c.code] = pop <= 0 ? 0 : Math.round((cattle / pop) * 1000) / 1000;
  }

  const sorted = {};
  for (const code of Object.keys(values).sort()) sorted[code] = values[code];

  const metric = {
    key: 'cattlePerCapita',
    label: 'Cattle per capita',
    unit: 'cattle/person',
    // 'sig2' -> 2 significant figures (keeping the whole integer part), so a rate
    // spanning 0.0001 to ~3.5 reads well at both ends: 3.5, 1.2, 0.5, 0.03, and a
    // true 0 as "0". Shared with sheep-per-capita; a fixed decimal count can't.
    format: 'sig2',
    source:
      `derived: FAOSTAT cattle stocks (mostly ${YEAR}, via Our World in Data) / ` +
      `population (${population.year}); a few minor territories carry their latest ` +
      'available year (2006)',
    year: YEAR,
    values: sorted,
  };

  const outPath = join(METRICS, 'cattlePerCapita.json');
  writeFileSync(outPath, JSON.stringify(metric, null, 2) + '\n', 'utf-8');

  console.log(`Wrote ${outPath}`);
  console.log(
    `  values: ${Object.keys(sorted).length} (all real places) | ` +
      `cattle-bearing ${Object.keys(RAW_CATTLE).length}`,
  );
  if (unknownCode.length) {
    console.error(`  cattle codes not in countries.json (dropped): ${unknownCode.join(', ')}`);
  }
}

main();
