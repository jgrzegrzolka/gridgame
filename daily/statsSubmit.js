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
 *   - Whatever DOESN'T land is parked (see pendingSubmit.js) and re-sent by
 *     `flushPendingSubmits` on a later page load. Before that, giving up here
 *     meant losing the score for good: the revisit branch renders the saved
 *     result without re-POSTing, so nothing ever tried again. A 4xx is still
 *     not retried in THIS call — it's deterministic, and hammering it would
 *     just burn the rate limit — but the payload survives the page.
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
import { savePending, loadPending, clearPending } from './pendingSubmit.js';

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
export async function submitResult(args) {
  const { store, n, foundCodes, wrongCodes = [], totalCount, durationMs, deviceId } = args;
  const result = await deliver(args);
  if (result.outcome === 'ok') {
    markSubmitted(store, n);
    clearPending(store, n);
  } else {
    // Park it. The page this ran on is about to become a result screen the
    // player may never leave, and the revisit path never re-POSTs — without
    // this the score is gone.
    savePending(store, { n, foundCodes, wrongCodes, totalCount, durationMs, deviceId });
  }
  return result;
}

/**
 * One delivery attempt sequence: POST, with retries for transient faults.
 * Split out of `submitResult` so the park / clear bookkeeping has exactly
 * one place to sit rather than being repeated at four return sites.
 *
 * @param {Parameters<typeof submitResult>[0]} args
 * @returns {Promise<{ outcome: 'ok' } | { outcome: 'failed', reason: string }>}
 */
async function deliver({
  n, foundCodes, wrongCodes = [], totalCount, durationMs, deviceId, turnstileToken,
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

/**
 * Re-send every attempt parked by an earlier failed submit. Called at
 * daily / archive boot, before anything else touches the network, so a
 * score the server never received gets one more chance on each visit.
 *
 * This is the half of the fix that actually recovers data. Surfacing the
 * failure on the result screen tells the player something went wrong;
 * this is what makes it stop being true. It matters most in exactly the
 * case that motivated it: the player finishes on one device, the POST is
 * rejected, and they open the page again minutes later — that revisit now
 * lands the real score before any other device's replay can claim the
 * one-row-per-(puzzle, device) slot.
 *
 * `getToken` is supplied by the caller rather than imported so this stays
 * testable offline, and so the Turnstile-disabled path (a function that
 * resolves to '') needs no special case here. It's only called when there
 * is actually something to send — no parked attempts, no work, no token.
 *
 * Never throws, never rejects: a boot-time nicety must not be able to
 * take the page down.
 *
 * @param {{
 *   store: { getItem(k: string): string | null, setItem(k: string, v: string): void },
 *   getToken: () => Promise<string>,
 *   fetchImpl?: typeof fetch,
 *   sleepImpl?: (ms: number) => Promise<void>,
 * }} args
 * @returns {Promise<number>} how many parked attempts the server accepted
 */
export async function flushPendingSubmits({ store, getToken, fetchImpl, sleepImpl }) {
  /** @type {import('./pendingSubmit.js').PendingSubmit[]} */
  let parked;
  try {
    parked = loadPending(store);
  } catch {
    return 0;
  }
  if (parked.length === 0) return 0;

  let token = '';
  try {
    token = await getToken();
  } catch {
    // No token means the POST can't be trusted, same as in finishFlow.
    // Leave everything parked and try again next load.
    return 0;
  }

  let sent = 0;
  for (const p of parked) {
    const r = await submitResult({
      store,
      n: p.n,
      foundCodes: p.foundCodes,
      wrongCodes: p.wrongCodes,
      totalCount: p.totalCount,
      durationMs: p.durationMs,
      deviceId: p.deviceId,
      turnstileToken: token,
      fetchImpl,
      sleepImpl,
    });
    if (r.outcome === 'ok') sent += 1;
  }
  return sent;
}
