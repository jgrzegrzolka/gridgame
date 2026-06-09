import { loadCountries, flagsGamePool } from '../flags/group.js';
import { t, withLocalizedAliases } from '../i18n.js';
import { todayN, dailyNFromUrl, isReplayFromUrl, resolveDailyPuzzle } from '../flags/daily.js';
import { loadScores, isCompleteRecord } from './scores.js';
import { filterToCategory } from '../flags/findFlag.js';
import {
  wireZoom,
  showState,
  paintDescription,
  renderResult,
  startGame,
  attachLangRefresh,
  showReason,
} from './playFlow.js';
import { getOrCreateDeviceId } from './identity.js';
import { hasSubmitted } from './submitted.js';
import { submitResult } from './statsSubmit.js';
import { fetchStats } from './statsClient.js';
import { applyFindRatesToTiles } from './statsOverlay.js';
import { formatStatsHeadline } from './distributionSummary.js';
import { ensureTurnstile, getTurnstileToken } from './turnstileClient.js';

// Public site key for our Turnstile widget — fine to ship in source.
// The secret stays in SWA env vars.
// NOTE: Cloudflare reissues the site key when you rotate the secret —
// both must be updated together. If POSTs start 400'ing at the CF
// challenge endpoint with the site key in the URL, that's the symptom.
const TURNSTILE_SITE_KEY = '0x4AAAAAADhdZ-XDzVHaLk9R';

/** @typedef {import('../flags/group.js').Country} Country */

/**
 * Localized labels for the community-stats UI. Resolved at the call
 * site (not at module-load) so a soft language switch picks up fresh
 * strings the next time it renders.
 */
function statsLabels() {
  return {
    headline: t('daily.stats.headline', 'Median today: {median}/{total} — {topPct}% got everything'),
    caption: t('daily.stats.caption', '% shows how many other players found each flag.'),
    loading: t('daily.stats.loading', 'Loading stats…'),
  };
}

/**
 * Fetch stats for puzzle N and render them as: a one-line headline
 * + a caption in the #daily-stats slot, plus a per-tile percentage
 * overlay on the existing Found / Missed flag lists. Used by both
 * the post-finish path (handleFinish) and the revisit path.
 *
 * `bypassCache` defaults to false (revisit path uses the 60s server
 * cache, which is fine for stats the player has seen before). The
 * finish path passes `true` so the player sees their just-submitted
 * result reflected immediately instead of cached pre-submit data.
 *
 * On any failure the panel hides silently and the rest of the result
 * screen still works (player has their score, found/missed tiles).
 *
 * @param {number} n
 * @param {number} totalCount  puzzle's answer-set size; needed to format the median fraction
 * @param {{ bypassCache?: boolean }} [opts]
 */
async function renderStatsForPuzzle(n, totalCount, opts = {}) {
  showStatsLoading();
  const stats = await fetchStats(n, { bypassCache: opts.bypassCache === true });
  if (!stats) {
    hideStatsPanel();
    return;
  }
  const labels = statsLabels();
  const headlineText = formatStatsHeadline({ stats, totalCount, template: labels.headline });
  if (headlineText === null) {
    // No meaningful population yet (totalAttempts === 0). Hide the
    // panel entirely rather than show "Median today: 0/N — 0% got
    // everything" which is technically true but misleading.
    hideStatsPanel();
    return;
  }
  paintStatsHeadline(headlineText, labels.caption);
  applyFindRatesToTiles(/** @type {HTMLElement} */ (document.getElementById('find-result-found')), stats);
  applyFindRatesToTiles(/** @type {HTMLElement} */ (document.getElementById('find-missed')), stats);
}

/**
 * Post-finish hook: get a Turnstile token, submit the result, and
 * (on 204 / 409) render the stats UI. Failures are silent — the rest
 * of the finish screen still works.
 *
 * @param {number} n
 * @param {number} totalCount
 * @param {{ foundCodes: string[], totalCount: number, durationMs: number }} info
 */
async function handleFinish(n, totalCount, info) {
  const widgetContainer = /** @type {HTMLElement} */ (document.getElementById('turnstile-widget'));
  const deviceId = getOrCreateDeviceId(window.localStorage, () => crypto.randomUUID());

  // Show a loading placeholder immediately so the user sees the panel
  // *will* appear. Turnstile + POST + stats fetch take ~1-2s together,
  // which feels broken without any visible cue. The eventual render
  // overwrites this placeholder.
  showStatsLoading();

  let turnstileToken = '';
  try {
    await ensureTurnstile({ container: widgetContainer, siteKey: TURNSTILE_SITE_KEY });
    turnstileToken = await getTurnstileToken();
  } catch {
    hideStatsPanel();
    return;
  }

  const r = await submitResult({
    store: window.localStorage,
    n,
    foundCodes: info.foundCodes,
    totalCount: info.totalCount,
    durationMs: info.durationMs,
    deviceId,
    turnstileToken,
  });

  if (r.outcome === 'ok') {
    await renderStatsForPuzzle(n, totalCount, { bypassCache: true });
    return;
  }
  hideStatsPanel();
}

/**
 * Render the small "Loading stats…" placeholder inside #daily-stats
 * and reveal the section. Used as the very first thing in both the
 * finish and revisit paths so the user sees something during the
 * Turnstile + POST + GET delay.
 */
function showStatsLoading() {
  const container = /** @type {HTMLElement} */ (document.getElementById('daily-stats'));
  container.hidden = false;
  container.innerHTML = '';
  const p = document.createElement('p');
  p.className = 'find-stats-loading';
  p.textContent = statsLabels().loading;
  container.appendChild(p);
}

/**
 * Paint the headline + caption into #daily-stats, overwriting any
 * loading placeholder.
 *
 * @param {string} headlineText
 * @param {string} captionText
 */
function paintStatsHeadline(headlineText, captionText) {
  const container = /** @type {HTMLElement} */ (document.getElementById('daily-stats'));
  container.hidden = false;
  container.innerHTML = '';
  const h = document.createElement('p');
  h.className = 'daily-stats-headline';
  h.textContent = headlineText;
  container.appendChild(h);
  const c = document.createElement('p');
  c.className = 'daily-stats-caption';
  c.textContent = captionText;
  container.appendChild(c);
}

/**
 * Hide the panel entirely. Used on submit/turnstile/fetch failure —
 * the rest of the result screen (found, missed, action links) still
 * works fine on its own; we don't want a stranded loading message.
 */
function hideStatsPanel() {
  const container = /** @type {HTMLElement} */ (document.getElementById('daily-stats'));
  container.innerHTML = '';
  container.hidden = true;
}

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
        showReason(result.reason);
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
        if (hasSubmitted(window.localStorage, n)) {
          renderStatsForPuzzle(n, result.targets.length);
        }
        // Re-paint on a soft language switch so found/missed tile hover
        // labels + the description re-translate without a page reload.
        document.addEventListener('langchanged', () => {
          paintDescription(result.entry.description);
          renderResult(result.targets, foundCodes);
          if (hasSubmitted(window.localStorage, n)) {
            renderStatsForPuzzle(n, result.targets.length);
          }
        });
        return;
      }

      const category = filterToCategory(result.filter, t);
      // Replays treated identically to first finishes: local archive
      // overwrites with the latest attempt, and we re-POST to the
      // server. The server enforces first-attempt-only via 409 on
      // duplicate (puzzleId, deviceId); the client just hands the
      // result over and treats 204 / 409 as equivalent. This makes
      // replays self-healing when the first POST failed (Turnstile
      // glitch, network drop, etc) — the player can replay and
      // finally get their result counted.
      const game = startGame(n, category, result.targets, all, {
        onFinish: (info) => handleFinish(n, result.targets.length, info),
      });
      attachLangRefresh(game, {
        raw,
        targets: result.targets,
        filter: result.filter,
        description: result.entry.description,
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
