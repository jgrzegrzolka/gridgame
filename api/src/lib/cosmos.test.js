const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { parseConnString, signRequest } = require('./cosmos');

test('parseConnString extracts endpoint and key from canonical form', () => {
  const conn = 'AccountEndpoint=https://x.documents.azure.com:443/;AccountKey=YWJjZA==;';
  const r = parseConnString(conn);
  assert.equal(r.endpoint, 'https://x.documents.azure.com:443/');
  assert.equal(r.key, 'YWJjZA==');
});

test('parseConnString tolerates leading/trailing whitespace inside segments', () => {
  const conn = ' AccountEndpoint = https://x/ ; AccountKey = aGVsbG8= ;';
  const r = parseConnString(conn);
  assert.equal(r.endpoint, 'https://x/');
  assert.equal(r.key, 'aGVsbG8=');
});

test('parseConnString throws on missing AccountEndpoint', () => {
  assert.throws(() => parseConnString('AccountKey=YWJjZA==;'), /Invalid Cosmos connection string/);
});

test('parseConnString throws on missing AccountKey', () => {
  assert.throws(() => parseConnString('AccountEndpoint=https://x/;'), /Invalid Cosmos connection string/);
});

test('parseConnString throws on empty input', () => {
  assert.throws(() => parseConnString(''), /Invalid Cosmos connection string/);
  assert.throws(() => parseConnString(null), /Invalid Cosmos connection string/);
});

test('signRequest produces a deterministic, URL-encoded auth header', () => {
  const sig = signRequest(
    'POST',
    'docs',
    'dbs/yetanotherquiz/colls/dailyResults',
    'Tue, 09 Jun 2026 15:00:00 GMT',
    'YWJjZA==',
  );
  // The whole value is URL-encoded. The literal `=` and `&` in the
  // unencoded form (`type=master&ver=1.0&sig=...`) become %3D and %26.
  assert.match(sig, /^type%3Dmaster%26ver%3D1\.0%26sig%3D[A-Za-z0-9%]+$/);
});

test('signRequest output matches an independently-computed HMAC', () => {
  const verb = 'POST';
  const resourceType = 'docs';
  const resourceLink = 'dbs/d/colls/c';
  const date = 'Tue, 09 Jun 2026 15:00:00 GMT';
  const key = 'YWJjZA=='; // base64 of "abcd"

  const actual = signRequest(verb, resourceType, resourceLink, date, key);

  // Recompute the expected signature inline, then compare.
  const canonical = `post\ndocs\ndbs/d/colls/c\ntue, 09 jun 2026 15:00:00 gmt\n\n`;
  const expectedSig = crypto
    .createHmac('sha256', Buffer.from(key, 'base64'))
    .update(canonical, 'utf8')
    .digest('base64');
  const expected = encodeURIComponent(`type=master&ver=1.0&sig=${expectedSig}`);
  assert.equal(actual, expected);
});

test('signRequest lowercases verb, resourceType, and date', () => {
  const a = signRequest('POST', 'DOCS', 'dbs/d/colls/c', 'TUE, 09 JUN 2026 15:00:00 GMT', 'YWJjZA==');
  const b = signRequest('post', 'docs', 'dbs/d/colls/c', 'tue, 09 jun 2026 15:00:00 gmt', 'YWJjZA==');
  assert.equal(a, b);
});

test('signRequest does NOT lowercase the resourceLink (it is case-sensitive)', () => {
  const a = signRequest('POST', 'docs', 'dbs/MyDb/colls/MyColl', 'tue, 09 jun 2026 15:00:00 gmt', 'YWJjZA==');
  const b = signRequest('POST', 'docs', 'dbs/mydb/colls/mycoll', 'tue, 09 jun 2026 15:00:00 gmt', 'YWJjZA==');
  assert.notEqual(a, b);
});
