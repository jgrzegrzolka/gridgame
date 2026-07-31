/**
 * Fetch community stats for puzzle N from /api/v1/daily/stats/{n}.
 * Pure network glue: returns the parsed JSON on success, null on
 * failure. Callers (page.js) decide what to render — overlay on tiles,
 * headline above them, or hide silently if null.
 *
 * `bypassCache: true` appends `?fresh=1` so the server skips its 60s
 * cache lookup. Used by the post-finish / replay path so the player sees
 * their own just-submitted result reflected immediately. Revisits use the
 * default (cached) path.
 *
 * Retries on TRANSIENT failures. The `?fresh=1` path always queries
 * Cosmos (no cache), and the server maps every Cosmos hiccup — a cold
 * connection, a momentary throttle, a Free-SKU cold start — to a 500. A
 * single unlucky request would otherwise drop the whole stats panel to
 * "score only" (the "sometimes the stats don't load on replay" report),
 * so a 5xx or a network error is retried with a short linear backoff. A
 * 4xx is a deterministic client error (bad puzzle id) — no retry.
 */

const ENDPOINT_BASE = '/api/v1/daily/stats/';

/** @param {number} ms */
const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
 * @param {{
 *   bypassCache?: boolean,
 *   fetchImpl?: typeof fetch,
 *   retries?: number,
 *   retryDelayMs?: number,
 *   sleepImpl?: (ms: number) => Promise<void>,
 * }} [opts]
 * @returns {Promise<Stats | null>}
 */
export async function fetchStats(n, {
  bypassCache = false,
  fetchImpl = globalThis.fetch,
  retries = 2,
  retryDelayMs = 500,
  sleepImpl = defaultSleep,
} = {}) {
  const url = `${ENDPOINT_BASE}${n}${bypassCache ? '?fresh=1' : ''}`;
  for (let attempt = 0; attempt <= retries; attempt++) {
    let retryable = false;
    try {
      const res = await fetchImpl(url);
      if (res.ok) return await res.json();
      // 5xx = a transient server / Cosmos error worth another go; 4xx is a
      // deterministic client error, so stop now.
      if (res.status < 500) return null;
      retryable = true;
    } catch {
      retryable = true; // network error / aborted request
    }
    if (!retryable || attempt === retries) return null;
    await sleepImpl(retryDelayMs * (attempt + 1));
  }
  return null;
}
