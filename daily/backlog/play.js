import { flagsGamePool, loadCountries } from '../../flags/group.js';
import { filterToCategory } from '../../flags/findFlag.js';
import { t, withLocalizedAliases } from '../../i18n.js';
import { findPuzzle, resolvePuzzleEntry, manualToCategory } from '../../flags/daily.js';
import {
  wireZoom,
  showState,
  paintDescription,
  startGame,
  attachLangRefresh,
  showReason,
  setZoomNotes,
} from '../playFlow.js';
import { fetchCatalog } from '../catalogSource.js';

/** @typedef {import('../../flags/daily.js').DailyPuzzle} DailyPuzzle */

/**
 * Play-test a single puzzle by its `n`. URL: `./play.html?n=N`.
 * Reads the full `puzzles.json` so any entry — past, today, or future
 * — is playable for review.
 *
 * Author-only — never reachable from player-facing nav, and the whole
 * `daily/backlog/` folder is stripped by `deploy.yml` before the live
 * site builds. Plays the puzzle through the same `playFlow.startGame`
 * the live `daily/page.js` uses, but with `skipSave: true` so the test
 * run can't pollute the player's archive.
 */
export function bootBacklogPlay() {
  wireZoom();

  const numEl = /** @type {HTMLElement} */ (document.getElementById('daily-n'));

  const nParam = new URLSearchParams(window.location.search).get('n');
  const n = nParam !== null ? parseInt(nParam, 10) : NaN;
  if (!Number.isFinite(n)) {
    showState(reasonMessage('not-found'));
    return Promise.resolve();
  }

  numEl.textContent = `${n} · backlog`;
  // Tab title carries the puzzle number so multiple `?n=N` tabs are
  // tellable apart at a glance during catalog review.
  document.title = `Yet Another Quiz #${n}`;

  const playAgainLink = document.getElementById('play-again');
  if (playAgainLink) playAgainLink.setAttribute('href', `./play.html?n=${n}`);

  return Promise.all([
    fetch('../../flags/countries.json').then((r) => r.json()).then(loadCountries),
    fetchCatalog('puzzles'),
  ])
    .then(([raw, /** @type {DailyPuzzle[]} */ catalog]) => {
      const all = withLocalizedAliases(flagsGamePool(raw, false));

      const entry = findPuzzle(catalog, n);
      if (!entry) {
        showReason('not-found');
        return;
      }
      const result = resolvePuzzleEntry(entry, all);
      if (result.ok === false) {
        showReason(result.reason);
        return;
      }

      paintDescription(result.entry.description);
      // Preview this entry's zoom notes too, so an author play-testing a
      // staged puzzle sees the explanations exactly as a player will.
      setZoomNotes(result.entry.notes);
      // Same kind-aware branch as daily/page.js — backlog plays the
      // same shape as live, so manual entries staged in the backlog
      // need to render with their `entry.title` label here too.
      const labelFor = result.entry.kind === 'manual'
        ? () => manualToCategory(result.entry, document.documentElement.lang || 'en').label
        : () => filterToCategory(/** @type {import('../../flags/flagsFilter.js').Filters} */ (result.filter), t).label;
      const category = result.entry.kind === 'manual'
        ? manualToCategory(result.entry, document.documentElement.lang || 'en')
        : filterToCategory(/** @type {import('../../flags/flagsFilter.js').Filters} */ (result.filter), t);
      const game = startGame(n, category, result.targets, all, { skipSave: true });
      attachLangRefresh(game, {
        raw,
        targets: result.targets,
        labelFor,
        description: result.entry.description,
      });
    })
    .catch((err) => {
      showState(`${t('game.failedToLoad', 'Failed to load:')} ${err.message}`);
    });
}
