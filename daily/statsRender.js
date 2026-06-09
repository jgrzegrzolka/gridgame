/**
 * Render the per-flag community-stats grid for a finished daily puzzle.
 * Pure DOM: takes a container, the stats payload, the puzzle's
 * targets, and a country-to-display-name function. No fetch, no
 * localStorage, no i18n globals — all strings injected.
 *
 * Layout: re-uses the existing `.find-tile` grid that found/missed
 * already use, with an always-visible bottom-strip percentage on each
 * tile. Sorted hardest first (lowest find rate) so the interesting
 * "you're not alone — 88% missed this too" tiles surface immediately.
 *
 * Zero submissions case: render a single short message instead of an
 * empty grid. The feature gate (only render when the player has
 * submitted) means this almost never fires in practice — it only
 * shows the first player on a freshly-released puzzle who beat
 * everyone else to submit. Worth handling cleanly.
 */

const SVG_BASE = new URL('../flags/svg/', import.meta.url).href;

/** @typedef {import('../flags/group.js').Country} Country */

/**
 * @typedef {Object} Stats
 * @property {number} totalAttempts
 * @property {Record<string, number>} perCodeFinds
 * @property {number} median
 * @property {number} topPct
 */

/**
 * @param {HTMLElement} container  cleared and replaced
 * @param {{
 *   stats: Stats,
 *   targets: Country[],
 *   displayName: (c: Country) => string,
 *   labels: { sectionTitle: string, noSubmissions: string },
 * }} args
 */
export function renderStats(container, { stats, targets, displayName, labels }) {
  // ownerDocument keeps the function browser-portable (real Elements
  // expose it) AND test-portable (a fake container just needs to set
  // it to a fake doc).
  const doc = container.ownerDocument;
  container.innerHTML = '';

  const heading = doc.createElement('h2');
  heading.className = 'result-section-title';
  heading.textContent = labels.sectionTitle;
  container.appendChild(heading);

  if (!stats || stats.totalAttempts === 0) {
    const empty = doc.createElement('p');
    empty.className = 'find-stats-empty';
    empty.textContent = labels.noSubmissions;
    container.appendChild(empty);
    return;
  }

  // Sort hardest first. Stable tiebreak by code so the order is
  // deterministic for tests and identical-rate flags don't jitter
  // between renders.
  const rows = targets
    .map((c) => {
      const finds = stats.perCodeFinds[c.code] || 0;
      const pct = Math.round((finds / stats.totalAttempts) * 100);
      return { c, pct };
    })
    .sort((a, b) => (a.pct - b.pct) || a.c.code.localeCompare(b.c.code));

  const list = doc.createElement('ul');
  list.className = 'find-stats';
  for (const { c, pct } of rows) {
    list.appendChild(statsTile(doc, c, pct, displayName));
  }
  container.appendChild(list);
}

/**
 * @param {Document} doc
 * @param {Country} c
 * @param {number} pct
 * @param {(c: Country) => string} displayName
 */
function statsTile(doc, c, pct, displayName) {
  const name = displayName(c);
  const li = doc.createElement('li');
  li.className = 'find-tile find-stats-tile';
  li.dataset.name = name;
  li.dataset.pct = String(pct);

  const img = doc.createElement('img');
  img.src = `${SVG_BASE}${c.code}.svg`;
  img.alt = name;
  img.loading = 'lazy';
  li.appendChild(img);

  const pctEl = doc.createElement('span');
  pctEl.className = 'find-stats-pct';
  pctEl.textContent = `${pct}%`;
  li.appendChild(pctEl);

  return li;
}
