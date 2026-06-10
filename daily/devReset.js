/**
 * Localhost-only dev toolbar.
 *
 * Two reset paths, both painfully manual without it:
 *
 * 1. **Reset browser** — wipe the four daily-flow localStorage keys
 *    (`gridgame.deviceId`, `gridgame.submittedPuzzles`, `daily.scores`,
 *    `gridgame.ideas.reviewed`) and reload. Lets the dev replay puzzles
 *    cleanly without poking around DevTools → Application → Storage.
 *
 * 2. **Clear Cosmos local rows** — POST to `/api/v1/dev/clear-local-rows`,
 *    which deletes every `dailyResults` doc with `local: true`. The
 *    endpoint refuses anywhere except a localhost-bound Functions runtime
 *    (server-trusted check on the request URL — see
 *    `api/src/lib/requestHost.js`), so the button is safe even if the
 *    page were somehow accessed from prod.
 *
 * Visibility is gated on `isLocalHostname(window.location.hostname)` —
 * same set the Turnstile bypass uses. Prod never renders the toolbar.
 */

import { isLocalHostname } from './turnstileSiteKey.js';

export const DEV_RESET_STORAGE_KEYS = Object.freeze([
  'gridgame.deviceId',
  'gridgame.submittedPuzzles',
  'daily.scores',
  'gridgame.ideas.reviewed',
]);

/**
 * Remove the daily-flow keys from a storage. Swallows errors (private
 * mode / quota) — losing the reset is preferable to crashing the page.
 *
 * @param {Pick<Storage, 'removeItem'>} storage
 * @param {readonly string[]} keys
 */
export function clearBrowserState(storage, keys = DEV_RESET_STORAGE_KEYS) {
  for (const key of keys) {
    try {
      storage.removeItem(key);
    } catch {
      /* ignore */
    }
  }
}

/**
 * POST to the clear-local-rows endpoint, returning the parsed JSON
 * (`{ scanned, deleted, failed }`). Throws on non-2xx so the caller can
 * surface the failure in the button label.
 *
 * @param {typeof fetch} fetchImpl
 */
export async function clearCosmosLocalRows(fetchImpl) {
  const res = await fetchImpl('/api/v1/dev/clear-local-rows', { method: 'POST' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.json();
}

/**
 * Inject a fixed-position toolbar with the two reset buttons. No-op
 * when not on a localhost hostname. Returns the wrapper element it
 * mounted (or `null` if it didn't).
 *
 * All side-effecting collaborators are injectable so tests can run
 * without a real DOM or network.
 *
 * @param {{
 *   rootEl?: HTMLElement,
 *   hostname?: string,
 *   doc?: Document,
 *   storage?: Pick<Storage, 'removeItem'>,
 *   fetchImpl?: typeof fetch,
 *   reload?: () => void,
 *   confirmFn?: (msg: string) => boolean,
 * }} [opts]
 */
export function mountDevReset(opts = {}) {
  const hostname = opts.hostname ?? window.location.hostname;
  if (!isLocalHostname(hostname)) return null;

  const doc = opts.doc ?? document;
  const rootEl = opts.rootEl ?? doc.body;
  const storage = opts.storage ?? window.localStorage;
  const fetchImpl = opts.fetchImpl ?? window.fetch.bind(window);
  const reload = opts.reload ?? (() => window.location.reload());
  const confirmFn = opts.confirmFn ?? ((/** @type {string} */ m) => window.confirm(m));

  const wrap = doc.createElement('div');
  wrap.className = 'dev-reset';
  wrap.setAttribute('aria-label', 'Dev reset tools (localhost only)');

  const browserBtn = makeBtn(
    doc,
    'Reset browser',
    'Clear gridgame.* + daily.scores localStorage and reload',
  );
  browserBtn.addEventListener('click', () => {
    if (!confirmFn('Clear deviceId, submittedPuzzles, scores, ideas-reviewed and reload?')) return;
    clearBrowserState(storage);
    reload();
  });

  const cosmosBtn = makeBtn(
    doc,
    'Clear Cosmos local rows',
    'DELETE every dailyResults doc with local=true (localhost-only endpoint)',
  );
  cosmosBtn.addEventListener('click', async () => {
    if (!confirmFn('Delete every dailyResults doc with local=true?')) return;
    const original = cosmosBtn.textContent;
    cosmosBtn.disabled = true;
    cosmosBtn.textContent = 'Deleting…';
    try {
      const result = await clearCosmosLocalRows(fetchImpl);
      cosmosBtn.textContent = `Deleted ${result.deleted}/${result.scanned}`;
    } catch (e) {
      cosmosBtn.textContent = `Failed: ${e instanceof Error ? e.message : String(e)}`;
    }
    setTimeout(() => {
      cosmosBtn.disabled = false;
      cosmosBtn.textContent = original;
    }, 2500);
  });

  wrap.appendChild(browserBtn);
  wrap.appendChild(cosmosBtn);
  rootEl.appendChild(wrap);
  return wrap;
}

/**
 * @param {Document} doc
 * @param {string} label
 * @param {string} title
 */
function makeBtn(doc, label, title) {
  const btn = doc.createElement('button');
  btn.type = 'button';
  btn.className = 'dev-reset-btn';
  btn.textContent = label;
  btn.title = title;
  return btn;
}
