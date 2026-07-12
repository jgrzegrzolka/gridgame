/**
 * Regenerates flags/metrics/cocoa.json: cocoa-bean production per country.
 *
 * Cocoa is a *sparse* world metric, the third after coffee and wine. Only ~60
 * countries grow cocoa at all (the tropical belt, West Africa dominant), so the
 * source table (FAOSTAT 2024, item 661 "Cocoa beans", via Our World in Data's
 * mirror) lists producers only, and every real place NOT in the table grows
 * none.
 *
 * DATA CONTRACT. Cocoa is *sparse* with `absence: 'zero'`, exactly like coffee
 * and wine. The emitted file lists growers only and carries an `absence: 'zero'`
 * hint; the loader (`attachCocoas` -> `attachZeroFilledMetric` in group.js)
 * defaults every real place (`category !== 'other'`) missing from the map to 0,
 * leaving only the non-place org flags without the field. That keeps the "no
 * data == not a place" invariant the TTT no-data guard leans on (a country that
 * grows no cocoa is a *fair wrong guess* on a "cocoa >= 100K tonnes" cell, NOT a
 * data gap), without bloating the JSON with ~180 explicit zeros. The lens and
 * the superlative round read the raw sparse map instead (`createMetric`), so
 * "smallest grower" ranks the smallest *grower*, not a 180-way tie at zero.
 * See the add-world-metric skill's "absence policy" section.
 *
 * Values are whole tonnes (fractional tonnes are noise at this scale); a grower
 * that rounds below 1 tonne falls to the absence=0 default. Sorted by code for
 * minimal refresh diffs.
 *
 * Snapshot, not a live fetch: OWID's CSV column names aren't a stable API, so
 * the FAOSTAT figures are embedded below (the same hand-maintained-table
 * pattern as build-coffee.mjs / build-wine.mjs). To refresh: re-pull
 *   https://ourworldindata.org/grapher/cocoa-bean-production.csv?csvType=full
 * take each country's latest year, and update RAW_TONNES + YEAR. Two minor
 * growers (Benin, Nicaragua) have no 2024 row and carry their latest available
 * year (2010 / 2023); both are tiny and change no ranking or threshold tier.
 *
 * See DATA_FEATURE.md "Feature DN" and the add-world-metric skill for the map.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..');
const YEAR = 2024;

/**
 * FAOSTAT cocoa-bean production, tonnes, keyed by our ISO 3166-1 alpha-2 flag
 * code (via Our World in Data's FAOSTAT mirror, item 661). Growers only: a real
 * place absent here grows none and defaults to 0 at load. Predominantly 2024;
 * the two sub-2024 figures (bj/ni) are each grower's latest available year. Raw
 * figures, rounded to whole tonnes on emit.
 * @type {Record<string, number>}
 */
const RAW_TONNES = {
  ao: 464.93, bj: 100, bo: 5825.18, br: 297509, bz: 225, cd: 50000,
  cf: 135.72, cg: 15000, ci: 1890442, cm: 320000, co: 67678, cr: 1000,
  cu: 1463.13, dm: 1000, do: 57461, ec: 403698.84, fj: 215.9, fm: 31.08,
  ga: 100, gd: 203, gh: 530000, gn: 24221.57, gq: 600, gt: 11700.7,
  gy: 487.74, hn: 2000, ht: 3000, id: 632702, in: 30388, jm: 201,
  km: 43.68, lc: 16.6, lk: 1150, lr: 30000, mg: 21000, mx: 28447.64,
  my: 445, ng: 350000, ni: 9317.11, pa: 291, pe: 157252.5, pg: 45000,
  ph: 10843.53, sb: 4200, sl: 93749.6, sr: 4.59, st: 4000, sv: 370.06,
  tg: 25000, th: 122.6, tl: 177.11, tt: 231, tz: 15000, ug: 55000,
  vc: 230.92, ve: 29383.27, vn: 1500, vu: 1500, ws: 482.72,
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
  const dropped = []; // growers that round below 1 tonne
  const unknownCode = []; // grower codes not present as a real place
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
    key: 'cocoa',
    label: 'Cocoa production',
    unit: 'tonnes',
    // 'compact' -> 1.89M / 530K / 1.46K cocoa tonnes.
    format: 'compact',
    // Sparse: growers only, with the rest defaulted to 0 at load.
    absence: 'zero',
    source:
      `FAOSTAT ${YEAR} (cocoa beans, item 661) via Our World in Data; ` +
      'two minor growers (Benin, Nicaragua) carry their latest available ' +
      'year (2010 / 2023). Rounded to whole tonnes',
    year: YEAR,
    values: sorted,
  };

  const outPath = join(REPO, 'flags', 'metrics', 'cocoa.json');
  writeFileSync(outPath, JSON.stringify(metric, null, 2) + '\n', 'utf-8');

  console.log(`Wrote ${outPath}`);
  console.log(
    `  growers: ${Object.keys(sorted).length} ` +
      `(dropped <1t ${dropped.length ? dropped.join(',') : 'none'}) | ` +
      `real places ${realCodes.size} -> the rest default to 0 at load`,
  );
  if (unknownCode.length) {
    console.error(
      `  grower codes not in countries.json (dropped): ${unknownCode.join(', ')}`,
    );
  }
}

main();
