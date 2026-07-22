'use strict';

/**
 * The durable second home for a browser's anonymous deviceId (Feature W).
 *
 * Identity lives in `localStorage.gridgame.deviceId`, which browsers are
 * free to evict — WebKit/Safari's Intelligent Tracking Prevention wipes all
 * *script-writable* storage (localStorage, IndexedDB, and cookies set via
 * `document.cookie`) after 7 days without a first-party visit. A cookie set
 * by the **server** via the `Set-Cookie` response header is exempt from that
 * cap, so it survives exactly the eviction that destroys the localStorage id.
 *
 * `GET /api/v1/whoami` reads this cookie back and hands the browser its
 * original deviceId, letting the client restore the *same* identity (and then
 * re-hydrate its localStorage caches from Cosmos) instead of minting a fresh
 * UUID and orphaning all of the player's history.
 *
 * The value is an anonymous random UUID — the exact same datum already held
 * in localStorage — so this adds a durability property, not new data.
 *
 * Pure string helpers, no I/O, so the whole thing is unit-tested. The handler
 * reads the raw `Cookie` header off the request (tolerating both the Headers
 * object and a plain object, same as `rateLimit.clientIp`) and passes the
 * string here.
 */

/** Cookie name. Short + namespaced; `gg` = gridgame, `did` = deviceId. */
const COOKIE_NAME = 'gg_did';

/** 2 years, in seconds. Rolled forward on every write that re-stamps it. */
const MAX_AGE_SECONDS = 63072000;

/**
 * Build the `Set-Cookie` header value for a deviceId.
 *
 * - `HttpOnly`  — JS can't read it (XSS can't exfiltrate; only `/whoami` needs it).
 * - `Secure`    — HTTPS only.
 * - `SameSite=Lax` — enough for our same-origin `/api/*`; sent on top-level nav.
 * - `Path=/`    — available to every route.
 * - `Max-Age`   — long-lived; each re-stamp rolls the expiry forward.
 *
 * Host-only on purpose (no `Domain=`): production is `www.yetanotherquiz.com`
 * and the apex just redirects there, so a host-scoped cookie is correct.
 *
 * @param {string} deviceId
 * @returns {string}
 */
function deviceCookieHeader(deviceId) {
  return `${COOKIE_NAME}=${deviceId}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${MAX_AGE_SECONDS}`;
}

/**
 * Extract the `gg_did` value from a raw `Cookie` request header, or null when
 * it isn't present. Never throws — a malformed/absent header yields null so
 * the caller falls through to "no cookie" cleanly.
 *
 * The value is returned as-is (deviceIds are UUID-shaped and cookie-safe); the
 * caller validates its shape via `validateDeviceIdParam` before trusting it.
 *
 * @param {string | null | undefined} cookieHeader
 * @returns {string | null}
 */
function parseDeviceCookie(cookieHeader) {
  if (typeof cookieHeader !== 'string' || cookieHeader.length === 0) return null;
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const name = part.slice(0, eq).trim();
    if (name !== COOKIE_NAME) continue;
    const value = part.slice(eq + 1).trim();
    return value.length > 0 ? value : null;
  }
  return null;
}

module.exports = { deviceCookieHeader, parseDeviceCookie, COOKIE_NAME, MAX_AGE_SECONDS };
