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
    for (const step of facts.timeline) {
      list.appendChild(buildStep(doc, { step, t, base }));
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
 * One timeline `<li>`. Normally a single historical flag with year + caption.
 * When `step.parts` is set, the visual is an equation instead — the part
 * flags joined by `+`, then `=`, then the result flag — so a composite flag
 * reads as ingredients combined, not as the flag changing over time.
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

  const li = doc.createElement('li');

  // Equation step (e.g. 1606 = England + Scotland): the year + description
  // come first, then the equation row below — read what happened, then see
  // it. The ingredient flags carry labels; the result flag doesn't (the
  // year + caption above already name it), only alt text for a11y.
  if (Array.isArray(step.parts) && step.parts.length > 0) {
    li.className = 'flag-facts-step flag-facts-step-eq';

    const meta = doc.createElement('div');
    meta.className = 'flag-facts-meta';
    const eqYear = doc.createElement('span');
    eqYear.className = 'flag-facts-year';
    eqYear.textContent = step.year;
    const eqCap = doc.createElement('p');
    eqCap.className = 'flag-facts-caption';
    eqCap.textContent = caption;
    meta.appendChild(eqYear);
    meta.appendChild(eqCap);
    li.appendChild(meta);

    const eq = doc.createElement('div');
    eq.className = 'flag-facts-equation';
    step.parts.forEach((partImg, i) => {
      if (i > 0) eq.appendChild(operator(doc, '+'));
      eq.appendChild(equationFlag(doc, base, partImg, t(step.partLabelKeys?.[i] ?? '', ''), false));
    });
    eq.appendChild(operator(doc, '='));
    eq.appendChild(equationFlag(doc, base, step.img, '', true, caption));
    li.appendChild(eq);
    return li;
  }

  li.className = 'flag-facts-step';

  const img = /** @type {HTMLImageElement} */ (doc.createElement('img'));
  img.className = 'flag-facts-img';
  img.src = `${base}${step.img}`;
  img.alt = caption;
  img.loading = 'lazy';

  const meta = doc.createElement('div');
  meta.className = 'flag-facts-meta';

  const year = doc.createElement('span');
  year.className = 'flag-facts-year';
  year.textContent = step.year;

  const cap = doc.createElement('p');
  cap.className = 'flag-facts-caption';
  cap.textContent = caption;

  meta.appendChild(year);
  meta.appendChild(cap);
  li.appendChild(img);
  li.appendChild(meta);
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
