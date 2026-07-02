/**
 * "Flag of the day" picker — chooses one flag per calendar day from the pool
 * of flags that have a story (see `flags/flagFacts.js`). Pure logic:
 * deterministic in `(dateStr, pool, overrides)`, no DOM, no clock, no fetch,
 * so the home page can compute today's flag on load and this stays
 * unit-testable.
 *
 * **Append-safe by construction.** Each story carries an `addedOn` date, and
 * a flag only becomes eligible the day *after* its `addedOn`. So adding a
 * story today can never change today's pick or any past day's — it simply
 * isn't a candidate on any day up to and including today; only future days
 * weave the newcomer in. That means you can grow the pool whenever you like
 * with zero editorial pinning. (The old design keyed the whole rotation off
 * the pool *size*, so adding one flag reshuffled every date, forcing a pin
 * per day to keep anything stable — the bug this rewrite fixes.)
 *
 * **Selection is least-recently-shown.** Replaying forward from the earliest
 * `addedOn`, each day picks the eligible flag shown fewest times so far, ties
 * broken by a per-day hash so the order doesn't read alphabetically. Coverage
 * stays balanced — every flag comes around regularly, nothing is starved —
 * *without* depending on `n`, which is the whole point.
 *
 * A newly-eligible flag joins "at the back of the pack": its show count is
 * seeded to the current minimum among active flags, so it neither bursts
 * (dominating the next N days from a zero count) nor lingers unshown.
 *
 * `overrides` (a `{ 'YYYY-MM-DD': code }` map) still forces a specific flag on
 * a specific date — kept for genuine editorial choices (a debut lead, a flag
 * on its national day), NOT as the stability mechanism it used to be.
 */

/**
 * Days elapsed from the Unix epoch to a `YYYY-MM-DD` calendar date, using
 * `Date.UTC` so it's timezone-independent (the caller already resolved the
 * Warsaw date string via `warsawToday()`; here we just need a stable integer
 * day index to drive the rotation).
 *
 * @param {string} dateStr `YYYY-MM-DD`
 * @returns {number}
 */
function dayNumber(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86400000);
}

/**
 * Deterministic 32-bit hash of a day index + country code — the tiebreak when
 * several eligible flags are level on show count. Mixing the day in means the
 * tie order varies day to day rather than being a fixed alphabetical fallback.
 *
 * @param {number} day
 * @param {string} code
 * @returns {number}
 */
function tiebreak(day, code) {
  let h = (day ^ 0x9e3779b9) >>> 0;
  for (let i = 0; i < code.length; i++) {
    h = Math.imul(h ^ code.charCodeAt(i), 0x45d9f3b) >>> 0;
  }
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  return (h ^ (h >>> 16)) >>> 0;
}

/**
 * The flag code to feature on a given day, or null when nothing is eligible
 * yet (date precedes every story's `addedOn`) or the pool is empty.
 *
 * @param {string} dateStr `YYYY-MM-DD` (typically `warsawToday()`)
 * @param {Array<{ code: string, addedOn: string }>} pool  stories with their add dates
 * @param {Record<string, string>} [overrides] date → forced code
 * @returns {string | null}
 */
export function flagOfDay(dateStr, pool, overrides = {}) {
  if (!Array.isArray(pool) || pool.length === 0) return null;

  // Sort by code so the replay is independent of the pool's arrival order
  // (e.g. `Object.keys` insertion order can't change any pick).
  const entries = pool
    .filter((e) => e && typeof e.code === 'string' && typeof e.addedOn === 'string')
    .slice()
    .sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
  if (entries.length === 0) return null;

  if (overrides && Object.prototype.hasOwnProperty.call(overrides, dateStr)) {
    const forced = overrides[dateStr];
    if (entries.some((e) => e.code === forced)) return forced;
  }

  const targetDay = dayNumber(dateStr);
  const addedDay = new Map(entries.map((e) => [e.code, dayNumber(e.addedOn)]));
  let startDay = Infinity;
  for (const d of addedDay.values()) if (d < startDay) startDay = d;
  // First day anything can be picked is the day after the earliest addedOn
  // (eligibility is strictly "added before today"). Nothing before that.
  if (targetDay <= startDay) return null;

  /** @type {Map<string, number>} */
  const shows = new Map();
  let pick = null;
  for (let day = startDay + 1; day <= targetDay; day++) {
    // Activate flags added strictly before `day`, seeding each to the current
    // minimum show count so it blends in rather than bursting or starving.
    for (const e of entries) {
      if (shows.has(e.code)) continue;
      if ((addedDay.get(e.code) ?? Infinity) < day) {
        let min = 0;
        if (shows.size > 0) {
          min = Infinity;
          for (const v of shows.values()) if (v < min) min = v;
        }
        shows.set(e.code, min);
      }
    }
    if (shows.size === 0) { pick = null; continue; }

    // Least-recently-shown wins; per-day hash breaks ties.
    let best = null;
    let bestShows = Infinity;
    let bestHash = Infinity;
    for (const e of entries) {
      const s = shows.get(e.code);
      if (s === undefined) continue; // not eligible yet
      const h = tiebreak(day, e.code);
      if (s < bestShows || (s === bestShows && h < bestHash)) {
        best = e.code;
        bestShows = s;
        bestHash = h;
      }
    }
    if (best !== null) shows.set(best, (shows.get(best) ?? 0) + 1);
    pick = best;
  }
  return pick;
}
