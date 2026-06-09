/**
 * Verify a Cloudflare Turnstile token against the siteverify endpoint.
 * Pure: fetch is injected so tests don't touch the network. The Function
 * handler decides what to do when the secret is unset (skip vs reject);
 * this module just answers "is the token valid for this secret?".
 *
 * Returns { ok: true } or { ok: false, reason }. Reasons mirror CF's
 * error-code style but stay stable for our client. We collapse the CF
 * error-codes array into a single reason — the array is mostly useful
 * for debugging, and stable codes are easier for the client to switch on.
 *
 * Cloudflare docs:
 *   https://developers.cloudflare.com/turnstile/get-started/server-side-validation/
 */

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const TOKEN_MIN = 1;
const TOKEN_MAX = 2048;

async function verifyTurnstile({ secret, token, remoteIp, fetchImpl = globalThis.fetch }) {
  if (typeof secret !== 'string' || secret.length === 0) {
    return { ok: false, reason: 'missing_secret' };
  }
  if (typeof token !== 'string' || token.length < TOKEN_MIN || token.length > TOKEN_MAX) {
    return { ok: false, reason: 'missing_token' };
  }

  const body = new URLSearchParams();
  body.set('secret', secret);
  body.set('response', token);
  if (remoteIp && typeof remoteIp === 'string') body.set('remoteip', remoteIp);

  let res;
  try {
    res = await fetchImpl(SITEVERIFY_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
  } catch {
    return { ok: false, reason: 'network_error' };
  }

  if (!res.ok) return { ok: false, reason: 'siteverify_http_error' };

  let json;
  try {
    json = await res.json();
  } catch {
    return { ok: false, reason: 'siteverify_bad_json' };
  }

  if (json && json.success === true) return { ok: true };

  const codes = Array.isArray(json && json['error-codes']) ? json['error-codes'] : [];
  return { ok: false, reason: codes[0] || 'verification_failed' };
}

module.exports = { verifyTurnstile, SITEVERIFY_URL };
