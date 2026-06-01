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
  findPuzzleSolution,
  validateCell,
} from './grid.js';
import { CONTINENTS } from './group.js';
import { PUZZLE_1, PUZZLE_2 } from '../flagGrid/puzzles.js';

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

test('PUZZLE_1 has an exemplary 9-distinct-country solution against the real countries.json', () => {
  // Proof-of-solvability: not just "every cell has candidates" (the old
  // isPuzzleGeneratable heuristic) but "an actual assignment of 9 distinct
  // countries exists where every cell's pick satisfies its row and column".
  // Data drift that empties a cell — or that leaves only overlapping
  // candidates and breaks the no-duplicates rule — fails this test rather
  // than producing a stuck game.
  const solution = findPuzzleSolution(PUZZLE_1, COUNTRIES);
  assert.notEqual(solution, null);
  const codes = solution.flat().map((c) => c.code);
  assert.equal(new Set(codes).size, 9, `expected 9 distinct countries, got codes: ${codes.join(', ')}`);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      assert.equal(
        validateCell(PUZZLE_1, r, c, solution[r][c]),
        true,
        `cell [${r}][${c}] = ${solution[r][c].code} does not satisfy ${PUZZLE_1.rows[r].id} x ${PUZZLE_1.cols[c].id}`,
      );
    }
  }
  // Keep the heuristic check too — a regression that only the count gate
  // catches (e.g. an empty cell) should still surface as a clear failure.
  assert.equal(isPuzzleGeneratable(PUZZLE_1, COUNTRIES), true);
});

test('PUZZLE_2 has an exemplary 9-distinct-country solution against the real countries.json', () => {
  const solution = findPuzzleSolution(PUZZLE_2, COUNTRIES);
  assert.notEqual(solution, null);
  const codes = solution.flat().map((c) => c.code);
  assert.equal(new Set(codes).size, 9, `expected 9 distinct countries, got codes: ${codes.join(', ')}`);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      assert.equal(
        validateCell(PUZZLE_2, r, c, solution[r][c]),
        true,
        `cell [${r}][${c}] = ${solution[r][c].code} does not satisfy ${PUZZLE_2.rows[r].id} x ${PUZZLE_2.cols[c].id}`,
      );
    }
  }
  assert.equal(isPuzzleGeneratable(PUZZLE_2, COUNTRIES), true);
});

test('generateRandomPuzzle succeeds with the real countries.json under several seeds', () => {
  // Real-data integration check: if motif tagging drifts to the point
  // where the solvability gate can never pass, generateRandomPuzzle
  // throws after maxAttempts. Drives a proper seeded PRNG (Mulberry32) —
  // the unified-pool generator now rejects many shuffles (exclusive-group
  // conflicts, empty cells), so a short cyclic seed could starve the
  // search before finding a valid puzzle.
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
