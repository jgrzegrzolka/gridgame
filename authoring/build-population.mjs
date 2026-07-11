/**
 * Build flags/metrics/population.json from World Bank data.
 *
 *   node authoring/build-population.mjs
 *
 * Fetches the World Bank WDI indicator SP.POP.TOTL (total population) for the
 * latest snapshot year, joins it to `flags/countries.json` by ISO 3166-1
 * alpha-2 code, and applies the hand-maintained FILLS map for the dependencies /
 * sub-national regions the World Bank omits (including uninhabited places, which
 * carry 0 rather than being dropped). Emits a self-describing metric file:
 *
 *   { key, label, unit, source, year, values: { <code>: <int> } }
 *
 * Every real place (`category !== 'other'`) gets a value, so a metric "no data"
 * reads only for non-places (orgs). Uninhabited places don't skew "least
 * populated" superlatives — `resolveSuperlative` ranks sovereign countries only.
 * values are sorted by code so refreshes produce minimal diffs. Re-run once a
 * year (bump SNAPSHOT_YEAR) to refresh — that is the whole maintenance story.
 *
 * See DATA_FEATURE.md "Feature DD" for the design rationale (why a metric
 * namespace, why raw numbers not ranks).
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..');

const SNAPSHOT_YEAR = 2023;
const WB_URL =
  `https://api.worldbank.org/v2/country/all/indicator/SP.POP.TOTL` +
  `?date=${SNAPSHOT_YEAR}&format=json&per_page=400`;

/**
 * Populated places the World Bank WDI does not cover (dependencies, crown
 * dependencies, sub-national regions with their own flag in our data). Figures
 * are national-statistics / UN estimates, ~2023, rounded — best-effort, not
 * authoritative to the person. Keep this list curated by hand.
 * @type {Record<string, number>}
 */
const FILLS = {
  // UK home nations (ONS / NRS / NISRA mid-2022, rounded)
  'gb-eng': 57106000,
  'gb-sct': 5490000,
  'gb-wls': 3132000,
  'gb-nir': 1910000,
  // Spanish autonomous communities (INE, rounded)
  'es-ct': 7900000, // Catalonia
  'es-pv': 2230000, // Basque Country
  'es-ga': 2700000, // Galicia
  'ic': 2250000, // Canary Islands
  // French overseas departments & collectivities (INSEE, rounded)
  'gf': 290000, // French Guiana
  'gp': 384000, // Guadeloupe
  'mq': 349000, // Martinique
  're': 873000, // Réunion
  'yt': 320000, // Mayotte
  'bl': 11000, // Saint Barthélemy
  'pm': 6000, // Saint Pierre and Miquelon
  'wf': 11500, // Wallis and Futuna
  // British Overseas Territories
  'ai': 15900, // Anguilla
  'fk': 3700, // Falkland Islands
  'ms': 4400, // Montserrat
  'pn': 50, // Pitcairn
  'sh-hl': 4400, // Saint Helena (island)
  'sh-ac': 800, // Ascension Island
  'sh-ta': 250, // Tristan da Cunha
  'sh': 5500, // Saint Helena, Ascension and Tristan da Cunha (whole territory)
  // Crown dependencies
  'gg': 64000, // Guernsey
  'je': 103000, // Jersey
  // Others
  'tw': 23420000, // Taiwan
  'ck': 15000, // Cook Islands
  'nu': 1900, // Niue
  'eh': 570000, // Western Sahara
  'va': 800, // Vatican City
  'ax': 30000, // Åland Islands
  'sj': 2500, // Svalbard and Jan Mayen
  'bq': 27000, // Bonaire, Sint Eustatius and Saba
  'nf': 2200, // Norfolk Island
  'cx': 1700, // Christmas Island
  'cc': 600, // Cocos (Keeling) Islands
  'tk': 1600, // Tokelau
  // Uninhabited / non-permanent-population places. Every real place carries a
  // value (0 when truly uninhabited) rather than being omitted, so the metric's
  // "no data" reads only for non-places (orgs). These never skew "least
  // populated" superlatives — `resolveSuperlative` ranks sovereign countries
  // only, so a research base can't surface there regardless of its value.
  // Figures: CIA World Factbook / COMNAP, transient staff where noted.
  'aq': 1100, // Antarctica — ~1,100 overwintering research staff, no permanent pop
  'bv': 0, // Bouvet Island — uninhabited nature reserve
  'hm': 0, // Heard Island and McDonald Islands — uninhabited
  'cp': 0, // Clipperton Island — uninhabited
  'gs': 30, // South Georgia and the South Sandwich Islands — ~30 summer research/support staff
  'tf': 150, // French Southern and Antarctic Lands — ~150 rotating research staff
  'um': 300, // United States Minor Outlying Islands — transient military/staff (e.g. Wake)
  'io': 3000, // British Indian Ocean Territory — ~3,000 UK/US military + contractors (Diego Garcia)
};

async function main() {
  const countries = JSON.parse(
    readFileSync(join(REPO, 'flags', 'countries.json'), 'utf-8'),
  );
  const realPlaces = countries.filter((c) => c.category !== 'other');

  const res = await fetch(WB_URL);
  if (!res.ok) throw new Error(`World Bank fetch failed: ${res.status}`);
  const payload = await res.json();
  const rows = payload[1];
  if (!Array.isArray(rows)) throw new Error('Unexpected World Bank payload shape');

  /** @type {Map<string, number>} */
  const wb = new Map();
  for (const row of rows) {
    if (row.value == null || !row.country?.id) continue;
    wb.set(row.country.id.toLowerCase(), row.value);
  }

  /** @type {Record<string, number>} */
  const values = {};
  const unresolved = [];
  let fromWb = 0;
  let fromFill = 0;
  for (const c of realPlaces) {
    if (wb.has(c.code)) {
      values[c.code] = wb.get(c.code);
      fromWb++;
    } else if (c.code in FILLS) {
      values[c.code] = FILLS[c.code];
      fromFill++;
    } else {
      unresolved.push(`${c.code}:${c.name}`);
    }
  }

  // Stable, code-sorted output for minimal refresh diffs.
  const sorted = {};
  for (const code of Object.keys(values).sort()) sorted[code] = values[code];

  const metric = {
    key: 'population',
    label: 'Population',
    unit: 'people',
    // Display hint for consumers: 'compact' → 1.4B / 337M / 552K; 'decimal1' →
    // one decimal place (for small per-capita rates). Additive, self-describing.
    format: 'compact',
    source:
      `World Bank WDI (SP.POP.TOTL), ${SNAPSHOT_YEAR}; ` +
      'dependencies & sub-national regions from national-statistics / UN estimates (rounded)',
    year: SNAPSHOT_YEAR,
    values: sorted,
  };

  const outPath = join(REPO, 'flags', 'metrics', 'population.json');
  writeFileSync(outPath, JSON.stringify(metric, null, 2) + '\n', 'utf-8');

  console.log(`Wrote ${outPath}`);
  console.log(
    `  values: ${Object.keys(sorted).length} ` +
      `(World Bank ${fromWb}, fills ${fromFill}) | ` +
      `real places ${realPlaces.length}`,
  );
  if (unresolved.length) {
    console.error(
      `  UNRESOLVED (${unresolved.length}) — add to FILLS or OMIT:\n    ` +
        unresolved.join('\n    '),
    );
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
