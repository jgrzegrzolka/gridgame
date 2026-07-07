import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadCountries, flagsGamePool } from '../flags/group.js';
import { buildAnswerPool } from './answerPool.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RAW = JSON.parse(
  readFileSync(join(__dirname, '../flags/countries.json'), 'utf-8'),
);
const COUNTRIES = loadCountries(RAW);
const SOV_CODES = new Set(flagsGamePool(COUNTRIES, false).map((c) => c.code));

test('buildAnswerPool: includes every sovereign country', () => {
  const pool = new Set(buildAnswerPool(COUNTRIES, []).map((c) => c.code));
  for (const code of SOV_CODES) assert.ok(pool.has(code), `missing sovereign ${code}`);
});

test('buildAnswerPool: with no catalog, adds nothing beyond sovereign', () => {
  const pool = buildAnswerPool(COUNTRIES, []);
  assert.equal(pool.length, SOV_CODES.size);
});

test('buildAnswerPool: pulls in a referenced non-sovereign code (England)', () => {
  assert.ok(!SOV_CODES.has('gb-eng'), 'gb-eng must be non-sovereign for this test to mean anything');
  const catalog = [{ answers: ['fr', 'es', 'gb-eng'] }];
  const pool = new Set(buildAnswerPool(COUNTRIES, catalog).map((c) => c.code));
  assert.ok(pool.has('gb-eng'), 'England should be searchable/renderable when a puzzle references it');
});

test('buildAnswerPool: does NOT add non-sovereign codes no puzzle references', () => {
  // eu / un / asean are in the full pool but should never leak into the
  // game unless a puzzle actually lists them.
  const catalog = [{ answers: ['fr', 'gb-eng'] }];
  const pool = new Set(buildAnswerPool(COUNTRIES, catalog).map((c) => c.code));
  for (const junk of ['eu', 'un', 'asean']) {
    assert.ok(!pool.has(junk), `${junk} must not leak into the pool`);
  }
  // exactly one extra beyond sovereign: gb-eng
  assert.equal(pool.size, SOV_CODES.size + 1);
});

test('buildAnswerPool: tolerates entries without an answers array', () => {
  const catalog = [{}, { answers: undefined }, { answers: ['gb-eng'] }];
  const pool = new Set(buildAnswerPool(COUNTRIES, catalog).map((c) => c.code));
  assert.ok(pool.has('gb-eng'));
});
