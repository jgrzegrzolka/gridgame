/**
 * Regenerates flags/metrics/area.json from the World Bank WDI.
 *
 * Fetches the World Bank WDI indicator AG.LND.TOTL.K2 (land area, sq km) for the
 * latest snapshot year, joins it to `flags/countries.json` by ISO 3166-1 alpha-2
 * code, and applies the hand-maintained FILLS map for the dependencies /
 * sub-national regions the World Bank omits (including uninhabited places, which
 * carry their real area, not omission). Emits a self-describing metric file:
 *
 *   { key, label, unit, format, source, year, values: { <code>: <km2> } }
 *
 * Every real place (`category !== 'other'`) gets a value, so a metric "no data"
 * reads only for non-places (orgs). Land area is stable, so exact figures matter
 * far less than magnitude; FILLS use standard references, rounded. World Bank
 * values are rounded to whole km2; microstate fills keep a decimal where the
 * whole thing is under 1 km2 (Vatican). values are sorted by code for minimal
 * diffs. Re-run when a boundary changes; otherwise this is effectively frozen.
 *
 * See DATA_FEATURE.md "Feature DH" and the add-world-metric skill for the map.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..');

const SNAPSHOT_YEAR = 2022;
const WB_URL =
  `https://api.worldbank.org/v2/country/all/indicator/AG.LND.TOTL.K2` +
  `?date=${SNAPSHOT_YEAR}&format=json&per_page=400`;

/**
 * Land area (sq km) for places the World Bank WDI does not cover: dependencies,
 * crown dependencies, sub-national regions with their own flag, and the
 * uninhabited territories. Standard references (national statistics / CIA World
 * Factbook), rounded. Areas are stable facts; keep this list curated by hand.
 * @type {Record<string, number>}
 */
const FILLS = {
  // UK home nations
  'gb-eng': 130279, // England
  'gb-sct': 77933, // Scotland
  'gb-wls': 20779, // Wales
  'gb-nir': 14130, // Northern Ireland
  // Spanish autonomous communities
  'es-ct': 32108, // Catalonia
  'es-pv': 7234, // Basque Country
  'es-ga': 29574, // Galicia
  'ic': 7493, // Canary Islands
  // French overseas departments & collectivities
  'gf': 83534, // French Guiana
  'gp': 1628, // Guadeloupe
  'mq': 1128, // Martinique
  're': 2511, // Réunion
  'yt': 374, // Mayotte
  'bl': 25, // Saint Barthélemy
  'pm': 242, // Saint Pierre and Miquelon
  'wf': 142, // Wallis and Futuna
  // British Overseas Territories
  'ai': 91, // Anguilla
  'fk': 12173, // Falkland Islands
  'ms': 102, // Montserrat
  'pn': 47, // Pitcairn
  'sh-hl': 122, // Saint Helena (island)
  'sh-ac': 88, // Ascension Island
  'sh-ta': 98, // Tristan da Cunha (main island)
  'sh': 420, // Saint Helena, Ascension and Tristan da Cunha (whole territory)
  // Crown dependencies
  'gg': 78, // Guernsey
  'je': 116, // Jersey
  // Others
  'tw': 36197, // Taiwan
  'xk': 10887, // Kosovo (World Bank lists it under a code we don't join on)
  'ck': 236, // Cook Islands
  'nu': 260, // Niue
  'eh': 266000, // Western Sahara
  'va': 0.49, // Vatican City
  'ax': 1580, // Åland Islands
  'sj': 62045, // Svalbard and Jan Mayen
  'bq': 328, // Bonaire, Sint Eustatius and Saba
  'nf': 36, // Norfolk Island
  'cx': 135, // Christmas Island
  'cc': 14, // Cocos (Keeling) Islands
  'tk': 12, // Tokelau
  // Uninhabited / non-permanent-population territories: real area, not omitted.
  'aq': 14200000, // Antarctica
  'bv': 49, // Bouvet Island
  'hm': 412, // Heard Island and McDonald Islands
  'cp': 2, // Clipperton Island (land)
  'gs': 3903, // South Georgia and the South Sandwich Islands
  'tf': 7747, // French Southern and Antarctic Lands (southern islands)
  'um': 34, // United States Minor Outlying Islands
  'io': 60, // British Indian Ocean Territory (land)
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
      // Whole km2 is plenty of precision for a sovereign; keeps the file tidy.
      values[c.code] = Math.round(wb.get(c.code));
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
    key: 'area',
    label: 'Land area',
    unit: 'km²',
    // 'compact' → 17M / 9.6M / 552K (km²). Self-describing display hint.
    format: 'compact',
    source:
      `World Bank WDI (AG.LND.TOTL.K2), ${SNAPSHOT_YEAR}; ` +
      'dependencies, sub-national regions & uninhabited territories from ' +
      'national-statistics / CIA World Factbook (rounded)',
    year: SNAPSHOT_YEAR,
    values: sorted,
  };

  const outPath = join(REPO, 'flags', 'metrics', 'area.json');
  writeFileSync(outPath, JSON.stringify(metric, null, 2) + '\n', 'utf-8');

  console.log(`Wrote ${outPath}`);
  console.log(
    `  values: ${Object.keys(sorted).length} ` +
      `(World Bank ${fromWb}, fills ${fromFill}) | ` +
      `real places ${realPlaces.length}`,
  );
  if (unresolved.length) {
    console.error(
      `  UNRESOLVED (${unresolved.length}), add to FILLS:\n    ` +
        unresolved.join('\n    '),
    );
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
