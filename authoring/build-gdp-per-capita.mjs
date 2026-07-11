/**
 * Regenerates flags/metrics/gdpPerCapita.json from the GDP + population metrics.
 *
 * GDP per capita (current US$ per person) is a *derived* metric, like density:
 * no external source, gdpPerCapita = gdp / population for every real place. Both
 * inputs are dense (every real place carries a value), so this is dense too and
 * a metric "no data" reads only for non-places (orgs).
 *
 * The uninhabited territories carry population 0 (Bouvet, Heard, Clipperton).
 * Rather than dividing by zero (which would drop them and break the "every real
 * place has a value" invariant), they are defined as 0: no people, no per-capita
 * output. Everywhere else, value = round(gdp / population) in whole US$ (dollars
 * are plenty of precision to rank per-capita income apart).
 *
 * Emits a self-describing metric file, same shape as the others. Re-run after
 * either input refreshes; no network call, so this is deterministic.
 *
 * See DATA_FEATURE.md "Feature DJ" and the add-world-metric skill for the map.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..');
const METRICS = join(REPO, 'flags', 'metrics');

const gdp = JSON.parse(readFileSync(join(METRICS, 'gdp.json'), 'utf-8'));
const population = JSON.parse(readFileSync(join(METRICS, 'population.json'), 'utf-8'));

/** @type {Record<string, number>} */
const values = {};
for (const [code, dollars] of Object.entries(gdp.values)) {
  const pop = population.values[code];
  if (typeof pop !== 'number') continue; // no population → can't derive (shouldn't happen: both dense)
  // Uninhabited places (pop 0, gdp 0): per-capita is 0, not a divide-by-zero drop.
  values[code] = pop <= 0 ? 0 : Math.round(/** @type {number} */ (dollars) / pop);
}

// Stable, code-sorted output for minimal diffs.
const sorted = {};
for (const code of Object.keys(values).sort()) sorted[code] = values[code];

const metric = {
  key: 'gdpPerCapita',
  label: 'GDP per capita',
  unit: 'US$',
  // 'compact' → 130.5K / 2.5K / 240. Per-capita spans ~$200 to ~$250K.
  format: 'compact',
  source: `derived: GDP (${gdp.year}) / population (${population.year})`,
  year: gdp.year,
  values: sorted,
};

const outPath = join(METRICS, 'gdpPerCapita.json');
writeFileSync(outPath, JSON.stringify(metric, null, 2) + '\n', 'utf-8');
console.log(`Wrote ${outPath}`);
console.log(`  values: ${Object.keys(sorted).length} (derived from gdp ∩ population)`);
