import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { CONTINENTS, splitByCategory, groupByContinent } from './group.js';

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
