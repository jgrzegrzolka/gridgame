import { flagsGamePool, loadCountries } from '../flags/group.js';
import { filterToCategory } from '../flags/findFlag.js';
import { t, withLocalizedAliases } from '../i18n.js';
import { todayN, dailyNFromUrl, isReplayFromUrl, resolveDailyPuzzle } from '../flags/daily.js';
import { loadScores, isCompleteRecord } from './scores.js';
import {
  wireZoom,
  showState,
  paintDescription,
  reasonMessage,
  renderResult,
  startGame,
} from './playFlow.js';

/**
 * Live `/daily/` boot. Loads today's puzzle (or `?n=N` from the URL),
 * checks for a complete saved record (revisit → jump to result), and
 * otherwise hands off to the shared play flow.
 *
 * Author-only modes (backlog preview, ideas preview) used to live here
 * as `?backlog=N` / `?idea=K` branches. They've moved to their own pages
 * under `daily/backlog/` and `daily/ideas/`, each calling into the same
 * `playFlow.startGame`. Keeping this file player-only means a bug in
 * either author tool can't crash live daily.
 */
export function bootDaily() {
  wireZoom();

  const numEl = /** @type {HTMLElement} */ (document.getElementById('daily-n'));
  const isReplay = isReplayFromUrl(window.location.search);

  return Promise.all([
    fetch('../flags/countries.json').then((r) => r.json()).then(loadCountries),
    fetch('./daily_puzzles.json').then((r) => r.json()),
  ])
    .then(([raw, catalog]) => {
      const all = withLocalizedAliases(flagsGamePool(raw, false));

      const today = todayN(catalog);
      const n = dailyNFromUrl(window.location.search, today);
      numEl.textContent = `${n}`;
      // Tab title carries #N so archived puzzles open in separate tabs
      // read distinctly. Override runs after bootI18n's data-i18n pass.
      document.title = `Yet Another Quiz #${n}`;

      // Point the static "Play again" link at this same puzzle with the
      // replay flag set, so clicking it re-runs the game without
      // touching the archive score. Pinning N in the href (rather than
      // relying on "today") keeps the link stable if the catalog rolls
      // over while the result page is open.
      const playAgainLink = document.getElementById('play-again');
      if (playAgainLink) playAgainLink.setAttribute('href', `./?n=${n}&replay=1`);

      const result = resolveDailyPuzzle(catalog, all, n);
      if (result.ok === false) {
        const reason = result.reason;
        showState(reasonMessage(reason));
        // Stay reactive to soft language switches even on the error
        // branch — otherwise "Puzzle not found." would freeze in the
        // language it was rendered in.
        document.addEventListener('langchanged', () => {
          showState(reasonMessage(reason));
        });
        return;
      }

      paintDescription(result.entry.description);

      // Revisit: if this puzzle has a full saved record, jump straight
      // to the result page without confetti (the player saw confetti
      // the first time around; replaying it on every revisit would be
      // obnoxious). Replay mode skips this shortcut — the whole point
      // of ?replay=1 is to actually replay.
      const stored = loadScores(window.localStorage)[n];
      if (!isReplay && isCompleteRecord(stored)) {
        const foundCodes = new Set(stored.c);
        renderResult(result.targets, foundCodes);
        // Re-paint on a soft language switch so found/missed tile hover
        // labels + the description re-translate without a page reload.
        document.addEventListener('langchanged', () => {
          paintDescription(result.entry.description);
          renderResult(result.targets, foundCodes);
        });
        return;
      }

      const category = filterToCategory(result.filter, t);
      const game = startGame(n, category, result.targets, all, { skipSave: isReplay });

      // Soft language switch: re-paint description, re-run
      // `withLocalizedAliases` so the suggestion matcher accepts the
      // new language, re-resolve targets against the freshly-aliased
      // country list, and hand the new data to the running game.
      document.addEventListener('langchanged', () => {
        paintDescription(result.entry.description);
        const newAll = withLocalizedAliases(flagsGamePool(raw, false));
        const targetCodeSet = new Set(result.targets.map((c) => c.code));
        const newTargets = newAll.filter((c) => targetCodeSet.has(c.code));
        const newLabel = filterToCategory(result.filter, t).label;
        game.refreshI18n({ all: newAll, targets: newTargets, label: newLabel });
      });
    })
    .catch((err) => {
      // Fetch / parse errors freeze the message in the page's language
      // at error time. Re-translation on `langchanged` would require
      // localising the error.message half too — out of scope for the
      // soft-reload work, and this is a rare path anyway.
      showState(`${t('game.failedToLoad', 'Failed to load:')} ${err.message}`);
    });
}
