/**
 * Regenerates flags/metrics/banana.json: banana production per country.
 *
 * Banana is a *sparse* world metric, the fourth crop after coffee, wine, and
 * cocoa, and the least sparse of them: bananas grow across the whole tropics, so
 * ~127 countries produce, but the ~135 non-tropical / non-producing real places
 * still grow none. Source: FAOSTAT 2024 (item 486 "Bananas", via Our World in
 * Data's mirror), producers only.
 *
 * DATA CONTRACT. Banana is *sparse* with `absence: 'zero'`, exactly like the
 * other crops. The emitted file lists producers only and carries the hint; the
 * loader (`attachBananas` -> `attachZeroFilledMetric` in group.js) defaults
 * every real place (`category !== 'other'`) missing from the map to 0, leaving
 * only the non-place org flags without the field. A country that grows no
 * bananas is a *fair wrong guess* on a "banana >= 1M tonnes" cell, NOT a data
 * gap. The lens and the superlative round read the raw sparse map instead
 * (`createMetric`), ranking producers only.
 *
 * Values are whole tonnes; a producer that rounds below 1 tonne falls to the
 * absence=0 default. Sorted by code for minimal refresh diffs.
 *
 * Snapshot, not a live fetch: OWID's CSV column names aren't a stable API, so
 * the FAOSTAT figures are embedded below (the same hand-maintained-table
 * pattern as build-cocoa.mjs). To refresh: re-pull
 *   https://ourworldindata.org/grapher/banana-production.csv?csvType=full
 * take each country's latest year, and update RAW_TONNES + YEAR. A handful of
 * minor producers (Bahrain, French Guiana, Guadeloupe, Martinique, Réunion,
 * South Korea, Uganda) have no 2024 row and carry their latest available year
 * (1990–2006); all but Uganda are tiny, and none change the top of any tier.
 *
 * See DATA_FEATURE.md "Feature DO" and the add-world-metric skill for the map.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..');
const YEAR = 2024;

/**
 * FAOSTAT banana production, tonnes, keyed by our ISO 3166-1 alpha-2 flag code
 * (via Our World in Data's FAOSTAT mirror, item 486). Producers only: a real
 * place absent here grows none and defaults to 0 at load. Predominantly 2024; a
 * few sub-2024 figures are each producer's latest available year. Raw figures,
 * rounded to whole tonnes on emit.
 * @type {Record<string, number>}
 */
const RAW_TONNES = {
  ae: 327, ag: 2.37, ao: 5213106, ar: 177081.84, au: 368735, bb: 981.37,
  bd: 813560, bf: 46922.05, bh: 710, bi: 1207926.4, bj: 20972.97, bn: 1988.43,
  bo: 301638.28, br: 7046345, bs: 10540.86, bt: 2049.66, bz: 85071.99, cd: 811021,
  cf: 57239.58, cg: 86253.57, ci: 534242.9, ck: 9.83, cm: 805352.56, cn: 11759700,
  co: 2638063.8, cr: 2630020, cu: 155957.02, cv: 3903, cy: 5870, dm: 11535.15,
  do: 2038904.6, dz: 234.77, ec: 7585653, eg: 1251943, es: 421320, et: 1190101.2,
  fj: 13388.3, fm: 2041.46, fr: 210920, ga: 17628.61, gd: 1502, gf: 3582,
  gh: 135062.73, gn: 231171.27, gp: 52250, gq: 31433.66, gr: 1090, gt: 2843486.8,
  gw: 8717.78, gy: 21136, hn: 550868.6, ht: 264881.28, id: 9260387, il: 197001,
  in: 37614360, ir: 135294.08, jm: 62997.8, jo: 58437.52, jp: 17.99, ke: 2061285,
  kh: 374922.78, ki: 7411.62, km: 80028.66, kr: 27345, la: 766200, lb: 40600,
  lc: 2843.7, lr: 142551.39, ma: 310110, mg: 399939.78, ml: 629819.75, mq: 245798,
  mu: 10843.1, mv: 686.52, mw: 1131259.4, mx: 2670291, my: 335443.97, mz: 387740,
  nc: 2211.17, ng: 6907142.5, ni: 90616.08, np: 383285, nu: 82.28, om: 19038,
  pa: 387690.1, pe: 2343310.5, pf: 283.48, pg: 1272779.2, ph: 5641130, pk: 311166,
  pr: 107393.28, ps: 3379, pt: 30230, py: 88870.53, re: 10000, rw: 2437236,
  sa: 34585.31, sb: 320.13, sc: 2016.39, sd: 952279.2, sn: 38625, so: 23553.62,
  sr: 3586.26, st: 5374.11, sv: 20053.72, sy: 2351, sz: 30362.68, tg: 25513.31,
  th: 1298997.8, tl: 559.59, to: 817.1, tr: 875000, tt: 3245.59, tv: 293.52,
  tw: 341390.22, tz: 3269969.5, ug: 560000, us: 3560.59, vc: 59514.64, ve: 533896.06,
  vn: 2640250, vu: 17870.85, ws: 21853.44, ye: 135447.6, za: 430924.97, zm: 683.84,
  zw: 325400,
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
    key: 'banana',
    label: 'Banana production',
    unit: 'tonnes',
    // 'compact' -> 37.6M / 813.56K / 1.5K banana tonnes.
    format: 'compact',
    // Sparse: producers only, with the rest defaulted to 0 at load.
    absence: 'zero',
    source:
      `FAOSTAT ${YEAR} (bananas, item 486) via Our World in Data; ` +
      'a few minor producers (Bahrain, French Guiana, Guadeloupe, Martinique, ' +
      'Réunion, South Korea, Uganda) carry their latest available year ' +
      '(1990–2006). Rounded to whole tonnes',
    year: YEAR,
    values: sorted,
  };

  const outPath = join(REPO, 'flags', 'metrics', 'banana.json');
  writeFileSync(outPath, JSON.stringify(metric, null, 2) + '\n', 'utf-8');

  console.log(`Wrote ${outPath}`);
  console.log(
    `  producers: ${Object.keys(sorted).length} ` +
      `(dropped <1t ${dropped.length ? dropped.join(',') : 'none'}) | ` +
      `real places ${realCodes.size} -> the rest default to 0 at load`,
  );
  if (unknownCode.length) {
    console.error(
      `  producer codes not in countries.json (dropped): ${unknownCode.join(', ')}`,
    );
  }
}

main();
