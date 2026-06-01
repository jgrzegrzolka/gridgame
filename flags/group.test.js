import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { CONTINENTS, splitByCategory, groupByContinent, sovereigntyOf } from './group.js';

/** @typedef {import('./group.js').Country} Country */

const __dirname = dirname(fileURLToPath(import.meta.url));
/** @type {Country[]} */
const countries = JSON.parse(
  readFileSync(join(__dirname, 'countries.json'), 'utf8'),
);

test('splitByCategory separates countries from other', () => {
  const result = splitByCategory([
    { code: 'de', name: 'Germany', continent: 'Europe', category: 'country' },
    { code: 'un', name: 'United Nations', continent: null, category: 'other' },
    { code: 'br', name: 'Brazil', continent: 'South America', category: 'country' },
  ]);
  assert.equal(result.countries.length, 2);
  assert.equal(result.other.length, 1);
  assert.deepEqual(result.countries.map((c) => c.code), ['de', 'br']);
  assert.deepEqual(result.other.map((c) => c.code), ['un']);
});

test('groupByContinent assigns countries to their continent', () => {
  const groups = groupByContinent([
    { code: 'de', name: 'Germany', continent: 'Europe', category: 'country' },
    { code: 'fr', name: 'France', continent: 'Europe', category: 'country' },
    { code: 'br', name: 'Brazil', continent: 'South America', category: 'country' },
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

test('real data: 2 widely-recognised non-UN states (Taiwan + Kosovo)', () => {
  const nonUn = countries.filter((c) => c.statehood === 'non_un');
  assert.equal(nonUn.length, 2);
  assert.deepEqual(nonUn.map((c) => c.code).sort(), ['tw', 'xk']);
});

test('sovereigntyOf classifies UN members and observers as sovereign', () => {
  assert.equal(sovereigntyOf({ code: 'de', name: 'Germany', category: 'country', continent: 'Europe', statehood: 'un_member' }), 'sovereign');
  assert.equal(sovereigntyOf({ code: 'va', name: 'Vatican City', category: 'country', continent: 'Europe', statehood: 'un_observer' }), 'sovereign');
});

test('sovereigntyOf classifies non_un, territory, and other distinctly', () => {
  assert.equal(sovereigntyOf({ code: 'tw', name: 'Taiwan', category: 'country', continent: 'Asia', statehood: 'non_un' }), 'non_un');
  assert.equal(sovereigntyOf({ code: 'gl', name: 'Greenland', category: 'country', continent: 'Europe', statehood: 'territory' }), 'territory');
  assert.equal(sovereigntyOf({ code: 'un', name: 'United Nations', category: 'other', continent: null }), 'other');
});

test('real data: sovereigntyOf yields the expected 195 / 2 / 58 / 15 split', () => {
  const buckets = { sovereign: 0, non_un: 0, territory: 0, other: 0 };
  for (const c of countries) buckets[sovereigntyOf(c)]++;
  assert.deepEqual(buckets, { sovereign: 195, non_un: 2, territory: 58, other: 15 });
});
