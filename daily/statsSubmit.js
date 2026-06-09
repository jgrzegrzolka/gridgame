/**
 * POST a finished daily attempt to /api/v1/daily/result. Implements the
 * retry contract from FEATURE.md:
 *
 *   - The server is the source of truth for dedup. In default
 *     (insert-only) mode it 409s on duplicate (puzzleId, deviceId);
 *     in upsert mode (DAILY_RESULT_UPSERT=true env var) it replaces
 *     the existing row. Either way the client just hands the result
 *     over and treats 204 and 409 as equivalent.
 *   - There is NO client-side gate on hasSubmitted(). An earlier
 *     version added one as a "don't waste a round-trip" optimization,
 *     but it actively prevented the server's upsert path from doing
 *     its job — replays never reached the server because the client
 *     short-circuited. The marginal cost of one extra POST per replay
 *     is negligible; correctness wins.
 *   - markSubmitted() is still called on success so the revisit branch
 *     in page.js can decide whether to render the stats panel without
 *     attempting a fresh submit.
 *   - Fire-and-forget: callers should not block the finish screen on
 *     this promise. The function never throws — every failure path
 *     resolves with an outcome string.
 *
 * `fetchImpl` is injected so tests can run offline.
 *
 * Returns:
 *   { outcome: 'ok' }                             — 204 or 409 from the server
 *   { outcome: 'failed', reason: <string> }       — anything else
 */

import { markSubmitted } from './submitted.js';

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
 * @returns {Promise<{ outcome: 'ok' } | { outcome: 'failed', reason: string }>}
 */
export async function submitResult({
  store, n, foundCodes, totalCount, durationMs, deviceId, turnstileToken,
  fetchImpl = globalThis.fetch,
}) {
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
  // in insert-only mode (replays in upsert mode get 204 too because
  // Cosmos returns 201 on create and 200 on replace, both mapped to
  // 204 by the handler). All three end-state-equivalent for the client.
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
