/**
 * Regenerates flags/metrics/coffee.json — green-coffee production per country.
 *
 * Coffee is the first *sparse* world metric. Unlike population / area / GDP,
 * where every real place carries a real value, only ~80 countries grow coffee
 * at all. So the source table (FAOSTAT 2023, item 656 "Coffee, green", via Our
 * World in Data's mirror) lists producers only, and every real place NOT in the
 * table grows none.
 *
 * DATA CONTRACT — coffee is *sparse* with `absence: 'zero'`. The emitted file
 * lists producers only, and carries an `absence: 'zero'` hint. The loader
 * (`attachCoffees` → `attachZeroFilledMetric` in flags/group.js) defaults every
 * real place (`category !== 'other'`) missing from the map to 0, leaving only
 * the non-place org flags without the field. That keeps the "no data == not a
 * place" invariant the TTT picker's no-data guard leans on (a country that
 * grows no coffee is a *fair wrong guess* on a "coffee >= 1M tonnes" cell, NOT a
 * data gap), without bloating the JSON with ~180 explicit zeros. The lens and
 * the superlative rounds read the raw sparse map instead (`createMetric`), so
 * "smallest producer" ranks the smallest *grower*, not a 180-way tie at zero.
 * See the add-world-metric skill's "absence policy" section.
 *
 * Values are whole tonnes (fractional tonnes are noise at this scale); a
 * producer that rounds below 1 tonne (only the Cook Islands, at 0.36 t) is
 * dropped and falls to the absence=0 default like any non-grower. Sorted by
 * code for minimal refresh diffs.
 *
 * Snapshot, not a live fetch: OWID's CSV column names aren't a stable API, so
 * the FAOSTAT figures are embedded below (the same hand-maintained-table pattern
 * as build-gdp.mjs's FILLS). To refresh: re-pull
 *   https://ourworldindata.org/grapher/coffee-bean-production.csv?csvType=full
 * take the latest year's country rows, and update RAW_TONNES_2023 + YEAR.
 *
 * See DATA_FEATURE.md "Feature DK" and the add-world-metric skill for the map.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..');
const YEAR = 2023;

/**
 * FAOSTAT 2023 green-coffee production, tonnes, keyed by our ISO 3166-1 alpha-2
 * flag code (via Our World in Data's FAOSTAT mirror, item 656). Producers only:
 * a real place absent here grows none and defaults to 0 at load. Raw figures,
 * rounded to whole tonnes on emit.
 * @type {Record<string, number>}
 */
const RAW_TONNES_2023 = {
  ao: 6229, bz: 89.56, bj: 55.09, bo: 23579.45, br: 3348510, bi: 8400,
  kh: 362.22, cm: 31009.61, cv: 17.17, cf: 316108, cn: 108000, co: 680857.7,
  km: 141.73, cg: 3180.96, ck: 0.36, cr: 80270.33, ci: 46975, cu: 6000,
  cd: 62405.41, dm: 362.3, do: 27397.26, tl: 9637.22, ec: 5584.19,
  sv: 32570.72, gq: 4055.45, et: 559400, fj: 14.25, pf: 21.91, ga: 103.9,
  gh: 736, gt: 212848, gn: 200000, gy: 133, ht: 5021.3, hn: 384361.03,
  in: 360500, id: 758725, jm: 8152, ke: 48700, la: 183895, lr: 654.58,
  mg: 49340.52, mw: 11000, my: 3910.09, mx: 194940, mz: 803.15, mm: 8481.74,
  np: 394.4, nc: 1.18, ni: 143336.66, ng: 1808.01, pa: 6445.13, pg: 58800,
  py: 361.58, pe: 366940.03, ph: 60000, pr: 1468.77, rw: 27104.4, vc: 189.78,
  ws: 11.77, st: 7.31, sa: 763.34, sl: 2333.16, lk: 4750, sr: 6.22, tw: 956,
  tz: 62917, th: 16690, tg: 22619.45, to: 15.21, tt: 753.98, ug: 468000,
  us: 3121, vu: 14.49, ve: 58625, vn: 1956782.5, ye: 24640, zm: 8786.74,
  zw: 665.49,
};

/**
 * FAOSTAT figures that are materially wrong (stale imputations that would rank
 * a war-collapsed sector among the world's top producers) replaced by a
 * defensible recent estimate. Same discipline as build-gdp.mjs's OVERRIDES:
 * tiny, evidence-backed, cited. Applied over RAW_TONNES_2023.
 * @type {Record<string, number>}
 */
const OVERRIDES = {
  // FAOSTAT's 316,108 t would rank CAR ~10th worldwide. The ICO recorded 45,940
  // 60-kg bags for CAR in 2023 (~2,756 t); the sector collapsed with the civil
  // war (peak was ~20,000 t in 1988/89). Rounded to a whole-thousand estimate.
  cf: 2800, // Central African Republic
  // FAOSTAT carries a flat 200,000 t for Guinea (a constant round number across
  // years — the hallmark of an imputation). Trade data puts Guinea at ~0.1% of
  // world coffee exports, i.e. an order of magnitude near 10,000 t, not 200,000.
  gn: 10000, // Guinea
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
  let overridden = 0;
  for (const [code, raw] of Object.entries(RAW_TONNES_2023)) {
    if (!realCodes.has(code)) {
      unknownCode.push(code);
      continue;
    }
    const tonnes = code in OVERRIDES ? OVERRIDES[code] : Math.round(raw);
    if (code in OVERRIDES) overridden++;
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
    key: 'coffee',
    label: 'Coffee production',
    unit: 'tonnes',
    // 'compact' → 3.35M / 680.86K / 2.80K green-coffee tonnes.
    format: 'compact',
    // Sparse: producers only, with the rest defaulted to 0 at load.
    absence: 'zero',
    source:
      `FAOSTAT ${YEAR} (green coffee, item 656) via Our World in Data; ` +
      'Central African Republic & Guinea corrected from ICO / trade-share ' +
      'evidence (stale FAOSTAT imputations). Rounded to whole tonnes',
    year: YEAR,
    values: sorted,
  };

  const outPath = join(REPO, 'flags', 'metrics', 'coffee.json');
  writeFileSync(outPath, JSON.stringify(metric, null, 2) + '\n', 'utf-8');

  console.log(`Wrote ${outPath}`);
  console.log(
    `  producers: ${Object.keys(sorted).length} ` +
      `(overrides ${overridden}, dropped <1t ${dropped.length ? dropped.join(',') : 'none'}) | ` +
      `real places ${realCodes.size} → the rest default to 0 at load`,
  );
  if (unknownCode.length) {
    console.error(
      `  producer codes not in countries.json (dropped): ${unknownCode.join(', ')}`,
    );
  }
}

main();
