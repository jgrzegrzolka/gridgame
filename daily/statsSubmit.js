/**
 * POST a finished daily attempt to /api/v1/daily/result.
 *
 *   - The server is the source of truth for dedup: it 409s on duplicate
 *     (puzzleId, deviceId). The client treats 204 and 409 as equivalent
 *     end states (first-attempt landed; replay that fired again was
 *     rejected — same outcome from the player's POV).
 *   - Because the POST is idempotent server-side, TRANSIENT failures are
 *     retried: a 5xx (Cosmos wobble / cold start) or a network error gets
 *     another go with a short linear backoff, so a single unlucky moment
 *     doesn't silently lose the player's result from the server (community
 *     stats / cross-device sync / streak / eviction-recovery all depend on
 *     it landing). A 4xx — bad payload, failed Turnstile, rate limit — is
 *     deterministic, so it's surfaced immediately without retrying.
 *   - There is NO client-side gate on hasSubmitted(). The marginal cost of
 *     one extra POST per replay is negligible, and the gate created a
 *     footgun where it suppressed legitimate re-sends.
 *   - markSubmitted() is called on success so the revisit branch in page.js
 *     can decide whether to render the stats panel without re-submitting.
 *   - Fire-and-forget: callers should not block the finish screen on this
 *     promise. The function never throws — every failure resolves with an
 *     outcome string.
 *
 * `fetchImpl` / `sleepImpl` are injected so tests run offline and fast.
 *
 * Returns:
 *   { outcome: 'ok' }                             — 204 or 409 from the server
 *   { outcome: 'failed', reason: <string> }       — anything else, after retries
 */

import { markSubmitted } from './submitted.js';

const ENDPOINT = '/api/v1/daily/result';

/** @param {number} ms */
const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Best-effort stable error code from the response body; falls back to the status. */
async function reasonFrom(res) {
  let reason = `http_${res.status}`;
  try {
    const json = await res.json();
    if (json && typeof json.error === 'string') reason = json.error;
  } catch { /* no / unparseable body — keep http_<status> */ }
  return reason;
}

/**
 * @param {{
 *   store: { getItem(k: string): string | null, setItem(k: string, v: string): void },
 *   n: number,
 *   foundCodes: string[],
 *   wrongCodes?: string[],
 *   totalCount: number,
 *   durationMs: number,
 *   deviceId: string,
 *   turnstileToken: string,
 *   fetchImpl?: typeof fetch,
 *   retries?: number,
 *   retryDelayMs?: number,
 *   sleepImpl?: (ms: number) => Promise<void>,
 * }} args
 * @returns {Promise<{ outcome: 'ok' } | { outcome: 'failed', reason: string }>}
 */
export async function submitResult({
  store, n, foundCodes, wrongCodes = [], totalCount, durationMs, deviceId, turnstileToken,
  fetchImpl = globalThis.fetch,
  retries = 2, retryDelayMs = 500, sleepImpl = defaultSleep,
}) {
  const body = {
    puzzleId: n,
    foundCodes,
    wrongCodes,
    totalCount,
    durationMs,
    deviceId,
    turnstileToken,
  };

  for (let attempt = 0; attempt <= retries; attempt++) {
    let res;
    try {
      res = await fetchImpl(ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        // `keepalive: true` lets the browser flush this POST even if the
        // user immediately closes the tab after "Give up" — the exact
        // failure mode that would otherwise drop the row. ~200 bytes, well
        // under the 64 KB keepalive ceiling, and we don't need the response
        // in the close-the-tab case.
        keepalive: true,
      });
    } catch {
      // Network error — retryable (the POST is idempotent server-side).
      if (attempt < retries) { await sleepImpl(retryDelayMs * (attempt + 1)); continue; }
      return { outcome: 'failed', reason: 'network_error' };
    }

    // 204 = first-time success; 409 = server already has this attempt
    // (replay against insert-only Cosmos). End-state-equivalent.
    if (res.status === 204 || res.status === 409) {
      markSubmitted(store, n);
      return { outcome: 'ok' };
    }

    // 4xx = deterministic client error — surface the reason, don't retry.
    if (res.status < 500) {
      return { outcome: 'failed', reason: await reasonFrom(res) };
    }

    // 5xx = transient server / Cosmos error — retry if any attempts remain.
    if (attempt < retries) { await sleepImpl(retryDelayMs * (attempt + 1)); continue; }
    return { outcome: 'failed', reason: await reasonFrom(res) };
  }

  return { outcome: 'failed', reason: 'network_error' };
}
