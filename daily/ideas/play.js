import { flagsGamePool, loadCountries } from '../../flags/group.js';
import { parseFilterString, filterToCategory } from '../../flags/findFlag.js';
import { matchesFilters } from '../../flags/flagsFilter.js';
import { t, withLocalizedAliases } from '../../i18n.js';
import {
  wireZoom,
  showState,
  startGame,
  attachLangRefresh,
  showReason,
} from '../playFlow.js';

/**
 * @typedef {Object} Idea
 * @property {string} filter
 * @property {string} [notes]
 * @property {number} [parkUntilN]
 */

/**
 * Play-test a single brainstorm idea. URL: `./play.html?k=K`, where K
 * is the 1-based position of the idea in `daily/daily_ideas.json`.
 * Author-only — never reachable from player-facing nav, and the whole
 * `daily/ideas/` folder is stripped by `deploy.yml` before the live
 * site builds. Plays via the same `playFlow.startGame` the live page
 * uses, with `skipSave: true` so the test run can't pollute the
 * player's archive.
 *
 * Targets are resolved LIVE from the filter every time (vs. backlog
 * play, which uses frozen `entry.answers`). Ideas haven't been
 * promoted yet, so there are no frozen answers to honour — running
 * the filter against the current country pool is the right behaviour.
 * If you want a frozen play, promote the idea to the backlog first.
 *
 * Resolver is inlined (`parseFilterString` + `matchesFilters` filter)
 * rather than added as a new export on `flags/daily.js` — keeping the
 * author tool zero-touch on production code, so a bug here can't
 * change anything that live `daily/page.js` sees.
 */
export function bootIdeasPlay() {
  wireZoom();

  const numEl = /** @type {HTMLElement} */ (document.getElementById('daily-n'));

  const kParam = new URLSearchParams(window.location.search).get('k');
  const k = kParam !== null ? parseInt(kParam, 10) : NaN;
  if (!Number.isFinite(k)) {
    showState(reasonMessage('not-found'));
    return Promise.resolve();
  }

  numEl.textContent = `${k} · idea`;
  document.title = `Yet Another Quiz #${k}`;

  const playAgainLink = document.getElementById('play-again');
  if (playAgainLink) playAgainLink.setAttribute('href', `./play.html?k=${k}`);

  return Promise.all([
    fetch('../../flags/countries.json').then((r) => r.json()).then(loadCountries),
    fetch('../daily_ideas.json').then((r) => r.json()),
  ])
    .then(([raw, /** @type {Idea[]} */ ideas]) => {
      const all = withLocalizedAliases(flagsGamePool(raw, false));

      const idea = ideas[k - 1];
      if (!idea) {
        showReason('not-found');
        return;
      }
      const filter = parseFilterString(idea.filter);
      if (!filter) {
        showReason('invalid-filter');
        return;
      }
      const targets = all.filter((c) => matchesFilters(c, filter));
      if (targets.length === 0) {
        showReason('no-targets');
        return;
      }

      const category = filterToCategory(filter, t);
      const game = startGame(k, category, targets, all, { skipSave: true });
      // Ideas have no description; omit it from the deps so the
      // helper skips the paintDescription branch on each langchange.
      // Ideas are filter-only (no manual variant — the funnel for
      // manual entries is backlog or parked, never ideas).
      attachLangRefresh(game, {
        raw,
        targets,
        labelFor: () => filterToCategory(filter, t).label,
      });
    })
    .catch((err) => {
      showState(`${t('game.failedToLoad', 'Failed to load:')} ${err.message}`);
    });
}
