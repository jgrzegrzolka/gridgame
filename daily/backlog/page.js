import { t } from '../../i18n.js';
import { renderArchiveSquare } from '../squares.js';

/** @typedef {import('../../flags/daily.js').DailyPuzzle} DailyPuzzle */

/**
 * Render the staged backlog as a grid of preview cards. Hidden page —
 * only reachable by typing /daily/backlog/ directly. Each card links to
 * the sibling `play.html` so the author can play-test a puzzle before
 * it lands in the live catalog. No scoring (backlog plays don't
 * persist), no "today" highlight (none of these are released).
 *
 * Why a folder (not a flat `backlog.html`): keeps every author-only
 * file in one place so `deploy.yml` can strip `daily/backlog/` whole
 * and the live `daily/page.js` carries no author-only code paths.
 */
export function bootBacklog() {
  const listEl = /** @type {HTMLElement} */ (document.getElementById('backlog-list'));

  fetch('../daily_backlog.json')
    .then((r) => r.json())
    .then((/** @type {DailyPuzzle[]} */ backlog) => {
      if (backlog.length === 0) {
        const empty = document.createElement('li');
        empty.className = 'archive-empty';
        empty.textContent = 'Backlog is empty.';
        listEl.appendChild(empty);
        return;
      }
      for (const entry of backlog) {
        listEl.appendChild(renderArchiveSquare(entry, {
          href: `./play.html?n=${entry.n}`,
          ariaPrefix: 'Backlog',
        }));
      }
    })
    .catch((err) => {
      listEl.textContent = `${t('game.failedToLoad', 'Failed to load:')} ${err.message}`;
    });
}
