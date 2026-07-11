/**
 * Regenerates flags/metrics/density.json from the population + area metrics.
 *
 * Population density (people per km²) is a *derived* metric: unlike population
 * and area it has no external source. For every real place present in BOTH
 * `population.json` and `area.json`, density = population / area, rounded to 2
 * decimals (enough precision to rank the near-empty places apart while the
 * 'decimal1' display format shows one decimal). Since both inputs are dense
 * (every real place carries a value), density is dense too, so the metric's
 * "no data" reads only for non-places (orgs).
 *
 * Emits a self-describing metric file, same shape as the others. Re-run after
 * either input refreshes; there is no network call, so this is deterministic.
 *
 * See DATA_FEATURE.md "Feature DI" and the add-world-metric skill for the map.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..');
const METRICS = join(REPO, 'flags', 'metrics');

const population = JSON.parse(readFileSync(join(METRICS, 'population.json'), 'utf-8'));
const area = JSON.parse(readFileSync(join(METRICS, 'area.json'), 'utf-8'));

/** @type {Record<string, number>} */
const values = {};
for (const [code, pop] of Object.entries(population.values)) {
  const km2 = area.values[code];
  if (typeof km2 !== 'number' || km2 <= 0) continue; // no area (or zero) → skip
  values[code] = Math.round((/** @type {number} */ (pop) / km2) * 100) / 100;
}

// Stable, code-sorted output for minimal diffs.
const sorted = {};
for (const code of Object.keys(values).sort()) sorted[code] = values[code];

const metric = {
  key: 'density',
  label: 'Population density',
  unit: 'people/km²',
  // 'decimal1' → one decimal place; density is a small rate, not a big count.
  format: 'decimal1',
  source: `derived: population (${population.year}) / land area (${area.year})`,
  year: population.year,
  values: sorted,
};

const outPath = join(METRICS, 'density.json');
writeFileSync(outPath, JSON.stringify(metric, null, 2) + '\n', 'utf-8');
console.log(`Wrote ${outPath}`);
console.log(`  values: ${Object.keys(sorted).length} (derived from population ∩ area)`);
