/**
 * Regenerates flags/metrics/apple.json: apple production per country.
 *
 * Apple is a *sparse* world metric, the fifth crop after coffee, wine, cocoa,
 * and banana, and the temperate mirror of them: apples are a cool-climate fruit,
 * so ~95 countries produce (Europe, Central Asia, China, the Americas' temperate
 * belts), while the whole tropics grow none. Source: FAOSTAT 2024 (item 515
 * "Apples", via Our World in Data's mirror), producers only.
 *
 * DATA CONTRACT. Apple is *sparse* with `absence: 'zero'`, exactly like the
 * other crops. The emitted file lists producers only and carries the hint; the
 * loader (`attachApples` -> `attachZeroFilledMetric` in group.js) defaults every
 * real place (`category !== 'other'`) missing from the map to 0, leaving only
 * the non-place org flags without the field. A country that grows no apples is a
 * *fair wrong guess* on an "apple >= 100K tonnes" cell, NOT a data gap. The lens
 * and the superlative round read the raw sparse map instead (`createMetric`),
 * ranking producers only.
 *
 * Values are whole tonnes; a producer that rounds below 1 tonne (Malta, 0)
 * falls to the absence=0 default. Sorted by code for minimal refresh diffs.
 *
 * Snapshot, not a live fetch: OWID's CSV column names aren't a stable API, so
 * the FAOSTAT figures are embedded below (the same hand-maintained-table
 * pattern as build-banana.mjs / build-cocoa.mjs). To refresh: re-pull
 *   https://ourworldindata.org/grapher/apple-production.csv?csvType=full
 * take each country's latest year, and update RAW_TONNES + YEAR. Two minor
 * producers (Palestine, Réunion) have no 2024 row and carry their latest
 * available year (2022 / 2006); both are tiny and change no ranking or tier.
 *
 * See DATA_FEATURE.md "Feature DR" and the add-world-metric skill for the map.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..');
const YEAR = 2024;

/**
 * FAOSTAT apple production, tonnes, keyed by our ISO 3166-1 alpha-2 flag code
 * (via Our World in Data's FAOSTAT mirror, item 515). Producers only: a real
 * place absent here grows none and defaults to 0 at load. Predominantly 2024;
 * the two sub-2024 figures (ps/re) are each producer's latest available year.
 * Raw figures, rounded to whole tonnes on emit.
 * @type {Record<string, number>}
 */
const RAW_TONNES = {
  af: 333837.84, al: 100455.03, am: 95485, ar: 494062.75, at: 175560, au: 293731,
  az: 300023.22, ba: 191900, be: 160380, bg: 36830, bo: 2781.96, br: 997470,
  bt: 2102.14, by: 336700, ca: 386368, ch: 213926, cl: 1299064.5, cn: 51285100,
  co: 13779.98, cy: 2830, cz: 37490, de: 871990, dk: 18510, dz: 591697.8,
  ec: 7196.71, ee: 2160, eg: 959100.75, es: 545080, fi: 9170, fr: 1964030,
  gb: 408046.88, gd: 214.9, ge: 76400, gr: 263210, gt: 25473.19, hn: 194.33,
  hr: 67930, hu: 376680, ie: 21990, il: 80006, in: 2625899, iq: 76004.77,
  ir: 2346928.8, it: 2398540, jo: 16314.39, jp: 658377.3, ke: 744, kg: 139656.38,
  kp: 801601.7, kr: 460088, kz: 225684, lb: 194000, lt: 61390, lu: 1470,
  lv: 14500, ly: 5813.55, ma: 852161.4, md: 404595, me: 8717.3, mg: 7209.19,
  mk: 127696, mt: 0, mw: 2947.8, mx: 779723.75, nl: 194000, no: 20100,
  np: 54506, nz: 575214.3, pe: 115945.32, pk: 854371.75, pl: 3384500, ps: 777.88,
  pt: 313210, py: 673.65, re: 70, ro: 487140, rs: 389195.53, ru: 2014405.6,
  se: 30900, si: 50650, sk: 33650, sv: 44628.62, sy: 184814, tj: 277717,
  tm: 65524.74, tn: 140388.44, tr: 4420185, tw: 1250, ua: 1150900, us: 4922840,
  uy: 43844.44, uz: 1482331.5, vc: 1679.42, ye: 31847.45, za: 1327544.9, zw: 6583,
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
    key: 'apple',
    label: 'Apple production',
    unit: 'tonnes',
    // 'compact' -> 51.3M / 4.92M / 408K apple tonnes.
    format: 'compact',
    // Sparse: producers only, with the rest defaulted to 0 at load.
    absence: 'zero',
    source:
      `FAOSTAT ${YEAR} (apples, item 515) via Our World in Data; ` +
      'two minor producers (Palestine, Réunion) carry their latest available ' +
      'year (2022 / 2006). Rounded to whole tonnes',
    year: YEAR,
    values: sorted,
  };

  const outPath = join(REPO, 'flags', 'metrics', 'apple.json');
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
