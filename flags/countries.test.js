import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  COLORS_FOR_RANDOM,
  MOTIFS_FOR_RANDOM,
  ALL_MOTIFS,
  CONTINENTS_FOR_RANDOM,
  generateRandomPuzzle,
} from './engine.js';
import { CONTINENTS, loadCountries } from './group.js';
import { emptyFilters, matchesFilters } from './flagsFilter.js';

/** @typedef {import('./group.js').Country} Country */

const HERE = dirname(fileURLToPath(import.meta.url));
const COUNTRIES = loadCountries(JSON.parse(readFileSync(join(HERE, 'countries.json'), 'utf-8')));
const SVG_DIR = join(HERE, 'svg');

test('countries.json is a non-empty array', () => {
  assert.ok(Array.isArray(COUNTRIES));
  assert.ok(COUNTRIES.length > 0);
});

test('every entry has a non-empty string code and name', () => {
  for (const c of COUNTRIES) {
    assert.equal(typeof c.code, 'string', `bad code: ${JSON.stringify(c)}`);
    assert.ok(c.code.length > 0, `empty code: ${JSON.stringify(c)}`);
    assert.equal(typeof c.name, 'string', `bad name: ${JSON.stringify(c)}`);
    assert.ok(c.name.length > 0, `empty name: ${JSON.stringify(c)}`);
  }
});

test('every entry has a nameScore integer in [1, 7]', () => {
  const offenders = [];
  for (const c of COUNTRIES) {
    if (typeof c.nameScore !== 'number' || !Number.isInteger(c.nameScore)) {
      offenders.push(`${c.code}: nameScore ${JSON.stringify(c.nameScore)} must be an integer`);
      continue;
    }
    if (c.nameScore < 1 || c.nameScore > 7) {
      offenders.push(`${c.code}: nameScore ${c.nameScore} out of range [1, 7]`);
    }
  }
  assert.deepEqual(offenders, [], offenders.join('; '));
});

test('country codes are unique', () => {
  const seen = new Set();
  const dups = [];
  for (const c of COUNTRIES) {
    if (seen.has(c.code)) dups.push(c.code);
    seen.add(c.code);
  }
  assert.deepEqual(dups, [], `duplicate codes: ${dups.join(', ')}`);
});

test('every entry has category "country" or "other"', () => {
  for (const c of COUNTRIES) {
    assert.ok(
      c.category === 'country' || c.category === 'other',
      `${c.code}: bad category ${c.category}`,
    );
  }
});

test('continent is in CONTINENTS for "country" entries, null for "other" entries', () => {
  for (const c of COUNTRIES) {
    if (c.category === 'country') {
      assert.ok(c.continent, `${c.code}: country must have a non-null continent`);
      assert.ok(
        CONTINENTS.includes(c.continent),
        `${c.code}: continent "${c.continent}" not in CONTINENTS`,
      );
    } else {
      assert.equal(c.continent, null, `${c.code}: "other" entry should have null continent`);
    }
  }
});

test('every entry has a non-empty primaryColors and an additionalColors array, both drawn from the palette and disjoint', () => {
  // Split colour model: every flag's colours live in exactly one of two
  // buckets. `primaryColors` (non-empty) is what reads across a room — every
  // flag has at least one. `additionalColors` (possibly empty) is the
  // emblem-only tail — colours that only appear inside a coat of arms or
  // small detail. The two are disjoint by construction; the union is "every
  // colour anywhere on the flag", which `allColors()` returns.
  const palette = new Set(COLORS_FOR_RANDOM);
  const offenders = [];
  for (const c of COUNTRIES) {
    if (!Array.isArray(c.primaryColors) || c.primaryColors.length === 0) {
      offenders.push(`${c.code}: primaryColors must be a non-empty array`);
      continue;
    }
    if (!Array.isArray(c.additionalColors)) {
      offenders.push(`${c.code}: additionalColors must be an array (possibly empty)`);
      continue;
    }
    for (const color of c.primaryColors) {
      if (!palette.has(color)) {
        offenders.push(`${c.code}: primaryColors "${color}" not in canonical palette`);
      }
    }
    for (const color of c.additionalColors) {
      if (!palette.has(color)) {
        offenders.push(`${c.code}: additionalColors "${color}" not in canonical palette`);
      }
      if (c.primaryColors.includes(color)) {
        offenders.push(`${c.code}: "${color}" appears in both primaryColors and additionalColors — buckets must be disjoint`);
      }
    }
  }
  assert.deepEqual(offenders, [], offenders.join('; '));
});

test('aliases (when present) are non-empty string arrays with no duplicates', () => {
  const offenders = [];
  for (const c of COUNTRIES) {
    if (c.aliases === undefined) continue;
    if (!Array.isArray(c.aliases) || c.aliases.length === 0) {
      offenders.push(`${c.code}: aliases should be a non-empty array`);
      continue;
    }
    const seen = new Set();
    for (const a of c.aliases) {
      if (typeof a !== 'string' || a.length === 0) {
        offenders.push(`${c.code}: alias must be a non-empty string`);
        continue;
      }
      const key = a.toLowerCase();
      if (seen.has(key)) offenders.push(`${c.code}: duplicate alias "${a}"`);
      seen.add(key);
    }
  }
  assert.deepEqual(offenders, [], offenders.join('; '));
});

test('motifs (when present) are arrays drawn from ALL_MOTIFS', () => {
  const palette = new Set(ALL_MOTIFS);
  const offenders = [];
  for (const c of COUNTRIES) {
    if (c.motifs === undefined) continue;
    if (!Array.isArray(c.motifs)) {
      offenders.push(`${c.code}: motifs should be an array`);
      continue;
    }
    for (const motif of c.motifs) {
      if (!palette.has(motif)) {
        offenders.push(`${c.code}: motif "${motif}" not in palette`);
      }
    }
  }
  assert.deepEqual(offenders, [], offenders.join('; '));
});

const KNOWN_MOTIFS = [
  { code: 'sh-hl', motifs: ['animal', 'coat-of-arms'], note: 'Saint Helena wirebird' },
  { code: 'sh-ac', motifs: ['animal', 'coat-of-arms'], note: 'Ascension Island turtle' },
  { code: 'sh-ta', motifs: ['animal', 'coat-of-arms'], note: 'Tristan da Cunha albatross' },
  // sh (the combined territory) currently ships a plain Union Jack SVG with
  // no coat of arms, so no motif tags apply to what the player actually sees.
  { code: 'eg',    motifs: ['animal', 'coat-of-arms'], note: 'Egypt — Eagle of Saladin' },
  // Malta's George Cross emblem depicts St. George (sword = weapon) on
  // horseback (horse = animal) slaying a dragon (animal again), framed
  // as a cross. All three tags must be present together — they were
  // silently dropped once before when the 'cross' motif was added.
  { code: 'mt',    motifs: ['animal', 'weapon', 'cross'], note: 'Malta — George Cross emblem (horse, dragon, sword)' },
];

test('known animal/coat-of-arms flags keep their expected motif tags', () => {
  const offenders = [];
  for (const { code, motifs: expected, note } of KNOWN_MOTIFS) {
    const c = COUNTRIES.find((x) => x.code === code);
    if (!c) {
      offenders.push(`${code} (${note}): not found in countries.json`);
      continue;
    }
    for (const m of expected) {
      if (!c.motifs?.includes(m)) {
        offenders.push(`${code} (${note}): expected motif "${m}", got ${JSON.stringify(c.motifs)}`);
      }
    }
  }
  assert.deepEqual(offenders, [], offenders.join('; '));
});

// Regression pin — hand-audited primaryColors / additionalColors splits for
// the European flags Jan ranked by visual inspection. These are the flags
// where the mechanical migration (#192) needed a specific correction, so
// pinning them stops a future regeneration / refactor from quietly swapping
// a primary colour to additional or vice versa. Add a code here when you
// hand-audit another flag and want the answer frozen against future drift.
const KNOWN_PRIMARY_SPLITS = [
  { code: 'gi', primary: ['red','white'],          additional: ['yellow','black'], note: 'Gibraltar — castle COA on white-over-red field; yellow castle + black detailing read as emblem-only' },
  { code: 'im', primary: ['red','white'],          additional: ['yellow'],         note: 'Isle of Man — yellow triskelion sits inside the central red disc; the across-the-room palette is red on white' },
  { code: 'je', primary: ['white','red'],          additional: ['yellow'],         note: 'Jersey — yellow Jersey shield in the upper triangle is small; saltire is the dominant feature' },
  { code: 'li', primary: ['red','blue','yellow'],  additional: ['black'],          note: 'Liechtenstein — blue-over-red horizontal with yellow crown in the canton; the crown details bring black that only reads up close' },
  { code: 'pt', primary: ['red','green','yellow'], additional: ['blue','white'],   note: 'Portugal — yellow armillary sphere is large enough to read as primary; blue + white live only in the small inner shield' },
  { code: 'va', primary: ['yellow','white'],       additional: ['red'],            note: 'Vatican — red ribbon binding the crossed keys is emblem-only against the yellow + white field' },
];

test('Europe hand-audited primary/additional splits stay pinned', () => {
  /** @type {string[]} */
  const offenders = [];
  for (const { code, primary, additional, note } of KNOWN_PRIMARY_SPLITS) {
    const c = COUNTRIES.find((x) => x.code === code);
    if (!c) {
      offenders.push(`${code} (${note}): not found in countries.json`);
      continue;
    }
    if (JSON.stringify(c.primaryColors) !== JSON.stringify(primary)) {
      offenders.push(`${code} (${note}): primaryColors expected ${JSON.stringify(primary)}, got ${JSON.stringify(c.primaryColors)}`);
    }
    if (JSON.stringify(c.additionalColors) !== JSON.stringify(additional)) {
      offenders.push(`${code} (${note}): additionalColors expected ${JSON.stringify(additional)}, got ${JSON.stringify(c.additionalColors)}`);
    }
  }
  assert.deepEqual(offenders, [], '\n  ' + offenders.join('\n  '));
});

test('All-countries pool supports the "20" quiz mode (Flag Quiz default)', () => {
  const n = COUNTRIES.filter((c) => c.category === 'country').length;
  assert.ok(
    n >= 20,
    `All-countries pool is ${n} — flagQuiz default "All countries 20" needs >= 20`,
  );
});

test('every entry has a corresponding SVG file at flags/svg/{code}.svg', () => {
  const missing = [];
  for (const c of COUNTRIES) {
    const svgPath = join(SVG_DIR, `${c.code}.svg`);
    if (!existsSync(svgPath)) missing.push(c.code);
  }
  assert.deepEqual(missing, [], `missing SVG files: ${missing.join(', ')}`);
});

test('every (continent × color) cell has at least one candidate country', () => {
  const KNOWN_EMPTY = new Set([
    'South America × orange',
  ]);
  const empty = [];
  for (const cont of CONTINENTS_FOR_RANDOM) {
    for (const color of COLORS_FOR_RANDOM) {
      const n = COUNTRIES.filter(
        (c) => c.continent === cont && c.colors.includes(color),
      ).length;
      const label = `${cont} × ${color}`;
      if (n === 0 && !KNOWN_EMPTY.has(label)) empty.push(label);
    }
  }
  assert.deepEqual(empty, [], `unexpected empty cells: ${empty.join(', ')}`);
});

test('every (continent × motif) cell has at least one candidate country', () => {
  const empty = [];
  for (const cont of CONTINENTS_FOR_RANDOM) {
    for (const motif of MOTIFS_FOR_RANDOM) {
      const n = COUNTRIES.filter(
        (c) => c.continent === cont && Array.isArray(c.motifs) && c.motifs.includes(motif),
      ).length;
      if (n === 0) empty.push(`${cont} × ${motif}`);
    }
  }
  assert.deepEqual(empty, [], `no candidate flags for: ${empty.join(', ')}`);
});

test('generateRandomPuzzle succeeds with the real countries.json under several seeds', () => {
  /** @param {number} seed */
  function mulberry32(seed) {
    let a = seed | 0;
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  for (const seed of [1, 42, 1337, 9001]) {
    const puzzle = generateRandomPuzzle(COUNTRIES, { rng: mulberry32(seed) });
    assert.equal(puzzle.rows.length, 3);
    assert.equal(puzzle.cols.length, 3);
  }
});

// Integration tests against the real country pool — these guard the
// flagsdata page (and findFlag's chooser) against any future regression
// in either matchesFilters or the dataset itself. The unit tests in
// flagsFilter.test.js use synthetic countries; these pin the live data.

test('matchesFilters against real data: Asia AND Africa is empty (two scalar continents)', () => {
  const f = emptyFilters();
  f.continent.include.add('Asia');
  f.continent.include.add('Africa');
  const matches = COUNTRIES.filter((c) => matchesFilters(c, f));
  assert.equal(matches.length, 0, 'no country can be in both Asia and Africa');
});

test('matchesFilters against real data: weapon AND animal keeps only flags with both motifs', () => {
  const f = emptyFilters();
  f.motif.include.add('weapon');
  f.motif.include.add('animal');
  const matches = COUNTRIES.filter((c) => matchesFilters(c, f));
  // Dataset-dependent: assert the property holds for every survivor
  // rather than pinning a fragile count.
  for (const c of matches) {
    const motifs = c.motifs ?? [];
    assert.ok(motifs.includes('weapon') && motifs.includes('animal'),
      `${c.code}: expected both 'weapon' and 'animal' in motifs, got ${JSON.stringify(motifs)}`);
  }
  // And confirm at least one country with only 'weapon' (no 'animal')
  // exists in the dataset — otherwise the AND test is degenerate.
  const weaponOnly = COUNTRIES.filter((c) => {
    const m = c.motifs ?? [];
    return m.includes('weapon') && !m.includes('animal');
  });
  assert.ok(weaponOnly.length > 0,
    'sanity: dataset should contain at least one weapon-only flag, else this test proves nothing');
});

test('matchesFilters against real data: red AND blue keeps only flags with both colors', () => {
  const f = emptyFilters();
  f.color.include.add('red');
  f.color.include.add('blue');
  const matches = COUNTRIES.filter((c) => matchesFilters(c, f));
  for (const c of matches) {
    assert.ok(c.colors.includes('red') && c.colors.includes('blue'),
      `${c.code}: expected both 'red' and 'blue' in colors, got ${JSON.stringify(c.colors)}`);
  }
});

// Regression pin — flags whose SVG renders the civil flag (a colour-only
// stripe pattern, no central emblem) must NOT carry state-flag motifs
// like `animal`, `coat-of-arms`, or `weapon`. The motif rule is "describe
// what the player sees in the SVG"; a state-flag motif on a civil-flag
// SVG turns the country into a surprise wrong-answer in any motif puzzle.
// Peru was the original case (vicuña + COA + cornucopia live only on the
// state flag; svg/pe.svg is the red-white-red civil flag). It was fixed
// once in 17d40fc and silently regressed in 7df5d95 when the catalog was
// regenerated — this test pins it so the third repaint can't happen.
//
// Add a code here when you discover another civil-flag SVG paired with a
// state-flag motif. The list is deliberately explicit (no SVG-path-count
// heuristic) so each entry survives a human eyeball check before landing.
const CIVIL_FLAG_ONLY = new Set(['pe']);
const STATE_FLAG_MOTIFS = ['animal', 'coat-of-arms', 'weapon'];
test('civil-flag-only entries do not carry state-flag motifs (Peru regression pin)', () => {
  /** @type {string[]} */
  const offenders = [];
  for (const c of COUNTRIES) {
    if (!CIVIL_FLAG_ONLY.has(c.code)) continue;
    const motifs = c.motifs ?? [];
    for (const trap of STATE_FLAG_MOTIFS) {
      if (motifs.includes(trap)) {
        offenders.push(`${c.code} (${c.name}): has '${trap}' motif but the SVG shows the civil flag — drop it`);
      }
    }
  }
  assert.deepEqual(offenders, [], '\n  ' + offenders.join('\n  '));
});

// Regression pin — flags whose visible design carries a sun must be tagged
// `star-or-moon`, because astronomically the sun is a star and a player
// reading the SVG sees one celestial body either way. Earlier versions of
// this catalog deliberately excluded sun emblems from `star-or-moon`,
// which left Japan, Argentina, Uruguay, Kazakhstan, etc. with no motif
// even though every other star/moon flag was tagged. This list pins the
// named cases so the exclusion can't sneak back in.
const SUN_BEARING = [
  { code: 'kz', note: 'Kazakhstan — golden sun above steppe eagle' },
  { code: 'tw', note: 'Taiwan — white sun on blue canton' },
  { code: 'mw', note: 'Malawi — rising sun in black band' },
  { code: 'mk', note: 'North Macedonia — sun of liberty' },
  { code: 'ag', note: 'Antigua and Barbuda — rising sun' },
  { code: 'ar', note: 'Argentina — Sol de Mayo' },
  { code: 'uy', note: 'Uruguay — Sol de Mayo in canton' },
  { code: 'ec', note: 'Ecuador — sun atop coat of arms' },
  { code: 'pf', note: 'French Polynesia — sun emblem with outrigger canoe' },
  { code: 'jp', note: 'Japan — red sun disc (Hinomaru)' },
];
test('sun-bearing flags carry the star-or-moon motif (sun-is-a-star pin)', () => {
  /** @type {string[]} */
  const offenders = [];
  for (const { code, note } of SUN_BEARING) {
    const c = COUNTRIES.find((x) => x.code === code);
    if (!c) {
      offenders.push(`${code} (${note}): not found in countries.json`);
      continue;
    }
    if (!c.motifs?.includes('star-or-moon')) {
      offenders.push(`${code} (${note}): expected 'star-or-moon' motif, got ${JSON.stringify(c.motifs)}`);
    }
  }
  assert.deepEqual(offenders, [], '\n  ' + offenders.join('\n  '));
});

