import { VARIANTS, poolFor, scoreColor } from '../../flags/quiz.js';
import { allDeckVariants } from '../../flags/decks.js';
import { t } from '../../i18n.js';
import { mountNicknameMenuItem } from '../../common.js';
import { buildQuizMenu } from '../menu.js';
import { roundQuery } from '../roundSettings.js';
import {
  coverageRow,
  sortCoverageRows,
  HEADLINE_MODE,
  SECONDARY_MODE,
} from '../statsView.js';

/**
 * Your records, as pool coverage.
 *
 * The page answers one question — *what should I practise?* — so it carries
 * one measure per row (the 60s record), sorts on it, and puts the worst at
 * the bottom where the answer belongs. See `statsView.js` for why that mode
 * and not the other.
 *
 * There is no "Play" button and no mode legend. The whole row is the target
 * and it starts that pool in 60s, so there is never a question about which
 * mode a tap means; the no-clock mode stays reachable from the settings pill
 * inside the game.
 *
 * The world sits above the list rather than in it: it is the pool the other
 * seven are slices of, so ranking it against them would be comparing a total
 * with its own parts.
 */
const HEADLINE_POOL = 'countries';

export function bootQuizStats() {
  const listEl = document.getElementById('pool-list');
  const headEl = document.getElementById('pool-head');
  const menuEl = /** @type {HTMLUListElement} */ (document.getElementById('quiz-menu'));

  const rebuildMenu = () => {
    menuEl.innerHTML = '';
    buildQuizMenu(menuEl, { relativeBase: '../', statsCurrent: true });
    // Re-inserted after every rebuild — `buildQuizMenu` wipes innerHTML
    // first, so an earlier mount would be lost on the first langchanged.
    mountNicknameMenuItem({ rootEl: menuEl, profileHref: '../../profile/' });
  };

  return fetch('../../flags/countries.json')
    .then((r) => r.json())
    .then((raw) => {
      rebuildMenu();
      render(raw);
      document.addEventListener('langchanged', () => {
        rebuildMenu();
        render(raw);
      });
    })
    .catch((err) => {
      document.body.textContent = `${t('game.failedToLoad', 'Failed to load:')} ${err.message}`;
    });

  /** @param {any[]} raw */
  function render(raw) {
    const rows = allDeckVariants()
      .filter((key) => VARIANTS[key])
      .map((key) => coverageRow(localStorage, {
        key,
        poolSize: poolFor(key, raw).length,
      }));

    const world = rows.find((r) => r.key === HEADLINE_POOL);
    headEl.innerHTML = '';
    if (world) headEl.appendChild(buildRow(world, { headline: true }));

    listEl.innerHTML = '';
    for (const row of sortCoverageRows(rows.filter((r) => r !== world))) {
      listEl.appendChild(buildRow(row, { headline: false }));
    }
  }

  /**
   * One pool: its name, its 60s record, a bar, and — only where it was
   * played — a quiet no-clock line. A row with no 60s record has no number
   * and no bar; tapping it still starts 60s, same as every other row.
   *
   * @param {ReturnType<typeof coverageRow>} row
   * @param {{ headline: boolean }} opts
   */
  function buildRow(row, opts) {
    const a = document.createElement('a');
    a.className = opts.headline ? 'pool-row pool-row-lead' : 'pool-row';
    // Stats lives at /flagQuiz/stats/, the quiz one level up.
    a.href = `..${roundQuery(row.key, HEADLINE_MODE)}`;
    if (!row.played) a.classList.add('is-untouched');

    const top = document.createElement('span');
    top.className = 'pool-row-top';

    const name = document.createElement('span');
    name.className = 'pool-name';
    name.textContent = t(`variant.${row.key}`, VARIANTS[row.key].label);
    top.appendChild(name);

    if (row.headline) {
      const score = document.createElement('span');
      score.className = 'pool-score';
      score.textContent = row.headline.label;
      score.style.color = scoreColor(row.headline.ratio);
      top.appendChild(score);
    }
    a.appendChild(top);

    if (row.headline) {
      const track = document.createElement('span');
      track.className = 'pool-bar';
      const fill = document.createElement('span');
      fill.className = 'pool-bar-fill';
      fill.style.width = `${row.headline.ratio * 100}%`;
      fill.style.background = scoreColor(row.headline.ratio);
      track.appendChild(fill);
      a.appendChild(track);
    }

    if (row.secondary) {
      const sub = document.createElement('span');
      sub.className = 'pool-sub';
      sub.textContent = `${t(`quiz.mode.${SECONDARY_MODE}`, SECONDARY_MODE)} ${row.secondary.label}`;
      a.appendChild(sub);
    }

    return a;
  }
}
