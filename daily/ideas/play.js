import { flagsGamePool, loadCountries } from '../../flags/group.js';
import { parseFilterString, filterToCategory } from '../../flags/findFlag.js';
import { matchesFilters } from '../../flags/flagsFilter.js';
import { t, withLocalizedAliases } from '../../i18n.js';
import {
  wireZoom,
  showState,
  reasonMessage,
  startGame,
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
        showState(reasonMessage('not-found'));
        document.addEventListener('langchanged', () => {
          showState(reasonMessage('not-found'));
        });
        return;
      }
      const filter = parseFilterString(idea.filter);
      if (!filter) {
        showState(reasonMessage('invalid-filter'));
        document.addEventListener('langchanged', () => {
          showState(reasonMessage('invalid-filter'));
        });
        return;
      }
      const targets = all.filter((c) => matchesFilters(c, filter));
      if (targets.length === 0) {
        showState(reasonMessage('no-targets'));
        document.addEventListener('langchanged', () => {
          showState(reasonMessage('no-targets'));
        });
        return;
      }

      const category = filterToCategory(filter, t);
      const game = startGame(k, category, targets, all, { skipSave: true });

      document.addEventListener('langchanged', () => {
        // Ideas have no description; nothing extra to repaint.
        const newAll = withLocalizedAliases(flagsGamePool(raw, false));
        const targetCodeSet = new Set(targets.map((c) => c.code));
        const newTargets = newAll.filter((c) => targetCodeSet.has(c.code));
        const newLabel = filterToCategory(filter, t).label;
        game.refreshI18n({ all: newAll, targets: newTargets, label: newLabel });
      });
    })
    .catch((err) => {
      showState(`${t('game.failedToLoad', 'Failed to load:')} ${err.message}`);
    });
}
