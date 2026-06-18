import { t } from '../i18n.js';
import { todayN, puzzleDate, formatPuzzleDate } from '../flags/daily.js';
import { loadScores, migrateScores } from './scores.js';
import { renderArchiveSquare, renderGhostSquare, refreshSquareCriteria } from './squares.js';
import { mountDevReset } from './devReset.js';
import { getOrCreateDeviceId, IDENTITY_STORAGE_KEY } from '../flags/identity.js';
import { trySyncDevices } from '../flags/syncHydrate.js';
import { fetchCatalog } from './catalogSource.js';
import { warsawToday } from '../flags/warsawTime.js';
import { visiblePuzzles } from '../flags/puzzleFilter.js';
import { msUntilNextWarsawMidnight, formatCountdown } from '../flags/nextPuzzleCountdown.js';

/** @typedef {import('../flags/daily.js').DailyPuzzle} DailyPuzzle */

export function bootArchive() {
  mountDevReset();
  migrateScores(window.localStorage);
  // Background sync for linked devices — refreshes `daily.scores`
  // from the server at most once per hour so the archive grid
  // reflects plays the other linked device made elsewhere. Unlinked
  // users exit on the identity gate without any network call.
  void trySyncDevices({
    deviceId: getOrCreateDeviceId(window.localStorage, () => window.crypto.randomUUID()),
    store: window.localStorage,
    identityKey: IDENTITY_STORAGE_KEY,
  });
  const listEl = /** @type {HTMLElement} */ (document.getElementById('archive-list'));
  const scores = loadScores(window.localStorage);

  fetchCatalog('puzzles')
    .then((/** @type {DailyPuzzle[]} */ allEntries) => {
      const catalog = visiblePuzzles(allEntries, warsawToday());
      const today = todayN(catalog);
      if (today === 0) {
        const empty = document.createElement('li');
        empty.className = 'archive-empty';
        // data-i18n re-translates on a soft language switch via
        // applyStringsToDocument — no per-call listener needed.
        empty.setAttribute('data-i18n', 'daily.empty');
        empty.textContent = t('daily.empty', 'No puzzles yet.');
        listEl.appendChild(empty);
        return;
      }
      for (const entry of catalog) {
        listEl.appendChild(renderArchiveSquare(entry, {
          href: `./?n=${entry.n}`,
          ariaPrefix: 'Daily',
          isToday: entry.n === today,
          score: scores[entry.n],
        }));
      }
      // Ghost tile at the tail — non-clickable preview of the next-dated
      // entry with a Warsaw-midnight countdown. Skipped when the
      // schedule has been exhausted (nothing more to count down to).
      mountNextPuzzleGhostTile(listEl, allEntries);
      // Scroll today into view so the user lands on a useful anchor
      // instead of puzzle #1 from a year ago. `instant` (not `smooth`)
      // so the page appears to render at today rather than scrolling
      // from the top — less jarring on first paint. `block: 'center'`
      // keeps today vertically centred so a few puzzles above and below
      // are visible too.
      const todayEl = listEl.querySelector('.archive-square--today');
      if (todayEl && typeof todayEl.scrollIntoView === 'function') {
        todayEl.scrollIntoView({ behavior: 'instant', block: 'center' });
      }
      // Soft language switch — re-translate each square's hover overlay
      // (and aria-label) so the criteria label tracks the active lang.
      document.addEventListener('langchanged', () => refreshSquareCriteria());
    })
    .catch((err) => {
      listEl.textContent = `${t('game.failedToLoad', 'Failed to load:')} ${err.message}`;
    });
}

/**
 * Render the "next puzzle" tile at the end of the archive grid + start
 * a 30 s ticker that keeps the countdown text fresh. Idempotent across
 * boots within one page lifetime (only ever one ghost tile rendered).
 *
 * @param {HTMLElement} listEl
 * @param {DailyPuzzle[]} allEntries  full puzzles.json — visible + future
 */
function mountNextPuzzleGhostTile(listEl, allEntries) {
  const today = warsawToday();
  const future = allEntries
    .filter((p) => typeof p.date === 'string' && p.date > today)
    .sort((a, b) => /** @type {string} */ (a.date).localeCompare(/** @type {string} */ (b.date)));
  if (future.length === 0) return;
  const next = future[0];

  const renderTexts = () => {
    const lang = document.documentElement.lang || 'en';
    const ms = msUntilNextWarsawMidnight(new Date());
    return {
      ghostLabel: t('daily.nextPuzzle.ghostLabel', 'Next puzzle'),
      countdown: formatCountdown(ms, lang),
      dateText: formatPuzzleDate(puzzleDate(next.n)),
    };
  };

  const tile = renderGhostSquare(next, renderTexts());
  listEl.appendChild(tile);

  const tick = () => {
    const { ghostLabel, countdown } = renderTexts();
    const countdownEl = tile.querySelector('[data-role="ghost-countdown"]');
    if (countdownEl) countdownEl.textContent = countdown;
    const labelEl = tile.querySelector('.archive-square-ghost-label');
    if (labelEl) labelEl.textContent = ghostLabel;
    tile.setAttribute('aria-label', `${ghostLabel} — ${countdown}`);
  };
  setInterval(tick, 30_000);
  document.addEventListener('langchanged', tick);
}
