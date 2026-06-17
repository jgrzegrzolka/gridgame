/**
 * GET the rolling-24h leaderboard for a flag-quiz configKey. Never throws
 * — callers fire-and-forget and the renderer shows a polite failed state.
 * Drops malformed `top` rows and `you` so the renderer doesn't have to
 * re-guard every field.
 */

const ENDPOINT = '/api/v1/quiz/leaderboard';

/**
 * @param {{
 *   configKey: string,
 *   deviceId: string,
 *   fresh?: boolean,
 *   fetchImpl?: typeof fetch,
 * }} args
 * @returns {Promise<
 *   | { ok: true, top: Array<{ deviceId: string, nickname: string|null, score: number, durationMs: number, submittedAt: number }>, you: { rank: number, score: number, durationMs: number } | null }
 *   | { ok: false, reason: string }
 * >}
 */
export async function fetchLeaderboard({
  configKey, deviceId, fresh = false,
  fetchImpl = globalThis.fetch,
}) {
  const params = new URLSearchParams();
  params.set('deviceId', deviceId);
  if (fresh) params.set('fresh', '1');
  const url = `${ENDPOINT}/${encodeURIComponent(configKey)}?${params.toString()}`;

  let res;
  try {
    res = await fetchImpl(url);
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

  if (!payload || typeof payload !== 'object') {
    return { ok: false, reason: 'invalid_shape' };
  }

  const topRaw = Array.isArray(payload.top) ? payload.top : [];
  const top = topRaw
    .filter((/** @type {any} */ r) =>
      r && typeof r === 'object' &&
      typeof r.deviceId === 'string' &&
      typeof r.score === 'number' &&
      typeof r.durationMs === 'number'
    )
    .map((/** @type {any} */ r) => ({
      deviceId: r.deviceId,
      nickname: typeof r.nickname === 'string' ? r.nickname : null,
      score: r.score,
      durationMs: r.durationMs,
      submittedAt: typeof r.submittedAt === 'number' ? r.submittedAt : 0,
    }));

  let you = null;
  if (
    payload.you && typeof payload.you === 'object' &&
    typeof payload.you.rank === 'number' &&
    typeof payload.you.score === 'number' &&
    typeof payload.you.durationMs === 'number'
  ) {
    you = {
      rank: payload.you.rank,
      score: payload.you.score,
      durationMs: payload.you.durationMs,
    };
  }

  return { ok: true, top, you };
}
