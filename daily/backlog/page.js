import { t } from '../../i18n.js';
import { renderArchiveSquare, refreshSquareCriteria } from '../squares.js';
import { scoreEntry } from '../difficulty.js';
import { fetchCatalog } from '../catalogSource.js';
import { warsawToday } from '../../flags/warsawTime.js';

/** @typedef {import('../../flags/daily.js').DailyPuzzle} DailyPuzzle */
/** @typedef {import('../../flags/group.js').Country} Country */

/**
 * Render the staged backlog as a grid of preview cards. Hidden page —
 * only reachable by typing /daily/backlog/ directly. Each card links to
 * the sibling `play.html` so the author can play-test a puzzle before
 * it lands in the live catalog. No play score (backlog plays don't
 * persist), no "today" highlight (none of these are released) — but
 * each tile shows the computed difficulty so the author can eyeball
 * whether the ordering still makes sense.
 *
 * Why a folder (not a flat `backlog.html`): keeps every author-only
 * file in one place so `deploy.yml` can strip `daily/backlog/` whole
 * and the live `daily/page.js` carries no author-only code paths.
 */
export function bootBacklog() {
  const listEl = /** @type {HTMLElement} */ (document.getElementById('backlog-list'));

  Promise.all([
    fetchCatalog('puzzles'),
    fetch('../../flags/countries.json').then((r) => r.json()),
  ])
    .then(([/** @type {DailyPuzzle[]} */ allEntries, /** @type {Country[]} */ countries]) => {
      // Preview only future-dated entries — that's "what's coming next."
      // Released entries belong on the archive page, not here.
      const today = warsawToday();
      const backlog = allEntries.filter((p) => /** @type {any} */ (p).date > today);
      if (backlog.length === 0) {
        const empty = document.createElement('li');
        empty.className = 'archive-empty';
        // Author-only page — leaving the message hard-coded in English
        // is the established convention here (no `t()` call previously).
        empty.textContent = 'Backlog is empty.';
        listEl.appendChild(empty);
        return;
      }
      /** @type {Map<string, Country>} */
      const byCode = new Map();
      for (const c of countries) byCode.set(c.code, c);
      for (const entry of backlog) {
        const { score } = scoreEntry(entry, byCode);
        listEl.appendChild(renderArchiveSquare(entry, {
          href: `./play.html?n=${entry.n}`,
          ariaPrefix: 'Backlog',
          difficulty: score,
        }));
      }
      document.addEventListener('langchanged', () => refreshSquareCriteria());
    })
    .catch((err) => {
      listEl.textContent = `${t('game.failedToLoad', 'Failed to load:')} ${err.message}`;
    });
}
