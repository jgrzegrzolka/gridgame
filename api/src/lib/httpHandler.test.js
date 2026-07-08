'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { wrapHandler, pickTelemetryIds } = require('./httpHandler');

// A minimal context that records info() calls, like the host's ILogger.
function fakeContext(functionName = 'demo') {
  const infos = [];
  return {
    functionName,
    info: (...args) => infos.push(args),
    infos,
  };
}

// A query object shaped like URLSearchParams (what req.query is in v4).
function query(map) {
  return { get: (k) => (k in map ? map[k] : null) };
}

// A request whose clone().json() yields `body`; records if the ORIGINAL
// body was touched so we can prove we never consume it.
function fakeReq({ method = 'GET', body, q = {} } = {}) {
  let originalRead = false;
  return {
    method,
    query: query(q),
    json: async () => { originalRead = true; return body; },
    clone: () => ({ json: async () => body }),
    wasOriginalRead: () => originalRead,
  };
}

test('pickTelemetryIds: reads deviceId + puzzleId from body', () => {
  assert.deepStrictEqual(
    pickTelemetryIds(query({}), { deviceId: 'd1', puzzleId: 'p1' }),
    { deviceId: 'd1', puzzleId: 'p1' },
  );
});

test('pickTelemetryIds: reads from query when body absent', () => {
  assert.deepStrictEqual(
    pickTelemetryIds(query({ deviceId: 'dq' }), undefined),
    { deviceId: 'dq' },
  );
});

test('pickTelemetryIds: body wins over query for the same key', () => {
  assert.deepStrictEqual(
    pickTelemetryIds(query({ deviceId: 'dq' }), { deviceId: 'db' }),
    { deviceId: 'db' },
  );
});

test('pickTelemetryIds: omits missing / non-string values', () => {
  assert.deepStrictEqual(pickTelemetryIds(query({}), {}), {});
  assert.deepStrictEqual(pickTelemetryIds(query({}), { deviceId: 123 }), {});
  assert.deepStrictEqual(pickTelemetryIds(undefined, undefined), {});
});

test('wrapHandler: emits a correlated trace with deviceId from a POST body', async () => {
  const ctx = fakeContext();
  const req = fakeReq({ method: 'POST', body: { deviceId: 'd1', puzzleId: 'p1' } });
  const wrapped = wrapHandler(async () => ({ status: 204 }));
  await wrapped(req, ctx);
  assert.deepStrictEqual(ctx.infos, [['apiTelemetry', { deviceId: 'd1', puzzleId: 'p1', status: 204 }]]);
});

test('wrapHandler: never consumes the original request body', async () => {
  const req = fakeReq({ method: 'POST', body: { deviceId: 'd1' } });
  const wrapped = wrapHandler(async () => ({ status: 204 }));
  await wrapped(req, fakeContext());
  assert.strictEqual(req.wasOriginalRead(), false);
});

test('wrapHandler: reads deviceId from the query string on a GET', async () => {
  const ctx = fakeContext();
  const req = fakeReq({ method: 'GET', q: { deviceId: 'dq' } });
  const wrapped = wrapHandler(async () => ({ status: 200 }));
  await wrapped(req, ctx);
  assert.deepStrictEqual(ctx.infos, [['apiTelemetry', { deviceId: 'dq', status: 200 }]]);
});

test('wrapHandler: emits no trace when there is no id (e.g. health check)', async () => {
  const ctx = fakeContext();
  const req = fakeReq({ method: 'GET' });
  const wrapped = wrapHandler(async () => ({ status: 200 }));
  await wrapped(req, ctx);
  assert.deepStrictEqual(ctx.infos, []);
});

test('wrapHandler: a non-JSON POST body degrades to query, no throw', async () => {
  const ctx = fakeContext();
  const req = {
    method: 'POST',
    query: query({ deviceId: 'dq' }),
    clone: () => ({ json: async () => { throw new Error('not json'); } }),
  };
  const wrapped = wrapHandler(async () => ({ status: 400 }));
  await wrapped(req, ctx);
  assert.deepStrictEqual(ctx.infos, [['apiTelemetry', { deviceId: 'dq', status: 400 }]]);
});

test('wrapHandler: 4xx passes through, no throw', async () => {
  for (const status of [400, 403, 409, 429]) {
    const res = { status, jsonBody: { error: 'x' } };
    const wrapped = wrapHandler(async () => res);
    assert.strictEqual(await wrapped(fakeReq(), fakeContext()), res, `status ${status}`);
  }
});

test('wrapHandler: 5xx throws so the invocation is a failure', async () => {
  for (const status of [500, 502, 503]) {
    const wrapped = wrapHandler(async () => ({ status }));
    await assert.rejects(() => wrapped(fakeReq(), fakeContext('dailyResult')), /server_error: dailyResult returned /);
  }
});

test('wrapHandler: forwards req and context to the wrapped handler', async () => {
  const req = fakeReq({ method: 'GET', q: { deviceId: 'd' } });
  const ctx = fakeContext();
  let seen;
  const wrapped = wrapHandler(async (r, c) => { seen = { r, c }; return { status: 200 }; });
  await wrapped(req, ctx);
  assert.strictEqual(seen.r, req);
  assert.strictEqual(seen.c, ctx);
});

test('wrapHandler: propagates an error the handler itself throws', async () => {
  const boom = new Error('boom');
  const wrapped = wrapHandler(async () => { throw boom; });
  await assert.rejects(() => wrapped(fakeReq(), fakeContext()), /boom/);
});
