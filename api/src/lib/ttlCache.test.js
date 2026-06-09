const test = require('node:test');
const assert = require('node:assert/strict');
const { createTtlCache } = require('./ttlCache');

test('get on a missing key returns undefined', () => {
  const c = createTtlCache({ ttlMs: 1000 });
  assert.equal(c.get('x', 0), undefined);
});

test('set then get within ttl returns the value', () => {
  const c = createTtlCache({ ttlMs: 1000 });
  c.set('x', 'hello', 0);
  assert.equal(c.get('x', 500), 'hello');
});

test('get exactly at expiry returns undefined (boundary is inclusive)', () => {
  const c = createTtlCache({ ttlMs: 1000 });
  c.set('x', 'hello', 0);
  assert.equal(c.get('x', 1000), undefined);
});

test('get after expiry returns undefined', () => {
  const c = createTtlCache({ ttlMs: 1000 });
  c.set('x', 'hello', 0);
  assert.equal(c.get('x', 1500), undefined);
});

test('set refreshes the expiry', () => {
  const c = createTtlCache({ ttlMs: 1000 });
  c.set('x', 'one', 0);
  c.set('x', 'two', 800);
  // Old expiry would have fired at 1000; new expiry at 1800.
  assert.equal(c.get('x', 1500), 'two');
  assert.equal(c.get('x', 1800), undefined);
});

test('different keys are independent', () => {
  const c = createTtlCache({ ttlMs: 1000 });
  c.set('a', 1, 0);
  c.set('b', 2, 500);
  assert.equal(c.get('a', 999), 1);
  assert.equal(c.get('b', 999), 2);
  assert.equal(c.get('a', 1001), undefined);
  assert.equal(c.get('b', 1001), 2);
});

test('non-primitive values round-trip', () => {
  const c = createTtlCache({ ttlMs: 1000 });
  const obj = { foundCodes: { ch: 3 }, totalAttempts: 10 };
  c.set('p7', obj, 0);
  assert.equal(c.get('p7', 100), obj);
});
