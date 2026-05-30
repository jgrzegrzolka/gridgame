// One-shot migration: enrich flags/countries.json with
// `continent`, `category`, and `statehood` fields.
//
// Run with: node scripts/migrate-countries.mjs
//
// The script is idempotent — re-running it produces the same output.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataPath = join(__dirname, '..', 'flags', 'countries.json');

// Sub-national, supranational, or pseudo entries — render in the "Other" section.
const OTHER_CODES = new Set([
  'asean',  // Association of Southeast Asian Nations
  'arab',   // League of Arab States
  'cefta',  // Central European Free Trade Agreement
  'eac',    // East African Community
  'eu',     // European Union
  'pc',     // Pacific Community
  'un',     // United Nations
  'es-pv',  // Basque Country
  'es-ct',  // Catalonia
  'es-ga',  // Galicia
  'ic',     // Canary Islands
  'gb-eng', // England
  'gb-nir', // Northern Ireland
  'gb-sct', // Scotland
  'gb-wls', // Wales
]);

// Statehood classification (only consulted when category === 'country').
const UN_OBSERVERS = new Set(['va', 'ps']);
const NON_UN = new Set(['tw', 'xk']);
const TERRITORIES = new Set([
  'ax', 'as', 'ai', 'aq', 'aw', 'sh-ac', 'bm', 'bq', 'bv', 'io',
  'ky', 'cx', 'cp', 'cc', 'ck', 'cw', 'dg', 'fk', 'fo', 'gf',
  'pf', 'tf', 'gi', 'gl', 'gp', 'gu', 'gg', 'hm', 'hk', 'im',
  'je', 'mo', 'mq', 'yt', 'ms', 'nc', 'nu', 'nf', 'mp', 'pn',
  'pr', 're', 'bl', 'sh-hl', 'sh', 'mf', 'pm', 'sx', 'gs', 'sj',
  'tk', 'sh-ta', 'tc', 'um', 'vg', 'vi', 'wf', 'eh',
]);

// ISO 3166-1 alpha-2 → continent (7-continent model, Americas split).
const CONTINENT = {
  // Africa
  dz: 'Africa', ao: 'Africa', bj: 'Africa', bw: 'Africa', bf: 'Africa',
  bi: 'Africa', cv: 'Africa', cm: 'Africa', cf: 'Africa', td: 'Africa',
  km: 'Africa', cg: 'Africa', cd: 'Africa', ci: 'Africa', dj: 'Africa',
  eg: 'Africa', gq: 'Africa', er: 'Africa', sz: 'Africa', et: 'Africa',
  ga: 'Africa', gm: 'Africa', gh: 'Africa', gn: 'Africa', gw: 'Africa',
  ke: 'Africa', ls: 'Africa', lr: 'Africa', ly: 'Africa', mg: 'Africa',
  mw: 'Africa', ml: 'Africa', mr: 'Africa', mu: 'Africa', ma: 'Africa',
  mz: 'Africa', na: 'Africa', ne: 'Africa', ng: 'Africa', rw: 'Africa',
  st: 'Africa', sn: 'Africa', sc: 'Africa', sl: 'Africa', so: 'Africa',
  za: 'Africa', ss: 'Africa', sd: 'Africa', tz: 'Africa', tg: 'Africa',
  tn: 'Africa', ug: 'Africa', zm: 'Africa', zw: 'Africa',
  // Africa — territories
  'sh-ac': 'Africa', yt: 'Africa', re: 'Africa', 'sh-hl': 'Africa',
  sh: 'Africa', 'sh-ta': 'Africa', eh: 'Africa',

  // Asia
  af: 'Asia', am: 'Asia', az: 'Asia', bh: 'Asia', bd: 'Asia',
  bt: 'Asia', bn: 'Asia', kh: 'Asia', cn: 'Asia', ge: 'Asia',
  in: 'Asia', id: 'Asia', ir: 'Asia', iq: 'Asia', il: 'Asia',
  jp: 'Asia', jo: 'Asia', kz: 'Asia', kw: 'Asia', kg: 'Asia',
  la: 'Asia', lb: 'Asia', my: 'Asia', mv: 'Asia', mn: 'Asia',
  mm: 'Asia', np: 'Asia', kp: 'Asia', om: 'Asia', pk: 'Asia',
  ph: 'Asia', qa: 'Asia', sa: 'Asia', sg: 'Asia', kr: 'Asia',
  lk: 'Asia', sy: 'Asia', tj: 'Asia', th: 'Asia', tl: 'Asia',
  tr: 'Asia', tm: 'Asia', ae: 'Asia', uz: 'Asia', vn: 'Asia',
  ye: 'Asia',
  // Asia — observer / non-UN / territories
  ps: 'Asia', tw: 'Asia', io: 'Asia', dg: 'Asia', hk: 'Asia', mo: 'Asia',

  // Europe (Cyprus placed here for political/EU consistency, though
  // UN M49 lists it under Asia)
  al: 'Europe', ad: 'Europe', at: 'Europe', by: 'Europe', be: 'Europe',
  ba: 'Europe', bg: 'Europe', hr: 'Europe', cy: 'Europe', cz: 'Europe',
  dk: 'Europe', ee: 'Europe', fi: 'Europe', fr: 'Europe', de: 'Europe',
  gr: 'Europe', hu: 'Europe', is: 'Europe', ie: 'Europe', it: 'Europe',
  lv: 'Europe', li: 'Europe', lt: 'Europe', lu: 'Europe', mt: 'Europe',
  md: 'Europe', mc: 'Europe', me: 'Europe', nl: 'Europe', mk: 'Europe',
  no: 'Europe', pl: 'Europe', pt: 'Europe', ro: 'Europe', ru: 'Europe',
  sm: 'Europe', rs: 'Europe', sk: 'Europe', si: 'Europe', es: 'Europe',
  se: 'Europe', ch: 'Europe', ua: 'Europe', gb: 'Europe',
  // Europe — observer / non-UN / territories
  va: 'Europe', xk: 'Europe', ax: 'Europe', fo: 'Europe', gi: 'Europe',
  gg: 'Europe', im: 'Europe', je: 'Europe', sj: 'Europe',

  // North America (UN members)
  ag: 'North America', bs: 'North America', bb: 'North America',
  bz: 'North America', ca: 'North America', cr: 'North America',
  cu: 'North America', dm: 'North America', do: 'North America',
  sv: 'North America', gd: 'North America', gt: 'North America',
  ht: 'North America', hn: 'North America', jm: 'North America',
  mx: 'North America', ni: 'North America', pa: 'North America',
  kn: 'North America', lc: 'North America', vc: 'North America',
  tt: 'North America', us: 'North America',
  // North America — territories
  ai: 'North America', aw: 'North America', bm: 'North America',
  bq: 'North America', ky: 'North America', cp: 'North America',
  cw: 'North America', gl: 'North America', gp: 'North America',
  mq: 'North America', ms: 'North America', pr: 'North America',
  bl: 'North America', mf: 'North America', pm: 'North America',
  sx: 'North America', tc: 'North America', vg: 'North America',
  vi: 'North America',

  // South America
  ar: 'South America', bo: 'South America', br: 'South America',
  cl: 'South America', co: 'South America', ec: 'South America',
  gy: 'South America', py: 'South America', pe: 'South America',
  sr: 'South America', uy: 'South America', ve: 'South America',
  // South America — territories
  fk: 'South America', gf: 'South America',

  // Oceania
  au: 'Oceania', fj: 'Oceania', ki: 'Oceania', mh: 'Oceania',
  fm: 'Oceania', nr: 'Oceania', nz: 'Oceania', pw: 'Oceania',
  pg: 'Oceania', ws: 'Oceania', sb: 'Oceania', to: 'Oceania',
  tv: 'Oceania', vu: 'Oceania',
  // Oceania — territories
  as: 'Oceania', cx: 'Oceania', cc: 'Oceania', ck: 'Oceania',
  pf: 'Oceania', gu: 'Oceania', nc: 'Oceania', nu: 'Oceania',
  nf: 'Oceania', mp: 'Oceania', pn: 'Oceania', tk: 'Oceania',
  um: 'Oceania', wf: 'Oceania',

  // Antarctica (the continent plus the sub-Antarctic specks; UN M49
  // disagrees on several of these but the geographic intuition wins
  // for a flag app)
  aq: 'Antarctica', bv: 'Antarctica', tf: 'Antarctica',
  hm: 'Antarctica', gs: 'Antarctica',
};

function statehoodFor(code) {
  if (UN_OBSERVERS.has(code)) return 'un_observer';
  if (NON_UN.has(code)) return 'non_un';
  if (TERRITORIES.has(code)) return 'territory';
  return 'un_member';
}

const raw = JSON.parse(readFileSync(dataPath, 'utf8'));

const enriched = raw.map(({ code, name }) => {
  if (OTHER_CODES.has(code)) {
    return { code, name, continent: null, category: 'other', statehood: null };
  }
  const continent = CONTINENT[code];
  if (!continent) {
    throw new Error(`Missing continent mapping for ${code} (${name})`);
  }
  return {
    code,
    name,
    continent,
    category: 'country',
    statehood: statehoodFor(code),
  };
});

writeFileSync(dataPath, JSON.stringify(enriched, null, 2) + '\n', 'utf8');

// Self-check summary so mistakes show up before the test suite runs.
const counts = { un_member: 0, un_observer: 0, non_un: 0, territory: 0, other: 0 };
for (const e of enriched) {
  if (e.category === 'other') counts.other++;
  else counts[e.statehood]++;
}

console.log(`Wrote ${enriched.length} entries to ${dataPath}`);
console.log(`  UN members:    ${counts.un_member}`);
console.log(`  UN observers:  ${counts.un_observer}`);
console.log(`  Non-UN:        ${counts.non_un}`);
console.log(`  Territories:   ${counts.territory}`);
console.log(`  Other:         ${counts.other}`);
