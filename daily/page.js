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
import { getOrCreateDeviceId } from '../flags/identity.js';
import { hasSubmitted } from './submitted.js';
import { submitResult } from './statsSubmit.js';
import { fetchStats } from './statsClient.js';
import { applyFindRatesToTiles } from './statsOverlay.js';
import { formatScoreLine } from './distributionSummary.js';
import { ensureTurnstile, getTurnstileToken } from './turnstileClient.js';
import { runFinishFlow } from './finishFlow.js';

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
    scoreOnly: t('daily.stats.scoreOnly', 'Your score: {found}/{total}'),
    scoreWithAverage: t('daily.stats.scoreWithAverage', 'Your score: {found}/{total} · Average score: {average}/{total}'),
    caption: t('daily.stats.caption', '% shows how many other players found each flag.'),
    loading: t('daily.stats.loading', 'Loading stats'),
  };
}

/**
 * Paint the stats panel: a one-line headline (player score, optionally
 * with the community average) + a caption explaining the per-tile %s
 * (only when stats are present, since the overlays only render then).
 *
 * Called twice in the happy path:
 *   1. immediately on finish/revisit with `stats: null` → shows just
 *      "Your score: X/N" so the player sees their own number instantly.
 *   2. after the stats fetch resolves → repaints with "Your score:
 *      X/N · Average score: M/N" + caption + tile overlays.
 *
 * On any stats fetch failure the first paint stays put — the player
 * still has their own score even if the community comparison can't load.
 *
 * `loading: true` shows an animated "Loading stats…" line below the
 * score while the post-finish POST + stats GET pipeline runs (mobile
 * cold path can take several seconds, otherwise the player just sees
 * their score and wonders if anything else is coming).
 *
 * @param {number} found
 * @param {number} total
 * @param {{ totalAttempts: number, median: number, perCodeFinds: Record<string, number> } | null} stats
 * @param {{ loading?: boolean }} [opts]
 */
function paintStatsPanel(found, total, stats, opts = {}) {
  const labels = statsLabels();
  const headlineText = formatScoreLine({
    found, total, stats,
    templates: { scoreOnly: labels.scoreOnly, scoreWithAverage: labels.scoreWithAverage },
  });
  const container = /** @type {HTMLElement} */ (document.getElementById('daily-stats'));
  container.hidden = false;
  container.innerHTML = '';
  const h = document.createElement('p');
  h.className = 'daily-stats-headline';
  h.textContent = headlineText;
  container.appendChild(h);
  if (opts.loading) {
    // Three pulsing dots after the label — CSS animates them in a wave
    // so the player can tell something is happening across the long
    // mobile path (Turnstile execute → POST → stats GET).
    const l = document.createElement('p');
    l.className = 'daily-stats-loading';
    l.textContent = labels.loading;
    const dots = document.createElement('span');
    dots.className = 'daily-stats-loading-dots';
    dots.setAttribute('aria-hidden', 'true');
    dots.innerHTML = '<span></span><span></span><span></span>';
    l.appendChild(dots);
    container.appendChild(l);
  }
  // Caption only when stats arrived AND we have per-tile overlays to
  // explain. The score-only state doesn't need it (no %s anywhere).
  if (stats && stats.totalAttempts > 0) {
    const c = document.createElement('p');
    c.className = 'daily-stats-caption';
    c.textContent = labels.caption;
    container.appendChild(c);
  }
}

/**
 * Fetch stats for puzzle N and repaint the panel with the community
 * average + apply per-tile overlays. The score-only paint must
 * already have happened (by the caller, before await'ing here) so
 * the player sees their own number while the network is in flight.
 *
 * `bypassCache: true` is used by the post-finish path so the player
 * sees their just-submitted result reflected immediately; revisits
 * use the default (cached) path.
 *
 * @param {number} n
 * @param {Country[]} targets
 * @param {number} found
 * @param {{ bypassCache?: boolean }} [opts]
 */
async function loadAndPaintStats(n, targets, found, opts = {}) {
  const stats = await fetchStats(n, { bypassCache: opts.bypassCache === true });
  if (!stats) {
    // Fetch failed — drop back to score-only (clears any loading
    // spinner the caller painted while we were in flight).
    paintStatsPanel(found, targets.length, null);
    return;
  }
  paintStatsPanel(found, targets.length, stats);
  applyFindRatesToTiles(/** @type {HTMLElement} */ (document.getElementById('find-result-found')), stats);
  applyFindRatesToTiles(/** @type {HTMLElement} */ (document.getElementById('find-missed')), stats);
}

/**
 * Post-finish hook: thin DOM/network wrapper around the testable
 * `runFinishFlow` orchestrator. Wires the loading spinner, score-only
 * fallback, and stats-with-overlays paint callbacks; everything else
 * (Turnstile + submit + fetch + failure handling) lives in finishFlow.js
 * where it can be unit-tested with fake deps.
 *
 * @param {number} n
 * @param {Country[]} targets
 * @param {{ foundCodes: string[], wrongCodes: string[], totalCount: number, durationMs: number }} info
 */
async function handleFinish(n, targets, info) {
  const widgetContainer = /** @type {HTMLElement} */ (document.getElementById('turnstile-widget'));
  const deviceId = getOrCreateDeviceId(window.localStorage, () => crypto.randomUUID());
  const found = info.foundCodes.length;

  await runFinishFlow({
    n,
    found,
    totalCount: info.totalCount,
    foundCodes: info.foundCodes,
    wrongCodes: info.wrongCodes,
    durationMs: info.durationMs,
    deviceId,
    store: window.localStorage,
    ensureTurnstile: () => ensureTurnstile({ container: widgetContainer, siteKey: TURNSTILE_SITE_KEY }),
    getTurnstileToken,
    submitResult,
    fetchStats,
    onLoading: () => paintStatsPanel(found, info.totalCount, null, { loading: true }),
    onCleared: () => paintStatsPanel(found, info.totalCount, null),
    onStats: (stats) => {
      paintStatsPanel(found, targets.length, stats);
      applyFindRatesToTiles(/** @type {HTMLElement} */ (document.getElementById('find-result-found')), stats);
      applyFindRatesToTiles(/** @type {HTMLElement} */ (document.getElementById('find-missed')), stats);
    },
  });
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
        paintStatsPanel(foundCodes.size, result.targets.length, null);
        if (hasSubmitted(window.localStorage, n)) {
          loadAndPaintStats(n, result.targets, foundCodes.size);
        }
        // Re-paint on a soft language switch so found/missed tile hover
        // labels + the description re-translate without a page reload.
        document.addEventListener('langchanged', () => {
          paintDescription(result.entry.description);
          renderResult(result.targets, foundCodes);
          paintStatsPanel(foundCodes.size, result.targets.length, null);
          if (hasSubmitted(window.localStorage, n)) {
            loadAndPaintStats(n, result.targets, foundCodes.size);
          }
        });
        return;
      }

      // Pre-warm Turnstile during gameplay so the slow first-time
      // script download + iframe render is paid while the player is
      // already busy guessing flags, not while they're staring at the
      // result screen wondering why their stats haven't appeared. On
      // mobile cold path this shaves 1-3s off the post-finish wait;
      // ensureTurnstile() is idempotent so the call inside handleFinish
      // still works (it short-circuits to Promise.resolve()).
      const widgetContainer = /** @type {HTMLElement} */ (document.getElementById('turnstile-widget'));
      ensureTurnstile({ container: widgetContainer, siteKey: TURNSTILE_SITE_KEY })
        .catch(() => { /* preload failure is silent — handleFinish retries */ });

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
        onFinish: (info) => handleFinish(n, result.targets, info),
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
