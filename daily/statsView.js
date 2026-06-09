/**
 * Fetch + render the community-stats panel for a finished daily puzzle.
 * Wraps statsRender.js with the network + loading/failure logic that
 * isn't pure and isn't worth living inline in playFlow.
 *
 * Per FEATURE.md:
 *   - Loading: show a small placeholder while the GET is in flight.
 *   - Failure: the stats panel just doesn't render. Don't pop a toast,
 *     don't show an error — the rest of the result page (found, missed,
 *     "play again") still works without stats.
 *
 * `fetchImpl` and `render` are injected so tests don't have to touch
 * the network or build a fake DOM tree.
 */

import { renderStats as defaultRender } from './statsRender.js';

const ENDPOINT_BASE = '/api/v1/daily/stats/';

/** @typedef {import('../flags/group.js').Country} Country */

/**
 * @param {{
 *   n: number,
 *   container: HTMLElement,
 *   targets: Country[],
 *   displayName: (c: Country) => string,
 *   labels: { sectionTitle: string, loading: string, noSubmissions: string },
 *   fetchImpl?: typeof fetch,
 *   render?: typeof defaultRender,
 *   bypassCache?: boolean,
 * }} args
 */
export async function loadAndRenderStats({
  n, container, targets, displayName, labels,
  fetchImpl = globalThis.fetch,
  render = defaultRender,
  bypassCache = false,
}) {
  showLoading(container, labels.loading);
  container.hidden = false;

  // After a player submits, they need to see THEIR OWN result reflected
  // immediately. The server-side 60s cache otherwise masks it. The
  // `?fresh=1` param tells the handler to skip the cache lookup; the
  // handler still writes the fresh result back into the cache so
  // subsequent GETs (other players, this player's revisits) get the
  // up-to-date snapshot without their own bypass.
  const url = `${ENDPOINT_BASE}${n}${bypassCache ? '?fresh=1' : ''}`;

  let stats;
  try {
    const res = await fetchImpl(url);
    if (!res.ok) {
      hideSilently(container);
      return;
    }
    stats = await res.json();
  } catch {
    hideSilently(container);
    return;
  }

  render(container, {
    stats,
    targets,
    displayName,
    labels: { sectionTitle: labels.sectionTitle, noSubmissions: labels.noSubmissions },
  });
}

/**
 * @param {HTMLElement} container
 * @param {string} text
 */
function showLoading(container, text) {
  const doc = container.ownerDocument;
  container.innerHTML = '';
  const p = doc.createElement('p');
  p.className = 'find-stats-loading';
  p.textContent = text;
  container.appendChild(p);
}

/**
 * @param {HTMLElement} container
 */
function hideSilently(container) {
  container.innerHTML = '';
  container.hidden = true;
}
