/**
 * Bar geometry for Flag Party's world-facts reveal chart. Pure — no DOM.
 *
 * Split out of `flagParty/page.js` because it is real arithmetic with a
 * correctness property worth pinning, not rendering glue: it decides how long
 * each country's bar is, and getting it wrong is silent (a bar of the wrong
 * length still looks like a bar).
 */

import { pickSlots } from './pickAvatars.js';

/**
 * Bar length for each ranked option, as a fraction in [0, 1].
 *
 * Normalised across the quartet's own range rather than `value / max`. Some
 * metrics go negative — temperature bottoms out at -49C — and `value / max`
 * yields a negative width there, which renders as no bar at all rather than as
 * an obviously wrong one. Anchoring the floor at `min(0, smallest)` keeps the
 * natural "share of the biggest" reading for the all-positive metrics, which is
 * nearly all of them: when nothing is negative the floor is 0 and this reduces
 * exactly to `value / max`.
 *
 * A missing or non-numeric value counts as 0 rather than throwing. The reveal
 * carries values for every option it ranks, so a gap means a stale or partial
 * server payload, and a short bar beats a broken chart.
 *
 * @param {string[]} ranking  option codes, best-first in the question's direction
 * @param {Record<string, number> | null | undefined} values  raw metric value per code
 * @returns {number[]} one fraction per entry of `ranking`, in the same order
 */
export function barFractions(ranking, values) {
  const codes = Array.isArray(ranking) ? ranking : [];
  if (codes.length === 0) return [];
  const src = values || {};
  const nums = codes.map((c) => {
    const v = src[c];
    return typeof v === 'number' && Number.isFinite(v) ? v : 0;
  });
  const hi = Math.max(...nums);
  const lo = Math.min(0, ...nums);
  // Every value identical (including all-zero) leaves no range to normalise
  // against; a full bar each is the honest reading of "these are the same".
  const span = hi - lo || 1;
  return nums.map((n) => {
    const frac = (n - lo) / span;
    return Math.max(0, Math.min(1, frac));
  });
}

/**
 * Avatar-rail width in px for a whole chart, from its busiest row.
 *
 * Every column in a `.rank-row` is a fixed track so the four rows share one
 * vertical grid and the values line up. The rail is the only track whose content
 * genuinely varies -- one avatar per player who picked that row -- and letting it
 * size itself was the bug this replaces: each row is its own CSS grid, so a
 * single avatar on the row you picked sized THAT row's columns differently and
 * shoved its value and points inward, leaving the numbers ragged down the chart.
 * Measuring the busiest row once and pinning every row to it fixes the alignment
 * while still fitting whatever the room size.
 *
 * The constants mirror `.rank-rail` in `flagParty/index.css`: each avatar is
 * {@link RAIL_AVATAR_PX} wide, every one after the first overlaps the last by
 * {@link RAIL_AVATAR_OVERLAP_PX}, and the overflow marker is a fixed
 * {@link RAIL_MORE_PX}. They are exported so the stylesheet and this arithmetic
 * are pinned together by a test rather than silently drifting the next time
 * someone resizes an avatar.
 *
 * **The cap is what keeps this column honest.** Before it, a room where twelve
 * people all picked Brazil sized the rail at 198px, and since every row is pinned
 * to the busiest one, the country name on all four rows lost its space — including
 * the three rows nobody picked. Capped, the widest a rail can ever be is five
 * faces and a marker, so the names hold still from round to round.
 *
 * @param {string[]} ranking  option codes, one per row
 * @param {Record<string, string>} picks  playerId -> the code they picked
 * @returns {number} width in px, never less than one avatar
 */
export function railWidthPx(ranking, picks) {
  const codes = Array.isArray(ranking) ? ranking : [];
  const chosen = Object.values(picks || {});
  let busiest = 1;
  for (const code of codes) {
    const n = chosen.filter((choice) => choice === code).length;
    if (n > busiest) busiest = n;
  }
  // Measured through the same split the row is drawn with (`flags/pickAvatars.js`),
  // so the rail can never be sized for a row that renders differently.
  const { faces, marker } = pickSlots(busiest);
  const step = RAIL_AVATAR_PX - RAIL_AVATAR_OVERLAP_PX;
  const width = RAIL_AVATAR_PX + Math.max(0, faces - 1) * step;
  return marker ? width + RAIL_MORE_PX - RAIL_AVATAR_OVERLAP_PX : width;
}

/** Width of one avatar in the reveal chart's rail. Mirrors `.rank-rail .avatar`. */
export const RAIL_AVATAR_PX = 22;
/** How far each avatar after the first slides over the last. Mirrors
 *  `.rank-rail .avatar + .avatar { margin-left: -6px }`. */
export const RAIL_AVATAR_OVERLAP_PX = 6;
/**
 * Width of the `+N` overflow marker. Mirrors `.rank-rail .more`, and it is a
 * FIXED width rather than one that grows with the digits: this arithmetic runs
 * before the number is on screen, and a marker that measured itself would put the
 * rail — and so every country name in the chart — on a different x for `+9` than
 * for `+11`. Wide enough for the largest overflow a room can produce (`MAX_SEATS`
 * is 20, so `+15`).
 */
export const RAIL_MORE_PX = 30;

/**
 * The chart's scale line: what the numbers count, and as of when.
 *
 * Four bare numbers over four bars are close to unreadable without it -- "8" says
 * nothing until you know it counts medals -- and the bars are normalised to the
 * quartet's own range by {@link barFractions}, so bar LENGTH carries no absolute
 * meaning either. Without the unit neither half of the chart says anything.
 *
 * The unit is looked up per metric so it translates. There is deliberately **no
 * fallback to the metric file's own `unit`**: those are English, and several are
 * also less precise than the translated ones (the `gdpPerCapita` file says
 * "US$", the string says "US$/person"), so falling back would not merely fail to
 * translate -- it would label a per-capita chart with an absolute unit. A missing
 * translation shows the year alone, which is honest about knowing less.
 *
 * @param {{ key: string, year: number | null } | null | undefined} metric
 * @param {(key: string, fallback: string) => string} t  translator
 * @returns {string} the line, or '' when there is nothing worth saying
 */
export function chartUnitLine(metric, t) {
  if (!metric) return '';
  const unit = metric.key ? t('metricUnit.' + metric.key, '') : '';
  const year = metric.year ? String(metric.year) : '';
  return [unit, year].filter(Boolean).join(' · ');
}
