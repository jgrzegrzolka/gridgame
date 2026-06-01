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
} from './findFlag.js';

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

test('findTargets returns only countries matching the predicate, excluding "other" entries', () => {
  const cat = categoryFromId('hasMotif:star-or-moon');
  assert.ok(cat);
  const targets = findTargets(SAMPLE, cat);
  assert.deepEqual(targets.map((c) => c.code), []);

  const redCat = categoryFromId('hasColor:red');
  assert.ok(redCat);
  const redTargets = findTargets(SAMPLE, redCat);
  assert.deepEqual(redTargets.map((c) => c.code), ['fr', 'de', 'ke', 'jp']);
});

test('findPool excludes "other" entries but keeps every country', () => {
  const pool = findPool(SAMPLE);
  assert.deepEqual(pool.map((c) => c.code), ['fr', 'de', 'ke', 'jp']);
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
