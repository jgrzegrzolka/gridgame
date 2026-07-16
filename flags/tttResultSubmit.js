/**
 * POST a TTT online head-to-head result to /api/v1/ttt/result.
 *
 * Fire-and-forget: the caller doesn't await, doesn't gate on success,
 * and the function never throws — every failure path resolves with an
 * outcome string. Same retry-philosophy as quizRecordSubmit.js / the
 * daily stats writer.
 *
 * Per FEATURE.md Feature G: server stores one row per (deviceId,
 * opponentId) pair per perspective (so two rows per game total — one
 * per side), incrementing the right (mode, win/loss/draw) counter on
 * every POST. Give-up cases are folded into win/loss before the call.
 *
 * `fetchImpl` is injected so tests run offline.
 *
 * Returns:
 *   { outcome: 'ok' }                         — 204 from server
 *   { outcome: 'failed', reason: <string> }   — anything else
 */

const ENDPOINT = '/api/v1/ttt/result';

/**
 * `mode` stays on the wire but only `'3x3'` exists now — the 9×9 board was
 * removed in Feature U. The server still *accepts* `'9x9'` so an in-flight
 * POST from a tab opened before that doesn't 400, but no current client can
 * produce one, so the type here is narrowed to what we actually send.
 *
 * @param {{
 *   deviceId: string,
 *   opponentId: string,
 *   mode: '3x3',
 *   outcome: 'win' | 'loss' | 'draw',
 *   fetchImpl?: typeof fetch,
 * }} args
 * @returns {Promise<{ outcome: 'ok' } | { outcome: 'failed', reason: string }>}
 */
export async function submitTttResult({
  deviceId, opponentId, mode, outcome,
  fetchImpl = globalThis.fetch,
}) {
  const body = { deviceId, opponentId, mode, outcome };

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
