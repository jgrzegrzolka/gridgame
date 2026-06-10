/**
 * Heuristic incognito / private-browsing detection. There is no
 * official API for this — every approach is a fingerprinting-adjacent
 * inference from a side-channel. The least-bad signal is the Storage
 * Quota API: regular browsers report tens of GB of available quota,
 * while private/incognito modes cap it well below that so private
 * session data can't grow unboundedly before being thrown away.
 *
 * Observed quotas in 2026:
 *   - Chrome / Edge incognito : ~100-120 MB
 *   - Firefox private          : ~5-10 MB
 *   - Safari private           : ~10-100 MB
 *
 * Regular-mode quotas on the smallest plausible devices (5 GB
 * Chromebooks, low-storage Android phones) tend to stay well above
 * 500 MB. The 120 MB threshold below is conservative — sized to be
 * solidly above private quotas without false-positiving cramped
 * devices. False positives are tolerable since the field is a
 * diagnostic only (the daily finish flow stores it on the Cosmos
 * row so the owner can spot incognito-test pollution and delete it
 * manually — stats aggregation never filters on this value).
 *
 * Privacy posture: we mark a row as "this submission was likely
 * incognito" — we do NOT block, redirect, or alter the player's
 * experience based on it. The owner uses it to keep his own test
 * pollution out of the data.
 */

const QUOTA_THRESHOLD_BYTES = 120 * 1024 * 1024; // 120 MB

/**
 * Pure threshold check, separated so unit tests can exercise the rule
 * without mocking the Storage API. Returns true when the supplied
 * quota looks consistent with a private / incognito session.
 *
 * @param {number | null | undefined} quotaBytes
 * @returns {boolean}
 */
export function isLikelyIncognitoFromQuota(quotaBytes) {
  if (typeof quotaBytes !== 'number' || !Number.isFinite(quotaBytes) || quotaBytes <= 0) return false;
  return quotaBytes < QUOTA_THRESHOLD_BYTES;
}

/**
 * Run the heuristic against the real browser. Resolves to `false` in
 * any environment where the API is missing or throws, so callers can
 * attach the result to a POST body unconditionally without try/catch
 * at the call site.
 *
 * @returns {Promise<boolean>}
 */
export async function detectIncognito() {
  try {
    if (typeof navigator === 'undefined' || !navigator.storage || !navigator.storage.estimate) {
      return false;
    }
    const { quota } = await navigator.storage.estimate();
    return isLikelyIncognitoFromQuota(quota);
  } catch {
    return false;
  }
}
