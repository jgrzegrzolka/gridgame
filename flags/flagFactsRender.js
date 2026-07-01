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
      list.appendChild(li);
    }
    if (list.children.length > 0) {
      extra.appendChild(list);
      root.appendChild(extra);
    }
  }

  return root;
}

/**
 * One timeline `<li>`: historical flag image on one side, year + caption on
 * the other. The caption doubles as the image's `alt` text.
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
