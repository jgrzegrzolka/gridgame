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

test('partial=true sets no-store even on the cacheable path', () => {
  // Refusing to put a degraded snapshot in the server's own cache is only
  // half the job: on the boot (non-fresh) path this header is what decides
  // whether the BROWSER re-serves the same degraded body for the rest of
  // the window — and the boot snapshot is precisely the achievement diff's
  // baseline. Cache it and one Cosmos blip keeps poisoning page loads
  // after the blip is over.
  assert.deepEqual(
    statsCacheHeaders({ fresh: false, partial: true, ttlMs: 60_000 }),
    { 'Cache-Control': 'no-store' },
  );
});

test('partial defaults to false — callers that never degrade are unaffected', () => {
  assert.deepEqual(
    statsCacheHeaders({ fresh: false, ttlMs: 60_000 }),
    { 'Cache-Control': 'public, max-age=60' },
  );
});

test('ttlMs is ignored when fresh=true', () => {
  // The 'no-store' value has no max-age component; any ttl input is moot.
  assert.deepEqual(
    statsCacheHeaders({ fresh: true, ttlMs: 999_999 }),
    { 'Cache-Control': 'no-store' },
  );
});
