/**
 * In-progress state for an unfinished daily run, so a reload resumes
 * the board instead of restarting it.
 *
 * This exists because of the wrong-guess budget (`daily/lives.js`).
 * Before the cap, reloading mid-game cost you your found flags — a
 * penalty, so nobody did it on purpose. With a cap, reloading *refunds
 * seven hearts*, which quietly makes the whole mechanic optional. The
 * fix is to make the run survive a reload.
 *
 * **Local only.** Progress never leaves the device: it is written on
 * every guess and deleted the moment the run finishes, at which point
 * `daily/scores.js` (local) and the Cosmos POST (server) take over as
 * the durable record. Sending partial runs to the server would mean
 * writing a row nobody asked for and reconciling it later.
 *
 * Deliberately its own key rather than a partial record inside
 * `daily.scores`: that module is documented as *finished*
 * first-attempt records, and boot decides play-vs-revisit on
 * `isCompleteRecord`. A half-record living there would risk the
 * archive rendering an unfinished run as a final score.
 *
 * Keyed by puzzle number rather than a single slot so that opening an
 * archive puzzle can't clobber an unfinished run of today's.
 *
 * **What this does and doesn't buy.** It closes accidental resets and
 * casual reloads. It does not stop a determined reset: incognito, a
 * different browser, or clearing storage all give a fresh board, and
 * clearing storage also resets `gridgame.deviceId`, so the Cosmos
 * one-row-per-(puzzle, deviceId) gate won't catch it either. Genuinely
 * closing that needs server-side round state, which is a far bigger
 * build than this mechanic warrants.
 */

export const STORAGE_KEY = 'daily.progress';

/**
 * @typedef {object} DailyProgress
 * @property {string[]} c Country codes found so far.
 * @property {string[]} w Wrong-guess codes. Restores the spent hearts exactly, because `lives.js` charges per code rather than counting events.
 * @property {number} s Epoch ms the run started, or 0 when unknown.
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

/**
 * @param {unknown} n
 * @returns {boolean}
 */
function validN(n) {
  return Number.isInteger(n) && /** @type {number} */ (n) >= 1;
}

/**
 * @param {unknown} list
 * @returns {string[]}
 */
function codeList(list) {
  if (!Array.isArray(list)) return [];
  return list.filter((x) => typeof x === 'string');
}

/**
 * Read the unfinished run for puzzle `n`, or null when there isn't one.
 *
 * Returns `s: 0` rather than inventing a timestamp for a record that
 * lacks a usable one — a fabricated "now" would silently restart the
 * clock on every load, which is one of the things resume exists to
 * prevent. The caller decides what to do with 0.
 *
 * @param {{ getItem(key: string): string | null }} store
 * @param {number} n
 * @returns {DailyProgress | null}
 */
export function loadProgress(store, n) {
  if (!validN(n)) return null;
  const entry = loadAll(store)[String(n)];
  if (!entry || typeof entry !== 'object') return null;
  // No found list means the board can't be rebuilt, so this isn't progress.
  if (!Array.isArray(entry.c)) return null;
  const s = typeof entry.s === 'number' && Number.isFinite(entry.s) ? entry.s : 0;
  return { c: codeList(entry.c), w: codeList(entry.w), s };
}

/**
 * Write the current state of an unfinished run. Called on every guess,
 * so the last write wins — the opposite of `saveScore`'s deliberate
 * first-attempt-only rule.
 *
 * Storage failures are swallowed: Safari's private mode throws on
 * `setItem` with a zero quota, and losing the ability to resume is a
 * far better outcome than taking down the running game.
 *
 * @param {{ getItem(key: string): string | null, setItem(key: string, value: string): void }} store
 * @param {number} n
 * @param {{ found: string[], wrong: string[], startedAt: number }} state
 */
export function saveProgress(store, n, { found, wrong, startedAt }) {
  if (!validN(n)) return;
  try {
    const all = loadAll(store);
    all[String(n)] = { c: codeList(found), w: codeList(wrong), s: startedAt };
    store.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    /* storage unavailable — resume is a nicety, the game is not */
  }
}

/**
 * Drop the unfinished run for `n`. Called when the run finishes, at
 * which point `daily.scores` holds the durable record.
 *
 * @param {{ getItem(key: string): string | null, setItem(key: string, value: string): void, removeItem?: (key: string) => void }} store
 * @param {number} n
 */
export function clearProgress(store, n) {
  if (!validN(n)) return;
  try {
    const all = loadAll(store);
    if (!(String(n) in all)) return;
    delete all[String(n)];
    store.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    /* see saveProgress */
  }
}
