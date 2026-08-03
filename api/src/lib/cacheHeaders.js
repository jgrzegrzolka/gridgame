/**
 * Build the `Cache-Control` header value pair for the stats GET.
 *
 * Two flavors:
 *   - default ("public, max-age=<ttlSeconds>"): browser + edge cache the
 *     response for the same window the server caches it internally.
 *   - bypass ("no-store"): the request was `?fresh=1`, meaning the
 *     client wanted to skip the server's cache because they just
 *     POSTed. We don't want the browser memoizing this one-off
 *     response — otherwise the player would see their own data on
 *     instant refresh but cached pre-refresh data for the rest of
 *     the window.
 *
 * `partial` takes the same exit as `fresh`, for a different reason: the
 * body is degraded (a soft read failed), so it describes the moment
 * rather than the player. Keeping it out of the server's own cache isn't
 * enough — without this, the browser holds the degraded copy for the
 * rest of the window and hands it to the next page load, which is
 * exactly where the achievement diff takes its baseline.
 */

/**
 * @param {{ fresh: boolean, ttlMs: number, partial?: boolean }} args
 * @returns {{ 'Cache-Control': string }}
 */
function statsCacheHeaders({ fresh, ttlMs, partial = false }) {
  if (fresh || partial) return { 'Cache-Control': 'no-store' };
  return { 'Cache-Control': `public, max-age=${Math.floor(ttlMs / 1000)}` };
}

module.exports = { statsCacheHeaders };
