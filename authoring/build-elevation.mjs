/**
 * Regenerates flags/metrics/elevation.json, the highest elevation (metres above
 * sea level) of each place's highest point.
 *
 * Unlike population / area / GDP there is no live indicator API for "highest
 * point"; it is a static physical fact per place. So this is a fully
 * hand-curated table (HIGHEST_POINT_M below), joined to flags/countries.json by
 * ISO code, with each peak named in a comment for verifiability at refresh time.
 * Standard references: Wikipedia "List of elevation extremes by country", the
 * CIA World Factbook, and national geographic surveys. Metres, rounded to whole
 * numbers (sub-metre precision is noise even for the flattest atolls).
 *
 * DATA CONTRACT: elevation is *dense*, the mirror of area / GDP. Every real
 * place (`category !== 'other'`) has a highest point, so every one carries a
 * value and only the non-place org flags are left bare. That keeps "no data ==
 * not a place", the invariant the TTT picker's no-data guard leans on
 * (metricTiers.js `metricDataGap`). There is NO `absence: 'zero'` hint: absence
 * here would mean "unsourced", never zero (no real place sits exactly at sea
 * level; the lowest highpoint, the Maldives, is ~2 m). So the table below must
 * cover every real place, and this script errors if one is missing.
 *
 * The metric is deliberately two-directional, like area: both extremes make good
 * questions. "Highest peak" tops out at Everest (Nepal / China, 8,849 m); the fun
 * "lowest highpoint" bottoms out at the Maldives (2 m), Tuvalu / Tokelau (5 m),
 * and the low coral atolls.
 *
 * Values are sorted by code on emit for minimal diffs. Elevations barely change,
 * so this is effectively frozen; re-run only if a figure is corrected or a place
 * is added to countries.json.
 *
 * See DATA_FEATURE.md "Feature DL" and the add-world-metric skill for the map.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..');

// Static curation snapshot year (elevation is not year-bound; this only
// satisfies the self-describing metric schema's `year` field).
const YEAR = 2024;

/**
 * Highest point (metres above sea level) of every real place, keyed by our ISO
 * 3166-1 alpha-2 flag code. Each value names its peak so a refresh can be
 * checked line by line. Grouped by continent for navigability; the emitted JSON
 * is sorted by code. Uninhabited territories carry the real elevation of their
 * highest land, not omission.
 * @type {Record<string, number>}
 */
const HIGHEST_POINT_M = {
  // ---- Africa ----
  dz: 2908, // Mount Tahat
  ao: 2620, // Mount Moco
  bj: 658, // Mont Sokbaro
  bw: 1491, // Otse Hill
  bf: 749, // Ténakourou
  bi: 2684, // Mount Heha
  cv: 2829, // Pico do Fogo
  cm: 4095, // Mount Cameroon
  cf: 1410, // Mont Ngaoui
  td: 3415, // Emi Koussi
  km: 2361, // Mount Karthala
  cg: 1020, // Mont Nabemba
  cd: 5109, // Margherita Peak (Mount Stanley)
  ci: 1752, // Mount Nimba
  dj: 2028, // Mousa Ali
  eg: 2629, // Mount Catherine
  gq: 3011, // Pico Basile
  er: 3018, // Emba Soira
  sz: 1862, // Emlembe
  et: 4550, // Ras Dashen
  ga: 1070, // Mont Bengoué
  gm: 53, // unnamed elevation
  gh: 885, // Mount Afadja (Afadjato)
  gn: 1752, // Mount Nimba
  gw: 300, // unnamed elevation near Boé
  ke: 5199, // Batian, Mount Kenya
  ls: 3482, // Thabana Ntlenyana
  lr: 1440, // Mount Wuteve
  ly: 2267, // Bikku Bitti
  mg: 2876, // Maromokotro
  mw: 3002, // Sapitwa, Mount Mulanje
  ml: 1155, // Hombori Tondo
  mr: 915, // Kediet ej Jill
  mu: 828, // Piton de la Petite Rivière Noire
  yt: 660, // Mont Benara
  ma: 4167, // Toubkal
  mz: 2436, // Monte Binga
  na: 2573, // Königstein, Brandberg
  ne: 2022, // Mont Idoukal-n-Taghès
  ng: 2419, // Chappal Waddi
  re: 3069, // Piton des Neiges
  rw: 4507, // Mount Karisimbi
  sh: 2062, // Queen Mary's Peak (Tristan da Cunha, whole territory)
  'sh-hl': 818, // Diana's Peak, Saint Helena island
  'sh-ac': 859, // Green Mountain, Ascension Island
  'sh-ta': 2062, // Queen Mary's Peak, Tristan da Cunha
  st: 2024, // Pico de São Tomé
  sn: 648, // unnamed elevation near Nepen Diakha
  sc: 905, // Morne Seychellois
  sl: 1948, // Mount Bintumani (Loma Mansa)
  so: 2416, // Shimbiris
  za: 3450, // Mafadi
  ss: 3187, // Kinyeti
  sd: 3042, // Deriba Caldera, Jebel Marra
  tz: 5895, // Kilimanjaro (Uhuru Peak)
  tg: 986, // Mont Agou
  tn: 1544, // Jebel ech Chambi
  ug: 5109, // Margherita Peak (Mount Stanley)
  eh: 805, // unnamed elevation
  zm: 2339, // Mafinga Central, Mafinga Hills
  zw: 2592, // Mount Nyangani
  io: 9, // unnamed rise, Diego Garcia (British Indian Ocean Territory)

  // ---- Asia ----
  af: 7492, // Noshaq
  am: 4090, // Mount Aragats
  az: 4466, // Bazardüzü
  bh: 122, // Jabal ad Dukhan
  bd: 1052, // Saka Haphong
  bt: 7570, // Gangkhar Puensum
  bn: 1850, // Bukit Pagon
  kh: 1810, // Phnom Aural
  cn: 8849, // Mount Everest
  ge: 5193, // Shkhara
  hk: 957, // Tai Mo Shan
  in: 8586, // Kangchenjunga
  id: 4884, // Puncak Jaya
  ir: 5610, // Mount Damavand
  iq: 3611, // Cheekha Dar
  il: 1208, // Mount Meron
  jp: 3776, // Mount Fuji
  jo: 1854, // Jabal Umm ad Dami
  kz: 7010, // Khan Tengri
  kw: 306, // Mutla Ridge
  kg: 7439, // Jengish Chokusu (Pik Pobedy)
  la: 2819, // Phou Bia
  lb: 3088, // Qurnat as Sawda
  mo: 172, // Alto de Coloane
  my: 4095, // Mount Kinabalu
  mv: 2, // unnamed point on Villingili (lowest highpoint on Earth)
  mn: 4374, // Khüiten Peak
  mm: 5881, // Hkakabo Razi
  np: 8849, // Mount Everest
  kp: 2744, // Paektu Mountain
  om: 3009, // Jabal Shams
  pk: 8611, // K2
  ph: 2954, // Mount Apo
  qa: 103, // Qurayn Abu al Bawl
  sa: 3000, // Jabal Sawda
  sg: 164, // Bukit Timah Hill
  kr: 1947, // Hallasan
  lk: 2524, // Pidurutalagala
  ps: 1030, // Mount Nabi Yunis (West Bank)
  sy: 2814, // Mount Hermon (Syrian side)
  tw: 3952, // Yu Shan (Jade Mountain)
  tj: 7495, // Ismoil Somoni Peak
  th: 2565, // Doi Inthanon
  tl: 2963, // Tatamailau (Mount Ramelau)
  tr: 5137, // Mount Ararat
  tm: 3138, // Aýrybaba
  ae: 1934, // Jabal Jais
  uz: 4643, // Khazret Sultan
  vn: 3147, // Fansipan
  ye: 3666, // Jabal An-Nabi Shu'ayb

  // ---- Europe ----
  ax: 129, // Orrdalsklint
  al: 2764, // Maja e Korabit (Korab)
  ad: 2942, // Coma Pedrosa
  at: 3798, // Grossglockner
  by: 345, // Dzyarzhynskaya Hara
  be: 694, // Signal de Botrange
  ba: 2386, // Maglić
  bg: 2925, // Musala
  hr: 1831, // Dinara
  cy: 1952, // Mount Olympus (Chionistra)
  cz: 1603, // Sněžka
  dk: 171, // Møllehøj (metropolitan Denmark)
  'gb-eng': 978, // Scafell Pike
  ee: 318, // Suur Munamägi
  fo: 880, // Slættaratindur
  fi: 1324, // Halti
  fr: 4808, // Mont Blanc (metropolitan France)
  'es-ga': 2127, // Pena Trevinca
  de: 2962, // Zugspitze
  gi: 426, // Rock of Gibraltar
  gr: 2917, // Mytikas, Mount Olympus
  gg: 114, // highest point on Sark (Bailiwick of Guernsey)
  hu: 1014, // Kékes
  is: 2110, // Hvannadalshnúkur
  ie: 1039, // Carrauntoohil
  im: 621, // Snaefell
  it: 4808, // Monte Bianco (Mont Blanc)
  je: 143, // Les Platons
  xk: 2656, // Đeravica
  lv: 312, // Gaiziņkalns
  li: 2599, // Vorder-Grauspitz
  lt: 294, // Aukštojas Hill
  lu: 560, // Kneiff
  mt: 253, // Ta' Dmejrek
  md: 430, // Bălănești Hill
  mc: 161, // Chemin des Révoires
  me: 2534, // Zla Kolata
  nl: 322, // Vaalserberg (European Netherlands)
  mk: 2764, // Mount Korab
  'gb-nir': 850, // Slieve Donard
  no: 2469, // Galdhøpiggen
  pl: 2501, // Rysy
  pt: 2351, // Ponta do Pico (Azores)
  ro: 2544, // Moldoveanu Peak
  ru: 5642, // Mount Elbrus
  sm: 739, // Monte Titano
  'gb-sct': 1345, // Ben Nevis
  rs: 2169, // Midžor (Serbia proper)
  sk: 2655, // Gerlachovský štít
  si: 2864, // Mount Triglav
  es: 3718, // Teide (Tenerife)
  ic: 3718, // Teide (Canary Islands)
  'es-ct': 3143, // Pica d'Estats
  'es-pv': 1551, // Aitxuri
  sj: 2277, // Beerenberg (Jan Mayen)
  se: 2096, // Kebnekaise (south peak)
  ch: 4634, // Dufourspitze (Monte Rosa)
  ua: 2061, // Hoverla
  gb: 1345, // Ben Nevis
  va: 75, // Vatican Hill
  'gb-wls': 1085, // Yr Wyddfa (Snowdon)

  // ---- North America ----
  ai: 73, // Crocus Hill
  ag: 402, // Mount Obama (Boggy Peak)
  aw: 188, // Jamanota
  bs: 63, // Mount Alvernia
  bb: 336, // Mount Hillaby
  bz: 1124, // Doyle's Delight
  bm: 76, // Town Hill
  bq: 887, // Mount Scenery, Saba (Caribbean Netherlands)
  ca: 5959, // Mount Logan
  ky: 43, // The Bluff, Cayman Brac
  cp: 29, // Clipperton Rock
  cr: 3820, // Cerro Chirripó
  cu: 1974, // Pico Turquino
  cw: 372, // Christoffelberg
  dm: 1447, // Morne Diablotins
  do: 3098, // Pico Duarte
  sv: 2730, // Cerro El Pital
  gl: 3694, // Gunnbjørn Fjeld
  gd: 840, // Mount Saint Catherine
  gp: 1467, // La Grande Soufrière
  gt: 4220, // Volcán Tajumulco
  ht: 2680, // Pic la Selle
  hn: 2870, // Cerro Las Minas
  jm: 2256, // Blue Mountain Peak
  mq: 1397, // Mount Pelée
  mx: 5636, // Pico de Orizaba
  ms: 915, // Soufrière Hills
  ni: 2107, // Mogotón
  pa: 3475, // Volcán Barú
  pr: 1338, // Cerro de Punta
  bl: 286, // Morne du Vitet
  kn: 1156, // Mount Liamuiga
  lc: 950, // Mount Gimie
  mf: 424, // Pic Paradis
  pm: 240, // Morne de la Grande Montagne
  vc: 1234, // La Soufrière
  sx: 386, // Flagstaff Hill
  tt: 940, // El Cerro del Aripo
  tc: 48, // Flamingo Hill, East Caicos
  us: 6190, // Denali
  vg: 521, // Mount Sage
  vi: 474, // Crown Mountain

  // ---- South America ----
  ar: 6961, // Aconcagua
  bo: 6542, // Nevado Sajama
  br: 2995, // Pico da Neblina
  cl: 6893, // Ojos del Salado
  co: 5730, // Pico Cristóbal Colón
  ec: 6263, // Chimborazo
  fk: 705, // Mount Usborne
  gf: 851, // Bellevue de l'Inini
  gy: 2810, // Mount Roraima
  py: 842, // Cerro Peró
  pe: 6768, // Huascarán
  sr: 1230, // Julianatop
  uy: 514, // Cerro Catedral
  ve: 4978, // Pico Bolívar

  // ---- Oceania ----
  as: 964, // Lata Mountain
  au: 2228, // Mount Kosciuszko (mainland)
  cx: 361, // Murray Hill, Christmas Island
  cc: 9, // unnamed rise, Cocos (Keeling) Islands
  ck: 652, // Te Manga, Rarotonga
  fm: 791, // Nanlaud (Dolohmwar), Pohnpei
  fj: 1324, // Tomanivi
  pf: 2241, // Mont Orohena, Tahiti
  gu: 406, // Mount Lamlam
  ki: 81, // unnamed rise, Banaba
  mh: 10, // unnamed rise, Likiep
  nr: 71, // Command Ridge
  nc: 1629, // Mont Panié
  nz: 3724, // Aoraki / Mount Cook
  nu: 68, // unnamed elevation
  nf: 319, // Mount Bates
  mp: 965, // Mount Agrihan
  pw: 242, // Mount Ngerchelchuus
  pg: 4509, // Mount Wilhelm
  pn: 347, // Pawala Valley Ridge
  ws: 1858, // Mount Silisili
  sb: 2335, // Mount Popomanaseu
  tk: 5, // unnamed rise, Tokelau
  to: 1046, // Kao
  tv: 5, // unnamed rise, Tuvalu
  vu: 1879, // Mount Tabwemasana
  wf: 524, // Mont Puke, Futuna
  um: 10, // unnamed rise, US Minor Outlying Islands

  // ---- Antarctica (uninhabited territories: real land elevation) ----
  aq: 4892, // Vinson Massif
  bv: 780, // Olavtoppen, Bouvet Island
  hm: 2745, // Mawson Peak, Heard Island
  tf: 1850, // Mont Ross, Kerguelen (French Southern Territories)
  gs: 2934, // Mount Paget, South Georgia
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
    if (c.code in HIGHEST_POINT_M) {
      values[c.code] = HIGHEST_POINT_M[c.code];
    } else {
      missing.push(`${c.code}:${c.name}`);
    }
  }
  const extra = Object.keys(HIGHEST_POINT_M).filter((code) => !realCodes.has(code));

  // Stable, code-sorted output for minimal refresh diffs.
  const sorted = {};
  for (const code of Object.keys(values).sort()) sorted[code] = values[code];

  const metric = {
    key: 'elevation',
    label: 'Highest elevation',
    unit: 'm',
    // 'plain' → exact metres with thousands separators (8,849 m). Compact would
    // collapse Everest / K2 / Kangchenjunga to an identical "8.6K–8.8K"; the
    // whole point of this metric is the precise height, so keep it exact.
    format: 'plain',
    source:
      'Highest point (metres above sea level) of each place, hand-curated from ' +
      "standard references (Wikipedia \"List of elevation extremes by country\", " +
      'CIA World Factbook, national surveys). A static physical fact, rounded to ' +
      'whole metres',
    year: YEAR,
    values: sorted,
  };

  const outPath = join(REPO, 'flags', 'metrics', 'elevation.json');
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
      `  UNRESOLVED (${missing.length}) real places, add to HIGHEST_POINT_M:\n    ` +
        missing.join('\n    '),
    );
    process.exit(1);
  }
}

main();
