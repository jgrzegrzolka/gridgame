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
  metricGroupRepeated,
  SINGLE_USE_METRIC_GROUPS,
  axesImpliedPair,
  buildRandomCategoryPool,
  pulseShake,
  CONTINENTS_FOR_RANDOM,
  COLORS_FOR_RANDOM,
  MOTIFS_FOR_RANDOM,
  COLOR_COUNTS_FOR_RANDOM,
  STRIPES_ORIENTATIONS_FOR_RANDOM,
  POPULATION_BREAKS_FOR_RANDOM,
  AREA_BREAKS_FOR_RANDOM,
  DENSITY_BREAKS_FOR_RANDOM,
  GDP_BREAKS_FOR_RANDOM,
  GDP_PER_CAPITA_BREAKS_FOR_RANDOM,
  COFFEE_BREAKS_FOR_RANDOM,
  WINE_BREAKS_FOR_RANDOM,
  COCOA_BREAKS_FOR_RANDOM,
  BANANA_BREAKS_FOR_RANDOM,
  APPLE_BREAKS_FOR_RANDOM,
  OIL_BREAKS_FOR_RANDOM,
  RICE_BREAKS_FOR_RANDOM,
  COAL_BREAKS_FOR_RANDOM,
  SHEEP_PER_CAPITA_BREAKS_FOR_RANDOM,
  CATTLE_PER_CAPITA_BREAKS_FOR_RANDOM,
  BEER_PER_CAPITA_BREAKS_FOR_RANDOM,
  ALCOHOL_PER_CAPITA_BREAKS_FOR_RANDOM,
  MEAT_PER_CAPITA_BREAKS_FOR_RANDOM,
  BORDERS_BREAKS_FOR_RANDOM,
  TEA_BREAKS_FOR_RANDOM,
  SUGARCANE_BREAKS_FOR_RANDOM,
  GOLD_BREAKS_FOR_RANDOM,
  OLIVE_OIL_BREAKS_FOR_RANDOM,
  HONEY_BREAKS_FOR_RANDOM,
  ELEVATION_BREAKS_FOR_RANDOM,
  COASTLINE_BREAKS_FOR_RANDOM,
  FOREST_BREAKS_FOR_RANDOM,
  ALL_MOTIFS,
  colorCount,
  population,
  area,
  density,
  gdp,
  gdpPerCapita,
  coffee,
  elevation,
  categoryFromId,
  hasStripesOnly,
  buildUltimateCategoryPool,
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

test('randomPuzzle categories come from the unified pool (continent / colour / motif / colorCount / stripesOnly / population / area / density)', () => {
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
    } else if (cat.id.startsWith('stripesOnly:')) {
      const orientation = cat.id.slice('stripesOnly:'.length);
      assert.ok(STRIPES_ORIENTATIONS_FOR_RANDOM.includes(/** @type {any} */ (orientation)), `stripesOnly ${orientation} not in palette`);
    } else if (cat.id.startsWith('colorCount:')) {
      const suffix = cat.id.slice('colorCount:'.length);
      /** @type {'=' | '>='} */
      let op = '=';
      let nStr = suffix;
      if (suffix.startsWith('>=')) { op = '>='; nStr = suffix.slice(2); }
      const n = Number.parseInt(nStr, 10);
      const inPool = COLOR_COUNTS_FOR_RANDOM.some(([o, m]) => o === op && m === n);
      assert.ok(inPool, `colorCount ${op}${n} not in pool`);
    } else if (cat.id.startsWith('population:')) {
      const suffix = cat.id.slice('population:'.length);
      /** @type {'>=' | '<='} */
      const op = suffix.startsWith('>=') ? '>=' : '<=';
      const n = Number.parseInt(suffix.slice(2), 10);
      const inPool = POPULATION_BREAKS_FOR_RANDOM.some((b) => b.op === op && b.n === n);
      assert.ok(inPool, `population ${op}${n} not in pool`);
    } else if (cat.id.startsWith('area:')) {
      const suffix = cat.id.slice('area:'.length);
      /** @type {'>=' | '<='} */
      const op = suffix.startsWith('>=') ? '>=' : '<=';
      const n = Number.parseInt(suffix.slice(2), 10);
      const inPool = AREA_BREAKS_FOR_RANDOM.some((b) => b.op === op && b.n === n);
      assert.ok(inPool, `area ${op}${n} not in pool`);
    } else if (cat.id.startsWith('density:')) {
      const suffix = cat.id.slice('density:'.length);
      /** @type {'>=' | '<='} */
      const op = suffix.startsWith('>=') ? '>=' : '<=';
      const n = Number.parseInt(suffix.slice(2), 10);
      const inPool = DENSITY_BREAKS_FOR_RANDOM.some((b) => b.op === op && b.n === n);
      assert.ok(inPool, `density ${op}${n} not in pool`);
    } else if (cat.id.startsWith('gdpPerCapita:')) {
      const suffix = cat.id.slice('gdpPerCapita:'.length);
      /** @type {'>=' | '<='} */
      const op = suffix.startsWith('>=') ? '>=' : '<=';
      const n = Number.parseInt(suffix.slice(2), 10);
      const inPool = GDP_PER_CAPITA_BREAKS_FOR_RANDOM.some((b) => b.op === op && b.n === n);
      assert.ok(inPool, `gdpPerCapita ${op}${n} not in pool`);
    } else if (cat.id.startsWith('gdp:')) {
      const suffix = cat.id.slice('gdp:'.length);
      /** @type {'>=' | '<='} */
      const op = suffix.startsWith('>=') ? '>=' : '<=';
      const n = Number.parseInt(suffix.slice(2), 10);
      const inPool = GDP_BREAKS_FOR_RANDOM.some((b) => b.op === op && b.n === n);
      assert.ok(inPool, `gdp ${op}${n} not in pool`);
    } else if (cat.id.startsWith('coffee:')) {
      const suffix = cat.id.slice('coffee:'.length);
      /** @type {'>=' | '<='} */
      const op = suffix.startsWith('>=') ? '>=' : '<=';
      const n = Number.parseInt(suffix.slice(2), 10);
      const inPool = COFFEE_BREAKS_FOR_RANDOM.some((b) => b.op === op && b.n === n);
      assert.ok(inPool, `coffee ${op}${n} not in pool`);
    } else if (cat.id.startsWith('tea:')) {
      const suffix = cat.id.slice('tea:'.length);
      /** @type {'>=' | '<='} */
      const op = suffix.startsWith('>=') ? '>=' : '<=';
      const n = Number.parseInt(suffix.slice(2), 10);
      const inPool = TEA_BREAKS_FOR_RANDOM.some((b) => b.op === op && b.n === n);
      assert.ok(inPool, `tea ${op}${n} not in pool`);
    } else if (cat.id.startsWith('sugarcane:')) {
      const suffix = cat.id.slice('sugarcane:'.length);
      /** @type {'>=' | '<='} */
      const op = suffix.startsWith('>=') ? '>=' : '<=';
      const n = Number.parseInt(suffix.slice(2), 10);
      const inPool = SUGARCANE_BREAKS_FOR_RANDOM.some((b) => b.op === op && b.n === n);
      assert.ok(inPool, `sugarcane ${op}${n} not in pool`);
    } else if (cat.id.startsWith('gold:')) {
      const suffix = cat.id.slice('gold:'.length);
      /** @type {'>=' | '<='} */
      const op = suffix.startsWith('>=') ? '>=' : '<=';
      const n = Number.parseInt(suffix.slice(2), 10);
      const inPool = GOLD_BREAKS_FOR_RANDOM.some((b) => b.op === op && b.n === n);
      assert.ok(inPool, `gold ${op}${n} not in pool`);
    } else if (cat.id.startsWith('oliveOil:')) {
      const suffix = cat.id.slice('oliveOil:'.length);
      /** @type {'>=' | '<='} */
      const op = suffix.startsWith('>=') ? '>=' : '<=';
      const n = Number.parseInt(suffix.slice(2), 10);
      const inPool = OLIVE_OIL_BREAKS_FOR_RANDOM.some((b) => b.op === op && b.n === n);
      assert.ok(inPool, `oliveOil ${op}${n} not in pool`);
    } else if (cat.id.startsWith('honey:')) {
      const suffix = cat.id.slice('honey:'.length);
      /** @type {'>=' | '<='} */
      const op = suffix.startsWith('>=') ? '>=' : '<=';
      const n = Number.parseInt(suffix.slice(2), 10);
      const inPool = HONEY_BREAKS_FOR_RANDOM.some((b) => b.op === op && b.n === n);
      assert.ok(inPool, `honey ${op}${n} not in pool`);
    } else if (cat.id.startsWith('wine:')) {
      const suffix = cat.id.slice('wine:'.length);
      /** @type {'>=' | '<='} */
      const op = suffix.startsWith('>=') ? '>=' : '<=';
      const n = Number.parseInt(suffix.slice(2), 10);
      const inPool = WINE_BREAKS_FOR_RANDOM.some((b) => b.op === op && b.n === n);
      assert.ok(inPool, `wine ${op}${n} not in pool`);
    } else if (cat.id.startsWith('cocoa:')) {
      const suffix = cat.id.slice('cocoa:'.length);
      /** @type {'>=' | '<='} */
      const op = suffix.startsWith('>=') ? '>=' : '<=';
      const n = Number.parseInt(suffix.slice(2), 10);
      const inPool = COCOA_BREAKS_FOR_RANDOM.some((b) => b.op === op && b.n === n);
      assert.ok(inPool, `cocoa ${op}${n} not in pool`);
    } else if (cat.id.startsWith('banana:')) {
      const suffix = cat.id.slice('banana:'.length);
      /** @type {'>=' | '<='} */
      const op = suffix.startsWith('>=') ? '>=' : '<=';
      const n = Number.parseInt(suffix.slice(2), 10);
      const inPool = BANANA_BREAKS_FOR_RANDOM.some((b) => b.op === op && b.n === n);
      assert.ok(inPool, `banana ${op}${n} not in pool`);
    } else if (cat.id.startsWith('apple:')) {
      const suffix = cat.id.slice('apple:'.length);
      /** @type {'>=' | '<='} */
      const op = suffix.startsWith('>=') ? '>=' : '<=';
      const n = Number.parseInt(suffix.slice(2), 10);
      const inPool = APPLE_BREAKS_FOR_RANDOM.some((b) => b.op === op && b.n === n);
      assert.ok(inPool, `apple ${op}${n} not in pool`);
    } else if (cat.id.startsWith('elevation:')) {
      const suffix = cat.id.slice('elevation:'.length);
      /** @type {'>=' | '<='} */
      const op = suffix.startsWith('>=') ? '>=' : '<=';
      const n = Number.parseInt(suffix.slice(2), 10);
      const inPool = ELEVATION_BREAKS_FOR_RANDOM.some((b) => b.op === op && b.n === n);
      assert.ok(inPool, `elevation ${op}${n} not in pool`);
    } else if (cat.id.startsWith('coastline:')) {
      const suffix = cat.id.slice('coastline:'.length);
      /** @type {'>=' | '<='} */
      const op = suffix.startsWith('>=') ? '>=' : '<=';
      const n = Number.parseInt(suffix.slice(2), 10);
      const inPool = COASTLINE_BREAKS_FOR_RANDOM.some((b) => b.op === op && b.n === n);
      assert.ok(inPool, `coastline ${op}${n} not in pool`);
    } else if (cat.id.startsWith('forest:')) {
      const suffix = cat.id.slice('forest:'.length);
      /** @type {'>=' | '<='} */
      const op = suffix.startsWith('>=') ? '>=' : '<=';
      const n = Number.parseInt(suffix.slice(2), 10);
      const inPool = FOREST_BREAKS_FOR_RANDOM.some((b) => b.op === op && b.n === n);
      assert.ok(inPool, `forest ${op}${n} not in pool`);
    } else if (cat.id.startsWith('oil:')) {
      const suffix = cat.id.slice('oil:'.length);
      /** @type {'>=' | '<='} */
      const op = suffix.startsWith('>=') ? '>=' : '<=';
      const n = Number.parseInt(suffix.slice(2), 10);
      const inPool = OIL_BREAKS_FOR_RANDOM.some((b) => b.op === op && b.n === n);
      assert.ok(inPool, `oil ${op}${n} not in pool`);
    } else if (cat.id.startsWith('rice:')) {
      const suffix = cat.id.slice('rice:'.length);
      /** @type {'>=' | '<='} */
      const op = suffix.startsWith('>=') ? '>=' : '<=';
      const n = Number.parseInt(suffix.slice(2), 10);
      const inPool = RICE_BREAKS_FOR_RANDOM.some((b) => b.op === op && b.n === n);
      assert.ok(inPool, `rice ${op}${n} not in pool`);
    } else if (cat.id.startsWith('coal:')) {
      const suffix = cat.id.slice('coal:'.length);
      /** @type {'>=' | '<='} */
      const op = suffix.startsWith('>=') ? '>=' : '<=';
      const n = Number.parseInt(suffix.slice(2), 10);
      const inPool = COAL_BREAKS_FOR_RANDOM.some((b) => b.op === op && b.n === n);
      assert.ok(inPool, `coal ${op}${n} not in pool`);
    } else if (cat.id.startsWith('sheepPerCapita:')) {
      const suffix = cat.id.slice('sheepPerCapita:'.length);
      /** @type {'>=' | '<='} */
      const op = suffix.startsWith('>=') ? '>=' : '<=';
      const n = Number.parseInt(suffix.slice(2), 10);
      const inPool = SHEEP_PER_CAPITA_BREAKS_FOR_RANDOM.some((b) => b.op === op && b.n === n);
      assert.ok(inPool, `sheepPerCapita ${op}${n} not in pool`);
    } else if (cat.id.startsWith('cattlePerCapita:')) {
      const suffix = cat.id.slice('cattlePerCapita:'.length);
      /** @type {'>=' | '<='} */
      const op = suffix.startsWith('>=') ? '>=' : '<=';
      const n = Number.parseInt(suffix.slice(2), 10);
      const inPool = CATTLE_PER_CAPITA_BREAKS_FOR_RANDOM.some((b) => b.op === op && b.n === n);
      assert.ok(inPool, `cattlePerCapita ${op}${n} not in pool`);
    } else if (cat.id.startsWith('beerPerCapita:')) {
      const suffix = cat.id.slice('beerPerCapita:'.length);
      /** @type {'>=' | '<='} */
      const op = suffix.startsWith('>=') ? '>=' : '<=';
      const n = Number.parseInt(suffix.slice(2), 10);
      const inPool = BEER_PER_CAPITA_BREAKS_FOR_RANDOM.some((b) => b.op === op && b.n === n);
      assert.ok(inPool, `beerPerCapita ${op}${n} not in pool`);
    } else if (cat.id.startsWith('alcoholPerCapita:')) {
      const suffix = cat.id.slice('alcoholPerCapita:'.length);
      /** @type {'>=' | '<='} */
      const op = suffix.startsWith('>=') ? '>=' : '<=';
      const n = Number.parseInt(suffix.slice(2), 10);
      const inPool = ALCOHOL_PER_CAPITA_BREAKS_FOR_RANDOM.some((b) => b.op === op && b.n === n);
      assert.ok(inPool, `alcoholPerCapita ${op}${n} not in pool`);
    } else if (cat.id.startsWith('meatPerCapita:')) {
      const suffix = cat.id.slice('meatPerCapita:'.length);
      /** @type {'>=' | '<='} */
      const op = suffix.startsWith('>=') ? '>=' : '<=';
      const n = Number.parseInt(suffix.slice(2), 10);
      const inPool = MEAT_PER_CAPITA_BREAKS_FOR_RANDOM.some((b) => b.op === op && b.n === n);
      assert.ok(inPool, `meatPerCapita ${op}${n} not in pool`);
    } else if (cat.id.startsWith('borders:')) {
      const suffix = cat.id.slice('borders:'.length);
      /** @type {'>=' | '<='} */
      const op = suffix.startsWith('>=') ? '>=' : '<=';
      const n = Number.parseInt(suffix.slice(2), 10);
      const inPool = BORDERS_BREAKS_FOR_RANDOM.some((b) => b.op === op && b.n === n);
      assert.ok(inPool, `borders ${op}${n} not in pool`);
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

test('buildRandomCategoryPool returns one entry per continent + colour + motif + colorCount + stripesOnly + population + area + density + gdp + gdpPerCapita + coffee + wine + cocoa + elevation', () => {
  const pool = buildRandomCategoryPool();
  const expected =
    CONTINENTS_FOR_RANDOM.length
    + COLORS_FOR_RANDOM.length
    + MOTIFS_FOR_RANDOM.length
    + COLOR_COUNTS_FOR_RANDOM.length
    + STRIPES_ORIENTATIONS_FOR_RANDOM.length
    + POPULATION_BREAKS_FOR_RANDOM.length
    + AREA_BREAKS_FOR_RANDOM.length
    + DENSITY_BREAKS_FOR_RANDOM.length
    + GDP_BREAKS_FOR_RANDOM.length
    + GDP_PER_CAPITA_BREAKS_FOR_RANDOM.length
    + COFFEE_BREAKS_FOR_RANDOM.length
    + WINE_BREAKS_FOR_RANDOM.length
    + COCOA_BREAKS_FOR_RANDOM.length
    + BANANA_BREAKS_FOR_RANDOM.length
    + APPLE_BREAKS_FOR_RANDOM.length
    + ELEVATION_BREAKS_FOR_RANDOM.length
    + COASTLINE_BREAKS_FOR_RANDOM.length
    + FOREST_BREAKS_FOR_RANDOM.length
    + OIL_BREAKS_FOR_RANDOM.length
    + RICE_BREAKS_FOR_RANDOM.length
    + COAL_BREAKS_FOR_RANDOM.length
    + SHEEP_PER_CAPITA_BREAKS_FOR_RANDOM.length
    + CATTLE_PER_CAPITA_BREAKS_FOR_RANDOM.length
    + BEER_PER_CAPITA_BREAKS_FOR_RANDOM.length
    + TEA_BREAKS_FOR_RANDOM.length
    + SUGARCANE_BREAKS_FOR_RANDOM.length
    + GOLD_BREAKS_FOR_RANDOM.length
    + OLIVE_OIL_BREAKS_FOR_RANDOM.length
    + HONEY_BREAKS_FOR_RANDOM.length
    + ALCOHOL_PER_CAPITA_BREAKS_FOR_RANDOM.length
    + MEAT_PER_CAPITA_BREAKS_FOR_RANDOM.length
    + BORDERS_BREAKS_FOR_RANDOM.length;
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

test('metricGroupRepeated catches two population thresholds on the same axis', () => {
  // axesConflict misses this (both on rows, never share a cell); the
  // single-use metric rule is what rejects "population again" in one grid.
  assert.equal(
    metricGroupRepeated(
      [population('>=', 5_000_000), population('<=', 1_000_000), continent('Europe')],
      [hasColor('red'), hasColor('blue'), hasMotif('animal')],
    ),
    true,
  );
});

test('metricGroupRepeated catches a metric repeated across opposite axes', () => {
  // Redundant with axesConflict for the cross-axis case, but the metric rule
  // owns the whole-puzzle "at most once" guarantee regardless of placement.
  assert.equal(
    metricGroupRepeated([density('>=', 100)], [density('<=', 10)]),
    true,
  );
  assert.equal(
    metricGroupRepeated([area('>=', 1_000_000)], [area('<=', 1_000)]),
    true,
  );
});

test('metricGroupRepeated allows a single instance of each metric', () => {
  assert.equal(
    metricGroupRepeated(
      [population('>=', 10_000_000), area('>=', 100_000), density('>=', 100)],
      [continent('Europe'), hasColor('red'), hasMotif('animal')],
    ),
    false,
  );
});

test('gdp and gdpPerCapita share a family, never both in one puzzle', () => {
  // Same axis: two "GDP" questions (gdp + gdpPerCapita) must be rejected.
  assert.equal(
    metricGroupRepeated(
      [gdp('>=', 1_000_000_000_000), gdpPerCapita('>=', 30_000), continent('Europe')],
      [hasColor('red'), hasColor('blue'), hasMotif('animal')],
    ),
    true,
  );
  // Opposite axes: same family must be rejected by both rules.
  assert.equal(metricGroupRepeated([gdp('>=', 100_000_000_000)], [gdpPerCapita('<=', 1_000)]), true);
  assert.equal(axesConflict([gdp('>=', 100_000_000_000)], [gdpPerCapita('<=', 1_000)]), true);
  // But gdp with a DIFFERENT family (population) is still fine.
  assert.equal(
    metricGroupRepeated([gdp('>=', 1_000_000_000_000), population('>=', 10_000_000)], [continent('Asia')]),
    false,
  );
  assert.equal(axesConflict([gdp('>=', 1_000_000_000_000)], [population('>=', 10_000_000)]), false);
});

test('coffee factory wires id, predicate, exclusiveGroup off the denormalized field', () => {
  const c = coffee('>=', 10_000);
  assert.equal(c.id, 'coffee:>=10000');
  assert.equal(c.exclusiveGroup, 'coffee');
  assert.equal(c.predicate(/** @type {any} */ ({ coffee: 25_000 })), true);
  assert.equal(c.predicate(/** @type {any} */ ({ coffee: 0 })), false); // a real non-grower (0) fails >=
  assert.equal(c.predicate(/** @type {any} */ ({})), false); // an org (no field) matches neither
});

test('COFFEE_BREAKS_FOR_RANDOM is >=-only (a sparse production metric has no meaningful <= tier)', () => {
  assert.ok(COFFEE_BREAKS_FOR_RANDOM.length > 0);
  assert.ok(COFFEE_BREAKS_FOR_RANDOM.every((b) => b.op === '>='), 'every coffee tier is atLeast');
  assert.ok(COFFEE_BREAKS_FOR_RANDOM.every((b) => b.ultimate !== true), 'no coffee tier is 9×9-eligible');
});

test('categoryFromId round-trips coffee thresholds', () => {
  const ge = categoryFromId('coffee:>=100000');
  assert.ok(ge);
  assert.equal(ge?.exclusiveGroup, 'coffee');
  assert.equal(ge?.predicate(/** @type {any} */ ({ coffee: 200_000 })), true);
  assert.equal(categoryFromId('coffee:10000'), null); // bare N (no op) is not a valid threshold
});

test('translateCategoryLabel prefixes coffee with the metric name and localized tier', () => {
  const label = translateCategoryLabel(coffee('>=', 10_000), (key, fallback) => {
    if (key === 'metric.coffee') return 'Coffee production';
    if (key === 'coffee.atLeast.10k') return 'over 10K tonnes';
    return fallback;
  });
  assert.equal(label, 'Coffee production: over 10K tonnes');
});

test('coffee is its own family — coexists with gdp / population in one puzzle', () => {
  assert.equal(metricGroupRepeated([coffee('>=', 10_000), gdp('>=', 100_000_000_000)], [continent('Africa')]), false);
  assert.equal(axesConflict([coffee('>=', 10_000)], [population('>=', 10_000_000)]), false);
});

test('elevation factory wires id, predicate, exclusiveGroup off the denormalized field', () => {
  const hi = elevation('>=', 1_000);
  assert.equal(hi.id, 'elevation:>=1000');
  assert.equal(hi.exclusiveGroup, 'elevation');
  assert.equal(hi.predicate(/** @type {any} */ ({ elevation: 8849 })), true); // Everest
  assert.equal(hi.predicate(/** @type {any} */ ({ elevation: 2 })), false); // Maldives fails >=1000
  const lo = elevation('<=', 100);
  assert.equal(lo.id, 'elevation:<=100');
  assert.equal(lo.predicate(/** @type {any} */ ({ elevation: 2 })), true); // Maldives is <=100
  assert.equal(lo.predicate(/** @type {any} */ ({})), false); // an org (no field) matches neither
});

test('ELEVATION_BREAKS_FOR_RANDOM is two-directional with exactly one 9×9-eligible break', () => {
  // Dense + two-directional, the mirror of area: both high (>=) and low (<=) tiers.
  assert.ok(ELEVATION_BREAKS_FOR_RANDOM.some((b) => b.op === '>='), 'has a high tier');
  assert.ok(ELEVATION_BREAKS_FOR_RANDOM.some((b) => b.op === '<='), 'has a low tier');
  // Dense, so unlike coffee it IS 9×9-eligible: exactly the broad >=1000 break.
  const ultimate = ELEVATION_BREAKS_FOR_RANDOM.filter((b) => b.ultimate === true);
  assert.equal(ultimate.length, 1, 'exactly one ultimate break');
  assert.deepEqual(ultimate[0], { op: '>=', n: 1_000, ultimate: true });
});

test('categoryFromId round-trips elevation thresholds (both directions)', () => {
  const hi = categoryFromId('elevation:>=5000');
  assert.ok(hi);
  assert.equal(hi?.exclusiveGroup, 'elevation');
  assert.equal(hi?.predicate(/** @type {any} */ ({ elevation: 6190 })), true); // Denali
  const lo = categoryFromId('elevation:<=200');
  assert.equal(lo?.predicate(/** @type {any} */ ({ elevation: 63 })), true); // Bahamas
  assert.equal(categoryFromId('elevation:1000'), null); // bare N (no op) is not a valid threshold
});

test('translateCategoryLabel prefixes elevation with the metric name and localized tier', () => {
  const label = translateCategoryLabel(elevation('>=', 5_000), (key, fallback) => {
    if (key === 'metric.elevation') return 'Highest elevation';
    if (key === 'elevation.atLeast.5000') return 'over 5,000 m';
    return fallback;
  });
  assert.equal(label, 'Highest elevation: over 5,000 m');
});

test('elevation is its own family, coexisting with gdp / population in one puzzle', () => {
  assert.equal(metricGroupRepeated([elevation('>=', 1_000), gdp('>=', 100_000_000_000)], [continent('Asia')]), false);
  assert.equal(axesConflict([elevation('<=', 100)], [population('>=', 10_000_000)]), false);
});

test('metricGroupRepeated does not restrict non-metric groups (two continents on one axis)', () => {
  // Continents are deliberately single-axis-repeatable — two down the rows is
  // a normal grid, so they stay out of SINGLE_USE_METRIC_GROUPS.
  assert.equal(
    metricGroupRepeated(
      [continent('Africa'), continent('Asia'), continent('Europe')],
      [hasColor('red'), hasColor('blue'), hasMotif('animal')],
    ),
    false,
  );
});

test('SINGLE_USE_METRIC_GROUPS holds exactly the numeric world metrics', () => {
  assert.deepEqual(
    [...SINGLE_USE_METRIC_GROUPS].sort(),
    ['alcoholPerCapita', 'apple', 'area', 'banana', 'beerPerCapita', 'borders', 'cattlePerCapita', 'coal', 'coastline', 'cocoa', 'coffee', 'density', 'elevation', 'forest', 'gdp', 'gdpPerCapita', 'gold', 'honey', 'meatPerCapita', 'oil', 'oliveOil', 'population', 'rice', 'sheepPerCapita', 'sugarcane', 'tea', 'wine'],
  );
});

test('hasStripesOnly factory wires id, predicate, exclusiveGroup, incompatibleWith, ultimateEligible', () => {
  const h = hasStripesOnly('horizontal');
  assert.equal(h.id, 'stripesOnly:horizontal');
  assert.equal(h.exclusiveGroup, 'stripesOnly');
  assert.equal(h.ultimateEligible, false);
  assert.ok(h.incompatibleWith?.includes('hasMotif:cross'));
  assert.ok(h.incompatibleWith?.includes('hasMotif:coat-of-arms'));
  assert.ok(h.incompatibleWith?.includes('hasMotif:animal'));
  // eu-member is a political tag, not a visual charge — must NOT be on the list
  assert.ok(!h.incompatibleWith?.includes('hasMotif:eu-member'));

  const v = hasStripesOnly('vertical');
  assert.equal(v.id, 'stripesOnly:vertical');
  assert.equal(v.exclusiveGroup, 'stripesOnly');

  // predicate keys on the country's stripesOnly field
  const fr = country({ code: 'fr', name: 'France', stripesOnly: 'vertical' });
  const de = country({ code: 'de', name: 'Germany', stripesOnly: 'horizontal' });
  const mx = country({ code: 'mx', name: 'Mexico', stripesOnly: null });
  assert.equal(v.predicate(fr), true);
  assert.equal(h.predicate(de), true);
  assert.equal(h.predicate(fr), false);
  assert.equal(v.predicate(mx), false);
});

test('axesConflict catches stripesOnly:horizontal × stripesOnly:vertical (same exclusiveGroup)', () => {
  const conflict = axesConflict(
    [hasStripesOnly('horizontal'), hasColor('red'), continent('Europe')],
    [hasStripesOnly('vertical'),   hasColor('blue'), hasMotif('eu-member')],
  );
  assert.equal(conflict, true);
});

test('axesConflict catches stripesOnly × charge motif via incompatibleWith (cross-dimension)', () => {
  // A pure-stripes flag can have no overlaid charge by definition, so the
  // cell stripesOnly × hasMotif:cross is structurally empty. The generator
  // must skip the pair before testing cells.
  const conflict = axesConflict(
    [hasStripesOnly('horizontal'), continent('Europe'), hasColor('red')],
    [hasMotif('cross'), hasColor('blue'), hasMotif('eu-member')],
  );
  assert.equal(conflict, true);
});

test('axesConflict checks incompatibleWith symmetrically (charge motif as row, stripesOnly as col)', () => {
  const conflict = axesConflict(
    [hasMotif('coat-of-arms'), continent('Africa'), hasColor('green')],
    [hasStripesOnly('vertical'), hasColor('red'), hasColor('yellow')],
  );
  assert.equal(conflict, true);
});

test('axesConflict allows stripesOnly × eu-member (eu-member is not a visual charge)', () => {
  const conflict = axesConflict(
    [hasStripesOnly('horizontal'), continent('Europe'), hasColor('red')],
    [hasMotif('eu-member'), hasColor('blue'), hasColor('white')],
  );
  assert.equal(conflict, false);
});

test('buildUltimateCategoryPool excludes stripesOnly categories (their answer sets are too narrow for 9×9)', () => {
  const ultPool = buildUltimateCategoryPool();
  const stripes = ultPool.filter((c) => c.id.startsWith('stripesOnly:'));
  assert.equal(stripes.length, 0, 'stripesOnly cats must not appear in the 9×9 pool');
  // Sanity check — the non-stripesOnly cats survive, minus the extreme
  // population + area + density tiers (only the one `ultimate: true` break per
  // metric stays in 9×9).
  const droppedPop = POPULATION_BREAKS_FOR_RANDOM.filter((b) => b.ultimate !== true).length;
  const droppedArea = AREA_BREAKS_FOR_RANDOM.filter((b) => b.ultimate !== true).length;
  const droppedDensity = DENSITY_BREAKS_FOR_RANDOM.filter((b) => b.ultimate !== true).length;
  const droppedGdp = GDP_BREAKS_FOR_RANDOM.filter((b) => b.ultimate !== true).length;
  const droppedGdpPerCapita = GDP_PER_CAPITA_BREAKS_FOR_RANDOM.filter((b) => b.ultimate !== true).length;
  // Coffee has NO ultimate break (too sparse/concentrated for 9×9), so ALL its
  // breaks drop — coffee never appears in the Ultimate pool.
  const droppedCoffee = COFFEE_BREAKS_FOR_RANDOM.filter((b) => b.ultimate !== true).length;
  assert.equal(droppedCoffee, COFFEE_BREAKS_FOR_RANDOM.length, 'no coffee tier is ultimate-eligible');
  assert.equal(
    ultPool.filter((c) => c.id.startsWith('coffee:')).length,
    0,
    'coffee cats must not appear in the 9×9 pool',
  );
  // Wine, like coffee, has NO ultimate break (too sparse for 9×9), so ALL its
  // breaks drop, so wine never appears in the Ultimate pool.
  const droppedWine = WINE_BREAKS_FOR_RANDOM.filter((b) => b.ultimate !== true).length;
  assert.equal(droppedWine, WINE_BREAKS_FOR_RANDOM.length, 'no wine tier is ultimate-eligible');
  assert.equal(
    ultPool.filter((c) => c.id.startsWith('wine:')).length,
    0,
    'wine cats must not appear in the 9×9 pool',
  );
  // Cocoa, like coffee / wine, has NO ultimate break, so ALL its breaks drop.
  const droppedCocoa = COCOA_BREAKS_FOR_RANDOM.filter((b) => b.ultimate !== true).length;
  assert.equal(droppedCocoa, COCOA_BREAKS_FOR_RANDOM.length, 'no cocoa tier is ultimate-eligible');
  assert.equal(
    ultPool.filter((c) => c.id.startsWith('cocoa:')).length,
    0,
    'cocoa cats must not appear in the 9×9 pool',
  );
  // Banana, like the other crops, has NO ultimate break, so ALL its breaks drop.
  const droppedBanana = BANANA_BREAKS_FOR_RANDOM.filter((b) => b.ultimate !== true).length;
  assert.equal(droppedBanana, BANANA_BREAKS_FOR_RANDOM.length, 'no banana tier is ultimate-eligible');
  assert.equal(
    ultPool.filter((c) => c.id.startsWith('banana:')).length,
    0,
    'banana cats must not appear in the 9×9 pool',
  );
  // Apple, like the other crops, has NO ultimate break, so ALL its breaks drop.
  const droppedApple = APPLE_BREAKS_FOR_RANDOM.filter((b) => b.ultimate !== true).length;
  assert.equal(droppedApple, APPLE_BREAKS_FOR_RANDOM.length, 'no apple tier is ultimate-eligible');
  assert.equal(
    ultPool.filter((c) => c.id.startsWith('apple:')).length,
    0,
    'apple cats must not appear in the 9×9 pool',
  );
  // Elevation IS 9×9-eligible (dense): only its five non-ultimate breaks drop,
  // the broad >=1000 tier stays, so unlike coffee it DOES appear in the pool.
  const droppedElevation = ELEVATION_BREAKS_FOR_RANDOM.filter((b) => b.ultimate !== true).length;
  assert.equal(
    ultPool.filter((c) => c.id.startsWith('elevation:')).length,
    1,
    'exactly the ultimate elevation tier appears in the 9×9 pool',
  );
  // Coastline IS 9×9-eligible (dense), like elevation: only its five non-ultimate
  // breaks drop, the broad >=1000 tier stays.
  const droppedCoastline = COASTLINE_BREAKS_FOR_RANDOM.filter((b) => b.ultimate !== true).length;
  assert.equal(
    ultPool.filter((c) => c.id.startsWith('coastline:')).length,
    1,
    'exactly the ultimate coastline tier appears in the 9×9 pool',
  );
  // Forest IS 9×9-eligible (dense), like elevation / coastline: only its five
  // non-ultimate breaks drop, the broad >=30 tier stays.
  const droppedForest = FOREST_BREAKS_FOR_RANDOM.filter((b) => b.ultimate !== true).length;
  assert.equal(
    ultPool.filter((c) => c.id.startsWith('forest:')).length,
    1,
    'exactly the ultimate forest tier appears in the 9×9 pool',
  );
  // Oil, like the crops, has NO ultimate break, so ALL its breaks drop.
  const droppedOil = OIL_BREAKS_FOR_RANDOM.filter((b) => b.ultimate !== true).length;
  assert.equal(droppedOil, OIL_BREAKS_FOR_RANDOM.length, 'no oil tier is ultimate-eligible');
  assert.equal(
    ultPool.filter((c) => c.id.startsWith('oil:')).length,
    0,
    'oil cats must not appear in the 9×9 pool',
  );
  // Rice, like the crops, has NO ultimate break, so ALL its breaks drop.
  const droppedRice = RICE_BREAKS_FOR_RANDOM.filter((b) => b.ultimate !== true).length;
  assert.equal(droppedRice, RICE_BREAKS_FOR_RANDOM.length, 'no rice tier is ultimate-eligible');
  assert.equal(
    ultPool.filter((c) => c.id.startsWith('rice:')).length,
    0,
    'rice cats must not appear in the 9×9 pool',
  );
  // Coal, like oil / the crops, has NO ultimate break, so ALL its breaks drop.
  const droppedCoal = COAL_BREAKS_FOR_RANDOM.filter((b) => b.ultimate !== true).length;
  assert.equal(droppedCoal, COAL_BREAKS_FOR_RANDOM.length, 'no coal tier is ultimate-eligible');
  assert.equal(
    ultPool.filter((c) => c.id.startsWith('coal:')).length,
    0,
    'coal cats must not appear in the 9×9 pool',
  );
  // Sheep per capita, like the crops, has NO ultimate break (one Falkland
  // outlier over a thin tail), so ALL its breaks drop.
  const droppedSheepPerCapita = SHEEP_PER_CAPITA_BREAKS_FOR_RANDOM.filter((b) => b.ultimate !== true).length;
  assert.equal(droppedSheepPerCapita, SHEEP_PER_CAPITA_BREAKS_FOR_RANDOM.length, 'no sheepPerCapita tier is ultimate-eligible');
  assert.equal(
    ultPool.filter((c) => c.id.startsWith('sheepPerCapita:')).length,
    0,
    'sheepPerCapita cats must not appear in the 9×9 pool',
  );
  // Cattle per capita, like the sheep twin, has NO ultimate break, so ALL drop.
  const droppedCattlePerCapita = CATTLE_PER_CAPITA_BREAKS_FOR_RANDOM.filter((b) => b.ultimate !== true).length;
  assert.equal(droppedCattlePerCapita, CATTLE_PER_CAPITA_BREAKS_FOR_RANDOM.length, 'no cattlePerCapita tier is ultimate-eligible');
  assert.equal(
    ultPool.filter((c) => c.id.startsWith('cattlePerCapita:')).length,
    0,
    'cattlePerCapita cats must not appear in the 9×9 pool',
  );
  // Beer per capita is absence:'unknown' (not dense), so it too has NO ultimate
  // break: ALL its breaks drop from the 9×9 pool.
  const droppedBeerPerCapita = BEER_PER_CAPITA_BREAKS_FOR_RANDOM.filter((b) => b.ultimate !== true).length;
  assert.equal(droppedBeerPerCapita, BEER_PER_CAPITA_BREAKS_FOR_RANDOM.length, 'no beerPerCapita tier is ultimate-eligible');
  assert.equal(
    ultPool.filter((c) => c.id.startsWith('beerPerCapita:')).length,
    0,
    'beerPerCapita cats must not appear in the 9×9 pool',
  );
  // Tea, like coffee, has NO ultimate break (too sparse for 9×9), so ALL drop.
  const droppedTea = TEA_BREAKS_FOR_RANDOM.filter((b) => b.ultimate !== true).length;
  assert.equal(droppedTea, TEA_BREAKS_FOR_RANDOM.length, 'no tea tier is ultimate-eligible');
  assert.equal(
    ultPool.filter((c) => c.id.startsWith('tea:')).length,
    0,
    'tea cats must not appear in the 9×9 pool',
  );
  // Sugar cane, like the other sparse crops, has NO ultimate break, so ALL drop.
  const droppedSugarcane = SUGARCANE_BREAKS_FOR_RANDOM.filter((b) => b.ultimate !== true).length;
  assert.equal(droppedSugarcane, SUGARCANE_BREAKS_FOR_RANDOM.length, 'no sugarcane tier is ultimate-eligible');
  assert.equal(
    ultPool.filter((c) => c.id.startsWith('sugarcane:')).length,
    0,
    'sugarcane cats must not appear in the 9×9 pool',
  );
  // Gold, like the other sparse extractives/crops, has NO ultimate break, so ALL drop.
  const droppedGold = GOLD_BREAKS_FOR_RANDOM.filter((b) => b.ultimate !== true).length;
  assert.equal(droppedGold, GOLD_BREAKS_FOR_RANDOM.length, 'no gold tier is ultimate-eligible');
  assert.equal(
    ultPool.filter((c) => c.id.startsWith('gold:')).length,
    0,
    'gold cats must not appear in the 9×9 pool',
  );
  // Alcohol per capita is absence:'unknown' like beer, so it has NO ultimate break.
  const droppedAlcoholPerCapita = ALCOHOL_PER_CAPITA_BREAKS_FOR_RANDOM.filter((b) => b.ultimate !== true).length;
  assert.equal(droppedAlcoholPerCapita, ALCOHOL_PER_CAPITA_BREAKS_FOR_RANDOM.length, 'no alcoholPerCapita tier is ultimate-eligible');
  assert.equal(
    ultPool.filter((c) => c.id.startsWith('alcoholPerCapita:')).length,
    0,
    'alcoholPerCapita cats must not appear in the 9×9 pool',
  );
  // Meat per capita is absence:'unknown' like the drink metrics, so ALL drop.
  const droppedMeatPerCapita = MEAT_PER_CAPITA_BREAKS_FOR_RANDOM.filter((b) => b.ultimate !== true).length;
  assert.equal(droppedMeatPerCapita, MEAT_PER_CAPITA_BREAKS_FOR_RANDOM.length, 'no meatPerCapita tier is ultimate-eligible');
  assert.equal(
    ultPool.filter((c) => c.id.startsWith('meatPerCapita:')).length,
    0,
    'meatPerCapita cats must not appear in the 9×9 pool',
  );
  // Borders is dense but top-heavy (a long tail of 0s), so it has NO ultimate break.
  const droppedBorders = BORDERS_BREAKS_FOR_RANDOM.filter((b) => b.ultimate !== true).length;
  assert.equal(droppedBorders, BORDERS_BREAKS_FOR_RANDOM.length, 'no borders tier is ultimate-eligible');
  assert.equal(
    ultPool.filter((c) => c.id.startsWith('borders:')).length,
    0,
    'borders cats must not appear in the 9×9 pool',
  );
  // Olive oil, like the other sparse crops, has NO ultimate break, so ALL drop.
  const droppedOliveOil = OLIVE_OIL_BREAKS_FOR_RANDOM.filter((b) => b.ultimate !== true).length;
  assert.equal(droppedOliveOil, OLIVE_OIL_BREAKS_FOR_RANDOM.length, 'no oliveOil tier is ultimate-eligible');
  assert.equal(
    ultPool.filter((c) => c.id.startsWith('oliveOil:')).length,
    0,
    'oliveOil cats must not appear in the 9×9 pool',
  );
  // Honey, like the other sparse producers, has NO ultimate break, so ALL drop.
  const droppedHoney = HONEY_BREAKS_FOR_RANDOM.filter((b) => b.ultimate !== true).length;
  assert.equal(droppedHoney, HONEY_BREAKS_FOR_RANDOM.length, 'no honey tier is ultimate-eligible');
  assert.equal(
    ultPool.filter((c) => c.id.startsWith('honey:')).length,
    0,
    'honey cats must not appear in the 9×9 pool',
  );
  assert.equal(
    ultPool.length,
    buildRandomCategoryPool().length - STRIPES_ORIENTATIONS_FOR_RANDOM.length
      - droppedPop - droppedArea - droppedDensity - droppedGdp - droppedGdpPerCapita - droppedCoffee
      - droppedWine - droppedCocoa - droppedBanana - droppedApple - droppedElevation - droppedCoastline - droppedForest - droppedOil - droppedRice - droppedCoal
      - droppedSheepPerCapita - droppedCattlePerCapita - droppedBeerPerCapita - droppedTea - droppedSugarcane - droppedGold
      - droppedAlcoholPerCapita - droppedMeatPerCapita - droppedBorders - droppedOliveOil - droppedHoney,
  );
});

test('buildUltimateCategoryPool keeps exactly one population breakpoint (the ultimate:true tier)', () => {
  const ultPool = buildUltimateCategoryPool();
  const pop = ultPool.filter((c) => c.id.startsWith('population:'));
  assert.equal(pop.length, 1, '9×9 keeps a single population breakpoint');
  const ultimateBreak = POPULATION_BREAKS_FOR_RANDOM.find((b) => b.ultimate === true);
  assert.ok(ultimateBreak, 'exactly one break should be flagged ultimate');
  assert.equal(pop[0].id, `population:${ultimateBreak?.op}${ultimateBreak?.n}`);
});

test('buildUltimateCategoryPool keeps exactly one area breakpoint (the ultimate:true tier)', () => {
  const ultPool = buildUltimateCategoryPool();
  const areas = ultPool.filter((c) => c.id.startsWith('area:'));
  assert.equal(areas.length, 1, '9×9 keeps a single area breakpoint');
  const ultimateBreak = AREA_BREAKS_FOR_RANDOM.find((b) => b.ultimate === true);
  assert.ok(ultimateBreak, 'exactly one area break should be flagged ultimate');
  assert.equal(areas[0].id, `area:${ultimateBreak?.op}${ultimateBreak?.n}`);
});

test('buildUltimateCategoryPool keeps exactly one elevation breakpoint (the ultimate:true tier)', () => {
  const ultPool = buildUltimateCategoryPool();
  const elevations = ultPool.filter((c) => c.id.startsWith('elevation:'));
  assert.equal(elevations.length, 1, '9×9 keeps a single elevation breakpoint');
  const ultimateBreak = ELEVATION_BREAKS_FOR_RANDOM.find((b) => b.ultimate === true);
  assert.ok(ultimateBreak, 'exactly one elevation break should be flagged ultimate');
  assert.equal(elevations[0].id, `elevation:${ultimateBreak?.op}${ultimateBreak?.n}`);
});

test('buildUltimateCategoryPool keeps exactly one density breakpoint (the ultimate:true tier)', () => {
  const ultPool = buildUltimateCategoryPool();
  const densities = ultPool.filter((c) => c.id.startsWith('density:'));
  assert.equal(densities.length, 1, '9×9 keeps a single density breakpoint');
  const ultimateBreak = DENSITY_BREAKS_FOR_RANDOM.find((b) => b.ultimate === true);
  assert.ok(ultimateBreak, 'exactly one density break should be flagged ultimate');
  assert.equal(densities[0].id, `density:${ultimateBreak?.op}${ultimateBreak?.n}`);
});

test('categoryFromId round-trips stripesOnly:horizontal and stripesOnly:vertical', () => {
  const h = categoryFromId('stripesOnly:horizontal');
  assert.ok(h);
  assert.equal(h?.id, 'stripesOnly:horizontal');
  assert.equal(h?.exclusiveGroup, 'stripesOnly');

  const v = categoryFromId('stripesOnly:vertical');
  assert.ok(v);
  assert.equal(v?.id, 'stripesOnly:vertical');

  // Garbage orientation → null, not a broken Category
  assert.equal(categoryFromId('stripesOnly:diagonal'), null);
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

test('translateCategoryLabel maps stripesOnly:<orientation> to the stripesOnly.* key, falling back to the baked label', () => {
  const t = fakeTranslate({ 'stripesOnly.horizontal': 'tylko poziome pasy' });
  assert.equal(translateCategoryLabel(hasStripesOnly('horizontal'), t), 'tylko poziome pasy');
  // Missing key → baked English label ("vertical stripes only") surfaces,
  // not blank.
  assert.equal(translateCategoryLabel(hasStripesOnly('vertical'), fakeTranslate({})), 'vertical stripes only');
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

test('colorCount(=, N) predicate also matches an ambiguousColorCount value (TTT accepts the contested read)', () => {
  // Kiribati shape: 4 palette colours, [4, 5] count ambiguity from the
  // yellow/gold shade split. =5 cell must accept it so a player typing
  // "Kiribati" isn't punished for the plausible count.
  const ki = country({
    code: 'ki', name: 'Kiribati',
    primaryColors: ['red', 'white', 'yellow', 'blue'],
    ambiguousColorCount: [4, 5],
  });
  assert.equal(colorCount('=', 4).predicate(ki), true);  // canonical
  assert.equal(colorCount('=', 5).predicate(ki), true);  // ambig
  assert.equal(colorCount('=', 6).predicate(ki), false); // neither
});

test('colorCount(>=, N) and (<=, N) honour ambiguousColorCount', () => {
  const ki = country({
    code: 'ki', name: 'Kiribati',
    primaryColors: ['red', 'white', 'yellow', 'blue'],
    ambiguousColorCount: [4, 5],
  });
  assert.equal(colorCount('>=', 5).predicate(ki), true);  // ambig 5 satisfies
  assert.equal(colorCount('>=', 6).predicate(ki), false);
  assert.equal(colorCount('<=', 4).predicate(ki), true);  // canonical 4 satisfies
  assert.equal(colorCount('<=', 3).predicate(ki), false); // neither plausible count fits
});

test('colorCount: a flag without ambiguousColorCount keeps the strict-canonical behaviour', () => {
  const fr = country({ code: 'fr', name: 'France', primaryColors: ['red', 'white', 'blue'] });
  assert.equal(colorCount('=', 3).predicate(fr), true);
  assert.equal(colorCount('=', 4).predicate(fr), false);
});

test('population(>=, N) matches countries whose population is at least N; missing value never matches', () => {
  const cat = population('>=', 50_000_000);
  const big = country({ code: 'de', name: 'Germany', population: 83_000_000 });
  const exactlyN = country({ code: 'xx', name: 'X', population: 50_000_000 });
  const small = country({ code: 'is', name: 'Iceland', population: 385_000 });
  const noValue = country({ code: 'nn', name: 'Nowhere' }); // sparse metric: absent
  assert.equal(cat.id, 'population:>=50000000');
  assert.equal(cat.exclusiveGroup, 'population');
  assert.equal(cat.predicate(big), true);
  assert.equal(cat.predicate(exactlyN), true);
  assert.equal(cat.predicate(small), false);
  assert.equal(cat.predicate(noValue), false);
});

test('population(<=, N) matches countries whose population is at most N; missing value never matches', () => {
  const cat = population('<=', 1_000_000);
  const tiny = country({ code: 'mt', name: 'Malta', population: 552_747 });
  const exactlyN = country({ code: 'xx', name: 'X', population: 1_000_000 });
  const big = country({ code: 'de', name: 'Germany', population: 83_000_000 });
  const noValue = country({ code: 'nn', name: 'Nowhere' });
  assert.equal(cat.id, 'population:<=1000000');
  assert.equal(cat.predicate(tiny), true);
  assert.equal(cat.predicate(exactlyN), true);
  assert.equal(cat.predicate(big), false);
  assert.equal(cat.predicate(noValue), false);
});

test('population factory flags ultimateEligible:false only when asked (default keeps it in 9×9)', () => {
  assert.equal(population('>=', 10_000_000).ultimateEligible, undefined);
  assert.equal(population('>=', 10_000_000, { ultimateEligible: true }).ultimateEligible, undefined);
  assert.equal(population('>=', 100_000_000, { ultimateEligible: false }).ultimateEligible, false);
});

test('axesConflict blocks two population breakpoints across opposite axes (single exclusiveGroup)', () => {
  // >=100M row × <=1M col would always be empty; >=10M × <=20M would be
  // redundant. Same exclusiveGroup makes axesConflict reject both.
  assert.equal(
    axesConflict([population('>=', 100_000_000)], [population('<=', 1_000_000)]),
    true,
  );
  assert.equal(
    axesConflict([population('>=', 10_000_000)], [population('<=', 20_000_000)]),
    true,
  );
});

test('categoryFromId round-trips population thresholds and rejects malformed suffixes', () => {
  const ge = categoryFromId('population:>=10000000');
  assert.ok(ge);
  assert.equal(ge?.id, 'population:>=10000000');
  assert.equal(ge?.exclusiveGroup, 'population');
  const big = country({ code: 'de', name: 'Germany', population: 83_000_000 });
  assert.equal(ge?.predicate(big), true);

  const le = categoryFromId('population:<=1000000');
  assert.ok(le);
  assert.equal(le?.id, 'population:<=1000000');

  // No operator, bad number, or zero → null, not a broken Category
  assert.equal(categoryFromId('population:10000000'), null);
  assert.equal(categoryFromId('population:>=abc'), null);
  assert.equal(categoryFromId('population:>=0'), null);
});

test('translateCategoryLabel prefixes population thresholds with the metric name, falling back to the baked label', () => {
  const t = fakeTranslate({
    'metric.population': 'Liczba ludności',
    'population.atLeast.10m': 'ponad 10 mln ludności',
    'population.atMost.1m': 'poniżej 1 mln ludności',
  });
  assert.equal(translateCategoryLabel(population('>=', 10_000_000), t), 'Liczba ludności: ponad 10 mln ludności');
  assert.equal(translateCategoryLabel(population('<=', 1_000_000), t), 'Liczba ludności: poniżej 1 mln ludności');
  // Missing keys → English metric-name prefix + baked English threshold label
  assert.equal(
    translateCategoryLabel(population('>=', 50_000_000), fakeTranslate({})),
    'Population: over 50M people',
  );
});

test('area(>=, N) matches countries whose area is at least N; missing value never matches', () => {
  const cat = area('>=', 1_000_000);
  const big = country({ code: 'ru', name: 'Russia', area: 16_376_870 });
  const exactlyN = country({ code: 'xx', name: 'X', area: 1_000_000 });
  const small = country({ code: 'mt', name: 'Malta', area: 316 });
  const noValue = country({ code: 'nn', name: 'Nowhere' }); // non-place: no area
  assert.equal(cat.id, 'area:>=1000000');
  assert.equal(cat.exclusiveGroup, 'area');
  assert.equal(cat.predicate(big), true);
  assert.equal(cat.predicate(exactlyN), true);
  assert.equal(cat.predicate(small), false);
  assert.equal(cat.predicate(noValue), false);
});

test('area(<=, N) matches countries whose area is at most N; missing value never matches', () => {
  const cat = area('<=', 1_000);
  const tiny = country({ code: 'va', name: 'Vatican', area: 0.49 });
  const exactlyN = country({ code: 'xx', name: 'X', area: 1_000 });
  const big = country({ code: 'ru', name: 'Russia', area: 16_376_870 });
  const noValue = country({ code: 'nn', name: 'Nowhere' });
  assert.equal(cat.id, 'area:<=1000');
  assert.equal(cat.predicate(tiny), true);
  assert.equal(cat.predicate(exactlyN), true);
  assert.equal(cat.predicate(big), false);
  assert.equal(cat.predicate(noValue), false);
});

test('area factory flags ultimateEligible:false only when asked', () => {
  assert.equal(area('>=', 100_000).ultimateEligible, undefined);
  assert.equal(area('>=', 1_000_000, { ultimateEligible: false }).ultimateEligible, false);
});

test('axesConflict blocks two area breakpoints across opposite axes (single exclusiveGroup)', () => {
  assert.equal(axesConflict([area('>=', 1_000_000)], [area('<=', 1_000)]), true);
  assert.equal(axesConflict([area('>=', 100_000)], [area('<=', 100_000)]), true);
});

test('density(op, N) matches on people/km²; missing value never matches', () => {
  const dense = density('>=', 500);
  const sparse = density('<=', 10);
  const mo = country({ code: 'mo', name: 'Macau', density: 20000 });
  const mn = country({ code: 'mn', name: 'Mongolia', density: 2.2 });
  const none = country({ code: 'zz', name: 'Org' });
  assert.equal(dense.id, 'density:>=500');
  assert.equal(dense.exclusiveGroup, 'density');
  assert.equal(dense.predicate(mo), true);
  assert.equal(dense.predicate(mn), false);
  assert.equal(dense.predicate(none), false);
  assert.equal(sparse.predicate(mn), true);
  assert.equal(sparse.predicate(mo), false);
  assert.equal(DENSITY_BREAKS_FOR_RANDOM.filter((b) => b.ultimate).length, 1, 'exactly one ultimate density break');
});

test('density factory flags ultimateEligible:false only when asked', () => {
  assert.equal(density('>=', 100).ultimateEligible, undefined);
  assert.equal(density('>=', 500, { ultimateEligible: false }).ultimateEligible, false);
});

test('axesConflict blocks two density breakpoints across opposite axes (single exclusiveGroup)', () => {
  assert.equal(axesConflict([density('>=', 500)], [density('<=', 10)]), true);
  assert.equal(axesConflict([density('>=', 100)], [density('<=', 100)]), true);
});

test('categoryFromId round-trips density thresholds and rejects malformed suffixes', () => {
  const ge = categoryFromId('density:>=100');
  assert.ok(ge);
  assert.equal(ge?.id, 'density:>=100');
  assert.equal(ge?.exclusiveGroup, 'density');
  const mo = country({ code: 'mo', name: 'Macau', density: 20000 });
  assert.equal(ge?.predicate(mo), true);

  const le = categoryFromId('density:<=10');
  assert.equal(le?.id, 'density:<=10');

  assert.equal(categoryFromId('density:100'), null);
  assert.equal(categoryFromId('density:>=abc'), null);
  assert.equal(categoryFromId('density:>=0'), null);
});

test('translateCategoryLabel prefixes density thresholds with the metric name, falling back to the baked label', () => {
  const t = fakeTranslate({
    'metric.density': 'Gęstość zaludnienia',
    'density.atLeast.500': 'ponad 500 osób/km²',
    'density.atMost.10': 'poniżej 10 osób/km²',
    'density.atLeast.100': 'ponad 100 osób/km²',
  });
  assert.equal(translateCategoryLabel(density('>=', 500), t), 'Gęstość zaludnienia: ponad 500 osób/km²');
  assert.equal(translateCategoryLabel(density('<=', 10), t), 'Gęstość zaludnienia: poniżej 10 osób/km²');
  assert.equal(translateCategoryLabel(density('>=', 100), t), 'Gęstość zaludnienia: ponad 100 osób/km²');
  // Missing keys → English metric-name prefix + baked English threshold label
  assert.equal(translateCategoryLabel(density('>=', 200), fakeTranslate({})), 'Population density: over 200 people/km²');
});

test('gdp(op, N) matches on US$; missing value never matches; compact label', () => {
  const big = gdp('>=', 1_000_000_000_000);
  const small = gdp('<=', 100_000_000);
  const us = country({ code: 'us', name: 'USA', gdp: 27_000_000_000_000 });
  const tv = country({ code: 'tv', name: 'Tuvalu', gdp: 62_000_000 });
  const none = country({ code: 'zz', name: 'Org' });
  assert.equal(big.id, 'gdp:>=1000000000000');
  assert.equal(big.exclusiveGroup, 'gdp');
  assert.equal(big.label, 'over $1T');
  assert.equal(big.predicate(us), true);
  assert.equal(big.predicate(tv), false);
  assert.equal(big.predicate(none), false);
  assert.equal(small.predicate(tv), true);
  assert.equal(small.predicate(us), false);
  assert.equal(GDP_BREAKS_FOR_RANDOM.filter((b) => b.ultimate).length, 1, 'exactly one ultimate gdp break');
});

test('gdpPerCapita(op, N) matches on US$/person; compact label', () => {
  const rich = gdpPerCapita('>=', 30_000);
  const poor = gdpPerCapita('<=', 1_000);
  const lu = country({ code: 'lu', name: 'Luxembourg', gdpPerCapita: 133_000 });
  const bi = country({ code: 'bi', name: 'Burundi', gdpPerCapita: 250 });
  assert.equal(rich.id, 'gdpPerCapita:>=30000');
  assert.equal(rich.exclusiveGroup, 'gdpPerCapita');
  assert.equal(rich.label, 'over $30K');
  assert.equal(rich.predicate(lu), true);
  assert.equal(rich.predicate(bi), false);
  assert.equal(poor.predicate(bi), true);
  assert.equal(GDP_PER_CAPITA_BREAKS_FOR_RANDOM.filter((b) => b.ultimate).length, 1, 'exactly one ultimate gdpPerCapita break');
});

test('categoryFromId round-trips gdp / gdpPerCapita thresholds', () => {
  const g = categoryFromId('gdp:>=100000000000');
  assert.equal(g?.id, 'gdp:>=100000000000');
  assert.equal(g?.exclusiveGroup, 'gdp');
  assert.equal(g?.predicate(country({ code: 'us', name: 'USA', gdp: 27e12 })), true);
  const pc = categoryFromId('gdpPerCapita:<=1000');
  assert.equal(pc?.id, 'gdpPerCapita:<=1000');
  assert.equal(pc?.exclusiveGroup, 'gdpPerCapita');
  assert.equal(categoryFromId('gdp:>=abc'), null);
  assert.equal(categoryFromId('gdpPerCapita:100'), null);
});

test('translateCategoryLabel formats gdp / gdpPerCapita with the compact US$ token, English fallback', () => {
  // English fallbacks exercise usdCompact ($100B / $1T / $30K).
  assert.equal(translateCategoryLabel(gdp('>=', 100_000_000_000), fakeTranslate({})), 'GDP: over $100B');
  assert.equal(translateCategoryLabel(gdp('>=', 1_000_000_000_000), fakeTranslate({})), 'GDP: over $1T');
  assert.equal(translateCategoryLabel(gdp('<=', 100_000_000), fakeTranslate({})), 'GDP: under $100M');
  assert.equal(translateCategoryLabel(gdpPerCapita('>=', 30_000), fakeTranslate({})), 'GDP per capita: over $30K');
  assert.equal(translateCategoryLabel(gdpPerCapita('<=', 1_000), fakeTranslate({})), 'GDP per capita: under $1K');
  // Localized keys resolve through labelFor.
  const t = fakeTranslate({ 'metric.gdp': 'PKB', 'gdp.atLeast.1t': 'ponad 1 bln $' });
  assert.equal(translateCategoryLabel(gdp('>=', 1_000_000_000_000), t), 'PKB: ponad 1 bln $');
});

test('categoryFromId round-trips area thresholds and rejects malformed suffixes', () => {
  const ge = categoryFromId('area:>=100000');
  assert.ok(ge);
  assert.equal(ge?.id, 'area:>=100000');
  assert.equal(ge?.exclusiveGroup, 'area');
  const big = country({ code: 'ru', name: 'Russia', area: 16_376_870 });
  assert.equal(ge?.predicate(big), true);

  const le = categoryFromId('area:<=1000');
  assert.equal(le?.id, 'area:<=1000');

  assert.equal(categoryFromId('area:100000'), null);
  assert.equal(categoryFromId('area:>=abc'), null);
  assert.equal(categoryFromId('area:>=0'), null);
});

test('translateCategoryLabel prefixes area thresholds with the metric name, falling back to the baked label', () => {
  const t = fakeTranslate({
    'metric.area': 'Powierzchnia',
    'area.atLeast.1m': 'ponad 1 mln km²',
    'area.atMost.1k': 'poniżej 1 tys. km²',
    'area.atLeast.100k': 'ponad 100 tys. km²',
  });
  assert.equal(translateCategoryLabel(area('>=', 1_000_000), t), 'Powierzchnia: ponad 1 mln km²');
  assert.equal(translateCategoryLabel(area('<=', 1_000), t), 'Powierzchnia: poniżej 1 tys. km²');
  assert.equal(translateCategoryLabel(area('>=', 100_000), t), 'Powierzchnia: ponad 100 tys. km²');
  // Missing keys → English metric-name prefix + baked English threshold label
  assert.equal(translateCategoryLabel(area('>=', 500_000), fakeTranslate({})), 'Land area: over 500K km²');
});

test('validateCell accepts an ambiguousColorCount flag for a contested-count cell (player-pick path)', () => {
  // Cell wants 5 colours; player picks a 4-canonical flag that's tagged
  // [4, 5]. Under strict-canonical this was rejected — the gap this PR closes.
  const puzzle = {
    rows: [continent('Oceania'), continent('Oceania'), continent('Oceania')],
    cols: [colorCount('=', 5), hasColor('red'), hasColor('blue')],
  };
  const ki = country({
    code: 'ki', name: 'Kiribati', continent: 'Oceania',
    primaryColors: ['red', 'white', 'yellow', 'blue'],
    ambiguousColorCount: [4, 5],
  });
  assert.equal(validateCell(puzzle, 0, 0, ki), true);
});

test('findPuzzleSolution finds a solution that requires an ambiguousColorCount flag (generator path)', () => {
  // One cell can only be filled by an ambig-5 flag — verifies the generator
  // and solver actually consume the wider predicate, not just unit-level.
  const puzzle = {
    rows: [continent('Oceania'), continent('Asia'), continent('Africa')],
    cols: [colorCount('=', 5), hasColor('red'), hasColor('blue')],
  };
  // Three rows × three cols = 9 cells need fillers. Pad with simple flags
  // for the non-ambig cells; the (Oceania × =5) cell is unfillable under
  // strict-canonical and only solvable with the ambig flag below.
  const ki = country({
    code: 'ki', name: 'Kiribati', continent: 'Oceania',
    primaryColors: ['red', 'white', 'yellow', 'blue'],
    ambiguousColorCount: [4, 5],
  });
  const oceaniaRed = country({ code: 'au', name: 'Australia', continent: 'Oceania', primaryColors: ['red', 'white', 'blue'] });
  const oceaniaBlue = country({ code: 'nz', name: 'NZ', continent: 'Oceania', primaryColors: ['blue', 'white', 'red'] });
  const asiaC5 = country({ code: 'in', name: 'India', continent: 'Asia', primaryColors: ['orange', 'white', 'green', 'blue', 'yellow'] });
  const asiaRed = country({ code: 'cn', name: 'China', continent: 'Asia', primaryColors: ['red', 'yellow'] });
  const asiaBlue = country({ code: 'jp2', name: 'JP2', continent: 'Asia', primaryColors: ['blue'] });
  const africaC5 = country({ code: 'za', name: 'SA', continent: 'Africa', primaryColors: ['black', 'green', 'yellow', 'white', 'red', 'blue'].slice(0, 5) });
  const africaRed = country({ code: 'ke', name: 'Kenya', continent: 'Africa', primaryColors: ['red', 'green', 'black'] });
  const africaBlue = country({ code: 'so', name: 'Somalia', continent: 'Africa', primaryColors: ['blue', 'white'] });
  const sol = findPuzzleSolution(puzzle, [ki, oceaniaRed, oceaniaBlue, asiaC5, asiaRed, asiaBlue, africaC5, africaRed, africaBlue]);
  assert.ok(sol, 'expected a solution that places Kiribati in the (Oceania × colorCount:5) cell');
  assert.equal(sol[0][0].code, 'ki');
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
          // Spread metric values WITHIN each (continent × colour) cell so the
          // 9×9 pool's `>=` metric breaks (population >=10M, area >=100K,
          // density >=100, elevation >=1000 m) are fillable everywhere (matching
          // production, where every country has a value) yet match a fraction per
          // cell, so no break is a superset of a continent. Offset so the metrics
          // aren't subset-related (n%2 vs n%3 give distinct partitions).
          population: n % 2 === 0 ? 20_000_000 : 5_000_000,
          area: n % 2 === 1 ? 200_000 : 50_000,
          density: n % 3 === 0 ? 500 : 20,
          gdp: n % 2 === 1 ? 200_000_000_000 : 8_000_000_000,
          gdpPerCapita: n % 3 === 2 ? 35_000 : 4_000,
          elevation: n % 3 === 1 ? 2_000 : 500,
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
  const puzzle = generateUltimateRandomPuzzle(countries, { rng: mulberry32(7), maxAttempts: 3000 });
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
  // The chosen seed lands on an axis combo the backtracker resolves within its
  // budget; growing the category pool (adding a motif, or the `area` / `elevation`
  // / `coastline` / `forest` metric breakpoints) shifts which seeds the PRNG
  // sweeps onto, so this is a known sensitivity. Seed 3 resolves under the
  // post-forest pool (seed 7, which resolved under the post-elevation pool,
  // stopped when forest's 9×9 break joined the ultimate pool).
  const countries = denseSquarePool(
    ['Europe', 'Asia', 'Africa', 'North America', 'South America', 'Oceania'],
    COLORS_FOR_RANDOM,
    10,
  );
  const puzzle = generateUltimateRandomPuzzle(countries, { rng: mulberry32(1), maxAttempts: 3000 });
  /** @type {Country[][][][] | null} */
  const assignment = findUltimateAssignment(puzzle, emptyPreFilled(), countries, mulberry32(1));
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
  const puzzle = generateUltimateRandomPuzzle(countries, { rng: mulberry32(1), maxAttempts: 3000 });
  // Seed one cell at (0,0,0,0) with a country that fits its row × col.
  const seedCandidates = countries.filter(
    (co) => puzzle.rows[0].predicate(co) && puzzle.cols[0].predicate(co),
  );
  assert.ok(seedCandidates.length > 0, 'test puzzle must have a valid seed');
  const seed = seedCandidates[0];
  const preFilled = emptyPreFilled();
  preFilled[0][0][0][0] = seed;

  const assignment = findUltimateAssignment(puzzle, preFilled, countries, mulberry32(1));
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
  const puzzle = generateUltimateRandomPuzzle(countries, { rng: mulberry32(7), maxAttempts: 3000 });
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
  const puzzle = generateUltimateRandomPuzzle(countries, { rng: mulberry32(7), maxAttempts: 3000 });
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
  // Spread population + area + density across each country so every threshold
  // breakpoint (all three metrics) has candidates in every continent. Without
  // this the metric categories in the pool are unfillable and the generator
  // burns its whole retry budget dodging them. Ladders chosen to populate every
  // break: pop <=1M / <=5M / <=20M / >=10M / >=50M / >=100M, area <=1K / <=10K /
  // <=100K / >=100K / >=500K / >=1M, density <=10 / <=30 / <=100 / >=100 /
  // >=200 / >=500.
  const POP_LADDER = [500_000, 3_000_000, 15_000_000, 30_000_000, 60_000_000, 120_000_000];
  const AREA_LADDER = [500, 5_000, 50_000, 200_000, 700_000, 2_000_000];
  const DENSITY_LADDER = [5, 20, 50, 150, 300, 800];
  // gdp <=$100M / <=$1B / <=$10B / >=$100B / >=$500B / >=$1T; gdpPerCapita
  // <=$1K / <=$2K / <=$5K / >=$30K / >=$50K / >=$70K. Same "every break has a
  // candidate in every continent" contract as the three ladders above.
  const GDP_LADDER = [50_000_000, 800_000_000, 8_000_000_000, 200_000_000_000, 600_000_000_000, 1_500_000_000_000];
  const GDP_PER_CAPITA_LADDER = [800, 1_800, 4_000, 35_000, 55_000, 80_000];
  // elevation <=100 / <=200 / <=500 / >=1000 / >=3000 / >=5000 m. Dense +
  // two-directional; a slower counter (/ 3) decorrelates it from pop/area/density
  // (which cycle on codeCounter % 6) so cross-metric cells like elevation × area
  // stay fillable, same discipline as the two GDP ladders above.
  const ELEVATION_LADDER = [50, 150, 400, 2_000, 4_000, 6_000];
  // Sparse crops (coffee / wine / cocoa / banana / olive oil) share one `>=`-only
  // ladder so every crop tier (>=1K / >=10K / >=100K tonnes) has candidates in
  // every continent. Real data leaves most places at 0 (absence:'zero'), but the
  // synthetic pool must make the crop categories *fillable* or the generator
  // burns its retry budget dodging them (adding a 4th crop, banana, is what
  // pushed the previously-tolerated unfillable crops over the 200-attempt
  // budget). All five crops share the value per country: they're distinct
  // families so they may co-occur, and a high-tier country satisfies the lower
  // tiers too, so every crop × crop cell stays fillable. (The flip side: five
  // crops on identical tiers is a dense source of implied-pair rejections, far
  // denser than real data ever is, which is why the metricGroupRepeated sweep
  // below carries extra retry headroom.)
  const CROP_LADDER = [3_000, 30_000, 300_000, 12_000, 120_000, 1_200_000];
  // coastline <=1 (landlocked, 0 km) / <=100 / <=500 / >=1000 / >=5000 /
  // >=25000 km. Dense + two-directional like elevation; a /4 counter decorrelates
  // it from the other metric ladders so cross-metric cells (coastline × area,
  // coastline × elevation) stay fillable. The 0-km rung makes the "landlocked"
  // (<=1) tier fillable in every synthetic continent, unlike real data where no
  // Oceania place is landlocked — the synthetic pool's job is fillability, not
  // realism.
  const COASTLINE_LADDER = [0, 50, 300, 2_000, 8_000, 30_000];
  // forest <=1 / <=5 / <=20 / >=30 / >=50 / >=70 %. Dense + two-directional,
  // intensive (size-independent), like elevation / coastline. A /6 counter
  // decorrelates it from the other metric ladders so cross-metric cells
  // (forest × coastline, forest × elevation) stay fillable. Half the rungs sit
  // >=30 so the single 9×9-eligible forest tier fills 9-distinct per continent.
  const FOREST_LADDER = [0, 3, 15, 40, 60, 85];
  // Apple (sparse crop, >=10K / >=100K / >=1M tonnes) and rice (sparse crop,
  // >=100K / >=1M / >=10M tonnes) sit an order or two above the CROP_LADDER
  // tiers, so each gets its own `>=`-only ladder with rungs above its top break
  // (half the rungs clear the highest tier, so every tier fills per continent).
  const APPLE_LADDER = [30_000, 300_000, 3_000_000, 120_000, 1_500_000, 30_000_000];
  const RICE_LADDER = [300_000, 3_000_000, 30_000_000, 1_500_000, 12_000_000, 150_000_000];
  // Oil + coal (sparse extractive, TWh, >=10 / >=100 / >=1000). Both share one
  // ladder and the same counter (like the crops share CROP_LADDER) so a
  // high-fuel country satisfies both and oil × coal cells stay fillable.
  const FUEL_LADDER = [5, 30, 300, 15, 150, 3_000];
  // Gold (sparse mining, small whole tonnes, >=50 / >=100 / >=200). Every rung
  // clears >=50, most clear >=100 and two clear >=200, so each gold tier has a
  // candidate in every synthetic continent (the metric is far sparser in real
  // data, but the synthetic pool's job is fillability, not realism).
  const GOLD_LADDER = [60, 130, 250, 90, 180, 400];
  // Honey (sparse producer, tonnes, >=10K / >=50K / >=100K). Its own ladder at
  // its own scale (NOT the crop cluster), so every rung clears >=10K, four clear
  // >=50K and two clear >=100K, and each tier has a candidate in every synthetic
  // continent. Decorrelated from the crops so honey × crop cells stay ordinary.
  const HONEY_LADDER = [15_000, 60_000, 120_000, 30_000, 80_000, 200_000];
  // Tea (sparse crop, >=10K / >=100K / >=1M) and sugarcane (sparse crop, the
  // largest by tonnage, >=1M / >=10M / >=100M) each get a `>=`-only ladder with
  // half the rungs clearing the top break, same discipline as apple/rice above.
  const TEA_LADDER = [30_000, 300_000, 3_000_000, 120_000, 1_500_000, 6_000_000];
  const SUGARCANE_LADDER = [3_000_000, 30_000_000, 300_000_000, 12_000_000, 150_000_000, 1_000_000_000];
  // Sheep + cattle per capita (dense derived, intensive, integer >=1 / >=2 club)
  // and beer per capita (intensive, >=50 / >=100 litres). Small ladders where
  // every rung clears the low tier and most clear the high one, so each tier
  // fills per continent. These threshold metrics had been relying on the
  // generator's retry budget to dodge them (unfillable); giving them ladders
  // keeps every registered metric fillable, the synthetic pool's contract.
  const SHEEP_LADDER = [1, 2, 3, 1, 2, 4];
  const CATTLE_LADDER = [1, 2, 3, 1, 2, 4];
  const BEER_LADDER = [60, 120, 200, 55, 150, 300];
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
          code: `c${codeCounter}`,
          name: `${cont}-${color}-${n}`,
          continent: cont,
          primaryColors: [color, ...extras],
          motifs: [motif],
          population: POP_LADDER[codeCounter % POP_LADDER.length],
          area: AREA_LADDER[codeCounter % AREA_LADDER.length],
          density: DENSITY_LADDER[codeCounter % DENSITY_LADDER.length],
          // Decorrelate the two GDP ladders from pop/area/density (which all use
          // codeCounter % 6) via a slower counter, so cross-metric cells stay
          // fillable: real data isn't perfectly rank-correlated either, and the
          // generator otherwise burns its retry budget dodging empty gdp × area
          // style cells. (gdp + gdpPerCapita never co-occur, same family, so
          // their mutual correlation is irrelevant.)
          gdp: GDP_LADDER[Math.floor(codeCounter / 7) % GDP_LADDER.length],
          elevation: ELEVATION_LADDER[Math.floor(codeCounter / 3) % ELEVATION_LADDER.length],
          coffee: CROP_LADDER[codeCounter % CROP_LADDER.length],
          wine: CROP_LADDER[codeCounter % CROP_LADDER.length],
          cocoa: CROP_LADDER[codeCounter % CROP_LADDER.length],
          banana: CROP_LADDER[codeCounter % CROP_LADDER.length],
          apple: APPLE_LADDER[codeCounter % APPLE_LADDER.length],
          rice: RICE_LADDER[codeCounter % RICE_LADDER.length],
          oil: FUEL_LADDER[codeCounter % FUEL_LADDER.length],
          coal: FUEL_LADDER[codeCounter % FUEL_LADDER.length],
          gold: GOLD_LADDER[codeCounter % GOLD_LADDER.length],
          honey: HONEY_LADDER[codeCounter % HONEY_LADDER.length],
          tea: TEA_LADDER[codeCounter % TEA_LADDER.length],
          sugarcane: SUGARCANE_LADDER[codeCounter % SUGARCANE_LADDER.length],
          oliveOil: CROP_LADDER[codeCounter % CROP_LADDER.length], // 5th crop, same >=1K/10K/100K breaks
          sheepPerCapita: SHEEP_LADDER[codeCounter % SHEEP_LADDER.length],
          cattlePerCapita: CATTLE_LADDER[codeCounter % CATTLE_LADDER.length],
          beerPerCapita: BEER_LADDER[codeCounter % BEER_LADDER.length],
          coastline: COASTLINE_LADDER[Math.floor(codeCounter / 4) % COASTLINE_LADDER.length],
          forest: FOREST_LADDER[Math.floor(codeCounter / 6) % FOREST_LADDER.length],
          gdpPerCapita: GDP_PER_CAPITA_LADDER[Math.floor(codeCounter++ / 5) % GDP_PER_CAPITA_LADDER.length],
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
          code: `c${codeCounter}`,
          name: `${cont}-multi${target}-${i}`,
          continent: cont,
          primaryColors: palette,
          motifs: [motif],
          population: POP_LADDER[codeCounter % POP_LADDER.length],
          area: AREA_LADDER[codeCounter % AREA_LADDER.length],
          density: DENSITY_LADDER[codeCounter % DENSITY_LADDER.length],
          // Decorrelate the two GDP ladders from pop/area/density (which all use
          // codeCounter % 6) via a slower counter, so cross-metric cells stay
          // fillable: real data isn't perfectly rank-correlated either, and the
          // generator otherwise burns its retry budget dodging empty gdp × area
          // style cells. (gdp + gdpPerCapita never co-occur, same family, so
          // their mutual correlation is irrelevant.)
          gdp: GDP_LADDER[Math.floor(codeCounter / 7) % GDP_LADDER.length],
          elevation: ELEVATION_LADDER[Math.floor(codeCounter / 3) % ELEVATION_LADDER.length],
          coffee: CROP_LADDER[codeCounter % CROP_LADDER.length],
          wine: CROP_LADDER[codeCounter % CROP_LADDER.length],
          cocoa: CROP_LADDER[codeCounter % CROP_LADDER.length],
          banana: CROP_LADDER[codeCounter % CROP_LADDER.length],
          apple: APPLE_LADDER[codeCounter % APPLE_LADDER.length],
          rice: RICE_LADDER[codeCounter % RICE_LADDER.length],
          oil: FUEL_LADDER[codeCounter % FUEL_LADDER.length],
          coal: FUEL_LADDER[codeCounter % FUEL_LADDER.length],
          gold: GOLD_LADDER[codeCounter % GOLD_LADDER.length],
          honey: HONEY_LADDER[codeCounter % HONEY_LADDER.length],
          tea: TEA_LADDER[codeCounter % TEA_LADDER.length],
          sugarcane: SUGARCANE_LADDER[codeCounter % SUGARCANE_LADDER.length],
          oliveOil: CROP_LADDER[codeCounter % CROP_LADDER.length], // 5th crop, same >=1K/10K/100K breaks
          sheepPerCapita: SHEEP_LADDER[codeCounter % SHEEP_LADDER.length],
          cattlePerCapita: CATTLE_LADDER[codeCounter % CATTLE_LADDER.length],
          beerPerCapita: BEER_LADDER[codeCounter % BEER_LADDER.length],
          coastline: COASTLINE_LADDER[Math.floor(codeCounter / 4) % COASTLINE_LADDER.length],
          forest: FOREST_LADDER[Math.floor(codeCounter / 6) % FOREST_LADDER.length],
          gdpPerCapita: GDP_PER_CAPITA_LADDER[Math.floor(codeCounter++ / 5) % GDP_PER_CAPITA_LADDER.length],
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

test('generateRandomPuzzle never repeats a world metric within one puzzle', () => {
  // Companion to the axesConflict guard: this covers the case axesConflict
  // misses — the same metric (population / area / density) appearing twice on
  // the *same* axis, which reads as redundant clutter to the player.
  //
  // maxAttempts is lifted above the production default (200) only here: this is
  // the widest seed sweep (30) over the synthetic pool, whose five identical-tier
  // crops make implied-pair rejections far denser than real data, so an unlucky
  // synthetic seed can drift near or past 200 as metrics are added (it swings with
  // each addition — a single metric can push one seed over while pulling another
  // back). This test pins the no-repeat *invariant*, not the retry budget — the
  // production 200-attempt budget is canaried on real countries.json in
  // countries.test.js's 30-seed sweep, which is the test that fails first if a
  // pool addition tightens real-data generation.
  const countries = syntheticTaggedCountries();
  for (let s = 1; s <= 30; s++) {
    const puzzle = generateRandomPuzzle(countries, { rng: mulberry32(s), maxAttempts: 500 });
    assert.equal(
      metricGroupRepeated(puzzle.rows, puzzle.cols),
      false,
      `seed ${s}: produced a puzzle repeating a world metric — rows=[${puzzle.rows.map((r) => r.id).join(',')}] cols=[${puzzle.cols.map((c) => c.id).join(',')}]`,
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

