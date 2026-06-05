import { t } from '../i18n.js';
import {
  parseFilterString,
  filterToCategory,
} from '../flags/findFlag.js';
import { dayNumberFor, launchDateIso } from '../flags/daily.js';

/** @typedef {import('../flags/daily.js').DailyPuzzle} DailyPuzzle */

export function bootArchive() {
  const listEl = /** @type {HTMLElement} */ (document.getElementById('archive-list'));
  const todayN = dayNumberFor(Date.now());

  fetch('./daily_puzzles.json')
    .then((r) => r.json())
    .then((/** @type {DailyPuzzle[]} */ catalog) => {
      // Only show released puzzles. The newest visible (highest n that
      // is <= todayN and within the catalog) is "today's". Future
      // entries from the prepared backlog stay hidden so the player
      // can't deep-link or see what's coming.
      const visibleMax = Math.min(catalog.length, Math.max(todayN, 0));

      if (visibleMax < 1) {
        const empty = document.createElement('li');
        empty.className = 'archive-empty';
        empty.textContent = t('daily.beforeLaunch', 'Daily #1 starts on {date}.')
          .replace('{date}', launchDateIso());
        listEl.appendChild(empty);
        return;
      }

      for (const entry of catalog) {
        if (entry.n > visibleMax) break;
        const isToday = entry.n === visibleMax;
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
