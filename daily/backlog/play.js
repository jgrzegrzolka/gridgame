import { loadCountries } from '../../flags/group.js';
import { buildAnswerPool } from '../answerPool.js';
import { filterToCategory } from '../../flags/findFlag.js';
import { t } from '../../i18n.js';
import { findPuzzle, resolvePuzzleEntry, manualToCategory, superlativeToCategory } from '../../flags/daily.js';
import { buildPopulationRankNotes, buildSuperlativeTileMeta } from '../../flags/populationRank.js';
import {
  wireZoom,
  showState,
  paintDescription,
  startGame,
  attachLangRefresh,
  showReason,
  setZoomNotes,
  setTileMeta,
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
      // Same answer pool as live (page.js) so a manual roster with a
      // non-sovereign flag (England in the World Cup puzzle) previews here
      // exactly as it plays — otherwise gb-eng drops out of the targets.
      const all = buildAnswerPool(raw, catalog);

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

      paintDescription(result.entry.description, result.entry.additionalDescription);
      // Preview this entry's zoom notes too, so an author play-testing a
      // staged puzzle sees the explanations exactly as a player will.
      setZoomNotes(result.entry.notes);
      setTileMeta(null);

      // Mirror daily/page.js: for a population superlative, the one metric
      // fetch feeds both result-screen enrichments so the backlog preview
      // renders identically to live — whole-pool population + world-rank zoom
      // captions (so even "Most missed" distractors read "#15 in the world")
      // and the per-tile rank + population overlay on the Found / Missed grids.
      // Best-effort: the play-through finishes long after this resolves, so it
      // never needs awaiting here.
      if (result.entry.kind === 'superlative' && result.entry.metric === 'population') {
        fetch('../../flags/metrics/population.json')
          .then((r) => r.json())
          .then((d) => {
            const values = d.values ?? {};
            setZoomNotes(buildPopulationRankNotes(all, values));
            setTileMeta(buildSuperlativeTileMeta(result.entry, values));
          })
          .catch(() => {});
      }
      // Same kind-aware branch as daily/page.js — backlog plays the
      // same shape as live, so manual entries staged in the backlog
      // need to render with their `entry.title` label here too.
      const catFor = () => {
        const lang = document.documentElement.lang || 'en';
        if (result.entry.kind === 'manual') return manualToCategory(result.entry, lang);
        if (result.entry.kind === 'superlative') return superlativeToCategory(result.entry, lang);
        return filterToCategory(/** @type {import('../../flags/flagsFilter.js').Filters} */ (result.filter), t);
      };
      const labelFor = () => catFor().label;
      const category = catFor();
      const game = startGame(n, category, result.targets, all, { skipSave: true });
      attachLangRefresh(game, {
        raw,
        targets: result.targets,
        labelFor,
        description: result.entry.description,
        additionalDescription: result.entry.additionalDescription,
      });
    })
    .catch((err) => {
      showState(`${t('game.failedToLoad', 'Failed to load:')} ${err.message}`);
    });
}
