/**
 * Pick which Cloudflare Turnstile site key to use based on hostname.
 *
 * Prod keys are domain-bound: our prod site key (`0x4AAAAAADhdZ-XDzVHaLk9R`)
 * is registered for `yetanotherquiz.com` in the CF dashboard. Loading it
 * on `localhost` produces a loud "Error 110200: Invalid sitekey for this
 * origin" in the console and the invisible widget never resolves a token.
 *
 * Cloudflare publishes a set of always-pass / always-fail / always-
 * interactive test keys for local dev — see
 * https://developers.cloudflare.com/turnstile/troubleshooting/testing/.
 * We use `2x00000000000000000000AB` (invisible, always passes) so the
 * client-side flow runs end-to-end on `npm run dev:swa` without any
 * special-casing in the rest of the code. The server side meanwhile
 * skips token verification entirely when `TURNSTILE_SECRET` is unset
 * (the default in `local.settings.json.example`), so any token the test
 * key produces is accepted.
 *
 * NOTE: when rotating the PROD site key, both the secret and the key
 * change together in the CF dashboard — update PROD_SITE_KEY here in
 * lockstep with the SWA `TURNSTILE_SECRET` app setting.
 */

const PROD_SITE_KEY = '0x4AAAAAADhdZ-XDzVHaLk9R';
const TEST_SITE_KEY = '2x00000000000000000000AB';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

/**
 * @param {string} hostname  typically `window.location.hostname`
 * @returns {string}
 */
export function pickTurnstileSiteKey(hostname) {
  return LOCAL_HOSTS.has(hostname) ? TEST_SITE_KEY : PROD_SITE_KEY;
}
