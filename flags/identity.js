/**
 * Anonymous browser identity for any feature that needs a stable per-device
 * key to talk to the API (daily-puzzle submissions, flagQuiz personal-best
 * tracking, etc.).
 *
 * On first call this generates a UUID and persists it under
 * `localStorage.gridgame.deviceId`. Every subsequent call returns
 * the same string — same browser = same identity. The server validates
 * the deviceId is a sane 8–64 char string and otherwise trusts it.
 *
 * Per FEATURE.md's identity model (v1): zero PII, zero account, zero
 * third party. Cross-device sync, spoof-proofing, and tied-to-person
 * semantics are explicitly out of scope until the Feature C passkey
 * upgrade.
 *
 * Lives in flags/ (not daily/) so flagQuiz and any future game-mode can
 * import from one place — clearing localStorage gives the same fresh ID
 * to every feature at once, which is exactly the desired identity model.
 *
 * `store` and `randomUUID` are injected so this is unit-testable
 * without a real localStorage or `globalThis.crypto`.
 */

export const STORAGE_KEY = 'gridgame.deviceId';
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
