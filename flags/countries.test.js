import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  COLORS_FOR_RANDOM,
  MOTIFS_FOR_RANDOM,
  CONTINENTS_FOR_RANDOM,
  generateRandomPuzzle,
  isPuzzleGeneratable,
} from './grid.js';
import { CONTINENTS } from './group.js';
import { PUZZLE_1 } from '../flagGrid/puzzles.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const COUNTRIES = JSON.parse(readFileSync(join(HERE, 'countries.json'), 'utf-8'));
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
      assert.ok(
        CONTINENTS.includes(c.continent),
        `${c.code}: continent "${c.continent}" not in CONTINENTS`,
      );
    } else {
      assert.equal(c.continent, null, `${c.code}: "other" entry should have null continent`);
    }
  }
});

test('every entry has a non-empty colors array drawn from COLORS_FOR_RANDOM', () => {
  const palette = new Set(COLORS_FOR_RANDOM);
  const offenders = [];
  for (const c of COUNTRIES) {
    if (!Array.isArray(c.colors) || c.colors.length === 0) {
      offenders.push(`${c.code}: colors missing or empty`);
      continue;
    }
    for (const color of c.colors) {
      if (!palette.has(color)) {
        offenders.push(`${c.code}: color "${color}" not in canonical palette`);
      }
    }
  }
  assert.deepEqual(offenders, [], offenders.join('; '));
});

test('motifs (when present) are arrays drawn from MOTIFS_FOR_RANDOM', () => {
  // motifs is optional and may be an empty array (most flags are untagged);
  // any value in the array must come from the canonical motif palette.
  const palette = new Set(MOTIFS_FOR_RANDOM);
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

// Hand-curated registry of flags whose motifs are visually obvious
// from the rendered SVG. Lock-down test: a future data refresh (or
// re-run of scripts/add-flag-motifs.mjs against drifted input) cannot
// silently drop a tag without failing CI. Issues #50 and #52 were
// real because the SH/AC entries had been *added* without the motif
// pass running over them — this test would have caught both.
const KNOWN_MOTIFS = [
  // Coats of arms depicting an animal — listed under both 'animal'
  // and 'coat-of-arms' so a partial removal still trips the assertion.
  { code: 'sh-hl', motifs: ['animal', 'coat-of-arms'], note: 'Saint Helena wirebird' },
  { code: 'sh-ac', motifs: ['animal', 'coat-of-arms'], note: 'Ascension Island turtle' },
  { code: 'sh-ta', motifs: ['animal', 'coat-of-arms'], note: 'Tristan da Cunha albatross' },
  { code: 'sh',    motifs: ['animal', 'coat-of-arms'], note: 'SH+A+T combined territory' },
  { code: 'eg',    motifs: ['animal', 'coat-of-arms'], note: 'Egypt — Eagle of Saladin' },
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

test('All-countries pool supports the "20" quiz mode (Flag Quiz default)', () => {
  // Main menu hardcodes flagQuiz/?v=countries&n=20. If the country pool
  // dropped below 20 the boot fallback would silently downgrade the mode,
  // so the "Flag Quiz" link wouldn't actually give a 20-q quiz.
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
  // Random-puzzle generation only ever picks cols from this colour pool
  // and rows from this continent pool; if any intersection is empty, the
  // solvability gate fails for that combo and the shuffle wastes a roll.
  //
  // KNOWN_EMPTY pins down combos that are genuinely zero in the real-world
  // data — no flag in that continent uses that colour. Adding a NEW
  // empty cell (regression) fails the test; filling a known-empty one is
  // also fine (the exception just becomes a no-op).
  const KNOWN_EMPTY = new Set([
    'South America × orange', // no South American flag uses orange
  ]);
  const empty = [];
  for (const cont of CONTINENTS_FOR_RANDOM) {
    for (const color of COLORS_FOR_RANDOM) {
      const n = COUNTRIES.filter(
        (c) => c.continent === cont && Array.isArray(c.colors) && c.colors.includes(color),
      ).length;
      const label = `${cont} × ${color}`;
      if (n === 0 && !KNOWN_EMPTY.has(label)) empty.push(label);
    }
  }
  assert.deepEqual(empty, [], `unexpected empty cells: ${empty.join(', ')}`);
});

test('every (continent × motif) cell has at least one candidate country', () => {
  // ≥2 is the preferred buffer against the no-duplicates rule (see
  // isPuzzleGeneratable's default minPerCell). ≥1 is the absolute minimum
  // — below that, the solvability gate can never pass for that combo and
  // we'd risk hitting maxAttempts. Europe × weapon is currently 1 (just
  // Malta) — acceptable but tight; see scripts/add-flag-motifs.mjs.
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

test('PUZZLE_1 is solvable against the real countries.json', () => {
  // The fixed flagGrid/1 puzzle: data drift that empties any of its cells
  // (or drops a cell below the 2-candidate buffer) shows up here rather
  // than as a stuck game.
  assert.equal(isPuzzleGeneratable(PUZZLE_1, COUNTRIES), true);
});

test('generateRandomPuzzle succeeds with the real countries.json under several seeds', () => {
  // Real-data integration check: if motif tagging drifts to the point
  // where the solvability gate can never pass, generateRandomPuzzle
  // throws after maxAttempts. This pins down a few seeded RNGs so a
  // regression shows up as a hard failure rather than a flaky game UI.
  const seeds = [
    [0.11, 0.27, 0.83, 0.04, 0.55, 0.62, 0.71, 0.99, 0.18, 0.36],
    [0.42, 0.13, 0.77, 0.95, 0.03, 0.59, 0.21, 0.48, 0.66, 0.82],
    [0.07, 0.31, 0.52, 0.69, 0.88, 0.14, 0.97, 0.25, 0.43, 0.61],
  ];
  for (const seed of seeds) {
    let i = 0;
    const rng = () => seed[i++ % seed.length];
    const puzzle = generateRandomPuzzle(COUNTRIES, { rng });
    assert.equal(puzzle.rows.length, 3);
    assert.equal(puzzle.cols.length, 3);
  }
});
