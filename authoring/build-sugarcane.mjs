/**
 * Regenerates flags/metrics/sugarcane.json: sugar-cane production per country.
 *
 * Sugar cane is a *sparse* world metric, another crop in coffee's family, but
 * the **largest crop on Earth by tonnage** (world ~1.9 billion tonnes, an order
 * up from rice). ~104 countries grow it: the source table (FAOSTAT item 156
 * "Sugar cane", via Our World in Data's mirror) lists producers only, and every
 * real place NOT in the table grows none.
 *
 * DATA CONTRACT: sugar cane is *sparse* with `absence: 'zero'`, exactly like
 * coffee/tea. The emitted file lists producers only, and carries an
 * `absence: 'zero'` hint. The loader (`attachSugarcanes` → `attachZeroFilledMetric`
 * in flags/group.js) defaults every real place (`category !== 'other'`) missing
 * from the map to 0, leaving only the non-place org flags without the field.
 * That keeps the "no data == not a place" invariant the TTT picker's no-data
 * guard leans on (a country that grows no cane is a *fair wrong guess* on a
 * "sugar cane >= 10M tonnes" cell, NOT a data gap), without bloating the JSON
 * with ~180 explicit zeros. The lens and the superlative rounds read the raw
 * sparse map instead (`createMetric`), so a superlative ranks growers, not a
 * ~180-way tie at zero. See the add-world-metric skill's "absence policy".
 *
 * Values are whole tonnes. A producer that rounds below 1 tonne, or whose latest
 * recorded value is 0 (Iraq, Lebanon, Singapore, Syria, Yemen, ... where the
 * crop has lapsed), is dropped and falls to the absence=0 default like any
 * non-grower. Sorted by code for minimal refresh diffs.
 *
 * Snapshot, not a live fetch: OWID's CSV column names aren't a stable API, so
 * the FAOSTAT figures are embedded below (the same hand-maintained-table pattern
 * as build-coffee/tea). Latest available year per country: mostly 2024, with a
 * handful of overseas territories and lapsed growers carrying their last
 * recorded year (Reunion / Guadeloupe / Martinique / French Guiana 2006, etc.),
 * all tiny and changing no ranking or tier. To refresh: re-pull
 *   https://ourworldindata.org/grapher/sugar-cane-production.csv?csvType=full
 * take each country's latest year, convert alpha-3 → our alpha-2, and update
 * RAW_TONNES + YEAR.
 *
 * See DATA_FEATURE.md "Feature EA" and the add-world-metric skill for the map.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..');
const YEAR = 2024;

/**
 * FAOSTAT sugar-cane production, tonnes, keyed by our ISO 3166-1 alpha-2 flag
 * code (via Our World in Data's FAOSTAT mirror, item 156, latest year per
 * country). Producers only: a real place absent here grows none and defaults to
 * 0 at load. Whole tonnes.
 * @type {Record<string, number>}
 */
const RAW_TONNES = {
  af: 53326, ao: 1291857, ar: 12255902, au: 29855156, bb: 64871, bd: 2933694,
  bf: 516138, bi: 139352, bj: 80553, bn: 56, bo: 11447542, br: 759662460,
  bs: 63848, bt: 281, bz: 1669432, cd: 2505252, cf: 124628, cg: 677152,
  ci: 2156598, cm: 872377, cn: 102094400, co: 31856922, cr: 4139275,
  cu: 9050600, cv: 22040, dj: 56, dm: 4908, do: 4948100, ec: 6378738,
  eg: 13314260, es: 1100, et: 997296, fj: 1332000, ga: 273073, gd: 5236,
  gf: 6967, gh: 156723, gn: 321921, gp: 787286, gt: 22907870, gw: 7008,
  gy: 320978, hn: 5753700, ht: 1539615, id: 32000000, in: 453158500,
  ir: 9151144, jm: 428896, jp: 1157310, ke: 9365300, kh: 645720, kw: 5,
  la: 1643600, lk: 696971, lr: 279690, ma: 366460, mg: 3162265, ml: 585215,
  mm: 11997881, mq: 165101, mu: 2195802, mw: 2965639, mx: 53051360, my: 16925,
  mz: 1787640, ne: 476922, ng: 1509133, ni: 6964836, np: 2760495, om: 1746,
  pa: 1850000, pe: 12038562, pf: 3572, pg: 306330, ph: 18694654, pk: 84235450,
  pr: 40000, pt: 5500, py: 6864550, re: 1882261, rw: 156259, sd: 4220463,
  sl: 83182, sn: 1307696, so: 215200, sr: 91128, sv: 7310908, sz: 5534000,
  td: 307701, th: 82435400, tt: 810000, tw: 474537, tz: 3343955, ug: 6104830,
  us: 31609950, uy: 541167, vc: 24000, ve: 3657766, vn: 11843773, vu: 1800,
  ws: 12, za: 16741000, zm: 4893718, zw: 6617424,
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
  const dropped = []; // producers that round below 1 tonne
  const unknownCode = []; // producer codes not present as a real place
  for (const [code, raw] of Object.entries(RAW_TONNES)) {
    if (!realCodes.has(code)) {
      unknownCode.push(code);
      continue;
    }
    const tonnes = Math.round(raw);
    if (tonnes < 1) {
      dropped.push(code);
      continue;
    }
    values[code] = tonnes;
  }

  // Stable, code-sorted output for minimal refresh diffs.
  const sorted = {};
  for (const code of Object.keys(values).sort()) sorted[code] = values[code];

  const metric = {
    key: 'sugarcane',
    label: 'Sugarcane production',
    unit: 'tonnes',
    // 'compact' → 759.66M / 12.26M / 1.29M tonnes of cane.
    format: 'compact',
    // Sparse: producers only, with the rest defaulted to 0 at load.
    absence: 'zero',
    source:
      `FAOSTAT (Sugar cane, item 156) via Our World in Data, latest available ` +
      `year per country (mostly ${YEAR}; a few overseas territories and lapsed ` +
      'growers carry their last recorded year). Rounded to whole tonnes',
    year: YEAR,
    values: sorted,
  };

  const outPath = join(REPO, 'flags', 'metrics', 'sugarcane.json');
  writeFileSync(outPath, JSON.stringify(metric, null, 2) + '\n', 'utf-8');

  console.log(`Wrote ${outPath}`);
  console.log(
    `  producers: ${Object.keys(sorted).length} ` +
      `(dropped <1t ${dropped.length ? dropped.join(',') : 'none'}) | ` +
      `real places ${realCodes.size} → the rest default to 0 at load`,
  );
  if (unknownCode.length) {
    console.error(
      `  producer codes not in countries.json (dropped): ${unknownCode.join(', ')}`,
    );
  }
}

main();
