/**
 * POST a finished daily attempt to /api/v1/daily/result. Implements the
 * retry contract from FEATURE.md:
 *
 *   - Don't POST if this device already submitted this puzzle. The local
 *     gate (submitted.js) is an optimization; the server enforces the
 *     same invariant by 409'ing on duplicate `(puzzleId, deviceId)`.
 *   - Treat 204 and 409 as equivalent locally. Both mean "the server
 *     has this result" — mark submitted in both cases.
 *   - Fire-and-forget: callers should not block the finish screen on
 *     this promise. The function never throws — every failure path
 *     resolves with an outcome string.
 *
 * `fetchImpl` is injected so tests can run offline. `store` is the
 * localStorage instance used by the gate.
 *
 * Returns:
 *   { outcome: 'already' }                        — gate said no, no POST sent
 *   { outcome: 'ok' }                             — 204 or 409 from the server
 *   { outcome: 'failed', reason: <string> }       — anything else
 */

import { hasSubmitted, markSubmitted } from './submitted.js';

const ENDPOINT = '/api/v1/daily/result';

/**
 * @param {{
 *   store: { getItem(k: string): string | null, setItem(k: string, v: string): void },
 *   n: number,
 *   foundCodes: string[],
 *   totalCount: number,
 *   durationMs: number,
 *   deviceId: string,
 *   turnstileToken: string,
 *   fetchImpl?: typeof fetch,
 * }} args
 * @returns {Promise<{ outcome: 'already' | 'ok' } | { outcome: 'failed', reason: string }>}
 */
export async function submitResult({
  store, n, foundCodes, totalCount, durationMs, deviceId, turnstileToken,
  fetchImpl = globalThis.fetch,
}) {
  if (hasSubmitted(store, n)) {
    return { outcome: 'already' };
  }

  const body = {
    puzzleId: n,
    foundCodes,
    totalCount,
    durationMs,
    deviceId,
    turnstileToken,
  };

  let res;
  try {
    res = await fetchImpl(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    return { outcome: 'failed', reason: 'network_error' };
  }

  // 204 = first-time success; 409 = server already has this attempt
  // (likely a race or a previous POST whose response we missed). Both
  // mean "the server's stored record is locked in" → mark submitted.
  if (res.status === 204 || res.status === 409) {
    markSubmitted(store, n);
    return { outcome: 'ok' };
  }

  // Try to read the server's stable error code, but the response is
  // optional — some 4xx paths return no body.
  let reason = `http_${res.status}`;
  try {
    const json = await res.json();
    if (json && typeof json.error === 'string') reason = json.error;
  } catch { /* leave reason as http_<status> */ }
  return { outcome: 'failed', reason };
}
