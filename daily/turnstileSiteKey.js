/**
 * Turnstile configuration helpers.
 *
 * Two responsibilities:
 *
 * 1. **Prod site key** (`PROD_SITE_KEY`) — the registered key for
 *    yetanotherquiz.com. Domain-bound by Cloudflare; trying to load it
 *    on any other origin throws CF error 110200. Public — fine to ship
 *    in source. Keep in lockstep with the SWA `TURNSTILE_SECRET` app
 *    setting (rotating the CF secret reissues the site key).
 *
 * 2. **Local-dev bypass** (`isLocalHostname`) — on localhost we skip the
 *    whole Turnstile dance: no SDK loaded, no widget rendered, an empty
 *    token sent to the server. The server's daily-result handler
 *    accepts any token when `TURNSTILE_SECRET` is unset (the default in
 *    `api/local.settings.json.example`), so this round-trips cleanly.
 *
 *    Why bypass instead of CF's "always-pass" test keys: in practice
 *    the test keys (we tried `2x00000000000000000000AB`) hit a
 *    postMessage origin-mismatch loop on `http://localhost` and error
 *    out with CF 600010. CF SDK behaviour on plain-HTTP localhost is
 *    apparently unsupported; bypass is the documented escape hatch
 *    for local dev. Turnstile's whole point is abuse prevention for
 *    public traffic — there's no value in running it for a single
 *    developer hitting their own machine.
 */

export const PROD_SITE_KEY = '0x4AAAAAADhdZ-XDzVHaLk9R';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

/**
 * Should we skip the Turnstile load+token flow entirely for this
 * hostname? True on localhost / 127.0.0.1 / IPv6 loopback; false
 * everywhere else (prod, preview deployments, anything else).
 *
 * Matched via an explicit set — substring matching would let an
 * attacker host on e.g. `localhost.example.com` and silently bypass
 * real Turnstile checks. The empty-string fallback returns false so
 * an unknown hostname defaults to "use real Turnstile" (fail-safe).
 *
 * @param {string} hostname  typically `window.location.hostname`
 * @returns {boolean}
 */
export function isLocalHostname(hostname) {
  return LOCAL_HOSTS.has(hostname);
}
