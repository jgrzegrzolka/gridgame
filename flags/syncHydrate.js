/**
 * Reconstitute per-device localStorage caches from the post-merge
 * server view, called after a successful link (source flow) or after
 * the GET /api/v1/sync/link discovery (target flow). The whole point
 * of this module is to make `/daily/archive` and the flagQuiz picker
 * actually reflect what the user expects after linking — that the
 * data merged on the server also shows up on whichever browser they
 * happen to be looking at.
 *
 * Two caches to rebuild:
 *
 *   - `daily.scores` (per-puzzle archive blob): for each server row
 *     write `{f: foundCodes.length, t: totalCount, c: foundCodes}`
 *     under the puzzleId. We OVERWRITE, not additively merge, because
 *     the server's row is the post-merge truth (planDailyMerge with
 *     primary='target' keeps target's row if both devices played the
 *     same puzzle; absent that, source's transfers under target's
 *     deviceId). Local + server can never disagree about who played
 *     first — only the server knows the merge happened.
 *
 *   - Quiz personal-best (`flagquiz.best.<variant>.<mode>[.v2][.all]`):
 *     for each configKey in the server's records map, write `{score,
 *     time: durationMs}`. We also OVERWRITE, because planQuizMerge
 *     already picked the best-of-both server-side (via pickBetterEntry).
 *
 * Pure-ish: takes the server payload + a storage object, returns
 * the writes. The HTTP fetch lives in the caller. Tests don't need
 * network OR a real localStorage.
 */

import { fetchSyncLink } from './syncLinkClient.js';
import { restoreOrCreateDeviceId } from './identity.js';

/**
 * @typedef {{
 *   getItem(key: string): string | null,
 *   setItem(key: string, value: string): void,
 *   removeItem(key: string): void,
 * }} HydrateStore
 */

const DAILY_SCORES_KEY = 'daily.scores';
const NICKNAME_KEY = 'gridgame.nickname';

/**
 * Build a quiz-PB localStorage key from a configKey. Mirrors
 * `bestKey()` in flags/quiz.js exactly — kept in lockstep so future
 * changes to one update the other in the same edit. We don't import
 * the shared `bestKey` because this module is the only consumer that
 * needs to parse the "<variant>:<mode>:<scope>" wire shape, and
 * pushing parsing into quiz.js would couple it to a server format
 * that doesn't belong there.
 *
 * Accepts both wire shapes (Feature V Phase 1a):
 *   "<variant>:<mode>"           — current; sovereign pool, so it maps to
 *                                  the same unsuffixed key `bestKey(v, m)`
 *                                  builds. A legacy `:sov` key and its
 *                                  renamed 2-part form therefore land on
 *                                  the same slot, which is what lets the
 *                                  Phase 1c rename be a no-op for players.
 *   "<variant>:<mode>:<sov|all>" — legacy, pre-Feature-V.
 *
 * Returns null for any other shape — defensive against malformed server
 * responses (the row wouldn't have been written via the normal client path
 * either way, but a stale backfill could leave odd keys). Note the failure
 * here is silent by nature: return null and the device simply never
 * restores that PB, with nothing logged. Widen before the wire changes.
 *
 * @param {string} configKey
 * @returns {string | null}
 */
function bestKeyFromConfigKey(configKey) {
  const parts = configKey.split(':');
  if (parts.length !== 2 && parts.length !== 3) return null;
  const [variant, mode, scope] = parts;
  if (!variant || !mode) return null;
  if (parts.length === 3 && scope !== 'sov' && scope !== 'all') return null;
  const base = mode === 'all'
    ? `flagquiz.best.${variant}.${mode}.v2`
    : `flagquiz.best.${variant}.${mode}`;
  return scope === 'all' ? `${base}.all` : base;
}

/**
 * Apply a hydrate payload to local storage. Returns counts (mostly
 * for tests and for the per-call summary the sync page can log).
 *
 * @param {{
 *   store: HydrateStore,
 *   payload: {
 *     daily: Array<{ puzzleId: number, foundCodes: string[], totalCount: number, wrongCodes?: string[] }>,
 *     records: Record<string, { score: number, durationMs: number }>,
 *     nickname?: string | null,
 *   },
 * }} args
 * @returns {{ dailyWritten: number, quizWritten: number, nicknameWritten: boolean }}
 */
export function applyHydratePayload({ store, payload }) {
  let dailyWritten = 0;
  let quizWritten = 0;
  let nicknameWritten = false;

  // Daily: read the existing scores blob, write each server row into
  // the map, persist once. One read/write per call instead of N writes
  // — the blob is the storage unit, not the individual entries.
  if (Array.isArray(payload.daily) && payload.daily.length > 0) {
    /** @type {Record<number, { f: number, t: number, c?: string[] }>} */
    let scores = {};
    try {
      const raw = store.getItem(DAILY_SCORES_KEY);
      if (typeof raw === 'string') {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          scores = /** @type {any} */ (parsed);
        }
      }
    } catch {
      // Malformed blob — start fresh. Same defensive parse the existing
      // loadScores() uses; preserving the broken JSON would just shadow
      // the hydrate result.
      scores = {};
    }
    for (const row of payload.daily) {
      if (!Number.isInteger(row.puzzleId) || row.puzzleId < 1) continue;
      const codes = Array.isArray(row.foundCodes) ? row.foundCodes : [];
      /** @type {{ f: number, t: number, c: string[], w?: string[] }} */
      const next = {
        f: codes.length,
        t: row.totalCount,
        c: codes,
      };
      // Wrong guesses ride along when the server sends them. They power the
      // revisit "your wrong guesses" section and the daily heart row, which
      // derives spent hearts from this list — a hydrated record without it
      // showed a full row on a puzzle the player had actually fumbled.
      const wrong = Array.isArray(row.wrongCodes)
        ? row.wrongCodes.filter((/** @type {unknown} */ x) => typeof x === 'string')
        : null;
      if (wrong && wrong.length > 0) {
        next.w = wrong;
      } else if (wrong === null) {
        // Server sent nothing (older deploy, or a row predating the field).
        // This hydrate overwrites the record wholesale, so preserve whatever
        // the device already knew rather than silently deleting it.
        const prev = /** @type {any} */ (scores[row.puzzleId]);
        if (prev && Array.isArray(prev.w) && prev.w.length > 0) next.w = [...prev.w];
      }
      scores[row.puzzleId] = next;
      dailyWritten += 1;
    }
    try {
      store.setItem(DAILY_SCORES_KEY, JSON.stringify(scores));
    } catch {
      // Quota / private-mode write failure — silent. Next hydrate
      // retries; the page meanwhile shows whatever local already had.
    }
  }

  // Quiz: one localStorage key per (variant, mode, scope) tuple. Skip
  // entries we can't parse a key from.
  if (payload.records && typeof payload.records === 'object') {
    for (const [configKey, entry] of Object.entries(payload.records)) {
      if (!entry || typeof entry.score !== 'number' || typeof entry.durationMs !== 'number') continue;
      const key = bestKeyFromConfigKey(configKey);
      if (!key) continue;
      try {
        store.setItem(key, JSON.stringify({ score: entry.score, time: entry.durationMs }));
        quizWritten += 1;
      } catch {
        // Skip this entry; continue with the rest.
      }
    }
  }

  // Nickname: write the server's value to the cache so /profile/
  // shows the chosen name instead of the deterministic default. A
  // server-side `null` (no nickname ever saved) clears any stale
  // local cache so display falls back to the default cleanly.
  // `undefined` (key not in payload) is a no-op — keeps backward
  // compat with any caller that omits the field.
  if ('nickname' in payload) {
    try {
      if (typeof payload.nickname === 'string' && payload.nickname.length > 0) {
        store.setItem(NICKNAME_KEY, payload.nickname);
        nicknameWritten = true;
      } else if (payload.nickname === null) {
        store.removeItem(NICKNAME_KEY);
        nicknameWritten = true;
      }
    } catch {
      // Cache failure is non-fatal — server is the source of truth.
    }
  }

  return { dailyWritten, quizWritten, nicknameWritten };
}

const LAST_HYDRATE_KEY = 'gridgame.lastHydrateAt';
const DEFAULT_MIN_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

// Self-discovery throttle. A *target* device (one that another device
// linked TO) only learns it's linked — and back-fills `identityId` —
// when something runs the linkedAt probe. The /profile/sync/ page does
// it, but the daily / archive / flagQuiz boots (which actually need the
// hydrate) never did, so a target that never reopened the sync page was
// stuck re-playing puzzles the other device already solved. We now probe
// from the ambient sync, throttled to at most once per this interval so
// the 99% of unlinked players pay one cheap GET per day, not one per load.
const LINK_PROBE_KEY = 'gridgame.linkProbedAt';
const DEFAULT_LINK_PROBE_INTERVAL_MS = 24 * 60 * 60 * 1000; // 1 day

const ENDPOINT = '/api/v1/sync/hydrate';

/**
 * One-time-ish self-discovery for a *target* device. Asks the server
 * whether this deviceId is in a link record (`linkedAt` stamped on its
 * profile row by `syncMerge`); on a hit, writes `identityId = deviceId`
 * into localStorage — exactly what /profile/sync/ does on its own boot —
 * so the rest of trySyncDevices (and every future boot) treats this
 * device as linked and hydrates.
 *
 * Throttled by a persisted `linkProbedAt` timestamp so an unlinked
 * device pays at most one probe per `probeIntervalMs`. Never throws;
 * a failed / not-linked probe simply returns false.
 *
 * @param {{
 *   deviceId: string,
 *   store: HydrateStore,
 *   identityKey: string,
 *   now: number,
 *   fetchImpl?: typeof fetch,
 *   probeIntervalMs: number,
 * }} args
 * @returns {Promise<boolean>}
 */
async function tryDiscoverLink({ deviceId, store, identityKey, now, fetchImpl, probeIntervalMs }) {
  if (!deviceId) return false;
  let last = 0;
  try {
    const raw = store.getItem(LINK_PROBE_KEY);
    if (typeof raw === 'string') {
      const n = Number.parseInt(raw, 10);
      if (Number.isFinite(n) && n > 0) last = n;
    }
  } catch {}
  if (last > 0 && now - last < probeIntervalMs) return false;
  // Stamp before the await so concurrent tabs don't both probe.
  try { store.setItem(LINK_PROBE_KEY, String(now)); } catch {}
  const { linked } = await fetchSyncLink({ deviceId, fetchImpl });
  if (!linked) return false;
  try { store.setItem(identityKey, deviceId); } catch {}
  return true;
}

/**
 * Background-safe ambient sync. Called on page boots that read local
 * cache (daily archive, today's daily, flagQuiz picker) to refresh
 * the local view of "what plays exist for this deviceId" from the
 * server — picking up anything the OTHER linked browser may have
 * submitted in the meantime.
 *
 * Two gates, both designed to keep this free for the vast majority
 * of players who never link a second device:
 *
 *   1. **Identity gate.** No `localStorage[identityKey]` → return
 *      immediately. Zero network, zero work for unlinked users. The
 *      cost on every page load for a fresh player is one localStorage
 *      read.
 *   2. **Staleness gate.** `lastHydrateAt` from a previous run inside
 *      the last `minIntervalMs` → return immediately. Default
 *      interval is 1 hour, which is more than enough for a daily
 *      puzzle game where the archive doesn't change every minute.
 *
 * The timestamp gets stamped BEFORE the network call so concurrent
 * tabs (the user has both /daily/ and /daily/archive open) don't
 * both fire the GET. On failure we still skip until next window —
 * better than hammering a broken endpoint, and the next legitimate
 * page load will retry once the interval rolls over.
 *
 * `force: true` bypasses the staleness gate (still respects the
 * identity gate). Used by callers that need fresh data to make a UX
 * decision *now* — e.g. the daily-puzzle revisit check: we'd rather
 * pay one extra GET than ask a linked player to re-play a puzzle the
 * other device already submitted (issue #543).
 *
 * @param {{
 *   deviceId: string,
 *   store: HydrateStore & { removeItem?: (k: string) => void },
 *   identityKey: string,
 *   minIntervalMs?: number,
 *   probeIntervalMs?: number,
 *   now?: number,
 *   fetchImpl?: typeof fetch,
 *   force?: boolean,
 * }} args
 * @returns {Promise<
 *   | { ran: false, reason: 'unlinked' | 'fresh' }
 *   | { ran: true, ok: true, dailyWritten: number, quizWritten: number, nicknameWritten: boolean }
 *   | { ran: true, ok: false }
 * >}
 */
export async function trySyncDevices({
  deviceId, store, identityKey,
  minIntervalMs = DEFAULT_MIN_INTERVAL_MS,
  probeIntervalMs = DEFAULT_LINK_PROBE_INTERVAL_MS,
  now = Date.now(),
  fetchImpl,
  force = false,
}) {
  let identity = null;
  try { identity = store.getItem(identityKey); } catch {}
  if (typeof identity !== 'string' || identity.length === 0) {
    // No local identity — but this device might be a *target* that was
    // linked from another device without us ever visiting /profile/sync/
    // to self-discover. Probe the link endpoint (throttled to once per
    // `probeIntervalMs`); on a hit, back-fill identityId and fall through
    // to hydrate immediately. On a miss / throttle, stay unlinked.
    const discovered = await tryDiscoverLink({
      deviceId, store, identityKey, now, fetchImpl, probeIntervalMs,
    });
    if (!discovered) return { ran: false, reason: 'unlinked' };
  }

  if (!force) {
    let last = 0;
    try {
      const raw = store.getItem(LAST_HYDRATE_KEY);
      if (typeof raw === 'string') {
        const n = Number.parseInt(raw, 10);
        if (Number.isFinite(n) && n > 0) last = n;
      }
    } catch {}
    // `last === 0` = never run on this browser → always proceed.
    // Otherwise gate on the interval. The explicit `last > 0` check
    // means tests can use small `now` values without spuriously
    // tripping the fresh gate.
    if (last > 0 && now - last < minIntervalMs) {
      return { ran: false, reason: 'fresh' };
    }
  }

  // Stamp BEFORE the await so a second tab navigating at the same
  // millisecond won't also enter the GET branch. A failed GET still
  // burns the window; that's intentional.
  try { store.setItem(LAST_HYDRATE_KEY, String(now)); } catch {}

  const res = await hydrateFromServer({ deviceId, store, fetchImpl });
  if (res.ok) return { ran: true, ok: true, dailyWritten: res.dailyWritten, quizWritten: res.quizWritten, nicknameWritten: res.nicknameWritten };
  return { ran: true, ok: false };
}

/**
 * Fetch + apply in one call. Never-throws — every failure mode
 * leaves the local cache untouched.
 *
 * @param {{
 *   deviceId: string,
 *   store: HydrateStore,
 *   fetchImpl?: typeof fetch,
 * }} args
 * @returns {Promise<{ ok: true, dailyWritten: number, quizWritten: number, nicknameWritten: boolean } | { ok: false }>}
 */
export async function hydrateFromServer({ deviceId, store, fetchImpl = globalThis.fetch }) {
  if (!deviceId) return { ok: false };
  let res;
  try {
    res = await fetchImpl(`${ENDPOINT}?deviceId=${encodeURIComponent(deviceId)}`, {
      method: 'GET',
      headers: { accept: 'application/json' },
    });
  } catch {
    return { ok: false };
  }
  if (!res.ok) return { ok: false };
  /** @type {any} */
  let json;
  try { json = await res.json(); } catch { return { ok: false }; }
  const counts = applyHydratePayload({ store, payload: json });
  return { ok: true, ...counts };
}

/**
 * Boot-time identity resolution for every page that reads the
 * eviction-vulnerable localStorage caches (`daily.scores`, `flagquiz.best.*`).
 * Feature W. This is the single entry point the daily, archive, and flagQuiz
 * boots call — the restore↔hydrate contract lives here, not copy-pasted into
 * each boot.
 *
 * It resolves the deviceId durably (restoring the original id from the
 * `gg_did` cookie via /whoami when localStorage was evicted) and — *only* when
 * the id had to be restored — rebuilds the local caches from Cosmos before the
 * page reads them. The gate is `restored`, NEVER "the cache looks empty":
 * `applyHydratePayload` overwrites, so hydrating a device that simply hasn't
 * synced its local-only plays yet would clobber them.
 *
 * A restore-path hydrate also stamps `LAST_HYDRATE_KEY` so the ambient
 * `trySyncDevices` staleness gate won't immediately re-fetch the same payload
 * this hour (it just did).
 *
 * Never throws — a failed /whoami degrades to a freshly minted id, exactly as
 * the non-durable path always did.
 *
 * @param {{
 *   store: HydrateStore,
 *   randomUUID: () => string,
 *   fetchImpl?: typeof fetch,
 *   now?: number,
 * }} args
 * @returns {Promise<string>} the resolved deviceId
 */
export async function resolveIdentityAndHydrate({ store, randomUUID, fetchImpl = globalThis.fetch, now = Date.now() }) {
  const { deviceId, restored } = await restoreOrCreateDeviceId(store, randomUUID, fetchImpl);
  if (restored) {
    await hydrateFromServer({ deviceId, store, fetchImpl });
    try { store.setItem(LAST_HYDRATE_KEY, String(now)); } catch { /* best-effort */ }
  }
  return deviceId;
}
