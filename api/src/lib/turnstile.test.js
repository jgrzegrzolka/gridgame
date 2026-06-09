const test = require('node:test');
const assert = require('node:assert/strict');
const { verifyTurnstile, SITEVERIFY_URL } = require('./turnstile');

const fakeRes = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

const okFetch = () => fakeRes(200, { success: true });

test('missing secret returns missing_secret without calling fetch', async () => {
  let called = false;
  const r = await verifyTurnstile({
    secret: '', token: 'abc', fetchImpl: async () => { called = true; return okFetch(); },
  });
  assert.deepEqual(r, { ok: false, reason: 'missing_secret' });
  assert.equal(called, false);
});

test('non-string secret returns missing_secret', async () => {
  const r = await verifyTurnstile({ secret: null, token: 'abc', fetchImpl: async () => okFetch() });
  assert.deepEqual(r, { ok: false, reason: 'missing_secret' });
});

test('missing token returns missing_token without calling fetch', async () => {
  let called = false;
  const r = await verifyTurnstile({
    secret: 's', token: '', fetchImpl: async () => { called = true; return okFetch(); },
  });
  assert.deepEqual(r, { ok: false, reason: 'missing_token' });
  assert.equal(called, false);
});

test('token over 2048 chars returns missing_token', async () => {
  const long = 'x'.repeat(2049);
  const r = await verifyTurnstile({ secret: 's', token: long, fetchImpl: async () => okFetch() });
  assert.deepEqual(r, { ok: false, reason: 'missing_token' });
});

test('cloudflare returns success:true → ok', async () => {
  const r = await verifyTurnstile({
    secret: 's', token: 'tok', fetchImpl: async () => fakeRes(200, { success: true }),
  });
  assert.deepEqual(r, { ok: true });
});

test('cloudflare returns success:false with error-codes → first code is the reason', async () => {
  const r = await verifyTurnstile({
    secret: 's', token: 'tok',
    fetchImpl: async () => fakeRes(200, { success: false, 'error-codes': ['invalid-input-response', 'whatever'] }),
  });
  assert.deepEqual(r, { ok: false, reason: 'invalid-input-response' });
});

test('cloudflare returns success:false with no error-codes → verification_failed', async () => {
  const r = await verifyTurnstile({
    secret: 's', token: 'tok', fetchImpl: async () => fakeRes(200, { success: false }),
  });
  assert.deepEqual(r, { ok: false, reason: 'verification_failed' });
});

test('cloudflare returns non-2xx → siteverify_http_error', async () => {
  const r = await verifyTurnstile({
    secret: 's', token: 'tok', fetchImpl: async () => fakeRes(503, {}),
  });
  assert.deepEqual(r, { ok: false, reason: 'siteverify_http_error' });
});

test('fetch throws → network_error (not surfaced to caller)', async () => {
  const r = await verifyTurnstile({
    secret: 's', token: 'tok', fetchImpl: async () => { throw new Error('boom'); },
  });
  assert.deepEqual(r, { ok: false, reason: 'network_error' });
});

test('cloudflare returns malformed JSON → siteverify_bad_json', async () => {
  const r = await verifyTurnstile({
    secret: 's', token: 'tok',
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => { throw new Error('bad'); } }),
  });
  assert.deepEqual(r, { ok: false, reason: 'siteverify_bad_json' });
});

test('POSTs to the official siteverify URL with form-encoded secret, response, remoteip', async () => {
  let captured = {};
  const r = await verifyTurnstile({
    secret: 'shh', token: 'tok123', remoteIp: '1.2.3.4',
    fetchImpl: async (url, init) => {
      captured = { url, method: init.method, contentType: init.headers['content-type'], body: init.body };
      return fakeRes(200, { success: true });
    },
  });
  assert.equal(r.ok, true);
  assert.equal(captured.url, SITEVERIFY_URL);
  assert.equal(captured.method, 'POST');
  assert.equal(captured.contentType, 'application/x-www-form-urlencoded');
  const params = new URLSearchParams(captured.body);
  assert.equal(params.get('secret'), 'shh');
  assert.equal(params.get('response'), 'tok123');
  assert.equal(params.get('remoteip'), '1.2.3.4');
});

test('remoteIp is omitted from the form when not provided', async () => {
  let body = '';
  await verifyTurnstile({
    secret: 's', token: 't',
    fetchImpl: async (_url, init) => { body = init.body; return fakeRes(200, { success: true }); },
  });
  const params = new URLSearchParams(body);
  assert.equal(params.has('remoteip'), false);
});
