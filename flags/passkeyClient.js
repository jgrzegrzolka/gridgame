/**
 * Browser-side helper for WebAuthn passkey register + authenticate.
 * Wraps the begin → `navigator.credentials.create/get` → verify
 * round-trip into two never-throws functions. Returns a discriminated
 * `{ ok: true, identityId }` / `{ ok: false, reason }` shape so the
 * caller can route the UI feedback without try/catch.
 *
 * No external dep: WebAuthn's wire JSON is a stable shape, so we
 * hand-roll the ArrayBuffer ↔ base64url conversions ourselves rather
 * than pulling in `@simplewebauthn/browser` (~6 KB) just for the
 * encoding bits. The serialization mirrors `RegistrationResponseJSON`
 * / `AuthenticationResponseJSON` from the spec, which is what the
 * `@simplewebauthn/server` verify functions expect.
 *
 * Lives under `flags/` because every page that wants the passkey
 * flow will import this one helper — `same mechanism = same code`
 * per CLAUDE.md.
 *
 * Reason codes (stable, for i18n routing in the caller):
 *   `no_webauthn`         — browser doesn't expose `navigator.credentials.create/get`
 *   `cancelled`           — user dismissed the platform passkey prompt
 *   `begin_failed`        — server's /begin endpoint returned non-OK
 *   `verify_failed`       — server's /verify endpoint returned non-OK
 *   `network_error`       — fetch threw / browser is offline
 *   `unknown`             — anything else, last-resort bucket
 */

const REGISTER_BEGIN = '/api/v1/passkey/register/begin';
const REGISTER_VERIFY = '/api/v1/passkey/register/verify';
const AUTH_BEGIN = '/api/v1/passkey/auth/begin';
const AUTH_VERIFY = '/api/v1/passkey/auth/verify';

/**
 * @typedef {| { ok: true, identityId: string }
 *           | { ok: false, reason: 'no_webauthn' | 'cancelled' | 'begin_failed' | 'verify_failed' | 'network_error' | 'unknown' }
 *          } PasskeyResult
 *
 * @typedef {{
 *   fetchImpl?: typeof fetch,
 *   credentialsImpl?: CredentialsContainer,
 * }} CommonOpts
 */

/**
 * Register a new passkey on this device. Server mints a fresh
 * identityId; caller persists it (typically to
 * `localStorage.gridgame.identityId`).
 *
 * @param {string} deviceId
 * @param {CommonOpts} [opts]
 * @returns {Promise<PasskeyResult>}
 */
export async function registerPasskey(deviceId, opts = {}) {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const credentialsImpl = opts.credentialsImpl
    ?? (typeof navigator !== 'undefined' ? navigator.credentials : null);
  if (!credentialsImpl || typeof credentialsImpl.create !== 'function') {
    return { ok: false, reason: 'no_webauthn' };
  }

  let begin;
  try {
    const res = await fetchImpl(REGISTER_BEGIN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId }),
    });
    if (!res.ok) return { ok: false, reason: 'begin_failed' };
    begin = await res.json();
  } catch {
    return { ok: false, reason: 'network_error' };
  }
  if (!begin || !begin.options || typeof begin.signedToken !== 'string') {
    return { ok: false, reason: 'begin_failed' };
  }

  let credential;
  try {
    credential = await credentialsImpl.create({
      publicKey: prepareCreationOptions(begin.options),
    });
  } catch (err) {
    const name = err && /** @type {{ name?: string }} */ (err).name;
    if (name === 'NotAllowedError' || name === 'AbortError') {
      return { ok: false, reason: 'cancelled' };
    }
    return { ok: false, reason: 'unknown' };
  }
  if (!credential) return { ok: false, reason: 'cancelled' };

  /** @type {any} */
  let verifyJson;
  try {
    const res = await fetchImpl(REGISTER_VERIFY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        response: serializeRegistrationCredential(credential),
        signedToken: begin.signedToken,
      }),
    });
    if (!res.ok) return { ok: false, reason: 'verify_failed' };
    verifyJson = await res.json();
  } catch {
    return { ok: false, reason: 'network_error' };
  }
  if (!verifyJson || typeof verifyJson.identityId !== 'string' || verifyJson.identityId.length === 0) {
    return { ok: false, reason: 'verify_failed' };
  }
  return { ok: true, identityId: verifyJson.identityId };
}

/**
 * Authenticate with an existing passkey on this device. Used on a
 * fresh device to "claim" the identity that was already established
 * on another device (via synced passkey or a roaming security key).
 *
 * @param {CommonOpts} [opts]
 * @returns {Promise<PasskeyResult>}
 */
export async function authenticatePasskey(opts = {}) {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const credentialsImpl = opts.credentialsImpl
    ?? (typeof navigator !== 'undefined' ? navigator.credentials : null);
  if (!credentialsImpl || typeof credentialsImpl.get !== 'function') {
    return { ok: false, reason: 'no_webauthn' };
  }

  let begin;
  try {
    const res = await fetchImpl(AUTH_BEGIN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    if (!res.ok) return { ok: false, reason: 'begin_failed' };
    begin = await res.json();
  } catch {
    return { ok: false, reason: 'network_error' };
  }
  if (!begin || !begin.options || typeof begin.signedToken !== 'string') {
    return { ok: false, reason: 'begin_failed' };
  }

  let assertion;
  try {
    assertion = await credentialsImpl.get({
      publicKey: prepareRequestOptions(begin.options),
    });
  } catch (err) {
    const name = err && /** @type {{ name?: string }} */ (err).name;
    if (name === 'NotAllowedError' || name === 'AbortError') {
      return { ok: false, reason: 'cancelled' };
    }
    return { ok: false, reason: 'unknown' };
  }
  if (!assertion) return { ok: false, reason: 'cancelled' };

  /** @type {any} */
  let verifyJson;
  try {
    const res = await fetchImpl(AUTH_VERIFY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        response: serializeAuthenticationCredential(assertion),
        signedToken: begin.signedToken,
      }),
    });
    if (!res.ok) return { ok: false, reason: 'verify_failed' };
    verifyJson = await res.json();
  } catch {
    return { ok: false, reason: 'network_error' };
  }
  if (!verifyJson || typeof verifyJson.identityId !== 'string' || verifyJson.identityId.length === 0) {
    return { ok: false, reason: 'verify_failed' };
  }
  return { ok: true, identityId: verifyJson.identityId };
}

// ---- ArrayBuffer ↔ base64url --------------------------------------------

/**
 * @param {ArrayBuffer | Uint8Array} buf
 * @returns {string}
 */
export function bufferToBase64url(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * @param {string} s
 * @returns {ArrayBuffer}
 */
export function base64urlToBuffer(s) {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + pad;
  const bin = atob(b64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}

// ---- WebAuthn options + credential serialization -------------------------

/**
 * The server returns options with base64url-encoded buffer fields
 * (`challenge`, `user.id`, `excludeCredentials[*].id`). Decode them
 * into ArrayBuffers so `navigator.credentials.create()` accepts them.
 *
 * @param {any} options
 * @returns {any}
 */
function prepareCreationOptions(options) {
  const out = { ...options };
  if (typeof out.challenge === 'string') out.challenge = base64urlToBuffer(out.challenge);
  if (out.user && typeof out.user.id === 'string') {
    out.user = { ...out.user, id: base64urlToBuffer(out.user.id) };
  }
  if (Array.isArray(out.excludeCredentials)) {
    out.excludeCredentials = out.excludeCredentials.map((/** @type {any} */ c) => ({
      ...c,
      id: typeof c.id === 'string' ? base64urlToBuffer(c.id) : c.id,
    }));
  }
  return out;
}

/**
 * Same as above for the authentication request options.
 *
 * @param {any} options
 * @returns {any}
 */
function prepareRequestOptions(options) {
  const out = { ...options };
  if (typeof out.challenge === 'string') out.challenge = base64urlToBuffer(out.challenge);
  if (Array.isArray(out.allowCredentials)) {
    out.allowCredentials = out.allowCredentials.map((/** @type {any} */ c) => ({
      ...c,
      id: typeof c.id === 'string' ? base64urlToBuffer(c.id) : c.id,
    }));
  }
  return out;
}

/**
 * Serialize a registration `PublicKeyCredential` into the JSON shape
 * `@simplewebauthn/server`'s `verifyRegistrationResponse` expects
 * (matches W3C `RegistrationResponseJSON`).
 *
 * @param {any} cred
 */
function serializeRegistrationCredential(cred) {
  const out = {
    id: cred.id,
    rawId: bufferToBase64url(cred.rawId),
    type: cred.type,
    response: {
      clientDataJSON: bufferToBase64url(cred.response.clientDataJSON),
      attestationObject: bufferToBase64url(cred.response.attestationObject),
    },
    clientExtensionResults: typeof cred.getClientExtensionResults === 'function'
      ? cred.getClientExtensionResults()
      : {},
  };
  if (typeof cred.response.getTransports === 'function') {
    /** @type {any} */ (out.response).transports = cred.response.getTransports();
  }
  if (cred.authenticatorAttachment) {
    /** @type {any} */ (out).authenticatorAttachment = cred.authenticatorAttachment;
  }
  return out;
}

/**
 * Serialize an authentication `PublicKeyCredential` to W3C
 * `AuthenticationResponseJSON` for the server.
 *
 * @param {any} cred
 */
function serializeAuthenticationCredential(cred) {
  /** @type {any} */
  const out = {
    id: cred.id,
    rawId: bufferToBase64url(cred.rawId),
    type: cred.type,
    response: {
      clientDataJSON: bufferToBase64url(cred.response.clientDataJSON),
      authenticatorData: bufferToBase64url(cred.response.authenticatorData),
      signature: bufferToBase64url(cred.response.signature),
    },
    clientExtensionResults: typeof cred.getClientExtensionResults === 'function'
      ? cred.getClientExtensionResults()
      : {},
  };
  if (cred.response.userHandle) {
    out.response.userHandle = bufferToBase64url(cred.response.userHandle);
  }
  if (cred.authenticatorAttachment) {
    out.authenticatorAttachment = cred.authenticatorAttachment;
  }
  return out;
}
