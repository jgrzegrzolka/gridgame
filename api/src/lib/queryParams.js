/**
 * Small, focused helpers for reading query parameters off Azure
 * Functions v4 request objects. Living in lib/ (not in the handler
 * file) keeps the handler a thin shell and lets these helpers stay
 * unit-tested without dragging @azure/functions into the test
 * dependency graph.
 */

/**
 * Read `?fresh=1` from the request URL. Returns true only on the
 * exact string "1" to avoid surprises (no truthy URL params, no
 * accidental cache-busting from typos like ?fresh=true).
 *
 * Used by the dailyStats handler: the client appends ?fresh=1 to the
 * GET fired immediately after a successful POST so the player sees
 * their own just-submitted result reflected, bypassing the 60s
 * server-side cache for that one request.
 *
 * @param {{ url: string }} req
 * @returns {boolean}
 */
function readFreshFlag(req) {
  try {
    return new URL(req.url).searchParams.get('fresh') === '1';
  } catch {
    return false;
  }
}

module.exports = { readFreshFlag };
