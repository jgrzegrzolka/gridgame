const test = require('node:test');
const assert = require('node:assert/strict');
const { isTrueFlag } = require('./envFlags');

test('true for the literal string "true"', () => {
  assert.equal(isTrueFlag('true'), true);
});

test('false for "True" / "TRUE" (case-sensitive)', () => {
  assert.equal(isTrueFlag('True'), false);
  assert.equal(isTrueFlag('TRUE'), false);
});

test('false for "false" / "0" / "1" (only "true" counts)', () => {
  assert.equal(isTrueFlag('false'), false);
  assert.equal(isTrueFlag('0'), false);
  assert.equal(isTrueFlag('1'), false);
});

test('false for undefined (env var not set)', () => {
  assert.equal(isTrueFlag(undefined), false);
});

test('false for empty string', () => {
  assert.equal(isTrueFlag(''), false);
});

test('false for non-string inputs (defensive)', () => {
  assert.equal(isTrueFlag(/** @type {any} */ (null)), false);
  assert.equal(isTrueFlag(/** @type {any} */ (true)), false);
  assert.equal(isTrueFlag(/** @type {any} */ (1)), false);
});
