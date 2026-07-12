/**
 * Regenerates flags/metrics/coastline.json, the length of each place's coastline
 * in kilometres.
 *
 * Like elevation there is no live indicator API for "coastline length"; it is a
 * near-static physical fact per place. So this is a hand-curated table
 * (COASTLINE_KM below), joined to flags/countries.json by ISO code. The primary
 * source is the CIA World Factbook "Coastline" field (Wikipedia "List of
 * countries by length of coastline" mirrors it); decimal Factbook figures are
 * rounded to whole km. Every value names its source in a trailing comment so a
 * refresh can be checked line by line, and any figure that is an estimate (no
 * Factbook entry: the UK home nations, the Spanish regions, a handful of small
 * dependencies and Antarctic archipelagos) is flagged `estimate` inline.
 *
 * DATA CONTRACT: coastline is *dense*, the mirror of area / elevation. Every real
 * place (`category !== 'other'`) has a coastline, so every one carries a value
 * and only the non-place org flags are left bare. A LANDLOCKED place carries a
 * real 0 (it genuinely has no coast), not omission, so "no data" still means
 * exactly "not a place" — the invariant the TTT picker's no-data guard leans on
 * (metricTiers.js `metricDataGap`). There is therefore NO `absence: 'zero'` hint
 * (that is for sparse producer metrics where a missing row means "makes none";
 * here every place, coastal or landlocked, is sourced explicitly). This script
 * errors if any real place is missing from the table.
 *
 * Two-directional, like area: both extremes make good questions. Longest coast
 * tops out at Canada (~202,080 km) and the archipelago giants (Indonesia,
 * Russia, the Philippines, Japan, Australia, Norway); the low end is the
 * short-coast and landlocked places (0 km).
 *
 * A note the reviewer should know: the four UK-nation splits are internally
 * consistent Ordnance-Survey-derived figures and deliberately sum well above the
 * Factbook UK total (12,429 km) because they use a finer measurement scale and
 * count every island. Coastline length is famously scale-dependent (the
 * coastline paradox), so cross-source sums are not expected to reconcile.
 *
 * Values are sorted by code on emit for minimal diffs. Coastlines barely change,
 * so this is effectively frozen; re-run only if a figure is corrected or a place
 * is added to countries.json.
 *
 * See DATA_FEATURE.md "Feature DP" and the add-world-metric skill for the map.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..');

// Static curation snapshot year (coastline is not year-bound; this only
// satisfies the self-describing metric schema's `year` field).
const YEAR = 2024;

/**
 * Coastline length (kilometres) of every real place, keyed by our ISO 3166-1
 * alpha-2 flag code. Each value names its source so a refresh can be checked
 * line by line; `estimate` marks a figure with no Factbook entry. Grouped by
 * continent for navigability; the emitted JSON is sorted by code. Landlocked
 * places carry a real 0.
 * @type {Record<string, number>}
 */
const COASTLINE_KM = {
  // ---- Africa ----
  ao: 1600, // Angola, CIA WFB
  bf: 0, // Burkina Faso, landlocked
  bi: 0, // Burundi, landlocked
  bj: 121, // Benin, CIA WFB
  bw: 0, // Botswana, landlocked
  cd: 37, // DR Congo, CIA WFB
  cf: 0, // Central African Republic, landlocked
  cg: 169, // Republic of the Congo, CIA WFB
  ci: 515, // Côte d'Ivoire, CIA WFB
  cm: 402, // Cameroon, CIA WFB
  cv: 965, // Cabo Verde, CIA WFB
  dj: 314, // Djibouti, CIA WFB
  dz: 998, // Algeria, CIA WFB
  eg: 2450, // Egypt, CIA WFB
  eh: 1110, // Western Sahara, CIA WFB
  er: 2234, // Eritrea, CIA WFB
  et: 0, // Ethiopia, landlocked
  ga: 885, // Gabon, CIA WFB
  gh: 539, // Ghana, CIA WFB
  gm: 80, // Gambia, CIA WFB
  gn: 320, // Guinea, CIA WFB
  gq: 296, // Equatorial Guinea, CIA WFB
  gw: 350, // Guinea-Bissau, CIA WFB
  io: 698, // British Indian Ocean Territory (Diego Garcia), CIA WFB
  ke: 536, // Kenya, CIA WFB
  km: 340, // Comoros, CIA WFB
  lr: 579, // Liberia, CIA WFB
  ls: 0, // Lesotho, landlocked
  ly: 1770, // Libya, CIA WFB
  ma: 1835, // Morocco, CIA WFB (excludes Western Sahara, listed separately as eh)
  mg: 4828, // Madagascar, CIA WFB
  ml: 0, // Mali, landlocked
  mr: 754, // Mauritania, CIA WFB
  mu: 177, // Mauritius, CIA WFB
  mw: 0, // Malawi, landlocked
  mz: 2470, // Mozambique, CIA WFB
  na: 1572, // Namibia, CIA WFB
  ne: 0, // Niger, landlocked
  ng: 853, // Nigeria, CIA WFB
  re: 207, // Réunion, CIA WFB (older ed. standalone entry)
  rw: 0, // Rwanda, landlocked
  sc: 491, // Seychelles, CIA WFB
  sd: 853, // Sudan, CIA WFB
  sh: 60, // St Helena, Ascension & Tristan da Cunha (whole territory), CIA WFB (reflects St Helena island)
  'sh-ac': 55, // Ascension Island, estimate: ~88 km² volcanic island, indented coast
  'sh-hl': 60, // St Helena island, CIA WFB territory figure (60 km) applies to this island
  'sh-ta': 40, // Tristan da Cunha, estimate: main island ~34 km + Nightingale/Inaccessible islets
  sl: 402, // Sierra Leone, CIA WFB
  sn: 531, // Senegal, CIA WFB
  so: 3025, // Somalia, CIA WFB
  ss: 0, // South Sudan, landlocked
  st: 209, // Sao Tome and Principe, CIA WFB
  sz: 0, // Eswatini, landlocked
  td: 0, // Chad, landlocked
  tg: 56, // Togo, CIA WFB
  tn: 1148, // Tunisia, CIA WFB
  tz: 1424, // Tanzania, CIA WFB
  ug: 0, // Uganda, landlocked
  yt: 185, // Mayotte, CIA WFB
  za: 2798, // South Africa, CIA WFB
  zm: 0, // Zambia, landlocked
  zw: 0, // Zimbabwe, landlocked

  // ---- Asia ----
  ae: 1318, // United Arab Emirates, CIA WFB
  af: 0, // Afghanistan, landlocked
  am: 0, // Armenia, landlocked
  az: 713, // Azerbaijan, CIA WFB Caspian-Sea coast
  bd: 580, // Bangladesh, CIA WFB
  bh: 161, // Bahrain, CIA WFB
  bn: 161, // Brunei, CIA WFB
  bt: 0, // Bhutan, landlocked
  cn: 14500, // China, CIA WFB
  ge: 310, // Georgia, CIA WFB
  hk: 733, // Hong Kong, CIA WFB
  id: 54720, // Indonesia, CIA WFB
  il: 273, // Israel, CIA WFB
  in: 7000, // India, CIA WFB
  iq: 58, // Iraq, CIA WFB
  ir: 2440, // Iran, CIA WFB (Persian Gulf/Gulf of Oman; excludes ~740 km Caspian)
  jo: 26, // Jordan, CIA WFB
  jp: 29751, // Japan, CIA WFB
  kg: 0, // Kyrgyzstan, landlocked
  kh: 443, // Cambodia, CIA WFB
  kp: 2495, // North Korea, CIA WFB
  kr: 2413, // South Korea, CIA WFB
  kw: 499, // Kuwait, CIA WFB
  kz: 1894, // Kazakhstan, CIA WFB Aral+Caspian coast
  la: 0, // Laos, landlocked
  lb: 225, // Lebanon, CIA WFB
  lk: 1340, // Sri Lanka, CIA WFB
  mm: 1930, // Myanmar, CIA WFB
  mn: 0, // Mongolia, landlocked
  mo: 41, // Macau, CIA WFB
  mv: 644, // Maldives, CIA WFB
  my: 4675, // Malaysia, CIA WFB
  np: 0, // Nepal, landlocked
  om: 2092, // Oman, CIA WFB
  ph: 36289, // Philippines, CIA WFB
  pk: 1046, // Pakistan, CIA WFB
  ps: 40, // State of Palestine, CIA WFB Gaza Strip coast (West Bank landlocked)
  qa: 563, // Qatar, CIA WFB
  sa: 2640, // Saudi Arabia, CIA WFB
  sg: 193, // Singapore, CIA WFB
  sy: 193, // Syria, CIA WFB
  th: 3219, // Thailand, CIA WFB
  tj: 0, // Tajikistan, landlocked
  tl: 706, // Timor-Leste, CIA WFB
  tm: 1768, // Turkmenistan, CIA WFB Caspian-Sea coast
  tr: 7200, // Türkiye, CIA WFB
  tw: 1566, // Taiwan, CIA WFB
  uz: 0, // Uzbekistan, double-landlocked
  vn: 3444, // Vietnam, CIA WFB
  ye: 1906, // Yemen, CIA WFB

  // ---- Europe ----
  ad: 0, // Andorra, landlocked
  al: 362, // Albania, CIA WFB
  at: 0, // Austria, landlocked
  ax: 4000, // Åland Islands, estimate: LOW CONFIDENCE, skerry archipelago, scale-sensitive
  ba: 20, // Bosnia and Herzegovina, CIA WFB
  be: 67, // Belgium, CIA WFB (66.5 km)
  bg: 354, // Bulgaria, CIA WFB
  by: 0, // Belarus, landlocked
  ch: 0, // Switzerland, landlocked
  cy: 648, // Cyprus, CIA WFB
  cz: 0, // Czechia, landlocked
  de: 2389, // Germany, CIA WFB
  dk: 7314, // Denmark (metropolitan), CIA WFB
  ee: 3794, // Estonia, CIA WFB
  es: 4964, // Spain, CIA WFB
  'es-ct': 580, // Catalonia, estimate: Costa Brava + Costa Daurada
  'es-ga': 1660, // Galicia, estimate: deeply indented Rías coast
  'es-pv': 150, // Basque Country, estimate: Basque autonomous community coast
  fi: 1250, // Finland, CIA WFB (mainland measure)
  fo: 1117, // Faroe Islands, CIA WFB
  fr: 3427, // France (metropolitan), CIA WFB
  gb: 12429, // United Kingdom, CIA WFB
  'gb-eng': 5500, // England, estimate: OS-derived, finer scale than WFB UK total
  'gb-nir': 650, // Northern Ireland, estimate: least of the four
  'gb-sct': 16500, // Scotland, estimate: ~16,500 km incl. ~800 islands (most of the four)
  'gb-wls': 2700, // Wales, estimate: OS-derived
  gg: 50, // Guernsey, CIA WFB
  gi: 12, // Gibraltar, CIA WFB
  gr: 13676, // Greece, CIA WFB
  hr: 5835, // Croatia, CIA WFB
  hu: 0, // Hungary, landlocked
  ic: 1500, // Canary Islands, estimate: across the seven main islands
  ie: 1448, // Ireland, CIA WFB
  im: 160, // Isle of Man, CIA WFB
  is: 4970, // Iceland, CIA WFB
  it: 7600, // Italy, CIA WFB
  je: 70, // Jersey, CIA WFB
  li: 0, // Liechtenstein, landlocked
  lt: 90, // Lithuania, CIA WFB
  lu: 0, // Luxembourg, landlocked
  lv: 498, // Latvia, CIA WFB
  mc: 4, // Monaco, CIA WFB (4.1 km)
  md: 0, // Moldova, landlocked (Danube river port only; Factbook 0 km coast)
  me: 294, // Montenegro, CIA WFB (293.5 km)
  mk: 0, // North Macedonia, landlocked
  mt: 197, // Malta, CIA WFB (196.8 km)
  nl: 451, // Netherlands (European), CIA WFB
  no: 25148, // Norway, CIA WFB (25,148 km; some eds. give 83,281 incl. fjords/islands)
  pl: 440, // Poland, CIA WFB
  pt: 1793, // Portugal, CIA WFB
  ro: 225, // Romania, CIA WFB
  rs: 0, // Serbia, landlocked
  ru: 37653, // Russia, CIA WFB
  se: 3218, // Sweden, CIA WFB
  si: 47, // Slovenia, CIA WFB (46.6 km)
  sj: 3711, // Svalbard and Jan Mayen, CIA WFB (Svalbard 3,587 + Jan Mayen 124)
  sk: 0, // Slovakia, landlocked
  sm: 0, // San Marino, landlocked
  ua: 2782, // Ukraine, CIA WFB
  va: 0, // Vatican City, landlocked
  xk: 0, // Kosovo, landlocked

  // ---- North America ----
  ag: 153, // Antigua and Barbuda, CIA WFB
  ai: 61, // Anguilla, CIA WFB
  aw: 69, // Aruba, CIA WFB (68.5 km)
  bb: 97, // Barbados, CIA WFB
  bl: 32, // Saint Barthélemy, estimate: ~21 km² island (no WFB coastline entry)
  bm: 103, // Bermuda, CIA WFB
  bq: 120, // Caribbean Netherlands (Bonaire/Saba/St Eustatius), estimate: sum of three islands
  bs: 3542, // Bahamas, CIA WFB
  bz: 386, // Belize, CIA WFB
  ca: 202080, // Canada, CIA WFB
  cp: 11, // Clipperton Island, CIA WFB (11.1 km)
  cr: 1290, // Costa Rica, CIA WFB
  cu: 3735, // Cuba, CIA WFB
  cw: 364, // Curaçao, CIA WFB
  dm: 148, // Dominica, CIA WFB
  do: 1288, // Dominican Republic, CIA WFB
  gd: 121, // Grenada, CIA WFB
  gl: 44087, // Greenland, CIA WFB
  gp: 306, // Guadeloupe, CIA WFB (older ed. standalone entry)
  gt: 400, // Guatemala, CIA WFB
  hn: 823, // Honduras, CIA WFB
  ht: 1771, // Haiti, CIA WFB
  jm: 1022, // Jamaica, CIA WFB
  kn: 135, // Saint Kitts and Nevis, CIA WFB
  ky: 160, // Cayman Islands, CIA WFB
  lc: 158, // Saint Lucia, CIA WFB
  mf: 45, // Saint Martin (French), estimate: French part of the island (no WFB entry)
  mq: 350, // Martinique, CIA WFB (older ed. standalone entry)
  ms: 40, // Montserrat, CIA WFB
  mx: 9330, // Mexico, CIA WFB
  ni: 910, // Nicaragua, CIA WFB
  pa: 2490, // Panama, CIA WFB
  pm: 120, // Saint Pierre and Miquelon, CIA WFB
  pr: 501, // Puerto Rico, CIA WFB
  sv: 307, // El Salvador, CIA WFB
  sx: 25, // Sint Maarten (Dutch), estimate: Dutch part of the island (no WFB entry)
  tc: 389, // Turks and Caicos Islands, CIA WFB
  tt: 362, // Trinidad and Tobago, CIA WFB
  us: 19924, // United States, CIA WFB
  vc: 84, // Saint Vincent and the Grenadines, CIA WFB
  vg: 80, // British Virgin Islands, CIA WFB
  vi: 188, // US Virgin Islands, CIA WFB

  // ---- South America ----
  ar: 4989, // Argentina, CIA WFB
  bo: 0, // Bolivia, landlocked
  br: 7491, // Brazil, CIA WFB
  cl: 6435, // Chile, CIA WFB
  co: 3208, // Colombia, CIA WFB
  ec: 2237, // Ecuador, CIA WFB
  fk: 1288, // Falkland Islands, CIA WFB
  gf: 378, // French Guiana, CIA WFB (older ed. standalone entry)
  gy: 459, // Guyana, CIA WFB
  pe: 2414, // Peru, CIA WFB
  py: 0, // Paraguay, landlocked
  sr: 386, // Suriname, CIA WFB
  uy: 660, // Uruguay, CIA WFB
  ve: 2800, // Venezuela, CIA WFB

  // ---- Oceania ----
  as: 116, // American Samoa, CIA WFB
  au: 25760, // Australia, CIA WFB
  cc: 26, // Cocos (Keeling) Islands, CIA WFB
  ck: 120, // Cook Islands, CIA WFB
  cx: 139, // Christmas Island, CIA WFB (138.9 km)
  fj: 1129, // Fiji, CIA WFB
  fm: 6112, // Micronesia, CIA WFB
  gu: 126, // Guam, CIA WFB (125.5 km)
  ki: 1143, // Kiribati, CIA WFB
  mh: 370, // Marshall Islands, CIA WFB (370.4 km)
  mp: 1482, // Northern Mariana Islands, CIA WFB
  nc: 2254, // New Caledonia, CIA WFB
  nf: 32, // Norfolk Island, CIA WFB
  nr: 30, // Nauru, CIA WFB
  nu: 64, // Niue, CIA WFB
  nz: 15134, // New Zealand, CIA WFB
  pf: 2525, // French Polynesia, CIA WFB
  pg: 5152, // Papua New Guinea, CIA WFB
  pn: 51, // Pitcairn, CIA WFB
  pw: 1519, // Palau, CIA WFB
  sb: 5313, // Solomon Islands, CIA WFB
  tk: 101, // Tokelau, CIA WFB
  to: 419, // Tonga, CIA WFB
  tv: 24, // Tuvalu, CIA WFB
  um: 90, // US Minor Outlying Islands, estimate: sum of the scattered islands (no single WFB figure)
  vu: 2528, // Vanuatu, CIA WFB
  wf: 129, // Wallis and Futuna, CIA WFB
  ws: 403, // Samoa, CIA WFB

  // ---- Antarctica ----
  aq: 17968, // Antarctica, CIA WFB
  bv: 30, // Bouvet Island, CIA WFB (29.6 km)
  gs: 850, // South Georgia and the South Sandwich Islands, estimate: fjorded South Georgia + island chain
  hm: 102, // Heard Island and McDonald Islands, CIA WFB (101.9 km)
  tf: 2800, // French Southern Territories, estimate: dominated by fjorded Kerguelen plus scattered islands
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
    if (c.code in COASTLINE_KM) {
      values[c.code] = COASTLINE_KM[c.code];
    } else {
      missing.push(`${c.code}:${c.name}`);
    }
  }
  const extra = Object.keys(COASTLINE_KM).filter((code) => !realCodes.has(code));

  // Stable, code-sorted output for minimal refresh diffs.
  const sorted = {};
  for (const code of Object.keys(values).sort()) sorted[code] = values[code];

  const metric = {
    key: 'coastline',
    label: 'Coastline length',
    unit: 'km',
    // 'plain' → exact kilometres with thousands separators (202,080 km). Compact
    // would collapse the archipelago giants to an indistinct "50K–200K"; the
    // point of the metric is the precise length, so keep it exact.
    format: 'plain',
    source:
      'Coastline length (kilometres) of each place, hand-curated from the CIA ' +
      'World Factbook "Coastline" field (Wikipedia "List of countries by length ' +
      'of coastline" mirrors it), rounded to whole km. Landlocked places carry 0. ' +
      'A few places with no Factbook entry (the UK home nations, Spanish regions, ' +
      'and some small dependencies / Antarctic archipelagos) are estimates',
    year: YEAR,
    values: sorted,
  };

  const outPath = join(REPO, 'flags', 'metrics', 'coastline.json');
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
      `  UNRESOLVED (${missing.length}) real places, add to COASTLINE_KM:\n    ` +
        missing.join('\n    '),
    );
    process.exit(1);
  }
}

main();
