import { t } from '../i18n.js';
import { parseFilterString, filterTitle } from '../flags/findFlag.js';
import { puzzleDate, formatPuzzleDate } from '../flags/daily.js';
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
 * `difficulty` is an author-only signal surfaced on the backlog + ideas
 * preview grids — never on the live archive — so it shares the
 * bottom-strip slot with the play score (the two never coexist by
 * design, but `score` wins if both are accidentally passed).
 *
 * @param {DailyPuzzle} entry
 * @param {{
 *   href: string,
 *   ariaPrefix: string,
 *   isToday?: boolean,
 *   score?: DailyScore,
 *   difficulty?: number,
 * }} opts
 * @param {Document} [doc]  injectable for tests; defaults to the page document.
 */
export function renderArchiveSquare(entry, opts, doc = document) {
  const { href, ariaPrefix, isToday = false, score, difficulty } = opts;

  const li = doc.createElement('li');
  li.className = 'archive-square';
  if (isToday) li.classList.add('archive-square--today');

  const link = doc.createElement('a');
  link.href = href;
  link.className = 'archive-square-link';

  const parsed = parseFilterString(entry.filter);
  const criteriaLabel = parsed ? filterTitle(parsed, t) : entry.filter;
  link.setAttribute('aria-label', `${ariaPrefix} #${entry.n} — ${criteriaLabel}`);
  // Stash the inputs `refreshSquareCriteria` needs to re-translate this
  // link's criteria label + aria-label on a soft language switch. Both
  // are read by the walker; the filter is re-parsed each time so the
  // current-language `filterTitle(parsed, t)` lands cleanly.
  link.dataset.filter = entry.filter;
  link.dataset.ariaPrefix = ariaPrefix;
  link.dataset.n = String(entry.n);

  const dateEl = doc.createElement('span');
  dateEl.className = 'archive-square-date';
  dateEl.textContent = formatPuzzleDate(puzzleDate(entry.n));
  link.appendChild(dateEl);

  const numEl = doc.createElement('span');
  numEl.className = 'archive-square-num';
  numEl.textContent = String(entry.n);
  link.appendChild(numEl);

  const scoreText = formatScore(score);
  if (scoreText !== null && score) {
    const scoreEl = doc.createElement('span');
    scoreEl.className = 'archive-square-score';
    scoreEl.textContent = scoreText;
    scoreEl.style.color = scoreColor(score.f / score.t);
    link.appendChild(scoreEl);
  } else if (typeof difficulty === 'number' && Number.isFinite(difficulty)) {
    const diffEl = doc.createElement('span');
    diffEl.className = 'archive-square-difficulty';
    // Round to the nearest 0.5 so the badge reads as a bucket (1.0 / 1.5 /
    // 2.0…) rather than implying precision the formula doesn't claim.
    diffEl.textContent = (Math.round(difficulty * 2) / 2).toFixed(1);
    link.appendChild(diffEl);
  }

  const criteriaEl = doc.createElement('span');
  criteriaEl.className = 'archive-square-criteria';
  criteriaEl.textContent = criteriaLabel;
  link.appendChild(criteriaEl);

  li.appendChild(link);
  return li;
}

/**
 * Re-translate every archive square currently in `doc` against the
 * active language. Walks every `.archive-square-link` that was
 * rendered via `renderArchiveSquare` (identified by the `data-filter`
 * data attribute) and re-applies `filterTitle(parsed, t)` to both the
 * hover overlay (`.archive-square-criteria`) and the link's
 * `aria-label`. Squares whose filter doesn't parse fall back to the
 * raw filter string, same as initial render.
 *
 * Soft language switch contract — `daily/archive.js`,
 * `daily/backlog/page.js`, `daily/ideas/page.js` each call this from
 * a `langchanged` listener. Without it, the criteria text + aria
 * label stay frozen in the page's boot-time language.
 *
 * @param {Document} [doc]
 */
export function refreshSquareCriteria(doc = document) {
  const links = /** @type {NodeListOf<HTMLAnchorElement>} */ (
    doc.querySelectorAll('.archive-square-link[data-filter]')
  );
  for (const link of links) {
    const filter = link.dataset.filter ?? '';
    const ariaPrefix = link.dataset.ariaPrefix ?? '';
    const n = link.dataset.n ?? '';
    const parsed = parseFilterString(filter);
    const criteriaLabel = parsed ? filterTitle(parsed, t) : filter;
    link.setAttribute('aria-label', `${ariaPrefix} #${n} — ${criteriaLabel}`);
    const criteriaEl = link.querySelector('.archive-square-criteria');
    if (criteriaEl) criteriaEl.textContent = criteriaLabel;
  }
}
