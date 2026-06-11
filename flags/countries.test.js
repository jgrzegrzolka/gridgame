import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  COLORS_FOR_RANDOM,
  ALL_FLAG_COLORS,
  MOTIFS_FOR_RANDOM,
  ALL_MOTIFS,
  CONTINENTS_FOR_RANDOM,
  generateRandomPuzzle,
  generateUltimateRandomPuzzle,
  hasUltimatePuzzleSolution,
  axesImpliedPair,
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
  //
  // Data palette is wider than `COLORS_FOR_RANDOM`: the random-puzzle
  // generator stays on the seven canonical colours (every continent ×
  // colour cell must have candidates), but countries.json can carry rarer
  // emblem colours (`violet` for Dominica's sisserou parrot and Northern
  // Mariana Islands' wreath). findFlag's chooser uses `ALL_FLAG_COLORS`
  // so the wider palette surfaces in the UI even though it's not used by
  // the random generator.
  const palette = new Set(ALL_FLAG_COLORS);
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

// EU member roll-call as of 2026 — 27 countries. The motif is metadata
// rather than a visual element on the flag (cf. cross / weapon / animal),
// but it earns its keep as a puzzle hook: "European Union member states"
// is one of the most common ways people group flags. Pin both the count
// and the exact code set so a bulk re-tag of motifs can't silently
// add Croatia twice or drop Cyprus.
const EU_MEMBER_CODES = [
  'at', 'be', 'bg', 'hr', 'cy', 'cz', 'dk', 'ee', 'fi', 'fr', 'de', 'gr', 'hu',
  'ie', 'it', 'lv', 'lt', 'lu', 'mt', 'nl', 'pl', 'pt', 'ro', 'sk', 'si', 'es', 'se',
];

test('eu-member motif is carried by exactly the 27 EU member states', () => {
  const carriers = COUNTRIES.filter(
    (c) => Array.isArray(c.motifs) && c.motifs.includes('eu-member'),
  ).map((c) => c.code).sort();
  assert.deepEqual(carriers, [...EU_MEMBER_CODES].sort(),
    'eu-member motif should be on exactly the 27 EU members — no more, no less');
});

// Regression pin — hand-audited primaryColors / additionalColors splits for
// the European flags Jan ranked by visual inspection. These are the flags
// where the mechanical migration (#192) needed a specific correction, so
// pinning them stops a future regeneration / refactor from quietly swapping
// a primary colour to additional or vice versa. Add a code here when you
// hand-audit another flag and want the answer frozen against future drift.
const KNOWN_PRIMARY_SPLITS = [
  // --- Europe ---
  { code: 'gi', primary: ['red','white'],          additional: ['yellow','black'], note: 'Gibraltar — castle COA on white-over-red field; yellow castle + black detailing read as emblem-only' },
  { code: 'im', primary: ['red','white'],          additional: ['yellow'],         note: 'Isle of Man — yellow triskelion sits inside the central red disc; the across-the-room palette is red on white' },
  { code: 'je', primary: ['white','red'],          additional: ['yellow'],         note: 'Jersey — yellow Jersey shield in the upper triangle is small; saltire is the dominant feature' },
  { code: 'li', primary: ['red','blue','yellow'],  additional: ['black'],          note: 'Liechtenstein — blue-over-red horizontal with yellow crown in the canton; the crown details bring black that only reads up close' },
  { code: 'pt', primary: ['red','green','yellow'], additional: ['blue','white'],   note: 'Portugal — yellow armillary sphere is large enough to read as primary; blue + white live only in the small inner shield' },
  { code: 'va', primary: ['yellow','white'],       additional: ['red'],            note: 'Vatican — red ribbon binding the crossed keys is emblem-only against the yellow + white field' },
  // --- Africa ---
  { code: 'io', primary: ['blue','red','white'],                  additional: ['yellow','green'], note: 'British Indian Ocean Territory — Blue Ensign + palm-tree COA; the wavy white-on-blue field and Union Jack canton are primary, yellow/green from the COA are emblem-only' },
  { code: 'eg', primary: ['red','white','black','yellow'],        additional: [],                  note: "Egypt — the Eagle of Saladin is the flag's defining feature (same recall logic as Albania's eagle): yellow is primary even though it lives inside the eagle" },
  { code: 'sz', primary: ['blue','yellow','red','black','white'], additional: [],                  note: "Eswatini — the central Nguni shield is large and its black/white pattern is part of the flag's across-the-room read; all five colours are primary" },
  { code: 'mz', primary: ['red','black','yellow','green','white'],additional: [],                  note: 'Mozambique — all five colours read at flag-tile size: the green/black/yellow stripes, the red triangle, and the white outlines on the rifle/hoe emblem are all visible' },
  { code: 'na', primary: ['blue','red','green','yellow','white'], additional: [],                  note: 'Namibia — the diagonal red stripe is white-bordered against blue/green fields; all five colours including the yellow sun and white fimbriations are primary' },
  // --- North America + others ---
  { code: 'mo', primary: ['green','white'],                       additional: ['yellow'],                  note: 'Macau — green field with white lotus + bridge; the yellow stars above the lotus are small and read as emblem-only' },
  { code: 'tm', primary: ['green','red','white'],                 additional: ['yellow'],                  note: 'Turkmenistan — revises earlier split: white is in the crescent moon + stars (visible primary), yellow is only in the carpet-pattern hoist stripe details' },
  { code: 'dm', primary: ['green','yellow','black','white','red'],additional: ['violet'],                  note: "Dominica — three crosses (yellow/black/white) cut across the green field and a red disc holds the COA; the sisserou parrot's violet sits in the COA only. Violet is allowed as a data colour (see FLAG_COLOR_PALETTE) but isn't exposed in the random-puzzle generator or findFlag UI." },
  { code: 'ht', primary: ['red','blue'],                          additional: ['white','green'],           note: 'Haiti — blue + red horizontal stripes are primary; the central white square is the COA backdrop and the green palm tree only reads up close' },
  { code: 'mx', primary: ['red','white','green'],                 additional: ['blue','yellow'],           note: 'Mexico — tricolour stripes are primary; the eagle COA introduces blue + yellow that only read at close range' },
  { code: 'ms', primary: ['blue','red','white'],                  additional: ['yellow','green','black'],  note: 'Montserrat — Blue Ensign + Hibernia COA (woman with harp); yellow/green/black are all COA-only against the Union-Jack-canton palette' },
  { code: 'sx', primary: ['red','blue','white'],                  additional: ['yellow','green'],          note: 'Sint Maarten — white triangle hoist with the COA, red-over-blue stripes; the rising sun + green palm in the COA are emblem-only. The sun adds the star-or-moon motif (also pinned by SUN_BEARING)' },
  { code: 'tc', primary: ['red','blue','white','yellow'],         additional: ['green'],                   note: 'Turks and Caicos Islands — revises earlier Ensign batch: the yellow conch in the COA is large enough to read as primary; green cactus stays additional' },
  { code: 'vi', primary: ['white','yellow'],                      additional: ['blue','green','red'],      note: 'Virgin Islands (U.S.) — white field with golden eagle is the across-the-room read; everything inside the eagle (blue shield, red/white stripes, green branch) is emblem-only' },
  { code: 'mq', primary: ['green','black','red'],                 additional: [],                          note: "Martinique — pinned because earlier data described the French tricolor (blue/white/red) but the SVG ships the 2023 flag: black bottom, green top, red hoist triangle. No emblem; all three colours are primary stripes/blocks." },
  // --- South America ---
  { code: 'br', primary: ['blue','yellow','green'],               additional: ['white'],                   note: 'Brazil — green field, yellow diamond, blue celestial sphere are the across-the-room palette; the white stars + Ordem e Progresso banner only read up close' },
  { code: 'ec', primary: ['yellow','blue','red'],                 additional: ['green','black'],           note: 'Ecuador — tricolour stripes are primary; the COA condor + Andes scene introduces green and black that are emblem-only' },
  // --- More territories / organisations ---
  { code: 'as', primary: ['blue','white','red'],                  additional: ['yellow'],                  note: "American Samoa — blue field with a red-bordered white triangle holding the eagle; the eagle's yellow staff is small enough to read as emblem-only" },
  { code: 'mp', primary: ['blue','white'],                        additional: ['green','violet','yellow'], note: 'Northern Mariana Islands — blue field with white latte stone star; the green/violet wreath garland + yellow rays are emblem-only' },
  { code: 'asean', primary: ['red','blue','yellow'],              additional: ['white'],                   note: 'ASEAN — red/blue field with central yellow ten-stalk emblem; the white circle behind the stalks is emblem-only' },
  { code: 'es-ga', primary: ['blue','white'],                     additional: ['red','yellow'],            note: 'Galicia — white field with diagonal blue band; the COA brings red and yellow that only read at close range' },
  { code: 'arab', primary: ['green','white'],                     additional: ['yellow'],                  note: 'League of Arab States — green field with white emblem ring; the inner yellow crescent is small enough to read as emblem-only' },
  { code: 'gb-nir', primary: ['white','red'],                     additional: ['yellow'],                  note: 'Northern Ireland (former Ulster Banner) — white field with red cross; the yellow Hand of Ulster + crown details are emblem-only' },
];

test('hand-audited primary/additional splits stay pinned', () => {
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

// The previous test enforced "every (continent × motif) cell has ≥1
// candidate country" — a stricter invariant than the generator actually
// needs. `generateRandomPuzzle` retries up to 200 times per call when a
// proposed puzzle has an unfillable cell, so a motif that only appears
// on one continent (e.g. `eu-member`) is fine in the pool: the retries
// absorb the misses. The seed-success test below is the real guard —
// if the pool ever drifts to where many seeds in a row can't yield a
// valid puzzle, that test fails first.

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

test('generateRandomPuzzle succeeds with the real countries.json under many seeds', () => {
  // 30 seeds (was 4) gives more retry-headroom signal. Some motifs in
  // the pool are continent-narrow — eu-member is Europe-only — so the
  // generator burns extra retries on (Asia × eu-member)-style cells
  // before landing on a valid puzzle. Today there's plenty of slack;
  // this test fails first if a future addition tightens the pool past
  // the 200-attempt budget.
  const SEEDS = Array.from({ length: 30 }, (_, i) => (i + 1) * 9973);
  for (const seed of SEEDS) {
    const puzzle = generateRandomPuzzle(COUNTRIES, { rng: mulberry32(seed) });
    assert.equal(puzzle.rows.length, 3);
    assert.equal(puzzle.cols.length, 3);
    // No degenerate (Europe × eu-member)-style pair should slip through —
    // axesImpliedPair is the live guard, this assertion pins the
    // contract under real data so a future engine tweak that bypasses
    // the guard surfaces here.
    assert.equal(
      axesImpliedPair(puzzle.rows, puzzle.cols, COUNTRIES),
      false,
      `seed ${seed}: produced an implied axis pair — rows=[${puzzle.rows.map((r) => r.id).join(',')}] cols=[${puzzle.cols.map((c) => c.id).join(',')}]`,
    );
  }
});

test('generateUltimateRandomPuzzle succeeds with the real countries.json under many seeds', () => {
  // Mirrors the 30-seed 3×3 sweep above, but with the stronger 9×9
  // Hall-marriage feasibility gate. The synthetic Ultimate tests in
  // engine.test.js use a saturated denseSquarePool; this one pins the
  // real-data retry budget so pool additions that tighten the search
  // (e.g. colorCount:2, where SA has only 1 candidate) surface as a
  // sweep failure rather than as intermittent throws in production.
  const SEEDS = Array.from({ length: 30 }, (_, i) => (i + 1) * 9973);
  for (const seed of SEEDS) {
    const puzzle = generateUltimateRandomPuzzle(COUNTRIES, { rng: mulberry32(seed) });
    assert.equal(puzzle.rows.length, 3);
    assert.equal(puzzle.cols.length, 3);
    assert.equal(
      hasUltimatePuzzleSolution(puzzle, COUNTRIES),
      true,
      `seed ${seed}: produced a puzzle that fails the Hall feasibility check`,
    );
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
  { code: 'sx', note: 'Sint Maarten — rising sun on the white triangle hoist' },
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

// `bird` is taxonomically a subset of `animal` — the engine's
// `axesImpliedPair` rule relies on that to reject degenerate
// (animal × bird) random puzzles. Pin both the named coverage and
// the subset invariant in one shot: every flag listed here must
// carry `bird`, and every flag carrying `bird` must also carry
// `animal`.
const BIRD_BEARING = [
  { code: 'al', note: 'Albania — black double-headed eagle' },
  { code: 'bo', note: 'Bolivia — Andean condor atop the arms' },
  { code: 'dm', note: 'Dominica — sisserou parrot at centre' },
  { code: 'ec', note: 'Ecuador — Andean condor atop the arms' },
  { code: 'eg', note: 'Egypt — Eagle of Saladin' },
  { code: 'fj', note: 'Fiji — dove of peace on the shield' },
  { code: 'gt', note: 'Guatemala — resplendent quetzal on the scroll' },
  { code: 'kz', note: 'Kazakhstan — golden steppe eagle below sun' },
  { code: 'ki', note: 'Kiribati — frigatebird above sun' },
  { code: 'mx', note: 'Mexico — golden eagle eating a serpent' },
  { code: 'md', note: 'Moldova — aurochs head flanked by Roman eagle' },
  { code: 'me', note: 'Montenegro — double-headed golden eagle' },
  { code: 'pg', note: 'Papua New Guinea — Raggiana bird-of-paradise' },
  { code: 'rs', note: 'Serbia — white double-headed eagle' },
  { code: 'ug', note: 'Uganda — grey crowned crane in the centre' },
  { code: 'zm', note: 'Zambia — African fish eagle in flight' },
  { code: 'zw', note: 'Zimbabwe — soapstone Zimbabwe Bird on red star' },
];
test('bird-bearing flags carry the bird motif AND the animal motif (subset pin)', () => {
  /** @type {string[]} */
  const offenders = [];
  for (const { code, note } of BIRD_BEARING) {
    const c = COUNTRIES.find((x) => x.code === code);
    if (!c) {
      offenders.push(`${code} (${note}): not found in countries.json`);
      continue;
    }
    if (!c.motifs?.includes('bird')) {
      offenders.push(`${code} (${note}): expected 'bird' motif, got ${JSON.stringify(c.motifs)}`);
    }
    if (!c.motifs?.includes('animal')) {
      offenders.push(`${code} (${note}): has 'bird' but missing 'animal' — bird ⊂ animal must hold`);
    }
  }
  for (const c of COUNTRIES) {
    if (c.motifs?.includes('bird') && !c.motifs.includes('animal')) {
      offenders.push(`${c.code} (${c.name}): carries 'bird' without 'animal' — bird ⊂ animal must hold`);
    }
  }
  assert.deepEqual(offenders, [], '\n  ' + offenders.join('\n  '));
});

