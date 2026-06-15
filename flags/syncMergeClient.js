/**
 * Browser-side helpers for the `/api/v1/sync/preview` + `/api/v1/sync/merge`
 * round-trip (Feature C phase 3 — the auto-merge approach).
 *
 * Both helpers are never-throw and return discriminated unions so
 * the caller can route UI feedback without try/catch. Caller is
 * `/profile/sync/page.js` which orchestrates the full flow:
 *
 *   1. complete passkey link via `linkDevice(deviceId)` →
 *      identityId + targetDeviceId + mergeToken
 *   2. if `sourceDeviceId !== targetDeviceId`, call `syncPreview` to
 *      learn whether daily / profile conflicts exist
 *   3. if conflicts: show wizard (1–2 questions), gather resolutions
 *   4. call `syncMerge` with resolutions
 *   5. swap localStorage.gridgame.deviceId from source to target
 *
 * Same in-flight wire JSON conventions as `passkeyClient.js`.
 */

const PREVIEW_ENDPOINT = '/api/v1/sync/preview';
const MERGE_ENDPOINT = '/api/v1/sync/merge';

/**
 * @typedef {{ count: number, samplePuzzleIds: number[] } | null} DailyConflict
 * @typedef {{ target: string, source: string } | null} NicknameConflict
 *
 * @typedef {| { ok: true, sameDevice: boolean, daily: DailyConflict, profile: NicknameConflict }
 *           | { ok: false, reason: 'network_error' | 'preview_failed' }
 *          } PreviewResult
 *
 * @typedef {| { ok: true, upserts: number, deletes: number, upsertFailures: number, deleteFailures: number }
 *           | { ok: false, reason: 'network_error' | 'merge_failed' }
 *          } MergeResult
 */

/**
 * @param {{
 *   mergeToken: string,
 *   sourceDeviceId: string,
 *   fetchImpl?: typeof fetch,
 * }} args
 * @returns {Promise<PreviewResult>}
 */
export async function syncPreview({ mergeToken, sourceDeviceId, fetchImpl = globalThis.fetch }) {
  if (!mergeToken || !sourceDeviceId) {
    return { ok: false, reason: 'preview_failed' };
  }
  let res;
  try {
    res = await fetchImpl(PREVIEW_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mergeToken, sourceDeviceId }),
    });
  } catch {
    return { ok: false, reason: 'network_error' };
  }
  if (!res.ok) return { ok: false, reason: 'preview_failed' };
  /** @type {any} */
  let json;
  try { json = await res.json(); } catch { return { ok: false, reason: 'preview_failed' }; }
  return {
    ok: true,
    sameDevice: json.sameDevice === true,
    daily: json.daily && typeof json.daily === 'object'
      ? { count: Number(json.daily.count) || 0, samplePuzzleIds: Array.isArray(json.daily.samplePuzzleIds) ? json.daily.samplePuzzleIds : [] }
      : null,
    profile: json.profile && typeof json.profile === 'object' && json.profile.target && json.profile.source
      ? { target: String(json.profile.target), source: String(json.profile.source) }
      : null,
  };
}

/**
 * @param {{
 *   mergeToken: string,
 *   sourceDeviceId: string,
 *   resolutions?: { nickname?: 'target' | 'source', daily?: 'target' | 'source' },
 *   fetchImpl?: typeof fetch,
 * }} args
 * @returns {Promise<MergeResult>}
 */
export async function syncMerge({ mergeToken, sourceDeviceId, resolutions = {}, fetchImpl = globalThis.fetch }) {
  if (!mergeToken || !sourceDeviceId) {
    return { ok: false, reason: 'merge_failed' };
  }
  let res;
  try {
    res = await fetchImpl(MERGE_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mergeToken, sourceDeviceId, resolutions }),
    });
  } catch {
    return { ok: false, reason: 'network_error' };
  }
  if (!res.ok) return { ok: false, reason: 'merge_failed' };
  /** @type {any} */
  let json;
  try { json = await res.json(); } catch { return { ok: false, reason: 'merge_failed' }; }
  return {
    ok: true,
    upserts: Number(json.upserts) || 0,
    deletes: Number(json.deletes) || 0,
    upsertFailures: Number(json.upsertFailures) || 0,
    deleteFailures: Number(json.deleteFailures) || 0,
  };
}
