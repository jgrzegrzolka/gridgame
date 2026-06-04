import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  categoryFromId,
  findTargets,
  findPool,
  classifyGuess,
  bestKey,
  loadBest,
  saveBest,
  recordFindResult,
  shouldFireFindFlagConfetti,
  parseFilterString,
  serializeFilter,
  filterFromLegacyCat,
  parseFilterFromUrl,
  isRankedFilter,
  rankedCategoryId,
  pillLabel,
  filterTitle,
  filterToCategory,
} from './findFlag.js';
import { emptyFilters, matchesFilters } from './flagsFilter.js';

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
    colors: [],
    motifs: [],
    ...fields,
  };
}

const FR = country({ code: 'fr', name: 'France', continent: 'Europe', colors: ['red', 'white', 'blue'] });
const DE = country({ code: 'de', name: 'Germany', continent: 'Europe', colors: ['black', 'red', 'yellow'] });
const KE = country({ code: 'ke', name: 'Kenya', continent: 'Africa', colors: ['black', 'red', 'green', 'white'], motifs: ['weapon', 'coat-of-arms'] });
const JP = country({ code: 'jp', name: 'Japan', continent: 'Asia', colors: ['white', 'red'] });
const EU = country({ code: 'eu', name: 'European Union', category: 'other', continent: null, colors: ['blue', 'yellow'], motifs: ['star-or-moon'] });

const SAMPLE = [FR, DE, KE, JP, EU];

test('categoryFromId parses a continent id', () => {
  const cat = categoryFromId('continent:Africa');
  assert.ok(cat);
  assert.equal(cat.id, 'continent:Africa');
  assert.equal(cat.label, 'Africa');
  assert.equal(cat.predicate(KE), true);
  assert.equal(cat.predicate(FR), false);
});

test('categoryFromId parses a hasColor id', () => {
  const cat = categoryFromId('hasColor:red');
  assert.ok(cat);
  assert.equal(cat.id, 'hasColor:red');
  assert.equal(cat.predicate(FR), true);
  assert.equal(cat.predicate(country({ code: 'xx', name: 'X', colors: ['blue'] })), false);
});

test('categoryFromId parses a hasMotif id', () => {
  const cat = categoryFromId('hasMotif:weapon');
  assert.ok(cat);
  assert.equal(cat.id, 'hasMotif:weapon');
  assert.equal(cat.predicate(KE), true);
  assert.equal(cat.predicate(FR), false);
});

test('categoryFromId returns null for an unknown id prefix', () => {
  assert.equal(categoryFromId('bogus:thing'), null);
  assert.equal(categoryFromId(''), null);
  assert.equal(categoryFromId(undefined), null);
  assert.equal(categoryFromId(null), null);
});

test('findTargets returns every entry matching the predicate — scope is applied upstream', () => {
  const cat = categoryFromId('hasMotif:star-or-moon');
  assert.ok(cat);
  // EU is category=other but has the motif — engine no longer filters scope,
  // so it appears here; pages filter via flagsGamePool before calling.
  const targets = findTargets(SAMPLE, cat);
  assert.deepEqual(targets.map((c) => c.code), ['eu']);

  const redCat = categoryFromId('hasColor:red');
  assert.ok(redCat);
  const redTargets = findTargets(SAMPLE, redCat);
  assert.deepEqual(redTargets.map((c) => c.code), ['fr', 'de', 'ke', 'jp']);
});

test('findPool is a pass-through (scope is applied upstream via flagsGamePool)', () => {
  const pool = findPool(SAMPLE);
  assert.deepEqual(pool.map((c) => c.code), ['fr', 'de', 'ke', 'jp', 'eu']);
});

test('classifyGuess returns "match" for an unfound target', () => {
  const state = { targetCodes: new Set(['fr', 'de']), foundCodes: new Set() };
  assert.equal(classifyGuess(state, FR).kind, 'match');
});

test('classifyGuess returns "duplicate" for a target that\'s already been found', () => {
  const state = { targetCodes: new Set(['fr', 'de']), foundCodes: new Set(['fr']) };
  assert.equal(classifyGuess(state, FR).kind, 'duplicate');
});

test('classifyGuess returns "wrong-category" for a real country that isn\'t a target', () => {
  const state = { targetCodes: new Set(['fr', 'de']), foundCodes: new Set() };
  assert.equal(classifyGuess(state, KE).kind, 'wrong-category');
});

test('classifyGuess returns "unknown" for null / undefined', () => {
  const state = { targetCodes: new Set(['fr']), foundCodes: new Set() };
  assert.equal(classifyGuess(state, null).kind, 'unknown');
  assert.equal(classifyGuess(state, undefined).kind, 'unknown');
});

test('bestKey produces the expected namespaced format', () => {
  assert.equal(bestKey('continent:Africa'), 'findflag.best.continent:Africa');
  assert.equal(bestKey('hasMotif:weapon'), 'findflag.best.hasMotif:weapon');
});

test('bestKey appends .all suffix when includeAll is true', () => {
  assert.equal(bestKey('continent:Europe', true), 'findflag.best.continent:Europe.all');
  assert.equal(bestKey('continent:Europe', false), 'findflag.best.continent:Europe');
});

/**
 * @returns {{
 *   getItem(key: string): string | null,
 *   setItem(key: string, value: string): void,
 *   _dump(): { [k: string]: string },
 * }}
 */
function makeStore() {
  /** @type {Map<string, string>} */
  const map = new Map();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => { map.set(k, v); },
    _dump: () => Object.fromEntries(map.entries()),
  };
}

test('loadBest returns null when the key is missing', () => {
  const store = makeStore();
  assert.equal(loadBest(store, 'continent:Africa'), null);
});

test('loadBest round-trips through saveBest', () => {
  const store = makeStore();
  saveBest(store, 'continent:Africa', { time: 60_000, found: 12, total: 13 });
  assert.deepEqual(loadBest(store, 'continent:Africa'), {
    time: 60_000,
    found: 12,
    total: 13,
  });
});

test('loadBest returns null when the stored value is unparseable', () => {
  const store = makeStore();
  store.setItem(bestKey('continent:Africa'), '{not json');
  assert.equal(loadBest(store, 'continent:Africa'), null);
});

test('loadBest returns null when the stored shape is wrong', () => {
  const store = makeStore();
  store.setItem(bestKey('continent:Africa'), JSON.stringify({ time: '60' }));
  assert.equal(loadBest(store, 'continent:Africa'), null);
});

test('recordFindResult saves and reports isNew on an empty slot', () => {
  const store = makeStore();
  const { best, isNew } = recordFindResult(store, 'continent:Africa', {
    time: 60_000, found: 12, total: 13,
  });
  assert.equal(isNew, true);
  assert.equal(best.time, 60_000);
  assert.equal(best.found, 12);
});

test('recordFindResult prefers a higher "found" count even if time is longer', () => {
  const store = makeStore();
  recordFindResult(store, 'continent:Africa', { time: 30_000, found: 10, total: 13 });
  const { best, isNew } = recordFindResult(store, 'continent:Africa', {
    time: 90_000, found: 11, total: 13,
  });
  assert.equal(isNew, true);
  assert.equal(best.found, 11);
  assert.equal(best.time, 90_000);
});

test('recordFindResult prefers a faster time when "found" ties', () => {
  const store = makeStore();
  recordFindResult(store, 'continent:Africa', { time: 90_000, found: 13, total: 13 });
  const { best, isNew } = recordFindResult(store, 'continent:Africa', {
    time: 60_000, found: 13, total: 13,
  });
  assert.equal(isNew, true);
  assert.equal(best.time, 60_000);
});

test('recordFindResult does NOT save when the run is worse', () => {
  const store = makeStore();
  recordFindResult(store, 'continent:Africa', { time: 60_000, found: 13, total: 13 });
  const before = store._dump();
  const { best, isNew } = recordFindResult(store, 'continent:Africa', {
    time: 120_000, found: 12, total: 13,
  });
  assert.equal(isNew, false);
  assert.equal(best.found, 13);
  assert.equal(best.time, 60_000);
  assert.deepEqual(store._dump(), before);
});

test('saveBest is a no-op when the store throws (no crash)', () => {
  const throwingStore = {
    setItem: () => { throw new Error('quota'); },
    getItem: () => null,
  };
  assert.doesNotThrow(() =>
    saveBest(throwingStore, 'continent:Africa', { time: 1, found: 1, total: 1 }),
  );
});

test('loadBest does not throw when the store throws', () => {
  const throwingStore = {
    getItem: () => { throw new Error('disabled'); },
    setItem: () => {},
  };
  assert.equal(loadBest(throwingStore, 'continent:Africa'), null);
});

// shouldFireFindFlagConfetti
// Rule: clean sweep (found === total) celebrates even without a record;
// new record fires too, so a partial give-up that still beat the prior
// best earns confetti.

test('shouldFireFindFlagConfetti: clean sweep fires even when not a new record', () => {
  assert.equal(shouldFireFindFlagConfetti({ found: 10, total: 10, isNew: false }), true,
    'finding every flag gets confetti even if a prior run was faster');
  assert.equal(shouldFireFindFlagConfetti({ found: 10, total: 10, isNew: true }), true);
});

test('shouldFireFindFlagConfetti: new record fires even on a partial finish', () => {
  assert.equal(shouldFireFindFlagConfetti({ found: 7, total: 10, isNew: true }), true,
    'beating your previous best earns confetti even after a give-up');
});

test('shouldFireFindFlagConfetti: partial finish without a new record does NOT fire', () => {
  assert.equal(shouldFireFindFlagConfetti({ found: 7, total: 10, isNew: false }), false);
  assert.equal(shouldFireFindFlagConfetti({ found: 0, total: 10, isNew: false }), false);
});

test('shouldFireFindFlagConfetti: zero-target degenerate case fires on the trivial sweep', () => {
  assert.equal(shouldFireFindFlagConfetti({ found: 0, total: 0, isNew: false }), true,
    'found === total when both are 0 still counts as "all found"');
});

// Filter URL / category helpers — the chooser refactor lets the user mix
// multiple tags (include + exclude) and "play again" must round-trip those
// selections through the URL, while single-pill plays still hit the same
// best-score storage slot as the pre-refactor chooser.

/** Identity translator used by tests so we can pin English fallback labels. */
const idTranslate = (/** @type {string} */ _k, /** @type {string} */ fallback) => fallback;

test('parseFilterString: single include parses to one-pill filter', () => {
  const f = parseFilterString('continent:Africa');
  assert.ok(f);
  assert.deepEqual([...f.continent.include], ['Africa']);
  assert.equal(f.continent.exclude.size, 0);
});

test('parseFilterString: mixed include + exclude across groups', () => {
  const f = parseFilterString('continent:Africa,color:orange,motif:!cross');
  assert.ok(f);
  assert.deepEqual([...f.continent.include], ['Africa']);
  assert.deepEqual([...f.color.include], ['orange']);
  assert.deepEqual([...f.motif.exclude], ['cross']);
  assert.equal(f.motif.include.size, 0);
});

test('parseFilterString: multiple values in one group accumulate', () => {
  const f = parseFilterString('color:red,color:blue,color:!green');
  assert.ok(f);
  assert.deepEqual([...f.color.include].sort(), ['blue', 'red']);
  assert.deepEqual([...f.color.exclude], ['green']);
});

test('parseFilterString: continent name with spaces survives intact', () => {
  const f = parseFilterString('continent:North America');
  assert.ok(f);
  assert.deepEqual([...f.continent.include], ['North America']);
});

test('parseFilterString: returns null for empty / malformed / unknown-group input', () => {
  assert.equal(parseFilterString(''), null);
  assert.equal(parseFilterString(','), null);
  assert.equal(parseFilterString('garbage'), null);
  assert.equal(parseFilterString('garbage:something'), null,
    'unknown group is silently dropped — null when nothing else parses');
  assert.equal(parseFilterString('continent:'), null,
    'empty value after sign is not a valid token');
});

test('serializeFilter: round-trips parseFilterString deterministically', () => {
  const s = 'continent:Africa,color:orange,color:!blue,motif:!cross';
  const f = parseFilterString(s);
  assert.ok(f);
  assert.equal(serializeFilter(f), s);
});

test('serializeFilter: empty filter serializes to empty string', () => {
  assert.equal(serializeFilter(emptyFilters()), '');
});

test('filterFromLegacyCat: continent id maps to single-include filter', () => {
  const f = filterFromLegacyCat('continent:Africa');
  assert.ok(f);
  assert.deepEqual([...f.continent.include], ['Africa']);
  assert.equal(isRankedFilter(f), true);
});

test('filterFromLegacyCat: hasColor / hasMotif / statehood prefixes route to the right group', () => {
  const red = filterFromLegacyCat('hasColor:red');
  assert.ok(red);
  assert.deepEqual([...red.color.include], ['red']);

  const star = filterFromLegacyCat('hasMotif:star-or-moon');
  assert.ok(star);
  assert.deepEqual([...star.motif.include], ['star-or-moon']);

  const sov = filterFromLegacyCat('statehood:sovereign');
  assert.ok(sov);
  assert.deepEqual([...sov.status.include], ['sovereign']);
});

test('filterFromLegacyCat: unknown prefix returns null', () => {
  assert.equal(filterFromLegacyCat('bogus:whatever'), null);
});

test('parseFilterFromUrl: prefers the new f= form over legacy cat=', () => {
  const f = parseFilterFromUrl('?f=continent:Asia&cat=continent:Africa');
  assert.ok(f);
  assert.deepEqual([...f.continent.include], ['Asia'],
    'f= wins when both are present, so updated URLs reflect new behavior');
});

test('parseFilterFromUrl: falls back to legacy cat= when f= is missing or unparseable', () => {
  const f = parseFilterFromUrl('?cat=hasColor:red');
  assert.ok(f);
  assert.deepEqual([...f.color.include], ['red']);

  const f2 = parseFilterFromUrl('?f=&cat=continent:Africa');
  assert.ok(f2);
  assert.deepEqual([...f2.continent.include], ['Africa']);
});

test('parseFilterFromUrl: returns null when neither param yields a filter', () => {
  assert.equal(parseFilterFromUrl(''), null);
  assert.equal(parseFilterFromUrl('?other=1'), null);
});

test('isRankedFilter: single include only is ranked', () => {
  const f = emptyFilters();
  f.continent.include.add('Africa');
  assert.equal(isRankedFilter(f), true);
});

test('isRankedFilter: any exclude makes it unranked', () => {
  const f = emptyFilters();
  f.continent.include.add('Africa');
  f.color.exclude.add('blue');
  assert.equal(isRankedFilter(f), false);
});

test('isRankedFilter: two includes (mix) is unranked', () => {
  const f = emptyFilters();
  f.continent.include.add('Africa');
  f.color.include.add('orange');
  assert.equal(isRankedFilter(f), false);
});

test('isRankedFilter: empty filter is unranked (no category to record under)', () => {
  assert.equal(isRankedFilter(emptyFilters()), false);
});

test('rankedCategoryId: returns the legacy id format so best-score storage stays compatible', () => {
  const africa = emptyFilters();
  africa.continent.include.add('Africa');
  assert.equal(rankedCategoryId(africa), 'continent:Africa');

  const red = emptyFilters();
  red.color.include.add('red');
  assert.equal(rankedCategoryId(red), 'hasColor:red',
    'color group maps back to the hasColor: prefix so old "best" keys still resolve');

  const cross = emptyFilters();
  cross.motif.include.add('cross');
  assert.equal(rankedCategoryId(cross), 'hasMotif:cross');
});

test('rankedCategoryId: returns null for unranked filters', () => {
  const mix = emptyFilters();
  mix.continent.include.add('Africa');
  mix.color.include.add('orange');
  assert.equal(rankedCategoryId(mix), null);
});

test('pillLabel: include uses the same English wording the old chooser did', () => {
  assert.equal(pillLabel('continent', 'Africa', 'include', idTranslate), 'Africa');
  assert.equal(pillLabel('color', 'orange', 'include', idTranslate), 'Has orange');
  assert.equal(pillLabel('motif', 'cross', 'include', idTranslate), 'Has cross');
});

test('pillLabel: exclude prefixes "Not " and drops the "Has " for colors/motifs', () => {
  assert.equal(pillLabel('continent', 'Africa', 'exclude', idTranslate), 'Not Africa');
  assert.equal(pillLabel('color', 'orange', 'exclude', idTranslate), 'Not orange',
    '"Not Has orange" would read awkwardly — drop the auxiliary');
  assert.equal(pillLabel('motif', 'cross', 'exclude', idTranslate), 'Not cross');
});

test('filterTitle: joins selected pills with the interpunct separator in GROUP_ORDER', () => {
  const f = parseFilterString('continent:Africa,color:orange,motif:!cross');
  assert.ok(f);
  assert.equal(filterTitle(f, idTranslate), 'Africa · Has orange · Not cross');
});

test('filterTitle: empty filter renders to empty string', () => {
  assert.equal(filterTitle(emptyFilters(), idTranslate), '');
});

test('filterToCategory: predicate matches matchesFilters exactly', () => {
  const f = parseFilterString('continent:Africa,color:red');
  assert.ok(f);
  const cat = filterToCategory(f, idTranslate);
  // KE is Africa+red; FR is Europe+red (continent fails); JP is Asia+red (continent fails);
  // DE is Europe+red (continent fails)
  assert.equal(cat.predicate(KE), true);
  assert.equal(cat.predicate(FR), false);
  assert.equal(cat.predicate(JP), false);
  // Sanity: predicate result agrees with matchesFilters on the same filter
  for (const c of SAMPLE) {
    assert.equal(cat.predicate(c), matchesFilters(c, f),
      `${c.code}: predicate must equal matchesFilters`);
  }
});

test('filterToCategory: label is the human-readable filterTitle', () => {
  const f = parseFilterString('continent:Africa,color:orange');
  assert.ok(f);
  assert.equal(filterToCategory(f, idTranslate).label, 'Africa · Has orange');
});

test('filterToCategory: id encodes the serialized filter (stable across equal filters)', () => {
  const a = parseFilterString('continent:Africa,color:orange');
  const b = parseFilterString('color:orange,continent:Africa');
  assert.ok(a && b);
  assert.equal(filterToCategory(a, idTranslate).id, filterToCategory(b, idTranslate).id,
    'serialize iterates groups in fixed order — equal filters share an id regardless of input order');
});

