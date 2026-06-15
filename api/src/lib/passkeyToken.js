/**
 * HMAC-signed token wrap/unwrap for the WebAuthn challenge round-trip.
 *
 * WebAuthn's verify step requires the `expectedChallenge` that was
 * issued at the begin step. The standard pattern is to stash the
 * challenge in a server-side session keyed by sessionId, which the
 * client returns on verify. Serverless makes this expensive — we'd
 * need a fourth Cosmos container with a short TTL just for transient
 * state.
 *
 * Stateless alternative used here: wrap the challenge in a payload
 * `{ challenge, scope, deviceIdHint?, expiresAt }`, HMAC it with a
 * server-side secret (env `PASSKEY_HMAC_SECRET`), return the opaque
 * blob to the client at begin, and demand it back at verify. The
 * verify endpoint HMACs the blob again, compares (constant-time), and
 * rejects if the expiry has passed. Identical security to a session
 * row, zero storage cost.
 *
 * `scope` distinguishes `'register'` from `'auth'` so a register
 * token can't be replayed against the auth endpoint.
 *
 * `expiresAt` cap: 5 minutes. Plenty for a user to complete the
 * platform passkey prompt; short enough that a leaked token has a
 * tight blast radius.
 *
 * Token format: `<base64url(payloadJson)>.<base64url(hmacSha256)>`
 *
 * Pure: deterministic given (secret, payload). Time + crypto are
 * injected so tests can pin them.
 */

const crypto = require('node:crypto');

const TTL_MS = 5 * 60 * 1000;

/**
 * @typedef {{
 *   challenge: string,
 *   scope: 'register' | 'auth',
 *   deviceIdHint?: string,
 *   identityId?: string,
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
function signToken({ secret, payload, now, ttlMs = TTL_MS }) {
  /** @type {TokenPayload} */
  const full = { ...payload, expiresAt: now + ttlMs };
  const body = b64url(Buffer.from(JSON.stringify(full)));
  const sig = b64url(hmac(secret, body));
  return `${body}.${sig}`;
}

/**
 * Verify HMAC + expiry. Returns the decoded payload on success.
 *
 * @param {{
 *   secret: string,
 *   token: unknown,
 *   now: number,
 *   expectedScope: 'register' | 'auth',
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
  if (typeof payload.challenge !== 'string' || payload.challenge.length === 0) {
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

/**
 * Constant-time string comparison. crypto.timingSafeEqual throws on
 * length mismatch — pad both sides to the longer length so attackers
 * can't infer the signature length from timing of the length-check
 * branch.
 *
 * @param {string} a @param {string} b @returns {boolean}
 */
function constantTimeEqual(a, b) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) {
    // Still do a timing-safe compare against a same-length buffer so
    // the branch isn't observably faster on length mismatch.
    crypto.timingSafeEqual(ab, Buffer.alloc(ab.length));
    return false;
  }
  return crypto.timingSafeEqual(ab, bb);
}

module.exports = { signToken, verifyToken, TTL_MS };
