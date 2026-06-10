const test = require('node:test');
const assert = require('node:assert/strict');
const { isLocalRequestUrl } = require('./requestHost');

test('returns true for an http://localhost URL', () => {
  assert.equal(isLocalRequestUrl('http://localhost:7071/api/v1/daily/result'), true);
  assert.equal(isLocalRequestUrl('http://localhost:4280/api/v1/daily/result'), true);
  assert.equal(isLocalRequestUrl('http://localhost/anything'), true);
});

test('returns true for 127.0.0.1', () => {
  assert.equal(isLocalRequestUrl('http://127.0.0.1:7071/api/v1/daily/result'), true);
});

test('returns true for IPv6 loopback', () => {
  // Note: Node's URL parser keeps the brackets:
  //   new URL('http://[::1]:80/').hostname === '[::1]'
  // so the helper matches the bracketed form. Test pinned to catch
  // any future "strip the brackets first" refactor that would break
  // this case silently.
  assert.equal(isLocalRequestUrl('http://[::1]:7071/api/v1/daily/result'), true);
});

test('returns false for prod hostnames', () => {
  assert.equal(isLocalRequestUrl('https://www.yetanotherquiz.com/api/v1/daily/result'), false);
  assert.equal(isLocalRequestUrl('https://yetanotherquiz.com/api/v1/daily/result'), false);
  assert.equal(isLocalRequestUrl('https://black-dune-0ebd24603.7.azurestaticapps.net/api/v1/daily/result'), false);
});

test('returns false for lookalike hostnames', () => {
  // Substring matching would let an attacker host on
  // localhost.example.com and silently opt out of stats. Pinned.
  assert.equal(isLocalRequestUrl('https://localhost.com/api/v1/daily/result'), false);
  assert.equal(isLocalRequestUrl('https://mylocalhost.io/x'), false);
  assert.equal(isLocalRequestUrl('https://127.0.0.10/x'), false);
});

test('returns false for null / undefined / empty / non-string', () => {
  assert.equal(isLocalRequestUrl(null), false);
  assert.equal(isLocalRequestUrl(undefined), false);
  assert.equal(isLocalRequestUrl(''), false);
  // @ts-expect-error — defensive against bad runtime input
  assert.equal(isLocalRequestUrl(42), false);
  // @ts-expect-error
  assert.equal(isLocalRequestUrl({}), false);
});

test('returns false for malformed URL (parse throws)', () => {
  // Fail-safe: if the URL can't be parsed, we treat it as "not local".
  // Better to leak a malformed-URL prod row into stats than to
  // accidentally tag prod rows as local on a parser quirk.
  assert.equal(isLocalRequestUrl('not a url at all'), false);
  assert.equal(isLocalRequestUrl('http://'), false);
});
