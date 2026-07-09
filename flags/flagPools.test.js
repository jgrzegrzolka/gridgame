import { test } from 'node:test';
import assert from 'node:assert/strict';
import rawCountries from './countries.json' with { type: 'json' };
import { loadCountries } from './group.js';
import { sovereignPool, nonSovereignPool, SHARED_PARENT_FLAG } from './flagPools.js';

const countries = loadCountries(rawCountries);

test('sovereignPool: the 195 sovereign states', () => {
  const pool = sovereignPool(countries);
  assert.equal(pool.length, 195);
  assert.ok(pool.some((c) => c.code === 'pl'), 'includes Poland');
  assert.ok(!pool.some((c) => c.code === 'gl'), 'excludes Greenland (territory)');
});

test('nonSovereignPool: territories, quasi-states and regions with distinct flags', () => {
  const pool = nonSovereignPool(countries);
  const codes = new Set(pool.map((c) => c.code));
  // A healthy pool for a 5-round, 4-choice mode.
  assert.ok(pool.length >= 40, `expected a sizable pool, got ${pool.length}`);
  // Distinct, recognizable non-sovereign flags are in.
  for (const code of ['gl', 'hk', 'fo', 'bm', 'gb-sct', 'gb-wls', 'es-ct', 'xk', 'tw', 'ck', 'mq', 'nc']) {
    assert.ok(codes.has(code), `${code} should be in the non-sovereign pool`);
  }
});

test('nonSovereignPool: excludes parent-flag duplicates (unanswerable questions)', () => {
  const codes = new Set(nonSovereignPool(countries).map((c) => c.code));
  for (const code of SHARED_PARENT_FLAG) {
    assert.ok(!codes.has(code), `${code} flies its parent's flag and must be excluded`);
  }
  // Spot-check the specific traps.
  assert.ok(!codes.has('yt'), 'Mayotte (French tricolor)');
  assert.ok(!codes.has('hm'), 'Heard & McDonald (Australian flag)');
  assert.ok(!codes.has('um'), 'US Minor Outlying (US flag)');
});

test('nonSovereignPool: excludes organizations (EU, UN, ASEAN, …)', () => {
  const codes = new Set(nonSovereignPool(countries).map((c) => c.code));
  for (const code of ['eu', 'un', 'asean', 'cefta', 'eac']) {
    assert.ok(!codes.has(code), `${code} is an organization, not a place`);
  }
});

test('the two pools do not overlap', () => {
  const sov = new Set(sovereignPool(countries).map((c) => c.code));
  for (const c of nonSovereignPool(countries)) {
    assert.ok(!sov.has(c.code), `${c.code} is in both pools`);
  }
});
