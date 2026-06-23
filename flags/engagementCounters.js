import { pushSyncBlob } from './syncBlob.js';

/**
 * Client-owned engagement counters (Feature S Phase 3). Replaces the
 * server-side `engagementEvents` container as the source of truth for
 * the achievement signals that used to live there:
 *
 *   - per-surface share counts (drives "Daily Sharer" / "Quiz Sharer" /
 *     "Custom Crafter" / a future "TTT Sharer" if anyone wants it)
 *   - coffee click count (drives "Angel Investor")
 *   - 60s-quiz day log + derived snapshot (drives "Sprint Habit" /
 *     "Steady Sprinter" / "Monthly Sprinter" / "Quiz Centurion")
 *
 * Lives under `localStorage.gridgame.engagementState`. Shape mirrors
 * the `syncBlob.engagement` section exactly so `getSyncBlobSection`
 * returns it verbatim — the local mirror IS what gets pushed to the
 * server. One source of truth on the client; the server's copy is a
 * backup for cross-device roaming.
 *
 * Design choices:
 *
 *   - **Snapshot fields are derived, not stored separately.** The
 *     `quiz60sCurrentStreak` / `quiz60sMaxStreak` / `quiz60sDistinctDays`
 *     fields that the achievement evaluator wants are computed from
 *     `quiz60sDayLog` on read. Storing them denormalised would let the
 *     log and the snapshot drift; deriving on read keeps one truth.
 *
 *   - **All inputs are injected.** `store` (localStorage-like),
 *     `now` (ms), and `today` (Warsaw day number) come from the caller
 *     so tests don't need globals.
 *
 *   - **bump\* helpers are read-modify-write on `store`.** Each one
 *     loads, mutates, persists. Cheap (localStorage writes are
 *     synchronous, the state object is small), and means callers don't
 *     have to remember to call `save()`.
 *
 *   - **No syncBlob push from here.** The counter bump is local-only;
 *     the caller decides when to mirror the new state to the server
 *     (typically immediately after a bump, via `pushSyncBlob`). Keeps
 *     this module pure and testable without the network.
 */

export const STORAGE_KEY = 'gridgame.engagementState';
export const STATE_VERSION = 1;

/**
 * localStorage key used by `pushEngagementBlob` to throttle pushes
 * (Feature S Phase 4.5). Value is the unix-ms timestamp of the last
 * successful push. A bump within `PUSH_THROTTLE_MS` of the last
 * successful push is dropped — the in-memory state is still
 * authoritative on this device, and achievement evaluation reads
 * directly from localStorage (no longer dependent on the server's
 * syncBlob being fresh).
 */
export const PUSHED_AT_KEY = 'gridgame.engagementPushedAt';
export const PUSH_THROTTLE_MS = 30 * 60 * 1000;  // 30 minutes

/**
 * Known share surfaces. Adding a new one here also requires teaching
 * the achievement evaluator that consumes the counts (Phase 4 work);
 * keeping the list closed prevents silent data drift.
 *
 * `ttt` is tracked even though no current achievement consumes it —
 * future-proofs a "TTT Sharer" tier without a schema change. The
 * `engagementCompute.js` legacy did the same.
 */
export const SHARE_SURFACES = /** @type {const} */ (['daily', 'flagquiz', 'findflag', 'ttt']);

/**
 * @typedef {'daily' | 'flagquiz' | 'findflag' | 'ttt'} ShareSurface
 *
 * @typedef {{
 *   v: 1,
 *   shares: { daily: number, flagquiz: number, findflag: number, ttt: number },
 *   coffeeClickCount: number,
 *   quiz60sDayLog: number[],
 * }} EngagementState
 *
 * @typedef {{
 *   getItem(key: string): string | null,
 *   setItem(key: string, value: string): void,
 * }} Store
 */

/**
 * Returns the initial / "empty" state. Every counter zero, no day-log
 * entries. Used on first call before any data has been persisted, and
 * by `inflateFromBlob` as the baseline before overlaying a remote
 * blob's fields.
 *
 * @returns {EngagementState}
 */
export function emptyState() {
  return {
    v: STATE_VERSION,
    shares: { daily: 0, flagquiz: 0, findflag: 0, ttt: 0 },
    coffeeClickCount: 0,
    quiz60sDayLog: [],
  };
}

/**
 * Load + sanitise the state from localStorage. Anything malformed is
 * treated as "no state" — same return as a fresh device. Defensive
 * because (a) a future schema bump might land before its migrator does
 * and (b) a hand-edited / quota-exceeded write could leave garbage.
 *
 * @param {Store} store
 * @returns {EngagementState}
 */
export function loadState(store) {
  let raw;
  try {
    raw = store.getItem(STORAGE_KEY);
  } catch {
    return emptyState();
  }
  if (typeof raw !== 'string' || raw.length === 0) return emptyState();
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return emptyState();
  }
  if (!parsed || typeof parsed !== 'object') return emptyState();

  // Defensive cleaning. Anything we don't recognise gets discarded
  // rather than coerced — surfaces that aren't on our known list, day
  // numbers that aren't finite integers, etc.
  const state = emptyState();
  if (parsed.shares && typeof parsed.shares === 'object') {
    for (const surface of SHARE_SURFACES) {
      const n = parsed.shares[surface];
      if (Number.isInteger(n) && n >= 0) state.shares[surface] = n;
    }
  }
  if (Number.isInteger(parsed.coffeeClickCount) && parsed.coffeeClickCount >= 0) {
    state.coffeeClickCount = parsed.coffeeClickCount;
  }
  if (Array.isArray(parsed.quiz60sDayLog)) {
    // Dedup + sort so callers can rely on the log being ordered without
    // re-sorting. Same shape `streakCompute` expects on the server.
    const set = new Set();
    for (const n of parsed.quiz60sDayLog) {
      if (Number.isInteger(n) && n >= 0) set.add(n);
    }
    state.quiz60sDayLog = [...set].sort((a, b) => a - b);
  }
  return state;
}

/**
 * Persist the state. Silently absorbs `setItem` failures (private mode,
 * quota exceeded) so the caller never has to try/catch — a counter that
 * doesn't persist locally still mirrors to syncBlob on the next push.
 *
 * @param {Store} store
 * @param {EngagementState} state
 */
export function saveState(store, state) {
  try {
    store.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* best-effort */
  }
}

/**
 * Increment the per-surface share counter and persist.
 *
 * @param {Store} store
 * @param {ShareSurface} surface
 * @returns {EngagementState} the new state (lets callers chain into pushSyncBlob without a re-load)
 */
export function bumpShare(store, surface) {
  if (!/** @type {readonly string[]} */ (SHARE_SURFACES).includes(surface)) {
    // Unknown surface: load + return unchanged so callers see consistent
    // state, but don't fabricate a counter. Catches typos at the call
    // site without crashing the page.
    return loadState(store);
  }
  const state = loadState(store);
  state.shares[surface] = (state.shares[surface] || 0) + 1;
  saveState(store, state);
  return state;
}

/**
 * @param {Store} store
 * @returns {EngagementState}
 */
export function bumpCoffeeClick(store) {
  const state = loadState(store);
  state.coffeeClickCount += 1;
  saveState(store, state);
  return state;
}

/**
 * Record a day (Warsaw day number) on the 60s-quiz log. Idempotent:
 * the same day passed twice doesn't double-count. Sorted insert keeps
 * the log ready for `streakCompute` without a re-sort on read.
 *
 * @param {Store} store
 * @param {number} dayId
 * @returns {EngagementState}
 */
export function bumpQuiz60sDay(store, dayId) {
  if (!Number.isInteger(dayId) || dayId < 0) return loadState(store);
  const state = loadState(store);
  if (state.quiz60sDayLog.includes(dayId)) return state;
  // Insert in sorted position. Log is small (~365 entries max in
  // practice), so the array splice cost is negligible compared to
  // re-sorting + JSON.stringify on save.
  let i = 0;
  while (i < state.quiz60sDayLog.length && state.quiz60sDayLog[i] < dayId) i++;
  state.quiz60sDayLog.splice(i, 0, dayId);
  saveState(store, state);
  return state;
}

/**
 * Returns the engagement section of the syncBlob ready to push. The
 * shape matches `loadState`'s output because the local mirror IS what
 * gets stored server-side — no transformation needed. Caller is
 * expected to wrap as `{ v: 1, engagement: getSyncBlobSection(store) }`
 * when pushing.
 *
 * @param {Store} store
 * @returns {EngagementState}
 */
export function getSyncBlobSection(store) {
  return loadState(store);
}

/**
 * Overwrite localStorage from a remote blob's engagement section (e.g.
 * after `pullSyncBlob` returns one). Sanitises the same way `loadState`
 * does so a malformed blob can't poison local state. Returns the new
 * state for callers that want to act on it immediately.
 *
 * @param {Store} store
 * @param {unknown} blobEngagement
 * @returns {EngagementState}
 */
export function inflateFromBlob(store, blobEngagement) {
  if (!blobEngagement || typeof blobEngagement !== 'object') {
    const empty = emptyState();
    saveState(store, empty);
    return empty;
  }
  // Re-use loadState's sanitiser by round-tripping through JSON. Avoids
  // duplicating the validation rules in two places.
  const wrapper = /** @type {Store} */ ({
    getItem: (/** @type {string} */ k) => k === STORAGE_KEY ? JSON.stringify(blobEngagement) : null,
    setItem: () => {},
  });
  const sanitised = loadState(wrapper);
  saveState(store, sanitised);
  return sanitised;
}

/**
 * Wrap the current local state into the full sync-blob envelope
 * (`{ v: 1, engagement: ... }`) and push it to the server. The wrap +
 * version belong to the syncBlob schema, not to any individual call
 * site — keeping them here means a Phase 5 addition (e.g. an `attempts`
 * section) updates one place, and every emit site stays a clean
 * "bump local, sync remote" pair.
 *
 * **Throttled** (Feature S Phase 4.5): pushes are capped at one per
 * `PUSH_THROTTLE_MS` per device. Within that window, calls return
 * `{ ok: true, skipped: true }` and no network request is made. The
 * local state is still authoritative on the device — achievement
 * evaluation reads from `engagementCounters` localStorage directly via
 * `flags/engagementSnapshot.js`, so UX is unaffected by the
 * throttle. The push only matters for cross-device sync, which
 * happens on QR-link (`syncMerge`) and on first boot of a fresh
 * device (`engagementMigration`).
 *
 * Why a hard throttle: at the cost goal (€0 even at 50k DAU), we
 * can't afford a flood of profile-row upserts during a traffic
 * spike. Throttling caps per-device writes at 48/day — comfortably
 * within free-tier headroom even if every active user bumps every
 * 30 minutes for a full day.
 *
 * Fire-and-forget by convention: callers `void pushEngagementBlob(...)`.
 * The underlying `pushSyncBlob` never throws and surfaces failures via
 * its result tuple — passed back here unchanged for callers that want
 * to await + branch.
 *
 * `now` is injected so unit tests can pin the throttle window without
 * fake timers. In real use, callers omit it and the helper reads
 * `Date.now()` itself.
 *
 * @param {string} deviceId
 * @param {Store} store
 * @param {{ fetchImpl?: typeof fetch, now?: number }} [opts]
 * @returns {Promise<{ ok: true, skipped?: boolean } | { ok: false, reason: string }>}
 */
export async function pushEngagementBlob(deviceId, store, opts = {}) {
  const now = typeof opts.now === 'number' ? opts.now : Date.now();
  let lastPushedAt = 0;
  try {
    const raw = store.getItem(PUSHED_AT_KEY);
    if (typeof raw === 'string' && raw.length > 0) {
      const n = Number(raw);
      if (Number.isFinite(n) && n > 0) lastPushedAt = n;
    }
  } catch {
    // localStorage read failure: treat as no prior push, proceed.
  }

  // lastPushedAt === 0 means "never pushed" — always fire the first time.
  // Otherwise, throttle within the window. (In production, real
  // timestamps from Date.now() are in the trillions, so `lastPushedAt
  // - 0` is always > the window; but the explicit guard keeps the
  // small-`now` test values working and the intent obvious.)
  if (lastPushedAt > 0 && now - lastPushedAt < PUSH_THROTTLE_MS) {
    return { ok: true, skipped: true };
  }

  const result = await pushSyncBlob(
    deviceId,
    { v: 1, engagement: getSyncBlobSection(store) },
    { fetchImpl: opts.fetchImpl },
  );
  if (result.ok) {
    try { store.setItem(PUSHED_AT_KEY, String(now)); } catch { /* best-effort */ }
  }
  return result;
}

