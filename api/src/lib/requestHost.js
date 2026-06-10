/**
 * Detect whether an HTTP request originated from a localhost host
 * (i.e. `npm run dev:swa` or `npm run dev:api`). Server-side check
 * — based on the actual URL the Functions runtime sees, not a client-
 * supplied flag. That matters: a client-trusted `local: true` body
 * field could be spoofed to opt a real player out of stats, so we
 * read the truth from the request itself.
 *
 * In production the SWA-managed Functions runtime serves requests at
 * `https://*.azurestaticapps.net/...` (or the SWA custom hostname) —
 * never a `localhost` or loopback address. In local dev the runtime
 * binds to `http://localhost:7071/` (or 127.0.0.1). So a hostname
 * check on `req.url` is a clean, server-trusted signal for "this
 * submission came from a dev machine, not real public traffic".
 *
 * Used by dailyResult.js to mark rows with `local: true` so the
 * aggregator can filter them out of community stats. The mark stays
 * on the Cosmos row so the owner can find + delete dev pollution
 * later with a `WHERE c.local = true` query.
 */

// Node's URL parser keeps the brackets on IPv6 hostnames:
//   new URL('http://[::1]:80/').hostname === '[::1]'
// so we match the bracketed form here. Bare '::1' is included too in
// case anything ever feeds the helper an already-stripped value.
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/**
 * @param {string | undefined | null} url  typically `req.url` from a
 *   Functions v4 HttpRequest. URL string or null/undefined.
 * @returns {boolean}
 */
function isLocalRequestUrl(url) {
  if (typeof url !== 'string' || url.length === 0) return false;
  try {
    const parsed = new URL(url);
    return LOCAL_HOSTS.has(parsed.hostname);
  } catch {
    // Malformed URL — fail-safe to "not local" so we don't accidentally
    // mark prod rows as local on a parser quirk.
    return false;
  }
}

module.exports = { isLocalRequestUrl };
