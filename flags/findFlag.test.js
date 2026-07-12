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
import { categoryFromId, POPULATION_BREAKS_FOR_RANDOM, AREA_BREAKS_FOR_RANDOM, DENSITY_BREAKS_FOR_RANDOM, GDP_BREAKS_FOR_RANDOM, GDP_PER_CAPITA_BREAKS_FOR_RANDOM, COFFEE_BREAKS_FOR_RANDOM } from './engine.js';
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

const FR = country({ code: 'fr', name: 'France', continent: 'Europe', primaryColors: ['red', 'white', 'blue'], stripesOnly: 'vertical' });
const DE = country({ code: 'de', name: 'Germany', continent: 'Europe', primaryColors: ['black', 'red', 'yellow'], stripesOnly: 'horizontal' });
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

test('parseFilterString: stripesOnly include/exclude tokens land in the right group', () => {
  const f = parseFilterString('continent:Europe,stripesOnly:horizontal');
  assert.ok(f);
  assert.deepEqual([...f.stripesOnly.include], ['horizontal']);
  assert.equal(f.stripesOnly.exclude.size, 0);

  const g = parseFilterString('stripesOnly:!vertical');
  assert.ok(g);
  assert.deepEqual([...g.stripesOnly.exclude], ['vertical']);
  assert.equal(g.stripesOnly.include.size, 0);
});

test('serializeFilter: round-trips a stripesOnly filter deterministically', () => {
  const s = 'continent:Europe,stripesOnly:horizontal';
  const f = parseFilterString(s);
  assert.ok(f);
  assert.equal(serializeFilter(f), s);
});

test('filterFromLegacyCat: stripesOnly:<orientation> hydrates to a single-include filter', () => {
  const f = filterFromLegacyCat('stripesOnly:vertical');
  assert.ok(f);
  assert.deepEqual([...f.stripesOnly.include], ['vertical']);
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

test('pillLabel: exclude uses the genitive override when one exists, falling back to the base noun', () => {
  // Polish "bez " governs the genitive — "bez niebieskiego", not "bez
  // niebieski". A translate table that supplies colorExclude/motifExclude
  // entries must feed those into the prefixed label; values without an
  // override (here: green) degrade to the nominative form.
  const plTranslate = (/** @type {string} */ k, /** @type {string} */ fallback) =>
    ({
      'findFlag.notPrefix': 'bez ',
      'color.blue': 'niebieski',
      'colorExclude.blue': 'niebieskiego',
      'color.green': 'zielony',
      'motif.cross': 'krzyż',
      'motifExclude.cross': 'krzyża',
    })[k] ?? fallback;
  assert.equal(pillLabel('color', 'blue', 'exclude', plTranslate), 'bez niebieskiego');
  assert.equal(pillLabel('motif', 'cross', 'exclude', plTranslate), 'bez krzyża');
  // green has no colorExclude override here → falls back to the nominative
  assert.equal(pillLabel('color', 'green', 'exclude', plTranslate), 'bez zielony');
});

test('pillLabel: stripesOnly renders the baked English fallback when no translation is supplied', () => {
  // No translation table → idTranslate returns the fallback the renderer
  // hands it (`"<orientation> stripes only"`).
  assert.equal(pillLabel('stripesOnly', 'horizontal', 'include', idTranslate), 'horizontal stripes only');
  assert.equal(pillLabel('stripesOnly', 'vertical', 'exclude', idTranslate), 'not vertical stripes only');
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

const PILL_POOL = /** @type {Array<{ group: 'continent' | 'color' | 'motif' | 'stripesOnly', value: string }>} */ ([
  { group: 'continent', value: 'Europe' },
  { group: 'continent', value: 'Africa' },
  { group: 'continent', value: 'Asia' },
  { group: 'color', value: 'red' },
  { group: 'color', value: 'white' },
  { group: 'color', value: 'blue' },
  { group: 'motif', value: 'weapon' },
  { group: 'motif', value: 'star-or-moon' },
  { group: 'stripesOnly', value: 'horizontal' },
  { group: 'stripesOnly', value: 'vertical' },
]);

/** @param {ReturnType<typeof emptyFilters>} f */
function pillCount(f) {
  let n = 0;
  for (const k of /** @type {Array<'status'|'continent'|'color'|'motif'|'stripesOnly'>} */ (['status','continent','color','motif','stripesOnly'])) {
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

test('pickRandomMix: at most one pill per scalar group (continent / stripesOnly), arrays may repeat', () => {
  // Continent/status/stripesOnly are scalar — two values AND-ed =
  // unsatisfiable — so the picker must cap them at 1. Colors and motifs
  // are arrays so multi-pill within them is fine (and is how 4-pill mixes
  // get built when the pool only has a few scalar groups).
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
    assert.ok(f.stripesOnly.include.size + f.stripesOnly.exclude.size <= 1,
      `seed ${seed}: stripesOnly should have at most one pill`);
  }
});

test('pickRandomMix: stripesOnly + colorCount are mutually exclusive — colorCount stays null when a stripesOnly pill lands in the mix', () => {
  // A pure-stripes flag has a tight palette (usually 2 or 3 colours), so
  // layering colorCount on top either restates the palette or collapses
  // the answer set. The picker skips the colorCount paths entirely when
  // the mix already constrains stripesOnly, even at probability=1.
  //
  // Force stripesOnly into every mix by passing a pool that has nothing
  // ELSE but stripesOnly + continents (so picks always include stripes).
  // Run 50 seeds with both modifier probabilities pinned at 1.
  const POOL_FORCING_STRIPES = /** @type {Array<{ group: 'continent' | 'stripesOnly', value: string }>} */ ([
    { group: 'continent', value: 'Europe' },
    { group: 'continent', value: 'Africa' },
    { group: 'stripesOnly', value: 'horizontal' },
    { group: 'stripesOnly', value: 'vertical' },
  ]);
  let mixesWithStripes = 0;
  for (let seed = 0; seed < 50; seed++) {
    let i = 0;
    const rng = () => {
      const v = ((seed * 11 + i * 17) % 100) / 100;
      i++;
      return v;
    };
    const f = pickRandomMix(POOL_FORCING_STRIPES, SAMPLE, {
      rng,
      onlyColorsProbability: 1,
      colorCountProbability: 1,
      excludeProbability: 0,
    });
    const hasStripes = f.stripesOnly.include.size + f.stripesOnly.exclude.size > 0;
    if (hasStripes) {
      mixesWithStripes++;
      assert.equal(f.colorCount, null,
        `seed ${seed}: stripesOnly + colorCount must be mutually exclusive — got colorCount=${JSON.stringify(f.colorCount)}`);
    }
  }
  // Pool is 4 entries (2 continents + 2 stripes) and pickMixSize picks
  // 2-4 pills with scalar deduplication — every mix lands on a stripes
  // pill. If this ever stops being true the assertion above goes
  // vacuous, so guard the test by requiring the path was actually
  // exercised.
  assert.ok(mixesWithStripes >= 30,
    `expected most of 50 seeds to land on a stripes pill — only got ${mixesWithStripes}`);
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

// ---- colorCount modifier paths ----

test('pickRandomMix: onlyColorsProbability=1 locks colorCount to the include-colour count whenever colours are picked', () => {
  // The "no other colours" path produces { op: '=', n: <include colours> },
  // matching what the chooser's lock toggle writes. Asserting the value
  // shape here pins the contract — the live chooser reads colorCount
  // on URL load and decides which UI control to highlight.
  for (let seed = 0; seed < 50; seed++) {
    let i = 0;
    const rng = () => {
      const v = ((seed * 11 + i * 29) % 100) / 100;
      i++;
      return v;
    };
    const f = pickRandomMix(PILL_POOL, SAMPLE, {
      rng,
      excludeProbability: 0, // forces include — guarantees at least 1 include colour appears in a colour-heavy seed
      onlyColorsProbability: 1,
      colorCountProbability: 0,
    });
    const hasStripes = f.stripesOnly.include.size + f.stripesOnly.exclude.size > 0;
    if (hasStripes) {
      // stripesOnly + colorCount are mutually exclusive (Phase 4) — the
      // modifier paths are skipped entirely when the mix already carries
      // a stripesOnly pill, regardless of whether colours are present.
      assert.equal(f.colorCount, null,
        `seed ${seed}: stripesOnly in mix should skip colorCount, got ${JSON.stringify(f.colorCount)}`);
    } else if (f.color.include.size > 0) {
      assert.deepEqual(
        f.colorCount,
        { op: '=', n: f.color.include.size },
        `seed ${seed}: colorCount should be =${f.color.include.size}, got ${JSON.stringify(f.colorCount)}`,
      );
    } else {
      // No include colours in this seed's mix → "only colours" path
      // can't fire (it's a colour-conditional modifier).
      assert.equal(f.colorCount, null,
        `seed ${seed}: colorCount should stay null when no colours are in the mix`);
    }
  }
});

test('pickRandomMix: onlyColorsProbability=1 never attaches colorCount when no colour pills are in the include set', () => {
  // Modifier is colour-conditional. Without an include colour, even
  // probability=1 must not fire — there's no count to lock.
  const noColorsPool = /** @type {typeof PILL_POOL} */ ([
    { group: 'continent', value: 'Europe' },
    { group: 'continent', value: 'Africa' },
    { group: 'motif', value: 'weapon' },
    { group: 'motif', value: 'star-or-moon' },
  ]);
  for (let seed = 0; seed < 30; seed++) {
    let i = 0;
    const rng = () => {
      const v = ((seed * 5 + i * 7) % 100) / 100;
      i++;
      return v;
    };
    const f = pickRandomMix(noColorsPool, SAMPLE, {
      rng,
      onlyColorsProbability: 1,
      colorCountProbability: 0,
      minIntersection: 0,
    });
    assert.equal(f.colorCount, null,
      `seed ${seed}: no colours in pool → colorCount must stay null`);
  }
});

test('pickRandomMix: colorCountProbability=1 attaches a picker-shaped colorCount even with no colours in the mix', () => {
  // Independent path uses the picker's COLOR_COUNT_OPS × COLOR_COUNT_NS.
  // Asserting op ∈ {=, >=, <=} and n ∈ {2..5} pins the contract that
  // the random generator stays inside the picker's valid surface — a
  // future op like '>5' would have to be added here AND to the picker.
  const validOps = new Set(['=', '>=', '<=']);
  const validNs = new Set([2, 3, 4, 5]);
  const noColorsPool = /** @type {typeof PILL_POOL} */ ([
    { group: 'continent', value: 'Europe' },
    { group: 'continent', value: 'Africa' },
    { group: 'motif', value: 'weapon' },
    { group: 'motif', value: 'star-or-moon' },
  ]);
  let nonNullCount = 0;
  for (let seed = 0; seed < 50; seed++) {
    let i = 0;
    const rng = () => {
      const v = ((seed * 19 + i * 31) % 100) / 100;
      i++;
      return v;
    };
    const f = pickRandomMix(noColorsPool, SAMPLE, {
      rng,
      onlyColorsProbability: 0,
      colorCountProbability: 1,
      minIntersection: 0, // some random constraints will produce 0 matches — don't filter them out
    });
    if (f.colorCount !== null) {
      nonNullCount++;
      assert.ok(validOps.has(f.colorCount.op),
        `seed ${seed}: op ${f.colorCount.op} not in valid set`);
      assert.ok(validNs.has(f.colorCount.n),
        `seed ${seed}: n ${f.colorCount.n} not in valid set`);
    }
  }
  // Probability=1 plus minIntersection=0 means almost every attempt
  // should land with colorCount set. Allowing a small slack in case
  // the retry loop ever returns a lastAttempt that pre-dated the
  // modifier (it doesn't today, but pinning >0 keeps the test honest
  // without coupling it to the retry-loop internals).
  assert.ok(nonNullCount > 30,
    `expected colorCountProbability=1 to fire on most seeds, got ${nonNullCount}/50`);
});

test('pickRandomMix: both modifier probabilities at 0 means colorCount always stays null AND no rng bytes are consumed for them', () => {
  // The "no rng bytes consumed" contract is what lets older
  // RNG-seeded tests above (excludeProbability=0, etc.) keep their
  // exact pill outputs after the modifier code was added. If a
  // future refactor accidentally calls rng() even when the
  // probability is 0, those tests would silently drift — this test
  // guards the gate.
  let rngCalls = 0;
  const rng = () => {
    rngCalls++;
    // Deterministic enough to pick a stable mix.
    return ((rngCalls * 13) % 100) / 100;
  };
  const callsBefore = rngCalls;
  const f = pickRandomMix(PILL_POOL, SAMPLE, {
    rng,
    onlyColorsProbability: 0,
    colorCountProbability: 0,
  });
  const callsWithModifiersOff = rngCalls - callsBefore;
  assert.equal(f.colorCount, null);

  // Re-run the same fixture with the modifier branches *enabled*; if
  // the gate is broken (rng called even when probability is 0), the
  // call count would already match this run and the assertion above
  // would silently pass — so we sanity-check that enabling does
  // consume MORE rng bytes for the same shape of mix.
  rngCalls = 0;
  pickRandomMix(PILL_POOL, SAMPLE, {
    rng,
    onlyColorsProbability: 1,
    colorCountProbability: 1,
  });
  const callsWithModifiersOn = rngCalls;
  assert.ok(callsWithModifiersOn > callsWithModifiersOff,
    `enabling modifiers should consume more rng bytes (off: ${callsWithModifiersOff}, on: ${callsWithModifiersOn})`);
});

test('pickRandomMix: empirical coverage — every visible pill AND the colorCount modifier appear over many runs', async () => {
  // Regression guard for "is everything in the random pool reachable?"
  // Mirrors the manual check Jan asked for after adding the modifiers:
  // run the generator many times against the live catalog and assert
  // each pill (and a colorCount modifier of either shape) shows up at
  // least once. If a future PR adds a new motif/colour/continent to
  // the chooser without updating the pickRandomMix pool, this fails.
  // See .claude/skills/findflag-random-coverage/ for the human-side
  // reminder.
  const { readFile } = await import('node:fs/promises');
  const { fileURLToPath } = await import('node:url');
  const { dirname: dn, join: jn } = await import('node:path');
  const here = dn(fileURLToPath(import.meta.url));
  const raw = JSON.parse(await readFile(jn(here, 'countries.json'), 'utf8'));
  const { loadCountries, flagsGamePool, CONTINENTS } = await import('./group.js');
  const { ALL_FLAG_COLORS, ALL_MOTIFS } = await import('./engine.js');
  const all = flagsGamePool(loadCountries(raw), false);
  /** @type {Array<{ group: 'continent' | 'color' | 'motif', value: string }>} */
  const pool = [
    ...CONTINENTS
      .filter((v) => all.some((c) => c.continent === v))
      .map((v) => /** @type {const} */ ({ group: 'continent', value: /** @type {string} */ (v) })),
    ...ALL_FLAG_COLORS
      .filter((v) => all.some((c) => c.colors.includes(v)))
      .map((v) => /** @type {const} */ ({ group: 'color', value: v })),
    ...ALL_MOTIFS
      .filter((v) => all.some((c) => (c.motifs ?? []).includes(v)))
      .map((v) => /** @type {const} */ ({ group: 'motif', value: v })),
  ];

  const seen = new Map();
  for (const p of pool) seen.set(`${p.group}:${p.value}`, 0);
  let colorCountFired = 0;

  const RUNS = 8000;
  for (let i = 0; i < RUNS; i++) {
    const f = pickRandomMix(pool, all, {
      onlyColorsProbability: 0.25,
      colorCountProbability: 0.10,
    });
    for (const g of /** @type {Array<'continent' | 'color' | 'motif'>} */ (['continent', 'color', 'motif'])) {
      for (const v of f[g].include) seen.set(`${g}:${v}`, (seen.get(`${g}:${v}`) ?? 0) + 1);
      for (const v of f[g].exclude) seen.set(`${g}:${v}`, (seen.get(`${g}:${v}`) ?? 0) + 1);
    }
    if (f.colorCount !== null) colorCountFired++;
  }

  const missing = [...seen.entries()].filter(([, n]) => n === 0).map(([k]) => k);
  assert.deepEqual(missing, [],
    `every pill must appear at least once over ${RUNS} runs; missing: ${missing.join(', ')}`);
  assert.ok(colorCountFired > 0,
    `colorCount modifier must fire at least once over ${RUNS} runs; got 0`);
});

// ---- population (findFlag "Make a puzzle" scalar filter) -------------------

test('parseFilterString: population:>=N parses as op:>=, n:N', () => {
  const f = parseFilterString('continent:Europe,population:>=50000000');
  assert.ok(f);
  assert.deepEqual([...f.continent.include], ['Europe']);
  assert.deepEqual(f.population, { op: '>=', n: 50000000 });
});

test('parseFilterString: population:<=N parses as op:<=, n:N', () => {
  const f = parseFilterString('population:<=1000000');
  assert.ok(f);
  assert.deepEqual(f.population, { op: '<=', n: 1000000 });
});

test('parseFilterString: population without an explicit op or with a bad number is silently dropped', () => {
  assert.equal(parseFilterString('population:'), null);
  assert.equal(parseFilterString('population:50000000'), null, 'bare N (no op) is not a valid population token');
  assert.equal(parseFilterString('population:>=abc'), null);
  assert.equal(parseFilterString('population:>='), null);
  assert.equal(parseFilterString('population:<=0'), null, 'n must be > 0');
  assert.equal(parseFilterString('population:>=-5'), null);
});

test('serializeFilter: round-trips a population filter deterministically', () => {
  const s = 'continent:Africa,population:>=10000000';
  const f = parseFilterString(s);
  assert.ok(f);
  assert.equal(serializeFilter(f), s);
});

test('serializeFilter: population token emits after colorCount', () => {
  const f = emptyFilters();
  f.colorCount = { op: '>=', n: 3 };
  f.population = { op: '<=', n: 5000000 };
  assert.equal(serializeFilter(f), 'colorCount:>=3,population:<=5000000');
});

test('pillLabel: population ">=N" renders as the localized "over N M people" label', () => {
  assert.equal(pillLabel('population', '>=10000000', 'include', idTranslate), 'over 10M people');
  assert.equal(pillLabel('population', '>=100000000', 'include', idTranslate), 'over 100M people');
});

test('pillLabel: population "<=N" renders as the localized "under N M people" label', () => {
  assert.equal(pillLabel('population', '<=20000000', 'include', idTranslate), 'under 20M people');
  assert.equal(pillLabel('population', '<=1000000', 'include', idTranslate), 'under 1M people');
});

test('filterTitle: appends the population phrase after the pill groups', () => {
  const f = parseFilterString('continent:Europe,population:>=50000000');
  assert.ok(f);
  assert.equal(filterTitle(f, idTranslate), 'Europe · over 50M people');
});

test('pickRandomMix: populationProbability=1 attaches one of the curated tiers, mutually exclusive with colorCount', () => {
  const validTiers = new Set(POPULATION_BREAKS_FOR_RANDOM.map((b) => `${b.op}${b.n}`));
  let fired = 0;
  for (let seed = 0; seed < 50; seed++) {
    let i = 0;
    const rng = () => {
      const v = ((seed * 23 + i * 29) % 100) / 100;
      i++;
      return v;
    };
    const f = pickRandomMix(PILL_POOL, SAMPLE, {
      rng,
      onlyColorsProbability: 0,
      colorCountProbability: 0,
      populationProbability: 1,
      minIntersection: 0,
    });
    if (f.population !== null) {
      fired++;
      assert.ok(validTiers.has(`${f.population.op}${f.population.n}`),
        `seed ${seed}: ${f.population.op}${f.population.n} is not a curated tier`);
      assert.equal(f.colorCount, null, `seed ${seed}: population and colorCount must not both be set`);
    }
  }
  assert.ok(fired > 30, `expected populationProbability=1 to fire on most seeds, got ${fired}/50`);
});

test('pickRandomMix: populationProbability=0 leaves population null and consumes no rng bytes for it', () => {
  // Same gate contract as the colorCount test above: the probability is
  // checked before the first rng() call, so opting out spends zero bytes
  // and existing seeded tests keep their exact outputs. Both runs use the
  // identical options shape (only the probability flips) so the byte-count
  // comparison is apples-to-apples.
  let rngCalls = 0;
  const rng = () => { rngCalls++; return ((rngCalls * 13) % 100) / 100; };
  const f = pickRandomMix(PILL_POOL, SAMPLE, { rng, populationProbability: 0 });
  assert.equal(f.population, null);
  const callsOff = rngCalls;

  rngCalls = 0;
  pickRandomMix(PILL_POOL, SAMPLE, { rng, populationProbability: 1 });
  assert.ok(rngCalls > callsOff,
    `enabling population should consume more rng bytes (off: ${callsOff}, on: ${rngCalls})`);
});

// ---- area (findFlag "Make a puzzle" scalar filter, km² twin of population) --

test('parseFilterString: area:>=N / area:<=N parse as { op, n }', () => {
  const ge = parseFilterString('continent:Europe,area:>=1000000');
  assert.ok(ge);
  assert.deepEqual([...ge.continent.include], ['Europe']);
  assert.deepEqual(ge.area, { op: '>=', n: 1000000 });
  const le = parseFilterString('area:<=1000');
  assert.deepEqual(le?.area, { op: '<=', n: 1000 });
});

test('parseFilterString: area without an explicit op or with a bad number is silently dropped', () => {
  assert.equal(parseFilterString('area:'), null);
  assert.equal(parseFilterString('area:1000000'), null, 'bare N (no op) is not a valid area token');
  assert.equal(parseFilterString('area:>=abc'), null);
  assert.equal(parseFilterString('area:<=0'), null, 'n must be > 0');
});

test('serializeFilter: round-trips an area filter, token emits after population', () => {
  const s = 'continent:Africa,area:>=100000';
  assert.equal(serializeFilter(/** @type {any} */ (parseFilterString(s))), s);
  const f = emptyFilters();
  f.population = { op: '>=', n: 10000000 };
  f.area = { op: '<=', n: 1000 };
  assert.equal(serializeFilter(f), 'population:>=10000000,area:<=1000');
});

test('pillLabel: area renders localized "over/under N km²" labels with K/M tokens', () => {
  assert.equal(pillLabel('area', '>=1000000', 'include', idTranslate), 'over 1M km²');
  assert.equal(pillLabel('area', '>=100000', 'include', idTranslate), 'over 100K km²');
  assert.equal(pillLabel('area', '<=1000', 'include', idTranslate), 'under 1K km²');
});

test('filterTitle: appends the area phrase after the pill groups', () => {
  const f = parseFilterString('continent:Asia,area:>=1000000');
  assert.ok(f);
  assert.equal(filterTitle(f, idTranslate), 'Asia · over 1M km²');
});

test('pickRandomMix: areaProbability=1 attaches a curated tier, mutually exclusive with population + colorCount', () => {
  const validTiers = new Set(AREA_BREAKS_FOR_RANDOM.map((b) => `${b.op}${b.n}`));
  let fired = 0;
  for (let seed = 0; seed < 50; seed++) {
    let i = 0;
    const rng = () => { const v = ((seed * 23 + i * 29) % 100) / 100; i++; return v; };
    const f = pickRandomMix(PILL_POOL, SAMPLE, {
      rng, onlyColorsProbability: 0, colorCountProbability: 0,
      populationProbability: 0, areaProbability: 1, minIntersection: 0,
    });
    if (f.area !== null) {
      fired++;
      assert.ok(validTiers.has(`${f.area.op}${f.area.n}`), `seed ${seed}: not a curated area tier`);
      assert.equal(f.colorCount, null, `seed ${seed}: area and colorCount must not both be set`);
      assert.equal(f.population, null, `seed ${seed}: area and population must not both be set`);
    }
  }
  assert.ok(fired > 30, `expected areaProbability=1 to fire on most seeds, got ${fired}/50`);
});

test('pickRandomMix: areaProbability=0 leaves area null and consumes no rng bytes for it', () => {
  let rngCalls = 0;
  const rng = () => { rngCalls++; return ((rngCalls * 13) % 100) / 100; };
  const f = pickRandomMix(PILL_POOL, SAMPLE, { rng, areaProbability: 0 });
  assert.equal(f.area, null);
  const callsOff = rngCalls;
  rngCalls = 0;
  pickRandomMix(PILL_POOL, SAMPLE, { rng, areaProbability: 1 });
  assert.ok(rngCalls > callsOff, `enabling area should consume more rng bytes (off: ${callsOff}, on: ${rngCalls})`);
});

test('pickRandomMix: every population tier is reachable over many runs (coverage half of the contract)', () => {
  const seen = new Map(POPULATION_BREAKS_FOR_RANDOM.map((b) => [`${b.op}${b.n}`, 0]));
  const RUNS = 4000;
  for (let i = 0; i < RUNS; i++) {
    const f = pickRandomMix(PILL_POOL, SAMPLE, { populationProbability: 0.5, minIntersection: 0 });
    if (f.population !== null) {
      const key = `${f.population.op}${f.population.n}`;
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }
  }
  const missing = [...seen.entries()].filter(([, n]) => n === 0).map(([k]) => k);
  assert.deepEqual(missing, [], `every population tier must appear at least once; missing: ${missing.join(', ')}`);
});

test('pickRandomMix: every area tier is reachable over many runs (coverage half of the contract)', () => {
  const seen = new Map(AREA_BREAKS_FOR_RANDOM.map((b) => [`${b.op}${b.n}`, 0]));
  const RUNS = 4000;
  for (let i = 0; i < RUNS; i++) {
    const f = pickRandomMix(PILL_POOL, SAMPLE, { areaProbability: 0.5, minIntersection: 0 });
    if (f.area !== null) {
      const key = `${f.area.op}${f.area.n}`;
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }
  }
  const missing = [...seen.entries()].filter(([, n]) => n === 0).map(([k]) => k);
  assert.deepEqual(missing, [], `every area tier must appear at least once; missing: ${missing.join(', ')}`);
});

// ---- density (findFlag "Make a puzzle" scalar filter) -----------------------

test('parseFilterString + serializeFilter round-trip a density token (emits after area)', () => {
  const f = parseFilterString('continent:Asia,density:>=500');
  assert.deepEqual(f?.density, { op: '>=', n: 500 });
  assert.equal(serializeFilter(/** @type {any} */ (f)), 'continent:Asia,density:>=500');
  const g = emptyFilters();
  g.area = { op: '>=', n: 100000 };
  g.density = { op: '<=', n: 10 };
  assert.equal(serializeFilter(g), 'area:>=100000,density:<=10');
  assert.equal(parseFilterString('density:<=0'), null, 'n must be > 0');
});

test('pillLabel + filterTitle render density as "over/under N people/km²"', () => {
  assert.equal(pillLabel('density', '>=500', 'include', idTranslate), 'over 500 people/km²');
  assert.equal(pillLabel('density', '<=10', 'include', idTranslate), 'under 10 people/km²');
  const f = parseFilterString('continent:Europe,density:>=100');
  assert.equal(filterTitle(/** @type {any} */ (f), idTranslate), 'Europe · over 100 people/km²');
});

test('pickRandomMix: densityProbability tiers are reachable and exclusive with the other scalars', () => {
  const seen = new Map(DENSITY_BREAKS_FOR_RANDOM.map((b) => [`${b.op}${b.n}`, 0]));
  for (let i = 0; i < 4000; i++) {
    const f = pickRandomMix(PILL_POOL, SAMPLE, { densityProbability: 0.5, minIntersection: 0 });
    if (f.density !== null) {
      assert.equal(f.colorCount, null);
      assert.equal(f.population, null);
      assert.equal(f.area, null);
      seen.set(`${f.density.op}${f.density.n}`, (seen.get(`${f.density.op}${f.density.n}`) ?? 0) + 1);
    }
  }
  const missing = [...seen.entries()].filter(([, n]) => n === 0).map(([k]) => k);
  assert.deepEqual(missing, [], `every density tier must appear; missing: ${missing.join(', ')}`);
});

test('parseFilterString + serializeFilter round-trip gdp / gdpPerCapita tokens (emit after density)', () => {
  const f = parseFilterString('continent:Asia,gdp:>=1000000000000');
  assert.deepEqual(f?.gdp, { op: '>=', n: 1_000_000_000_000 });
  assert.equal(serializeFilter(/** @type {any} */ (f)), 'continent:Asia,gdp:>=1000000000000');
  const g = emptyFilters();
  g.density = { op: '<=', n: 10 };
  g.gdp = { op: '>=', n: 100_000_000_000 };
  g.gdpPerCapita = { op: '<=', n: 1_000 };
  // Registry order: density, then gdp, then gdpPerCapita.
  assert.equal(serializeFilter(g), 'density:<=10,gdp:>=100000000000,gdpPerCapita:<=1000');
  assert.equal(parseFilterString('gdp:<=0'), null, 'n must be > 0');
});

test('pillLabel + filterTitle render gdp / gdpPerCapita as compact US$ thresholds', () => {
  assert.equal(pillLabel('gdp', '>=1000000000000', 'include', idTranslate), 'over $1T');
  assert.equal(pillLabel('gdp', '<=100000000', 'include', idTranslate), 'under $100M');
  assert.equal(pillLabel('gdpPerCapita', '>=30000', 'include', idTranslate), 'over $30K');
  const f = parseFilterString('continent:Europe,gdpPerCapita:>=50000');
  assert.equal(filterTitle(/** @type {any} */ (f), idTranslate), 'Europe · over $50K');
});

test('pickRandomMix: gdp / gdpPerCapita / coffee tiers are reachable and exclusive with other scalars', () => {
  for (const [key, breaks, probKey] of /** @type {const} */ ([
    ['gdp', GDP_BREAKS_FOR_RANDOM, 'gdpProbability'],
    ['gdpPerCapita', GDP_PER_CAPITA_BREAKS_FOR_RANDOM, 'gdpPerCapitaProbability'],
    ['coffee', COFFEE_BREAKS_FOR_RANDOM, 'coffeeProbability'],
  ])) {
    const seen = new Map(breaks.map((b) => [`${b.op}${b.n}`, 0]));
    for (let i = 0; i < 5000; i++) {
      const f = pickRandomMix(PILL_POOL, SAMPLE, { [probKey]: 0.5, minIntersection: 0 });
      const c = /** @type {any} */ (f)[key];
      if (c !== null) {
        assert.equal(f.colorCount, null);
        seen.set(`${c.op}${c.n}`, (seen.get(`${c.op}${c.n}`) ?? 0) + 1);
      }
    }
    const missing = [...seen.entries()].filter(([, n]) => n === 0).map(([k]) => k);
    assert.deepEqual(missing, [], `every ${key} tier must appear; missing: ${missing.join(', ')}`);
  }
});

