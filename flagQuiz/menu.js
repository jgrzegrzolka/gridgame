import { t } from '../i18n.js';

/**
 * Build the burger-menu contents for the flagQuiz feature.
 *
 * Same DOM goes on the main quiz page and on the stats sub-page so the
 * menu doesn't morph as the user navigates within the feature. The
 * caller passes:
 *
 *   - `relativeBase`: '' for the quiz page (stats link is `stats/`);
 *     '../' for the stats sub-page (stats link is `./`).
 *   - `statsCurrent`: true on the stats page. Marks the "Your stats"
 *     link with aria-current="page".
 *
 * **What this menu deliberately no longer holds.** It used to open with a
 * row of deck pills and, under them, the current deck's continent list —
 * two of the four places the same two questions ("which flags?", "how
 * long?") could be answered from. The round-settings pill on the play row
 * now owns both, in one place, without a page load and without throwing
 * away the round in progress. Duplicating them here would put the pill's
 * answer and the burger's answer in two places that can disagree, and
 * would keep the navigate-and-restart path alive next to the in-place one.
 *
 * What's left is what the pill genuinely doesn't cover: who you are, your
 * history, and the coffee link.
 *
 * The map's show/hide is driven entirely by the toggle chip on the map
 * itself (present as a "show" chip even on the collapsed strip), so the
 * burger menu carries no map toggle either.
 *
 * @param {HTMLUListElement} menuEl
 * @param {{ relativeBase: string, statsCurrent: boolean }} opts
 */
export function buildQuizMenu(menuEl, opts) {
  const { relativeBase, statsCurrent } = opts;

  const statsLi = document.createElement('li');
  statsLi.className = 'menu-divider';
  const statsA = document.createElement('a');
  statsA.href = statsCurrent ? './' : `${relativeBase}stats/`;
  statsA.textContent = t('menu.yourStats', 'Your stats');
  if (statsCurrent) statsA.setAttribute('aria-current', 'page');
  statsLi.appendChild(statsA);
  menuEl.appendChild(statsLi);

  const coffeeLi = document.createElement('li');
  coffeeLi.className = 'menu-divider';
  const coffeeA = document.createElement('a');
  coffeeA.className = 'menu-coffee';
  coffeeA.href = 'https://suppi.pl/jgrzegrzolka';
  coffeeA.target = '_blank';
  coffeeA.rel = 'noopener noreferrer';
  coffeeA.textContent = t('menu.coffee', 'Buy me a coffee');
  coffeeLi.appendChild(coffeeA);
  menuEl.appendChild(coffeeLi);
}
