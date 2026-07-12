/**
 * Regenerates flags/metrics/forest.json, the forest area of each place as a
 * PERCENTAGE of its land area.
 *
 * The primary source is FAO's Global Forest Resources Assessment (FRA 2020,
 * refreshed to 2022 in some rows), surfaced as the World Bank indicator
 * "Forest area (% of land area)" (AG.LND.FRST.ZS); the Wikipedia "List of
 * countries by forest area" table mirrors it row-for-row. Values are joined to
 * flags/countries.json by ISO code and kept to one decimal place. Every value
 * names its source in a trailing comment so a refresh can be checked line by
 * line, and any figure with no individual FAO row (the UK home nations, the
 * Spanish autonomous communities, a handful of small dependencies and the
 * Antarctic / subantarctic islands) is flagged `estimate` inline.
 *
 * WHY THIS METRIC: it is the first *intensive* (ratio) world metric. Population,
 * area, GDP and the crops all reward "pick the bigger country". Forest cover is
 * a share of a place's own land, so size barely predicts it: tiny French Guiana
 * (96.6%), Suriname (94.5%) and Guyana (93.5%) top the world while the giants
 * sit mid-to-low (Australia 17.4%, Canada 39.5%, Kazakhstan 1.3%). Same
 * size-decoupled feel as density and GDP per capita.
 *
 * DATA CONTRACT: forest cover is *dense*, the mirror of area / coastline /
 * elevation. Every real place (`category !== 'other'`) has a value and only the
 * non-place org flags are left bare. A TREELESS place (desert, ice sheet, bare
 * rock) carries a real 0.0 (Egypt, Greenland, Antarctica, Qatar), not omission,
 * so "no data" still means exactly "not a place" — the invariant the TTT
 * picker's no-data guard leans on (metricTiers.js `metricDataGap`). There is
 * therefore NO `absence: 'zero'` hint (that is for sparse producer metrics where
 * a missing row means "makes none"; here every place, forested or bare, is
 * sourced explicitly). This script errors if any real place is missing.
 *
 * Two-directional, like area: both extremes make good questions. The high end is
 * the rainforest belt (the Guianas, Gabon, the Pacific micro-states, Finland);
 * the low end is the deserts and ice (0.0%).
 *
 * Values are one decimal, sorted by code on emit for minimal diffs. Forest cover
 * moves slowly, so this is effectively a snapshot; re-run only if a figure is
 * corrected or a place is added to countries.json.
 *
 * See DATA_FEATURE.md "Feature DQ" and the add-world-metric skill for the map.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..');

// Snapshot year of the FAO/World Bank series used (FRA 2020, some rows 2022).
const YEAR = 2022;

/**
 * Forest area as a percentage of land area, keyed by our ISO 3166-1 alpha-2 flag
 * code. Each value names its source; `estimate` marks a figure with no
 * individual FAO/World Bank row (a dependency or sub-national region folded into
 * a parent's figure, or an ice/rock place with no FAO entry that is plainly 0).
 * Grouped by continent for navigability; the emitted JSON is sorted by code.
 * @type {Record<string, number>}
 */
const FOREST_PCT = {
  // ---- Africa ----
  ao: 52.5, // Angola, FAO/WB
  bf: 22.4, // Burkina Faso, FAO/WB
  bi: 10.9, // Burundi, FAO/WB
  bj: 26.9, // Benin, FAO/WB
  bw: 26.5, // Botswana, FAO/WB
  cd: 54.7, // DR Congo, FAO/WB
  cf: 35.7, // Central African Republic, FAO/WB
  cg: 64.2, // Republic of the Congo, FAO/WB
  ci: 8.2, // Côte d'Ivoire, FAO/WB
  cm: 42.8, // Cameroon, FAO/WB
  cv: 11.5, // Cabo Verde, FAO/WB
  dj: 0.3, // Djibouti, FAO/WB
  dz: 0.8, // Algeria, FAO/WB
  eg: 0.0, // Egypt, FAO/WB (negligible; rounds to 0)
  eh: 2.5, // Western Sahara, FAO/WB
  er: 8.7, // Eritrea, FAO/WB
  et: 15.0, // Ethiopia, FAO/WB
  ga: 91.2, // Gabon, FAO/WB
  gh: 35.2, // Ghana, FAO/WB
  gm: 22.8, // Gambia, FAO/WB
  gn: 24.9, // Guinea, FAO/WB
  gq: 86.7, // Equatorial Guinea, FAO/WB
  gw: 69.8, // Guinea-Bissau, FAO/WB
  io: 30.0, // British Indian Ocean Territory (Diego Garcia), estimate: dense atoll coconut/tropical vegetation, no FAO row
  ke: 6.3, // Kenya, FAO/WB
  km: 17.2, // Comoros, FAO/WB
  lr: 78.5, // Liberia, FAO/WB
  ls: 1.1, // Lesotho, FAO/WB
  ly: 0.1, // Libya, FAO/WB
  ma: 12.9, // Morocco, FAO/WB (excludes Western Sahara, listed separately as eh)
  mg: 21.3, // Madagascar, FAO/WB
  ml: 10.9, // Mali, FAO/WB
  mr: 0.3, // Mauritania, FAO/WB
  mu: 19.5, // Mauritius, FAO/WB
  mw: 22.9, // Malawi, FAO/WB
  mz: 46.1, // Mozambique, FAO/WB
  na: 7.9, // Namibia, FAO/WB
  ne: 0.8, // Niger, FAO/WB
  ng: 23.4, // Nigeria, FAO/WB
  re: 39.6, // Réunion, FAO/WB
  rw: 11.3, // Rwanda, FAO/WB
  sc: 73.3, // Seychelles, FAO/WB
  sd: 9.6, // Sudan, FAO/WB
  sh: 5.1, // St Helena, Ascension & Tristan da Cunha (whole territory), FAO/WB
  'sh-ac': 2.0, // Ascension Island, estimate: mostly barren volcanic, planted cloud forest on Green Mountain only
  'sh-hl': 5.0, // St Helena island, estimate: the territory figure (5.1) reflects mainly this island
  'sh-ta': 0.0, // Tristan da Cunha, estimate: subantarctic, tussock grass and no native trees
  sl: 34.6, // Sierra Leone, FAO/WB
  sn: 41.5, // Senegal, FAO/WB
  so: 9.3, // Somalia, FAO/WB
  ss: 11.3, // South Sudan, FAO/WB
  st: 52.8, // Sao Tome and Principe, FAO/WB
  sz: 29.1, // Eswatini, FAO/WB
  td: 3.2, // Chad, FAO/WB
  tg: 22.1, // Togo, FAO/WB
  tn: 4.5, // Tunisia, FAO/WB
  tz: 50.6, // Tanzania, FAO/WB
  ug: 11.2, // Uganda, FAO/WB
  yt: 37.7, // Mayotte, FAO/WB
  za: 14.0, // South Africa, FAO/WB
  zm: 59.8, // Zambia, FAO/WB
  zw: 44.9, // Zimbabwe, FAO/WB

  // ---- Asia ----
  ae: 4.5, // United Arab Emirates, FAO/WB
  af: 1.9, // Afghanistan, FAO/WB
  am: 11.5, // Armenia, FAO/WB
  az: 14.0, // Azerbaijan, FAO/WB
  bd: 14.5, // Bangladesh, FAO/WB
  bh: 0.9, // Bahrain, FAO/WB
  bn: 72.1, // Brunei, FAO/WB
  bt: 71.6, // Bhutan, FAO/WB
  cn: 23.8, // China, FAO/WB
  ge: 40.6, // Georgia, FAO/WB
  hk: 25.0, // Hong Kong, estimate: ~40% country-park land, well under half is closed-canopy forest; no FAO row
  id: 48.0, // Indonesia, FAO/WB
  il: 6.5, // Israel, FAO/WB
  in: 24.4, // India, FAO/WB
  iq: 1.9, // Iraq, FAO/WB
  ir: 6.6, // Iran, FAO/WB
  jo: 1.1, // Jordan, FAO/WB
  jp: 68.4, // Japan, FAO/WB
  kg: 7.0, // Kyrgyzstan, FAO/WB
  kh: 43.9, // Cambodia, FAO/WB
  kp: 49.7, // North Korea, FAO/WB
  kr: 64.2, // South Korea, FAO/WB
  kw: 0.4, // Kuwait, FAO/WB
  kz: 1.3, // Kazakhstan, FAO/WB
  la: 71.6, // Laos, FAO/WB
  lb: 14.1, // Lebanon, FAO/WB
  lk: 34.1, // Sri Lanka, FAO/WB
  mm: 42.8, // Myanmar, FAO/WB
  mn: 9.1, // Mongolia, FAO/WB
  mo: 2.0, // Macau, estimate: dense urban SAR, only fringe hillside greenery; no FAO row
  mv: 2.7, // Maldives, FAO/WB
  my: 57.9, // Malaysia, FAO/WB
  np: 41.6, // Nepal, FAO/WB
  om: 0.0, // Oman, FAO/WB (negligible; rounds to 0)
  ph: 24.3, // Philippines, FAO/WB
  pk: 4.7, // Pakistan, FAO/WB
  ps: 1.7, // State of Palestine, FAO/WB
  qa: 0.0, // Qatar, FAO/WB
  sa: 0.5, // Saudi Arabia, FAO/WB
  sg: 21.2, // Singapore, FAO/WB
  sy: 2.8, // Syria, FAO/WB
  th: 38.8, // Thailand, FAO/WB
  tj: 3.1, // Tajikistan, FAO/WB
  tl: 61.8, // Timor-Leste, FAO/WB
  tm: 8.8, // Turkmenistan, FAO/WB
  tr: 29.3, // Türkiye, FAO/WB
  tw: 60.7, // Taiwan, estimate: national forest inventory ~60.7%, no FAO/WB row (not a UN member)
  uz: 8.5, // Uzbekistan, FAO/WB
  vn: 47.2, // Vietnam, FAO/WB
  ye: 1.0, // Yemen, FAO/WB

  // ---- Europe ----
  ad: 34.0, // Andorra, FAO/WB
  al: 28.8, // Albania, FAO/WB
  at: 47.2, // Austria, FAO/WB
  ax: 60.0, // Åland Islands, estimate: heavily forested Finnish archipelago, folded into Finland's FAO figure
  ba: 42.7, // Bosnia and Herzegovina, FAO/WB
  be: 22.6, // Belgium, FAO/WB
  bg: 36.1, // Bulgaria, FAO/WB
  by: 43.3, // Belarus, FAO/WB
  ch: 32.3, // Switzerland, FAO/WB
  cy: 18.7, // Cyprus, FAO/WB
  cz: 34.7, // Czechia, FAO/WB
  de: 32.7, // Germany, FAO/WB
  dk: 15.8, // Denmark, FAO/WB
  ee: 57.1, // Estonia, FAO/WB
  es: 37.2, // Spain, FAO/WB
  'es-ct': 40.0, // Catalonia, estimate: ~38-40% forested, folded into Spain's FAO figure
  'es-ga': 55.0, // Galicia, estimate: one of Spain's most forested regions, folded into Spain's FAO figure
  'es-pv': 55.0, // Basque Country, estimate: the greenest Spanish region, folded into Spain's FAO figure
  fi: 73.7, // Finland, FAO/WB
  fo: 0.1, // Faroe Islands, FAO/WB (near-treeless)
  fr: 31.8, // France (metropolitan), FAO/WB
  gb: 13.3, // United Kingdom, FAO/WB
  'gb-eng': 10.0, // England, estimate: ~10% woodland cover (Forestry Commission), finer than the FAO UK total
  'gb-nir': 8.0, // Northern Ireland, estimate: least-wooded UK nation (~8%)
  'gb-sct': 19.0, // Scotland, estimate: most-wooded UK nation (~19%)
  'gb-wls': 15.0, // Wales, estimate: ~15% woodland cover
  gg: 5.2, // Guernsey, FAO/WB Channel Islands aggregate
  gi: 0.0, // Gibraltar, FAO/WB (the Rock; no forest)
  gr: 30.3, // Greece, FAO/WB
  hr: 34.7, // Croatia, FAO/WB
  hu: 22.5, // Hungary, FAO/WB
  ic: 15.0, // Canary Islands, estimate: laurisilva + Canary-pine belts, folded into Spain's FAO figure
  ie: 11.5, // Ireland, FAO/WB
  im: 6.1, // Isle of Man, FAO/WB
  is: 0.5, // Iceland, FAO/WB (near-treeless)
  it: 32.7, // Italy, FAO/WB
  je: 5.2, // Jersey, FAO/WB Channel Islands aggregate
  li: 41.9, // Liechtenstein, FAO/WB
  lt: 35.2, // Lithuania, FAO/WB
  lu: 34.5, // Luxembourg, FAO/WB
  lv: 54.9, // Latvia, FAO/WB
  mc: 0.0, // Monaco, FAO/WB (city-state; no forest)
  md: 11.8, // Moldova, FAO/WB
  me: 61.5, // Montenegro, FAO/WB
  mk: 39.7, // North Macedonia, FAO/WB
  mt: 1.4, // Malta, FAO/WB
  nl: 11.0, // Netherlands, FAO/WB
  no: 33.5, // Norway, FAO/WB
  pl: 31.1, // Poland, FAO/WB
  pt: 36.2, // Portugal, FAO/WB
  ro: 30.1, // Romania, FAO/WB
  rs: 32.4, // Serbia, FAO/WB
  ru: 49.8, // Russia, FAO/WB
  se: 68.7, // Sweden, FAO/WB
  si: 61.3, // Slovenia, FAO/WB
  sj: 0.0, // Svalbard and Jan Mayen, estimate: High Arctic tundra, no forest
  sk: 40.1, // Slovakia, FAO/WB
  sm: 16.7, // San Marino, FAO/WB
  ua: 16.7, // Ukraine, FAO/WB
  va: 0.0, // Vatican City, FAO/WB (city-state; no forest)
  xk: 44.0, // Kosovo, estimate: national inventory ~42-44%, no FAO/WB row (contested UN status)

  // ---- North America ----
  ag: 18.2, // Antigua and Barbuda, FAO/WB
  ai: 61.1, // Anguilla, FAO/WB
  aw: 2.3, // Aruba, FAO/WB
  bb: 14.7, // Barbados, FAO/WB
  bl: 8.5, // Saint Barthélemy, FAO/WB
  bm: 18.5, // Bermuda, FAO/WB
  bq: 5.9, // Caribbean Netherlands (Bonaire/Saba/St Eustatius), FAO/WB
  bs: 50.9, // Bahamas, FAO/WB
  bz: 55.0, // Belize, FAO/WB
  ca: 39.5, // Canada, FAO/WB
  cp: 0.0, // Clipperton Island, estimate: coral atoll, no forest (a few coconut palms)
  cr: 60.1, // Costa Rica, FAO/WB
  cu: 31.2, // Cuba, FAO/WB
  cw: 0.2, // Curaçao, FAO/WB (arid; near-treeless)
  dm: 63.8, // Dominica, FAO/WB
  do: 44.8, // Dominican Republic, FAO/WB
  gd: 52.1, // Grenada, FAO/WB
  gl: 0.0, // Greenland, FAO/WB (ice sheet; no forest)
  gp: 44.3, // Guadeloupe, FAO/WB
  gt: 32.7, // Guatemala, FAO/WB
  hn: 56.5, // Honduras, FAO/WB
  ht: 12.4, // Haiti, FAO/WB
  jm: 55.8, // Jamaica, FAO/WB
  kn: 42.3, // Saint Kitts and Nevis, FAO/WB
  ky: 52.7, // Cayman Islands, FAO/WB
  lc: 34.0, // Saint Lucia, FAO/WB
  mf: 24.8, // Saint Martin (French), FAO/WB
  mq: 49.7, // Martinique, FAO/WB
  ms: 25.0, // Montserrat, FAO/WB
  mx: 33.7, // Mexico, FAO/WB
  ni: 26.7, // Nicaragua, FAO/WB
  pa: 56.5, // Panama, FAO/WB
  pm: 5.1, // Saint Pierre and Miquelon, FAO/WB
  pr: 56.1, // Puerto Rico, FAO/WB
  sv: 27.7, // El Salvador, FAO/WB
  sx: 10.9, // Sint Maarten (Dutch), FAO/WB
  tc: 11.1, // Turks and Caicos Islands, FAO/WB
  tt: 44.3, // Trinidad and Tobago, FAO/WB
  us: 33.9, // United States, FAO/WB
  vc: 73.2, // Saint Vincent and the Grenadines, FAO/WB
  vg: 24.1, // British Virgin Islands, FAO/WB
  vi: 57.7, // US Virgin Islands, FAO/WB

  // ---- South America ----
  ar: 10.4, // Argentina, FAO/WB
  bo: 46.5, // Bolivia, FAO/WB
  br: 59.1, // Brazil, FAO/WB
  cl: 24.8, // Chile, FAO/WB
  co: 52.9, // Colombia, FAO/WB
  ec: 49.8, // Ecuador, FAO/WB
  fk: 0.0, // Falkland Islands, FAO/WB (treeless moorland)
  gf: 96.6, // French Guiana, FAO/WB (the world's most forested territory)
  gy: 93.5, // Guyana, FAO/WB
  pe: 56.2, // Peru, FAO/WB
  py: 39.3, // Paraguay, FAO/WB
  sr: 94.5, // Suriname, FAO/WB
  uy: 11.8, // Uruguay, FAO/WB
  ve: 52.3, // Venezuela, FAO/WB

  // ---- Oceania ----
  as: 85.4, // American Samoa, FAO/WB
  au: 17.4, // Australia, FAO/WB
  cc: 15.0, // Cocos (Keeling) Islands, estimate: small coral atolls, coconut palm, no FAO row
  ck: 65.0, // Cook Islands, FAO/WB
  cx: 70.0, // Christmas Island, estimate: two-thirds is rainforest national park, no FAO row
  fj: 63.1, // Fiji, FAO/WB
  fm: 92.1, // Micronesia, FAO/WB
  gu: 51.9, // Guam, FAO/WB
  ki: 1.5, // Kiribati, FAO/WB
  mh: 52.2, // Marshall Islands, FAO/WB
  mp: 53.0, // Northern Mariana Islands, FAO/WB
  nc: 45.8, // New Caledonia, FAO/WB
  nf: 12.3, // Norfolk Island, FAO/WB
  nr: 0.0, // Nauru, FAO/WB (mined-out phosphate island)
  nu: 72.7, // Niue, FAO/WB
  nz: 37.7, // New Zealand, FAO/WB
  pf: 43.1, // French Polynesia, FAO/WB
  pg: 79.0, // Papua New Guinea, FAO/WB
  pn: 74.5, // Pitcairn, FAO/WB
  pw: 90.4, // Palau, FAO/WB
  sb: 90.1, // Solomon Islands, FAO/WB
  tk: 0.0, // Tokelau, FAO/WB (three low coral atolls)
  to: 12.4, // Tonga, FAO/WB
  tv: 33.3, // Tuvalu, FAO/WB
  um: 0.0, // US Minor Outlying Islands, estimate: scattered atolls/islets, effectively no forest
  vu: 36.3, // Vanuatu, FAO/WB
  wf: 41.6, // Wallis and Futuna, FAO/WB
  ws: 57.8, // Samoa, FAO/WB

  // ---- Antarctica / subantarctic (no forest) ----
  aq: 0.0, // Antarctica, estimate: ice sheet, no forest
  bv: 0.0, // Bouvet Island, estimate: glaciated, no forest
  gs: 0.0, // South Georgia and the South Sandwich Islands, estimate: no native trees
  hm: 0.0, // Heard Island and McDonald Islands, estimate: glaciated, no forest
  tf: 0.0, // French Southern Territories, estimate: subantarctic, no native trees
};

function main() {
  const countries = JSON.parse(
    readFileSync(join(REPO, 'flags', 'countries.json'), 'utf-8'),
  );
  const realPlaces = countries.filter((c) => c.category !== 'other');
  const realCodes = new Set(realPlaces.map((c) => c.code));

  /** @type {Record<string, number>} */
  const values = {};
  const missing = []; // real places with no entry in the table
  for (const c of realPlaces) {
    if (c.code in FOREST_PCT) {
      values[c.code] = FOREST_PCT[c.code];
    } else {
      missing.push(`${c.code}:${c.name}`);
    }
  }
  const extra = Object.keys(FOREST_PCT).filter((code) => !realCodes.has(code));

  // Stable, code-sorted output for minimal refresh diffs.
  const sorted = {};
  for (const code of Object.keys(values).sort()) sorted[code] = values[code];

  const metric = {
    key: 'forest',
    label: 'Forest cover',
    unit: '%',
    // 'decimal1' → one decimal place (52.5). Forest cover is a share of land
    // area, 0.0–96.6, so a single decimal is the natural precision.
    format: 'decimal1',
    source:
      'Forest area as a percentage of land area, FAO Global Forest Resources ' +
      'Assessment (FRA 2020, some rows 2022) via the World Bank indicator ' +
      '"Forest area (% of land area)" (AG.LND.FRST.ZS); the Wikipedia "List of ' +
      'countries by forest area" table mirrors it. One decimal place; treeless ' +
      'places (deserts, ice) carry a real 0.0. A few places with no individual ' +
      'FAO row (the UK home nations, the Spanish regions, Taiwan, Hong Kong, ' +
      'Macau, Kosovo, small dependencies and the Antarctic islands) are estimates',
    year: YEAR,
    values: sorted,
  };

  const outPath = join(REPO, 'flags', 'metrics', 'forest.json');
  writeFileSync(outPath, JSON.stringify(metric, null, 2) + '\n', 'utf-8');

  console.log(`Wrote ${outPath}`);
  console.log(
    `  values: ${Object.keys(sorted).length} | real places ${realPlaces.length}`,
  );
  if (extra.length) {
    console.error(`  table codes not in countries.json: ${extra.join(', ')}`);
  }
  if (missing.length) {
    console.error(
      `  UNRESOLVED (${missing.length}) real places, add to FOREST_PCT:\n    ` +
        missing.join('\n    '),
    );
    process.exit(1);
  }
}

main();
