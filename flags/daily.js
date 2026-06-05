/**
 * Daily-puzzle support: maps "now" to a puzzle number, and looks up
 * entries in the static catalog. Pure logic; no DOM, no fetch.
 *
 * The catalog stores *resolved* answers (a list of country codes), not
 * just the filter that produced them, so that fixes to country data
 * later don't retroactively change historical puzzles. The filter is
 * kept alongside for display + the daily.test.js drift check, which
 * fires loud the day the two disagree.
 *
 * @typedef {Object} DailyPuzzle
 * @property {number} n
 * @property {string} filter   serialized filter, same form as the
 *                             findFlag chooser's `?f=` URL parameter
 * @property {string[]} answers  country codes the puzzle resolves to
 */

/**
 * UTC midnight on the day puzzle #1 runs. Tomorrow (2026-06-06) was
 * picked from the conversation we started this in — the exact day a
 * second person (other than the author) could first play.
 *
 * Burned into the bundle on purpose: the day-N math has to be
 * deterministic across devices and timezones. Changing this value
 * after launch renumbers every puzzle in history, so don't.
 */
export const LAUNCH_UTC = Date.UTC(2026, 5, 6);

const DAY_MS = 86_400_000;

/**
 * Puzzle number for a given moment. Returns 1 at launch midnight,
 * 2 a day later, …; 0 on the day before launch, -1 two days before, …
 *
 * Caller decides what to do with non-positive values — typically the
 * page shows a "starts on …" message rather than trying to render a
 * puzzle that doesn't exist yet.
 *
 * @param {number} nowMs - epoch milliseconds (e.g. Date.now())
 * @param {number} [launchMs] - launch instant in epoch ms
 * @returns {number}
 */
export function dayNumberFor(nowMs, launchMs = LAUNCH_UTC) {
  return Math.floor((nowMs - launchMs) / DAY_MS) + 1;
}

/**
 * Look up puzzle #n in the catalog. Returns null when N is before #1
 * or past the catalog's last entry — callers show the appropriate
 * "starts on …" / "coming soon" copy.
 *
 * Throws on a miscounted catalog (entry.n != position + 1) rather than
 * silently misnumbering — a renumber bug here would corrupt history.
 *
 * @param {DailyPuzzle[]} catalog
 * @param {number} n
 * @returns {DailyPuzzle | null}
 */
export function getPuzzle(catalog, n) {
  if (n < 1 || n > catalog.length) return null;
  const entry = catalog[n - 1];
  if (entry.n !== n) {
    throw new Error(`Daily catalog mismatch: entry at index ${n - 1} has n=${entry.n}, expected ${n}`);
  }
  return entry;
}

/**
 * Parse `?n=…` out of a URL search string, falling back to today's
 * puzzle number. Garbage and missing values both fall back — the
 * deep-link form is purely additive.
 *
 * @param {string} search
 * @param {number} fallbackN
 * @returns {number}
 */
export function dailyNFromUrl(search, fallbackN) {
  const params = new URLSearchParams(search);
  const raw = params.get('n');
  if (raw === null) return fallbackN;
  const parsed = parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return fallbackN;
  return parsed;
}

/**
 * Format launchMs as YYYY-MM-DD in UTC. Used to render the
 * pre-launch "Daily #1 starts on …" message — the date the user
 * sees should be the same one that defines puzzle #1, regardless
 * of their local timezone.
 *
 * @param {number} [launchMs]
 * @returns {string}
 */
export function launchDateIso(launchMs = LAUNCH_UTC) {
  const d = new Date(launchMs);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
