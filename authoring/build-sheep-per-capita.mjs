/**
 * Regenerates flags/metrics/sheepPerCapita.json: sheep per person.
 *
 * Sheep per capita is a *derived* metric like density and gdpPerCapita, but its
 * numerator has no repo metric file, so the raw head counts are embedded below
 * (the hand-maintained-snapshot pattern of build-apple.mjs). For every real
 * place (`category !== 'other'`): sheepPerCapita = sheep / population. Both the
 * fill-to-0 sheep counts and the dense population make this dense too, so a
 * metric "no data" reads only for non-places (orgs).
 *
 * DATA CONTRACT (dense, no `absence` hint). Every real place gets a value:
 *   - a real place absent from RAW_SHEEP grows no sheep -> 0 sheep -> 0 per capita
 *     (a fair wrong guess on a "sheep per person >= 1" cell, not a data gap),
 *   - the uninhabited territories carry population 0 (Bouvet, Heard, Clipperton);
 *     rather than dividing by zero (which would drop them and break "every real
 *     place has a value"), they are defined as 0 (no people, no sheep, no ratio).
 * The emitted file therefore lists ALL real places, exactly like density.json.
 *
 * SHEEP SOURCE. FAOSTAT "Sheep - Stocks (animals)", latest year per country
 * (predominantly 2024) via Our World in Data's livestock_counts dataset
 * (variable "Number of sheep", 2026-07-08). A handful of sub-2024 rows carry
 * each country's latest available year (Belgium/Palestine 2022; the French
 * overseas departments 2006). Curated FILLS the FAOSTAT country set omits, from
 * national statistics:
 *   - fk Falkland Islands 500,000 (FI Farm Statistics 2022/23; ~143 sheep/person)
 *   - the four UK home nations, Defra June 2024: England 13.8M, Wales 8.7M,
 *     Scotland 6.6M, Northern Ireland 2.0M (sum ~= FAOSTAT's UK total 31.0M)
 *   - gl Greenland 20,000 (South Greenland sheep farming)
 * Faroe Islands (fo) and Puerto Rico (pr) come straight from FAOSTAT.
 *
 * To refresh sheep: re-pull OWID variable 1290885 (latest year per entity),
 * remap ISO3 -> our alpha-2, and update RAW_SHEEP + the Defra/FI fills. No
 * network call here, so this is deterministic. See DATA_FEATURE.md and the
 * add-world-metric skill for the map.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..');
const METRICS = join(REPO, 'flags', 'metrics');
const YEAR = 2024;

/**
 * Sheep head counts keyed by our ISO 3166-1 alpha-2 flag code. FAOSTAT latest
 * year per country (mostly 2024) plus the curated national-statistics fills
 * documented in the header. A real place absent here defaults to 0 sheep.
 * @type {Record<string, number>}
 */
const RAW_SHEEP = {
  ae: 2045170, af: 12450000, ag: 4473, al: 1176523, am: 690565, ao: 1140494, ar: 12440906, at: 390940,
  au: 79330000, az: 7041901, ba: 1098899, bb: 12718, bd: 3903000, be: 110120, bf: 11543571, bg: 1016700,
  bh: 63000, bi: 708094, bj: 2647421, bn: 4356, bo: 7470438, br: 21862326, bs: 6590, bt: 9176,
  bw: 148744, by: 74000, bz: 16798, ca: 822000, cd: 920510, cf: 452132, cg: 125957, ch: 374239,
  ci: 2636786, cl: 1750000, cm: 3551761, cn: 182939008, co: 1689875, cr: 2896, cu: 1357728, cv: 19701,
  cy: 364750, cz: 180368, de: 1510900, dj: 470538, dk: 147980, dm: 8516, do: 261952, dz: 32354832,
  ec: 448382, ee: 46100, eg: 1950000, er: 2508985, es: 13476030, et: 41050912, fi: 115432, fj: 39547,
  fk: 500000, fo: 79941, fr: 6607000, ga: 221154, gb: 31016700, 'gb-eng': 13800000, 'gb-nir': 2000000,
  'gb-sct': 6600000, 'gb-wls': 8700000, gd: 9639, ge: 712400, gf: 1412, gh: 6176664, gl: 20000,
  gm: 190879, gn: 3995308, gp: 2250, gq: 41686, gr: 7774200, gt: 611329, gw: 472038, gy: 132162,
  hk: 23, hn: 16971, hr: 553000, ht: 311123, hu: 846800, id: 15137290, ie: 3591640, il: 400000,
  in: 114623768, iq: 6672540, ir: 53820780, is: 345440, it: 5390350, jm: 1311, jo: 3076021, jp: 15151,
  ke: 26214928, kg: 5621278, km: 26249, kn: 10993, kp: 164779, kr: 1391, kw: 737547, kz: 18546044,
  lb: 430853, lc: 9146, lk: 17820, lr: 281696, ls: 1913822, lt: 124410, lu: 9635, lv: 69640,
  ly: 7491773, ma: 19892910, md: 423608, me: 144916, mg: 925907, mk: 517128, ml: 24483548, mm: 540000,
  mn: 24491124, mq: 14400, mr: 11208099, mt: 14560, mu: 5050, mw: 436701, mx: 8866253, my: 139393,
  mz: 229764, na: 1921652, nc: 1753, ne: 15669056, ng: 52136324, ni: 6931, nl: 607000, no: 2128600,
  np: 633222, nz: 23583000, om: 681650, pe: 11278083, pf: 441, pg: 7309, ph: 30000, pk: 32731000,
  pl: 269538, pr: 12791, ps: 782060, pt: 2142450, py: 371738, qa: 804695, re: 1024, ro: 10443400,
  rs: 1759424, ru: 19111986, rw: 288916, sa: 22428136, sd: 40705304, se: 315790, si: 116825,
  sk: 276464, sl: 934780, sn: 8726635, so: 7987932, sr: 6626, ss: 14353872, st: 3386, sv: 5577,
  sy: 17928586, sz: 18522, td: 45168960, tg: 2029331, th: 41664, tj: 4283000, tl: 39000, tm: 14270745,
  tn: 6094960, tr: 44080584, tt: 15471, tw: 155, tz: 9505944, ua: 488000, ug: 4373676, us: 5030000,
  uy: 5654270, uz: 21028100, vc: 8496, ve: 629786, vu: 1260, ye: 10799861, za: 21240448, zm: 330243,
  zw: 746277,
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
  const unknownCode = []; // RAW_SHEEP codes not present as a real place
  for (const code of Object.keys(RAW_SHEEP)) {
    if (!realPlaces.some((c) => c.code === code)) unknownCode.push(code);
  }
  for (const c of realPlaces) {
    const sheep = RAW_SHEEP[c.code] ?? 0;
    const pop = population.values[c.code];
    if (typeof pop !== 'number') continue; // shouldn't happen: population is dense
    // Uninhabited places (pop 0): per-capita is 0, not a divide-by-zero drop.
    // 3 decimals keeps tiny producers rankable; display format is one decimal.
    values[c.code] = pop <= 0 ? 0 : Math.round((sheep / pop) * 1000) / 1000;
  }

  // Stable, code-sorted output for minimal refresh diffs.
  const sorted = {};
  for (const code of Object.keys(values).sort()) sorted[code] = values[code];

  const metric = {
    key: 'sheepPerCapita',
    label: 'Sheep per capita',
    unit: 'sheep/person',
    // 'sig2' -> 2 significant figures (keeping the whole integer part), so a rate
    // spanning 0.0074 (Poland) to 135 (Falklands) reads well at both ends: 135,
    // 7, 4.5, 0.9, 0.0074, and a true 0 as "0". A fixed decimal count can't.
    format: 'sig2',
    source:
      `derived: FAOSTAT sheep stocks (mostly ${YEAR}, via Our World in Data) / ` +
      `population (${population.year}); Falklands, UK home nations (Defra ${YEAR}) ` +
      'and Greenland from national statistics',
    year: YEAR,
    values: sorted,
  };

  const outPath = join(METRICS, 'sheepPerCapita.json');
  writeFileSync(outPath, JSON.stringify(metric, null, 2) + '\n', 'utf-8');

  console.log(`Wrote ${outPath}`);
  console.log(
    `  values: ${Object.keys(sorted).length} (all real places) | ` +
      `sheep-bearing ${Object.keys(RAW_SHEEP).length}`,
  );
  if (unknownCode.length) {
    console.error(
      `  sheep codes not in countries.json (dropped): ${unknownCode.join(', ')}`,
    );
  }
}

main();
