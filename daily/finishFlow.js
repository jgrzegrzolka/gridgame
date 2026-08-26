/**
 * Post-finish pipeline orchestrator. Runs after the player finishes
 * (or gives up on) a daily puzzle:
 *
 *   1. onLoading()          — caller paints score + loading spinner
 *   2. ensureTurnstile()    — load/render the CF widget (idempotent)
 *   3. getTurnstileToken()  — execute the invisible challenge
 *   4. submitResult(...)    — POST to /api/v1/daily/result (best-effort)
 *   5. fetchStats(fresh)    — GET fresh community stats; on failure, retry
 *                             once against the cached aggregate
 *   6. onStats(stats)       — caller paints score + stats + tile overlays
 *
 * Resilience: only a Turnstile failure (no token → the POST can't be
 * trusted) short-circuits to onCleared(). A failed submit does NOT — on a
 * replay the row already exists and community data stands, so we still try
 * to show stats. And a failed FRESH stats fetch falls back to the CACHED
 * aggregate before giving up. onCleared() (repaint score-only, clear the
 * spinner) fires only when there's genuinely nothing to show.
 *
 * Pulled out of daily/page.js so the control-flow matrix is testable with
 * fake deps. The page wrapper supplies the real DOM/network bindings.
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
 *   ensureTurnstile: () => Promise<void>,
 *   getTurnstileToken: () => Promise<string>,
 *   submitResult: (args: SubmitArgs) => Promise<{ outcome: 'ok' } | { outcome: 'failed', reason: string }>,
 *   fetchStats: (n: number, opts?: { bypassCache?: boolean }) => Promise<Stats | null>,
 *   onLoading: () => void,
 *   onCleared: () => void,
 *   onStats: (stats: Stats) => void,
 *   onSubmitFailed?: (reason: string) => void,
 * }} args
 */
export async function runFinishFlow({
  n, found, totalCount, foundCodes, wrongCodes, durationMs, deviceId, store,
  ensureTurnstile, getTurnstileToken, submitResult, fetchStats,
  onLoading, onCleared, onStats, onSubmitFailed,
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

  // Record the attempt, but DON'T gate the stats panel on its outcome. On
  // a replay the row already exists (the server 409s the dup), and the
  // community data stands whether or not this POST landed — so a flaked
  // submit shouldn't leave the player at "score only".
  const submitted = await submitResult({
    store, n, foundCodes, wrongCodes, totalCount, durationMs, deviceId,
    turnstileToken: token,
  });
  // Not gating the stats panel, but no longer swallowing it either. The
  // outcome used to be discarded here, so a rejected result looked exactly
  // like an accepted one: the player kept their local score and never
  // learned the server hadn't taken it. `submitResult` has already parked
  // the payload for a later retry; this is only about saying so.
  if (submitted && submitted.outcome === 'failed' && onSubmitFailed) {
    onSubmitFailed(submitted.reason);
  }

  // Prefer the FRESH aggregate (`bypassCache` forces Cosmos, so the
  // just-submitted row is reflected). But the fresh path always hits
  // Cosmos and the server maps any Cosmos wobble to a 500; when it keeps
  // failing even after fetchStats' own retries, fall back to the CACHED
  // aggregate. A warm instance serves that from its 60s cache without
  // touching Cosmos, so it rides out the wobble — and on a replay the
  // cached row already includes this player. This is what turns the
  // remaining "stats sometimes don't load on replay" cases into loads.
  let stats = await fetchStats(n, { bypassCache: true });
  if (!stats) stats = await fetchStats(n, { bypassCache: false });
  if (!stats) {
    onCleared();
    return;
  }
  onStats(stats);
}
