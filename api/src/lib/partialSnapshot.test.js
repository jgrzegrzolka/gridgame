const test = require('node:test');
const assert = require('node:assert/strict');

const { isReadFailed, anyReadFailed } = require('./partialSnapshot');

test('isReadFailed: a rejected promise is a failure', () => {
  assert.equal(isReadFailed({ status: 'rejected', reason: new Error('boom') }), true);
});

test('isReadFailed: a fulfilled-but-not-ok query is a failure', () => {
  // The silent case. `dailyMe` only reads `.docs` when `.ok` is true, so a
  // throttled / timed-out query degrades to "no signal" with no rejection
  // and (before this) no log line either.
  assert.equal(isReadFailed({ status: 'fulfilled', value: { ok: false, status: 429 } }), true);
});

test('isReadFailed: a healthy query is not a failure', () => {
  assert.equal(isReadFailed({ status: 'fulfilled', value: { ok: true, docs: [{ id: 'x' }] } }), false);
});

test('isReadFailed: zero docs is a healthy read, not a failure', () => {
  // A player with no profile row / no TTT games legitimately reads empty.
  // Calling that "partial" would suppress the first-earn card for every
  // genuinely new player — the opposite bug.
  assert.equal(isReadFailed({ status: 'fulfilled', value: { ok: true, docs: [] } }), false);
});

test('isReadFailed: a missing or malformed settlement is a failure', () => {
  assert.equal(isReadFailed(undefined), true);
  assert.equal(isReadFailed(null), true);
  assert.equal(isReadFailed({ status: 'fulfilled', value: null }), true);
  assert.equal(isReadFailed({ status: 'fulfilled' }), true);
});

test('isReadFailed: ok must be strictly true', () => {
  assert.equal(isReadFailed({ status: 'fulfilled', value: { ok: 'yes' } }), true);
  assert.equal(isReadFailed({ status: 'fulfilled', value: { ok: 1 } }), true);
});

test('anyReadFailed: true when any one read failed', () => {
  const good = { status: 'fulfilled', value: { ok: true, docs: [] } };
  const bad = { status: 'rejected', reason: new Error('boom') };
  assert.equal(anyReadFailed([good, good, good]), false);
  assert.equal(anyReadFailed([good, bad, good]), true);
  assert.equal(anyReadFailed([bad, bad]), true);
});

test('anyReadFailed: an empty list is not a failure', () => {
  assert.equal(anyReadFailed([]), false);
});
