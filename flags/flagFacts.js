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
 *                        it stays in the data rather than i18n). Consecutive
 *                        steps that share an identical `year` render as one
 *                        bracketed "these coexisted" group instead of separate
 *                        dated nodes (see `flagFactsRender.groupTimeline`), so
 *                        give concurrent variants the same label and sequential
 *                        flags distinct ones.
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
 *   galleries?: FlagFactGallery[],
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
 * @typedef {{
 *   afterFactKey: string,
 *   items: { img: string, labelKey: string }[],
 * }} FlagFactGallery
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
 * `galleries` (optional) is a list of small flag rows, each pinned under the
 * fact bullet named by its `afterFactKey`. Each `item` is a flag `img` with a
 * short visible `labelKey`. For flags a fact names but that don't belong in
 * the timeline (Ireland's other flags: the Starry Plough, Sunburst, Four
 * Provinces, the President's standard), so the reader sees them, not just
 * their names. Each thumbnail is tap-to-enlarge like every other story image.
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
    // Chronological arc: under the crown the harp flew gold on royal blue; the
    // 1642 Confederates flew it uncrowned on green; the saltire is Ireland's
    // element in the Union; Erin go Bragh carried the harp with its motto; the
    // 1848 tricolour replaced all of them. Two green-harp tiles are kept
    // deliberately distinct (plain harp for 1642, winged harp + motto for Erin).
    introKey: 'flagFacts.ie.intro',
    timeline: [
      { year: '1542–1801', img: 'history/ie-royal.svg', captionKey: 'flagFacts.ie.royal' },
      { year: '1642', img: 'history/ie-harp-1642.svg', captionKey: 'flagFacts.ie.harp' },
      { year: 'St Patrick', img: 'history/ie-patrick.svg', captionKey: 'flagFacts.ie.patrick' },
      { year: '1847', img: 'history/ie-erin.svg', captionKey: 'flagFacts.ie.erin' },
      { year: '1848', img: 'svg/ie.svg', captionKey: 'flagFacts.ie.current' },
    ],
    factKeys: [
      'flagFacts.ie.fact.colours',
      'flagFacts.ie.fact.meagher',
      'flagFacts.ie.fact.harp',
      'flagFacts.ie.fact.crowned',
      'flagFacts.ie.fact.otherflags',
      'flagFacts.ie.fact.order',
    ],
    // The flags a fact names but that never belonged in the national-flag
    // timeline, shown as thumbnails under the bullet that describes them.
    galleries: [
      {
        afterFactKey: 'flagFacts.ie.fact.crowned',
        items: [
          { img: 'history/ie-president.svg', labelKey: 'flagFacts.ie.gallery.president' },
        ],
      },
      {
        afterFactKey: 'flagFacts.ie.fact.otherflags',
        items: [
          { img: 'history/ie-plough.svg', labelKey: 'flagFacts.ie.gallery.plough' },
          { img: 'history/ie-sunburst.svg', labelKey: 'flagFacts.ie.gallery.sunburst' },
          { img: 'history/ie-fourprov.svg', labelKey: 'flagFacts.ie.gallery.fourprov' },
        ],
      },
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
    // The through-line: for 150 years Greece flew two flags at once, a white
    // cross on land and blue-and-white stripes at sea, with a crown added to
    // both while it was a kingdom. In 1978 the stripes replaced the cross as
    // the single national flag. Every tile is a distinct, genuinely-flown
    // design (the crowned cross and the junta's dark navy read clearly; the
    // war ensign's canton crown is small but it was a real century-long flag).
    introKey: 'flagFacts.gr.intro',
    timeline: [
      { year: '1453–1793', img: 'history/gr-ottoman.svg', captionKey: 'flagFacts.gr.ottoman' },
      { year: '1821', img: 'history/gr-1821.svg', captionKey: 'flagFacts.gr.revolution' },
      { year: '1822', img: 'history/gr-1822-land.svg', captionKey: 'flagFacts.gr.land' },
      { year: '1863–1973', img: 'history/gr-crowned.svg', captionKey: 'flagFacts.gr.crowned' },
      { year: '1863–1970', img: 'history/gr-warensign.svg', captionKey: 'flagFacts.gr.warensign' },
      { year: '1970–1975', img: 'history/gr-junta.svg', captionKey: 'flagFacts.gr.junta' },
      { year: '1978', img: 'svg/gr.svg', captionKey: 'flagFacts.gr.current' },
    ],
    factKeys: [
      'flagFacts.gr.fact.stripes',
      'flagFacts.gr.fact.cross',
      'flagFacts.gr.fact.colours',
      'flagFacts.gr.fact.ratio',
      'flagFacts.gr.fact.guinness',
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
    addedOn: '2026-07-03',
    // Nearly nine centuries of the flags France actually flew: the medieval
    // Oriflamme and fleurs-de-lis banners, the white royal drapeau blanc, and
    // then the republic->monarchy->republic pendulum of the Revolution and
    // after. The Tricolour returns after the Bourbon white flag, then the tail
    // of the timeline shows the SHADE pendulum: dark navy (1830-1976) lightened
    // by Giscard (the official 1976-2020 blue #0055A4 + lighter red #EF4135),
    // then Macron's 2020 return to the navy "bleu marine" (#000091, our real
    // fr.svg). The two navies reuse fr.svg on purpose (it came back to the same
    // shade); the lighter 1976-2020 flag is the only visibly different one.
    // The 1790 first tricolour flew RED at the hoist before David flipped the
    // order in 1794. The Oriflamme is a genuinely tall streamer (1:5) but is
    // capped to the shared tile height like every other flag.
    introKey: 'flagFacts.fr.intro',
    timeline: [
      { year: '1124–1356', img: 'history/fr-oriflamme.svg', captionKey: 'flagFacts.fr.oriflamme' },
      { year: '12th–13th c.', img: 'history/fr-ancient.svg', captionKey: 'flagFacts.fr.ancient' },
      { year: '14th–16th c.', img: 'history/fr-modern.svg', captionKey: 'flagFacts.fr.modern' },
      { year: 'to 1789', img: 'history/fr-royal.svg', captionKey: 'flagFacts.fr.royal' },
      { year: '1790–1794', img: 'history/fr-1790.svg', captionKey: 'flagFacts.fr.firsttricolour' },
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
      { year: '1814–1830', img: 'history/fr-white-1814.svg', captionKey: 'flagFacts.fr.white' },
      // The Tricolour restored in 1830, dark navy (reuses fr.svg, the same navy
      // it returned to in 2020).
      { year: '1830–1976', img: 'svg/fr.svg', captionKey: 'flagFacts.fr.restored' },
      // Giscard's lighter blue-and-red (official #0055A4 / #EF4135), the only
      // visibly different modern shade.
      { year: '1976–2020', img: 'history/fr-1976.svg', captionKey: 'flagFacts.fr.lighter' },
      // Macron's 2020 return to the navy "bleu marine" — same fr.svg as 1830.
      { year: 'since 2020', img: 'svg/fr.svg', captionKey: 'flagFacts.fr.navy2020' },
    ],
    factKeys: [
      'flagFacts.fr.fact.meaning',
      'flagFacts.fr.fact.paris',
      'flagFacts.fr.fact.flip',
      'flagFacts.fr.fact.chambord',
      'flagFacts.fr.fact.wwii',
      'flagFacts.fr.fact.influence',
    ],
    // The plain white drapeau blanc in the timeline was France's national flag
    // during the Restoration; the Bourbon kings' own richer version (white with
    // the crowned royal arms) sits under the Chambord fact, which is about that
    // white-flag tradition. Kept out of the timeline so the national-flag
    // lineage stays honest.
    illustration: {
      img: 'history/fr-bourbon-arms.svg',
      afterFactKey: 'flagFacts.fr.fact.chambord',
      captionKey: 'flagFacts.fr.bourbonArms',
      altKey: 'flagFacts.fr.bourbonArmsAlt',
    },
    // The two WWII flags, shown beside the national-flag lineage rather than in
    // it (the Ireland "other flags" pattern).
    galleries: [
      {
        afterFactKey: 'flagFacts.fr.fact.wwii',
        items: [
          { img: 'history/fr-freefrance.svg', labelKey: 'flagFacts.fr.gallery.freefrance' },
          { img: 'history/fr-vichy.svg', labelKey: 'flagFacts.fr.gallery.vichy' },
        ],
      },
    ],
  },
  af: {
    addedOn: '2026-07-03',
    // Afghanistan changed its flag more than any country, so this walks the
    // WHOLE run matching the pl.wikipedia gallery (Jan's "everything" call):
    // plain black dynastic banners, the Durrani green, the black+emblem emirate
    // series, the recurring black-red-green tricolour in many near-identical
    // emblem variants (captions carry the differences the thumbnails can't),
    // the 1929 red-black-white interlude, communist red, the mujahideen
    // green-white-black, and the Taliban white->shahada. Several tricolours look
    // alike at thumbnail on purpose: they were genuinely distinct flags.
    introKey: 'flagFacts.af.intro',
    timeline: [
      { year: '1709–1738', img: 'history/af-black.svg', captionKey: 'flagFacts.af.black' },
      { year: '1747–1842', img: 'history/af-durrani.svg', captionKey: 'flagFacts.af.durrani' },
      { year: '1880–1901', img: 'history/af-1880.svg', captionKey: 'flagFacts.af.black1880' },
      { year: '1901–1919', img: 'history/af-emirate.svg', captionKey: 'flagFacts.af.emirate' },
      { year: '1919–1921', img: 'history/af-octagram.svg', captionKey: 'flagFacts.af.octagram' },
      { year: '1921–1926', img: 'history/af-1921.svg', captionKey: 'flagFacts.af.emblem1921' },
      { year: '1926–1928', img: 'history/af-1926.svg', captionKey: 'flagFacts.af.emblem1926' },
      { year: '1928', img: 'history/af-1928-horizontal.svg', captionKey: 'flagFacts.af.horiz1928' },
      { year: '1928–1929', img: 'history/af-1928.svg', captionKey: 'flagFacts.af.tricolour' },
      { year: '1928–1929', img: 'history/af-1928-variant.svg', captionKey: 'flagFacts.af.variant1928' },
      { year: '1928–1929', img: 'history/af-1928-gold.svg', captionKey: 'flagFacts.af.gold1928' },
      { year: '1929', img: 'history/af-1929-radial.svg', captionKey: 'flagFacts.af.radial1929' },
      { year: '1929', img: 'history/af-1929.svg', captionKey: 'flagFacts.af.kalakani' },
      { year: '1929–1931', img: 'history/af-1929-1930.svg', captionKey: 'flagFacts.af.nadir' },
      { year: '1930–1973', img: 'history/af-kingdom.svg', captionKey: 'flagFacts.af.kingdom' },
      { year: '1973–1974', img: 'history/af-1973.svg', captionKey: 'flagFacts.af.republic1973' },
      { year: '1974–1978', img: 'history/af-daoud.svg', captionKey: 'flagFacts.af.daoud' },
      { year: '1974–1978', img: 'history/af-daoud-vertical.svg', captionKey: 'flagFacts.af.daoudvert' },
      { year: '1978', img: 'history/af-1978.svg', captionKey: 'flagFacts.af.noemblem' },
      { year: '1978–1980', img: 'history/af-red.svg', captionKey: 'flagFacts.af.red' },
      { year: '1980–1987', img: 'history/af-dra.svg', captionKey: 'flagFacts.af.dra' },
      { year: '1987–1992', img: 'history/af-1987.svg', captionKey: 'flagFacts.af.najibullah' },
      { year: '1992', img: 'history/af-1992a.svg', captionKey: 'flagFacts.af.temp1992' },
      { year: '1992', img: 'history/af-1992b.svg', captionKey: 'flagFacts.af.temp1992b' },
      { year: '1992–2001', img: 'history/af-islamicstate.svg', captionKey: 'flagFacts.af.islamicstate' },
      { year: '1996–1997', img: 'history/af-white-2x1.svg', captionKey: 'flagFacts.af.talibanwhite' },
      { year: '1997–2001', img: 'history/af-shahada.svg', captionKey: 'flagFacts.af.talibanshahada' },
      { year: '1997–2001', img: 'history/af-shahada-green.svg', captionKey: 'flagFacts.af.talibangreen' },
      { year: '1997–2001', img: 'history/af-shahada-v2.svg', captionKey: 'flagFacts.af.shahadav2' },
      { year: '2001–2002', img: 'history/af-2001.svg', captionKey: 'flagFacts.af.post2001' },
      { year: '2002–2004', img: 'history/af-2002.svg', captionKey: 'flagFacts.af.ref2002' },
      { year: '2004–2013', img: 'history/af-republic.svg', captionKey: 'flagFacts.af.republic' },
      { year: '2004–2021', img: 'history/af-republic-colored.svg', captionKey: 'flagFacts.af.coloured' },
      { year: '2013–2021', img: 'history/af-2013.svg', captionKey: 'flagFacts.af.deepred' },
      { year: '2021', img: 'svg/af.svg', captionKey: 'flagFacts.af.current' },
      { year: 'since 2021', img: 'history/af-pashto.svg', captionKey: 'flagFacts.af.pashto' },
    ],
    factKeys: [
      'flagFacts.af.fact.changes',
      'flagFacts.af.fact.colours',
      'flagFacts.af.fact.mosque',
      'flagFacts.af.fact.longlived',
      'flagFacts.af.fact.white',
      'flagFacts.af.fact.standards',
      'flagFacts.af.fact.civilwar',
    ],
    // Two galleries of flags that aren't the national flag, so they sit under a
    // "Did you know?" fact rather than the chronological timeline (Jan's call:
    // national flags + variants in the timeline, everything else in a gallery):
    //  - the rulers' personal standards (king's / president's banners), incl.
    //    the reverse faces, which carry different imagery from the front;
    //  - the rival and provincial banners of the 1929 civil war.
    galleries: [
      {
        afterFactKey: 'flagFacts.af.fact.standards',
        items: [
          { img: 'history/af-std-amanullah.svg', labelKey: 'flagFacts.af.gallery.amanullah' },
          { img: 'history/af-std-kings.svg', labelKey: 'flagFacts.af.gallery.kings' },
          { img: 'history/af-std-kings-reverse.svg', labelKey: 'flagFacts.af.gallery.kingsReverse' },
          { img: 'history/af-std-nadir-reverse.svg', labelKey: 'flagFacts.af.gallery.nadirReverse' },
          { img: 'history/af-std-president.svg', labelKey: 'flagFacts.af.gallery.president' },
          { img: 'history/af-std-president-var.svg', labelKey: 'flagFacts.af.gallery.presidentVar' },
        ],
      },
      {
        afterFactKey: 'flagFacts.af.fact.civilwar',
        items: [
          { img: 'history/af-rebel-aliahmad.svg', labelKey: 'flagFacts.af.gallery.rebel' },
          { img: 'history/af-herat-1930s.svg', labelKey: 'flagFacts.af.gallery.herat' },
        ],
      },
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
