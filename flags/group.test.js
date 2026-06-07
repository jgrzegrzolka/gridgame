import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  CONTINENTS,
  splitByCategory,
  groupByContinent,
  sovereigntyOf,
  readBoolSetting,
  writeBoolSetting,
  flagsGamePool,
  loadCountries,
  createCountry,
} from './group.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const countries = loadCountries(JSON.parse(
  readFileSync(join(__dirname, 'countries.json'), 'utf8'),
));

test('splitByCategory separates countries from other', () => {
  const result = splitByCategory([
    createCountry({ code: 'de', name: 'Germany', continent: 'Europe', category: 'country' }),
    createCountry({ code: 'un', name: 'United Nations', continent: null, category: 'other' }),
    createCountry({ code: 'br', name: 'Brazil', continent: 'South America', category: 'country' }),
  ]);
  assert.equal(result.countries.length, 2);
  assert.equal(result.other.length, 1);
  assert.deepEqual(result.countries.map((c) => c.code), ['de', 'br']);
  assert.deepEqual(result.other.map((c) => c.code), ['un']);
});

test('groupByContinent assigns countries to their continent', () => {
  const groups = groupByContinent([
    createCountry({ code: 'de', name: 'Germany', continent: 'Europe', category: 'country' }),
    createCountry({ code: 'fr', name: 'France', continent: 'Europe', category: 'country' }),
    createCountry({ code: 'br', name: 'Brazil', continent: 'South America', category: 'country' }),
  ]);
  assert.deepEqual(groups['Europe'].map((c) => c.code), ['de', 'fr']);
  assert.deepEqual(groups['South America'].map((c) => c.code), ['br']);
  assert.equal(groups['Africa'].length, 0);
});

test('groupByContinent returns groups in the declared continent order', () => {
  const groups = groupByContinent([]);
  assert.deepEqual(Object.keys(groups), CONTINENTS);
});

test('groupByContinent throws on an unknown continent', () => {
  assert.throws(
    () =>
      groupByContinent([
        // @ts-expect-error - deliberately invalid continent to verify the throw path
        { code: 'xx', name: 'Typo', continent: 'Antartica', category: 'country' },
      ]),
    /Unknown continent "Antartica"/,
  );
});

test('real data: 193 UN member states', () => {
  const unMembers = countries.filter((c) => c.statehood === 'un_member');
  assert.equal(unMembers.length, 193);
});

test('real data: 2 UN observer states (Vatican + Palestine)', () => {
  const observers = countries.filter((c) => c.statehood === 'un_observer');
  assert.equal(observers.length, 2);
  assert.deepEqual(observers.map((c) => c.code).sort(), ['ps', 'va']);
});

test('real data: 195 UN-recognised states (193 members + 2 observers)', () => {
  const recognised = countries.filter(
    (c) => c.statehood === 'un_member' || c.statehood === 'un_observer',
  );
  assert.equal(recognised.length, 195);
});

test('real data: 5 widely-recognised non-UN states (Taiwan, Kosovo, Western Sahara, Cook Islands, Niue)', () => {
  const nonUn = countries.filter((c) => c.statehood === 'non_un');
  assert.equal(nonUn.length, 5);
  assert.deepEqual(nonUn.map((c) => c.code).sort(), ['ck', 'eh', 'nu', 'tw', 'xk']);
});

test('sovereigntyOf classifies UN members and observers as sovereign', () => {
  assert.equal(sovereigntyOf(createCountry({ code: 'de', name: 'Germany', category: 'country', continent: 'Europe', statehood: 'un_member' })), 'sovereign');
  assert.equal(sovereigntyOf(createCountry({ code: 'va', name: 'Vatican City', category: 'country', continent: 'Europe', statehood: 'un_observer' })), 'sovereign');
});

test('sovereigntyOf classifies non_un, territory, and other distinctly', () => {
  assert.equal(sovereigntyOf(createCountry({ code: 'tw', name: 'Taiwan', category: 'country', continent: 'Asia', statehood: 'non_un' })), 'non_un');
  assert.equal(sovereigntyOf(createCountry({ code: 'gl', name: 'Greenland', category: 'country', continent: 'Europe', statehood: 'territory' })), 'territory');
  assert.equal(sovereigntyOf(createCountry({ code: 'un', name: 'United Nations', category: 'other', continent: null })), 'other');
});

test('real data: sovereigntyOf yields the expected 195 / 5 / 54 / 15 split', () => {
  const buckets = { sovereign: 0, non_un: 0, territory: 0, other: 0 };
  for (const c of countries) buckets[sovereigntyOf(c)]++;
  assert.deepEqual(buckets, { sovereign: 195, non_un: 5, territory: 54, other: 15 });
});

/**
 * @returns {{ getItem(k: string): string | null, setItem(k: string, v: string): void, removeItem(k: string): void, _data: Map<string, string> }}
 */
function fakeStore() {
  /** @type {Map<string, string>} */
  const data = new Map();
  return {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => { data.set(k, v); },
    removeItem: (k) => { data.delete(k); },
    _data: data,
  };
}

test('readBoolSetting defaults to false on an empty store', () => {
  assert.equal(readBoolSetting(fakeStore(), 'whatever.key'), false);
});

test('writeBoolSetting(true) round-trips through readBoolSetting; (false) removes the key', () => {
  const store = fakeStore();
  writeBoolSetting(store, 'k', true);
  assert.equal(readBoolSetting(store, 'k'), true);
  assert.equal(store._data.has('k'), true);
  writeBoolSetting(store, 'k', false);
  assert.equal(readBoolSetting(store, 'k'), false);
  assert.equal(store._data.has('k'), false, 'key is removed, not just set to "false"');
});

test('flagsGamePool drops non-sovereign by default but returns everything when includeAll is true', () => {
  const fr = createCountry({ code: 'fr', name: 'France', category: 'country', continent: 'Europe', statehood: 'un_member' });
  const gl = createCountry({ code: 'gl', name: 'Greenland', category: 'country', continent: 'Europe', statehood: 'territory' });
  const un = createCountry({ code: 'un', name: 'United Nations', category: 'other', continent: null });
  assert.deepEqual(flagsGamePool([fr, gl, un], false).map((c) => c.code), ['fr']);
  assert.deepEqual(flagsGamePool([fr, gl, un], true).map((c) => c.code), ['fr', 'gl', 'un']);
});

test('real data: flagsGamePool returns 195 by default, 270 with includeAll', () => {
  assert.equal(flagsGamePool(countries, false).length, 195);
  assert.equal(flagsGamePool(countries, true).length, countries.length);
});

// Regression pin for the `colors` getter being non-enumerable. The getter
// is the union of primaryColors + additionalColors — convenient for in-memory
// reads but not something we want serialised: a stringified Country round-
// tripped through PartyKit / localStorage / debug logs should carry only
// the two canonical buckets, otherwise readers see three colour fields and
// can't tell which is the source of truth. Flipping the getter to
// enumerable would silently regress that contract, and the failure mode
// (extra `colors` field in messages) is the kind that only shows up in
// production traffic.
test('JSON.stringify(country) omits the computed colors field', () => {
  const pl = createCountry({
    code: 'pl', name: 'Poland', category: 'country', continent: 'Europe',
    primaryColors: ['white', 'red'], additionalColors: [],
  });
  const parsed = JSON.parse(JSON.stringify(pl));
  assert.equal('colors' in parsed, false,
    '`colors` getter must be non-enumerable so it stays out of JSON output');
  assert.deepEqual(parsed.primaryColors, ['white', 'red']);
  assert.deepEqual(parsed.additionalColors, []);
});

// Round-trip pin: a Country that's been stringified-then-parsed loses the
// getter (parse produces a plain object). Re-running createCountry on the
// parsed result must strip any leaked `colors` field that earlier code
// might have written, then re-attach the getter — otherwise the second-
// generation object carries a stale colors array that no longer reflects
// primary/additional edits.
test('createCountry strips a stale colors field from the input before re-attaching the getter', () => {
  const stale = {
    code: 'xx', name: 'X', category: 'country', continent: 'Europe',
    primaryColors: ['red'], additionalColors: ['blue'],
    colors: ['green'], // pretend a prior round-trip wrote this
  };
  const c = createCountry(stale);
  assert.deepEqual(c.colors, ['red', 'blue'],
    'getter must override the stale stored field');
  assert.equal(Object.getOwnPropertyDescriptor(c, 'colors')?.enumerable, false,
    'colors must be the non-enumerable getter, not the stale data field');
});
