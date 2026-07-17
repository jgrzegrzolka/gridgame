import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { QUIZ_MAP_CONFIG } from './mapConfig.js';
import { VARIANTS, poolFor } from '../flags/quiz.js';
import { loadCountries } from '../flags/group.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const COUNTRIES = loadCountries(
  JSON.parse(readFileSync(join(HERE, '..', 'flags', 'countries.json'), 'utf-8')),
);

// THE reason this table was extracted from `startGame()`. The page gates on
// `if (!QUIZ_MAP_CONFIG[key]) return`, so a deck missing here mounts no map and
// says nothing about it — which is exactly what happened to `weird` when
// Feature V added it. A new deck now fails CI instead of shipping mapless.
test('every quiz variant has a map config', () => {
  const missing = Object.keys(VARIANTS).filter((key) => !QUIZ_MAP_CONFIG[key]);
  assert.deepEqual(
    missing,
    [],
    `variants with no map (they would silently mount nothing): ${missing.join(', ')}`,
  );
});

test('no map config entry refers to a variant that does not exist', () => {
  const orphans = Object.keys(QUIZ_MAP_CONFIG).filter((key) => !VARIANTS[key]);
  assert.deepEqual(orphans, [], `map configs for dead variants: ${orphans.join(', ')}`);
});

test('every configured asset exists on disk', () => {
  for (const [key, cfg] of Object.entries(QUIZ_MAP_CONFIG)) {
    const rel = cfg.url.replace(/^\.\//, '');
    assert.ok(existsSync(join(HERE, rel)), `${key}: missing asset ${cfg.url}`);
  }
});

test('cropExcludes / cropPad only appear where cropping actually happens', () => {
  for (const [key, cfg] of Object.entries(QUIZ_MAP_CONFIG)) {
    if (cfg.crop) continue;
    // An uncropped world view runs no bbox math, so these would be dead config
    // that reads as if it were doing something.
    assert.equal(cfg.cropExcludes, undefined, `${key}: crop:false but has cropExcludes`);
    assert.equal(cfg.cropPad, undefined, `${key}: crop:false but has cropPad`);
  }
});

test('every cropExcludes code is a real country code', () => {
  const known = new Set(COUNTRIES.map((c) => c.code));
  for (const [key, cfg] of Object.entries(QUIZ_MAP_CONFIG)) {
    for (const code of cfg.cropExcludes || []) {
      assert.ok(known.has(code), `${key}: cropExcludes "${code}" is not in countries.json`);
    }
  }
});

// A code excluded from a crop it was never part of does nothing — it just
// reads like a live rule. Catches a typo, and catches an exclude left behind
// after a country moves continent.
test('no cropExcludes entry is dead — each code is in its own variant pool', () => {
  const dead = [];
  for (const [key, cfg] of Object.entries(QUIZ_MAP_CONFIG)) {
    if (!cfg.cropExcludes) continue;
    const pool = new Set(poolFor(key, COUNTRIES).map((c) => c.code));
    for (const code of cfg.cropExcludes) {
      if (!pool.has(code)) dead.push(`${key}: "${code}" is excluded but isn't in the ${key} pool`);
    }
  }
  assert.deepEqual(dead, [], dead.join('; '));
});

test('the two whole-world decks are the only uncropped ones', () => {
  const uncropped = Object.entries(QUIZ_MAP_CONFIG)
    .filter(([, cfg]) => !cfg.crop)
    .map(([key]) => key)
    .sort();
  // `countries` and `weird` are both global pools — there's no meaningful bbox
  // to crop to. Every continent deck must crop, or it renders the whole world
  // for a regional round.
  assert.deepEqual(uncropped, ['countries', 'weird']);
});
