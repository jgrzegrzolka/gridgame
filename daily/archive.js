import { t } from '../i18n.js';
import { todayN } from '../flags/daily.js';
import { loadScores } from './scores.js';
import { renderArchiveSquare } from './squares.js';

/** @typedef {import('../flags/daily.js').DailyPuzzle} DailyPuzzle */

export function bootArchive() {
  const listEl = /** @type {HTMLElement} */ (document.getElementById('archive-list'));
  const scores = loadScores(window.localStorage);

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
        listEl.appendChild(renderArchiveSquare(entry, {
          href: `./?n=${entry.n}`,
          ariaPrefix: 'Daily',
          isToday: entry.n === today,
          score: scores[entry.n],
        }));
      }
    })
    .catch((err) => {
      listEl.textContent = `${t('game.failedToLoad', 'Failed to load:')} ${err.message}`;
    });
}
