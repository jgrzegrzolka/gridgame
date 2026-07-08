'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { wrapServerErrorsAsFailures } = require('./httpFailure');

const ctx = { functionName: 'demo' };

test('passes through a 2xx response unchanged', async () => {
  const res = { status: 204 };
  const wrapped = wrapServerErrorsAsFailures(async () => res);
  assert.strictEqual(await wrapped({}, ctx), res);
});

test('passes through a 200 with a body unchanged', async () => {
  const res = { status: 200, jsonBody: { ok: true } };
  const wrapped = wrapServerErrorsAsFailures(async () => res);
  assert.strictEqual(await wrapped({}, ctx), res);
});

test('does NOT throw for 4xx (client errors stay successful requests)', async () => {
  for (const status of [400, 403, 409, 429, 499]) {
    const res = { status, jsonBody: { error: 'x' } };
    const wrapped = wrapServerErrorsAsFailures(async () => res);
    assert.strictEqual(await wrapped({}, ctx), res, `status ${status} should pass through`);
  }
});

test('throws for 5xx so the invocation is recorded as a failure', async () => {
  for (const status of [500, 502, 503]) {
    const wrapped = wrapServerErrorsAsFailures(async () => ({ status, jsonBody: { error: 'server_error' } }));
    await assert.rejects(() => wrapped({}, ctx), /server_error: demo returned /);
  }
});

test('names the function in the thrown message', async () => {
  const wrapped = wrapServerErrorsAsFailures(async () => ({ status: 500 }));
  await assert.rejects(() => wrapped({}, { functionName: 'dailyResult' }), /dailyResult returned 500/);
});

test('falls back to "unknown" when context has no functionName', async () => {
  const wrapped = wrapServerErrorsAsFailures(async () => ({ status: 500 }));
  await assert.rejects(() => wrapped({}, {}), /unknown returned 500/);
});

test('treats a response without a numeric status as 200 (no throw)', async () => {
  const res = { jsonBody: { ok: true } };
  const wrapped = wrapServerErrorsAsFailures(async () => res);
  assert.strictEqual(await wrapped({}, ctx), res);
});

test('forwards req and context to the wrapped handler', async () => {
  const req = { url: 'https://x/api/y' };
  let seen;
  const wrapped = wrapServerErrorsAsFailures(async (r, c) => { seen = { r, c }; return { status: 200 }; });
  await wrapped(req, ctx);
  assert.strictEqual(seen.r, req);
  assert.strictEqual(seen.c, ctx);
});

test('propagates an error the handler itself throws', async () => {
  const boom = new Error('boom');
  const wrapped = wrapServerErrorsAsFailures(async () => { throw boom; });
  await assert.rejects(() => wrapped({}, ctx), /boom/);
});
