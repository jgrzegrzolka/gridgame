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
  // Confidence: flags where an animal is clearly depicted (often as
  // part of a coat of arms on the flag itself, but the animal is
  // visible enough that a child would name it). Errors expected —
  // edit this map and re-run.
  ad: ['animal'],         // Andorra — eagle in coat of arms
  ai: ['animal'],         // Anguilla — three dolphins
  al: ['animal'],         // Albania — double-headed eagle
  as: ['animal'],         // American Samoa — bald eagle
  bm: ['animal'],         // Bermuda — red lion
  bo: ['animal'],         // Bolivia — condor (coat of arms)
  bt: ['animal'],         // Bhutan — white dragon
  dm: ['animal'],         // Dominica — sisserou parrot
  ec: ['animal'],         // Ecuador — condor (coat of arms)
  eg: ['animal'],         // Egypt — eagle of Saladin
  es: ['animal'],         // Spain — lions in coat of arms
  fj: ['animal'],         // Fiji — lion + dove in coat of arms
  fk: ['animal'],         // Falkland Islands — sheep
  gt: ['animal'],         // Guatemala — quetzal
  ki: ['animal'],         // Kiribati — frigate bird
  ky: ['animal'],         // Cayman Islands — turtle in coat of arms
  kz: ['animal'],         // Kazakhstan — golden eagle
  lk: ['animal'],         // Sri Lanka — lion holding sword
  md: ['animal'],         // Moldova — eagle
  me: ['animal'],         // Montenegro — double-headed eagle
  mx: ['animal'],         // Mexico — eagle with snake
  pe: ['animal'],         // Peru — vicuña (coat of arms)
  pg: ['animal'],         // Papua New Guinea — bird of paradise
  rs: ['animal'],         // Serbia — double-headed eagle
  'sh-ta': ['animal'],    // Tristan da Cunha — albatross (coat of arms)
  sx: ['animal'],         // Sint Maarten — pelican
  tc: ['animal'],         // Turks and Caicos — lobster (coat of arms)
  ug: ['animal'],         // Uganda — grey crowned crane
  vi: ['animal'],         // Virgin Islands (U.S.) — eagle
  'gb-wls': ['animal'],   // Wales — red dragon
  zm: ['animal'],         // Zambia — African fish eagle
  zw: ['animal'],         // Zimbabwe — Zimbabwe Bird
};

const PALETTE = new Set(['animal']);

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
