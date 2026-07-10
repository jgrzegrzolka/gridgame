import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { CONTOUR_CODES, CONTOUR_CODE_SET } from './contourPool.js';
import { sovereignPool } from './flagPools.js';
import { loadCountries } from './group.js';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const rawCountries = require('./countries.json');
const contourDir = new URL('./contours/', import.meta.url);

test('contourPool: non-empty and a healthy map-round pool', () => {
  // 157 today; guard against a generator regression that empties or halves it.
  assert.ok(CONTOUR_CODES.length >= 140, `pool unexpectedly small: ${CONTOUR_CODES.length}`);
});

test('contourPool: CONTOUR_CODE_SET mirrors CONTOUR_CODES exactly', () => {
  assert.equal(CONTOUR_CODE_SET.size, CONTOUR_CODES.length);
  for (const code of CONTOUR_CODES) assert.ok(CONTOUR_CODE_SET.has(code));
});

test('contourPool: every code is a lowercase two-letter code, sorted and unique', () => {
  const sorted = [...CONTOUR_CODES].sort();
  assert.deepEqual(CONTOUR_CODES, sorted, 'pool should be sorted');
  assert.equal(new Set(CONTOUR_CODES).size, CONTOUR_CODES.length, 'pool should be unique');
  for (const code of CONTOUR_CODES) assert.match(code, /^[a-z]{2}$/);
});

test('contourPool: pool and flags/contours/*.svg are in exact 1:1 correspondence', () => {
  const files = readdirSync(contourDir)
    .filter((f) => f.endsWith('.svg'))
    .map((f) => f.replace(/\.svg$/, ''))
    .sort();
  assert.deepEqual(files, [...CONTOUR_CODES].sort(),
    'every pool code must have a contour file and vice versa — regenerate with scripts/generate-contours.mjs');
});

test('contourPool: every contour is a sovereign country', () => {
  const sovereign = new Set(sovereignPool(loadCountries(rawCountries)).map((c) => c.code));
  for (const code of CONTOUR_CODES) assert.ok(sovereign.has(code), `${code} is not in the sovereign pool`);
});

test('contourPool: hand-excluded unrenderable outlines stay out', () => {
  // ru = antimeridian smear; fj / sb = scattered island specks. Pinned so a
  // regenerate can't silently let them back in (see scripts/generate-contours.mjs).
  for (const code of ['ru', 'fj', 'sb']) assert.ok(!CONTOUR_CODE_SET.has(code), `${code} should be excluded`);
});
