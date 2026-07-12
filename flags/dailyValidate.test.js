import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateCatalog } from './dailyValidate.js';

// Focused coverage for the superlative branch of the shared push-time
// validator. The pre-existing filter/manual rules are exercised by the
// catalog itself under flags/daily.test.js; these pin the new shape checks
// against synthetic entries (no superlative content ships in .catalog yet).

/** A single, valid superlative entry — the base every case mutates. */
function validSuperlative(overrides = {}) {
  return {
    n: 1,
    date: '2026-06-06',
    kind: 'superlative',
    metric: 'population',
    scope: 'world',
    direction: 'most',
    topN: 3,
    answers: ['in', 'cn', 'us'],
    title: { en: '3 most populous countries', pl: '3 najludniejsze kraje' },
    description: {
      en: 'Find the three most populous countries.',
      pl: 'Znajdź trzy najludniejsze kraje.',
    },
    ...overrides,
  };
}

/** @param {any} entry */
const run = (entry) => validateCatalog({ puzzles: [entry] });

test('a well-formed superlative entry passes', () => {
  assert.doesNotThrow(() => run(validSuperlative()));
});

test('a superlative with a valid pool-narrowing filter passes', () => {
  // Answers here are a stand-in — the validator does NOT re-resolve the
  // ranking (frozen), so any sovereign roster + a parseable filter is fine.
  assert.doesNotThrow(() =>
    run(validSuperlative({ scope: 'Europe', filter: 'color:white', answers: ['ru', 'gb', 'fr'], topN: 3 })),
  );
});

test('superlative is exempt from the filter drift detector', () => {
  // A filter entry whose answers didn't match its filter would throw in
  // checkDriftFree; a superlative must be skipped there entirely. The base
  // entry carries no filter and arbitrary (but sovereign) answers — passing
  // proves the drift path doesn't touch it.
  assert.doesNotThrow(() => run(validSuperlative()));
});

test('unknown metric is rejected', () => {
  assert.throws(() => run(validSuperlative({ metric: 'notametric' })), /not a known metric key/);
});

test('invalid scope is rejected', () => {
  assert.throws(() => run(validSuperlative({ scope: 'Mars' })), /not 'world' or a continent/);
  assert.throws(() => run(validSuperlative({ scope: 'Antarctica' })), /not 'world' or a continent/);
});

test('bad direction is rejected', () => {
  assert.throws(() => run(validSuperlative({ direction: 'biggest' })), /direction must be 'most' or 'least'/);
});

test("direction: 'least' is accepted (the smallest-N puzzles)", () => {
  assert.doesNotThrow(() => run(validSuperlative({ direction: 'least' })));
});

test('topN must be a positive integer', () => {
  assert.throws(() => run(validSuperlative({ topN: 0 })), /topN must be a positive integer/);
  assert.throws(() => run(validSuperlative({ topN: 2.5 })), /topN must be a positive integer/);
});

test('topN must equal answers.length', () => {
  assert.throws(() => run(validSuperlative({ topN: 5 })), /must equal answers\.length/);
});

test('a filter that does not parse is rejected', () => {
  assert.throws(() => run(validSuperlative({ filter: 'garbage' })), /filter does not parse/);
});

test('missing title.en or title.pl is rejected', () => {
  assert.throws(() => run(validSuperlative({ title: { pl: 'X' } })), /title\.en missing/);
  assert.throws(() => run(validSuperlative({ title: { en: 'X' } })), /title\.pl missing/);
});

test('answers must be sovereign country codes (rule 3 still applies)', () => {
  // gb-eng (England) is a territory in the full pool but not sovereign.
  assert.throws(
    () => run(validSuperlative({ answers: ['in', 'cn', 'gb-eng'] })),
    /not a sovereign country code/,
  );
});

test('en + pl description still required (rule 7 applies to superlatives)', () => {
  assert.throws(
    () => run(validSuperlative({ description: { en: 'only english' } })),
    /description\.pl missing/,
  );
});
