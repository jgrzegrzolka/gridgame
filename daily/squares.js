import { t } from '../i18n.js';
import { parseFilterString, filterTitle } from '../flags/findFlag.js';
import { scoreColor } from '../flags/quiz.js';
import { formatScore } from './scores.js';

/** @typedef {import('../flags/daily.js').DailyPuzzle} DailyPuzzle */
/** @typedef {import('./scores.js').DailyScore} DailyScore */

/**
 * Numbered square card shared by the archive grid (released puzzles —
 * link to play, optional score badge, optional today highlight) and the
 * backlog preview grid (staged puzzles — link to play in preview mode,
 * no score). Keeping the render in one place means hover overlay,
 * dimensions, and the "today" frame stay aligned across both pages.
 *
 * @param {DailyPuzzle} entry
 * @param {{
 *   href: string,
 *   ariaPrefix: string,
 *   isToday?: boolean,
 *   score?: DailyScore,
 * }} opts
 */
export function renderArchiveSquare(entry, opts) {
  const { href, ariaPrefix, isToday = false, score } = opts;

  const li = document.createElement('li');
  li.className = 'archive-square';
  if (isToday) li.classList.add('archive-square--today');

  const link = document.createElement('a');
  link.href = href;
  link.className = 'archive-square-link';

  const parsed = parseFilterString(entry.filter);
  const criteriaLabel = parsed ? filterTitle(parsed, t) : entry.filter;
  link.setAttribute('aria-label', `${ariaPrefix} #${entry.n} — ${criteriaLabel}`);

  const numEl = document.createElement('span');
  numEl.className = 'archive-square-num';
  numEl.textContent = String(entry.n);
  link.appendChild(numEl);

  const scoreText = formatScore(score);
  if (scoreText !== null && score) {
    const scoreEl = document.createElement('span');
    scoreEl.className = 'archive-square-score';
    scoreEl.textContent = scoreText;
    scoreEl.style.color = scoreColor(score.f / score.t);
    link.appendChild(scoreEl);
  }

  const criteriaEl = document.createElement('span');
  criteriaEl.className = 'archive-square-criteria';
  criteriaEl.textContent = criteriaLabel;
  link.appendChild(criteriaEl);

  li.appendChild(link);
  return li;
}
