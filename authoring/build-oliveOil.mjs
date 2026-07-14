/**
 * Regenerates flags/metrics/oliveOil.json: olive oil production per country.
 *
 * Olive oil is a *sparse* world metric from the **crop** domain (a sibling of
 * coffee / wine / cocoa / banana / tea / sugarcane), measured in whole tonnes of
 * oil produced per year, world ~2.7 million tonnes. It is one of the most
 * geographically concentrated crops: the Mediterranean basin (Spain, Italy,
 * Greece, Türkiye, Tunisia, Morocco, Syria, Portugal) makes the overwhelming
 * majority, which is exactly what makes its superlative satisfying.
 *
 * COVERAGE: FAOSTAT lists ~28 producing countries; every real place not among
 * them makes no olive oil and falls to the absence=0 default, like a true
 * non-grower. Output swings a lot year to year (a drought year can halve Spain's
 * harvest), so this snapshot pins a single FAO year rather than a rolling mix.
 *
 * DATA CONTRACT: olive oil is *sparse* with `absence: 'zero'`, exactly like
 * coffee. The emitted file lists producers only, and carries an `absence: 'zero'`
 * hint. The loader (`attachOliveOils` → `attachZeroFilledMetric` in
 * flags/group.js) defaults every real place (`category !== 'other'`) missing from
 * the map to 0, leaving only the non-place org flags without the field. That
 * keeps the "no data == not a place" invariant the TTT picker's no-data guard
 * leans on (a country that makes no olive oil is a *fair wrong guess* on an
 * "olive oil >= 100K tonnes" cell, NOT a data gap). The lens and the superlative
 * rounds read the raw sparse map instead (`createMetric`), so a superlative ranks
 * producers, not a ~170-way tie at zero. See the add-world-metric skill's
 * "absence policy".
 *
 * Snapshot, not a live fetch. Figures are FAOSTAT 2022 olive oil production
 * (item "Oil, olive, virgin", tonnes), transcribed below. To refresh: re-pull
 *   https://www.fao.org/faostat/en/#data/QCL  (Crops and livestock products)
 * and update RAW_TONNES + YEAR.
 *
 * See DATA_FEATURE.md "Feature EC" and the add-world-metric skill for the map.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..');
const YEAR = 2022;

/**
 * FAOSTAT 2022 olive oil production, tonnes, keyed by our ISO 3166-1 alpha-2
 * flag code. Every FAO-listed producer; every other real place makes none and
 * defaults to 0 at load. Whole tonnes.
 * @type {Record<string, number>}
 */
const RAW_TONNES = {
  es: 665709, // Spain
  it: 331038, // Italy
  gr: 313300, // Greece
  tr: 302400, // Türkiye
  tn: 235200, // Tunisia
  sy: 189423, // Syria
  ma: 181500, // Morocco
  pt: 137753, // Portugal
  dz: 88200, // Algeria
  eg: 45700, // Egypt
  ps: 36000, // State of Palestine
  ar: 33000, // Argentina
  jo: 25421, // Jordan
  cl: 21300, // Chile
  au: 20000, // Australia
  lb: 20000, // Lebanon
  ly: 18000, // Libya
  us: 16000, // United States
  al: 15500, // Albania
  il: 14000, // Israel
  ir: 7006, // Iran
  fr: 5100, // France
  cy: 4700, // Cyprus
  hr: 3400, // Croatia
  uy: 1544, // Uruguay
  si: 400, // Slovenia
  me: 23, // Montenegro
  mt: 10, // Malta
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
  const unknownCode = []; // producer codes not present as a real place
  for (const [code, raw] of Object.entries(RAW_TONNES)) {
    if (!realCodes.has(code)) {
      unknownCode.push(code);
      continue;
    }
    values[code] = Math.round(raw);
  }

  // Stable, code-sorted output for minimal refresh diffs.
  const sorted = {};
  for (const code of Object.keys(values).sort()) sorted[code] = values[code];

  const metric = {
    key: 'oliveOil',
    label: 'Olive oil production',
    unit: 'tonnes',
    // 'compact' → 665K / 100K / 10K at this scale.
    format: 'compact',
    // Sparse: producers only, with the rest defaulted to 0 at load.
    absence: 'zero',
    source:
      `FAOSTAT ${YEAR} (olive oil production, item "Oil, olive, virgin", ` +
      'tonnes). FAO lists ~28 producing countries; every other real place makes ' +
      'none and falls to the absence=0 default. Whole tonnes',
    year: YEAR,
    values: sorted,
  };

  const outPath = join(REPO, 'flags', 'metrics', 'oliveOil.json');
  writeFileSync(outPath, JSON.stringify(metric, null, 2) + '\n', 'utf-8');

  console.log(`Wrote ${outPath}`);
  console.log(
    `  producers: ${Object.keys(sorted).length} (FAO-listed) | ` +
      `real places ${realCodes.size} → the rest default to 0 at load`,
  );
  if (unknownCode.length) {
    console.error(
      `  producer codes not in countries.json (dropped): ${unknownCode.join(', ')}`,
    );
  }
}

main();
