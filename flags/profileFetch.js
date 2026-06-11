/**
 * GET another device's saved nickname from /api/v1/profile?id=<deviceId>.
 *
 * Returns:
 *   { ok: true, nickname: string | null }   - 200 from server; null = no row
 *   { ok: false, reason: <string> }         - anything else (network / 4xx / 5xx)
 *
 * Like the submit helpers, this never throws — callers fire-and-forget
 * and degrade gracefully via `displayNickname(deviceId, null)` (default
 * derived from the deviceId) when the fetch fails.
 *
 * `fetchImpl` is injected so tests run offline.
 */

const ENDPOINT = '/api/v1/profile';

/**
 * @param {{
 *   deviceId: string,
 *   fetchImpl?: typeof fetch,
 * }} args
 * @returns {Promise<{ ok: true, nickname: string | null } | { ok: false, reason: string }>}
 */
export async function fetchProfile({ deviceId, fetchImpl = globalThis.fetch }) {
  let res;
  try {
    res = await fetchImpl(`${ENDPOINT}?id=${encodeURIComponent(deviceId)}`);
  } catch {
    return { ok: false, reason: 'network_error' };
  }

  if (res.status !== 200) {
    let reason = `http_${res.status}`;
    try {
      const json = await res.json();
      if (json && typeof json.error === 'string') reason = json.error;
    } catch { /* leave reason as http_<status> */ }
    return { ok: false, reason };
  }

  let payload;
  try {
    payload = await res.json();
  } catch {
    return { ok: false, reason: 'invalid_json' };
  }
  const nickname = payload && typeof payload.nickname === 'string' ? payload.nickname : null;
  return { ok: true, nickname };
}
