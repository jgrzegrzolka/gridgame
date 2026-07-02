/**
 * "Flag of the day" picker — chooses one flag per calendar day from the
 * pool of flags that have a story (see `flags/flagFacts.js`). Pure logic:
 * deterministic in `(dateStr, pool)`, no DOM, no clock, no fetch, so the
 * home page can compute today's flag on load and this stays unit-testable.
 *
 * Selection is **cycle-shuffle**: the pool is shuffled once per "cycle"
 * (a run of `pool.length` days) and each day of the cycle reveals the next
 * entry of that shuffle. Consequences:
 *   - every flag is shown exactly once before any repeat (perfect coverage),
 *   - each cycle uses a fresh permutation, so the order feels random rather
 *     than alphabetical,
 *   - it's stateless — nothing is persisted. When the pool grows (a new
 *     story is added), the current cycle simply recomputes with the larger
 *     pool on the next load. The only visible effect is that the schedule
 *     from that day forward reshuffles; there's no saved rota to migrate.
 *
 * The pool is sorted internally before shuffling, so the result depends only
 * on the *set* of codes, not the order they arrive in (e.g. `Object.keys`
 * insertion order can't change today's pick).
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
 * Hash a cycle index into a well-spread 32-bit seed, so consecutive cycles
 * produce visibly different shuffles (raw consecutive seeds would correlate).
 *
 * @param {number} n
 * @returns {number}
 */
function seedForCycle(n) {
  let h = (n ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  return (h ^ (h >>> 16)) >>> 0;
}

/**
 * mulberry32 PRNG — small, deterministic, good enough for shuffling a
 * handful of flags. Returns a function yielding floats in [0, 1).
 *
 * @param {number} a seed
 * @returns {() => number}
 */
function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Fisher-Yates shuffle of a copy of `items`, driven by a seeded PRNG so the
 * permutation is reproducible for a given seed.
 *
 * @template T
 * @param {T[]} items
 * @param {number} seed
 * @returns {T[]}
 */
function shuffledCopy(items, seed) {
  const arr = items.slice();
  const rng = mulberry32(seed);
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

/**
 * The flag code to feature on a given day, or null when the pool is empty.
 *
 * `overrides` is an optional editorial pin — a `{ 'YYYY-MM-DD': code }` map
 * that forces a specific flag on a specific date (e.g. debut day, or a flag
 * on its national day). A pin is only honoured when its code is actually in
 * the pool (has a story); otherwise the normal rotation applies.
 *
 * @param {string} dateStr `YYYY-MM-DD` (typically `warsawToday()`)
 * @param {string[]} pool country codes that have a story
 * @param {Record<string, string>} [overrides] date → forced code
 * @returns {string | null}
 */
export function flagOfDay(dateStr, pool, overrides = {}) {
  if (!Array.isArray(pool) || pool.length === 0) return null;
  if (overrides && Object.prototype.hasOwnProperty.call(overrides, dateStr)) {
    const forced = overrides[dateStr];
    if (pool.includes(forced)) return forced;
  }
  const sorted = pool.slice().sort();
  const n = sorted.length;
  const day = dayNumber(dateStr);
  const cycle = Math.floor(day / n);
  // JS `%` can be negative for pre-epoch dates; normalise into [0, n).
  const pos = ((day % n) + n) % n;
  return shuffledCopy(sorted, seedForCycle(cycle))[pos];
}
