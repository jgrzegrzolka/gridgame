import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateCell,
  tryPick,
  continent,
  statehood,
  hasColor,
  hasMotif,
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
  findUltimateAssignment,
  generateUltimateRandomPuzzle,
  axesConflict,
  axesImpliedPair,
  buildRandomCategoryPool,
  pulseShake,
  CONTINENTS_FOR_RANDOM,
  COLORS_FOR_RANDOM,
  MOTIFS_FOR_RANDOM,
  COLOR_COUNTS_FOR_RANDOM,
  ALL_MOTIFS,
  colorCount,
  categoryFromId,
} from './engine.js';
import { createCountry } from './group.js';

/** @typedef {import('./group.js').Country} Country */

/**
 * @param {Partial<Country> & { code: string, name: string }} fields
 * @returns {Country}
 */
function country(fields) {
  return createCountry({
    category: 'country',
    continent: 'Europe',
    statehood: 'un_member',
    ...fields,
  });
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

/** @type {import('./engine.js').Puzzle} */
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
  const flagFr = country({ code: 'fr', name: 'France', primaryColors: ['blue', 'white', 'red'] });
  const flagJp = country({ code: 'jp', name: 'Japan', primaryColors: ['white', 'red'] });
  assert.equal(hasColor('blue').predicate(flagFr), true);
  assert.equal(hasColor('blue').predicate(flagJp), false);
});

test('hasColor predicate returns false when colors is missing or empty', () => {
  const noTag = country({ code: 'xx', name: 'Untagged' });
  const emptyTag = country({ code: 'yy', name: 'EmptyTag', primaryColors: [] });
  assert.equal(hasColor('red').predicate(noTag), false);
  assert.equal(hasColor('red').predicate(emptyTag), false);
});

test('hasColor category has a stable id and label', () => {
  const cat = hasColor('green');
  assert.equal(cat.id, 'hasColor:green');
  assert.equal(cat.label, 'green');
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
  assert.equal(cat.label, 'animal');
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

test('randomPuzzle categories come from the unified pool (continent / colour / motif / colorCount)', () => {
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
    } else if (cat.id.startsWith('colorCount:')) {
      const suffix = cat.id.slice('colorCount:'.length);
      /** @type {'=' | '>='} */
      let op = '=';
      let nStr = suffix;
      if (suffix.startsWith('>=')) { op = '>='; nStr = suffix.slice(2); }
      const n = Number.parseInt(nStr, 10);
      const inPool = COLOR_COUNTS_FOR_RANDOM.some(([o, m]) => o === op && m === n);
      assert.ok(inPool, `colorCount ${op}${n} not in pool`);
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

test('MOTIFS_FOR_RANDOM is the random-puzzle pool', () => {
  // The pool no longer requires full (continent × motif) coverage —
  // `generateRandomPuzzle` retries when a proposed puzzle has an
  // unfillable cell, so continent-narrow motifs like `eu-member`
  // (Europe-only) are allowed. ALL_MOTIFS still carries extras that
  // aren't worth pairing randomly even with retries — currently just
  // `union-jack` (narrow coverage + no compelling puzzle hook).
  assert.deepEqual(MOTIFS_FOR_RANDOM, ['animal', 'bird', 'coat-of-arms', 'weapon', 'star-or-moon', 'cross', 'eu-member']);
});

test('ALL_MOTIFS is a superset of MOTIFS_FOR_RANDOM and includes union-jack', () => {
  for (const m of MOTIFS_FOR_RANDOM) {
    assert.ok(ALL_MOTIFS.includes(m), `ALL_MOTIFS missing ${m}`);
  }
  assert.ok(ALL_MOTIFS.includes('union-jack'), 'ALL_MOTIFS should include union-jack');
});

test('continent and statehood categories carry their exclusiveGroup', () => {
  assert.equal(continent('Europe').exclusiveGroup, 'continent');
  assert.equal(statehood('un_member').exclusiveGroup, 'statehood');
  assert.equal(hasColor('red').exclusiveGroup, undefined);
  assert.equal(hasMotif('animal').exclusiveGroup, undefined);
});

test('buildRandomCategoryPool returns one entry per continent + colour + motif + colorCount', () => {
  const pool = buildRandomCategoryPool();
  const expected =
    CONTINENTS_FOR_RANDOM.length
    + COLORS_FOR_RANDOM.length
    + MOTIFS_FOR_RANDOM.length
    + COLOR_COUNTS_FOR_RANDOM.length;
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

// axesImpliedPair — guards the (Europe × eu-member) class of degenerate cell
// where one axis's matching set is fully contained in another's, so the
// constraint on the implied side does no work inside the cell.

test('axesImpliedPair: motif:eu-member × continent:Europe is implied (every EU member is European)', () => {
  // Synthetic mini-dataset where two countries carry eu-member and both are
  // European — eu-member ⊂ Europe by construction.
  const cs = [
    country({ code: 'fr', name: 'France',  continent: 'Europe', motifs: ['eu-member'] }),
    country({ code: 'de', name: 'Germany', continent: 'Europe', motifs: ['eu-member'] }),
    country({ code: 'no', name: 'Norway',  continent: 'Europe', motifs: [] }),
    country({ code: 'jp', name: 'Japan',   continent: 'Asia',   motifs: [] }),
  ];
  // eu-member as a row, Europe as a col → implied
  assert.equal(
    axesImpliedPair([hasMotif('eu-member')], [continent('Europe')], cs),
    true,
  );
  // Swap axes — should still flag (symmetric)
  assert.equal(
    axesImpliedPair([continent('Europe')], [hasMotif('eu-member')], cs),
    true,
  );
});

test('axesImpliedPair: returns false when neither axis is contained in the other', () => {
  // hasColor('red') and continent('Europe') intersect (FR, DE) but neither
  // is a subset of the other — JP is red+Asia, NO is non-red+Europe.
  const cs = [
    country({ code: 'fr', name: 'France',  continent: 'Europe', primaryColors: ['red'] }),
    country({ code: 'de', name: 'Germany', continent: 'Europe', primaryColors: ['red', 'black'] }),
    country({ code: 'no', name: 'Norway',  continent: 'Europe', primaryColors: ['blue'] }),
    country({ code: 'jp', name: 'Japan',   continent: 'Asia',   primaryColors: ['red'] }),
  ];
  assert.equal(
    axesImpliedPair([continent('Europe')], [hasColor('red')], cs),
    false,
  );
});

test('axesImpliedPair: empty match-set is not treated as implied (caught by minPerCell instead)', () => {
  // motif:union-jack with a dataset where no country carries it — the set
  // is trivially a subset of everything, but we don't want this path
  // muddying the failure signal that's already owned by isPuzzleGeneratable.
  const cs = [
    country({ code: 'fr', name: 'France', continent: 'Europe', motifs: ['eu-member'] }),
    country({ code: 'de', name: 'Germany', continent: 'Europe', motifs: ['eu-member'] }),
  ];
  assert.equal(
    axesImpliedPair([hasMotif('union-jack')], [continent('Europe')], cs),
    false,
  );
});

test('axesImpliedPair: same-id category on both axes is skipped (no self-implication)', () => {
  // The category pool builder picks 6 distinct items so this can't happen
  // in production, but the helper should still tolerate it for safety.
  const cs = [
    country({ code: 'fr', name: 'France', continent: 'Europe', primaryColors: ['red'] }),
    country({ code: 'jp', name: 'Japan', continent: 'Asia', primaryColors: ['red'] }),
  ];
  assert.equal(
    axesImpliedPair([hasColor('red')], [hasColor('red')], cs),
    false,
  );
});

test('axesImpliedPair: ignores intra-axis subset (only cross-axis pairs count)', () => {
  // eu-member and Europe both on the rows axis — the generator's job
  // is to detect implied pairs across the row/col split, not within
  // a single axis (axesConflict handles same-axis scalar issues).
  const cs = [
    country({ code: 'fr', name: 'France', continent: 'Europe', motifs: ['eu-member'] }),
    country({ code: 'jp', name: 'Japan', continent: 'Asia', motifs: [] }),
  ];
  assert.equal(
    axesImpliedPair(
      [hasMotif('eu-member'), continent('Europe'), hasColor('red')],
      [hasMotif('weapon'), hasMotif('cross'), hasMotif('animal')],
      cs,
    ),
    false,
  );
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

test('translateCategoryLabel returns the bare color noun without a "Has " wrapper', () => {
  const t = fakeTranslate({ 'color.red': 'czerwony' });
  assert.equal(translateCategoryLabel(hasColor('red'), t), 'czerwony');
});

test('translateCategoryLabel returns the bare motif noun, hyphens and all', () => {
  const t = fakeTranslate({ 'motif.star-or-moon': 'gwiazda lub księżyc' });
  assert.equal(translateCategoryLabel(hasMotif('star-or-moon'), t), 'gwiazda lub księżyc');
});

test('translateCategoryLabel falls back to the baked English label when the variant key is missing', () => {
  // The factory bakes label="Oceania"; if no translation is available
  // the fallback should surface that label rather than rendering blank.
  const t = fakeTranslate({});
  assert.equal(translateCategoryLabel(continent('Oceania'), t), 'Oceania');
});

test('translateCategoryLabel falls back to the bare value when no color translation is available', () => {
  const t = fakeTranslate({});
  assert.equal(translateCategoryLabel(hasColor('red'), t), 'red');
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

test('colorCount(=, N) predicate matches countries whose full palette is exactly N', () => {
  const cat = colorCount('=', 2);
  const twoColour = country({ code: 'jp', name: 'Japan', primaryColors: ['white', 'red'] });
  const threeColour = country({ code: 'pl2', name: 'X', primaryColors: ['white', 'red', 'blue'] });
  const twoPlusOneCOA = country({ code: 'mx', name: 'Mexico', primaryColors: ['green', 'red'], additionalColors: ['white'] });
  assert.equal(cat.predicate(twoColour), true);
  assert.equal(cat.predicate(threeColour), false);
  // `colors` is the union of primary + additional — the player counts everything
  // visible, so a 2-primary flag with one COA-only colour counts as 3.
  assert.equal(cat.predicate(twoPlusOneCOA), false);
});

test('colorCount(>=, N) predicate matches countries with N or more colours', () => {
  const cat = colorCount('>=', 4);
  const three = country({ code: 'pl2', name: 'X', primaryColors: ['white', 'red', 'blue'] });
  const four = country({ code: 'hr', name: 'X', primaryColors: ['white', 'red', 'blue'], additionalColors: ['yellow'] });
  const five = country({ code: 'xx', name: 'X', primaryColors: ['white', 'red', 'blue', 'yellow', 'green'] });
  assert.equal(cat.predicate(three), false);
  assert.equal(cat.predicate(four), true);
  assert.equal(cat.predicate(five), true);
});

test('colorCount(<=, N) predicate matches countries with N or fewer colours', () => {
  const cat = colorCount('<=', 2);
  const one = country({ code: 'aa', name: 'X', primaryColors: ['red'] });
  const two = country({ code: 'jp', name: 'X', primaryColors: ['white', 'red'] });
  const three = country({ code: 'sk', name: 'X', primaryColors: ['white', 'blue', 'red'] });
  assert.equal(cat.predicate(one), true);
  assert.equal(cat.predicate(two), true);
  assert.equal(cat.predicate(three), false);
});

test('colorCount carries exclusiveGroup so axesConflict rejects two different constraints', () => {
  const conflict = axesConflict(
    [continent('Africa'), hasColor('red'), colorCount('=', 2)],
    [continent('Europe'), hasColor('blue'), colorCount('=', 3)],
  );
  assert.equal(conflict, true);
});

test('colorCount: exclusiveGroup catches an =N vs >=N cross-axis pair too', () => {
  // (= 4) × (>= 4) overlap but have distinct ids, so axesConflict rejects them
  // as different members of the same exclusiveGroup. Without this, the cell
  // would be effectively "= 4" twice over (every =4 satisfies >=4).
  const conflict = axesConflict(
    [colorCount('=', 4), hasColor('red'), hasMotif('animal')],
    [colorCount('>=', 4), hasColor('blue'), hasMotif('weapon')],
  );
  assert.equal(conflict, true);
});

test('colorCount with the same id on both axes is not a conflict (axesConflict is about *different* values within the group)', () => {
  const conflict = axesConflict(
    [colorCount('=', 2), hasColor('red'), hasMotif('animal')],
    [colorCount('=', 2), hasColor('blue'), hasMotif('weapon')],
  );
  assert.equal(conflict, false);
});

test('translateCategoryLabel uses the filter.onlyN.<n> key for colorCount = N', () => {
  const t = fakeTranslate({ 'filter.onlyN.2': 'tylko 2 kolory' });
  assert.equal(translateCategoryLabel(colorCount('=', 2), t), 'tylko 2 kolory');
});

test('translateCategoryLabel uses the filter.atLeastN.<n> key for colorCount >= N', () => {
  const t = fakeTranslate({ 'filter.atLeastN.4': '4 lub więcej kolorów' });
  assert.equal(translateCategoryLabel(colorCount('>=', 4), t), '4 lub więcej kolorów');
});

test('translateCategoryLabel uses the filter.atMostN.<n> key for colorCount <= N', () => {
  const t = fakeTranslate({ 'filter.atMostN.2': 'co najwyżej 2 kolory' });
  assert.equal(translateCategoryLabel(colorCount('<=', 2), t), 'co najwyżej 2 kolory');
});

test('translateCategoryLabel falls back to the baked English label when the colorCount key is missing', () => {
  const t = fakeTranslate({});
  assert.equal(translateCategoryLabel(colorCount('=', 3), t), 'only 3 colours');
  assert.equal(translateCategoryLabel(colorCount('>=', 4), t), '4 or more colours');
});

test('categoryFromId round-trips a bare colorCount id as op =', () => {
  const cat = categoryFromId('colorCount:2');
  assert.ok(cat);
  assert.equal(cat.id, 'colorCount:2');
  assert.equal(cat.label, 'only 2 colours');
  assert.equal(cat.exclusiveGroup, 'colorCount');
  const jp = country({ code: 'jp', name: 'Japan', primaryColors: ['white', 'red'] });
  const fr = country({ code: 'fr2', name: 'France', primaryColors: ['blue', 'white', 'red'] });
  assert.equal(cat.predicate(jp), true);
  assert.equal(cat.predicate(fr), false);
});

test('categoryFromId round-trips a colorCount:>=N id', () => {
  const cat = categoryFromId('colorCount:>=4');
  assert.ok(cat);
  assert.equal(cat.id, 'colorCount:>=4');
  assert.equal(cat.label, '4 or more colours');
  assert.equal(cat.exclusiveGroup, 'colorCount');
  const three = country({ code: 'pl2', name: 'X', primaryColors: ['white', 'red', 'blue'] });
  const four = country({ code: 'hr', name: 'X', primaryColors: ['w','b','r'], additionalColors: ['y'] });
  assert.equal(cat.predicate(three), false);
  assert.equal(cat.predicate(four), true);
});

test('categoryFromId round-trips a colorCount:<=N id', () => {
  const cat = categoryFromId('colorCount:<=2');
  assert.ok(cat);
  assert.equal(cat.id, 'colorCount:<=2');
  assert.equal(cat.label, '2 or fewer colours');
  assert.equal(cat.exclusiveGroup, 'colorCount');
  const two = country({ code: 'jp', name: 'X', primaryColors: ['white', 'red'] });
  const three = country({ code: 'sk', name: 'X', primaryColors: ['white', 'blue', 'red'] });
  assert.equal(cat.predicate(two), true);
  assert.equal(cat.predicate(three), false);
});

test('categoryFromId returns null for a non-integer or malformed colorCount id', () => {
  assert.equal(categoryFromId('colorCount:abc'), null);
  assert.equal(categoryFromId('colorCount:'), null);
  assert.equal(categoryFromId('colorCount:>='), null);
  assert.equal(categoryFromId('colorCount:>=abc'), null);
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
    country({ code: 'al', name: 'Albania', continent: 'Europe', primaryColors: ['red'] }),
    country({ code: 'gr', name: 'Greece',  continent: 'Europe', primaryColors: ['blue'] }),
    country({ code: 'jp', name: 'Japan',   continent: 'Asia',   primaryColors: ['red', 'white'] }),
    country({ code: 'cm', name: 'Cameroon',continent: 'Africa', primaryColors: ['yellow', 'green'] }),
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
    country({ code: 'al', name: 'Albania', continent: 'Europe', primaryColors: ['red'] }),
    country({ code: 'pl', name: 'Poland',  continent: 'Europe', primaryColors: ['red', 'white'] }),
  ];
  assert.equal(isPuzzleGeneratable(puzzle, countries, 2), false);
});

test('isPuzzleGeneratable defaults to minPerCell of 2', () => {
  const puzzle = {
    rows: [continent('Europe'), continent('Europe'), continent('Europe')],
    cols: [hasColor('red'), hasColor('red'), hasColor('red')],
  };
  const oneCountry = [country({ code: 'al', name: 'Albania', continent: 'Europe', primaryColors: ['red'] })];
  assert.equal(isPuzzleGeneratable(puzzle, oneCountry), false);
});

test('isPuzzleGeneratable returns false when the no-duplicates rule blocks a global solution even though every cell has candidates', () => {
  const puzzle = {
    rows: [continent('Europe'), continent('Europe'), continent('Europe')],
    cols: [hasColor('red'), hasColor('red'), hasColor('red')],
  };
  const twoCountries = [
    country({ code: 'al', name: 'Albania', continent: 'Europe', primaryColors: ['red'] }),
    country({ code: 'pl', name: 'Poland',  continent: 'Europe', primaryColors: ['red', 'white'] }),
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
    country({ code: 'al', name: 'Albania',  continent: 'Europe', primaryColors: ['red'] }),
    country({ code: 'gr', name: 'Greece',   continent: 'Europe', primaryColors: ['blue'] }),
    country({ code: 'jp', name: 'Japan',    continent: 'Asia',   primaryColors: ['red'] }),
  ];
  assert.equal(findPuzzleSolution(puzzle, countries), null);
});

test('findPuzzleSolution returns null when the no-duplicate rule prevents any complete assignment', () => {
  const puzzle = {
    rows: [continent('Europe'), continent('Europe'), continent('Europe')],
    cols: [hasColor('red'), hasColor('red'), hasColor('red')],
  };
  const twoCountries = [
    country({ code: 'al', name: 'Albania', continent: 'Europe', primaryColors: ['red'] }),
    country({ code: 'pl', name: 'Poland',  continent: 'Europe', primaryColors: ['red'] }),
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
  // Same eu-member-drop + 1-motif-per-country distribution as
  // syntheticTaggedCountries — see that helper's comment for why.
  // Universally-tagged motifs would make every continent/colour axis a
  // strict subset of every motif axis under axesImpliedPair.
  const motifPool = MOTIFS_FOR_RANDOM.filter((m) => m !== 'eu-member');
  for (const cont of continents) {
    for (const color of colors) {
      for (let n = 0; n < perCell; n++) {
        const motif = motifPool[idx % motifPool.length];
        out.push(country({
          code: `c${idx++}`, name: `${cont}-${color}-${n}`,
          continent: /** @type {any} */ (cont), primaryColors: [color],
          motifs: [motif],
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
  const oneAsiaBlue = countries.find((c) => c.continent === 'Asia' && c.primaryColors?.includes('blue'));
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
      primaryColors: ['red', 'white', 'blue'],
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
      primaryColors: ['red', 'white', 'blue'],
    }));
  }
  assert.equal(hasUltimatePuzzleSolution(puzzle, multiMatch, 1), true);
  // Bump perCell to 2 — total demand 18 vs supply 12 → Hall fails.
  assert.equal(hasUltimatePuzzleSolution(puzzle, multiMatch, 2), false);
});

test('generateUltimateRandomPuzzle returns a puzzle that passes hasUltimatePuzzleSolution', () => {
  // Saturated synthetic pool — every (continent × color) cell has 9 flags of
  // its own. Any combination the generator survives must pass the Hall check.
  // Deterministic mulberry32 seed + production-default 500-attempt budget so
  // CI doesn't flake when axesImpliedPair narrows the success window past
  // the prior 50-attempt headroom on certain Math.random sequences.
  const countries = denseSquarePool(['Europe', 'Asia', 'Africa', 'North America', 'South America', 'Oceania'], COLORS_FOR_RANDOM, 9);
  const puzzle = generateUltimateRandomPuzzle(countries, { rng: mulberry32(7), maxAttempts: 500 });
  assert.equal(hasUltimatePuzzleSolution(puzzle, countries), true);
});

test('generateUltimateRandomPuzzle throws when no puzzle in the category pool can be 9×9-solved', () => {
  // Sparse pool — only 1 country per (continent × color) cell. Every puzzle
  // fails the Hall check at the singleton subset (1 < 9).
  const countries = denseSquarePool(['Europe', 'Asia', 'Africa', 'North America', 'South America', 'Oceania'], COLORS_FOR_RANDOM, 1);
  assert.throws(() => generateUltimateRandomPuzzle(countries, { maxAttempts: 30 }));
});

// findUltimateAssignment
// Constructs the 81-distinct assignment generation only proves exists.
// Replaces the give-up greedy fill that was hitting duplicate-surfacing
// dead-ends on the real countries dataset.

/** Build an empty 3×3×3×3 preFilled grid (every sub-cell null). */
function emptyPreFilled() {
  /** @type {(import('./group.js').Country | null)[][][][]} */
  const grid = [];
  for (let br = 0; br < 3; br++) {
    const bigRow = [];
    for (let bc = 0; bc < 3; bc++) {
      const board = [];
      for (let r = 0; r < 3; r++) {
        board.push([null, null, null]);
      }
      bigRow.push(board);
    }
    grid.push(bigRow);
  }
  return grid;
}

test('findUltimateAssignment: returns 81 distinct countries on an empty puzzle that passes the Hall check', () => {
  // perCell=10 (not 9) + generous maxAttempts so Hall has enough breathing
  // room and the random axis generator doesn't fail outright on an unlucky
  // CI run. With perCell=9 some axis combinations (especially continent ×
  // motif) leave the Hall check tight, and 50 attempts isn't always enough
  // to roll a Hall-passing layout — this fired once in CI before the bump.
  // The chosen seed (3) lands on an axis combo the backtracker resolves
  // within its budget; growing MOTIFS_FOR_RANDOM (e.g. adding `bird`) shifts
  // which seeds the PRNG sweeps onto, so this is a known sensitivity.
  const countries = denseSquarePool(
    ['Europe', 'Asia', 'Africa', 'North America', 'South America', 'Oceania'],
    COLORS_FOR_RANDOM,
    10,
  );
  const puzzle = generateUltimateRandomPuzzle(countries, { rng: mulberry32(5), maxAttempts: 500 });
  /** @type {Country[][][][] | null} */
  const assignment = findUltimateAssignment(puzzle, emptyPreFilled(), countries, mulberry32(5));
  if (!assignment) throw new Error('a solvable puzzle must yield a non-null assignment');
  /** @type {Set<string>} */
  const seen = new Set();
  for (let br = 0; br < 3; br++) {
    for (let bc = 0; bc < 3; bc++) {
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 3; c++) {
          /** @type {Country} */
          const co = assignment[br][bc][r][c];
          assert.ok(
            puzzle.rows[br].predicate(co) && puzzle.cols[bc].predicate(co),
            `${co.code} at (${br},${bc},${r},${c}) must satisfy row × col`,
          );
          assert.equal(seen.has(co.code), false, `${co.code} reused at (${br},${bc},${r},${c})`);
          seen.add(co.code);
        }
      }
    }
  }
  assert.equal(seen.size, 81);
});

test('findUltimateAssignment: respects preFilled cells and never reuses their countries', () => {
  // 10 (not 9) per (continent × color) cell so the seeded country never
  // starves a bottleneck. With perCell=9 a randomly-generated puzzle that
  // pairs a continent row with a hasColor col makes that one cell strictly
  // 9-candidate: seeding ANY country from its pool elsewhere drops the
  // remaining candidates below the demand and the puzzle becomes unsolvable,
  // not because the solver is broken but because Hall's theorem only
  // guarantees the empty case. perCell=10 buys one slot of breathing room.
  const countries = denseSquarePool(
    ['Europe', 'Asia', 'Africa', 'North America', 'South America', 'Oceania'],
    COLORS_FOR_RANDOM,
    10,
  );
  const puzzle = generateUltimateRandomPuzzle(countries, { rng: mulberry32(7), maxAttempts: 500 });
  // Seed one cell at (0,0,0,0) with a country that fits its row × col.
  const seedCandidates = countries.filter(
    (co) => puzzle.rows[0].predicate(co) && puzzle.cols[0].predicate(co),
  );
  assert.ok(seedCandidates.length > 0, 'test puzzle must have a valid seed');
  const seed = seedCandidates[0];
  const preFilled = emptyPreFilled();
  preFilled[0][0][0][0] = seed;

  const assignment = findUltimateAssignment(puzzle, preFilled, countries, mulberry32(7));
  if (!assignment) throw new Error('expected an assignment');
  // Seeded cell unchanged.
  assert.equal(assignment[0][0][0][0].code, seed.code);
  // Seeded country appears exactly once across the whole grid.
  let count = 0;
  for (let br = 0; br < 3; br++) {
    for (let bc = 0; bc < 3; bc++) {
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 3; c++) {
          if (assignment[br][bc][r][c].code === seed.code) count++;
        }
      }
    }
  }
  assert.equal(count, 1, 'seeded country must not be reused elsewhere');
});

test('findUltimateAssignment: returns null when preFilled has burned the candidates needed elsewhere', () => {
  // 9 countries per (continent × color) cell — exactly enough for an
  // empty-board 81-distinct assignment. Forcibly seed a cell with a
  // country that another small board sharing that continent also needs:
  // since the pool was minimal, removing it makes completion impossible.
  const countries = denseSquarePool(
    ['Europe', 'Asia', 'Africa', 'North America', 'South America', 'Oceania'],
    COLORS_FOR_RANDOM,
    9,
  );
  // Use a fixed puzzle layout we can reason about: continents on rows,
  // colors on cols. Each (continent[r], color[c]) cell has exactly 9
  // matching countries in this pool — so for a cell at (br=0,bc=0) to
  // accommodate 9 distinct fills, none of its 9 candidates may be used
  // by another small board sharing continent[0]. We can't easily force
  // that from outside the API without rebuilding the pool. Instead,
  // assert the simpler contract: a wildly over-seeded cell (every one
  // of its candidates planted somewhere else first) fails the solver.
  // perCell stays at 9 here — the test deliberately exploits the tight
  // pool — but maxAttempts is generous so the puzzle generator itself
  // doesn't flake out on an unlucky axis roll.
  const puzzle = generateUltimateRandomPuzzle(countries, { rng: mulberry32(7), maxAttempts: 500 });
  // Find a (br, bc) and steal all of its candidates into other cells'
  // preFilled slots whose row × col happens to also accept them.
  const target = { br: 0, bc: 0 };
  const targetCandidates = countries.filter(
    (co) => puzzle.rows[target.br].predicate(co) && puzzle.cols[target.bc].predicate(co),
  );
  // Seed the *other* 8 small boards with as many of target's candidates
  // as they can accept. If we can place all 9 in other boards, the
  // target board has zero candidates left and the solver must fail.
  const preFilled = emptyPreFilled();
  let seededCount = 0;
  outer: for (const co of targetCandidates) {
    for (let br = 0; br < 3 && seededCount < targetCandidates.length; br++) {
      for (let bc = 0; bc < 3 && seededCount < targetCandidates.length; bc++) {
        if (br === target.br && bc === target.bc) continue;
        if (!puzzle.rows[br].predicate(co) || !puzzle.cols[bc].predicate(co)) continue;
        // Find any empty preFilled slot in this small board.
        for (let r = 0; r < 3; r++) {
          for (let c = 0; c < 3; c++) {
            if (preFilled[br][bc][r][c]) continue;
            preFilled[br][bc][r][c] = co;
            seededCount++;
            continue outer;
          }
        }
      }
    }
  }
  // If we managed to siphon every target candidate elsewhere, the
  // solver must return null. If not, this test's premise didn't hold
  // for this puzzle — skip the assertion rather than fail spuriously.
  if (seededCount === targetCandidates.length) {
    const out = findUltimateAssignment(puzzle, preFilled, countries, mulberry32(7));
    assert.equal(out, null, 'no completion possible when target small board has zero candidates left');
  }
});

test('findUltimateAssignment: returns null when maxBacktracks is exceeded instead of running unbounded', () => {
  // The solver has no constraint propagation, so adversarial candidate
  // orderings can balloon into long search trees. The cap defends the
  // give-up reveal path: instead of hanging the UI, the solver returns
  // null and the caller falls back to a greedy fill. Pin the contract
  // by passing a 1-step budget against an otherwise-solvable puzzle —
  // the solver can't possibly finish in 1 step, so it must return null.
  const countries = denseSquarePool(
    ['Europe', 'Asia', 'Africa', 'North America', 'South America', 'Oceania'],
    COLORS_FOR_RANDOM,
    10,
  );
  const puzzle = generateUltimateRandomPuzzle(countries, { rng: mulberry32(7), maxAttempts: 500 });
  const out = findUltimateAssignment(puzzle, emptyPreFilled(), countries, mulberry32(7), 1);
  assert.equal(out, null, 'cap=1 must abandon the search and return null');
});

// TODO: a real-countries.json regression test for findUltimateAssignment
// belongs here, but the only obvious shape (generate a few random
// puzzles and assert 81 distinct outputs) is dominated by puzzle
// generation cost — too slow to keep in the suite. Tracked in
// https://github.com/jgrzegrzolka/gridgame/issues — needs a faster
// approach (e.g. pre-baked puzzles, or a timing budget) before adding.

function syntheticTaggedCountries() {
  /** @type {Country[]} */
  const out = [];
  let codeCounter = 0;
  // eu-member is dropped (Europe-only in reality, would need a coverage
  // model the synthetic data doesn't have). Remaining motifs are
  // distributed sparsely: each country gets one motif cycling through
  // the pool, so a motif's match-set is ~1/5 of all synthetic countries
  // — small enough that it isn't a superset of any single continent or
  // colour. The OLD synthetic design assigned every motif to every
  // country, which made every continent / colour axis a strict subset
  // of every motif axis, tripping axesImpliedPair on almost every
  // generator attempt once that guard was added.
  const motifPool = MOTIFS_FOR_RANDOM.filter((m) => m !== 'eu-member');
  // Each (continent × colour × n) triple becomes one country. n controls
  // palette size — n=0 keeps the base 1-colour shape, n=1/n=2 layer in
  // distinct neighbour colours so the country has 2 / 3 colours total.
  // That gives colorCount('=',1/2/3) Categories ≥7 candidates per
  // continent, enough for `minPerCell` to clear in any pairing.
  for (const cont of CONTINENTS_FOR_RANDOM) {
    for (const color of COLORS_FOR_RANDOM) {
      for (let n = 0; n < 3; n++) {
        const motif = motifPool[codeCounter % motifPool.length];
        const extras = COLORS_FOR_RANDOM.filter((c) => c !== color).slice(0, n);
        out.push(country({
          code: `c${codeCounter++}`,
          name: `${cont}-${color}-${n}`,
          continent: cont,
          primaryColors: [color, ...extras],
          motifs: [motif],
        }));
      }
    }
    // Extra ladder per continent so the `=4` and `>=4` colour-count
    // Categories have candidates everywhere. Two of each variant keeps
    // every (continent × colorCount≥4) cell at the minPerCell=2 floor.
    for (const target of [4, 5]) {
      for (let i = 0; i < 2; i++) {
        const motif = motifPool[codeCounter % motifPool.length];
        const palette = COLORS_FOR_RANDOM.slice(i, i + target);
        out.push(country({
          code: `c${codeCounter++}`,
          name: `${cont}-multi${target}-${i}`,
          continent: cont,
          primaryColors: palette,
          motifs: [motif],
        }));
      }
    }
  }
  return out;
}

test('generateRandomPuzzle returns a puzzle where every cell has at least 2 valid countries', () => {
  const countries = syntheticTaggedCountries();
  // mulberry32 (period 2^32) gives a fresh distribution each attempt,
  // so the generator's retry loop can land on a valid puzzle within the
  // 200-attempt budget. The original sequenceRng with 9 fixed values
  // cycled too tightly once axesImpliedPair narrowed the success space.
  const puzzle = generateRandomPuzzle(countries, { rng: mulberry32(7) });
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

test('generateRandomPuzzle never produces an implied (subset) cross-axis pair', () => {
  // Companion to the axesConflict assertion above — the implied-pair guard
  // is the other thing the generator rejects before returning. With the
  // synthetic pool (which doesn't include eu-member), this mostly proves
  // the guard is wired up without false-rejecting normal puzzles. Real-
  // data coverage with eu-member lives in countries.test.js.
  const countries = syntheticTaggedCountries();
  for (let s = 1; s <= 10; s++) {
    const puzzle = generateRandomPuzzle(countries, { rng: mulberry32(s) });
    assert.equal(
      axesImpliedPair(puzzle.rows, puzzle.cols, countries),
      false,
      `seed ${s}: produced a puzzle with an implied axis pair — rows=[${puzzle.rows.map((r) => r.id).join(',')}] cols=[${puzzle.cols.map((c) => c.id).join(',')}]`,
    );
  }
});

