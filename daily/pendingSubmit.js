/**
 * A finished daily attempt whose POST to `/api/v1/daily/result` did not
 * land, parked on the device so a later page load can send it again.
 *
 * Why this exists: before it, a failed submit lost the score outright.
 * `statsSubmit.js` retries transient failures (5xx / network) a couple of
 * times and then gives up; a 4xx isn't retried at all. Either way the page
 * discarded the outcome, and — this is the part that made it permanent —
 * the revisit branch in `page.js` jumps straight to the result screen
 * whenever a complete local record exists, so it never re-POSTs. The only
 * escape was for the player to notice and hit "Play again".
 *
 * That went from theory to incident on 2026-08-26: a real 13/13 submission
 * was rejected 400, silently. The device then showed 13/13 from its own
 * `daily.scores` while the server had nothing, so a throwaway 4/13 replay
 * on another device became both the player's record and that day's whole
 * community average.
 *
 * Why a separate key rather than extending `daily.scores`: the score
 * record is the player-facing archive and deliberately holds no submit
 * state (see submitted.js for the same argument). It also doesn't store
 * `durationMs`, which the server requires — so re-sending honestly needs
 * the original payload kept whole, not reconstructed from the score.
 *
 * Relationship to `submitted.js`: that module records puzzles this browser
 * HAS submitted; this one records attempts it still owes. They never
 * disagree, because `statsSubmit` marks one and clears the other on the
 * same 204 / 409.
 *
 * Bounded on purpose. A payload the server rejects deterministically
 * (a validation bug, a puzzle pulled from the catalog) would otherwise
 * re-POST on every page load forever, so each entry carries an attempt
 * count and stops being offered after MAX_ATTEMPTS.
 */

export const STORAGE_KEY = 'gridgame.pendingSubmits';

/**
 * How many times we'll try to deliver one parked attempt before dropping
 * it. Five spreads across five separate page loads, which is generous for
 * a transient fault and short enough that a genuinely invalid payload
 * stops costing a request per visit.
 */
export const MAX_ATTEMPTS = 5;

/**
 * @typedef {object} PendingSubmit
 * @property {number} n Puzzle number.
 * @property {string[]} foundCodes
 * @property {string[]} wrongCodes
 * @property {number} totalCount
 * @property {number} durationMs
 * @property {string} deviceId
 */

/**
 * @param {{ getItem(key: string): string | null }} store
 * @returns {Record<string, any>}
 */
function loadAll(store) {
  try {
    const raw = store.getItem(STORAGE_KEY);
    if (raw === null) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return /** @type {Record<string, any>} */ (parsed);
  } catch {
    return {};
  }
}

/** @param {unknown} list */
function codeList(list) {
  if (!Array.isArray(list)) return [];
  return list.filter((x) => typeof x === 'string');
}

/** @param {unknown} n */
function validN(n) {
  return Number.isInteger(n) && /** @type {number} */ (n) >= 1;
}

/**
 * Rebuild one stored entry, or null when it can't be sent as-is. Guards
 * the same fields the server's `validateResult` requires, so a malformed
 * or half-written record is dropped here rather than earning a
 * guaranteed 400 on every future page load.
 *
 * @param {string} key
 * @param {any} entry
 * @returns {PendingSubmit | null}
 */
function reviveEntry(key, entry) {
  if (!entry || typeof entry !== 'object') return null;
  const n = Number(key);
  if (!validN(n)) return null;
  if (!Number.isInteger(entry.totalCount) || entry.totalCount < 1) return null;
  if (!Number.isInteger(entry.durationMs) || entry.durationMs < 0) return null;
  if (typeof entry.deviceId !== 'string' || entry.deviceId.length === 0) return null;
  if (!Array.isArray(entry.c)) return null;
  return {
    n,
    foundCodes: codeList(entry.c),
    wrongCodes: codeList(entry.w),
    totalCount: entry.totalCount,
    durationMs: entry.durationMs,
    deviceId: entry.deviceId,
  };
}

/**
 * Every parked attempt still worth sending, oldest puzzle first.
 * Entries past MAX_ATTEMPTS are omitted (they stay in storage until the
 * next write prunes them — cheap, and it keeps the read side pure).
 *
 * @param {{ getItem(key: string): string | null }} store
 * @returns {PendingSubmit[]}
 */
export function loadPending(store) {
  const all = loadAll(store);
  /** @type {PendingSubmit[]} */
  const out = [];
  for (const [key, entry] of Object.entries(all)) {
    if (entry && typeof entry === 'object' && Number(entry.a) >= MAX_ATTEMPTS) continue;
    const revived = reviveEntry(key, entry);
    if (revived) out.push(revived);
  }
  return out.sort((a, b) => a.n - b.n);
}

/**
 * How many attempts are still queued. Separate from `loadPending` so
 * callers that only need the count don't rebuild every payload.
 *
 * @param {{ getItem(key: string): string | null }} store
 */
export function countPending(store) {
  return loadPending(store).length;
}

/**
 * Is this puzzle's result still owed to the server? Used by the revisit
 * branch, so re-opening a result the server never accepted keeps saying
 * so instead of looking settled.
 *
 * @param {{ getItem(key: string): string | null }} store
 * @param {number} n
 */
export function isPending(store, n) {
  return loadPending(store).some((p) => p.n === n);
}

/**
 * Park an attempt, or record one more failed delivery of an already
 * parked one. Called on every failed submit — including the retry path,
 * which is why the attempt counter lives here rather than at the call
 * site: the count has to survive the page going away.
 *
 * @param {{ getItem(key: string): string | null, setItem(key: string, value: string): void }} store
 * @param {PendingSubmit} payload
 */
export function savePending(store, payload) {
  if (!payload || !validN(payload.n)) return;
  try {
    const all = loadAll(store);
    const key = String(payload.n);
    const prior = all[key] && typeof all[key] === 'object' ? Number(all[key].a) : 0;
    all[key] = {
      c: codeList(payload.foundCodes),
      w: codeList(payload.wrongCodes),
      totalCount: payload.totalCount,
      durationMs: payload.durationMs,
      deviceId: payload.deviceId,
      a: (Number.isFinite(prior) ? prior : 0) + 1,
    };
    store.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    // Private mode / zero quota. Losing the parked copy is no worse than
    // the behaviour this module replaced, and the running page must not
    // die over it.
  }
}

/**
 * Drop a parked attempt — the server has it now (204 or 409).
 *
 * @param {{ getItem(key: string): string | null, setItem(key: string, value: string): void }} store
 * @param {number} n
 */
export function clearPending(store, n) {
  if (!validN(n)) return;
  try {
    const all = loadAll(store);
    if (!(String(n) in all)) return;
    delete all[String(n)];
    store.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    /* see savePending */
  }
}
