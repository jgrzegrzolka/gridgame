import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  findTargets,
  findPool,
  classifyGuess,
  parseFilterString,
  serializeFilter,
  filterFromLegacyCat,
  parseFilterFromUrl,
  pillLabel,
  filterTitle,
  filterToCategory,
  pickRandomMix,
} from './findFlag.js';
import { categoryFromId } from './engine.js';
import { emptyFilters, matchesFilters } from './flagsFilter.js';
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
    primaryColors: [],
    motifs: [],
    ...fields,
  });
}

const FR = country({ code: 'fr', name: 'France', continent: 'Europe', primaryColors: ['red', 'white', 'blue'] });
const DE = country({ code: 'de', name: 'Germany', continent: 'Europe', primaryColors: ['black', 'red', 'yellow'] });
const KE = country({ code: 'ke', name: 'Kenya', continent: 'Africa', primaryColors: ['black', 'red', 'green', 'white'], motifs: ['weapon', 'coat-of-arms'] });
const JP = country({ code: 'jp', name: 'Japan', continent: 'Asia', primaryColors: ['white', 'red'] });
const EU = country({ code: 'eu', name: 'European Union', category: 'other', continent: null, primaryColors: ['blue', 'yellow'], motifs: ['star-or-moon'] });

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
  assert.equal(cat.predicate(country({ code: 'xx', name: 'X', primaryColors: ['blue'] })), false);
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

// Filter URL / category helpers — the chooser refactor lets the user mix
// multiple tags (include + exclude) and "play again" must round-trip those
// selections through the URL.

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

test('parseFilterString: bare colorCount:N parses as op=, n:N (back-compat with pre-op daily entries)', () => {
  const f = parseFilterString('continent:Europe,color:red,color:white,color:blue,colorCount:3');
  assert.ok(f);
  assert.deepEqual(f.colorCount, { op: '=', n: 3 });
  assert.deepEqual([...f.color.include], ['red','white','blue']);
});

test('parseFilterString: colorCount:=N parses as op=, n:N (explicit form)', () => {
  const f = parseFilterString('colorCount:=3');
  assert.ok(f);
  assert.deepEqual(f.colorCount, { op: '=', n: 3 });
});

test('parseFilterString: colorCount:>=N parses as op:>=, n:N', () => {
  const f = parseFilterString('colorCount:>=4');
  assert.ok(f);
  assert.deepEqual(f.colorCount, { op: '>=', n: 4 });
});

test('parseFilterString: colorCount:<=N parses as op:<=, n:N', () => {
  const f = parseFilterString('colorCount:<=2');
  assert.ok(f);
  assert.deepEqual(f.colorCount, { op: '<=', n: 2 });
});

test('parseFilterString: colorCount with non-integer or negative value is silently dropped', () => {
  assert.equal(parseFilterString('colorCount:'), null);
  assert.equal(parseFilterString('colorCount:abc'), null);
  assert.equal(parseFilterString('colorCount:-1'), null);
  assert.equal(parseFilterString('colorCount:>='), null);
  assert.equal(parseFilterString('colorCount:>=abc'), null);
  // colorCount:0 is legal (matches empty-palette entries) — token parses, filter is non-empty
  const f = parseFilterString('colorCount:0');
  assert.ok(f);
  assert.deepEqual(f.colorCount, { op: '=', n: 0 });
});

test('serializeFilter: round-trips bare colorCount form (= op emits bare for URL stability)', () => {
  const s = 'continent:Europe,color:red,color:white,color:blue,colorCount:3';
  const f = parseFilterString(s);
  assert.ok(f);
  assert.equal(serializeFilter(f), s);
});

test('serializeFilter: emits explicit colorCount:>=N form', () => {
  const f = parseFilterString('continent:Africa,colorCount:>=4');
  assert.ok(f);
  assert.equal(serializeFilter(f), 'continent:Africa,colorCount:>=4');
});

test('serializeFilter: emits explicit colorCount:<=N form', () => {
  const f = parseFilterString('continent:Europe,colorCount:<=2');
  assert.ok(f);
  assert.equal(serializeFilter(f), 'continent:Europe,colorCount:<=2');
});

test('filterFromLegacyCat: continent id maps to single-include filter', () => {
  const f = filterFromLegacyCat('continent:Africa');
  assert.ok(f);
  assert.deepEqual([...f.continent.include], ['Africa']);
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

test('pillLabel: include renders as the bare noun — no "Has " wrapper', () => {
  assert.equal(pillLabel('continent', 'Africa', 'include', idTranslate), 'Africa');
  assert.equal(pillLabel('color', 'orange', 'include', idTranslate), 'orange');
  assert.equal(pillLabel('motif', 'cross', 'include', idTranslate), 'cross');
});

test('pillLabel: exclude prefixes a lowercase "not " on the same bare noun', () => {
  assert.equal(pillLabel('continent', 'Africa', 'exclude', idTranslate), 'not Africa');
  assert.equal(pillLabel('color', 'orange', 'exclude', idTranslate), 'not orange');
  assert.equal(pillLabel('motif', 'cross', 'exclude', idTranslate), 'not cross');
});

test('filterTitle: joins selected pills with the interpunct separator in GROUP_ORDER', () => {
  const f = parseFilterString('continent:Africa,color:orange,motif:!cross');
  assert.ok(f);
  assert.equal(filterTitle(f, idTranslate), 'Africa · orange · not cross');
});

test('pillLabel: colorCount value "N" or "=N" renders as "only N colours"', () => {
  assert.equal(pillLabel('colorCount', '2', 'include', idTranslate), 'only 2 colours');
  assert.equal(pillLabel('colorCount', '=3', 'include', idTranslate), 'only 3 colours');
  // Sign is ignored for colorCount — the primitive is scalar, "exclude" makes
  // no sense, so the renderer just returns the include form.
  assert.equal(pillLabel('colorCount', '3', 'exclude', idTranslate), 'only 3 colours');
});

test('pillLabel: colorCount value ">=N" renders as "N or more colours"', () => {
  assert.equal(pillLabel('colorCount', '>=4', 'include', idTranslate), '4 or more colours');
  assert.equal(pillLabel('colorCount', '>=5', 'exclude', idTranslate), '5 or more colours');
});

test('pillLabel: colorCount value "<=N" renders as "N or fewer colours"', () => {
  assert.equal(pillLabel('colorCount', '<=2', 'include', idTranslate), '2 or fewer colours');
  assert.equal(pillLabel('colorCount', '<=3', 'exclude', idTranslate), '3 or fewer colours');
});

test('filterTitle: appends "only N colours" when colorCount is set with op =', () => {
  const f = parseFilterString('continent:Europe,color:red,color:white,color:blue,colorCount:3');
  assert.ok(f);
  assert.equal(filterTitle(f, idTranslate), 'Europe · red · white · blue · only 3 colours');
});

test('filterTitle: appends "N or more colours" when colorCount is set with op >=', () => {
  const f = parseFilterString('continent:Africa,colorCount:>=4');
  assert.ok(f);
  assert.equal(filterTitle(f, idTranslate), 'Africa · 4 or more colours');
});

test('filterTitle: appends "N or fewer colours" when colorCount is set with op <=', () => {
  const f = parseFilterString('continent:Europe,colorCount:<=2');
  assert.ok(f);
  assert.equal(filterTitle(f, idTranslate), 'Europe · 2 or fewer colours');
});

test('filterTitle: colorCount with no other tokens renders as just the count phrase', () => {
  const f = parseFilterString('colorCount:2');
  assert.ok(f);
  assert.equal(filterTitle(f, idTranslate), 'only 2 colours');
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
  assert.equal(filterToCategory(f, idTranslate).label, 'Africa · orange');
});

test('filterToCategory: id encodes the serialized filter (stable across equal filters)', () => {
  const a = parseFilterString('continent:Africa,color:orange');
  const b = parseFilterString('color:orange,continent:Africa');
  assert.ok(a && b);
  assert.equal(filterToCategory(a, idTranslate).id, filterToCategory(b, idTranslate).id,
    'serialize iterates groups in fixed order — equal filters share an id regardless of input order');
});

// pickRandomMix — the Random button's brain. Tests inject a deterministic
// RNG so the weighted-N and pill-pick paths are pinned, and tests use the
// SAMPLE pool (5 countries) plus the pillPool shape the chooser builds.

/**
 * Counter-based RNG that walks a fixed sequence of values, looping when
 * it runs out. Lets a test fix the bytes pickRandomMix consumes.
 *
 * @param {number[]} seq
 * @returns {() => number}
 */
function rngFromSeq(seq) {
  let i = 0;
  return () => {
    const v = seq[i % seq.length];
    i++;
    return v;
  };
}

const PILL_POOL = /** @type {Array<{ group: 'continent' | 'color' | 'motif', value: string }>} */ ([
  { group: 'continent', value: 'Europe' },
  { group: 'continent', value: 'Africa' },
  { group: 'continent', value: 'Asia' },
  { group: 'color', value: 'red' },
  { group: 'color', value: 'white' },
  { group: 'color', value: 'blue' },
  { group: 'motif', value: 'weapon' },
  { group: 'motif', value: 'star-or-moon' },
]);

/** @param {ReturnType<typeof emptyFilters>} f */
function pillCount(f) {
  let n = 0;
  for (const k of /** @type {Array<'status'|'continent'|'color'|'motif'>} */ (['status','continent','color','motif'])) {
    n += f[k].include.size + f[k].exclude.size;
  }
  return n;
}

test('pickRandomMix: always emits 2-4 pills, never 1', () => {
  // Property check across many seeds — Random should never deliver a
  // single-pill mix (that's what clicking a pill in the chooser does).
  // Range cap of 4 is enforced by pickMixSize.
  for (let seed = 0; seed < 100; seed++) {
    let i = 0;
    const rng = () => {
      const v = ((seed * 7 + i * 13) % 100) / 100;
      i++;
      return v;
    };
    const f = pickRandomMix(PILL_POOL, SAMPLE, { rng });
    const n = pillCount(f);
    assert.ok(n >= 2 && n <= 4,
      `seed ${seed}: expected 2-4 pills, got ${n}`);
  }
});

test('pickRandomMix: at most one pill per scalar group (continent), arrays may repeat', () => {
  // Continent/status are scalar — two values AND-ed = unsatisfiable —
  // so the picker must cap them at 1. Colors and motifs are arrays so
  // multi-pill within them is fine (and is how 4-pill mixes get built
  // when the pool only has 3 groups).
  for (let seed = 0; seed < 50; seed++) {
    let i = 0;
    const rng = () => {
      const v = ((seed * 11 + i * 17) % 100) / 100;
      i++;
      return v;
    };
    const f = pickRandomMix(PILL_POOL, SAMPLE, { rng });
    assert.ok(f.continent.include.size + f.continent.exclude.size <= 1,
      `seed ${seed}: continent should have at most one pill`);
    assert.ok(f.status.include.size + f.status.exclude.size <= 1,
      `seed ${seed}: status should have at most one pill`);
  }
});

test('pickRandomMix: result intersection is >= minIntersection when achievable', () => {
  // SAMPLE has 4 red-colored countries (fr, de, ke, jp). Default
  // minIntersection=1 — the picker should land on something playable
  // on most attempts. We don't pin which mix — we pin the property.
  for (let seed = 0; seed < 30; seed++) {
    let i = 0;
    const rng = () => {
      const v = ((seed * 7 + i * 13) % 100) / 100;
      i++;
      return v;
    };
    const f = pickRandomMix(PILL_POOL, SAMPLE, { rng });
    const matchCount = SAMPLE.filter((c) => matchesFilters(c, f)).length;
    assert.ok(matchCount >= 1,
      `seed ${seed}: random mix should produce a non-empty intersection (got ${matchCount})`);
  }
});

test('pickRandomMix: fallback after exhausted attempts still keeps 2+ pills', () => {
  // Force minIntersection above what any filter on SAMPLE can satisfy.
  // After maxAttempts retries the picker returns the last attempt as-is
  // — which by construction had 2+ pills. The "never 1" invariant
  // survives even the unhappy path.
  const rng = rngFromSeq([0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5]);
  const f = pickRandomMix(PILL_POOL, SAMPLE, {
    rng,
    minIntersection: 999,
    maxAttempts: 3,
  });
  assert.ok(pillCount(f) >= 2, `fallback should still have 2+ pills, got ${pillCount(f)}`);
});

test('pickRandomMix: empty pill pool returns an empty filter (no crash, no random pick)', () => {
  const f = pickRandomMix([], SAMPLE, { minIntersection: 1, maxAttempts: 1 });
  assert.equal(pillCount(f), 0);
});

test('pickRandomMix: single-pill pool returns empty filter (can\'t form a 2+ mix)', () => {
  // A pool with only one pill can't satisfy the "never 1" rule — we
  // return empty so the caller bounces back to the chooser rather
  // than start a single-pill round dressed as Random.
  const f = pickRandomMix([{ group: 'color', value: 'red' }], SAMPLE);
  assert.equal(pillCount(f), 0);
});

test('pickRandomMix: excludeProbability=0 forces include-only', () => {
  for (let seed = 0; seed < 30; seed++) {
    let i = 0;
    const rng = () => {
      const v = ((seed * 13 + i * 19) % 100) / 100;
      i++;
      return v;
    };
    const f = pickRandomMix(PILL_POOL, SAMPLE, { rng, excludeProbability: 0 });
    for (const k of /** @type {Array<'status'|'continent'|'color'|'motif'>} */ (['status','continent','color','motif'])) {
      assert.equal(f[k].exclude.size, 0,
        `seed ${seed} group ${k}: excludeProbability=0 should produce no excludes`);
    }
  }
});

test('pickRandomMix: excludeProbability=1 flips every pill to exclude', () => {
  for (let seed = 0; seed < 30; seed++) {
    let i = 0;
    const rng = () => {
      const v = ((seed * 17 + i * 23) % 100) / 100;
      i++;
      return v;
    };
    const f = pickRandomMix(PILL_POOL, SAMPLE, {
      rng,
      excludeProbability: 1,
      minIntersection: 0, // exclude-only mixes may still match — but don't require it
    });
    for (const k of /** @type {Array<'status'|'continent'|'color'|'motif'>} */ (['status','continent','color','motif'])) {
      assert.equal(f[k].include.size, 0,
        `seed ${seed} group ${k}: excludeProbability=1 should produce no includes`);
    }
  }
});

