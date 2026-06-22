/**
 * Client helper that ensures every active device has a server-side profile
 * row. Per FEATURE.md Feature S Phase 1a: on first non-trivial action
 * (daily submit, quiz finish, TTT match completed, share click, coffee
 * click — *not* opening the home page), call `ensureProfile(deviceId)`.
 *
 * Behaviour:
 *   - localStorage sentinel `gridgame.profileEnsured` makes this a
 *     once-per-device call. After the first success, future invocations
 *     short-circuit before any network roundtrip.
 *   - Fire-and-forget. Never throws. Returns Promise<boolean> resolving to
 *     true when the row exists (201 fresh insert, 200 already-exists, 200
 *     deduped race) and false otherwise (network failure, 4xx/5xx). The
 *     caller doesn't need to await — most call sites use `void`.
 *   - Idempotent on the server too (see `api/src/functions/profileEnsure.js`),
 *     so a duplicate call across cache wipes is harmless.
 *
 * Why a localStorage sentinel and not just lean on the server idempotency:
 *   - Avoids one HTTP round-trip per page-load after the first. The
 *     server check is point-read cheap (~1 RU) but the bandwidth is free
 *     to save.
 *   - Matches the "fire on every action" model — the localStorage flag
 *     guards "I already did this", so the call sites stay terse:
 *     `void ensureProfile(deviceId)` next to each event.
 *
 * Why `store` and `fetchImpl` are injected: lets the unit tests pass a
 * Map-backed fake localStorage and a synchronous mock fetch instead of
 * spinning up jsdom. Same pattern as `flags/identity.js`.
 */

const ENDPOINT = '/api/v1/profile/ensure';

/**
 * Sentinel key. `'1'` once the device has a confirmed server row. Single
 * value — we don't track timestamps or versions; "did we already ensure"
 * is enough.
 */
export const STORAGE_KEY = 'gridgame.profileEnsured';

/**
 * @typedef {{
 *   getItem(key: string): string | null,
 *   setItem(key: string, value: string): void,
 * }} Store
 */

/**
 * @param {string} deviceId
 * @param {{
 *   store?: Store,
 *   fetchImpl?: typeof fetch,
 * }} [opts]
 * @returns {Promise<boolean>}
 */
export async function ensureProfile(deviceId, opts = {}) {
  if (typeof deviceId !== 'string' || deviceId.length === 0) return false;

  const store = opts.store ?? safeLocalStorage();
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;

  if (store) {
    try {
      if (store.getItem(STORAGE_KEY) === '1') return true;
    } catch {
      // Private mode / quota exceptions: fall through and try the network
      // call. Worst case we send one extra POST per page-load, which is
      // safe because the server is idempotent.
    }
  }

  try {
    const res = await fetchImpl(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId }),
    });
    // 201 = fresh insert, 200 = already existed (or 409-on-race normalised
    // to 200 by the server). Both mean "row exists" — the postcondition we
    // promised. 429s / 5xx leave the sentinel unset so the next action
    // retries; 4xx body-validation errors do too (the deviceId would
    // have to be malformed for that, which shouldn't happen).
    if (res.ok) {
      if (store) {
        try { store.setItem(STORAGE_KEY, '1'); } catch { /* best-effort */ }
      }
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Return globalThis.localStorage if it looks usable, null otherwise.
 * Defensive guard for SSR / test environments where localStorage isn't
 * defined — the helper still works (just without the sentinel
 * short-circuit) if someone forgets to inject a store.
 *
 * @returns {Store | null}
 */
function safeLocalStorage() {
  try {
    const ls = /** @type {any} */ (globalThis).localStorage;
    if (ls && typeof ls.getItem === 'function' && typeof ls.setItem === 'function') {
      return ls;
    }
  } catch {
    /* fall through */
  }
  return null;
}
