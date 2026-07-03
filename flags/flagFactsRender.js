/**
 * Pure renderer for the flag-facts panel shown inside the flag-zoom dialog
 * on `/flagsdata/`. Takes a `FlagFacts` entry (from `flags/flagFacts.js`)
 * plus a translator + a base path for images, and returns the DOM subtree
 * the caller drops into the dialog. Returns null when there's nothing to
 * show, so the caller can toggle the dialog's widened `.has-facts` layout
 * off in one check.
 *
 * Pure (no document lookups, no globals) for the same reasons as
 * `dailyLeaderboardRender.js`: it unit-tests against a stub `doc` instead
 * of jsdom, and keeps `flagsdata/page.js` thin (resolve container, mount,
 * re-render on `langchanged`).
 *
 * XSS posture: every string reaches the DOM via `.textContent`, never
 * `innerHTML` — same rule as the leaderboard renderer. The prose is our own
 * i18n, but the discipline stays uniform.
 */

/** @typedef {import('./flagFacts.js').FlagFacts} FlagFacts */

/**
 * Build the facts subtree, or null when `facts` is falsy.
 *
 * Layout:
 *   - one `<p class="flag-facts-intro">` per intro paragraph (split on the
 *     blank-line separator in the i18n string),
 *   - an `<ol class="flag-facts-timeline">` of steps, each a `<li>` with the
 *     historical flag image, its year, and a caption.
 *
 * @param {{
 *   facts: FlagFacts | null,
 *   t: (key: string, fallback: string) => string,
 *   doc?: Document,
 *   base?: string,
 * }} args
 *   `base` is the path to the `flags/` folder from the page owning the
 *   dialog (flagsdata is at `/flagsdata/`, so `../flags/`). Prefixed onto
 *   each step's `img`.
 * @returns {HTMLElement | null}
 */
export function renderFlagFacts({ facts, t, doc = globalThis.document, base = '../flags/' }) {
  if (!facts) return null;

  const root = doc.createElement('div');
  root.className = 'flag-facts';

  const introText = t(facts.introKey, '');
  for (const para of introText.split('\n\n')) {
    const trimmed = para.trim();
    if (!trimmed) continue;
    const p = doc.createElement('p');
    p.className = 'flag-facts-intro';
    p.textContent = trimmed;
    root.appendChild(p);
  }

  if (Array.isArray(facts.timeline) && facts.timeline.length > 0) {
    const list = doc.createElement('ol');
    list.className = 'flag-facts-timeline';
    for (const cluster of clusterTimeline(facts.timeline)) {
      if (cluster.length === 1) {
        // A lone step (no overlap with a neighbour): the normal dated node.
        list.appendChild(buildStep(doc, { step: cluster[0], t, base }));
      } else if (cluster.every((s) => s.year === cluster[0].year)) {
        // Every flag shares one date: complete overlap, one bracket over them.
        list.appendChild(buildGroupedStep(doc, { steps: cluster, t, base }));
      } else {
        // Ranges that intersect but differ: partial overlap, parallel braces.
        list.appendChild(buildOverlapCluster(doc, { steps: cluster, t, base }));
      }
    }
    root.appendChild(list);
  }

  // "Did you know?" trivia list below the timeline. Each entry is an i18n
  // key; blanks (missing translation) are skipped so a half-translated
  // catalog never renders an empty bullet.
  if (Array.isArray(facts.factKeys) && facts.factKeys.length > 0) {
    const extra = doc.createElement('div');
    extra.className = 'flag-facts-extra';

    const heading = doc.createElement('h4');
    heading.className = 'flag-facts-extra-title';
    heading.textContent = t('flagFacts.didYouKnow', 'Did you know?');
    extra.appendChild(heading);

    const list = doc.createElement('ul');
    list.className = 'flag-facts-list';
    for (const key of facts.factKeys) {
      const text = t(key, '').trim();
      if (!text) continue;
      const li = doc.createElement('li');
      li.className = 'flag-facts-list-item';
      li.textContent = text;
      // Optional orientation comparison: the two flags render inside the
      // bullet named by `compare.afterFactKey`, directly under its text — no
      // caption or labels (the bullet explains them).
      if (facts.compare && facts.compare.afterFactKey === key) {
        li.appendChild(buildCompareRow(doc, { compare: facts.compare, t, base }));
      }
      // Optional single illustration (e.g. a rejected proposal): one captioned
      // image tucked under the bullet named by `illustration.afterFactKey`.
      if (facts.illustration && facts.illustration.afterFactKey === key) {
        li.appendChild(buildIllustration(doc, { illustration: facts.illustration, t, base }));
      }
      // Optional flag galleries: a row of labelled thumbnails under the bullet
      // named by each gallery's `afterFactKey` (flags a fact names but that
      // aren't in the timeline).
      if (Array.isArray(facts.galleries)) {
        for (const gallery of facts.galleries) {
          if (gallery.afterFactKey === key) {
            li.appendChild(buildGallery(doc, { gallery, t, base }));
          }
        }
      }
      list.appendChild(li);
    }
    if (list.children.length > 0) {
      extra.appendChild(list);
      root.appendChild(extra);
    }
  }

  // Image attribution — rendered on every story (not per-country). The flag
  // SVGs come from two places: current flags from the flag-icons project
  // (MIT), historical flags from Wikimedia Commons (public domain, a few
  // CC BY-SA). CC BY-SA legally requires the author + licence be shown to the
  // viewer, so we surface a link to the sources/licences list rather than
  // leaving it only in the repo. Built from elements (no text nodes) so the
  // separator is a CSS `::after` on the text span (keeps the link underline
  // off the dot) and the unit-test doc stub stays tiny.
  const credit = doc.createElement('p');
  credit.className = 'flag-facts-credit';

  const creditText = doc.createElement('span');
  creditText.className = 'flag-facts-credit-text';
  creditText.textContent = t('flagFacts.imageCredit', 'Flag images: flag-icons and Wikimedia Commons');
  credit.appendChild(creditText);

  const creditLink = /** @type {HTMLAnchorElement} */ (doc.createElement('a'));
  creditLink.className = 'flag-facts-credit-link';
  creditLink.href = SOURCES_URL;
  creditLink.target = '_blank';
  creditLink.rel = 'noopener noreferrer';
  creditLink.textContent = t('flagFacts.imageCreditLink', 'sources & licences');
  credit.appendChild(creditLink);

  root.appendChild(credit);

  return root;
}

/**
 * Combined image-credit page: the repo's `flags/history/SOURCES.md`, which
 * lists every flag asset with its source + licence (flag-icons/MIT for current
 * flags, Wikimedia Commons PD/CC BY-SA for historical). Opened in a new tab
 * from the credit line under each story.
 */
const SOURCES_URL = 'https://github.com/jgrzegrzolka/gridgame/blob/main/flags/history/SOURCES.md';

/**
 * Parse a `year` label into a numeric `{ start, end }` range. Takes the first
 * and last 3-4 digit run in the string: `"1928"` → `{1928, 1928}`,
 * `"1946–1992"` → `{1946, 1992}`, `"since 2021"` → `{2021, 2021}`. A label with
 * no year-like number (`"since 13th c."`) yields `{0, 0}` so it never clusters.
 *
 * @param {string} year
 * @returns {{ start: number, end: number }}
 */
function parseYearRange(year) {
  const nums = String(year).match(/\d{3,4}/g);
  if (!nums || nums.length === 0) return { start: 0, end: 0 };
  const years = nums.map(Number);
  return { start: years[0], end: years[years.length - 1] };
}

/**
 * Bucket the flat timeline into clusters of consecutive flags that coexisted.
 * A step joins the running cluster when it carries the **same date label** as
 * the previous step (concurrent variants: the 1928-1929 emblem trio, the two
 * 1929 rival flags) or the **same explicit `overlap` id** (a variant flown
 * across a design change, whose date range differs: the 2004-2021 coloured
 * emblem over the 2004-2013 and 2013-2021 flags). Otherwise it starts a new
 * cluster, so a plain sequential run stays one-flag-per-cluster.
 *
 * Partial overlap is opt-in (`overlap`) rather than inferred from the dates on
 * purpose: historical ranges are fuzzy, and a one-year seam between two truly
 * sequential flags (Nadir's 1929-1931, then the kingdom's 1930-1973) would
 * otherwise read as a false coexistence. The author marks the genuine ones.
 *
 * The render loop then draws a size-1 cluster as a normal dated node, an
 * all-same-date cluster as one bracket (buildGroupedStep), and a mixed-date
 * cluster as parallel braces (buildOverlapCluster).
 *
 * Equation steps (`parts`) never cluster — they own a bespoke layout — so one
 * always lands alone and breaks any surrounding run.
 *
 * @param {import('./flagFacts.js').FlagFactStep[]} timeline
 * @returns {import('./flagFacts.js').FlagFactStep[][]}
 */
function clusterTimeline(timeline) {
  /** @type {import('./flagFacts.js').FlagFactStep[][]} */
  const clusters = [];
  for (const step of timeline) {
    const isEq = Array.isArray(step.parts) && step.parts.length > 0;
    const last = clusters[clusters.length - 1];
    const prev = last && last[last.length - 1];
    const lastEq = last && Array.isArray(last[0].parts) && last[0].parts.length > 0;
    const joins =
      last &&
      prev &&
      !isEq &&
      !lastEq &&
      (step.year === prev.year || (!!step.overlap && step.overlap === prev.overlap));
    if (joins) last.push(step);
    else clusters.push([step]);
  }
  return clusters;
}

/**
 * A partial-overlap cluster: flags whose date ranges intersect but differ, so a
 * single shared date would lie. Rendered as a small CSS grid, one row per flag,
 * each with its **own inline date pill** beside its flag + caption (so which
 * flag flew when is read directly). A **brace** in the left gutter spans the
 * rows a flag outlived, so a variant flown across a design change reads as
 * running alongside the sequential flags it coexisted with. Braces are drawn
 * only when they cover more than one row (a real span); a lone flag that spans
 * only itself gets just its inline pill, and same-date variants share one brace.
 * Overlapping braces sit in parallel lanes, widest outermost.
 *
 * Grid rows (one per flag) give the braces automatic vertical alignment: a
 * brace `grid-row: firstRow / lastRow+1` stretches to the real height of the
 * rows it spans without any pixel measurement (the renderer stays pure).
 *
 * @param {Document} doc
 * @param {{
 *   steps: import('./flagFacts.js').FlagFactStep[],
 *   t: (key: string, fallback: string) => string,
 *   base: string,
 * }} args
 */
function buildOverlapCluster(doc, { steps, t, base }) {
  const ranges = steps.map((s) => parseYearRange(s.year));

  // Collapse consecutive same-date steps into one "unit" (one date pill + one
  // brace, e.g. the three 1997-2001 shahada variants).
  /** @type {{ year: string, start: number, end: number, firstRow: number, lastRow: number, spanFirst: number, spanLast: number, lane: number }[]} */
  const units = [];
  steps.forEach((step, row) => {
    const last = units[units.length - 1];
    if (last && last.year === step.year) {
      last.lastRow = row;
    } else {
      units.push({
        year: step.year,
        start: ranges[row].start,
        end: ranges[row].end,
        firstRow: row,
        lastRow: row,
        spanFirst: row,
        spanLast: row,
        lane: 0,
      });
    }
  });

  // A unit's brace spans every flag whose lifetime fits inside the unit's own
  // range (it outlived/contained them), so a wrapping flag's brace reaches over
  // the shorter flags it coexisted with. Rows are time-ordered, so the min/max
  // of the contained rows is a contiguous span.
  for (const u of units) {
    steps.forEach((_, row) => {
      if (ranges[row].start >= u.start && ranges[row].end <= u.end) {
        u.spanFirst = Math.min(u.spanFirst, row);
        u.spanLast = Math.max(u.spanLast, row);
      }
    });
  }

  // Assign lanes so braces that overlap in rows land in separate columns
  // (greedy interval colouring by span start): units whose spans don't touch
  // share a lane.
  /** @type {number[]} */
  const laneLastRow = [];
  [...units]
    .sort((a, b) => a.spanFirst - b.spanFirst || a.spanLast - b.spanLast)
    .forEach((u) => {
      let lane = laneLastRow.findIndex((lastRow) => lastRow < u.spanFirst);
      if (lane === -1) {
        lane = laneLastRow.length;
        laneLastRow.push(u.spanLast);
      } else {
        laneLastRow[lane] = u.spanLast;
      }
      u.lane = lane;
    });
  const nLanes = laneLastRow.length;

  // Order the lane columns so the widest-spanning brace sits outermost (leftmost,
  // nearest the date pills) and shorter braces nest inside it, nearer the flags:
  // a wrapping variant reads as encompassing the sequential flags it outlived.
  const laneMaxSpan = new Array(nLanes).fill(-1);
  for (const u of units) {
    laneMaxSpan[u.lane] = Math.max(laneMaxSpan[u.lane], u.spanLast - u.spanFirst);
  }
  /** @type {number[]} lane column (1-based), widest lane → column 1 (outermost) */
  const laneToCol = new Array(nLanes);
  [...laneMaxSpan.keys()]
    .sort((a, b) => laneMaxSpan[b] - laneMaxSpan[a])
    .forEach((lane, i) => {
      laneToCol[lane] = i + 1;
    });

  const li = doc.createElement('li');
  li.className = 'flag-facts-step flag-facts-step-overlap';
  // Columns: one narrow lane per brace column (outermost = widest brace), then
  // the flag body (which carries its own inline date pill).
  li.style.gridTemplateColumns = `repeat(${nLanes}, 15px) minmax(0, 1fr)`;
  const contentCol = nLanes + 1;

  // A brace per date, but only when it actually covers more than one row: the
  // wrapping variant's brace (spans the flags it outlived) and a same-date
  // group's brace (spans its own variants). A lone flag that spans only its own
  // row gets no brace, just its inline date pill, so only real overlap is drawn.
  for (const u of units) {
    if (u.spanFirst === u.spanLast) continue;
    const brace = doc.createElement('span');
    brace.className = 'flag-facts-brace-lane';
    brace.style.gridColumn = String(laneToCol[u.lane]);
    brace.style.gridRow = `${u.spanFirst + 1} / ${u.spanLast + 2}`;
    li.appendChild(brace);
  }

  // One row per flag: its date pill, flag, and caption inline, so the flag ↔
  // period pairing is read directly rather than across the brace gutter.
  steps.forEach((step, row) => {
    const caption = t(step.captionKey, '');

    const body = doc.createElement('div');
    body.className = 'flag-facts-body flag-facts-group-item';
    body.style.gridColumn = String(contentCol);
    body.style.gridRow = String(row + 1);

    const year = doc.createElement('span');
    year.className = 'flag-facts-year';
    year.textContent = step.year;
    body.appendChild(year);

    const img = /** @type {HTMLImageElement} */ (doc.createElement('img'));
    img.className = 'flag-facts-img flag-facts-group-img';
    img.src = `${base}${step.img}`;
    img.alt = caption;
    img.loading = 'lazy';
    body.appendChild(img);

    const cap = doc.createElement('p');
    cap.className = 'flag-facts-caption';
    cap.textContent = caption;
    body.appendChild(cap);

    li.appendChild(body);
  });

  return li;
}

/**
 * A grouped timeline `<li>`: several flags that share one exact date, stacked
 * under a single dated node. The date pill sits once to the left and one dot
 * (the normal node, not a bracket) marks the moment: flags of the *same* date
 * are concurrent variants of one instant, so they read as a single node with
 * its variants, not a span. A brace is reserved for *partial* overlap across
 * differing dates (buildOverlapCluster) — see clusterTimeline.
 *
 * @param {Document} doc
 * @param {{
 *   steps: import('./flagFacts.js').FlagFactStep[],
 *   t: (key: string, fallback: string) => string,
 *   base: string,
 * }} args
 */
function buildGroupedStep(doc, { steps, t, base }) {
  const li = doc.createElement('li');
  li.className = 'flag-facts-step flag-facts-step-group';

  const year = doc.createElement('span');
  year.className = 'flag-facts-year';
  year.textContent = steps[0].year;
  li.appendChild(year);

  // One dot marks the shared moment, exactly like a solo step's node; the
  // stacked flags below are its concurrent variants.
  const node = doc.createElement('span');
  node.className = 'flag-facts-node';
  li.appendChild(node);

  const body = doc.createElement('div');
  body.className = 'flag-facts-body flag-facts-group-body';
  for (const step of steps) {
    const caption = t(step.captionKey, '');

    const item = doc.createElement('div');
    item.className = 'flag-facts-group-item';

    const img = /** @type {HTMLImageElement} */ (doc.createElement('img'));
    img.className = 'flag-facts-img flag-facts-group-img';
    img.src = `${base}${step.img}`;
    img.alt = caption;
    img.loading = 'lazy';
    item.appendChild(img);

    const cap = doc.createElement('p');
    cap.className = 'flag-facts-caption';
    cap.textContent = caption;
    item.appendChild(cap);

    body.appendChild(item);
  }
  li.appendChild(body);
  return li;
}

/**
 * One timeline `<li>`. The date sits in a pill to the left of the dashed
 * axis, a dot marks this step's node on the axis, and the body (to the right)
 * is either the flag + caption or, when `step.parts` is set, an equation: the
 * part flags joined by `+`, then `=`, then the result flag, so a composite
 * flag reads as ingredients combined rather than a flag changing over time.
 *
 * @param {Document} doc
 * @param {{
 *   step: import('./flagFacts.js').FlagFactStep,
 *   t: (key: string, fallback: string) => string,
 *   base: string,
 * }} args
 */
function buildStep(doc, { step, t, base }) {
  const caption = t(step.captionKey, '');
  const parts = Array.isArray(step.parts) && step.parts.length > 0 ? step.parts : null;

  const li = doc.createElement('li');
  li.className = parts ? 'flag-facts-step flag-facts-step-eq' : 'flag-facts-step';

  // Date pill (left of the axis) + the dot node (on the axis). Same for every
  // step shape, so the whole timeline reads as one continuous dashed line.
  const year = doc.createElement('span');
  year.className = 'flag-facts-year';
  year.textContent = step.year;
  // Decorative dot on the axis; an empty span carries no accessible content.
  const node = doc.createElement('span');
  node.className = 'flag-facts-node';
  li.appendChild(year);
  li.appendChild(node);

  const body = doc.createElement('div');
  body.className = 'flag-facts-body';

  if (parts) {
    // Caption first, then the "part + part = result" row beneath it. The
    // ingredient flags carry labels; the result flag doesn't (the caption
    // already names it), only alt text for a11y.
    const eqCap = doc.createElement('p');
    eqCap.className = 'flag-facts-caption';
    eqCap.textContent = caption;
    body.appendChild(eqCap);

    const eq = doc.createElement('div');
    eq.className = 'flag-facts-equation';
    parts.forEach((partImg, i) => {
      if (i > 0) eq.appendChild(operator(doc, '+'));
      eq.appendChild(equationFlag(doc, base, partImg, t(step.partLabelKeys?.[i] ?? '', ''), false));
    });
    eq.appendChild(operator(doc, '='));
    eq.appendChild(equationFlag(doc, base, step.img, '', true, caption));
    body.appendChild(eq);
  } else {
    const img = /** @type {HTMLImageElement} */ (doc.createElement('img'));
    img.className = 'flag-facts-img';
    img.src = `${base}${step.img}`;
    img.alt = caption;
    img.loading = 'lazy';
    body.appendChild(img);

    const cap = doc.createElement('p');
    cap.className = 'flag-facts-caption';
    cap.textContent = caption;
    body.appendChild(cap);
  }

  li.appendChild(body);
  return li;
}

/**
 * The orientation-comparison row: two copies of the same flag — normal and
 * flipped (`-inverted` class → `scaleY(-1)` in CSS) — side by side, no caption
 * or labels. Both are tap-to-enlarge like the timeline flags; the inverted one
 * carries `data-lightbox-flip="1"` so the lightbox enlarges it mirrored too
 * (both share one `src`, so without that flag it would open right-side-up and
 * contradict the point).
 *
 * @param {Document} doc
 * @param {{
 *   compare: import('./flagFacts.js').FlagFactCompare,
 *   t: (key: string, fallback: string) => string,
 *   base: string,
 * }} args
 */
function buildCompareRow(doc, { compare, t, base }) {
  const row = doc.createElement('div');
  row.className = 'flag-facts-compare-row';
  row.appendChild(compareFlag(doc, { base, img: compare.img, alt: t(compare.correctKey, ''), inverted: false }));
  row.appendChild(compareFlag(doc, { base, img: compare.img, alt: t(compare.invertedKey, ''), inverted: true }));
  return row;
}

/**
 * A single captioned illustration under a fact bullet: one image plus a
 * visible caption (unlike the compare row, which has none). For a flag a fact
 * references that never belonged to the timeline — a rejected proposal, say.
 * The image is tap-to-enlarge like every other story flag (the caller wires
 * the whole subtree).
 *
 * @param {Document} doc
 * @param {{
 *   illustration: import('./flagFacts.js').FlagFactIllustration,
 *   t: (key: string, fallback: string) => string,
 *   base: string,
 * }} args
 */
function buildIllustration(doc, { illustration, t, base }) {
  const fig = doc.createElement('figure');
  fig.className = 'flag-facts-illustration';

  const image = /** @type {HTMLImageElement} */ (doc.createElement('img'));
  image.className = 'flag-facts-illustration-img';
  image.src = `${base}${illustration.img}`;
  image.alt = t(illustration.altKey ?? illustration.captionKey, '');
  image.loading = 'lazy';
  fig.appendChild(image);

  const captionText = t(illustration.captionKey, '').trim();
  if (captionText) {
    const figcaption = doc.createElement('figcaption');
    figcaption.className = 'flag-facts-illustration-caption';
    figcaption.textContent = captionText;
    fig.appendChild(figcaption);
  }
  return fig;
}

/**
 * A row of small labelled flag thumbnails under a fact bullet: each item is a
 * flag image with a short caption. For flags a fact names but that never
 * belonged to the timeline (Ireland's other flags), so they're shown, not just
 * named. Each thumbnail is tap-to-enlarge like every other story image (the
 * caller wires the whole subtree).
 *
 * @param {Document} doc
 * @param {{
 *   gallery: import('./flagFacts.js').FlagFactGallery,
 *   t: (key: string, fallback: string) => string,
 *   base: string,
 * }} args
 */
function buildGallery(doc, { gallery, t, base }) {
  const row = doc.createElement('div');
  row.className = 'flag-facts-gallery';
  for (const item of gallery.items) {
    const fig = doc.createElement('figure');
    fig.className = 'flag-facts-gallery-item';

    const image = /** @type {HTMLImageElement} */ (doc.createElement('img'));
    image.className = 'flag-facts-gallery-img';
    image.src = `${base}${item.img}`;
    image.alt = t(item.labelKey, '');
    image.loading = 'lazy';
    fig.appendChild(image);

    const label = doc.createElement('figcaption');
    label.className = 'flag-facts-gallery-label';
    label.textContent = t(item.labelKey, '');
    fig.appendChild(label);

    row.appendChild(fig);
  }
  return row;
}

/**
 * One flag in the comparison row: the image, flipped when `inverted`. `alt`
 * carries the orientation for screen readers (there's no visible label). The
 * inverted flag also gets `data-lightbox-flip` so its enlarged view stays
 * flipped — see buildCompareRow.
 *
 * @param {Document} doc
 * @param {{ base: string, img: string, alt: string, inverted: boolean }} args
 */
function compareFlag(doc, { base, img, alt, inverted }) {
  const image = /** @type {HTMLImageElement} */ (doc.createElement('img'));
  image.className = inverted
    ? 'flag-facts-compare-img flag-facts-compare-img-inverted'
    : 'flag-facts-compare-img';
  image.src = `${base}${img}`;
  image.alt = alt;
  image.loading = 'lazy';
  if (inverted && image.dataset) image.dataset.lightboxFlip = '1';
  return image;
}

/**
 * A `+` / `=` glyph between flags in an equation step.
 * @param {Document} doc
 * @param {string} glyph
 */
function operator(doc, glyph) {
  const span = doc.createElement('span');
  span.className = 'flag-facts-eq-op';
  span.textContent = glyph;
  return span;
}

/**
 * One flag inside an equation: the image, plus an optional visible label
 * beneath it. `isResult` flags the final (sum) flag so CSS can size it a
 * touch larger. `alt` overrides the image's alt text (defaults to `label`) —
 * the result flag shows no label but still wants descriptive alt text.
 *
 * @param {Document} doc
 * @param {string} base
 * @param {string} img
 * @param {string} label
 * @param {boolean} isResult
 * @param {string} [alt]
 */
function equationFlag(doc, base, img, label, isResult, alt) {
  const wrap = doc.createElement('div');
  wrap.className = isResult ? 'flag-facts-eq-flag flag-facts-eq-result' : 'flag-facts-eq-flag';

  const image = /** @type {HTMLImageElement} */ (doc.createElement('img'));
  image.className = 'flag-facts-eq-img';
  image.src = `${base}${img}`;
  image.alt = alt !== undefined ? alt : label;
  image.loading = 'lazy';
  wrap.appendChild(image);

  if (label) {
    const span = doc.createElement('span');
    span.className = 'flag-facts-eq-label';
    span.textContent = label;
    wrap.appendChild(span);
  }
  return wrap;
}
