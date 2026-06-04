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
} from './engine.js';
import { CONTINENTS } from './group.js';
import { emptyFilters, matchesFilters } from './flagsFilter.js';

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
    const colors = c.colors ?? [];
    assert.ok(colors.includes('red') && colors.includes('blue'),
      `${c.code}: expected both 'red' and 'blue' in colors, got ${JSON.stringify(colors)}`);
  }
});

