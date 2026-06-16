import { t } from '../i18n.js';
import { todayN } from '../flags/daily.js';
import { loadScores, migrateScores } from './scores.js';
import { renderArchiveSquare, refreshSquareCriteria } from './squares.js';
import { mountDevReset } from './devReset.js';
import { getOrCreateDeviceId, IDENTITY_STORAGE_KEY } from '../flags/identity.js';
import { trySyncDevices } from '../flags/syncHydrate.js';
import { fetchCatalog } from './catalogSource.js';

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

  fetchCatalog('live')
    .then((/** @type {DailyPuzzle[]} */ catalog) => {
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
      // Soft language switch — re-translate each square's hover overlay
      // (and aria-label) so the criteria label tracks the active lang.
      document.addEventListener('langchanged', () => refreshSquareCriteria());
    })
    .catch((err) => {
      listEl.textContent = `${t('game.failedToLoad', 'Failed to load:')} ${err.message}`;
    });
}
