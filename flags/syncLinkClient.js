/**
 * Browser helper for `GET /api/v1/sync/link?deviceId=…`.
 *
 * Both devices in a link pair end up with the SAME deviceId post-merge
 * (source's localStorage gets swapped to the target's id), so this
 * single endpoint serves both: each browser asks "is my current
 * deviceId in a link record?" and gets the same answer once linked.
 *
 * The endpoint reads `linkedAt` off the target's profile row, which
 * `planProfileMerge` stamps at merge time. Source browsers already
 * know they linked because they set `gridgame.identityId` themselves;
 * this exists for the *target* browser (the one that only showed the
 * QR) to discover it on its next /profile/sync/ visit.
 *
 * Never-throw: every failure mode resolves to `{ linked: false }` so
 * the page can degrade to the unlinked render instead of error-modal'ing.
 */

const ENDPOINT = '/api/v1/sync/link';

/**
 * @param {{
 *   deviceId: string,
 *   fetchImpl?: typeof fetch,
 * }} args
 * @returns {Promise<{ linked: boolean, linkedAt: number | null }>}
 */
export async function fetchSyncLink({ deviceId, fetchImpl = globalThis.fetch }) {
  if (!deviceId) return { linked: false, linkedAt: null };
  let res;
  try {
    res = await fetchImpl(`${ENDPOINT}?deviceId=${encodeURIComponent(deviceId)}`, {
      method: 'GET',
      headers: { accept: 'application/json' },
    });
  } catch {
    return { linked: false, linkedAt: null };
  }
  if (!res.ok) return { linked: false, linkedAt: null };
  /** @type {any} */
  let json;
  try { json = await res.json(); } catch { return { linked: false, linkedAt: null }; }
  return {
    linked: json.linked === true,
    linkedAt: typeof json.linkedAt === 'number' ? json.linkedAt : null,
  };
}
