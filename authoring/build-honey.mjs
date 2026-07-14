/**
 * Regenerates flags/metrics/honey.json: natural honey production per country.
 *
 * Honey is a *sparse* world metric and the first from the **beekeeping** corner
 * (an animal product, but not a per-capita livestock count like the sheep/cattle
 * metrics: this is total tonnes of honey harvested per year, world ~1.8M tonnes).
 * China alone makes about a quarter of all the honey on Earth (~462K tonnes),
 * roughly four times the runner-up, which is the metric's "wow".
 *
 * COVERAGE: FAOSTAT lists ~100 producing countries with a long thin tail; this
 * snapshot pins the top 55 (every producer above ~3,300 tonnes). Every real place
 * below that, and every non-producer, falls to the absence=0 default like a true
 * non-producer. The tail it drops is all under the lowest filter tier (>=10K
 * tonnes), so the threshold tiers are exact; only the deep lens ranking loses a
 * few sub-3K producers, an acceptable thinness for a hobby quiz.
 *
 * DATA CONTRACT: honey is *sparse* with `absence: 'zero'`, exactly like coffee.
 * The emitted file lists the itemized producers only, and carries an
 * `absence: 'zero'` hint. The loader (`attachHoneys` -> `attachZeroFilledMetric`
 * in flags/group.js) defaults every real place (`category !== 'other'`) missing
 * from the map to 0, leaving only the non-place org flags without the field. That
 * keeps the "no data == not a place" invariant the TTT picker's no-data guard
 * leans on (a country that harvests no honey is a *fair wrong guess* on a
 * "honey >= 50K tonnes" cell, NOT a data gap). The lens and the superlative
 * rounds read the raw sparse map instead (`createMetric`), so a superlative ranks
 * producers, not a ~200-way tie at zero. See the add-world-metric skill's
 * "absence policy".
 *
 * Snapshot, not a live fetch. Figures are FAOSTAT 2022 natural honey production
 * (item "Honey, natural", tonnes), transcribed below. To refresh: re-pull
 *   https://www.fao.org/faostat/en/#data/QCL  (Crops and livestock products)
 * and update RAW_TONNES + YEAR.
 *
 * See DATA_FEATURE.md "Feature EG" and the add-world-metric skill for the map.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..');
const YEAR = 2022;

/**
 * FAOSTAT 2022 natural honey production, tonnes, keyed by our ISO 3166-1 alpha-2
 * flag code. The top 55 producers (every one above ~3,300 tonnes); every other
 * real place harvests little/none and defaults to 0 at load. Whole tonnes.
 * @type {Record<string, number>}
 */
const RAW_TONNES = {
  cn: 461900, // China
  tr: 118297, // Türkiye
  ir: 79535, // Iran
  in: 74204, // India
  ar: 70437, // Argentina
  ru: 67014, // Russia
  mx: 64320, // Mexico
  ua: 63079, // Ukraine
  br: 60966, // Brazil
  us: 56849, // United States
  ca: 33745, // Canada
  tz: 31345, // Tanzania
  kr: 29951, // South Korea
  ro: 29760, // Romania
  vn: 23624, // Vietnam
  ao: 23457, // Angola
  nz: 22000, // New Zealand
  fr: 20019, // France
  et: 17507, // Ethiopia
  cf: 17399, // Central African Republic
  ke: 17000, // Kenya
  uz: 14700, // Uzbekistan
  rs: 14228, // Serbia
  tw: 12207, // Taiwan
  cl: 12019, // Chile
  th: 11795, // Thailand
  pt: 11465, // Portugal
  au: 10938, // Australia
  gb: 9923, // United Kingdom
  cu: 9200, // Cuba
  uy: 7906, // Uruguay
  cz: 7771, // Czechia
  ma: 7500, // Morocco
  az: 7446, // Azerbaijan
  co: 7000, // Colombia
  rw: 6183, // Rwanda
  lt: 6017, // Lithuania
  gt: 6002, // Guatemala
  dz: 5617, // Algeria
  al: 5391, // Albania
  np: 5168, // Nepal
  cm: 4757, // Cameroon
  tj: 4603, // Tajikistan
  il: 4500, // Israel
  pk: 4455, // Pakistan
  ch: 4441, // Switzerland
  eg: 4440, // Egypt
  md: 4409, // Moldova
  mg: 3980, // Madagascar
  kz: 3911, // Kazakhstan
  sn: 3834, // Senegal
  tn: 3665, // Tunisia
  sy: 3532, // Syria
  mm: 3495, // Myanmar
  fi: 3300, // Finland
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
    key: 'honey',
    label: 'Honey production',
    unit: 'tonnes',
    // 'compact' -> 462K / 100K / 10K at this scale.
    format: 'compact',
    // Sparse: producers only, with the rest defaulted to 0 at load.
    absence: 'zero',
    source:
      `FAOSTAT ${YEAR} (natural honey production, item "Honey, natural", ` +
      'tonnes). Top 55 producers itemized (all above ~3,300 tonnes); the thin ' +
      'sub-3K FAO tail and every non-producer fall to the absence=0 default. ' +
      'Whole tonnes',
    year: YEAR,
    values: sorted,
  };

  const outPath = join(REPO, 'flags', 'metrics', 'honey.json');
  writeFileSync(outPath, JSON.stringify(metric, null, 2) + '\n', 'utf-8');

  console.log(`Wrote ${outPath}`);
  console.log(
    `  producers: ${Object.keys(sorted).length} (FAO top 55) | ` +
      `real places ${realCodes.size} → the rest default to 0 at load`,
  );
  if (unknownCode.length) {
    console.error(
      `  producer codes not in countries.json (dropped): ${unknownCode.join(', ')}`,
    );
  }
}

main();
