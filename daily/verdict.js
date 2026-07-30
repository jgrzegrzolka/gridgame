/**
 * Compare a daily score against the community average and decide the
 * "verdict" line on the result board (the score-row redesign). Pure and
 * language-agnostic: it returns a descriptor, and the render layer maps
 * `kind` to an i18n string and formats `k` with the active language's
 * decimal separator via `formatMultiplier`.
 *
 * The board never scolds — a below-average result renders no verdict at
 * all; the muted "średnia graczy X" line carries the fact for anyone who
 * wants it. So the function returns `null` for both "below average" and
 * "no usable stats", and the caller renders nothing in either case.
 *
 * Rules, with r = found / mean:
 *  - r ≥ 1.5        → { kind: 'multiplier', k }  where k = r snapped to the
 *                     nearest 0.5 (so 2.12 → 2, 2.3 → 2.5). Green.
 *  - 1.1 ≤ r < 1.5  → { kind: 'above' }   green, no multiplier ("1,2×" would
 *                     read as bragging about rounding error).
 *  - 0.9 ≤ r < 1.1  → { kind: 'level' }   muted, no arrow.
 *  - r < 0.9        → null                (say nothing).
 *  - mean ≤ 0 or non-finite → null        (no stats yet / fetch failed).
 *
 * @param {number} found  the player's score (flags found)
 * @param {number} mean   community average score for this puzzle
 * @returns {{ kind: 'multiplier', k: number } | { kind: 'above' } | { kind: 'level' } | null}
 */
export function computeVerdict(found, mean) {
  if (!Number.isFinite(mean) || mean <= 0) return null;
  if (!Number.isFinite(found)) return null;
  const r = found / mean;
  if (r >= 1.5) return { kind: 'multiplier', k: Math.round(r * 2) / 2 };
  if (r >= 1.1) return { kind: 'above' };
  if (r >= 0.9) return { kind: 'level' };
  return null;
}

/**
 * Format the multiplier `k` (already snapped to a half by `computeVerdict`)
 * for display. Trailing `,0` / `.0` is dropped so a whole multiple reads
 * "2×" not "2,0×"; a half reads "2,5×" (Polish comma) or "2.5×" (English
 * dot). Kept here, pure and tested, so the number formatting can't drift
 * from the verdict logic it belongs to.
 *
 * @param {number} k     multiplier, an integer or integer+0.5
 * @param {string} lang  'pl' | 'en' (any non-'pl' uses the dot separator)
 * @returns {string}     e.g. "2", "2,5", "2.5"
 */
export function formatMultiplier(k, lang) {
  const s = Number.isInteger(k) ? String(k) : k.toFixed(1);
  return lang === 'pl' ? s.replace('.', ',') : s;
}

/**
 * Format the community average for the "średnia graczy X" line. The server
 * already rounds `mean` to one decimal; this only swaps the decimal separator
 * for Polish (6.6 → "6,6") and leaves whole means bare ("7" not "7,0"), since
 * the server drops a trailing .0 itself.
 *
 * @param {number} mean
 * @param {string} lang  'pl' | 'en'
 * @returns {string}
 */
export function formatAvg(mean, lang) {
  const s = String(mean);
  return lang === 'pl' ? s.replace('.', ',') : s;
}
