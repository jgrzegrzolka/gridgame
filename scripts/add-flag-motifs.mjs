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
  // Two motif kinds today: 'animal' (any creature in the design) and
  // 'coat-of-arms' (heraldic shield / national emblem on the flag).
  // Many flags carry both — a coat of arms that contains an animal.
  // Errors expected — edit this map and re-run.
  ad: ['animal', 'coat-of-arms'],     // Andorra — quartered shield with cattle
  ai: ['animal'],                      // Anguilla — three dolphins
  al: ['animal'],                      // Albania — double-headed eagle
  as: ['animal'],                      // American Samoa — bald eagle
  bm: ['animal', 'coat-of-arms'],     // Bermuda — red lion + shipwreck
  bo: ['animal', 'coat-of-arms'],     // Bolivia — condor + alpaca on coa
  bt: ['animal'],                      // Bhutan — white dragon
  bz: ['coat-of-arms'],                // Belize — coa with loggers + tree
  dm: ['animal', 'coat-of-arms'],     // Dominica — coa with parrot
  ec: ['animal', 'coat-of-arms'],     // Ecuador — coa with condor + ship
  eg: ['animal'],                      // Egypt — eagle of Saladin
  es: ['animal', 'coat-of-arms'],     // Spain — royal coa with lions
  fj: ['animal', 'coat-of-arms'],     // Fiji — coa with lion + dove
  fk: ['animal', 'coat-of-arms'],     // Falkland Islands — coa with sheep
  gi: ['coat-of-arms'],                // Gibraltar — coa with castle + key
  gq: ['coat-of-arms'],                // Equatorial Guinea — coa with silk cotton tree
  gt: ['animal', 'coat-of-arms'],     // Guatemala — coa with quetzal
  ht: ['coat-of-arms'],                // Haiti — coa with palm + cannons
  ke: ['coat-of-arms'],                // Kenya — Maasai shield + spears
  ki: ['animal'],                      // Kiribati — frigate bird
  ky: ['animal', 'coat-of-arms'],     // Cayman Islands — coa with turtle
  kz: ['animal'],                      // Kazakhstan — golden eagle
  lk: ['animal'],                      // Sri Lanka — lion holding sword
  md: ['animal', 'coat-of-arms'],     // Moldova — eagle holding shield
  me: ['animal', 'coat-of-arms'],     // Montenegro — eagle + lion shield
  ms: ['coat-of-arms'],                // Montserrat — Erin + harp coa
  mx: ['animal', 'coat-of-arms'],     // Mexico — eagle/snake coa
  ni: ['coat-of-arms'],                // Nicaragua — triangle coa
  pa: ['coat-of-arms'],                // Panama — quartered with star + tools
  pe: ['animal', 'coat-of-arms'],     // Peru — coa with vicuña
  pg: ['animal'],                      // Papua New Guinea — bird of paradise
  pn: ['coat-of-arms'],                // Pitcairn — coa with anchor + Bible
  pt: ['coat-of-arms'],                // Portugal — coa with castles + shields
  py: ['coat-of-arms'],                // Paraguay — coa with star + palm
  rs: ['animal', 'coat-of-arms'],     // Serbia — eagle + shield coa
  sh: ['coat-of-arms'],                // Saint Helena aggregate — coa
  'sh-hl': ['coat-of-arms'],          // Saint Helena — coa
  'sh-ta': ['animal', 'coat-of-arms'], // Tristan da Cunha — coa with albatross
  si: ['coat-of-arms'],                // Slovenia — coa with Mt Triglav
  sk: ['coat-of-arms'],                // Slovakia — coa with cross + mountains
  sm: ['coat-of-arms'],                // San Marino — coa with 3 towers
  sv: ['coat-of-arms'],                // El Salvador — coa with mountains + flags
  sx: ['animal', 'coat-of-arms'],     // Sint Maarten — coa with pelican
  tc: ['animal', 'coat-of-arms'],     // Turks and Caicos — coa with lobster + conch
  ug: ['animal'],                      // Uganda — grey crowned crane
  vg: ['coat-of-arms'],                // Virgin Islands (BR) — coa with St Ursula + lamps
  vi: ['animal', 'coat-of-arms'],     // Virgin Islands (U.S.) — eagle coa
  'gb-wls': ['animal'],                // Wales — red dragon
  zm: ['animal'],                      // Zambia — African fish eagle
  zw: ['animal'],                      // Zimbabwe — Zimbabwe Bird
};

const PALETTE = new Set(['animal', 'coat-of-arms']);

const path = 'flags/countries.json';
const countries = JSON.parse(readFileSync(path, 'utf-8'));

for (const c of countries) {
  const tagged = MOTIFS[c.code];
  if (!tagged) {
    c.motifs = [];
    continue;
  }
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
  c.motifs = filtered;
}

writeFileSync(path, JSON.stringify(countries, null, 2) + '\n');

const tagCount = Object.keys(MOTIFS).length;
console.log(`Tagged motifs on ${tagCount} countries (others get motifs: []).`);
