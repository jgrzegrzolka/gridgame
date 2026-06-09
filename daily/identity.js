/**
 * Anonymous browser identity for daily-puzzle submissions.
 *
 * On first call this generates a UUID and persists it under
 * `localStorage.gridgame.deviceId`. Every subsequent call returns
 * the same string. Same browser = same identity = at most one
 * accepted submission per puzzle (the server enforces uniqueness
 * via `id = "{puzzleId}:{deviceId}"` and 409s on duplicate).
 *
 * Per FEATURE.md's identity model (v1): zero PII, zero account, zero
 * third party. The server validates the deviceId is a sane 8–64 char
 * string and otherwise trusts it — cross-device sync, spoof-proofing,
 * and tied-to-person semantics are explicitly out of scope until
 * the Feature C passkey upgrade.
 *
 * `store` and `randomUUID` are injected so this is unit-testable
 * without a real localStorage or `globalThis.crypto`.
 */

const STORAGE_KEY = 'gridgame.deviceId';
const MIN_LEN = 8;
const MAX_LEN = 64;

/**
 * @param {{ getItem(key: string): string | null, setItem(key: string, value: string): void }} store
 * @param {() => string} randomUUID
 * @returns {string}
 */
export function getOrCreateDeviceId(store, randomUUID) {
  try {
    const existing = store.getItem(STORAGE_KEY);
    if (typeof existing === 'string' && existing.length >= MIN_LEN && existing.length <= MAX_LEN) {
      return existing;
    }
  } catch {
    // localStorage may throw in private mode / zero quota — fall through to create.
  }
  const fresh = randomUUID();
  try {
    store.setItem(STORAGE_KEY, fresh);
  } catch {
    // Best-effort: if we can't persist, the caller still gets a valid id
    // for this session. Next page-load will mint another one.
  }
  return fresh;
}
