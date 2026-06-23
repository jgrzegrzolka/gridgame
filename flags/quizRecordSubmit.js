/**
 * POST a flagQuiz personal-best to /api/v1/quiz/record.
 *
 * Fire-and-forget: the caller doesn't await, doesn't gate on success,
 * and the function never throws — every failure path resolves with an
 * outcome string.
 *
 * **Call-site gating (Feature S Phase 5):** the decision to actually
 * POST happens in `flags/quizRecordThrottle.js#shouldPushQuizRecord`
 * — PB beats always push immediately, give-up non-PBs skip, all other
 * non-PBs are throttled to one push per 30 minutes per device. This
 * function itself is unconditional; the wrapper at the call site
 * (`maybeSubmitQuizRecord` in flagQuiz/page.js) decides whether to
 * fire. Server still runs its own merge — the client's `isNew` is a
 * cost optimization, not the authoritative PB check.
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
