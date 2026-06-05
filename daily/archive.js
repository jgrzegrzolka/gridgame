import { t } from '../i18n.js';
import {
  parseFilterString,
  filterToCategory,
} from '../flags/findFlag.js';
import {
  LAUNCH_UTC,
  dayNumberFor,
} from '../flags/daily.js';

/** @typedef {import('../flags/daily.js').DailyPuzzle} DailyPuzzle */

const DAY_MS = 86_400_000;

export function bootArchive() {
  const listEl = /** @type {HTMLElement} */ (document.getElementById('archive-list'));
  const todayN = dayNumberFor(Date.now());

  fetch('./daily_puzzles.json')
    .then((r) => r.json())
    .then((/** @type {DailyPuzzle[]} */ catalog) => {
      // Render every puzzle in the catalog, oldest first. Past puzzles
      // (n <= todayN) get a clickable link; future puzzles render as a
      // greyed-out preview so the player knows what's coming.
      for (const entry of catalog) {
        listEl.appendChild(renderEntry(entry, todayN));
      }
    })
    .catch((err) => {
      listEl.textContent = `${t('game.failedToLoad', 'Failed to load:')} ${err.message}`;
    });
}

/**
 * @param {DailyPuzzle} entry
 * @param {number} todayN
 */
function renderEntry(entry, todayN) {
  const li = document.createElement('li');
  li.className = 'archive-entry';

  const isPast = entry.n <= todayN;
  const isToday = entry.n === todayN;

  const dateMs = LAUNCH_UTC + (entry.n - 1) * DAY_MS;
  const dateStr = isoDate(dateMs);

  const nBadge = document.createElement('span');
  nBadge.className = 'archive-n';
  nBadge.textContent = `#${entry.n}`;
  li.appendChild(nBadge);

  const body = document.createElement('div');
  body.className = 'archive-body';

  const top = document.createElement('div');
  top.className = 'archive-row';
  const title = document.createElement('span');
  title.className = 'archive-title-line';
  const filter = parseFilterString(entry.filter);
  title.textContent = filter ? filterToCategory(filter, t).label : entry.filter;
  const date = document.createElement('span');
  date.className = 'archive-date';
  date.textContent = dateStr;
  top.appendChild(title);
  top.appendChild(date);
  body.appendChild(top);

  const meta = document.createElement('div');
  meta.className = 'archive-meta';
  meta.textContent = t('daily.archiveCount', '{n} flags').replace('{n}', String(entry.answers.length));
  body.appendChild(meta);

  li.appendChild(body);

  if (isPast) {
    li.classList.add('archive-entry--past');
    if (isToday) li.classList.add('archive-entry--today');
    const link = document.createElement('a');
    link.href = `./?n=${entry.n}`;
    link.className = 'archive-link';
    link.setAttribute('aria-label', `Daily #${entry.n}`);
    li.appendChild(link);
  } else {
    li.classList.add('archive-entry--future');
  }

  return li;
}

/** @param {number} ms */
function isoDate(ms) {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
