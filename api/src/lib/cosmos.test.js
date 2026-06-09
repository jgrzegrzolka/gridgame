const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { parseConnString, signRequest, queryDocs } = require('./cosmos');

const CONN = 'AccountEndpoint=https://x.documents.azure.com:443/;AccountKey=YWJjZA==;';

// Build a minimal fetch-like Response. `continuation` becomes the
// x-ms-continuation header value when present, so a sequence of pages
// can be expressed as: [{ Documents: [...], continuation: 'tok' }, { Documents: [...] }].
const mockRes = ({ status = 200, Documents = [], continuation = null }) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: (n) => (n === 'x-ms-continuation' ? continuation : null) },
  json: async () => ({ Documents }),
  text: async () => '',
});

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

test('queryDocs single page returns the docs', async () => {
  const r = await queryDocs({
    connString: CONN, dbName: 'db', containerName: 'c',
    query: 'SELECT * FROM c', parameters: [], partitionKey: 7,
    fetchImpl: async () => mockRes({ Documents: [{ a: 1 }, { a: 2 }] }),
  });
  assert.deepEqual(r, { ok: true, docs: [{ a: 1 }, { a: 2 }] });
});

test('queryDocs follows x-ms-continuation across pages and accumulates docs', async () => {
  const pages = [
    mockRes({ Documents: [{ n: 1 }], continuation: 'tok1' }),
    mockRes({ Documents: [{ n: 2 }, { n: 3 }], continuation: 'tok2' }),
    mockRes({ Documents: [{ n: 4 }] }), // no continuation → end
  ];
  let call = 0;
  const seenContinuations = [];
  const r = await queryDocs({
    connString: CONN, dbName: 'db', containerName: 'c',
    query: 'SELECT * FROM c', parameters: [], partitionKey: 7,
    fetchImpl: async (_url, init) => {
      seenContinuations.push(init.headers['x-ms-continuation']);
      return pages[call++];
    },
  });
  assert.deepEqual(r, { ok: true, docs: [{ n: 1 }, { n: 2 }, { n: 3 }, { n: 4 }] });
  // First call has no continuation; subsequent calls echo back the previous page's token.
  assert.deepEqual(seenContinuations, [undefined, 'tok1', 'tok2']);
});

test('queryDocs returns cosmos_error on non-2xx HTTP', async () => {
  const r = await queryDocs({
    connString: CONN, dbName: 'db', containerName: 'c',
    query: 'SELECT * FROM c', parameters: [], partitionKey: 7,
    fetchImpl: async () => ({
      ok: false, status: 429,
      headers: { get: () => null },
      json: async () => ({}),
      text: async () => 'too many requests',
    }),
  });
  assert.deepEqual(r, { ok: false, error: 'cosmos_error', status: 429, body: 'too many requests' });
});

test('queryDocs sends parameterized body, isquery flag, and partition key header', async () => {
  let captured;
  await queryDocs({
    connString: CONN, dbName: 'db', containerName: 'col',
    query: 'SELECT c.foundCodes FROM c WHERE c.puzzleId = @pid',
    parameters: [{ name: '@pid', value: 7 }],
    partitionKey: 7,
    fetchImpl: async (url, init) => {
      captured = { url, init };
      return mockRes({ Documents: [] });
    },
  });
  assert.equal(captured.url, 'https://x.documents.azure.com:443/dbs/db/colls/col/docs');
  assert.equal(captured.init.method, 'POST');
  assert.equal(captured.init.headers['Content-Type'], 'application/query+json');
  assert.equal(captured.init.headers['x-ms-documentdb-isquery'], 'True');
  assert.equal(captured.init.headers['x-ms-documentdb-partitionkey'], '[7]');
  assert.match(captured.init.headers['Authorization'], /^type%3Dmaster/);
  const body = JSON.parse(captured.init.body);
  assert.equal(body.query, 'SELECT c.foundCodes FROM c WHERE c.puzzleId = @pid');
  assert.deepEqual(body.parameters, [{ name: '@pid', value: 7 }]);
});

test('queryDocs returns empty docs when Documents is absent', async () => {
  const r = await queryDocs({
    connString: CONN, dbName: 'db', containerName: 'c',
    query: 'SELECT * FROM c', parameters: [], partitionKey: 7,
    fetchImpl: async () => ({
      ok: true, status: 200,
      headers: { get: () => null },
      json: async () => ({}), // no Documents field at all
    }),
  });
  assert.deepEqual(r, { ok: true, docs: [] });
});
