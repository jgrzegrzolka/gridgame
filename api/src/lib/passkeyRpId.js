/**
 * Derive the WebAuthn `rpID` and `expectedOrigin` from the inbound
 * request URL. Two real environments today: local dev (SWA emulator
 * on `localhost:4280` — or any localhost port) and prod
 * (`www.yetanotherquiz.com` after Cloudflare's apex → www redirect,
 * per infra/operations.md).
 *
 * `rpID` is the registrable suffix the passkey is bound to. Using
 * `yetanotherquiz.com` in prod (the bare apex, not `www.…`) means a
 * single credential covers both `www.yetanotherquiz.com` and the
 * apex if anyone ever lands on it pre-redirect. Browsers will only
 * accept a `rpID` that's the current page host OR a registrable
 * parent of it.
 *
 * `expectedOrigin` is the full scheme+host+port the WebAuthn
 * assertion was minted at. Browser includes the origin in the
 * assertion; simplewebauthn rejects a mismatch.
 *
 * Pure: input string, output string. No clock, no I/O.
 */

const { isLocalRequestUrl } = require('./requestHost');

/**
 * @param {string | undefined} reqUrl
 * @returns {string}
 */
function getRpId(reqUrl) {
  if (isLocalRequestUrl(reqUrl)) return 'localhost';
  return 'yetanotherquiz.com';
}

/**
 * @param {string | undefined} reqUrl
 * @returns {string}
 */
function getExpectedOrigin(reqUrl) {
  if (!reqUrl) return 'https://www.yetanotherquiz.com';
  try {
    const u = new URL(reqUrl);
    return `${u.protocol}//${u.host}`;
  } catch {
    return 'https://www.yetanotherquiz.com';
  }
}

module.exports = { getRpId, getExpectedOrigin };
