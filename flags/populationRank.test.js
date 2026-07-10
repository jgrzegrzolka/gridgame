import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatPopulation,
  rankByPopulation,
  buildPopulationRankNotes,
} from './populationRank.js';

const VALUES = {
  in: 1_438_069_596,
  cn: 1_410_710_000,
  us: 336_762_000,
  mx: 129_739_000,
  va: 800,
  tv: 9_816,
  // territory-shaped code with no value would simply be absent
};

const COUNTRIES = [
  { code: 'in' }, { code: 'cn' }, { code: 'us' }, { code: 'mx' },
  { code: 'va' }, { code: 'tv' },
  { code: 'gb-eng' }, // no population value -> excluded from ranking + notes
];

test('formatPopulation: billions, millions, grouped integers (en)', () => {
  assert.equal(formatPopulation(1_438_069_596, 'en'), '1.44 billion');
  assert.equal(formatPopulation(336_762_000, 'en'), '336.8 million');
  assert.equal(formatPopulation(9_816, 'en'), '9,816');
  assert.equal(formatPopulation(800, 'en'), '800');
});

test('formatPopulation: pl uses comma decimals, space thousands, mld/mln', () => {
  assert.equal(formatPopulation(1_438_069_596, 'pl'), '1,44 mld');
  assert.equal(formatPopulation(336_762_000, 'pl'), '336,8 mln');
  assert.equal(formatPopulation(9_816, 'pl'), '9 816');
  assert.equal(formatPopulation(800, 'pl'), '800');
});

test('rankByPopulation: descending, #1 = most populous', () => {
  const rank = rankByPopulation(COUNTRIES, VALUES);
  assert.equal(rank.get('in'), 1);
  assert.equal(rank.get('cn'), 2);
  assert.equal(rank.get('us'), 3);
  assert.equal(rank.get('mx'), 4);
  assert.equal(rank.get('tv'), 5);
  assert.equal(rank.get('va'), 6);
});

test('rankByPopulation: codes without a value are excluded', () => {
  const rank = rankByPopulation(COUNTRIES, VALUES);
  assert.equal(rank.has('gb-eng'), false);
  assert.equal(rank.size, 6);
});

test('rankByPopulation: ties break alphabetically by code', () => {
  const rank = rankByPopulation([{ code: 'zz' }, { code: 'aa' }], { zz: 100, aa: 100 });
  assert.equal(rank.get('aa'), 1);
  assert.equal(rank.get('zz'), 2);
});

test('buildPopulationRankNotes: caption carries figure + world rank', () => {
  const notes = buildPopulationRankNotes(COUNTRIES, VALUES);
  assert.equal(notes.in.en, 'Population: 1.44 billion · #1 in the world');
  assert.equal(notes.in.pl, 'Ludność: 1,44 mld · 1. na świecie');
  assert.equal(notes.mx.en, 'Population: 129.7 million · #4 in the world');
  assert.equal(notes.va.en, 'Population: 800 · #6 in the world');
  assert.equal(notes.va.pl, 'Ludność: 800 · 6. na świecie');
});

test('buildPopulationRankNotes: only sovereign (valued) codes get a note', () => {
  const notes = buildPopulationRankNotes(COUNTRIES, VALUES);
  assert.equal('gb-eng' in notes, false);
  assert.equal(Object.keys(notes).length, 6);
});
