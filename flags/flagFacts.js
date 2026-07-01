/**
 * Flag-facts catalog: per-country "story of the flag" content shown on
 * `/flagsdata/` when a flag tile (or the map) is clicked. Structure only —
 * the prose lives in i18n (`flagFacts.<code>.*` keys in `i18n/en.json` /
 * `i18n/pl.json`) so it translates and re-renders on a soft language
 * switch, exactly like every other UI string.
 *
 * Each entry:
 *   - `introKey`  — i18n key for the intro paragraph(s). Paragraphs are
 *     separated by a blank line (`\n\n`) in the string; the renderer splits
 *     on that.
 *   - `timeline`  — ordered historical flags, oldest first. Each step:
 *       - `year`       — display label (numeric range, language-neutral, so
 *                        it stays in the data rather than i18n).
 *       - `img`        — path **relative to the `flags/` folder** (e.g.
 *                        `history/gr-ottoman.svg` for a superseded design,
 *                        `svg/gr.svg` for the current flag). The renderer
 *                        prefixes it with a caller-supplied base.
 *       - `captionKey` — i18n key for the one-line caption under the flag.
 *
 * Deliberately a plain data module (not fetched JSON): it's tiny, wants to
 * be unit-tested without a fetch stub, and the historical-image filenames
 * are pinned by a test that checks each referenced file exists on disk.
 *
 * Historical SVGs + their provenance/licence: `flags/history/SOURCES.md`.
 */

/**
 * @typedef {{
 *   year: string,
 *   img: string,
 *   captionKey: string,
 *   parts?: string[],
 *   partLabelKeys?: string[],
 * }} FlagFactStep
 * @typedef {{
 *   introKey: string,
 *   timeline: FlagFactStep[],
 *   factKeys?: string[],
 * }} FlagFacts
 *
 * A step is normally one flag (`img`) with a `year` + caption. When `parts`
 * is set, the step renders as an *equation* — `part₁ + part₂ = img` — so a
 * composite flag reads as ingredients combined at a moment, not as the flag
 * morphing over time (e.g. 1606 = England + Scotland; 1801 = 1606 + Ireland).
 * `parts` are image paths (same base as `img`); `partLabelKeys` are the
 * matching i18n labels shown under each part (optional, index-aligned).
 *
 * `factKeys` (optional) is a list of i18n keys rendered as a "Did you know?"
 * bullet list below the timeline — standalone trivia that doesn't belong in
 * the narrative intro or on a specific flag.
 */

/** @type {Record<string, FlagFacts>} */
export const FLAG_FACTS = {
  gb: {
    introKey: 'flagFacts.gb.intro',
    timeline: [
      {
        year: '1606',
        img: 'history/gb-union1606.svg',
        captionKey: 'flagFacts.gb.union1606',
        parts: ['svg/gb-eng.svg', 'svg/gb-sct.svg'],
        partLabelKeys: ['flagFacts.gb.george', 'flagFacts.gb.andrew'],
      },
      {
        year: '1801',
        img: 'svg/gb.svg',
        captionKey: 'flagFacts.gb.current',
        parts: ['history/gb-union1606.svg', 'history/ie-patrick.svg'],
        partLabelKeys: ['flagFacts.gb.union1606short', 'flagFacts.gb.patrick'],
      },
    ],
    factKeys: [
      'flagFacts.gb.fact.wales',
      'flagFacts.gb.fact.name',
      'flagFacts.gb.fact.asymmetry',
      'flagFacts.gb.fact.distress',
      'flagFacts.gb.fact.offspring',
    ],
  },
  'gb-eng': {
    introKey: 'flagFacts.gb-eng.intro',
    timeline: [
      { year: '1198', img: 'history/gb-eng-lions.svg', captionKey: 'flagFacts.gb-eng.lions' },
      { year: '13th c.', img: 'svg/gb-eng.svg', captionKey: 'flagFacts.gb-eng.current' },
    ],
    factKeys: [
      'flagFacts.gb-eng.fact.george',
      'flagFacts.gb-eng.fact.genoa',
      'flagFacts.gb-eng.fact.union',
      'flagFacts.gb-eng.fact.lions',
    ],
  },
  'gb-sct': {
    introKey: 'flagFacts.gb-sct.intro',
    timeline: [
      { year: 'royal banner', img: 'history/gb-sct-lion.svg', captionKey: 'flagFacts.gb-sct.lion' },
      { year: 'national flag', img: 'svg/gb-sct.svg', captionKey: 'flagFacts.gb-sct.current' },
    ],
    factKeys: [
      'flagFacts.gb-sct.fact.oldest',
      'flagFacts.gb-sct.fact.andrew',
      'flagFacts.gb-sct.fact.union',
      'flagFacts.gb-sct.fact.lion',
    ],
  },
  'gb-wls': {
    introKey: 'flagFacts.gb-wls.intro',
    timeline: [
      { year: 'St David', img: 'history/gb-wls-stdavid.svg', captionKey: 'flagFacts.gb-wls.david' },
      { year: '1959', img: 'svg/gb-wls.svg', captionKey: 'flagFacts.gb-wls.current' },
    ],
    factKeys: [
      'flagFacts.gb-wls.fact.union',
      'flagFacts.gb-wls.fact.dragon',
      'flagFacts.gb-wls.fact.official',
      'flagFacts.gb-wls.fact.dragons',
    ],
  },
  ie: {
    introKey: 'flagFacts.ie.intro',
    timeline: [
      { year: "St Patrick", img: 'history/ie-patrick.svg', captionKey: 'flagFacts.ie.patrick' },
      { year: '16th c.', img: 'history/ie-harp.svg', captionKey: 'flagFacts.ie.harp' },
      { year: '1848', img: 'svg/ie.svg', captionKey: 'flagFacts.ie.current' },
    ],
    factKeys: [
      'flagFacts.ie.fact.colours',
      'flagFacts.ie.fact.meagher',
      'flagFacts.ie.fact.harp',
      'flagFacts.ie.fact.order',
    ],
  },
  ch: {
    introKey: 'flagFacts.ch.intro',
    timeline: [
      { year: '12th–14th c.', img: 'history/ch-arms.svg', captionKey: 'flagFacts.ch.imperial' },
      { year: '17th–18th c.', img: 'history/ch-flamme.svg', captionKey: 'flagFacts.ch.flamme' },
      { year: '1798', img: 'history/ch-helvetic.svg', captionKey: 'flagFacts.ch.helvetic' },
      { year: '1848', img: 'history/ch-square.svg', captionKey: 'flagFacts.ch.current' },
    ],
    factKeys: [
      'flagFacts.ch.fact.square',
      'flagFacts.ch.fact.redcross',
      'flagFacts.ch.fact.proportions',
      'flagFacts.ch.fact.red2017',
      'flagFacts.ch.fact.dufour',
    ],
  },
  gr: {
    introKey: 'flagFacts.gr.intro',
    timeline: [
      { year: '1453–1793', img: 'history/gr-ottoman.svg', captionKey: 'flagFacts.gr.ottoman' },
      { year: '1769', img: 'history/gr-1769.svg', captionKey: 'flagFacts.gr.orlov' },
      { year: '1822', img: 'history/gr-1822-land.svg', captionKey: 'flagFacts.gr.land' },
      { year: '1978', img: 'svg/gr.svg', captionKey: 'flagFacts.gr.current' },
    ],
    factKeys: [
      'flagFacts.gr.fact.stripes',
      'flagFacts.gr.fact.cross',
      'flagFacts.gr.fact.colours',
      'flagFacts.gr.fact.ratio',
    ],
  },
};

/**
 * Facts entry for a country code, or null when we have no story for it.
 * Most flags have none (yet) — the caller renders nothing in that case.
 *
 * @param {string} code
 * @returns {FlagFacts | null}
 */
export function getFlagFacts(code) {
  return Object.prototype.hasOwnProperty.call(FLAG_FACTS, code) ? FLAG_FACTS[code] : null;
}
