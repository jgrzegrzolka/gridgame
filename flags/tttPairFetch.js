/**
 * GET the head-to-head row for (deviceId, opponentId) from
 * /api/v1/ttt/result. Returns the same shape the server's POST writes
 * — `{ deviceId, opponentId, m3x3, m9x9, lastPlayedAt }` — with all
 * counters defaulted to 0 when no row exists yet (first game between
 * this pair). Saves the caller from having to special-case a 404 vs
 * a zero-counters row.
 *
 * Returns:
 *   { ok: true, row: { deviceId, opponentId, m3x3, m9x9, lastPlayedAt } }
 *   { ok: false, reason: <string> }
 *
 * Never throws — same contract as the other fetch helpers.
 *
 * `fetchImpl` is injected so tests run offline.
 */

const ENDPOINT = '/api/v1/ttt/result';

/**
 * @typedef {{
 *   deviceId: string,
 *   opponentId: string,
 *   m3x3: { wins: number, losses: number, draws: number },
 *   m9x9: { wins: number, losses: number, draws: number },
 *   lastPlayedAt: number | null,
 * }} TttPairRow
 */

/**
 * @param {{
 *   deviceId: string,
 *   opponentId: string,
 *   fetchImpl?: typeof fetch,
 * }} args
 * @returns {Promise<{ ok: true, row: TttPairRow } | { ok: false, reason: string }>}
 */
export async function fetchTttPair({ deviceId, opponentId, fetchImpl = globalThis.fetch }) {
  const url = `${ENDPOINT}?deviceId=${encodeURIComponent(deviceId)}&opponentId=${encodeURIComponent(opponentId)}`;
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
  // Defensive shape — the server's empty-pair branch already returns
  // zeros, but a future schema bump should never NaN the UI math.
  /** @type {TttPairRow} */
  const row = {
    deviceId,
    opponentId,
    m3x3: normaliseMode(payload && payload.m3x3),
    m9x9: normaliseMode(payload && payload.m9x9),
    lastPlayedAt: payload && typeof payload.lastPlayedAt === 'number' ? payload.lastPlayedAt : null,
  };
  return { ok: true, row };
}

/** @param {any} m */
function normaliseMode(m) {
  const out = { wins: 0, losses: 0, draws: 0 };
  if (m && typeof m === 'object') {
    for (const k of /** @type {const} */ (['wins', 'losses', 'draws'])) {
      const v = m[k];
      if (typeof v === 'number' && Number.isFinite(v) && v >= 0) out[k] = Math.floor(v);
    }
  }
  return out;
}
