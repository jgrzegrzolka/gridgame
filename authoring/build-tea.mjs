/**
 * Regenerates flags/metrics/tea.json: tea-leaf production per country.
 *
 * Tea is a *sparse* world metric, coffee's twin. Only ~46 countries grow tea at
 * all, so the source table (FAOSTAT "Tea leaves", item 667, via its public
 * mirror) lists producers only, and every real place NOT in the table grows
 * none.
 *
 * WHICH SERIES: FAOSTAT's official tea production item is "Tea leaves", the
 * green (fresh) leaf harvested, world total ~29.8M tonnes (2022). That is the
 * single complete FAOSTAT production series, so it is what we use (the same
 * discipline as coffee, which took FAOSTAT's own green-coffee item). It is NOT
 * the smaller "made tea" figure (~7M tonnes world) national boards report after
 * processing; green leaf runs ~4-5× made tea. The rank order is the same either
 * way (China #1, then India, Kenya, Sri Lanka, Turkey, Vietnam), so gameplay
 * (superlatives, thresholds, lens ranks) is unaffected by the choice.
 *
 * DATA CONTRACT: tea is *sparse* with `absence: 'zero'`, exactly like coffee.
 * The emitted file lists producers only, and carries an `absence: 'zero'` hint.
 * The loader (`attachTeas` → `attachZeroFilledMetric` in flags/group.js)
 * defaults every real place (`category !== 'other'`) missing from the map to 0,
 * leaving only the non-place org flags without the field. That keeps the "no
 * data == not a place" invariant the TTT picker's no-data guard leans on (a
 * country that grows no tea is a *fair wrong guess* on a "tea >= 1M tonnes"
 * cell, NOT a data gap), without bloating the JSON with ~180 explicit zeros. The
 * lens and the superlative rounds read the raw sparse map instead
 * (`createMetric`), so "smallest producer" ranks the smallest *grower*, not a
 * 180-way tie at zero. See the add-world-metric skill's "absence policy".
 *
 * Values are whole tonnes (fractional tonnes are noise at this scale); a
 * producer that rounds below 1 tonne would be dropped and fall to the absence=0
 * default (none do here). Sorted by code for minimal refresh diffs.
 *
 * Snapshot, not a live fetch: the mirror's CSV column names aren't a stable API,
 * so the FAOSTAT figures are embedded below (the same hand-maintained-table
 * pattern as build-coffee.mjs). To refresh: re-pull FAOSTAT QCL item 667
 * "Tea leaves", element Production, latest year, and update RAW_TONNES + YEAR.
 *
 * See DATA_FEATURE.md "Feature DN" and the add-world-metric skill for the map.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..');
const YEAR = 2023;

/**
 * FAOSTAT tea-leaf production (item 667, green leaf), tonnes, keyed by our ISO
 * 3166-1 alpha-2 flag code. Producers only: a real place absent here grows none
 * and defaults to 0 at load. Raw figures, rounded to whole tonnes on emit.
 * @type {Record<string, number>}
 */
const RAW_TONNES = {
  cn: 13768883, in: 6343165.25, ke: 2577800, lk: 1433543.04, tr: 1356556,
  vn: 1125064.65, id: 647000, bd: 406000, ug: 390493.99, ar: 369022.49,
  jp: 303166.34, mw: 246220.87, rw: 165003.49, np: 129276.22, mm: 118087.22,
  th: 106347, tz: 103000, ir: 81951.7, zw: 66219.27, bi: 62914.02,
  et: 61449.28, la: 16399.46, my: 15867.92, tw: 11883, mz: 6801, mu: 6762,
  cm: 5591.06, pg: 5497.01, cd: 2907.2, kr: 2378.52, ge: 2300, br: 2011,
  pe: 1944.22, za: 1810.85, ec: 1572.42, bo: 1206.46, az: 1123.8, zm: 969.54,
  sv: 674.03, gt: 539.92, mg: 400.59, co: 225.75, me: 100, ml: 92.37,
  ru: 82.03, pt: 78.27,
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
    key: 'tea',
    label: 'Tea production',
    unit: 'tonnes',
    // 'compact' → 13.77M / 1.43M / 129.28K green-tea-leaf tonnes.
    format: 'compact',
    // Sparse: producers only, with the rest defaulted to 0 at load.
    absence: 'zero',
    source:
      `FAOSTAT ${YEAR} (Tea leaves, item 667, green leaf). The official FAO ` +
      'tea production series (green harvested leaf, ~29.8M t world), not the ' +
      'smaller processed "made tea" figure. Rounded to whole tonnes',
    year: YEAR,
    values: sorted,
  };

  const outPath = join(REPO, 'flags', 'metrics', 'tea.json');
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
