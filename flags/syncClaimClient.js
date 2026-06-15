/**
 * Browser-side helpers for the QR-claim cross-device link flow
 * (Feature C, post-passkey rewrite). Two endpoints:
 *
 *   /api/v1/sync/claim/token  — device 1 mints a signed token tied
 *                               to its own deviceId. Returns the
 *                               token, the URL that should be
 *                               encoded into a QR, and the SVG
 *                               markup of the QR itself.
 *   /api/v1/sync/claim/redeem — device 2, after scanning + landing
 *                               on /profile/sync/?claim=<token>,
 *                               validates the token and learns the
 *                               target deviceId to adopt (+ the
 *                               target's nickname for the
 *                               confirmation step).
 *
 * Both helpers never-throw and return discriminated results so the
 * UI can route feedback without try/catch.
 */

const MINT_ENDPOINT = '/api/v1/sync/claim/token';
const REDEEM_ENDPOINT = '/api/v1/sync/claim/redeem';

/**
 * @typedef {| { ok: true, token: string, claimUrl: string, qrSvg: string }
 *           | { ok: false, reason: 'network_error' | 'mint_failed' }
 *          } MintResult
 *
 * @typedef {| { ok: true, targetDeviceId: string, targetNickname: string | null }
 *           | { ok: false, reason: 'network_error' | 'redeem_failed' | 'expired_token' | 'invalid_token' }
 *          } RedeemResult
 */

/**
 * @param {{ deviceId: string, fetchImpl?: typeof fetch }} args
 * @returns {Promise<MintResult>}
 */
export async function mintClaimToken({ deviceId, fetchImpl = globalThis.fetch }) {
  if (typeof deviceId !== 'string' || deviceId.length === 0) {
    return { ok: false, reason: 'mint_failed' };
  }
  let res;
  try {
    res = await fetchImpl(MINT_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ deviceId }),
    });
  } catch {
    return { ok: false, reason: 'network_error' };
  }
  if (!res.ok) return { ok: false, reason: 'mint_failed' };
  /** @type {any} */
  let json;
  try { json = await res.json(); } catch { return { ok: false, reason: 'mint_failed' }; }
  if (typeof json.token !== 'string' || typeof json.qrSvg !== 'string') {
    return { ok: false, reason: 'mint_failed' };
  }
  return {
    ok: true,
    token: json.token,
    claimUrl: typeof json.claimUrl === 'string' ? json.claimUrl : '',
    qrSvg: json.qrSvg,
  };
}

/**
 * @param {{ token: string, fetchImpl?: typeof fetch }} args
 * @returns {Promise<RedeemResult>}
 */
export async function redeemClaimToken({ token, fetchImpl = globalThis.fetch }) {
  if (typeof token !== 'string' || token.length === 0) {
    return { ok: false, reason: 'redeem_failed' };
  }
  let res;
  try {
    res = await fetchImpl(REDEEM_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token }),
    });
  } catch {
    return { ok: false, reason: 'network_error' };
  }
  if (!res.ok) {
    // Try to pull a structured error code so the UI can show the
    // right message (expired vs invalid vs everything else).
    /** @type {any} */
    let body;
    try { body = await res.json(); } catch { /* ignore */ }
    if (body && typeof body.error === 'string') {
      if (body.error === 'expired_token') return { ok: false, reason: 'expired_token' };
      if (body.error === 'invalid_token' || body.error === 'scope_mismatch') {
        return { ok: false, reason: 'invalid_token' };
      }
    }
    return { ok: false, reason: 'redeem_failed' };
  }
  /** @type {any} */
  let json;
  try { json = await res.json(); } catch { return { ok: false, reason: 'redeem_failed' }; }
  if (typeof json.targetDeviceId !== 'string' || json.targetDeviceId.length === 0) {
    return { ok: false, reason: 'redeem_failed' };
  }
  return {
    ok: true,
    targetDeviceId: json.targetDeviceId,
    targetNickname: typeof json.targetNickname === 'string' ? json.targetNickname : null,
  };
}
