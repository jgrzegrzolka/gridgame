/**
 * Anonymous browser identity for any feature that needs a stable per-device
 * key — daily-puzzle submissions, flagQuiz personal-best tracking, tic-tac-toe
 * online role stickiness, and (incoming) device-profile nicknames.
 *
 * On first call this generates a UUID and persists it under
 * `localStorage.gridgame.deviceId`. Every subsequent call returns
 * the same string — same browser = same identity. The server validates
 * the deviceId is a sane 8–64 char string and otherwise trusts it.
 *
 * Per FEATURE.md's three-layer identity model, this is **Layer 0 (anonymous
 * deviceId)** — zero PII, zero account, zero third party. The deviceId can
 * later be extended with a server-side profile (Layer 1, Feature H2: nickname
 * + metadata keyed by deviceId) and then with cross-device account linking
 * (Layer 2, Feature C: passkey-bound userId fanning out to N deviceIds).
 * Both layers are additive on top of this module's output.
 *
 * Lives in flags/ (not daily/ or ticTacToe/) so every consumer imports from
 * one place — clearing localStorage gives the same fresh ID to every feature
 * at once, which is exactly the desired identity model.
 *
 * `store` and `randomUUID` are injected so this is unit-testable
 * without a real localStorage or `globalThis.crypto`.
 */

/**
 * Minimal subset of the `Storage` interface this module touches. Lets tests
 * pass a Map-backed fake and lets the JSDoc shape stay in one place for both
 * the public read/write path and the legacy-key migration.
 *
 * @typedef {{
 *   getItem(key: string): string | null,
 *   setItem(key: string, value: string): void,
 *   removeItem(key: string): void,
 * }} Store
 */

export const STORAGE_KEY = 'gridgame.deviceId';
/**
 * Pre-Feature-H key that ticTacToe online used as its own identity. Swept
 * into `STORAGE_KEY` on first read after deploy so the two layers reuse one
 * UUID per browser instead of two; the legacy key is then removed.
 */
export const LEGACY_PLAYER_ID_KEY = 'gridgame.player.id';

/**
 * Cross-device identity (Feature C). Present once the user has
 * completed a passkey register/auth via /profile/sync/. Every write
 * helper that knows about it adds it to its POST body so the server
 * can stamp matching `identityId` on the row. Reads (`daily/me`
 * streak compute) take it as an optional query param and merge
 * across deviceIds.
 *
 * Lives in the same module as `STORAGE_KEY` so the deviceId/identityId
 * pair has one source of truth.
 */
export const IDENTITY_STORAGE_KEY = 'gridgame.identityId';

/**
 * Read the current identityId from localStorage, or null if the user
 * hasn't linked their devices yet. Never throws.
 *
 * @param {Store} store
 * @returns {string | null}
 */
export function readIdentityId(store) {
  try {
    const v = store.getItem(IDENTITY_STORAGE_KEY);
    return typeof v === 'string' && v.length > 0 ? v : null;
  } catch {
    return null;
  }
}

const MIN_LEN = 8;
const MAX_LEN = 64;

/**
 * @param {Store} store
 * @param {() => string} randomUUID
 * @returns {string}
 */
export function getOrCreateDeviceId(store, randomUUID) {
  migrateLegacyPlayerId(store);
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

/**
 * @param {Store} store
 */
function migrateLegacyPlayerId(store) {
  try {
    const legacy = store.getItem(LEGACY_PLAYER_ID_KEY);
    if (typeof legacy !== 'string') return;
    const current = store.getItem(STORAGE_KEY);
    if (typeof current !== 'string') {
      store.setItem(STORAGE_KEY, legacy);
    }
    store.removeItem(LEGACY_PLAYER_ID_KEY);
  } catch {
    // Best-effort — next call retries. Worst case the legacy key lingers
    // and the player gets a separate fresh deviceId; identity is anonymous
    // so a duplicate is harmless.
  }
}
