// One-shot: merge a code → motifs map into flags/countries.json.
//
// Same shape as add-flag-colors.mjs but for flag motifs (animal,
// eventually coat-of-arms, weapon). Re-runnable: setting a `motifs`
// field that already exists overwrites it. Codes not in the map get
// `motifs: []` so the predicate can return false cleanly.
//
// Run:   node scripts/add-flag-motifs.mjs

import { readFileSync, writeFileSync } from 'node:fs';

/** @type {Record<string, string[]>} */
const MOTIFS = {
  // Four motif kinds today: 'animal' (any creature in the design),
  // 'coat-of-arms' (heraldic shield / national emblem on the flag),
  // 'weapon' (sword, dagger, gun, spear, trident, cannon, etc.),
  // and 'star-or-moon' (any star shape — pentagram, hexagram, Southern
  // Cross — or any moon — crescent or full disk). Sun emblems do NOT
  // count as 'star-or-moon' (Japan, Argentina, Uruguay, North Macedonia,
  // Kazakhstan, etc.). The 'star-or-moon' tag is applied via the
  // STAR_OR_MOON set below, so this dict stays focused on the heraldic
  // motifs and the diff for star-or-moon stays in one place.
  // A single flag often carries several — e.g. a coat of arms with a
  // sword-wielding lion is animal + coa + weapon.
  // Errors expected — edit this map and re-run.
  ad: ['animal', 'coat-of-arms'],                  // Andorra — quartered shield with cattle
  ai: ['animal'],                                   // Anguilla — three dolphins
  al: ['animal'],                                   // Albania — double-headed eagle
  ao: ['weapon'],                                   // Angola — machete (coa)
  as: ['animal', 'coat-of-arms', 'weapon'],        // American Samoa — bald eagle holding war club + fly whisk
  bb: ['weapon'],                                   // Barbados — broken trident head
  bm: ['animal', 'coat-of-arms'],                  // Bermuda — red lion + shipwreck
  bn: ['coat-of-arms'],                             // Brunei — state emblem (hands + crown + parasol + feathers)
  bo: ['animal', 'coat-of-arms', 'weapon'],        // Bolivia — condor + cannons/arrows/axe
  bt: ['animal'],                                   // Bhutan — white dragon
  bz: ['coat-of-arms'],                             // Belize — coa with loggers + tree
  dm: ['animal', 'coat-of-arms'],                  // Dominica — coa with parrot
  do: ['coat-of-arms'],                             // Dominican Republic — central coa with bible, cross, flags, palm
  ec: ['animal', 'coat-of-arms', 'weapon'],        // Ecuador — coa with condor + ship + fasces (axe)
  eg: ['animal', 'coat-of-arms'],                  // Egypt — Eagle of Saladin national emblem
  es: ['animal', 'coat-of-arms'],                  // Spain — royal coa with lions
  fj: ['animal', 'coat-of-arms'],                  // Fiji — coa with lion + dove
  fk: ['animal', 'coat-of-arms'],                  // Falkland Islands — coa with sheep
  gi: ['coat-of-arms'],                             // Gibraltar — coa with castle + key
  gq: ['coat-of-arms'],                             // Equatorial Guinea — coa with silk cotton tree
  gs: ['animal', 'coat-of-arms'],                  // South Georgia and the South Sandwich Islands — coa with lion + reindeer + seal + penguin
  gt: ['animal', 'coat-of-arms', 'weapon'],        // Guatemala — coa with quetzal + rifles + sword
  gu: ['coat-of-arms'],                             // Guam — Seal of Guam (proa + palm + Two Lovers Point)
  hr: ['coat-of-arms'],                             // Croatia — checkered shield + crown of 5 regional shields
  ht: ['coat-of-arms', 'weapon'],                  // Haiti — coa with palm + cannons
  ir: ['coat-of-arms'],                             // Iran — stylised "Allah" national emblem
  je: ['animal', 'coat-of-arms'],                  // Jersey — crowned shield with three Plantagenet leopards (lions passant)
  ke: ['coat-of-arms', 'weapon'],                  // Kenya — Maasai shield + spears
  kh: ['coat-of-arms'],                             // Cambodia — Angkor Wat as national emblem
  ki: ['animal'],                                   // Kiribati — frigate bird
  ky: ['animal', 'coat-of-arms'],                  // Cayman Islands — coa with turtle
  kz: ['animal', 'coat-of-arms'],                  // Kazakhstan — eagle-on-sun national emblem
  lk: ['animal', 'coat-of-arms', 'weapon'],        // Sri Lanka — lion holding sword, bo-leaves frame
  md: ['animal', 'coat-of-arms'],                  // Moldova — eagle holding shield
  me: ['animal', 'coat-of-arms'],                  // Montenegro — eagle + lion shield
  mn: ['coat-of-arms'],                             // Mongolia — Soyombo national emblem
  ms: ['coat-of-arms'],                             // Montserrat — Erin + harp coa
  mt: ['animal', 'weapon'],                         // Malta — George Cross emblem (St. George on horseback slaying a dragon, sword raised)
  mx: ['animal', 'coat-of-arms'],                  // Mexico — eagle/snake coa
  mz: ['weapon'],                                   // Mozambique — AK-47 + hoe
  ni: ['coat-of-arms'],                             // Nicaragua — triangle coa
  om: ['weapon'],                                   // Oman — crossed khanjar daggers
  pe: ['animal', 'coat-of-arms'],                  // Peru — coa with vicuña
  pf: ['coat-of-arms'],                             // French Polynesia — outrigger canoe + sun emblem
  pg: ['animal'],                                   // Papua New Guinea — bird of paradise
  pn: ['coat-of-arms'],                             // Pitcairn — coa with anchor + Bible
  pt: ['coat-of-arms'],                             // Portugal — coa with castles + shields
  py: ['coat-of-arms'],                             // Paraguay — coa with star + palm
  rs: ['animal', 'coat-of-arms'],                  // Serbia — eagle + shield coa
  sa: ['coat-of-arms', 'weapon'],                  // Saudi Arabia — sword + shahada national emblem
  // sh (Saint Helena, Ascension and Tristan da Cunha — combined) ships a
  // plain Union Jack SVG with no coat of arms, so no heraldic motifs
  // apply to the visible artwork. Tag only via the CROSS / UNION_JACK
  // sets, which are derived from the UJ itself.
  'sh-hl': ['animal', 'coat-of-arms'],             // Saint Helena — coa with wirebird
  'sh-ac': ['animal', 'coat-of-arms'],             // Ascension Island — coa with turtle
  'sh-ta': ['animal', 'coat-of-arms'],             // Tristan da Cunha — coa with albatross
  si: ['coat-of-arms'],                             // Slovenia — coa with Mt Triglav
  sk: ['coat-of-arms'],                             // Slovakia — coa with cross + mountains
  sm: ['coat-of-arms'],                             // San Marino — coa with 3 towers
  sv: ['coat-of-arms'],                             // El Salvador — coa with mountains + flags
  sx: ['animal', 'coat-of-arms'],                  // Sint Maarten — coa with pelican
  sz: ['weapon'],                                   // Eswatini — assegai spears + shield
  tc: ['animal', 'coat-of-arms'],                  // Turks and Caicos — coa with lobster + conch
  tj: ['coat-of-arms'],                             // Tajikistan — crown + stars emblem
  ug: ['animal'],                                   // Uganda — grey crowned crane
  va: ['coat-of-arms'],                             // Vatican City — papal tiara + crossed keys of Saint Peter (issue #58)
  vg: ['coat-of-arms'],                             // Virgin Islands (BR) — coa with St Ursula + lamps
  vi: ['animal', 'coat-of-arms'],                  // Virgin Islands (U.S.) — eagle coa
  vu: ['coat-of-arms'],                             // Vanuatu — boar's tusk + namele leaves emblem (tusk is a prosperity symbol, not a weapon)
  'gb-wls': ['animal'],                             // Wales — red dragon
  zm: ['animal'],                                   // Zambia — African fish eagle
  zw: ['animal'],                                   // Zimbabwe — Zimbabwe Bird
};

const PALETTE = new Set(['animal', 'coat-of-arms', 'weapon', 'star-or-moon', 'cross', 'union-jack']);

// Flags with a visible star (pentagram, hexagram, Southern Cross, etc.)
// or a moon (crescent or full disk). Kept as a flat set rather than
// merged into MOTIFS so a single visual category lives in one place.
// Sun emblems are NOT included (Japan, Argentina, Uruguay, Bangladesh,
// Kazakhstan, North Macedonia, Niger, Rwanda, Taiwan, Antigua, etc.).
const STAR_OR_MOON = new Set([
  // Africa
  'ao', 'dz', 'bf', 'cm', 'cf', 'km', 'cd', 'dj', 'eh', 'gh', 'gw', 'lr',
  'ly', 'ma', 'mr', 'mz', 'sn', 'so', 'ss', 'tg', 'tn', 'cv', 'zw',
  'st', 'et', 'bi',
  // Asia
  'az', 'cn', 'il', 'jo', 'kp', 'mn', 'mv', 'my', 'np', 'pk', 'ph', 'sg',
  'sy', 'tj', 'tm', 'tr', 'uz', 'vn', 'tl',
  'mm', 'hk', 'mo',
  // Europe
  'ba', 'si', 'xk', 'hr',
  // North America (incl. territories)
  'cu', 'gd', 'hn', 'kn', 'pa', 'pr', 'us', 'aw',
  'cw',
  // South America
  'br', 'cl', 'py', 'sr', 've',
  // Oceania
  'au', 'ck', 'fm', 'mh', 'mp', 'nr', 'nu', 'nz', 'pg', 'pw', 'sb', 'tv', 'ws',
  'cx', 'tk', 'um', 'cc',
  // Antarctica
  'tf', 'hm',
  // Other / supranational
  'eu',
]);

// Flags with a visible Christian/Latin/Greek cross or saltire (X-cross) as
// part of the design — including Scandinavian crosses, Union Jack canton
// ensigns (which inherit the St George + St Andrew + St Patrick combo),
// and any country flag where a cross is a primary design element.
// Excluded: crossed keys (Vatican), crossed swords inside a coat of arms
// (already covered by 'weapon'), the Welsh dragon flag, and civil flags
// without the Union Jack (Gibraltar's castle-and-key).
const CROSS = new Set([
  // Europe — Scandinavian crosses (incl. Norway-pattern dependencies)
  'dk', 'fi', 'fo', 'is', 'no', 'se', 'ax', 'sj',
  // Europe — other standalone crosses + Basque ikurriña
  'ch', 'gr', 'mt', 'es-pv',
  // Europe — UK family + Crown Dependencies
  'gb', 'gb-eng', 'gb-sct', 'gb-nir', 'gg', 'je',
  // Asia
  'ge',
  // Africa — Burundi saltire + BIOT + Saint Helena/Ascension/Tristan ensigns
  'bi', 'io', 'sh', 'sh-hl', 'sh-ac', 'sh-ta',
  // North America — saltires, quartering crosses, Union Jack canton ensigns
  'jm', 'dm', 'do',
  'ai', 'bm', 'ky', 'ms', 'tc', 'vg',
  // South America — Falkland Islands ensign
  'fk',
  // Antarctica — Bouvet (Norway pattern), South Georgia ensign,
  //             Heard Island and McDonald Islands (Australian ensign)
  'bv', 'gs', 'hm',
  // Oceania — sovereign + Union Jack canton ensigns + Tonga
  'au', 'nz', 'fj', 'ck', 'nu', 'tv', 'pn', 'to',
]);

// Flags whose design includes the Union Jack itself — either as the
// whole flag (gb) or as a canton on a blue / red ensign. A strict
// subset of CROSS, since the Union Jack is made of three crosses.
// Excluded: stand-alone English / Scottish / Northern Irish flags
// (gb-eng / gb-sct / gb-nir), the Wales dragon (gb-wls), Crown
// Dependencies whose flags don't use the UJ (Guernsey / Jersey /
// Isle of Man), Tonga (its canton is a plain red Greek cross, not a
// UJ), and Bouvet (Norway pattern).
const UNION_JACK = new Set([
  // The UK itself
  'gb',
  // British Indian Ocean Territory
  'io',
  // Caribbean BOTs
  'ai', 'bm', 'ky', 'ms', 'tc', 'vg',
  // South Atlantic
  'fk', 'gs',
  // Saint Helena, Ascension and Tristan da Cunha (combined + each constituent)
  'sh', 'sh-hl', 'sh-ac', 'sh-ta',
  // Oceania — sovereign + Union Jack canton ensigns
  'au', 'nz', 'fj', 'ck', 'nu', 'tv', 'pn',
  // Heard Island and McDonald Islands — uses the Australian flag, so inherits the UJ canton
  'hm',
]);

const path = 'flags/countries.json';
const countries = JSON.parse(readFileSync(path, 'utf-8'));

for (const c of countries) {
  const tagged = MOTIFS[c.code] ?? [];
  const seen = new Set();
  /** @type {string[]} */
  const filtered = [];
  for (const motif of tagged) {
    if (!PALETTE.has(motif)) {
      throw new Error(`Motif '${motif}' for code '${c.code}' is not in the palette`);
    }
    if (seen.has(motif)) continue;
    seen.add(motif);
    filtered.push(motif);
  }
  if (STAR_OR_MOON.has(c.code) && !seen.has('star-or-moon')) {
    filtered.push('star-or-moon');
  }
  if (CROSS.has(c.code) && !seen.has('cross')) {
    filtered.push('cross');
  }
  if (UNION_JACK.has(c.code) && !seen.has('union-jack')) {
    filtered.push('union-jack');
  }
  c.motifs = filtered;
}

writeFileSync(path, JSON.stringify(countries, null, 2) + '\n');

const heraldicCount = Object.keys(MOTIFS).length;
const somCount = STAR_OR_MOON.size;
const crossCount = CROSS.size;
const ujCount = UNION_JACK.size;
console.log(
  `Tagged heraldic motifs on ${heraldicCount} countries; star-or-moon on ${somCount}; cross on ${crossCount}; union-jack on ${ujCount} (others get motifs: []).`,
);
