/**
 * Population-rank zoom captions for the daily superlative puzzles.
 *
 * Pure logic — no DOM, no fetch. Given the sovereign country list and the
 * population values map, it ranks every sovereign country by population
 * (descending, #1 = most populous) and builds a per-code caption of the shape
 * "Population: 129.7 million · #10 in the world" for the flag-zoom dialog.
 *
 * Why this exists as its own module rather than baked `entry.notes`: the daily
 * result screen's "Most missed" rail (extraStats `topMistake`) shows the
 * community's most-common WRONG clicks — arbitrary sovereign flags that are NOT
 * in the puzzle's frozen answer set, so they have no baked note. The rank is a
 * single global fact shared by every population puzzle, so computing it once at
 * play time (covering the whole sovereign pool) captions the distractors too,
 * without copying ~193 notes into all 14 catalog entries. `daily/page.js`
 * fetches the metric and installs the result via `setZoomNotes`.
 */

/**
 * Human-readable population figure, per language. Matches the format the
 * frozen `entry.notes` captions use (billions / millions to 1-2 dp, grouped
 * integers below a million).
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
 * Rank sovereign countries by population, descending (#1 = most populous).
 * Ties break alphabetically by code so the ranking is stable across renders.
 * Codes without a numeric population value (e.g. territories / home nations
 * that carry no entry in the metric file) are dropped — the ranking is over
 * sovereign countries, matching the daily pool.
 *
 * @param {{ code: string }[]} countries
 * @param {Record<string, number>} values
 * @returns {Map<string, number>} code -> 1-based rank
 */
export function rankByPopulation(countries, values) {
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
  const rank = rankByPopulation(countries, values);
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

/**
 * Compact population for a corner pill on a small result tile — "1.4B" / "337M"
 * / "9.8K" in English, "mld" / "mln" / "tys" in Polish. Precision drops as the
 * number grows (a pill has no room for exact figures — the zoom caption carries
 * those). Sub-thousand values render whole.
 *
 * @param {number} v
 * @param {string} lang
 * @returns {string}
 */
export function formatPopulationShort(v, lang) {
  const pl = lang === 'pl';
  const dec = (/** @type {string} */ s) => (pl ? s.replace('.', ',') : s);
  if (v >= 1e9) return `${dec((v / 1e9).toFixed(1))}${pl ? ' mld' : 'B'}`;
  if (v >= 1e6) return `${dec(v >= 1e7 ? String(Math.round(v / 1e6)) : (v / 1e6).toFixed(1))}${pl ? ' mln' : 'M'}`;
  if (v >= 1e3) return `${dec(v >= 1e5 ? String(Math.round(v / 1e3)) : (v / 1e3).toFixed(1))}${pl ? ' tys' : 'K'}`;
  return String(v);
}

/**
 * Per-tile overlay data for a superlative's result grid: each answer's rank
 * within *this puzzle* (its 1-based place in the frozen, rank-ordered `answers`
 * array) plus its raw metric value. The daily result screen reads this to badge
 * each found/missed tile with its place and population. `pop` is null when the
 * metric has no value for that code (shouldn't happen for a valid roster, but
 * the tile then just shows the rank).
 *
 * @param {{ answers?: string[] }} entry
 * @param {Record<string, number>} values
 * @returns {Map<string, { rank: number, pop: number | null }>}
 */
export function buildSuperlativeTileMeta(entry, values) {
  /** @type {Map<string, { rank: number, pop: number | null }>} */
  const meta = new Map();
  const answers = Array.isArray(entry.answers) ? entry.answers : [];
  answers.forEach((code, i) => {
    meta.set(code, { rank: i + 1, pop: typeof values[code] === 'number' ? values[code] : null });
  });
  return meta;
}
