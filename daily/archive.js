import { t } from '../i18n.js';
import { todayN } from '../flags/daily.js';

/** @typedef {import('../flags/daily.js').DailyPuzzle} DailyPuzzle */

export function bootArchive() {
  const listEl = /** @type {HTMLElement} */ (document.getElementById('archive-list'));

  fetch('./daily_puzzles.json')
    .then((r) => r.json())
    .then((/** @type {DailyPuzzle[]} */ catalog) => {
      const today = todayN(catalog);
      if (today === 0) {
        const empty = document.createElement('li');
        empty.className = 'archive-empty';
        empty.textContent = t('daily.empty', 'No puzzles yet.');
        listEl.appendChild(empty);
        return;
      }
      for (const entry of catalog) {
        const isToday = entry.n === today;
        listEl.appendChild(renderSquare(entry, isToday));
      }
    })
    .catch((err) => {
      listEl.textContent = `${t('game.failedToLoad', 'Failed to load:')} ${err.message}`;
    });
}

/**
 * @param {DailyPuzzle} entry
 * @param {boolean} isToday
 */
function renderSquare(entry, isToday) {
  const li = document.createElement('li');
  li.className = 'archive-square';
  if (isToday) li.classList.add('archive-square--today');

  const link = document.createElement('a');
  link.href = `./?n=${entry.n}`;
  link.className = 'archive-square-link';
  link.setAttribute('aria-label', `Daily #${entry.n}`);
  link.textContent = String(entry.n);
  li.appendChild(link);

  return li;
}
