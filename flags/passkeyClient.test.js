import test from 'node:test';
import assert from 'node:assert/strict';
import {
  registerPasskey,
  authenticatePasskey,
  bufferToBase64url,
  base64urlToBuffer,
} from './passkeyClient.js';

const DEV_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const IDENTITY_ID = '11111111-2222-3333-4444-555555555555';

// Polyfill atob/btoa for Node test runner if absent. Modern Node has
// them as globals, but pinning saves a flaky failure on older runtimes.
if (typeof globalThis.atob !== 'function') {
  globalThis.atob = (s) => Buffer.from(s, 'base64').toString('binary');
  globalThis.btoa = (s) => Buffer.from(s, 'binary').toString('base64');
}

// ---- buffer codec ---------------------------------------------------------

test('bufferToBase64url + base64urlToBuffer round-trip preserves bytes', () => {
  const input = new Uint8Array([0, 1, 2, 250, 251, 255]);
  const b64 = bufferToBase64url(input);
  const out = new Uint8Array(base64urlToBuffer(b64));
  assert.deepEqual(Array.from(out), Array.from(input));
});

test('base64urlToBuffer accepts unpadded input (standard for WebAuthn)', () => {
  const b64 = bufferToBase64url(new Uint8Array([1, 2, 3]));
  assert.ok(!b64.includes('='));
  const out = new Uint8Array(base64urlToBuffer(b64));
  assert.deepEqual(Array.from(out), [1, 2, 3]);
});

// ---- registerPasskey ------------------------------------------------------

/**
 * @param {{ beginOk?: boolean, verifyOk?: boolean, beginBody?: any, verifyBody?: any }} [cfg]
 */
function makeRegFetch(cfg = {}) {
  const { beginOk = true, verifyOk = true, beginBody, verifyBody } = cfg;
  /** @type {Array<{ url: string, body: any }>} */
  const calls = [];
  /** @param {any} url @param {any} init */
  const impl = async (url, init) => {
    const body = init && init.body ? JSON.parse(init.body) : null;
    calls.push({ url: String(url), body });
    if (url.includes('/begin')) {
      return {
        ok: beginOk,
        status: beginOk ? 200 : 400,
        async json() {
          return beginBody ?? {
            options: {
              challenge: 'YWJjMTIz', // base64url-encoded 'abc123'
              rp: { name: 'Yet Another Quiz', id: 'localhost' },
              user: { id: 'aWQx', name: 'name', displayName: 'name' },
              pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
            },
            signedToken: 'tok.sig',
          };
        },
      };
    }
    // verify
    return {
      ok: verifyOk,
      status: verifyOk ? 201 : 400,
      async json() {
        return verifyBody ?? { identityId: IDENTITY_ID, credentialID: 'cred-1' };
      },
    };
  };
  return { fetchImpl: /** @type {typeof fetch} */ (/** @type {any} */ (impl)), calls };
}

/**
 * @param {{ create?: (...args: any[]) => Promise<any> }} [cfg]
 */
function makeRegCredentials(cfg = {}) {
  const { create } = cfg;
  return /** @type {any} */ ({
    create: create ?? (async () => ({
      id: 'cred-1',
      rawId: new Uint8Array([1, 2, 3]).buffer,
      type: 'public-key',
      authenticatorAttachment: 'platform',
      response: {
        clientDataJSON: new Uint8Array([4, 5, 6]).buffer,
        attestationObject: new Uint8Array([7, 8, 9]).buffer,
        getTransports: () => ['internal'],
      },
      getClientExtensionResults: () => ({}),
    })),
  });
}

test('registerPasskey: happy path returns identityId from verify', async () => {
  const { fetchImpl, calls } = makeRegFetch();
  const credentialsImpl = makeRegCredentials();
  const r = await registerPasskey(DEV_ID, { fetchImpl, credentialsImpl });
  assert.deepEqual(r, { ok: true, identityId: IDENTITY_ID });
  // Two fetch calls: begin, verify
  assert.equal(calls.length, 2);
  assert.ok(calls[0].url.endsWith('/register/begin'));
  assert.equal(calls[0].body.deviceId, DEV_ID);
  assert.ok(calls[1].url.endsWith('/register/verify'));
  assert.equal(calls[1].body.signedToken, 'tok.sig');
  // Response shape is serialized correctly
  assert.equal(typeof calls[1].body.response.rawId, 'string');
  assert.equal(typeof calls[1].body.response.response.attestationObject, 'string');
  assert.deepEqual(calls[1].body.response.response.transports, ['internal']);
});

test('registerPasskey: returns no_webauthn when navigator.credentials is missing', async () => {
  const { fetchImpl } = makeRegFetch();
  const r = await registerPasskey(DEV_ID, { fetchImpl, credentialsImpl: /** @type {any} */ (null) });
  assert.deepEqual(r, { ok: false, reason: 'no_webauthn' });
});

test('registerPasskey: returns cancelled on NotAllowedError', async () => {
  const { fetchImpl } = makeRegFetch();
  const credentialsImpl = makeRegCredentials({
    create: async () => { const e = new Error('user cancelled'); /** @type {any} */(e).name = 'NotAllowedError'; throw e; },
  });
  const r = await registerPasskey(DEV_ID, { fetchImpl, credentialsImpl });
  assert.deepEqual(r, { ok: false, reason: 'cancelled' });
});

test('registerPasskey: returns begin_failed on non-OK begin response', async () => {
  const { fetchImpl } = makeRegFetch({ beginOk: false });
  const credentialsImpl = makeRegCredentials();
  const r = await registerPasskey(DEV_ID, { fetchImpl, credentialsImpl });
  assert.deepEqual(r, { ok: false, reason: 'begin_failed' });
});

test('registerPasskey: returns verify_failed on non-OK verify response', async () => {
  const { fetchImpl } = makeRegFetch({ verifyOk: false });
  const credentialsImpl = makeRegCredentials();
  const r = await registerPasskey(DEV_ID, { fetchImpl, credentialsImpl });
  assert.deepEqual(r, { ok: false, reason: 'verify_failed' });
});

test('registerPasskey: returns verify_failed when verify response lacks identityId', async () => {
  const { fetchImpl } = makeRegFetch({ verifyBody: { ok: true } });
  const credentialsImpl = makeRegCredentials();
  const r = await registerPasskey(DEV_ID, { fetchImpl, credentialsImpl });
  assert.deepEqual(r, { ok: false, reason: 'verify_failed' });
});

test('registerPasskey: returns network_error when fetch throws', async () => {
  const fetchImpl = /** @type {any} */ (async () => { throw new Error('offline'); });
  const credentialsImpl = makeRegCredentials();
  const r = await registerPasskey(DEV_ID, { fetchImpl, credentialsImpl });
  assert.deepEqual(r, { ok: false, reason: 'network_error' });
});

// ---- authenticatePasskey --------------------------------------------------

/**
 * @param {{ beginOk?: boolean, verifyOk?: boolean, verifyBody?: any }} [cfg]
 */
function makeAuthFetch(cfg = {}) {
  const { beginOk = true, verifyOk = true, verifyBody } = cfg;
  /** @type {Array<{ url: string, body: any }>} */
  const calls = [];
  /** @param {any} url @param {any} init */
  const impl = async (url, init) => {
    const body = init && init.body ? JSON.parse(init.body) : null;
    calls.push({ url: String(url), body });
    if (url.includes('/begin')) {
      return {
        ok: beginOk,
        status: beginOk ? 200 : 400,
        async json() {
          return {
            options: { challenge: 'YWJjMTIz', rpId: 'localhost', timeout: 60000 },
            signedToken: 'tok.sig',
          };
        },
      };
    }
    return {
      ok: verifyOk,
      status: verifyOk ? 200 : 400,
      async json() {
        return verifyBody ?? { identityId: IDENTITY_ID, credentialID: 'cred-1' };
      },
    };
  };
  return { fetchImpl: /** @type {typeof fetch} */ (/** @type {any} */ (impl)), calls };
}

/**
 * @param {{ get?: (...args: any[]) => Promise<any> }} [cfg]
 */
function makeAuthCredentials(cfg = {}) {
  const { get } = cfg;
  return /** @type {any} */ ({
    get: get ?? (async () => ({
      id: 'cred-1',
      rawId: new Uint8Array([1, 2, 3]).buffer,
      type: 'public-key',
      authenticatorAttachment: 'platform',
      response: {
        clientDataJSON: new Uint8Array([4]).buffer,
        authenticatorData: new Uint8Array([5]).buffer,
        signature: new Uint8Array([6]).buffer,
        userHandle: new Uint8Array([7]).buffer,
      },
      getClientExtensionResults: () => ({}),
    })),
  });
}

test('authenticatePasskey: happy path returns identityId', async () => {
  const { fetchImpl, calls } = makeAuthFetch();
  const credentialsImpl = makeAuthCredentials();
  const r = await authenticatePasskey({ fetchImpl, credentialsImpl });
  assert.deepEqual(r, { ok: true, identityId: IDENTITY_ID });
  assert.equal(calls.length, 2);
  assert.ok(calls[0].url.endsWith('/auth/begin'));
  assert.ok(calls[1].url.endsWith('/auth/verify'));
  // Response shape includes signature + authenticatorData
  assert.equal(typeof calls[1].body.response.response.signature, 'string');
  assert.equal(typeof calls[1].body.response.response.authenticatorData, 'string');
});

test('authenticatePasskey: returns cancelled on NotAllowedError', async () => {
  const { fetchImpl } = makeAuthFetch();
  const credentialsImpl = makeAuthCredentials({
    get: async () => { const e = new Error('cancel'); /** @type {any} */(e).name = 'NotAllowedError'; throw e; },
  });
  const r = await authenticatePasskey({ fetchImpl, credentialsImpl });
  assert.deepEqual(r, { ok: false, reason: 'cancelled' });
});

test('authenticatePasskey: returns no_webauthn when navigator.credentials missing', async () => {
  const { fetchImpl } = makeAuthFetch();
  const r = await authenticatePasskey({ fetchImpl, credentialsImpl: /** @type {any} */ (null) });
  assert.deepEqual(r, { ok: false, reason: 'no_webauthn' });
});

test('authenticatePasskey: returns begin_failed on non-OK begin', async () => {
  const { fetchImpl } = makeAuthFetch({ beginOk: false });
  const credentialsImpl = makeAuthCredentials();
  const r = await authenticatePasskey({ fetchImpl, credentialsImpl });
  assert.deepEqual(r, { ok: false, reason: 'begin_failed' });
});

test('authenticatePasskey: returns verify_failed when identityId absent in verify body', async () => {
  const { fetchImpl } = makeAuthFetch({ verifyBody: {} });
  const credentialsImpl = makeAuthCredentials();
  const r = await authenticatePasskey({ fetchImpl, credentialsImpl });
  assert.deepEqual(r, { ok: false, reason: 'verify_failed' });
});
