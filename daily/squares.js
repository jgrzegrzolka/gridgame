import { t } from '../i18n.js';
import { parseFilterString, filterTitle } from '../flags/findFlag.js';
import { puzzleDate, formatPuzzleDate } from '../flags/daily.js';

/**
 * Resolve a square's criteria label. Filter entries: parse the stored
 * filter and render the pill chain via `filterTitle`. Manual entries:
 * read `title[currentLang]` (the hand-written per-language label).
 * Falls back to `title.en` for missing translations and to an empty
 * string for malformed input (the catalog tests forbid both, this is
 * defence in depth so a broken entry doesn't crash the archive grid).
 *
 * @param {{ kind?: string, filter?: string, title?: Record<string, string> }} entry
 * @returns {string}
 */
function criteriaLabelFor(entry) {
  if (entry.kind === 'manual') {
    const lang = typeof document !== 'undefined' ? (document.documentElement.lang || 'en') : 'en';
    return entry.title?.[lang] ?? entry.title?.en ?? '';
  }
  const parsed = parseFilterString(entry.filter ?? '');
  return parsed ? filterTitle(parsed, t) : (entry.filter ?? '');
}
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

  const criteriaLabel = criteriaLabelFor(entry);
  link.setAttribute('aria-label', `${ariaPrefix} #${entry.n} — ${criteriaLabel}`);
  // Stash the inputs `refreshSquareCriteria` needs to re-translate this
  // link's criteria label + aria-label on a soft language switch. Filter
  // entries store the filter string and re-parse each time; manual
  // entries store the JSON-encoded title map and look up the active
  // language each time. Mutually exclusive — the walker picks the path
  // by which attribute is present.
  if (entry.kind === 'manual') {
    link.dataset.title = JSON.stringify(entry.title ?? {});
  } else {
    link.dataset.filter = entry.filter ?? '';
  }
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
    doc.querySelectorAll('.archive-square-link[data-filter], .archive-square-link[data-title]')
  );
  const lang = doc.documentElement.lang || 'en';
  for (const link of links) {
    const ariaPrefix = link.dataset.ariaPrefix ?? '';
    const n = link.dataset.n ?? '';
    /** @type {string} */
    let criteriaLabel;
    if (link.dataset.title !== undefined) {
      // Manual entry — look up entry.title[lang] from the JSON-encoded
      // map on every refresh so a soft language switch picks up the
      // right translation without re-rendering the whole grid.
      try {
        const titles = /** @type {Record<string, string>} */ (JSON.parse(link.dataset.title));
        criteriaLabel = titles[lang] ?? titles.en ?? '';
      } catch {
        criteriaLabel = '';
      }
    } else {
      const filter = link.dataset.filter ?? '';
      const parsed = parseFilterString(filter);
      criteriaLabel = parsed ? filterTitle(parsed, t) : filter;
    }
    link.setAttribute('aria-label', `${ariaPrefix} #${n} — ${criteriaLabel}`);
    const criteriaEl = link.querySelector('.archive-square-criteria');
    if (criteriaEl) criteriaEl.textContent = criteriaLabel;
  }
}
