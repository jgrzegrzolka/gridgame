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
 *   attemptedFinishes: number,
 *   zeroScoreFinishes: number,
 *   quizAttempts60s: number,
 *   quizVariantsTouched60s: number,
 *   quizBestScore60s: number,
 *   quiz60sClearedVariants: string[],
 *   quizAttemptsAll: number,
 *   quizVariantsTouchedAll: number,
 *   quizAllLowWrongAny: number,
 *   quizAllPerfectedVariants: string[],
 *   hasNickname: boolean,
 *   dailySharesCount: number,
 *   quizSharesCount: number,
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
      attemptedFinishes: toInt(json.attemptedFinishes),
      zeroScoreFinishes: toInt(json.zeroScoreFinishes),
      quizAttempts60s: toInt(json.quizAttempts60s),
      quizVariantsTouched60s: toInt(json.quizVariantsTouched60s),
      quizBestScore60s: toInt(json.quizBestScore60s),
      quiz60sClearedVariants: toStringArray(json.quiz60sClearedVariants),
      quizAttemptsAll: toInt(json.quizAttemptsAll),
      quizVariantsTouchedAll: toInt(json.quizVariantsTouchedAll),
      // Endurance low-wrong defaults to MAX_SAFE_INTEGER on the server
      // when the player has never finished an endurance round — a
      // sentinel so "≤ N wrong" predicates can't spuriously fire.
      // Normalised here via the same `toLargeInt` so a stale server
      // returning `undefined` for this field collapses to the same
      // sentinel rather than `0`.
      quizAllLowWrongAny: toLargeIntOrSentinel(json.quizAllLowWrongAny),
      quizAllPerfectedVariants: toStringArray(json.quizAllPerfectedVariants),
      hasNickname: json.hasNickname === true,
      dailySharesCount: toInt(json.dailySharesCount),
      quizSharesCount: toInt(json.quizSharesCount),
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

/**
 * Defensive normaliser for string-array snapshot fields (currently
 * just `quiz60sClearedVariants`). Empty array on anything that isn't
 * an array of strings.
 *
 * @param {unknown} x
 * @returns {string[]}
 */
function toStringArray(x) {
  if (!Array.isArray(x)) return [];
  return x.filter((v) => typeof v === 'string');
}

/**
 * Defensive normaliser for `quizAllLowWrongAny` — the snapshot field
 * that defaults to `Number.MAX_SAFE_INTEGER` when the player has
 * never finished an endurance round. A missing field (older server,
 * malformed body) collapses to the same sentinel rather than `0`,
 * so the "≤ N wrong" predicates stay correctly locked.
 *
 * @param {unknown} x
 * @returns {number}
 */
function toLargeIntOrSentinel(x) {
  const n = Number(x);
  return Number.isFinite(n) ? Math.trunc(n) : Number.MAX_SAFE_INTEGER;
}
