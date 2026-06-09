const test = require('node:test');
const assert = require('node:assert/strict');
const { statsCacheHeaders } = require('./cacheHeaders');

test('default (fresh=false) sets public + max-age in whole seconds', () => {
  assert.deepEqual(
    statsCacheHeaders({ fresh: false, ttlMs: 60_000 }),
    { 'Cache-Control': 'public, max-age=60' },
  );
});

test('fresh=true sets no-store (browser should not memoize the bypass)', () => {
  assert.deepEqual(
    statsCacheHeaders({ fresh: true, ttlMs: 60_000 }),
    { 'Cache-Control': 'no-store' },
  );
});

test('floors fractional ttl to a whole second (Cache-Control is integer-only)', () => {
  assert.deepEqual(
    statsCacheHeaders({ fresh: false, ttlMs: 4_750 }),
    { 'Cache-Control': 'public, max-age=4' },
  );
});

test('ttlMs is ignored when fresh=true', () => {
  // The 'no-store' value has no max-age component; any ttl input is moot.
  assert.deepEqual(
    statsCacheHeaders({ fresh: true, ttlMs: 999_999 }),
    { 'Cache-Control': 'no-store' },
  );
});
