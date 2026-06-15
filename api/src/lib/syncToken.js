/**
 * HMAC-signed claim token for the cross-device QR-claim flow.
 *
 * Device 1 calls /sync/claim/token to mint a signed token tied to
 * its own deviceId. The token is encoded into a QR code that device
 * 2 scans. The scan lands device 2 on `/profile/sync/?claim=<token>`;
 * it redeems the token via /sync/claim/redeem, which validates the
 * HMAC + expiry and returns the target deviceId to adopt. Then the
 * server-side merge runs and device 2's data folds into device 1's
 * namespace.
 *
 * Token format: `<base64url(payloadJson)>.<base64url(hmacSha256)>`
 * Payload: { deviceId, scope, expiresAt }
 *
 * Stateless: no per-token row in Cosmos. The HMAC secret + the 5-
 * minute expiry are the entire trust story. Single-use enforcement
 * isn't done server-side (would require a transient store) — a
 * leaked token is a 5-min window of risk and the attack surface is
 * "polluted scores" on a hobby site with no PII. Acceptable.
 *
 * Time is injected for testability.
 */

const crypto = require('node:crypto');

const DEFAULT_TTL_MS = 5 * 60 * 1000;

/**
 * @typedef {{
 *   deviceId: string,
 *   scope: 'claim',
 *   expiresAt: number,
 * }} TokenPayload
 */

/**
 * @param {{
 *   secret: string,
 *   payload: Omit<TokenPayload, 'expiresAt'>,
 *   now: number,
 *   ttlMs?: number,
 * }} args
 * @returns {string}
 */
function signToken({ secret, payload, now, ttlMs = DEFAULT_TTL_MS }) {
  /** @type {TokenPayload} */
  const full = { ...payload, expiresAt: now + ttlMs };
  const body = b64url(Buffer.from(JSON.stringify(full)));
  const sig = b64url(hmac(secret, body));
  return `${body}.${sig}`;
}

/**
 * @param {{
 *   secret: string,
 *   token: unknown,
 *   now: number,
 *   expectedScope: 'claim',
 * }} args
 * @returns {| { ok: true, payload: TokenPayload }
 *            | { ok: false, error: 'invalid_token' | 'expired_token' | 'scope_mismatch' }}
 */
function verifyToken({ secret, token, now, expectedScope }) {
  if (typeof token !== 'string' || token.length === 0) {
    return { ok: false, error: 'invalid_token' };
  }
  const parts = token.split('.');
  if (parts.length !== 2) {
    return { ok: false, error: 'invalid_token' };
  }
  const [body, sig] = parts;
  const expectedSig = b64url(hmac(secret, body));
  if (!constantTimeEqual(sig, expectedSig)) {
    return { ok: false, error: 'invalid_token' };
  }
  let payload;
  try {
    payload = JSON.parse(Buffer.from(b64urlDecode(body)).toString('utf8'));
  } catch {
    return { ok: false, error: 'invalid_token' };
  }
  if (!payload || typeof payload !== 'object') {
    return { ok: false, error: 'invalid_token' };
  }
  if (typeof payload.deviceId !== 'string' || payload.deviceId.length === 0) {
    return { ok: false, error: 'invalid_token' };
  }
  if (payload.scope !== expectedScope) {
    return { ok: false, error: 'scope_mismatch' };
  }
  if (typeof payload.expiresAt !== 'number' || payload.expiresAt < now) {
    return { ok: false, error: 'expired_token' };
  }
  return { ok: true, payload };
}

/** @param {string} secret @param {string} input @returns {Buffer} */
function hmac(secret, input) {
  return crypto.createHmac('sha256', secret).update(input).digest();
}

/** @param {Buffer} buf @returns {string} */
function b64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** @param {string} s @returns {Buffer} */
function b64urlDecode(s) {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
}

/** @param {string} a @param {string} b @returns {boolean} */
function constantTimeEqual(a, b) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) {
    crypto.timingSafeEqual(ab, Buffer.alloc(ab.length));
    return false;
  }
  return crypto.timingSafeEqual(ab, bb);
}

module.exports = { signToken, verifyToken, DEFAULT_TTL_MS };
