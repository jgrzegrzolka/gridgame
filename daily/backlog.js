import { t } from '../i18n.js';
import { renderArchiveSquare } from './squares.js';

/** @typedef {import('../flags/daily.js').DailyPuzzle} DailyPuzzle */

/**
 * Render the staged backlog as a grid of preview cards. Hidden page —
 * only reachable by typing /daily/backlog.html directly. Each card
 * links to the live daily page in backlog mode (`?backlog=N`) so the
 * author can play-test a puzzle before moving it into the live
 * catalog. No scoring (backlog plays don't persist), no "today"
 * highlight (none of these are released).
 */
export function bootBacklog() {
  const listEl = /** @type {HTMLElement} */ (document.getElementById('backlog-list'));

  fetch('./daily_backlog.json')
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
          href: `./?backlog=${entry.n}`,
          ariaPrefix: 'Backlog',
        }));
      }
    })
    .catch((err) => {
      listEl.textContent = `${t('game.failedToLoad', 'Failed to load:')} ${err.message}`;
    });
}
