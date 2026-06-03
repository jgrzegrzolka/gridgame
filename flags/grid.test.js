import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateCell,
  solutionState,
  tryPick,
  continent,
  statehood,
  hasColor,
  hasMotif,
  puzzlePairs,
  sharedPuzzlePairs,
  puzzleMixesCategoryFamilies,
  translateCategoryLabel,
  suggest,
  exactSingleMatch,
  foldDiacritics,
  randomPuzzle,
  puzzleCellCounts,
  findPuzzleSolution,
  isPuzzleGeneratable,
  generateRandomPuzzle,
  hasUltimatePuzzleSolution,
  generateUltimateRandomPuzzle,
  axesConflict,
  buildRandomCategoryPool,
  computeGridScore,
  loadGridState,
  saveGridState,
  gridBestKey,
  recordGridResult,
  fillEmptyCellsForGiveUp,
  cellRenderClasses,
  pulseShake,
  isGridLocked,
  CONTINENTS_FOR_RANDOM,
  COLORS_FOR_RANDOM,
  MOTIFS_FOR_RANDOM,
} from './grid.js';

/** @typedef {import('./group.js').Country} Country */

/**
 * @param {Partial<Country> & { code: string, name: string }} fields
 * @returns {Country}
 */
function country(fields) {
  return {
    category: 'country',
    continent: 'Europe',
    statehood: 'un_member',
    ...fields,
  };
}

const FR = country({ code: 'fr', name: 'France', continent: 'Europe', statehood: 'un_member' });
const DE = country({ code: 'de', name: 'Germany', continent: 'Europe', statehood: 'un_member' });
const VA = country({ code: 'va', name: 'Vatican', continent: 'Europe', statehood: 'un_observer' });
const GL = country({ code: 'gl', name: 'Greenland', continent: 'Europe', statehood: 'territory' });
const JP = country({ code: 'jp', name: 'Japan', continent: 'Asia', statehood: 'un_member' });
const HK = country({ code: 'hk', name: 'Hong Kong', continent: 'Asia', statehood: 'territory' });
const KE = country({ code: 'ke', name: 'Kenya', continent: 'Africa', statehood: 'un_member' });

const EUROPE = continent('Europe');
const ASIA = continent('Asia');
const AFRICA = continent('Africa');

const UN = statehood('un_member', 'UN member');
const OBSERVER = statehood('un_observer', 'UN observer');
const TERRITORY = statehood('territory', 'Territory');

/** @type {import('./grid.js').Puzzle} */
const PUZZLE = {
  rows: [EUROPE, ASIA, AFRICA],
  cols: [UN, OBSERVER, TERRITORY],
};

test('continent predicate matches countries on that continent', () => {
  assert.equal(EUROPE.predicate(FR), true);
  assert.equal(EUROPE.predicate(JP), false);
});

test('continent category has a stable id and label', () => {
  assert.equal(EUROPE.id, 'continent:Europe');
  assert.equal(EUROPE.label, 'Europe');
});

test('statehood predicate matches countries with that statehood', () => {
  assert.equal(UN.predicate(FR), true);
  assert.equal(UN.predicate(VA), false);
  assert.equal(TERRITORY.predicate(GL), true);
});

test('statehood category defaults label to a humanised value', () => {
  assert.equal(statehood('un_member').label, 'un member');
  assert.equal(statehood('un_member', 'UN member').label, 'UN member');
});

test('hasColor predicate matches countries whose flag includes that colour', () => {
  const flagFr = country({ code: 'fr', name: 'France', colors: ['blue', 'white', 'red'] });
  const flagJp = country({ code: 'jp', name: 'Japan', colors: ['white', 'red'] });
  assert.equal(hasColor('blue').predicate(flagFr), true);
  assert.equal(hasColor('blue').predicate(flagJp), false);
});

test('hasColor predicate returns false when colors is missing or empty', () => {
  const noTag = country({ code: 'xx', name: 'Untagged' });
  const emptyTag = country({ code: 'yy', name: 'EmptyTag', colors: [] });
  assert.equal(hasColor('red').predicate(noTag), false);
  assert.equal(hasColor('red').predicate(emptyTag), false);
});

test('hasColor category has a stable id and label', () => {
  const cat = hasColor('green');
  assert.equal(cat.id, 'hasColor:green');
  assert.equal(cat.label, 'Has green');
});

test('hasMotif predicate matches countries whose flag depicts that motif', () => {
  const withAnimal = country({ code: 'al', name: 'Albania', motifs: ['animal'] });
  const without = country({ code: 'fr', name: 'France', motifs: [] });
  assert.equal(hasMotif('animal').predicate(withAnimal), true);
  assert.equal(hasMotif('animal').predicate(without), false);
});

test('hasMotif predicate returns false when motifs is missing or empty', () => {
  const noTag = country({ code: 'xx', name: 'Untagged' });
  const emptyTag = country({ code: 'yy', name: 'EmptyTag', motifs: [] });
  assert.equal(hasMotif('animal').predicate(noTag), false);
  assert.equal(hasMotif('animal').predicate(emptyTag), false);
});

test('hasMotif category has a stable id and label', () => {
  const cat = hasMotif('animal');
  assert.equal(cat.id, 'hasMotif:animal');
  assert.equal(cat.label, 'Has animal');
});

test('suggest returns an empty list while the trimmed query is under 3 characters', () => {
  const countries = [
    country({ code: 'fr', name: 'France' }),
    country({ code: 'de', name: 'Germany' }),
  ];
  assert.deepEqual(suggest(countries, ''), []);
  assert.deepEqual(suggest(countries, 'f'), []);
  assert.deepEqual(suggest(countries, 'fr'), []);
});

test('suggest treats whitespace-only queries as too short', () => {
  const countries = [country({ code: 'fr', name: 'France' })];
  assert.deepEqual(suggest(countries, '   '), []);
});

test('suggest matches by case-insensitive substring once the query reaches 3 chars', () => {
  const countries = [
    country({ code: 'fr', name: 'France' }),
    country({ code: 'fi', name: 'Finland' }),
    country({ code: 'de', name: 'Germany' }),
  ];
  assert.deepEqual(suggest(countries, 'fra').map((c) => c.code), ['fr']);
  assert.deepEqual(suggest(countries, 'FRA').map((c) => c.code), ['fr']);
});

test('suggest matches a substring that appears anywhere in the name, not just the prefix', () => {
  const countries = [
    country({ code: 'is', name: 'Iceland' }),
    country({ code: 'gl', name: 'Greenland' }),
    country({ code: 'es', name: 'Spain' }),
  ];
  assert.deepEqual(
    suggest(countries, 'and').map((c) => c.code).sort(),
    ['gl', 'is'],
  );
});

test('suggest matches against country names case-insensitively', () => {
  const countries = [country({ code: 'fr', name: 'france' })];
  assert.deepEqual(suggest(countries, 'FRA').map((c) => c.code), ['fr']);
});

test('suggest trims whitespace around the query', () => {
  const countries = [country({ code: 'fr', name: 'France' })];
  assert.deepEqual(suggest(countries, '  fra  ').map((c) => c.code), ['fr']);
});

test('suggest returns an empty list when nothing matches the query', () => {
  const countries = [country({ code: 'fr', name: 'France' })];
  assert.deepEqual(suggest(countries, 'xyz'), []);
});

test('suggest caps results at the default limit of 8', () => {
  const countries = Array.from({ length: 20 }, (_, i) =>
    country({ code: `c${i}`, name: `Country${i}` })
  );
  assert.equal(suggest(countries, 'cou').length, 8);
});

test('suggest respects a custom limit', () => {
  const countries = Array.from({ length: 20 }, (_, i) =>
    country({ code: `c${i}`, name: `Country${i}` })
  );
  assert.equal(suggest(countries, 'cou', { limit: 3 }).length, 3);
});

test('suggest excludes countries whose codes are in excludeCodes', () => {
  const countries = [
    country({ code: 'fr', name: 'France' }),
    country({ code: 'fi', name: 'Finland' }),
  ];
  const result = suggest(countries, 'fin', { excludeCodes: new Set(['fi']) });
  assert.deepEqual(result.map((c) => c.code), []);
});

test('suggest only excludes the codes listed in excludeCodes, not unrelated matches', () => {
  const countries = [
    country({ code: 'fr', name: 'France' }),
    country({ code: 'fra', name: 'Franconia' }),
  ];
  const result = suggest(countries, 'fra', { excludeCodes: new Set(['fr']) });
  assert.deepEqual(result.map((c) => c.code), ['fra']);
});

test('suggest with an empty excludeCodes set behaves the same as no excludeCodes', () => {
  const countries = [country({ code: 'fr', name: 'France' })];
  const withEmpty = suggest(countries, 'fra', { excludeCodes: new Set() });
  const without = suggest(countries, 'fra');
  assert.deepEqual(withEmpty, without);
});

test('suggest matches a country by its alias (case-insensitive)', () => {
  const us = country({ code: 'us', name: 'United States of America', aliases: ['USA'] });
  const fr = country({ code: 'fr', name: 'France' });
  assert.deepEqual(suggest([us, fr], 'usa').map((c) => c.code), ['us']);
  assert.deepEqual(suggest([us, fr], 'USA').map((c) => c.code), ['us']);
});

test('suggest matches by alias substring, not just exact alias', () => {
  const cd = country({ code: 'cd', name: 'Democratic Republic of the Congo', aliases: ['DRC'] });
  assert.deepEqual(suggest([cd], 'drc').map((c) => c.code), ['cd']);
});

test('suggest aliases do not displace name matches — both surface', () => {
  const us = country({ code: 'us', name: 'United States of America', aliases: ['USA'] });
  const fr = country({ code: 'fr', name: 'France' });
  // "united" matches us via name only; "usa" matches us via alias only.
  assert.deepEqual(suggest([us, fr], 'united').map((c) => c.code), ['us']);
  assert.deepEqual(suggest([us, fr], 'usa').map((c) => c.code), ['us']);
});

test('exactSingleMatch returns the country when the query equals its full name', () => {
  const fr = country({ code: 'fr', name: 'France' });
  assert.equal(exactSingleMatch([fr], 'France'), fr);
});

test('exactSingleMatch is case-insensitive and ignores surrounding whitespace', () => {
  const fr = country({ code: 'fr', name: 'France' });
  const de = country({ code: 'de', name: 'Germany' });
  assert.equal(exactSingleMatch([fr], '  france  '), fr);
  assert.equal(exactSingleMatch([de], 'GERMANY'), de);
});

test('exactSingleMatch returns null when more than one country matches (ambiguity)', () => {
  const niger = country({ code: 'ne', name: 'Niger' });
  const nigeria = country({ code: 'ng', name: 'Nigeria' });
  assert.equal(exactSingleMatch([niger, nigeria], 'Niger'), null);
});

test('exactSingleMatch returns null when the single match is only a prefix of the typed text', () => {
  const fr = country({ code: 'fr', name: 'France' });
  assert.equal(exactSingleMatch([fr], 'Fran'), null);
});

test('exactSingleMatch returns null for an empty or whitespace-only query', () => {
  const fr = country({ code: 'fr', name: 'France' });
  assert.equal(exactSingleMatch([fr], ''), null);
  assert.equal(exactSingleMatch([fr], '   '), null);
});

test('exactSingleMatch returns null when there are no matches', () => {
  assert.equal(exactSingleMatch([], 'France'), null);
});

test('exactSingleMatch accepts a full-name alias (e.g. "USA" -> United States)', () => {
  const us = country({ code: 'us', name: 'United States of America', aliases: ['USA'] });
  assert.equal(exactSingleMatch([us], 'USA'), us);
  assert.equal(exactSingleMatch([us], 'usa'), us);
});

test('exactSingleMatch rejects an alias that is only a substring of the typed text', () => {
  const us = country({ code: 'us', name: 'United States of America', aliases: ['USA'] });
  assert.equal(exactSingleMatch([us], 'USAA'), null);
});

// ---- foldDiacritics ----

test('foldDiacritics lowercases and strips combining accents', () => {
  assert.equal(foldDiacritics('España'), 'espana');
  assert.equal(foldDiacritics('Côte d\'Ivoire'), 'cote d\'ivoire');
  assert.equal(foldDiacritics('Türkiye'), 'turkiye');
});

test('foldDiacritics folds Polish ł that does not decompose under NFD', () => {
  assert.equal(foldDiacritics('Łódź'), 'lodz');
  assert.equal(foldDiacritics('Włochy'), 'wlochy');
  assert.equal(foldDiacritics('Łotwa'), 'lotwa');
});

test('foldDiacritics folds non-combining Latin letters across other languages', () => {
  assert.equal(foldDiacritics('Tromsø'), 'tromso');
  assert.equal(foldDiacritics('Æthelstan'), 'aethelstan');
  assert.equal(foldDiacritics('Cœur'), 'coeur');
  assert.equal(foldDiacritics('Straße'), 'strasse');
  assert.equal(foldDiacritics('Đại Việt'), 'dai viet');
});

test('foldDiacritics is the identity on plain ASCII (lowercased)', () => {
  assert.equal(foldDiacritics('Poland'), 'poland');
  assert.equal(foldDiacritics(''), '');
});

// ---- suggest + exactSingleMatch with folded diacritics ----

test('suggest matches a localized alias that has Polish diacritics from an ASCII query', () => {
  const it = country({ code: 'it', name: 'Italy', aliases: ['Włochy'] });
  assert.deepEqual(suggest([it], 'wlochy').map((c) => c.code), ['it']);
  assert.deepEqual(suggest([it], 'WLOCHY').map((c) => c.code), ['it']);
  // Typing WITH the diacritics still works — the fold is applied symmetrically.
  assert.deepEqual(suggest([it], 'Włochy').map((c) => c.code), ['it']);
});

test('suggest folds diacritics on country names too, not just aliases', () => {
  const es = country({ code: 'es', name: 'España' });
  assert.deepEqual(suggest([es], 'espana').map((c) => c.code), ['es']);
  assert.deepEqual(suggest([es], 'esp').map((c) => c.code), ['es']);
});

test('suggest enforces the 3-char minimum on the raw input, not the folded form', () => {
  // "ß" alone folds to "ss" (length 2), but the raw input is 1 character.
  // The minimum-length rule should stay tied to what the user actually typed.
  const de = country({ code: 'de', name: 'Straße' });
  assert.deepEqual(suggest([de], 'ß'), []);
});

test('exactSingleMatch accepts the localized name typed without diacritics', () => {
  const pl = country({ code: 'pl', name: 'Poland', aliases: ['Polska'] });
  assert.equal(exactSingleMatch([pl], 'polska'), pl);
  assert.equal(exactSingleMatch([pl], 'POLSKA'), pl);
  assert.equal(exactSingleMatch([pl], 'Polska'), pl);
});

test('exactSingleMatch folds diacritics on both name and aliases', () => {
  const it = country({ code: 'it', name: 'Italy', aliases: ['Włochy'] });
  assert.equal(exactSingleMatch([it], 'wlochy'), it);
  assert.equal(exactSingleMatch([it], 'Włochy'), it);
  assert.equal(exactSingleMatch([it], 'italy'), it);
});

test('validateCell is true when country satisfies both row and column', () => {
  assert.equal(validateCell(PUZZLE, 0, 0, FR), true);
  assert.equal(validateCell(PUZZLE, 0, 1, VA), true);
  assert.equal(validateCell(PUZZLE, 1, 2, HK), true);
});

test('validateCell is false when the row predicate fails', () => {
  assert.equal(validateCell(PUZZLE, 0, 0, JP), false);
});

test('validateCell is false when the column predicate fails', () => {
  assert.equal(validateCell(PUZZLE, 0, 1, FR), false);
});

test('validateCell is false for an empty cell (null country)', () => {
  assert.equal(validateCell(PUZZLE, 0, 0, null), false);
});

test('solutionState marks an empty solution as no-cell-filled and not complete', () => {
  const empty = [
    [null, null, null],
    [null, null, null],
    [null, null, null],
  ];
  const state = solutionState(PUZZLE, empty);
  assert.equal(state.complete, false);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      assert.deepEqual(state.cells[r][c], { filled: false, valid: false, duplicate: false });
    }
  }
});

test('solutionState reports filled+valid for a correct pick', () => {
  const solution = [
    [FR,   null, null],
    [null, null, null],
    [null, null, null],
  ];
  const state = solutionState(PUZZLE, solution);
  assert.deepEqual(state.cells[0][0], { filled: true, valid: true, duplicate: false });
  assert.equal(state.complete, false);
});

test('solutionState reports filled-but-invalid when a wrong country is dropped in', () => {
  const solution = [
    [JP,   null, null],
    [null, null, null],
    [null, null, null],
  ];
  const state = solutionState(PUZZLE, solution);
  assert.deepEqual(state.cells[0][0], { filled: true, valid: false, duplicate: false });
});

test('solutionState flags duplicates on every cell where the same country appears', () => {
  const solution = [
    [FR,   null, null],
    [null, null, null],
    [null, null, null],
  ];
  solution[0][0] = FR;
  solution[0][1] = FR;
  const state = solutionState(PUZZLE, solution);
  assert.equal(state.cells[0][0].duplicate, true);
  assert.equal(state.cells[0][1].duplicate, true);
});

test('solutionState.complete is true when all nine cells are filled, valid, and distinct', () => {
  const PS = country({ code: 'ps', name: 'Palestine', continent: 'Asia', statehood: 'un_observer' });
  const AF_OBS = country({ code: 'aob', name: 'AfricaObs', continent: 'Africa', statehood: 'un_observer' });
  const AF_TER = country({ code: 'ater', name: 'AfricaTer', continent: 'Africa', statehood: 'territory' });

  const solution = [
    [FR, VA, GL],
    [JP, PS, HK],
    [KE, AF_OBS, AF_TER],
  ];
  const state = solutionState(PUZZLE, solution);
  assert.equal(state.complete, true);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      assert.deepEqual(state.cells[r][c], { filled: true, valid: true, duplicate: false });
    }
  }
});

/** @returns {(Country | null)[][]} */
function emptySolution() {
  return [
    [null, null, null],
    [null, null, null],
    [null, null, null],
  ];
}

test('tryPick accepts a valid, unique pick and returns a new solution with the pick placed', () => {
  const before = emptySolution();
  const result = tryPick(PUZZLE, before, 0, 0, FR);
  assert.equal(result.accepted, true);
  assert.ok(result.solution);
  assert.equal(result.solution[0][0], FR);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      if (r === 0 && c === 0) continue;
      assert.equal(result.solution[r][c], null);
    }
  }
});

test('tryPick rejects when the row predicate fails', () => {
  const result = tryPick(PUZZLE, emptySolution(), 0, 0, JP);
  assert.equal(result.accepted, false);
  assert.equal(result.solution, undefined);
});

test('tryPick rejects when the column predicate fails', () => {
  const result = tryPick(PUZZLE, emptySolution(), 0, 1, FR);
  assert.equal(result.accepted, false);
});

test('tryPick rejects a duplicate of a country already placed elsewhere', () => {
  const dupPuzzle = {
    rows: [EUROPE, EUROPE, AFRICA],
    cols: [UN, UN, TERRITORY],
  };
  const solution = emptySolution();
  solution[0][0] = FR;
  const result = tryPick(dupPuzzle, solution, 1, 1, FR);
  assert.equal(result.accepted, false);
});

test('tryPick rejects any pick on an already-filled cell (placed cells are locked)', () => {
  const solution = emptySolution();
  solution[0][0] = FR;
  const result = tryPick(PUZZLE, solution, 0, 0, DE);
  assert.equal(result.accepted, false);
  assert.equal(result.solution, undefined);
});

test('tryPick rejects re-picking the same country into its own already-filled cell', () => {
  const solution = emptySolution();
  solution[0][0] = FR;
  const result = tryPick(PUZZLE, solution, 0, 0, FR);
  assert.equal(result.accepted, false);
});

test('tryPick does not mutate the original solution on accept', () => {
  const before = emptySolution();
  before[1][1] = JP;
  const snapshot = before.map((r) => r.slice());
  tryPick(PUZZLE, before, 0, 0, FR);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      assert.equal(before[r][c], snapshot[r][c]);
    }
  }
});

/** @param {number[]} values */
function sequenceRng(values) {
  let i = 0;
  return () => values[i++ % values.length];
}

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

test('randomPuzzle yields 3 row categories and 3 column categories', () => {
  const p = randomPuzzle(() => 0);
  assert.equal(p.rows.length, 3);
  assert.equal(p.cols.length, 3);
});

test('randomPuzzle categories come from the unified pool (continent / colour / motif)', () => {
  const p = randomPuzzle(mulberry32(1));
  for (const cat of [...p.rows, ...p.cols]) {
    if (cat.id.startsWith('continent:')) {
      assert.ok(/** @type {readonly string[]} */ (CONTINENTS_FOR_RANDOM).includes(cat.label));
    } else if (cat.id.startsWith('hasColor:')) {
      const color = cat.id.slice('hasColor:'.length);
      assert.ok(COLORS_FOR_RANDOM.includes(color), `color ${color} not in palette`);
    } else if (cat.id.startsWith('hasMotif:')) {
      const motif = cat.id.slice('hasMotif:'.length);
      assert.ok(MOTIFS_FOR_RANDOM.includes(motif), `motif ${motif} not in palette`);
    } else {
      assert.fail(`unexpected category id: ${cat.id}`);
    }
  }
});

test('randomPuzzle picks 6 distinct categories across both axes (no duplicates anywhere)', () => {
  for (let s = 1; s <= 20; s++) {
    const p = randomPuzzle(mulberry32(s));
    const ids = new Set([...p.rows, ...p.cols].map((c) => c.id));
    assert.equal(ids.size, 6, `seed ${s}: not 6 distinct categories — ${[...p.rows, ...p.cols].map((c) => c.id).join(', ')}`);
  }
});

test('randomPuzzle is deterministic given a deterministic RNG', () => {
  const seed = [0.11, 0.27, 0.83, 0.04, 0.55, 0.62, 0.71, 0.99, 0.18, 0.36];
  const p1 = randomPuzzle(sequenceRng(seed));
  const p2 = randomPuzzle(sequenceRng(seed));
  assert.deepEqual(p1.rows.map((r) => r.id), p2.rows.map((r) => r.id));
  assert.deepEqual(p1.cols.map((c) => c.id), p2.cols.map((c) => c.id));
});

test('COLORS_FOR_RANDOM is the 7-colour canonical palette', () => {
  assert.deepEqual(
    COLORS_FOR_RANDOM,
    ['red', 'white', 'blue', 'green', 'yellow', 'black', 'orange'],
  );
});

test('MOTIFS_FOR_RANDOM lists every motif key that can be tagged on a flag', () => {
  assert.deepEqual(MOTIFS_FOR_RANDOM, ['animal', 'coat-of-arms', 'weapon', 'star-or-moon', 'cross']);
});

test('continent and statehood categories carry their exclusiveGroup', () => {
  assert.equal(continent('Europe').exclusiveGroup, 'continent');
  assert.equal(statehood('un_member').exclusiveGroup, 'statehood');
  assert.equal(hasColor('red').exclusiveGroup, undefined);
  assert.equal(hasMotif('animal').exclusiveGroup, undefined);
});

test('buildRandomCategoryPool returns one entry per continent + colour + motif', () => {
  const pool = buildRandomCategoryPool();
  const expected =
    CONTINENTS_FOR_RANDOM.length + COLORS_FOR_RANDOM.length + MOTIFS_FOR_RANDOM.length;
  assert.equal(pool.length, expected);
  assert.notEqual(buildRandomCategoryPool(), pool);
});

test('axesConflict flags two different values from the same exclusiveGroup on opposite axes', () => {
  const conflict = axesConflict(
    [continent('Africa'), hasColor('red'), hasMotif('animal')],
    [continent('Europe'), hasColor('blue'), hasMotif('weapon')],
  );
  assert.equal(conflict, true);
});

test('axesConflict returns false when same-group categories live on the same axis', () => {
  const conflict = axesConflict(
    [continent('Africa'), continent('Asia'), continent('Europe')],
    [hasColor('red'), hasColor('blue'), hasMotif('animal')],
  );
  assert.equal(conflict, false);
});

test('axesConflict returns false when no categories share an exclusiveGroup', () => {
  const conflict = axesConflict(
    [hasColor('red'), hasColor('blue'), hasMotif('animal')],
    [hasColor('green'), hasMotif('weapon'), hasMotif('coat-of-arms')],
  );
  assert.equal(conflict, false);
});

test('puzzlePairs lists all 9 rowId|colId cell signatures in row-major order', () => {
  const puzzle = {
    rows: [continent('Europe'), continent('Asia'), continent('Africa')],
    cols: [hasColor('red'), hasColor('white'), hasMotif('weapon')],
  };
  assert.deepEqual(puzzlePairs(puzzle), [
    'continent:Europe|hasColor:red',
    'continent:Europe|hasColor:white',
    'continent:Europe|hasMotif:weapon',
    'continent:Asia|hasColor:red',
    'continent:Asia|hasColor:white',
    'continent:Asia|hasMotif:weapon',
    'continent:Africa|hasColor:red',
    'continent:Africa|hasColor:white',
    'continent:Africa|hasMotif:weapon',
  ]);
});

test('sharedPuzzlePairs returns [] when two puzzles have no overlapping cells', () => {
  const a = {
    rows: [continent('Europe'), continent('Asia'), continent('Africa')],
    cols: [hasColor('red'), hasMotif('animal'), hasMotif('coat-of-arms')],
  };
  const b = {
    rows: [continent('Oceania'), hasColor('blue'), hasColor('yellow')],
    cols: [hasMotif('weapon'), hasMotif('star-or-moon'), hasColor('black')],
  };
  assert.deepEqual(sharedPuzzlePairs(a, b), []);
});

test('sharedPuzzlePairs flags an Africa×red collision regardless of which puzzle uses Africa as a row vs column', () => {
  const earlier = {
    rows: [continent('Europe'), continent('Asia'), continent('Africa')],
    cols: [hasColor('red'), hasMotif('animal'), hasMotif('coat-of-arms')],
  };
  const sameAxis = {
    rows: [continent('Oceania'), continent('Africa'), continent('South America')],
    cols: [hasColor('red'), hasColor('white'), hasColor('green')],
  };
  assert.deepEqual(sharedPuzzlePairs(earlier, sameAxis), ['continent:Africa|hasColor:red']);

  const swappedAxis = {
    rows: [hasColor('red'), hasColor('white'), hasColor('green')],
    cols: [continent('Oceania'), continent('Africa'), continent('South America')],
  };
  assert.deepEqual(sharedPuzzlePairs(earlier, swappedAxis), ['hasColor:red|continent:Africa']);
});

test('puzzleMixesCategoryFamilies is false when every category is a colour', () => {
  const allColors = {
    rows: [hasColor('red'), hasColor('white'), hasColor('blue')],
    cols: [hasColor('green'), hasColor('yellow'), hasColor('black')],
  };
  assert.equal(puzzleMixesCategoryFamilies(allColors), false);
});

test('puzzleMixesCategoryFamilies is false when every category is a continent', () => {
  const allContinents = {
    rows: [continent('Europe'), continent('Asia'), continent('Africa')],
    cols: [continent('North America'), continent('South America'), continent('Oceania')],
  };
  assert.equal(puzzleMixesCategoryFamilies(allContinents), false);
});

test('puzzleMixesCategoryFamilies is true when families are mixed across the axes', () => {
  const mixed = {
    rows: [continent('Europe'), continent('Asia'), continent('Africa')],
    cols: [hasColor('red'), hasMotif('animal'), hasMotif('coat-of-arms')],
  };
  assert.equal(puzzleMixesCategoryFamilies(mixed), true);
});

test('puzzleMixesCategoryFamilies tolerates a single non-color row in an otherwise all-color puzzle', () => {
  const oneMotif = {
    rows: [hasColor('red'), hasColor('white'), hasMotif('star-or-moon')],
    cols: [hasColor('green'), hasColor('blue'), hasColor('black')],
  };
  assert.equal(puzzleMixesCategoryFamilies(oneMotif), true);
});

/**
 * @param {Record<string, string>} table
 * @returns {(key: string, fallback: string) => string}
 */
function fakeTranslate(table) {
  return (key, fallback) => (key in table ? table[key] : fallback);
}

test('translateCategoryLabel uses the variant.* key for continent categories — reuses the flagQuiz vocabulary', () => {
  const t = fakeTranslate({ 'variant.africa': 'Afryka' });
  assert.equal(translateCategoryLabel(continent('Africa'), t), 'Afryka');
});

test('translateCategoryLabel kebab-cases multi-word continent ids before looking them up', () => {
  const t = fakeTranslate({ 'variant.north-america': 'Ameryka Północna' });
  assert.equal(translateCategoryLabel(continent('North America'), t), 'Ameryka Północna');
});

test('translateCategoryLabel interpolates game.has with the color noun', () => {
  const t = fakeTranslate({ 'game.has': 'Ma {x}', 'color.red': 'czerwony' });
  assert.equal(translateCategoryLabel(hasColor('red'), t), 'Ma czerwony');
});

test('translateCategoryLabel interpolates game.has with the motif noun, hyphens and all', () => {
  const t = fakeTranslate({ 'game.has': 'Ma {x}', 'motif.star-or-moon': 'gwiazda lub księżyc' });
  assert.equal(translateCategoryLabel(hasMotif('star-or-moon'), t), 'Ma gwiazda lub księżyc');
});

test('translateCategoryLabel falls back to the baked English label when the variant key is missing', () => {
  // The factory bakes label="Oceania"; if no translation is available
  // the fallback should surface that label rather than rendering blank.
  const t = fakeTranslate({});
  assert.equal(translateCategoryLabel(continent('Oceania'), t), 'Oceania');
});

test('translateCategoryLabel falls back to the baked "Has X" label when game.has is missing', () => {
  const t = fakeTranslate({});
  assert.equal(translateCategoryLabel(hasColor('red'), t), 'Has red');
});

test('translateCategoryLabel returns the raw label for ids it does not recognise', () => {
  const t = fakeTranslate({});
  const stranger = { id: 'foo:bar', label: 'baked stranger', predicate: () => true };
  assert.equal(translateCategoryLabel(stranger, t), 'baked stranger');
});

test('translateCategoryLabel returns the raw label for ids without a colon', () => {
  const t = fakeTranslate({});
  const noColon = { id: 'whatever', label: 'whatever-label', predicate: () => true };
  assert.equal(translateCategoryLabel(noColon, t), 'whatever-label');
});

test('axesConflict returns false for different exclusiveGroups (continent vs statehood)', () => {
  const conflict = axesConflict(
    [continent('Africa'), continent('Asia'), continent('Europe')],
    [statehood('un_member'), statehood('un_observer'), statehood('territory')],
  );
  assert.equal(conflict, false);
});

test('puzzleCellCounts counts countries satisfying both predicates per cell', () => {
  const puzzle = {
    rows: [continent('Europe'), continent('Asia'), continent('Africa')],
    cols: [hasColor('red'), hasColor('blue'), hasColor('yellow')],
  };
  const countries = [
    country({ code: 'al', name: 'Albania', continent: 'Europe', colors: ['red'] }),
    country({ code: 'gr', name: 'Greece',  continent: 'Europe', colors: ['blue'] }),
    country({ code: 'jp', name: 'Japan',   continent: 'Asia',   colors: ['red', 'white'] }),
    country({ code: 'cm', name: 'Cameroon',continent: 'Africa', colors: ['yellow', 'green'] }),
  ];
  const counts = puzzleCellCounts(puzzle, countries);
  assert.equal(counts[0][0], 1);
  assert.equal(counts[0][1], 1);
  assert.equal(counts[0][2], 0);
  assert.equal(counts[1][0], 1);
  assert.equal(counts[1][1], 0);
  assert.equal(counts[1][2], 0);
  assert.equal(counts[2][0], 0);
  assert.equal(counts[2][1], 0);
  assert.equal(counts[2][2], 1);
});

test('isPuzzleGeneratable returns true when every cell meets minPerCell AND a no-duplicate solution exists', () => {
  const puzzle = {
    rows: [continent('Europe'), continent('Asia'), continent('Africa')],
    cols: [UN, OBSERVER, TERRITORY],
  };
  const PS    = country({ code: 'ps',  name: 'Palestine', continent: 'Asia',   statehood: 'un_observer' });
  const AFOBS = country({ code: 'aob', name: 'AfricaObs', continent: 'Africa', statehood: 'un_observer' });
  const AFTER = country({ code: 'ate', name: 'AfricaTer', continent: 'Africa', statehood: 'territory' });
  const countries = [FR, VA, GL, JP, PS, HK, KE, AFOBS, AFTER];
  assert.equal(isPuzzleGeneratable(puzzle, countries, 1), true);
});

test('isPuzzleGeneratable returns false when any single cell falls below minPerCell', () => {
  const puzzle = {
    rows: [continent('Europe'), continent('Europe'), continent('Europe')],
    cols: [hasColor('red'), hasColor('red'), hasColor('orange')],
  };
  const countries = [
    country({ code: 'al', name: 'Albania', continent: 'Europe', colors: ['red'] }),
    country({ code: 'pl', name: 'Poland',  continent: 'Europe', colors: ['red', 'white'] }),
  ];
  assert.equal(isPuzzleGeneratable(puzzle, countries, 2), false);
});

test('isPuzzleGeneratable defaults to minPerCell of 2', () => {
  const puzzle = {
    rows: [continent('Europe'), continent('Europe'), continent('Europe')],
    cols: [hasColor('red'), hasColor('red'), hasColor('red')],
  };
  const oneCountry = [country({ code: 'al', name: 'Albania', continent: 'Europe', colors: ['red'] })];
  assert.equal(isPuzzleGeneratable(puzzle, oneCountry), false);
});

test('isPuzzleGeneratable returns false when the no-duplicates rule blocks a global solution even though every cell has candidates', () => {
  const puzzle = {
    rows: [continent('Europe'), continent('Europe'), continent('Europe')],
    cols: [hasColor('red'), hasColor('red'), hasColor('red')],
  };
  const twoCountries = [
    country({ code: 'al', name: 'Albania', continent: 'Europe', colors: ['red'] }),
    country({ code: 'pl', name: 'Poland',  continent: 'Europe', colors: ['red', 'white'] }),
  ];
  assert.equal(isPuzzleGeneratable(puzzle, twoCountries, 1), false);
  assert.equal(isPuzzleGeneratable(puzzle, twoCountries, 2), false);
});

test('findPuzzleSolution returns a valid 9-distinct-country solution when one exists', () => {
  const puzzle = {
    rows: [continent('Europe'), continent('Asia'), continent('Africa')],
    cols: [UN, OBSERVER, TERRITORY],
  };
  const PS    = country({ code: 'ps',  name: 'Palestine', continent: 'Asia',   statehood: 'un_observer' });
  const AFOBS = country({ code: 'aob', name: 'AfricaObs', continent: 'Africa', statehood: 'un_observer' });
  const AFTER = country({ code: 'ate', name: 'AfricaTer', continent: 'Africa', statehood: 'territory' });
  const countries = [FR, VA, GL, JP, PS, HK, KE, AFOBS, AFTER];
  const solution = findPuzzleSolution(puzzle, countries);
  assert.ok(solution);
  const codes = solution.flat().map((c) => c.code);
  assert.equal(new Set(codes).size, 9);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      assert.equal(validateCell(puzzle, r, c, solution[r][c]), true);
    }
  }
});

test('findPuzzleSolution returns null when any cell has zero candidates', () => {
  const puzzle = {
    rows: [continent('Europe'), continent('Asia'), continent('Africa')],
    cols: [hasColor('red'), hasColor('blue'), hasColor('orange')],
  };
  const countries = [
    country({ code: 'al', name: 'Albania',  continent: 'Europe', colors: ['red'] }),
    country({ code: 'gr', name: 'Greece',   continent: 'Europe', colors: ['blue'] }),
    country({ code: 'jp', name: 'Japan',    continent: 'Asia',   colors: ['red'] }),
  ];
  assert.equal(findPuzzleSolution(puzzle, countries), null);
});

test('findPuzzleSolution returns null when the no-duplicate rule prevents any complete assignment', () => {
  const puzzle = {
    rows: [continent('Europe'), continent('Europe'), continent('Europe')],
    cols: [hasColor('red'), hasColor('red'), hasColor('red')],
  };
  const twoCountries = [
    country({ code: 'al', name: 'Albania', continent: 'Europe', colors: ['red'] }),
    country({ code: 'pl', name: 'Poland',  continent: 'Europe', colors: ['red'] }),
  ];
  assert.equal(findPuzzleSolution(puzzle, twoCountries), null);
});

test('findPuzzleSolution does not mutate the inputs', () => {
  const puzzle = {
    rows: [continent('Europe'), continent('Asia'), continent('Africa')],
    cols: [UN, OBSERVER, TERRITORY],
  };
  const PS    = country({ code: 'ps',  name: 'Palestine', continent: 'Asia',   statehood: 'un_observer' });
  const AFOBS = country({ code: 'aob', name: 'AfricaObs', continent: 'Africa', statehood: 'un_observer' });
  const AFTER = country({ code: 'ate', name: 'AfricaTer', continent: 'Africa', statehood: 'territory' });
  const countries = [FR, VA, GL, JP, PS, HK, KE, AFOBS, AFTER];
  const beforeRowIds = puzzle.rows.map((r) => r.id);
  const beforeColIds = puzzle.cols.map((c) => c.id);
  const beforeCodes = countries.map((c) => c.code);
  findPuzzleSolution(puzzle, countries);
  assert.deepEqual(puzzle.rows.map((r) => r.id), beforeRowIds);
  assert.deepEqual(puzzle.cols.map((c) => c.id), beforeColIds);
  assert.deepEqual(countries.map((c) => c.code), beforeCodes);
});

/**
 * Build a synthetic country pool where every (continent × color) cell of the
 * 3×3 has exactly `perCell` distinct flags matching it. Each flag also carries
 * every motif key so the random puzzle generator (which can pick motif rows/
 * cols) still finds candidates for motif cells — keeps the helper usable for
 * the `generateUltimateRandomPuzzle` test.
 *
 * @param {string[]} continents
 * @param {string[]} colors
 * @param {number} perCell
 */
function denseSquarePool(continents, colors, perCell) {
  /** @type {Country[]} */
  const out = [];
  let idx = 0;
  for (const cont of continents) {
    for (const color of colors) {
      for (let n = 0; n < perCell; n++) {
        out.push(country({
          code: `c${idx++}`, name: `${cont}-${color}-${n}`,
          continent: /** @type {any} */ (cont), colors: [color],
          motifs: [...MOTIFS_FOR_RANDOM],
        }));
      }
    }
  }
  return out;
}

test('hasUltimatePuzzleSolution: true when each of the 9 cells has its own 9 disjoint candidates', () => {
  const puzzle = {
    rows: [continent('Europe'), continent('Asia'), continent('Africa')],
    cols: [hasColor('red'), hasColor('blue'), hasColor('green')],
  };
  const countries = denseSquarePool(['Europe', 'Asia', 'Africa'], ['red', 'blue', 'green'], 9);
  assert.equal(hasUltimatePuzzleSolution(puzzle, countries), true);
});

test('hasUltimatePuzzleSolution: false when any cell falls below 9 candidates', () => {
  const puzzle = {
    rows: [continent('Europe'), continent('Asia'), continent('Africa')],
    cols: [hasColor('red'), hasColor('blue'), hasColor('green')],
  };
  // Every cell gets 9 except (Asia × blue) — remove one of its candidates,
  // leaving 8. The singleton subset {(Asia, blue)} demands 9 but supply is 8.
  const countries = denseSquarePool(['Europe', 'Asia', 'Africa'], ['red', 'blue', 'green'], 9);
  const oneAsiaBlue = countries.find((c) => c.continent === 'Asia' && c.colors?.includes('blue'));
  assert.ok(oneAsiaBlue);
  const filtered = countries.filter((c) => c.code !== oneAsiaBlue.code);
  assert.equal(hasUltimatePuzzleSolution(puzzle, filtered), false);
});

test('hasUltimatePuzzleSolution: false when cells share a candidate pool too thin to feed them all', () => {
  // Three different cells all have a generous pool, but they share the SAME
  // 12 multi-match countries. Demand for any pair of these cells is 18; their
  // union of candidates is only 12. Hall fails.
  const puzzle = {
    rows: [continent('Europe'), continent('Europe'), continent('Europe')],
    cols: [hasColor('red'), hasColor('white'), hasColor('blue')],
  };
  /** @type {Country[]} */
  const multiMatch = [];
  for (let i = 0; i < 12; i++) {
    multiMatch.push(country({
      code: `m${i}`, name: `multi-${i}`, continent: 'Europe',
      colors: ['red', 'white', 'blue'],
    }));
  }
  assert.equal(hasUltimatePuzzleSolution(puzzle, multiMatch), false);
});

test('hasUltimatePuzzleSolution: perCell=1 reduces it to the regular 9-distinct-country check', () => {
  // Same multi-match pool of 12 countries, 9 cells — at perCell=1, total
  // demand is 9 against supply 12. Hall passes.
  const puzzle = {
    rows: [continent('Europe'), continent('Europe'), continent('Europe')],
    cols: [hasColor('red'), hasColor('white'), hasColor('blue')],
  };
  /** @type {Country[]} */
  const multiMatch = [];
  for (let i = 0; i < 12; i++) {
    multiMatch.push(country({
      code: `m${i}`, name: `multi-${i}`, continent: 'Europe',
      colors: ['red', 'white', 'blue'],
    }));
  }
  assert.equal(hasUltimatePuzzleSolution(puzzle, multiMatch, 1), true);
  // Bump perCell to 2 — total demand 18 vs supply 12 → Hall fails.
  assert.equal(hasUltimatePuzzleSolution(puzzle, multiMatch, 2), false);
});

test('generateUltimateRandomPuzzle returns a puzzle that passes hasUltimatePuzzleSolution', () => {
  // Saturated synthetic pool — every (continent × color) cell has 9 flags of
  // its own. Any combination the generator picks must pass the Hall check.
  const countries = denseSquarePool(['Europe', 'Asia', 'Africa', 'North America', 'South America', 'Oceania'], COLORS_FOR_RANDOM, 9);
  const puzzle = generateUltimateRandomPuzzle(countries, { maxAttempts: 50 });
  assert.equal(hasUltimatePuzzleSolution(puzzle, countries), true);
});

test('generateUltimateRandomPuzzle throws when no puzzle in the category pool can be 9×9-solved', () => {
  // Sparse pool — only 1 country per (continent × color) cell. Every puzzle
  // fails the Hall check at the singleton subset (1 < 9).
  const countries = denseSquarePool(['Europe', 'Asia', 'Africa', 'North America', 'South America', 'Oceania'], COLORS_FOR_RANDOM, 1);
  assert.throws(() => generateUltimateRandomPuzzle(countries, { maxAttempts: 30 }));
});

function syntheticTaggedCountries() {
  /** @type {Country[]} */
  const out = [];
  let codeCounter = 0;
  for (const cont of CONTINENTS_FOR_RANDOM) {
    for (const color of COLORS_FOR_RANDOM) {
      for (let n = 0; n < 3; n++) {
        out.push(country({
          code: `c${codeCounter++}`,
          name: `${cont}-${color}-${n}`,
          continent: cont,
          colors: [color],
          motifs: [...MOTIFS_FOR_RANDOM],
        }));
      }
    }
  }
  return out;
}

test('generateRandomPuzzle returns a puzzle where every cell has at least 2 valid countries', () => {
  const countries = syntheticTaggedCountries();
  const puzzle = generateRandomPuzzle(countries, {
    rng: sequenceRng([0.1, 0.5, 0.9, 0.2, 0.7, 0.3, 0.4, 0.6, 0.8]),
  });
  const counts = puzzleCellCounts(puzzle, countries);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      assert.ok(counts[r][c] >= 2, `cell [${r}][${c}] has ${counts[r][c]} (< 2)`);
    }
  }
});

test('generateRandomPuzzle throws when no valid puzzle can be found within maxAttempts', () => {
  assert.throws(
    () => generateRandomPuzzle([], { maxAttempts: 5 }),
    /Could not generate a random puzzle/,
  );
});

test('generateRandomPuzzle is deterministic given a deterministic RNG and the same countries', () => {
  const countries = syntheticTaggedCountries();
  const p1 = generateRandomPuzzle(countries, { rng: mulberry32(42) });
  const p2 = generateRandomPuzzle(countries, { rng: mulberry32(42) });
  assert.deepEqual(p1.rows.map((r) => r.id), p2.rows.map((r) => r.id));
  assert.deepEqual(p1.cols.map((c) => c.id), p2.cols.map((c) => c.id));
});

test('generateRandomPuzzle never produces a puzzle where an exclusiveGroup is split across axes', () => {
  const countries = syntheticTaggedCountries();
  for (let s = 1; s <= 10; s++) {
    const puzzle = generateRandomPuzzle(countries, { rng: mulberry32(s) });
    assert.equal(
      axesConflict(puzzle.rows, puzzle.cols),
      false,
      `seed ${s}: produced a puzzle with split exclusive groups — rows=[${puzzle.rows.map((r) => r.id).join(',')}] cols=[${puzzle.cols.map((c) => c.id).join(',')}]`,
    );
  }
});

test('solutionState.complete is false when one cell is invalid even if all are filled and distinct', () => {
  const PS = country({ code: 'ps', name: 'Palestine', continent: 'Asia', statehood: 'un_observer' });
  const AF_OBS = country({ code: 'aob', name: 'AfricaObs', continent: 'Africa', statehood: 'un_observer' });
  const AF_TER = country({ code: 'ater', name: 'AfricaTer', continent: 'Africa', statehood: 'territory' });

  const solution = [
    [FR, VA, GL],
    [JP, PS, HK],
    [KE, AF_OBS, FR],
  ];
  const state = solutionState(PUZZLE, solution);
  assert.equal(state.complete, false);
  assert.equal(state.cells[2][2].valid, false);
});

test('computeGridScore returns 100 for a clean 9/9 solve with no mistakes', () => {
  assert.equal(computeGridScore({ filledCount: 9, wrongCount: 0 }), 100);
});

test('computeGridScore deducts 3 points per wrong pick when fully solved', () => {
  assert.equal(computeGridScore({ filledCount: 9, wrongCount: 1 }), 97);
  assert.equal(computeGridScore({ filledCount: 9, wrongCount: 3 }), 91);
  assert.equal(computeGridScore({ filledCount: 9, wrongCount: 10 }), 70);
});

test('computeGridScore deducts 10 points per empty cell — heavier than a wrong', () => {
  assert.equal(computeGridScore({ filledCount: 8, wrongCount: 0 }), 90);
  assert.equal(computeGridScore({ filledCount: 5, wrongCount: 0 }), 60);
  assert.equal(computeGridScore({ filledCount: 1, wrongCount: 0 }), 20);
});

test('computeGridScore returns 0 for an untouched board (give-up with nothing filled)', () => {
  assert.equal(computeGridScore({ filledCount: 0, wrongCount: 0 }), 0);
  assert.equal(computeGridScore({ filledCount: 0, wrongCount: 1 }), 0);
  assert.equal(computeGridScore({ filledCount: 0, wrongCount: 20 }), 0);
});

test('computeGridScore combines wrong and empty penalties for partial give-ups', () => {
  assert.equal(computeGridScore({ filledCount: 5, wrongCount: 2 }), 54);
  assert.equal(computeGridScore({ filledCount: 2, wrongCount: 5 }), 15);
});

test('computeGridScore clamps to 0 for absurd wrong counts', () => {
  assert.equal(computeGridScore({ filledCount: 9, wrongCount: 999 }), 0);
  assert.equal(computeGridScore({ filledCount: 0, wrongCount: 999 }), 0);
});

/**
 * @param {{ throwOnSet?: boolean }} [opts]
 * @returns {{
 *   getItem(key: string): string | null,
 *   setItem(key: string, value: string): void,
 *   _data: Map<string, string>,
 * }}
 */
function fakeStore({ throwOnSet = false } = {}) {
  /** @type {Map<string, string>} */
  const data = new Map();
  return {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => {
      if (throwOnSet) throw new Error('quota exceeded');
      data.set(k, v);
    },
    _data: data,
  };
}

test('loadGridState returns null when the key is missing', () => {
  assert.equal(loadGridState(fakeStore(), 'missing'), null);
});

test('loadGridState returns null when the stored value is unparseable', () => {
  const store = fakeStore();
  store.setItem('k', '{not json');
  assert.equal(loadGridState(store, 'k'), null);
});

test('loadGridState rejects a parsed value whose shape is wrong', () => {
  const store = fakeStore();
  store.setItem('k', JSON.stringify({ picks: ['fr'], wrongCount: 0, gaveUp: false }));
  assert.equal(loadGridState(store, 'k'), null);
  store.setItem('k', JSON.stringify({
    picks: Array(9).fill(null), wrongCount: '0', gaveUp: false,
  }));
  assert.equal(loadGridState(store, 'k'), null);
});

test('loadGridState round-trips a well-formed state', () => {
  const store = fakeStore();
  const state = {
    picks: ['fr', null, 'de', null, null, 'jp', null, 'in', null],
    wrongCount: 2,
    gaveUp: false,
    revealedCodes: Array(9).fill(null),
  };
  saveGridState(store, 'flaggrid.state.1', state);
  assert.deepEqual(loadGridState(store, 'flaggrid.state.1'), state);
});

test('loadGridState defaults revealedCodes to 9 nulls when missing (back-compat)', () => {
  const store = fakeStore();
  store.setItem('k', JSON.stringify({
    picks: Array(9).fill(null),
    wrongCount: 0,
    gaveUp: false,
  }));
  const out = loadGridState(store, 'k');
  assert.deepEqual(out?.revealedCodes, Array(9).fill(null));
});

test('loadGridState ignores legacy timer fields (finalTimeMs / startedAtMs) from older saves', () => {
  // The 3x3 used to track elapsed time and persisted finalTimeMs +
  // startedAtMs alongside the picks. The new save shape drops both.
  // Older entries still in localStorage should hydrate cleanly,
  // dropping the timer fields rather than failing the load.
  const store = fakeStore();
  store.setItem('k', JSON.stringify({
    picks: Array(9).fill(null),
    wrongCount: 0,
    gaveUp: false,
    finalTimeMs: 45000,
    revealedCodes: Array(9).fill(null),
    startedAtMs: 1717000000000,
  }));
  const out = loadGridState(store, 'k');
  assert.deepEqual(out, {
    picks: Array(9).fill(null),
    wrongCount: 0,
    gaveUp: false,
    revealedCodes: Array(9).fill(null),
  });
});

test('loadGridState round-trips a give-up state', () => {
  const store = fakeStore();
  const state = {
    picks: ['fr', 'de', null, null, null, 'jp', null, 'in', null],
    wrongCount: 1,
    gaveUp: true,
    revealedCodes: [null, null, 'us', 'cn', 'br', null, 'eg', null, 'au'],
  };
  saveGridState(store, 'k', state);
  assert.deepEqual(loadGridState(store, 'k'), state);
});

test('loadGridState normalises non-string picks to null', () => {
  const store = fakeStore();
  const raw = {
    picks: ['fr', 42, null, { code: 'de' }, undefined, 'jp', null, 'in', null],
    wrongCount: 0,
    gaveUp: false,
  };
  store.setItem('k', JSON.stringify(raw));
  const out = loadGridState(store, 'k');
  assert.deepEqual(out?.picks, ['fr', null, null, null, null, 'jp', null, 'in', null]);
});

test('saveGridState writes a parseable serialised state to the store', () => {
  const store = fakeStore();
  const state = {
    picks: Array(9).fill(null),
    wrongCount: 0,
    gaveUp: false,
    revealedCodes: Array(9).fill(null),
  };
  saveGridState(store, 'k', state);
  const raw = store._data.get('k');
  assert.ok(raw);
  assert.deepEqual(JSON.parse(raw), state);
});

test('saveGridState swallows a Storage quota error (no throw)', () => {
  const store = fakeStore({ throwOnSet: true });
  assert.doesNotThrow(() => saveGridState(store, 'k', {
    picks: Array(9).fill(null), wrongCount: 0, gaveUp: false, revealedCodes: Array(9).fill(null),
  }));
});

test('isGridLocked is false on an empty mid-round board', () => {
  assert.equal(
    isGridLocked({ gaveUp: false, picks: Array(9).fill(null) }),
    false,
  );
});

test('isGridLocked is false on a partially-filled board', () => {
  assert.equal(
    isGridLocked({
      gaveUp: false,
      picks: ['fr', null, 'de', null, null, 'jp', null, 'in', null],
    }),
    false,
  );
});

test('isGridLocked is true once the player gave up (even with cells still empty)', () => {
  assert.equal(
    isGridLocked({ gaveUp: true, picks: Array(9).fill(null) }),
    true,
  );
});

test('isGridLocked is true when every cell is filled — the picker commits only valid picks, so this is by construction a solved board', () => {
  assert.equal(
    isGridLocked({
      gaveUp: false,
      picks: ['fr', 'de', 'es', 'jp', 'cn', 'in', 'br', 'ar', 'pe'],
    }),
    true,
  );
});

test('cellRenderClasses sets filled=false for an empty cell', () => {
  assert.deepEqual(cellRenderClasses(null), [['filled', false], ['revealed', false]]);
  assert.deepEqual(cellRenderClasses(undefined), [['filled', false], ['revealed', false]]);
});

test('cellRenderClasses sets filled=true for any country', () => {
  assert.deepEqual(cellRenderClasses(FR), [['filled', true], ['revealed', false]]);
});

function fakeCell() {
  /** @type {Set<string>} */
  const classes = new Set();
  /** @type {Map<string, Array<{ handler: () => void, once: boolean }>>} */
  const listeners = new Map();
  return {
    classList: {
      /** @param {string} c */
      add: (c) => classes.add(c),
      /** @param {string} c */
      remove: (c) => classes.delete(c),
      /** @param {string} c */
      contains: (c) => classes.has(c),
    },
    /**
     * @param {string} type
     * @param {() => void} handler
     * @param {{ once?: boolean }} [options]
     */
    addEventListener(type, handler, options) {
      let arr = listeners.get(type);
      if (!arr) { arr = []; listeners.set(type, arr); }
      arr.push({ handler, once: !!options?.once });
    },
    /** @param {string} type */
    fire(type) {
      const all = listeners.get(type) ?? [];
      /** @type {Array<{ handler: () => void, once: boolean }>} */
      const survivors = [];
      listeners.set(type, survivors);
      for (const entry of all) {
        entry.handler();
        if (!entry.once) survivors.push(entry);
      }
    },
  };
}

test('pulseShake adds the .shake class to the cell', () => {
  const cell = fakeCell();
  pulseShake(cell);
  assert.equal(cell.classList.contains('shake'), true);
});

test('pulseShake removes .shake when the cell fires animationend', () => {
  const cell = fakeCell();
  pulseShake(cell);
  cell.fire('animationend');
  assert.equal(cell.classList.contains('shake'), false);
});

test('pulseShake wires a one-shot listener — a later stray animationend leaves a freshly-added .shake alone', () => {
  const cell = fakeCell();
  pulseShake(cell);
  cell.fire('animationend');
  cell.classList.add('shake');
  cell.fire('animationend');
  assert.equal(cell.classList.contains('shake'), true);
});

test('cellRenderClasses does not list any interaction-transient classes', () => {
  const TRANSIENT = ['shake'];
  for (const country of [null, FR]) {
    const managed = cellRenderClasses(country).map(([klass]) => klass);
    for (const t of TRANSIENT) {
      assert.ok(!managed.includes(t), `cellRenderClasses must not manage transient class ".${t}"`);
    }
  }
});

test('cellRenderClasses flags revealed cells', () => {
  assert.deepEqual(cellRenderClasses(FR, { revealed: true }), [['filled', true], ['revealed', true]]);
  assert.deepEqual(cellRenderClasses(FR), [['filled', true], ['revealed', false]]);
  assert.deepEqual(cellRenderClasses(null, { revealed: true }), [['filled', false], ['revealed', true]]);
});

test('fillEmptyCellsForGiveUp picks a valid country for each empty cell, skips user picks', () => {
  const empty = /** @type {(import('./grid.js').Country | null)[][]} */ ([[null, null, null], [null, null, null], [null, null, null]]);
  const pool = [FR, DE, VA, GL, JP, HK, KE];
  const result = fillEmptyCellsForGiveUp(PUZZLE, empty, pool, () => 0);
  // Indices the test pool can fill: (0,0) Europe/UN, (0,1) Europe/Observer, (0,2) Europe/Territory,
  // (1,0) Asia/UN, (1,2) Asia/Territory, (2,0) Africa/UN. The other three have no candidate.
  assert.ok(result[0] === 'fr' || result[0] === 'de');
  assert.equal(result[1], 'va');
  assert.equal(result[2], 'gl');
  assert.equal(result[3], 'jp');
  assert.equal(result[4], null);
  assert.equal(result[5], 'hk');
  assert.equal(result[6], 'ke');
  assert.equal(result[7], null);
  assert.equal(result[8], null);
});

test('fillEmptyCellsForGiveUp leaves user-picked cells as null in the result', () => {
  const solution = /** @type {(import('./grid.js').Country | null)[][]} */ ([[FR, null, null], [null, null, null], [null, null, null]]);
  const result = fillEmptyCellsForGiveUp(PUZZLE, solution, [FR, DE, VA, GL, JP, HK, KE], () => 0);
  assert.equal(result[0], null, '(0,0) is already user-picked');
  assert.equal(result[1], 'va');
});

test('fillEmptyCellsForGiveUp does not duplicate a country already used in the grid', () => {
  // FR at (0,0). Reveal of (1,0) Asia/UN should NOT be FR (different cell, but exclusion guards the rule anyway).
  // More meaningfully: if pool had only FR for both cells, (1,0) should be null.
  const onlyFr = /** @type {import('./grid.js').Country[]} */ ([FR]);
  const puzzle = /** @type {import('./grid.js').Puzzle} */ ({
    rows: [EUROPE, EUROPE, EUROPE],
    cols: [UN, UN, UN],
  });
  const solution = /** @type {(import('./grid.js').Country | null)[][]} */ ([[FR, null, null], [null, null, null], [null, null, null]]);
  const result = fillEmptyCellsForGiveUp(puzzle, solution, onlyFr, () => 0);
  for (let i = 1; i < 9; i++) {
    assert.equal(result[i], null, `index ${i} cannot reuse FR`);
  }
});

test('gridBestKey namespaces by slug', () => {
  assert.equal(gridBestKey('1'), 'flaggrid.best.1');
  assert.equal(gridBestKey('archive-42'), 'flaggrid.best.archive-42');
});

test('recordGridResult on an empty store saves and reports isNew', () => {
  const store = fakeStore();
  const current = { score: 75, time: 90000 };
  const r = recordGridResult(store, '1', current);
  assert.deepEqual(r, { best: current, isNew: true });
  assert.equal(store.getItem(gridBestKey('1')), JSON.stringify(current));
});

test('recordGridResult prefers a higher score, then a faster time', () => {
  const store = fakeStore();
  recordGridResult(store, '1', { score: 80, time: 30000 });
  const tieOnScoreFaster = recordGridResult(store, '1', { score: 80, time: 20000 });
  assert.deepEqual(tieOnScoreFaster, { best: { score: 80, time: 20000 }, isNew: true });
  const lowerScoreFaster = recordGridResult(store, '1', { score: 70, time: 5000 });
  assert.deepEqual(lowerScoreFaster, { best: { score: 80, time: 20000 }, isNew: false });
});

test('recordGridResult slots are keyed per slug', () => {
  const store = fakeStore();
  recordGridResult(store, '1', { score: 100, time: 60000 });
  recordGridResult(store, '2', { score: 50, time: 30000 });
  assert.equal(store.getItem(gridBestKey('1')), JSON.stringify({ score: 100, time: 60000 }));
  assert.equal(store.getItem(gridBestKey('2')), JSON.stringify({ score: 50, time: 30000 }));
});
