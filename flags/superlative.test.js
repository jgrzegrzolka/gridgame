import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveSuperlative, isValidScope, SUPERLATIVE_SCOPES } from './superlative.js';
import { createCountry } from './group.js';

/** @typedef {import('./group.js').Country} Country */

/** @param {Partial<Country> & { code: string, name: string }} f */
function country(f) {
  return createCountry({ category: 'country', statehood: 'un_member', continent: 'Europe', ...f });
}

// Synthetic world. Populations are the metric `values` map, kept separate from
// the countries exactly as production does (sparse metric file).
const COUNTRIES = [
  country({ code: 'ru', name: 'Russia', continent: 'Europe', primaryColors: ['white', 'blue', 'red'] }),
  country({ code: 'de', name: 'Germany', continent: 'Europe', primaryColors: ['black', 'red', 'yellow'] }),
  country({ code: 'gb', name: 'United Kingdom', continent: 'Europe', primaryColors: ['blue', 'white', 'red'] }),
  country({ code: 'fr', name: 'France', continent: 'Europe', primaryColors: ['blue', 'white', 'red'] }),
  country({ code: 'it', name: 'Italy', continent: 'Europe', primaryColors: ['green', 'white', 'red'] }),
  country({ code: 'va', name: 'Vatican', continent: 'Europe', statehood: 'un_observer', primaryColors: ['yellow', 'white'] }),
  country({ code: 'cn', name: 'China', continent: 'Asia', primaryColors: ['red', 'yellow'] }),
  country({ code: 'in', name: 'India', continent: 'Asia', primaryColors: ['orange', 'white', 'green'] }),
  // Spain: blue+white live only in the coat of arms (additionalColors), so a
  // color:blue filter includes it under the default `colors` field but not
  // under `primaryColors` — exercises the colorField pass-through.
  country({ code: 'es', name: 'Spain', continent: 'Europe', primaryColors: ['red', 'yellow'], additionalColors: ['blue', 'white'] }),
  // Territory: has a (huge) value but must be dropped by the sovereign filter.
  country({ code: 'terr', name: 'Bigterritory', continent: 'Asia', statehood: 'territory', primaryColors: ['red'] }),
  // Sovereign but ABSENT from the metric map (sparse) — must be dropped.
  country({ code: 'nn', name: 'Nowhere', continent: 'Europe', primaryColors: ['red'] }),
];

const POP = {
  in: 1_440_000_000, cn: 1_410_000_000, ru: 143_800_000, de: 83_300_000,
  gb: 68_526_000, fr: 68_372_286, it: 59_000_000, es: 48_400_000, va: 800,
  terr: 999_000_000, // territory, filtered out despite the value
  // nn intentionally omitted
};

test('isValidScope accepts world + the six inhabited continents, rejects others', () => {
  assert.equal(isValidScope('world'), true);
  assert.equal(isValidScope('Europe'), true);
  assert.equal(isValidScope('Oceania'), true);
  assert.equal(isValidScope('Antarctica'), false);
  assert.equal(isValidScope('Mars'), false);
  assert.equal(SUPERLATIVE_SCOPES.length, 7);
});

test('world / most ranks by value descending, sovereign-only', () => {
  assert.deepEqual(
    resolveSuperlative({ metric: 'population', scope: 'world', direction: 'most', topN: 3 }, COUNTRIES, POP),
    ['in', 'cn', 'ru'],
  );
});

test('territory with a value is excluded (sovereign pool only)', () => {
  const codes = resolveSuperlative({ metric: 'population', scope: 'world', direction: 'most', topN: 5 }, COUNTRIES, POP);
  assert.ok(!codes.includes('terr'), 'territory must not appear despite its value');
  assert.deepEqual(codes, ['in', 'cn', 'ru', 'de', 'gb']);
});

test('continent scope restricts to that continent', () => {
  assert.deepEqual(
    resolveSuperlative({ metric: 'population', scope: 'Europe', direction: 'most', topN: 3 }, COUNTRIES, POP),
    ['ru', 'de', 'gb'],
  );
});

test('direction: least ranks from the bottom', () => {
  assert.deepEqual(
    resolveSuperlative({ metric: 'population', scope: 'Europe', direction: 'least', topN: 2 }, COUNTRIES, POP),
    ['va', 'es'],
  );
});

test('a flag filter narrows the ranking pool (default colors field)', () => {
  // Europe + white, most populous. de (black/red/gold) drops; es keeps its
  // COA white under the default `colors` field.
  assert.deepEqual(
    resolveSuperlative({ metric: 'population', scope: 'Europe', direction: 'most', topN: 4, filter: 'color:white' }, COUNTRIES, POP),
    ['ru', 'gb', 'fr', 'it'],
  );
});

test('colorField: primaryColors drops COA-only colour matches (rule-5 parity)', () => {
  // Europe + blue. Under default colors, Spain qualifies (COA blue); under
  // primaryColors it does not.
  const withCoa = resolveSuperlative(
    { metric: 'population', scope: 'Europe', direction: 'most', topN: 10, filter: 'color:blue' },
    COUNTRIES, POP,
  );
  assert.ok(withCoa.includes('es'), 'default colors field includes Spain via COA blue');
  const primaryClean = resolveSuperlative(
    { metric: 'population', scope: 'Europe', direction: 'most', topN: 10, filter: 'color:blue' },
    COUNTRIES, POP, { colorField: 'primaryColors' },
  );
  assert.ok(!primaryClean.includes('es'), 'primaryColors field drops Spain (blue is COA-only)');
});

test('sparse: a sovereign with no metric value never appears', () => {
  const codes = resolveSuperlative({ metric: 'population', scope: 'world', direction: 'most', topN: 20 }, COUNTRIES, POP);
  assert.ok(!codes.includes('nn'), 'country absent from the values map is dropped');
});

test('topN larger than the pool returns the whole ranked pool, no padding', () => {
  const euro = resolveSuperlative({ metric: 'population', scope: 'Europe', direction: 'most', topN: 100 }, COUNTRIES, POP);
  // Europe sovereigns WITH a value: ru, de, gb, fr, it, es, va (7) — nn dropped.
  assert.equal(euro.length, 7);
  assert.deepEqual(euro, ['ru', 'de', 'gb', 'fr', 'it', 'es', 'va']);
});

test('ties broken by code ascending for determinism', () => {
  const tied = [
    country({ code: 'bb', name: 'B', continent: 'Africa' }),
    country({ code: 'aa', name: 'A', continent: 'Africa' }),
  ];
  const codes = resolveSuperlative(
    { metric: 'x', scope: 'Africa', direction: 'most', topN: 2 },
    tied, { aa: 5000, bb: 5000 },
  );
  assert.deepEqual(codes, ['aa', 'bb']);
});

test('bad params resolve to an empty set', () => {
  /** @type {import('./superlative.js').SuperlativeSpec} */
  const base = { metric: 'population', scope: 'world', direction: 'most', topN: 3 };
  assert.deepEqual(resolveSuperlative({ ...base, topN: 0 }, COUNTRIES, POP), []);
  assert.deepEqual(resolveSuperlative({ ...base, topN: 1.5 }, COUNTRIES, POP), []);
  assert.deepEqual(resolveSuperlative({ ...base, scope: 'Mars' }, COUNTRIES, POP), []);
  assert.deepEqual(
    resolveSuperlative({ ...base, direction: /** @type {any} */ ('sideways') }, COUNTRIES, POP),
    [],
  );
});
