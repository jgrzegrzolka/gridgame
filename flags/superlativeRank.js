/**
 * Rank enrichment for the daily superlative puzzles — the per-tile "#1 #2 #3"
 * badge and value pill on the result grids, plus the world-rank zoom captions.
 *
 * Pure logic — no DOM, no fetch. Given the sovereign country list and a metric's
 * values map, it ranks every sovereign country by that metric (descending, #1 =
 * largest value) and builds the per-code captions and per-tile overlay data the
 * daily result screen paints.
 *
 * **Metric-generic on purpose.** This module used to be `populationRank.js` and
 * every caller gated on `metric === 'population'`. Puzzle #51 (2026-07-26, the
 * first non-population superlative to go live — "the 10 largest countries by
 * area") therefore shipped with no rank numbers at all, because the gate simply
 * skipped it. A superlative IS a ranking; the numbering is the mechanic, not a
 * population perk. So the metric key never appears in a condition here — the
 * formatting comes from the metric file's own `format` / `unit` fields, and
 * `metricFileFor` resolves any entry against the shared `METRIC_FILES` registry.
 * If you find yourself writing `metric === '...'` in this file or in a caller,
 * that's the bug coming back.
 *
 * Why the zoom captions cover the whole sovereign pool rather than reusing the
 * frozen `entry.notes`: the result screen's "Most missed" rail (extraStats
 * `topMistake`) shows the community's most-common WRONG clicks — arbitrary
 * sovereign flags that are NOT in the puzzle's answer set, so they have no baked
 * note. The rank is a single global fact shared by every puzzle on that metric,
 * so computing it once at play time captions the distractors too, without
 * copying ~193 notes into every catalog entry. `daily/page.js` fetches the
 * metric and installs the result via `setZoomNotes`.
 */

import { formatValue } from './metricLens.js';
import { METRIC_FILES } from './metrics/index.js';

/**
 * Resolve the metric data file a superlative entry needs, or null when the entry
 * isn't a superlative / names a metric that isn't in the registry.
 *
 * This is the (previously hardcoded) gate, extracted so it can be tested — the
 * catalog suite asserts every superlative entry resolves, which is what stops a
 * future metric from silently losing its rank badges the way `area` did.
 *
 * @param {{ kind?: string, metric?: string } | null | undefined} entry
 * @returns {string | null} the file name inside `flags/metrics/`, or null
 */
export function metricFileFor(entry) {
  if (!entry || entry.kind !== 'superlative') return null;
  const found = METRIC_FILES.find((m) => m.key === entry.metric);
  return found ? found.file : null;
}

/**
 * Human-readable population figure, per language. Matches the format the
 * frozen `entry.notes` captions use (billions / millions to 1-2 dp, grouped
 * integers below a million).
 *
 * Population keeps its own long-form words ("129.7 million" / "129,7 mln")
 * because that phrasing is baked into every shipped population entry's notes
 * and reads better than a bare compact figure inside a full sentence. This is a
 * *caption wording* choice, not a feature gate — the ranking, the badges and
 * the pills below are identical for every metric.
 *
 * @param {number} v
 * @param {string} lang
 * @returns {string}
 */
export function formatPopulation(v, lang) {
  const pl = lang === 'pl';
  const dec = (/** @type {string} */ s) => (pl ? s.replace('.', ',') : s);
  if (v >= 1e9) return pl ? `${dec((v / 1e9).toFixed(2))} mld` : `${(v / 1e9).toFixed(2)} billion`;
  if (v >= 1e6) return pl ? `${dec((v / 1e6).toFixed(1))} mln` : `${(v / 1e6).toFixed(1)} million`;
  return String(v).replace(/\B(?=(\d{3})+(?!\d))/g, pl ? ' ' : ',');
}

/**
 * Rank sovereign countries by a metric, descending (#1 = largest value).
 * Ties break alphabetically by code so the ranking is stable across renders.
 * Codes without a numeric value (e.g. territories / home nations that carry no
 * entry in the metric file, or a sparse metric's gaps) are dropped — the
 * ranking is over sovereign countries, matching the daily pool.
 *
 * Always descending, including on a `direction: "least"` puzzle: the caption
 * says "#N in the world", which is a fact about the country, not about the
 * puzzle. Vatican City is the 195th most populous country whether the puzzle
 * asked for the most populous or the least.
 *
 * @param {{ code: string }[]} countries
 * @param {Record<string, number>} values
 * @returns {Map<string, number>} code -> 1-based rank
 */
export function rankByMetric(countries, values) {
  const ranked = countries
    .map((c) => c.code)
    .filter((code) => typeof values[code] === 'number')
    .sort((a, b) => values[b] - values[a] || (a < b ? -1 : 1));
  const rank = new Map();
  ranked.forEach((code, i) => rank.set(code, i + 1));
  return rank;
}

/**
 * Build zoom captions (`{ en, pl }` per code) for every sovereign country with
 * a population value: its figure plus its world rank among sovereign states.
 *
 * @param {{ code: string }[]} countries
 * @param {Record<string, number>} values
 * @returns {Record<string, { en: string, pl: string }>}
 */
export function buildPopulationRankNotes(countries, values) {
  const rank = rankByMetric(countries, values);
  /** @type {Record<string, { en: string, pl: string }>} */
  const notes = {};
  for (const c of countries) {
    const v = values[c.code];
    if (typeof v !== 'number') continue;
    const r = rank.get(c.code);
    notes[c.code] = {
      en: `Population: ${formatPopulation(v, 'en')} · #${r} in the world`,
      pl: `Ludność: ${formatPopulation(v, 'pl')} · ${r}. na świecie`,
    };
  }
  return notes;
}

/** Polish magnitude suffixes for the compact pill. */
const PL_SUFFIX = { K: ' tys', M: ' mln', B: ' mld', T: ' bln' };

/**
 * Compact metric figure for a corner pill on a small result tile — "1.44B" /
 * "336.8M" / "16.4M" / "68.5", in the metric's own `format` (the same one the
 * flagsdata lens uses, so a country reads identically on both surfaces). A pill
 * has no room for exact figures or units; the zoom caption carries those.
 *
 * Polish swaps the decimal point for a comma and the magnitude letter for the
 * Polish short word ("1,44 mld"), and spaces the thousands groups of a `plain`
 * figure the way Polish writes them.
 *
 * @param {number} v
 * @param {string} [format]  the metric file's `format` field
 * @param {string} [lang]
 * @returns {string}
 */
export function formatMetricShort(v, format, lang = 'en') {
  const s = formatValue(v, format);
  if (lang !== 'pl') return s;
  const m = /^(-?[\d.]+)([KMBT])$/.exec(s);
  if (m) return `${m[1].replace('.', ',')}${PL_SUFFIX[/** @type {'K'|'M'|'B'|'T'} */ (m[2])]}`;
  // `plain` renders "8,849" — Polish groups with spaces and has no decimal here.
  if (s.includes(',')) return s.replace(/,/g, ' ');
  return s.replace('.', ',');
}

/**
 * Build zoom captions for any non-population metric: the puzzle's own baked note
 * where there is one ("Area: 16,376,870 km²", hand-written per answer), a
 * formatted figure where there isn't (the "Most missed" distractors), and the
 * world rank appended to both.
 *
 * Reusing the baked note as the prefix keeps the answers' captions exactly as
 * authored — this only adds the one fact the catalog can't bake, the rank.
 *
 * @param {{ code: string }[]} countries
 * @param {Record<string, number>} values
 * @param {{ unit?: string, format?: string }} [meta]  the metric file's header
 * @param {Record<string, Record<string, string>>} [baked]  entry.notes
 * @returns {Record<string, { en: string, pl: string }>}
 */
export function buildMetricRankNotes(countries, values, meta = {}, baked = undefined) {
  const rank = rankByMetric(countries, values);
  const unit = meta.unit ? ` ${meta.unit}` : '';
  /** @type {Record<string, { en: string, pl: string }>} */
  const notes = {};
  for (const c of countries) {
    const v = values[c.code];
    if (typeof v !== 'number') continue;
    const r = rank.get(c.code);
    const base = baked && baked[c.code];
    const en = base?.en ?? `${formatMetricShort(v, meta.format, 'en')}${unit}`;
    const pl = base?.pl ?? `${formatMetricShort(v, meta.format, 'pl')}${unit}`;
    notes[c.code] = {
      en: `${en} · #${r} in the world`,
      pl: `${pl} · ${r}. na świecie`,
    };
  }
  return notes;
}

/**
 * Per-tile overlay data for a superlative's result grid: each answer's rank
 * within *this puzzle* (its 1-based place in the frozen, rank-ordered `answers`
 * array) plus its metric value, pre-formatted per language so the DOM glue does
 * no formatting of its own. The daily result screen reads this to badge each
 * found/missed tile with its place and figure.
 *
 * `value` / `display` are null when the metric has no value for that code
 * (shouldn't happen for a valid roster, but the tile then still shows its rank —
 * the number is the point and must never depend on the figure resolving).
 *
 * @param {{ answers?: string[] }} entry
 * @param {Record<string, number>} values
 * @param {{ format?: string }} [meta]  the metric file's header
 * @returns {Map<string, { rank: number, value: number | null, display: { en: string, pl: string } | null }>}
 */
export function buildSuperlativeTileMeta(entry, values, meta = {}) {
  /** @type {Map<string, { rank: number, value: number | null, display: { en: string, pl: string } | null }>} */
  const map = new Map();
  const answers = Array.isArray(entry.answers) ? entry.answers : [];
  answers.forEach((code, i) => {
    const v = values[code];
    const has = typeof v === 'number';
    map.set(code, {
      rank: i + 1,
      value: has ? v : null,
      display: has
        ? { en: formatMetricShort(v, meta.format, 'en'), pl: formatMetricShort(v, meta.format, 'pl') }
        : null,
    });
  });
  return map;
}
