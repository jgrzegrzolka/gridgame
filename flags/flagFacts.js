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
 *   addedOn: string,
 *   introKey: string,
 *   timeline: FlagFactStep[],
 *   factKeys?: string[],
 *   compare?: FlagFactCompare,
 *   illustration?: FlagFactIllustration,
 * }} FlagFacts
 *
 * @typedef {{
 *   img: string,
 *   afterFactKey: string,
 *   correctKey: string,
 *   invertedKey: string,
 * }} FlagFactCompare
 *
 * @typedef {{
 *   img: string,
 *   afterFactKey: string,
 *   captionKey: string,
 *   altKey?: string,
 * }} FlagFactIllustration
 *
 * `compare` (optional) renders a two-flag "right way up vs upside down"
 * illustration — the same `img` shown normally and flipped vertically —
 * tucked directly beneath the fact bullet named by `afterFactKey` (so it
 * illustrates that specific point). It exists for flags whose asymmetry has a
 * consequence (the Union Jack, where inverting it is a distress signal). No
 * caption or labels: the fact text above the flags already explains them.
 * `correctKey` / `invertedKey` supply the images' alt text only (a11y), not
 * visible labels. Both flags are tap-to-enlarge; the inverted one enlarges
 * mirrored too (the renderer flags it so the lightbox keeps the flip).
 *
 * `illustration` (optional) renders a single image with a visible caption
 * beneath the fact bullet named by `afterFactKey` — for a flag that a fact
 * mentions but that never belonged to the timeline (a rejected proposal, a
 * one-off variant). `captionKey` is shown (unlike `compare`, which has none)
 * so the image is labelled honestly; `altKey` overrides the alt text, falling
 * back to the caption. Tap-to-enlarge like every other story image.
 *
 * `addedOn` (`YYYY-MM-DD`) is the day the story shipped. It drives the
 * flag-of-the-day rotation's append-safety: a flag only becomes eligible the
 * day after its `addedOn`, so adding a story never disturbs today's or a past
 * day's pick (see `flags/flagOfDay.js`). A test pins that every entry has one.
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
  al: {
    addedOn: '2026-07-03',
    // The eagle never leaves the flag; what changes through a turbulent
    // century is the emblem AROUND it. This walks the full run of historical
    // designs (matching the Polish Wikipedia gallery): white star, bare
    // eagle, compact republic eagle, royal helmet, fascist fasces,
    // crowned royal state flag, wartime hammer-and-sickle, communist star,
    // plain eagle today. Some 1920s/40s steps are near-identical plain eagles
    // kept for completeness at Jan's request; the distinct emblems carry the
    // story.
    introKey: 'flagFacts.al.intro',
    timeline: [
      { year: '1914–1920', img: 'history/al-1914.svg', captionKey: 'flagFacts.al.principality' },
      { year: '1920–1926', img: 'history/al-1920-1926.svg', captionKey: 'flagFacts.al.restored' },
      { year: '1926–1928', img: 'history/al-1926-1928.svg', captionKey: 'flagFacts.al.republic' },
      { year: '1928–1939', img: 'history/al-kingdom.svg', captionKey: 'flagFacts.al.kingdom' },
      { year: '1939–1943', img: 'history/al-italian.svg', captionKey: 'flagFacts.al.italian' },
      { year: '1939–1943', img: 'history/al-crowned.svg', captionKey: 'flagFacts.al.crowned' },
      { year: '1944–1946', img: 'history/al-1944.svg', captionKey: 'flagFacts.al.wartime' },
      { year: '1946–1992', img: 'history/al-communist.svg', captionKey: 'flagFacts.al.communist' },
      { year: '1992', img: 'svg/al.svg', captionKey: 'flagFacts.al.current' },
    ],
    factKeys: [
      'flagFacts.al.fact.feathers',
      'flagFacts.al.fact.landofeagles',
    ],
  },
  gb: {
    addedOn: '2026-07-01',
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
    // Sits directly under the `asymmetry` bullet: the same flag the right way
    // up and flipped. The Union Jack has 180° rotational symmetry, so "upside
    // down" is a vertical FLIP (scaleY(-1)), not a rotation — a rotation would
    // look identical. The flip correctly drops the broad white below the red
    // on the hoist side.
    compare: {
      img: 'svg/gb.svg',
      afterFactKey: 'flagFacts.gb.fact.asymmetry',
      correctKey: 'flagFacts.gb.compare.correct',
      invertedKey: 'flagFacts.gb.compare.inverted',
    },
    // Sits under the "Wales isn't represented" fact: a Union flag with the
    // Welsh dragon added was proposed but never adopted. A rejected design, so
    // it illustrates the fact rather than earning a timeline step.
    illustration: {
      img: 'history/gb-wales-proposal.svg',
      afterFactKey: 'flagFacts.gb.fact.wales',
      captionKey: 'flagFacts.gb.walesProposal',
      altKey: 'flagFacts.gb.walesProposalAlt',
    },
  },
  'gb-eng': {
    addedOn: '2026-07-01',
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
    addedOn: '2026-07-01',
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
    addedOn: '2026-07-01',
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
    addedOn: '2026-07-01',
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
    addedOn: '2026-07-01',
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
    addedOn: '2026-07-01',
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
  pl: {
    addedOn: '2026-07-01',
    // Every step here looks distinct at thumbnail size (the rule: don't show
    // near-identical flags in a row). The plain white-red bicolour never
    // changed after 1919, and the state flag's crown-on/crown-off saga is
    // invisible at this size, so that lives in a "Did you know?" fact instead
    // of three look-alike tiles. The visible lineage: royal eagle → the
    // Commonwealth's swallow-tailed banner → an 1863 uprising flag (the blue
    // stripe sets it apart) → the modern bicolour.
    introKey: 'flagFacts.pl.intro',
    timeline: [
      { year: 'since 13th c.', img: 'history/pl-eagle.svg', captionKey: 'flagFacts.pl.eagle' },
      { year: '16th–18th c.', img: 'history/pl-commonwealth.svg', captionKey: 'flagFacts.pl.commonwealth' },
      { year: '1863', img: 'history/pl-january.svg', captionKey: 'flagFacts.pl.january' },
      { year: '1919', img: 'svg/pl.svg', captionKey: 'flagFacts.pl.current' },
    ],
    factKeys: ['flagFacts.pl.fact.crown', 'flagFacts.pl.fact.lookalikes'],
  },
  ge: {
    addedOn: '2026-07-01',
    introKey: 'flagFacts.ge.intro',
    timeline: [
      { year: '1918–1921', img: 'history/ge-1918.svg', captionKey: 'flagFacts.ge.republic' },
      { year: '1921–1990', img: 'history/ge-ssr.svg', captionKey: 'flagFacts.ge.soviet' },
      // The 1918 flag returned after the USSR fell — same design, hence the
      // same image, shown again so the "it came back" beat reads visually.
      { year: '1991–2004', img: 'history/ge-1918.svg', captionKey: 'flagFacts.ge.restored' },
      { year: '2004', img: 'svg/ge.svg', captionKey: 'flagFacts.ge.current' },
    ],
    factKeys: ['flagFacts.ge.fact.crosses', 'flagFacts.ge.fact.jerusalem', 'flagFacts.ge.fact.stgeorge'],
  },
  fr: {
    addedOn: '2026-07-01',
    introKey: 'flagFacts.fr.intro',
    timeline: [
      { year: 'to 1789', img: 'history/fr-royal.svg', captionKey: 'flagFacts.fr.royal' },
      // Equation: the Tricolour = Paris's blue-and-red + the king's white.
      {
        year: '1794',
        img: 'svg/fr.svg',
        captionKey: 'flagFacts.fr.current',
        // The white ingredient is plain white (the king's colour) — NOT the
        // fleurs-de-lis royal flag, whose gold never appears on the Tricolour.
        parts: ['history/fr-paris.svg', 'history/fr-white.svg'],
        partLabelKeys: ['flagFacts.fr.part.paris', 'flagFacts.fr.part.king'],
      },
    ],
    factKeys: [
      'flagFacts.fr.fact.meaning',
      'flagFacts.fr.fact.paris',
      'flagFacts.fr.fact.flip',
      'flagFacts.fr.fact.influence',
    ],
  },
  af: {
    addedOn: '2026-07-01',
    // The whole point of Afghanistan's story is churn — it changed its flag
    // more than any country in the 20th century. A 4-step timeline told that
    // but didn't show it (huge 1931→2004 gap), so the timeline walks the
    // ideological pendulum: vertical tricolour → horizontal → red → back to
    // black-red-green → green-white-black → vertical again → white. Still a
    // curated selection (the intro says so), not all ~19 designs.
    introKey: 'flagFacts.af.intro',
    timeline: [
      { year: '1901–1919', img: 'history/af-emirate.svg', captionKey: 'flagFacts.af.emirate' },
      { year: '1928', img: 'history/af-1928.svg', captionKey: 'flagFacts.af.tricolour' },
      { year: '1931–1973', img: 'history/af-kingdom.svg', captionKey: 'flagFacts.af.kingdom' },
      { year: '1974–1978', img: 'history/af-daoud.svg', captionKey: 'flagFacts.af.daoud' },
      { year: '1978–1980', img: 'history/af-red.svg', captionKey: 'flagFacts.af.red' },
      { year: '1980–1987', img: 'history/af-dra.svg', captionKey: 'flagFacts.af.dra' },
      { year: '1992–2001', img: 'history/af-islamicstate.svg', captionKey: 'flagFacts.af.islamicstate' },
      { year: '2004–2021', img: 'history/af-republic.svg', captionKey: 'flagFacts.af.republic' },
      { year: '2021', img: 'svg/af.svg', captionKey: 'flagFacts.af.current' },
    ],
    factKeys: [
      'flagFacts.af.fact.changes',
      'flagFacts.af.fact.colours',
      'flagFacts.af.fact.mosque',
      'flagFacts.af.fact.longlived',
      'flagFacts.af.fact.white',
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

/**
 * Codes of every flag that currently has a story — the pool the home page's
 * "flag of the day" rotates through. Grows automatically as descriptions are
 * added, so there's no separate list to keep in sync.
 *
 * @returns {string[]}
 */
export function storyFlagCodes() {
  return Object.keys(FLAG_FACTS);
}

/**
 * The story pool as `{ code, addedOn }` records — what the flag-of-the-day
 * picker needs to stay append-safe (each flag's eligibility starts the day
 * after its `addedOn`). Grows automatically as stories are added.
 *
 * @returns {Array<{ code: string, addedOn: string }>}
 */
export function storyFlagPool() {
  return Object.entries(FLAG_FACTS).map(([code, facts]) => ({ code, addedOn: facts.addedOn }));
}
