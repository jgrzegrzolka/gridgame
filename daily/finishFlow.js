/**
 * Post-finish pipeline orchestrator. Runs after the player finishes
 * (or gives up on) a daily puzzle:
 *
 *   1. onLoading()          — caller paints score + loading spinner
 *   2. ensureTurnstile()    — load/render the CF widget (idempotent)
 *   3. getTurnstileToken()  — execute the invisible challenge
 *   4. submitResult(...)    — POST to /api/v1/daily/result
 *   5. fetchStats(n, ...)   — GET fresh community stats
 *   6. onStats(stats)       — caller paints score + stats + tile overlays
 *
 * Every failure point (Turnstile throws, submit returns failed, stats
 * returns null) falls back to onCleared(), which the caller uses to
 * repaint score-only and clear the loading spinner. Without this, a
 * failed stats fetch would leave the player staring at an animated
 * "Loading…" line forever.
 *
 * Pulled out of daily/page.js so the (3 failure points × clear spinner)
 * control-flow matrix is testable with fake deps. The page wrapper
 * supplies the real DOM/network bindings.
 */

/**
 * @typedef {{
 *   totalAttempts: number,
 *   perCodeFinds: Record<string, number>,
 *   mean: number,
 *   topPct: number,
 * }} Stats
 */

/**
 * @typedef {{
 *   store: { getItem(k: string): string | null, setItem(k: string, v: string): void },
 *   n: number, foundCodes: string[], wrongCodes: string[],
 *   totalCount: number, durationMs: number, deviceId: string,
 *   turnstileToken: string,
 *   incognito?: boolean,
 * }} SubmitArgs
 */

/**
 * @param {{
 *   n: number,
 *   found: number,
 *   totalCount: number,
 *   foundCodes: string[],
 *   wrongCodes: string[],
 *   durationMs: number,
 *   deviceId: string,
 *   store: { getItem(k: string): string | null, setItem(k: string, v: string): void },
 *   incognito?: boolean,
 *   ensureTurnstile: () => Promise<void>,
 *   getTurnstileToken: () => Promise<string>,
 *   submitResult: (args: SubmitArgs) => Promise<{ outcome: 'ok' } | { outcome: 'failed', reason: string }>,
 *   fetchStats: (n: number, opts?: { bypassCache?: boolean }) => Promise<Stats | null>,
 *   onLoading: () => void,
 *   onCleared: () => void,
 *   onStats: (stats: Stats) => void,
 * }} args
 */
export async function runFinishFlow({
  n, found, totalCount, foundCodes, wrongCodes, durationMs, deviceId, store,
  incognito,
  ensureTurnstile, getTurnstileToken, submitResult, fetchStats,
  onLoading, onCleared, onStats,
}) {
  // `found` is included so callers' onLoading/onCleared closures stay
  // self-contained — they don't have to recompute foundCodes.length.
  void found;

  onLoading();

  let token;
  try {
    await ensureTurnstile();
    token = await getTurnstileToken();
  } catch {
    onCleared();
    return;
  }

  const r = await submitResult({
    store, n, foundCodes, wrongCodes, totalCount, durationMs, deviceId,
    turnstileToken: token,
    incognito,
  });
  if (r.outcome !== 'ok') {
    onCleared();
    return;
  }

  // bypassCache: true forces the server to query Cosmos instead of
  // returning a cached aggregate — without this the player wouldn't
  // see their own just-submitted result reflected in the average.
  const stats = await fetchStats(n, { bypassCache: true });
  if (!stats) {
    onCleared();
    return;
  }
  onStats(stats);
}
