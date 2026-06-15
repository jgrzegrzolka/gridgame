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
 * `latestPuzzleId` lets the server's compute layer reset currentStreak
 * to 0 when the player's most recent row is older than today (i.e.
 * they skipped today). Optional — without it, the streak is "trailing
 * run ending at most recent row," which is fine right after a submit.
 */

const ENDPOINT_BASE = '/api/v1/daily/me';

/**
 * @typedef {{
 *   currentStreak: number,
 *   maxStreak: number,
 *   winPercent: number,
 *   totalPlayed: number,
 *   totalCompleted: number,
 * }} StreakResult
 */

/**
 * @param {string} deviceId
 * @param {{
 *   latestPuzzleId?: number,
 *   bypassCache?: boolean,
 *   fetchImpl?: typeof fetch,
 * }} [opts]
 * @returns {Promise<StreakResult | null>}
 */
export async function fetchDailyMe(deviceId, opts = {}) {
  if (typeof deviceId !== 'string' || deviceId.length === 0) return null;
  const { latestPuzzleId, bypassCache = false, fetchImpl = globalThis.fetch } = opts;

  const params = new URLSearchParams({ deviceId });
  if (Number.isInteger(latestPuzzleId)) {
    params.set('latestPuzzleId', String(latestPuzzleId));
  }
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
