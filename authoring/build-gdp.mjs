/**
 * Regenerates flags/metrics/gdp.json from the World Bank WDI.
 *
 * Fetches the World Bank WDI indicator NY.GDP.MKTP.CD (GDP, current US$) and
 * joins it to `flags/countries.json` by ISO 3166-1 alpha-2 code. Two passes:
 *   1. the SNAPSHOT_YEAR figure (most countries have it),
 *   2. the most-recent-non-empty value (mrnev) as a fallback for the handful of
 *      states the World Bank has no SNAPSHOT_YEAR figure for (Cuba, Eritrea,
 *      South Sudan, Syria, Yemen, ...). Those carry an older year, noted below.
 * Whatever the World Bank still omits (dependencies, sub-national regions, the
 * uninhabited territories, plus North Korea and Taiwan) comes from the
 * hand-maintained FILLS map. Emits a self-describing metric file:
 *
 *   { key, label, unit, format, source, year, values: { <code>: <usd> } }
 *
 * DATA CONTRACT — GDP is *universal*: every real place (`category !== 'other'`)
 * gets a value, so a metric "no data" reads only for non-places (orgs). Unlike a
 * *sparse* production metric, absence here means "unsourced", not zero, so we do
 * NOT default missing places to 0. Instead every real place is either sourced or
 * hand-filled. The genuinely economy-less places (Antarctica, Bouvet, the other
 * uninhabited territories) carry 0 deliberately: no permanent economy, not
 * "unknown". The test `flags/metrics.test.js` pins this invariant.
 *
 * Territory / microstate fills are best-available estimates (CIA World Factbook,
 * national / regional accounts), rounded to whole US$. Magnitude is what the
 * game surfaces (compact format, superlative rankings), not exact figures, so an
 * estimate to the right order of magnitude is fine. values are sorted by code
 * for minimal diffs. Re-run yearly.
 *
 * See DATA_FEATURE.md "Feature DJ" and the add-world-metric skill for the map.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..');

const SNAPSHOT_YEAR = 2023;
const IND = 'NY.GDP.MKTP.CD';
const YEAR_URL =
  `https://api.worldbank.org/v2/country/all/indicator/${IND}` +
  `?date=${SNAPSHOT_YEAR}&format=json&per_page=400`;
const MRNEV_URL =
  `https://api.worldbank.org/v2/country/all/indicator/${IND}` +
  `?mrnev=1&format=json&per_page=400`;

/**
 * GDP (current US$) for places the World Bank WDI does not cover: dependencies,
 * crown dependencies, sub-national regions with their own flag, the uninhabited
 * territories (0 — no permanent economy), plus North Korea (no WB data) and
 * Taiwan (excluded from the WB country list). Best-available estimates, rounded.
 * @type {Record<string, number>}
 */
const FILLS = {
  // Sovereign states the World Bank has no data for
  kp: 28000000000, // North Korea (Bank of Korea nominal estimate, ~2022)
  tw: 790000000000, // Taiwan (national accounts, 2023 nominal)
  // UN observer microstate
  va: 300000000, // Vatican City (annual revenues order of magnitude; no measured GDP)
  // UK home nations (ONS regional GVA, converted)
  'gb-eng': 2800000000000, // England
  'gb-sct': 280000000000, // Scotland
  'gb-wls': 108000000000, // Wales
  'gb-nir': 70000000000, // Northern Ireland
  // Spanish autonomous communities (INE regional GDP, converted)
  'es-ct': 270000000000, // Catalonia
  'es-pv': 85000000000, // Basque Country
  'es-ga': 76000000000, // Galicia
  ic: 52000000000, // Canary Islands
  // French overseas departments & collectivities (INSEE regional accounts)
  gf: 4900000000, // French Guiana
  gp: 10000000000, // Guadeloupe
  mq: 10000000000, // Martinique
  re: 22000000000, // Réunion
  yt: 3300000000, // Mayotte
  bl: 450000000, // Saint Barthélemy
  pm: 280000000, // Saint Pierre and Miquelon
  wf: 200000000, // Wallis and Futuna
  // British Overseas Territories
  ai: 300000000, // Anguilla
  fk: 300000000, // Falkland Islands
  ms: 70000000, // Montserrat
  pn: 2000000, // Pitcairn
  gi: 3400000000, // Gibraltar
  vg: 1000000000, // Virgin Islands (British)
  'sh-hl': 40000000, // Saint Helena (island)
  'sh-ac': 30000000, // Ascension Island
  'sh-ta': 5000000, // Tristan da Cunha
  sh: 50000000, // Saint Helena, Ascension and Tristan da Cunha (whole territory)
  // Crown dependencies
  gg: 3900000000, // Guernsey
  je: 6500000000, // Jersey
  // Others
  xk: 10400000000, // Kosovo (if not joined by the WB code we match on)
  ck: 380000000, // Cook Islands
  nu: 10000000, // Niue
  eh: 900000000, // Western Sahara (phosphates, fishing; contested)
  ax: 1600000000, // Åland Islands
  sj: 200000000, // Svalbard and Jan Mayen
  bq: 400000000, // Bonaire, Sint Eustatius and Saba
  nf: 50000000, // Norfolk Island
  cx: 50000000, // Christmas Island
  cc: 10000000, // Cocos (Keeling) Islands
  tk: 8000000, // Tokelau
  // Uninhabited / no-permanent-economy territories: 0, deliberately (not omitted).
  aq: 0, // Antarctica
  bv: 0, // Bouvet Island
  hm: 0, // Heard Island and McDonald Islands
  cp: 0, // Clipperton Island
  gs: 0, // South Georgia and the South Sandwich Islands
  tf: 0, // French Southern and Antarctic Lands
  um: 0, // United States Minor Outlying Islands
  io: 0, // British Indian Ocean Territory (military base, no civilian economy)
};

/** @param {string} url */
async function fetchWb(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`World Bank fetch failed: ${res.status}`);
  const payload = await res.json();
  const rows = payload[1];
  if (!Array.isArray(rows)) throw new Error('Unexpected World Bank payload shape');
  return rows;
}

async function main() {
  const countries = JSON.parse(
    readFileSync(join(REPO, 'flags', 'countries.json'), 'utf-8'),
  );
  const realPlaces = countries.filter((c) => c.category !== 'other');

  // Pass 1: the snapshot year. Pass 2: most-recent-non-empty as fallback.
  const yearRows = await fetchWb(YEAR_URL);
  const mrnevRows = await fetchWb(MRNEV_URL);

  /** @type {Map<string, number>} value at SNAPSHOT_YEAR */
  const wbYear = new Map();
  for (const row of yearRows) {
    if (row.value == null || !row.country?.id) continue;
    wbYear.set(row.country.id.toLowerCase(), row.value);
  }
  /** @type {Map<string, { value: number, year: string }>} most-recent value */
  const wbRecent = new Map();
  for (const row of mrnevRows) {
    if (row.value == null || !row.country?.id) continue;
    wbRecent.set(row.country.id.toLowerCase(), { value: row.value, year: row.date });
  }

  /** @type {Record<string, number>} */
  const values = {};
  const olderYear = []; // codes that fell back to a pre-snapshot figure
  const unresolved = [];
  let fromYear = 0;
  let fromRecent = 0;
  let fromFill = 0;
  for (const c of realPlaces) {
    if (wbYear.has(c.code)) {
      values[c.code] = Math.round(wbYear.get(c.code));
      fromYear++;
    } else if (wbRecent.has(c.code)) {
      const { value, year } = wbRecent.get(c.code);
      values[c.code] = Math.round(value);
      olderYear.push(`${c.code}:${year}`);
      fromRecent++;
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
    key: 'gdp',
    label: 'GDP',
    unit: 'US$',
    // 'compact' → 27.81T / 790.00B / 3.30M. Needs the trillions tier in formatValue.
    format: 'compact',
    source:
      `World Bank WDI (${IND}), ${SNAPSHOT_YEAR} (a few states fall back to their ` +
      'most recent available year); dependencies, sub-national regions, North ' +
      'Korea, Taiwan & uninhabited territories estimated from national / regional ' +
      'accounts & CIA World Factbook (rounded)',
    year: SNAPSHOT_YEAR,
    values: sorted,
  };

  const outPath = join(REPO, 'flags', 'metrics', 'gdp.json');
  writeFileSync(outPath, JSON.stringify(metric, null, 2) + '\n', 'utf-8');

  console.log(`Wrote ${outPath}`);
  console.log(
    `  values: ${Object.keys(sorted).length} ` +
      `(WB ${SNAPSHOT_YEAR} ${fromYear}, WB older ${fromRecent}, fills ${fromFill}) | ` +
      `real places ${realPlaces.length}`,
  );
  if (olderYear.length) {
    console.log(`  fell back to older WB year: ${olderYear.join(', ')}`);
  }
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
