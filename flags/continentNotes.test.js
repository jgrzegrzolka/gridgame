import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CONTINENT_NOTES,
  continentScopeOf,
  buildContinentNotes,
  mergeNotes,
} from './continentNotes.js';

test('every straddler note carries non-empty en + pl', () => {
  const codes = Object.keys(CONTINENT_NOTES);
  assert.deepEqual(codes.sort(), ['am', 'az', 'cy', 'eg', 'ge', 'kz', 'ru', 'tr']);
  for (const [code, note] of Object.entries(CONTINENT_NOTES)) {
    assert.ok(note.en && note.en.trim().length > 0, `${code} en`);
    assert.ok(note.pl && note.pl.trim().length > 0, `${code} pl`);
  }
});

test('continentScopeOf: superlative uses scope, world reads as unscoped', () => {
  assert.equal(continentScopeOf({ kind: 'superlative', scope: 'Asia' }), 'Asia');
  assert.equal(continentScopeOf({ kind: 'superlative', scope: 'world' }), null);
});

test('continentScopeOf: filter entry reads the continent include token', () => {
  assert.equal(continentScopeOf({ filter: 'continent:Europe,motif:cross' }), 'Europe');
  assert.equal(continentScopeOf({ filter: 'motif:cross,color:red' }), null);
  // an exclude token is not a scope
  assert.equal(continentScopeOf({ filter: 'continent:!Asia,motif:cross' }), null);
});

test('continentScopeOf: manual entry and nullish are never scoped', () => {
  assert.equal(continentScopeOf({ kind: 'manual' }), null);
  assert.equal(continentScopeOf(null), null);
  assert.equal(continentScopeOf(undefined), null);
});

test('buildContinentNotes: notes only on a continent-scoped puzzle', () => {
  const scoped = buildContinentNotes({ filter: 'continent:Europe,motif:cross' });
  assert.equal(scoped.ge.en, CONTINENT_NOTES.ge.en);
  assert.deepEqual(buildContinentNotes({ filter: 'motif:cross' }), {});
  assert.deepEqual(buildContinentNotes({ kind: 'superlative', scope: 'world' }), {});
});

test('mergeNotes: joins texts for a shared code, adds disjoint codes', () => {
  const pop = { ru: { en: 'Population: 143.8 million', pl: 'Ludność: 143,8 mln' } };
  const cont = { ru: { en: 'Classified here as Europe.', pl: 'Zaklasyfikowana tutaj jako Europa.' } };
  const merged = mergeNotes(pop, cont);
  assert.equal(merged.ru.en, 'Population: 143.8 million. Classified here as Europe.');
  assert.equal(merged.ru.pl, 'Ludność: 143,8 mln. Zaklasyfikowana tutaj jako Europa.');
});

test('mergeNotes: skips nullish maps and keeps single-source codes intact', () => {
  const merged = mergeNotes(undefined, { ge: CONTINENT_NOTES.ge }, null);
  assert.equal(merged.ge.en, CONTINENT_NOTES.ge.en);
});
