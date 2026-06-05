import { t } from '../i18n.js';
import {
  parseFilterString,
  filterToCategory,
} from '../flags/findFlag.js';
import { todayN } from '../flags/daily.js';

/** @typedef {import('../flags/daily.js').DailyPuzzle} DailyPuzzle */

export function bootArchive() {
  const listEl = /** @type {HTMLElement} */ (document.getElementById('archive-list'));

  fetch('./daily_puzzles.json')
    .then((r) => r.json())
    .then((/** @type {DailyPuzzle[]} */ catalog) => {
      // The catalog only contains released puzzles, so we render every
      // entry. The newest (last) is "today's" puzzle — highlighted.
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
        listEl.appendChild(renderEntry(entry, isToday));
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
function renderEntry(entry, isToday) {
  const li = document.createElement('li');
  li.className = 'archive-entry archive-entry--past';
  if (isToday) li.classList.add('archive-entry--today');

  const nBadge = document.createElement('span');
  nBadge.className = 'archive-n';
  nBadge.textContent = `#${entry.n}`;
  li.appendChild(nBadge);

  const body = document.createElement('div');
  body.className = 'archive-body';

  const title = document.createElement('span');
  title.className = 'archive-title-line';
  const filter = parseFilterString(entry.filter);
  title.textContent = filter ? filterToCategory(filter, t).label : entry.filter;
  body.appendChild(title);

  const meta = document.createElement('div');
  meta.className = 'archive-meta';
  meta.textContent = t('daily.archiveCount', '{n} flags').replace('{n}', String(entry.answers.length));
  body.appendChild(meta);

  li.appendChild(body);

  const link = document.createElement('a');
  link.href = `./?n=${entry.n}`;
  link.className = 'archive-link';
  link.setAttribute('aria-label', `Daily #${entry.n}`);
  li.appendChild(link);

  return li;
}
