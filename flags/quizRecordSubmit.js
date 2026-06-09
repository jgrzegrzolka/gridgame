/**
 * POST a flagQuiz personal-best to /api/v1/quiz/record.
 *
 * Fire-and-forget: the caller doesn't await, doesn't gate on success,
 * and the function never throws — every failure path resolves with an
 * outcome string. Same retry-philosophy as daily/statsSubmit.js: the
 * server is the source of truth for "is this actually a PB?", the
 * client just hands it the round result.
 *
 * Why only fire on a local-best (client-side `isNew`):
 *   - Skips ~90% of round-end writes (most rounds aren't a PB).
 *   - Server still runs its own merge — if the player cleared
 *     localStorage and the local "best" is null, the first finished
 *     round looks like a new local PB and the request is fired;
 *     server merge then decides whether to overwrite the cloud PB.
 *
 * `fetchImpl` is injected so tests run offline.
 *
 * Returns:
 *   { outcome: 'ok' }                         — 204 from server
 *   { outcome: 'failed', reason: <string> }   — anything else
 */

const ENDPOINT = '/api/v1/quiz/record';

/**
 * @param {{
 *   deviceId: string,
 *   configKey: string,
 *   score: number,
 *   durationMs: number,
 *   lowerWins: boolean,
 *   fetchImpl?: typeof fetch,
 * }} args
 * @returns {Promise<{ outcome: 'ok' } | { outcome: 'failed', reason: string }>}
 */
export async function submitQuizRecord({
  deviceId, configKey, score, durationMs, lowerWins,
  fetchImpl = globalThis.fetch,
}) {
  const body = { deviceId, configKey, score, durationMs, lowerWins };

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

  if (res.status === 204) return { outcome: 'ok' };

  let reason = `http_${res.status}`;
  try {
    const json = await res.json();
    if (json && typeof json.error === 'string') reason = json.error;
  } catch { /* leave reason as http_<status> */ }
  return { outcome: 'failed', reason };
}
