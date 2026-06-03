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
  puzzleMixesCategoryFamilies,
  sharedPuzzlePairs,
} from './grid.js';
import { CONTINENTS } from './group.js';
import { PUZZLE_1, PUZZLE_2, PUZZLE_3, ARCHIVE } from '../flagGrid/puzzles.js';

/** @typedef {import('./group.js').Country} Country */

const HERE = dirname(fileURLToPath(import.meta.url));
/** @type {Country[]} */
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

test('motifs (when present) are arrays drawn from MOTIFS_FOR_RANDOM', () => {
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

const KNOWN_MOTIFS = [
  { code: 'sh-hl', motifs: ['animal', 'coat-of-arms'], note: 'Saint Helena wirebird' },
  { code: 'sh-ac', motifs: ['animal', 'coat-of-arms'], note: 'Ascension Island turtle' },
  { code: 'sh-ta', motifs: ['animal', 'coat-of-arms'], note: 'Tristan da Cunha albatross' },
  // sh (the combined territory) currently ships a plain Union Jack SVG with
  // no coat of arms, so no motif tags apply to what the player actually sees.
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
        (c) => c.continent === cont && Array.isArray(c.colors) && c.colors.includes(color),
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

test('PUZZLE_1 has an exemplary 9-distinct-country solution against the real countries.json', () => {
  const solution = findPuzzleSolution(PUZZLE_1, COUNTRIES);
  assert.ok(solution);
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
  assert.equal(isPuzzleGeneratable(PUZZLE_1, COUNTRIES), true);
});

test('PUZZLE_2 has an exemplary 9-distinct-country solution against the real countries.json', () => {
  const solution = findPuzzleSolution(PUZZLE_2, COUNTRIES);
  assert.ok(solution);
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

test('PUZZLE_3 has an exemplary 9-distinct-country solution against the real countries.json', () => {
  const solution = findPuzzleSolution(PUZZLE_3, COUNTRIES);
  assert.ok(solution);
  const codes = solution.flat().map((c) => c.code);
  assert.equal(new Set(codes).size, 9, `expected 9 distinct countries, got codes: ${codes.join(', ')}`);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      assert.equal(
        validateCell(PUZZLE_3, r, c, solution[r][c]),
        true,
        `cell [${r}][${c}] = ${solution[r][c].code} does not satisfy ${PUZZLE_3.rows[r].id} x ${PUZZLE_3.cols[c].id}`,
      );
    }
  }
  assert.equal(isPuzzleGeneratable(PUZZLE_3, COUNTRIES), true);
});

test('every ARCHIVE puzzle is solvable against the real countries.json', () => {
  for (const entry of ARCHIVE) {
    assert.equal(
      isPuzzleGeneratable(entry.puzzle, COUNTRIES),
      true,
      `ARCHIVE puzzle "${entry.slug}" (${entry.date}) has no 9-distinct-country solution`,
    );
  }
});

test('every ARCHIVE puzzle mixes category families (not all colors, not all continents)', () => {
  for (const entry of ARCHIVE) {
    assert.equal(
      puzzleMixesCategoryFamilies(entry.puzzle),
      true,
      `ARCHIVE puzzle "${entry.slug}" (${entry.date}) is a single-family puzzle — every cell is the same kind of category`,
    );
  }
});

test('ARCHIVE puzzles never repeat a (rowCat × colCat) pair across days', () => {
  /** @type {string[]} */
  const failures = [];
  for (let i = 1; i < ARCHIVE.length; i++) {
    for (let j = 0; j < i; j++) {
      const shared = sharedPuzzlePairs(ARCHIVE[j].puzzle, ARCHIVE[i].puzzle);
      for (const pair of shared) {
        failures.push(
          `${ARCHIVE[i].slug} (${ARCHIVE[i].date}) repeats pair "${pair}" from ${ARCHIVE[j].slug} (${ARCHIVE[j].date})`,
        );
      }
    }
  }
  assert.deepEqual(failures, [], failures.join('; '));
});

test('ARCHIVE dates form a consecutive day-by-day sequence', () => {
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  for (let i = 1; i < ARCHIVE.length; i++) {
    const prev = Date.parse(`${ARCHIVE[i - 1].date}T00:00:00Z`);
    const curr = Date.parse(`${ARCHIVE[i].date}T00:00:00Z`);
    assert.equal(
      curr - prev,
      MS_PER_DAY,
      `ARCHIVE "${ARCHIVE[i].slug}" date ${ARCHIVE[i].date} is not exactly one day after ${ARCHIVE[i - 1].date}`,
    );
  }
});

test('the main-menu 3x3 game tile in /index.html points at the most recent ARCHIVE puzzle', () => {
  const indexHtml = readFileSync(join(HERE, '..', 'index.html'), 'utf-8');
  const match = indexHtml.match(/class="game-tile"\s+href="flagGrid\/([^/"]+)\/"/);
  assert.ok(match, 'no flagGrid game-tile <a class="game-tile" href="flagGrid/N/"> found in index.html');
  const lastSlug = ARCHIVE[ARCHIVE.length - 1].slug;
  assert.equal(
    match[1],
    lastSlug,
    `main-menu 3x3 tile links to flagGrid/${match[1]}/, expected flagGrid/${lastSlug}/ (newest ARCHIVE entry)`,
  );
});

test('every flagGrid burger-menu "Today" link points at the most recent ARCHIVE puzzle', () => {
  const lastSlug = ARCHIVE[ARCHIVE.length - 1].slug;
  const folders = [...ARCHIVE.map((e) => e.slug), 'archive', 'rand'];
  /** @type {string[]} */
  const failures = [];
  for (const folder of folders) {
    const path = join(HERE, '..', 'flagGrid', folder, 'index.html');
    const html = readFileSync(path, 'utf-8');
    const match = html.match(/href="\.\.\/([^/"]+)\/"\s+data-i18n="menu\.today"/);
    if (!match) {
      failures.push(`flagGrid/${folder}/index.html has no <a href="../N/" data-i18n="menu.today"> link`);
      continue;
    }
    if (match[1] !== lastSlug) {
      failures.push(`flagGrid/${folder}/index.html "Today" link points to ../${match[1]}/, expected ../${lastSlug}/`);
    }
  }
  assert.deepEqual(failures, [], failures.join('; '));
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
