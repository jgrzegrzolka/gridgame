import { t } from '../i18n.js';
import { todayN } from '../flags/daily.js';
import { scoreColor } from '../flags/quiz.js';
import { parseFilterString, filterTitle } from '../flags/findFlag.js';
import { loadScores, formatScore } from './scores.js';

/** @typedef {import('../flags/daily.js').DailyPuzzle} DailyPuzzle */
/** @typedef {import('./scores.js').DailyScores} DailyScores */

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
        const isToday = entry.n === today;
        listEl.appendChild(renderSquare(entry, isToday, scores));
      }
    })
    .catch((err) => {
      listEl.textContent = `${t('game.failedToLoad', 'Failed to load:')} ${err.message}`;
    });
}

/**
 * @param {DailyPuzzle} entry
 * @param {boolean} isToday
 * @param {DailyScores} scores
 */
function renderSquare(entry, isToday, scores) {
  const li = document.createElement('li');
  li.className = 'archive-square';
  if (isToday) li.classList.add('archive-square--today');

  const link = document.createElement('a');
  link.href = `./?n=${entry.n}`;
  link.className = 'archive-square-link';

  const parsed = parseFilterString(entry.filter);
  const criteriaLabel = parsed ? filterTitle(parsed, t) : entry.filter;
  link.setAttribute('aria-label', `Daily #${entry.n} — ${criteriaLabel}`);

  const numEl = document.createElement('span');
  numEl.className = 'archive-square-num';
  numEl.textContent = String(entry.n);
  link.appendChild(numEl);

  const score = scores[entry.n];
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
