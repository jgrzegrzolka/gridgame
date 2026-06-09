const test = require('node:test');
const assert = require('node:assert/strict');
const { readFreshFlag } = require('./queryParams');

const reqFromUrl = (url) => ({ url });

test('readFreshFlag returns true on ?fresh=1', () => {
  assert.equal(readFreshFlag(reqFromUrl('https://x.example/api/v1/daily/stats/4?fresh=1')), true);
});

test('readFreshFlag returns false when fresh param is absent', () => {
  assert.equal(readFreshFlag(reqFromUrl('https://x.example/api/v1/daily/stats/4')), false);
});

test('readFreshFlag returns false on ?fresh=0 (only "1" counts)', () => {
  assert.equal(readFreshFlag(reqFromUrl('https://x.example/api/v1/daily/stats/4?fresh=0')), false);
});

test('readFreshFlag returns false on ?fresh=true (only "1" counts)', () => {
  assert.equal(readFreshFlag(reqFromUrl('https://x.example/api/v1/daily/stats/4?fresh=true')), false);
});

test('readFreshFlag returns false on ?fresh= (empty value)', () => {
  assert.equal(readFreshFlag(reqFromUrl('https://x.example/api/v1/daily/stats/4?fresh=')), false);
});

test('readFreshFlag tolerates a malformed URL by returning false', () => {
  assert.equal(readFreshFlag(reqFromUrl('not a url')), false);
});

test('readFreshFlag returns true with extra query params alongside fresh=1', () => {
  assert.equal(readFreshFlag(reqFromUrl('https://x.example/api/v1/daily/stats/4?other=x&fresh=1&y=z')), true);
});
