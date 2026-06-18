/**
 * Fetch this device's streak / win-% numbers from GET /api/v1/daily/me.
 * Pure network glue: returns the parsed shape on success, null on any
 * failure (missing deviceId, non-2xx, malformed JSON, network error).
 * The caller (page.js) decides what to render — a one-line streak hint
 * on the finish screen when currentStreak ≥ 2, all three numbers on the
 * profile page (Feature N4). Never throws — a failure here must not
 * block the score / community-stats display.
 *
 * `bypassCache: true` appends `?fresh=1` so the server skips its 60s
 * cache and re-queries Cosmos. Used by the post-finish path so the
 * player's just-submitted result lands in their streak immediately.
 * Revisits and profile-page reads use the default (cached) path.
 *
 * The server computes "today" (Warsaw) itself — clients don't pass it.
 * Keeps the streak math anchored to one clock instead of trusting the
 * caller's, and lets the cache key stay just the deviceId.
 */

const ENDPOINT_BASE = '/api/v1/daily/me';

/**
 * @typedef {{
 *   currentStreak: number,
 *   maxStreak: number,
 *   winPercent: number,
 *   totalPlayed: number,
 *   totalCompleted: number,
 *   cleanSweeps: number,
 *   flawlessSweeps: number,
 *   zeroScoreFinishes: number,
 * }} StreakResult
 */

/**
 * @param {string} deviceId
 * @param {{
 *   bypassCache?: boolean,
 *   fetchImpl?: typeof fetch,
 * }} [opts]
 * @returns {Promise<StreakResult | null>}
 */
export async function fetchDailyMe(deviceId, opts = {}) {
  if (typeof deviceId !== 'string' || deviceId.length === 0) return null;
  const { bypassCache = false, fetchImpl = globalThis.fetch } = opts;

  const params = new URLSearchParams({ deviceId });
  if (bypassCache) params.set('fresh', '1');

  try {
    const res = await fetchImpl(`${ENDPOINT_BASE}?${params}`);
    if (!res.ok) return null;
    const json = await res.json();
    if (!json || typeof json !== 'object') return null;
    // Defensive normalisation: a future server-shape change shouldn't
    // surface as NaN-in-the-DOM. Missing / non-numeric fields collapse
    // to 0 and the UI gate (currentStreak >= 2) hides the badge.
    return {
      currentStreak: toInt(json.currentStreak),
      maxStreak: toInt(json.maxStreak),
      winPercent: toInt(json.winPercent),
      totalPlayed: toInt(json.totalPlayed),
      totalCompleted: toInt(json.totalCompleted),
      cleanSweeps: toInt(json.cleanSweeps),
      flawlessSweeps: toInt(json.flawlessSweeps),
      zeroScoreFinishes: toInt(json.zeroScoreFinishes),
    };
  } catch {
    return null;
  }
}

/**
 * @param {unknown} x
 * @returns {number}
 */
function toInt(x) {
  const n = Number(x);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}
