/**
 * Regenerates flags/metrics/gold.json: gold mine production per country.
 *
 * Gold is a *sparse* world metric and the first from the **mining** domain
 * (distinct from the crops and from the oil/coal energy pair). It is measured in
 * whole tonnes of primary mine production (newly mined gold, excluding recycled)
 * per year, world ~3,300 tonnes.
 *
 * COVERAGE: the authoritative source, the USGS Mineral Commodity Summaries,
 * **itemizes only the major producers** (the 17 below, ~76% of world output) and
 * lumps everyone else into a single "Other countries" line (~780 t across ~60
 * small producers, none broken out). So unlike the crops (where FAOSTAT lists
 * ~50-100 named producers), gold's producer set is deliberately the top 17. The
 * ~60 minor producers not itemized by USGS fall to the absence=0 default like a
 * true non-producer. That is a known thinness, documented here and in Feature
 * EB; a future refresh from the USGS Minerals Yearbook country table could add
 * the tail if the lens ever wants it.
 *
 * DATA CONTRACT: gold is *sparse* with `absence: 'zero'`, exactly like coffee.
 * The emitted file lists producers only, and carries an `absence: 'zero'` hint.
 * The loader (`attachGolds` → `attachZeroFilledMetric` in flags/group.js)
 * defaults every real place (`category !== 'other'`) missing from the map to 0,
 * leaving only the non-place org flags without the field. That keeps the "no
 * data == not a place" invariant the TTT picker's no-data guard leans on (a
 * country that mines no gold is a *fair wrong guess* on a "gold >= 100 tonnes"
 * cell, NOT a data gap). The lens and the superlative rounds read the raw sparse
 * map instead (`createMetric`), so a superlative ranks producers, not a ~180-way
 * tie at zero. See the add-world-metric skill's "absence policy".
 *
 * Snapshot, not a live fetch. Figures are USGS Mineral Commodity Summaries 2025
 * (2024 mine production, rounded tonnes), transcribed below. To refresh: re-pull
 *   https://pubs.usgs.gov/periodicals/mcs2025/mcs2025-gold.pdf
 * and update RAW_TONNES + YEAR.
 *
 * See DATA_FEATURE.md "Feature EB" and the add-world-metric skill for the map.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..');
const YEAR = 2024;

/**
 * USGS 2024 gold mine production, tonnes, keyed by our ISO 3166-1 alpha-2 flag
 * code. The USGS-itemized major producers only (~76% of world output); every
 * other real place mines little/none and defaults to 0 at load. Whole tonnes.
 * @type {Record<string, number>}
 */
const RAW_TONNES = {
  cn: 380, // China
  ru: 310, // Russia
  au: 290, // Australia
  ca: 200, // Canada
  us: 160, // United States
  kz: 130, // Kazakhstan
  mx: 130, // Mexico
  gh: 130, // Ghana
  uz: 120, // Uzbekistan
  za: 100, // South Africa
  id: 100, // Indonesia
  pe: 100, // Peru
  br: 70, // Brazil
  ml: 70, // Mali
  co: 60, // Colombia
  tz: 60, // Tanzania
  bf: 60, // Burkina Faso
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
    key: 'gold',
    label: 'Gold production',
    unit: 'tonnes',
    // 'compact' → plain integers at this scale (380 / 130 / 60 tonnes).
    format: 'compact',
    // Sparse: producers only, with the rest defaulted to 0 at load.
    absence: 'zero',
    source:
      `USGS Mineral Commodity Summaries 2025 (${YEAR} gold mine production, ` +
      'primary/newly-mined only). USGS itemizes the major producers (~76% of ' +
      'world output); ~60 minor producers it lumps as "Other countries" fall ' +
      'to the absence=0 default. Whole tonnes',
    year: YEAR,
    values: sorted,
  };

  const outPath = join(REPO, 'flags', 'metrics', 'gold.json');
  writeFileSync(outPath, JSON.stringify(metric, null, 2) + '\n', 'utf-8');

  console.log(`Wrote ${outPath}`);
  console.log(
    `  producers: ${Object.keys(sorted).length} (USGS-itemized majors) | ` +
      `real places ${realCodes.size} → the rest default to 0 at load`,
  );
  if (unknownCode.length) {
    console.error(
      `  producer codes not in countries.json (dropped): ${unknownCode.join(', ')}`,
    );
  }
}

main();
