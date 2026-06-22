/**
 * Client-side helpers for the `syncBlob` field on the profile row
 * (Feature S Phase 2). Two primitives:
 *
 *   - `pullSyncBlob(deviceId)` — fetch the blob from the server (via
 *     `/api/v1/sync/hydrate`, which already returns it alongside
 *     daily/quiz/nickname data). Used on boot to inflate localStorage
 *     from server state when a freshly-linked device joins.
 *   - `pushSyncBlob(deviceId, blob)` — POST to `/api/v1/profile/sync-blob`
 *     to persist the device's current state. Used when client-side
 *     achievement counters / day logs / etc. change.
 *
 * Phase 2 ships the plumbing. Callers arrive in Phase 3+ when achievement
 * state actually moves from Cosmos containers (engagementEvents) into
 * localStorage; the carrier here is what keeps cross-device sync alive.
 *
 * Contract for both helpers:
 *   - Never throws. Returns a result tuple so callers can branch on
 *     success without try/catch.
 *   - `pullSyncBlob` resolves to `{ ok: true, blob: object | null }` on
 *     success, `{ ok: false, reason: string }` on any failure (network,
 *     non-200, malformed JSON).
 *   - `pushSyncBlob` resolves to `{ ok: true }` on 204, `{ ok: false,
 *     reason }` otherwise.
 *   - `fetchImpl` is injected so unit tests can pass a mock fetch
 *     without jsdom or a real network.
 *
 * Why not extend the existing `flags/syncMergeClient.js` or similar:
 *   - Different lifecycle. The sync-merge flow runs once during a QR
 *     link; pull/push of the blob happens on every page boot (pull) and
 *     potentially many times per session (push). Co-locating would
 *     bloat both modules.
 *   - Different surface — pull goes through the existing hydrate
 *     endpoint, push goes to a new endpoint. Keeping the two paired in
 *     one file makes "where do I write the blob?" obvious.
 */

const HYDRATE_ENDPOINT = '/api/v1/sync/hydrate';
const PUSH_ENDPOINT = '/api/v1/profile/sync-blob';

/**
 * @param {string} deviceId
 * @param {{ fetchImpl?: typeof fetch }} [opts]
 * @returns {Promise<
 *   | { ok: true, blob: object | null }
 *   | { ok: false, reason: string }
 * >}
 */
export async function pullSyncBlob(deviceId, opts = {}) {
  if (typeof deviceId !== 'string' || deviceId.length === 0) {
    return { ok: false, reason: 'invalid_deviceId' };
  }
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;

  let res;
  try {
    const url = `${HYDRATE_ENDPOINT}?deviceId=${encodeURIComponent(deviceId)}`;
    res = await fetchImpl(url);
  } catch {
    return { ok: false, reason: 'network_error' };
  }

  if (!res || typeof res.status !== 'number' || res.status !== 200) {
    return { ok: false, reason: `http_${res ? res.status : 'unknown'}` };
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

  // The server returns `null` for devices that have never written a blob
  // (or whose row pre-dates Feature S Phase 2). That's a successful pull
  // — the blob just isn't there yet. Callers that care about "first
  // time" can branch on `blob === null`.
  const raw = payload.syncBlob;
  const blob = (
    raw !== null
    && typeof raw === 'object'
    && !Array.isArray(raw)
  ) ? raw : null;
  return { ok: true, blob };
}

/**
 * @param {string} deviceId
 * @param {object} blob
 * @param {{ fetchImpl?: typeof fetch }} [opts]
 * @returns {Promise<{ ok: true } | { ok: false, reason: string }>}
 */
export async function pushSyncBlob(deviceId, blob, opts = {}) {
  if (typeof deviceId !== 'string' || deviceId.length === 0) {
    return { ok: false, reason: 'invalid_deviceId' };
  }
  // Mirror the server-side guard: blob must be a plain object. Arrays
  // and primitives would be rejected with a 400 anyway, so failing
  // locally saves the round-trip and surfaces the bug to the caller's
  // stack instead of a generic HTTP error.
  if (
    blob === null
    || typeof blob !== 'object'
    || Array.isArray(blob)
  ) {
    return { ok: false, reason: 'invalid_blob' };
  }
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;

  let res;
  try {
    res = await fetchImpl(PUSH_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId, blob }),
    });
  } catch {
    return { ok: false, reason: 'network_error' };
  }

  if (!res || typeof res.status !== 'number') {
    return { ok: false, reason: 'invalid_response' };
  }
  if (res.status === 204) return { ok: true };
  // Try to surface the server's error code for callers that want to
  // log/retry. Falls back to http_<status> if the body isn't valid JSON.
  let reason = `http_${res.status}`;
  try {
    const body = await res.json();
    if (body && typeof body.error === 'string') reason = body.error;
  } catch { /* leave reason as http_<status> */ }
  return { ok: false, reason };
}
