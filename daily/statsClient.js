/**
 * Fetch community stats for puzzle N from /api/v1/daily/stats/{n}.
 * Pure network glue: returns the parsed JSON on success, null on
 * any failure (non-2xx response, malformed JSON, network error).
 * Callers (page.js) decide what to render — overlay on tiles,
 * headline above them, or hide silently if null.
 *
 * `bypassCache: true` appends `?fresh=1` so the server skips its 60s
 * cache lookup. Used by the post-finish path so the player sees their
 * own just-submitted result reflected immediately. Revisits use the
 * default (cached) path.
 */

const ENDPOINT_BASE = '/api/v1/daily/stats/';

/**
 * @typedef {{
 *   totalAttempts: number,
 *   perCodeFinds: Record<string, number>,
 *   perWrongCode?: Record<string, number>,
 *   mean: number,
 *   topPct: number,
 * }} Stats
 */

/**
 * @param {number} n
 * @param {{ bypassCache?: boolean, fetchImpl?: typeof fetch }} [opts]
 * @returns {Promise<Stats | null>}
 */
export async function fetchStats(n, { bypassCache = false, fetchImpl = globalThis.fetch } = {}) {
  const url = `${ENDPOINT_BASE}${n}${bypassCache ? '?fresh=1' : ''}`;
  try {
    const res = await fetchImpl(url);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}
