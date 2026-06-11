import { loadCountries, flagsGamePool } from '../flags/group.js';
import { t, withLocalizedAliases, countryName } from '../i18n.js';
import { todayN, dailyNFromUrl, isReplayFromUrl, resolveDailyPuzzle } from '../flags/daily.js';
import { loadScores, isCompleteRecord, migrateScores } from './scores.js';
import { filterToCategory } from '../flags/findFlag.js';
import {
  wireZoom,
  openZoom,
  showState,
  paintDescription,
  renderResult,
  startGame,
  attachLangRefresh,
  showReason,
} from './playFlow.js';
import { getOrCreateDeviceId } from '../flags/identity.js';
import { submitResult } from './statsSubmit.js';
import { fetchStats } from './statsClient.js';
import { applyFindRatesToTiles } from './statsOverlay.js';
import { formatScoreLine } from './distributionSummary.js';
import { ensureTurnstile, getTurnstileToken } from './turnstileClient.js';
import { runFinishFlow } from './finishFlow.js';
import { PROD_SITE_KEY } from './turnstileSiteKey.js';
import { mountDevReset } from './devReset.js';
import { pickExtraStats, hasAnyExtraStats, pickMarkerKind } from './extraStats.js';

// Turnstile is soft-disabled across all environments (2026-06-10) after
// a real user's challenge was rejected by Cloudflare with a 401 on
// `/cdn-cgi/challenge-platform/h/g/pat/…` — her submission was silently
// dropped (by Phase B4 design) and the abuse defence Turnstile provides
// was judged not worth blocking legitimate plays in a tiny hobby app.
// Existing protections still in force: rate limit (5/min/IP), server-side
// validation, and one-submission-per-(puzzle, deviceId) via the Cosmos
// id. The SDK + widget + verifyTurnstile code is kept as scaffolding so
// flipping back is a one-line change here + setting TURNSTILE_SECRET to
// a real value in SWA. Server side: TURNSTILE_SECRET is set to "" in SWA
// so the existing skip-when-unset branch in dailyResult.js logs a warning
// and accepts every token.
const TURNSTILE_SITE_KEY = PROD_SITE_KEY;
const SKIP_TURNSTILE = true;

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
    extraRanking: t('daily.stats.extra.ranking', 'Most recognised:'),
    extraTopMistake: t('daily.stats.extra.topMistake', 'Most common mistake:'),
  };
}

/**
 * Look up a country by 2-letter code in the loaded list. Used by the
 * extra-stats rail to resolve the flag's localized name for the hover
 * tooltip. Returns null when the code isn't in our dataset (defensive
 * — should never fire in practice, since both targets and any wrong
 * guess come from the same list).
 *
 * @param {Country[]} all
 * @param {string} code
 */
function findCountry(all, code) {
  return all.find((c) => c.code === code) || null;
}

/**
 * Build one flag tile for the extra-stats rail. Mirrors the result-page
 * tile structure (`.find-tile` + `.find-stats-pct` bottom badge) so the
 * three rail sections render with identical sizing, borders, hover
 * tooltips and percentage strip as the Znalezione/Pominięte grids above.
 *
 * `markerKind` adds a small top-right corner dot — green when the player
 * found this flag, red when they missed it. null skips the dot.
 *
 * @param {{ code: string, pct?: number, count?: number }} item
 * @param {Country | null} country
 * @param {'found' | 'missed' | null} markerKind
 */
function buildExtraTile(item, country, markerKind) {
  const li = document.createElement('li');
  li.className = 'find-tile';
  if (markerKind === 'found') li.classList.add('is-user-found');
  else if (markerKind === 'missed') li.classList.add('is-user-missed');
  li.dataset.code = item.code;
  li.dataset.name = country ? countryName(country) : item.code.toUpperCase();
  if (country) li.addEventListener('click', () => openZoom(country));
  const img = document.createElement('img');
  img.src = `../flags/svg/${item.code}.svg`;
  img.alt = li.dataset.name;
  img.loading = 'lazy';
  li.appendChild(img);
  const badge = document.createElement('span');
  badge.className = 'find-stats-pct';
  badge.textContent = item.pct !== undefined ? `${item.pct}%` : `×${item.count}`;
  li.appendChild(badge);
  return li;
}

/**
 * Mount the "Mostly guessed / Most missed / Most common mistake" rail
 * under the Znalezione/Pominięte sections, matching their h2 + grid
 * visual pattern. Idempotent — clears the container first so a stats
 * refetch (post-finish, language switch) doesn't stack rows.
 *
 * Each row only renders when its picks list is non-empty; the whole
 * rail is skipped when all three are empty (no submissions yet, or a
 * legacy cached response without perWrongCode).
 *
 * @param {{ totalAttempts: number, perCodeFinds: Record<string, number>, perWrongCode?: Record<string, number> } | null} stats
 * @param {Country[]} targets
 * @param {Country[]} all
 * @param {Set<string>} userFoundCodes
 */
function renderExtraStats(stats, targets, all, userFoundCodes) {
  const container = /** @type {HTMLElement} */ (document.getElementById('daily-extra-stats'));
  container.innerHTML = '';
  container.hidden = true;

  if (!stats) return;
  const targetCodes = new Set(targets.map((c) => c.code));
  const picks = pickExtraStats({ stats, targetCodes: targets.map((c) => c.code) });
  if (!hasAnyExtraStats(picks)) return;

  const labels = statsLabels();
  appendExtraRow(container, labels.extraRanking, picks.ranking, all, targetCodes, userFoundCodes);
  appendExtraRow(container, labels.extraTopMistake, picks.topMistake, all, targetCodes, userFoundCodes);

  container.hidden = false;
}

/**
 * @param {HTMLElement} parent
 * @param {string} label
 * @param {Array<{ code: string, pct?: number, count?: number }>} items
 * @param {Country[]} all
 * @param {Set<string>} targetCodes
 * @param {Set<string>} userFoundCodes
 */
function appendExtraRow(parent, label, items, all, targetCodes, userFoundCodes) {
  if (items.length === 0) return;
  const title = document.createElement('h2');
  title.className = 'result-section-title';
  title.textContent = label;
  parent.appendChild(title);
  const ul = document.createElement('ul');
  ul.className = 'find-result-found';
  for (const item of items) {
    const marker = pickMarkerKind({ code: item.code, targetCodes, userFoundCodes });
    ul.appendChild(buildExtraTile(item, findCountry(all, item.code), marker));
  }
  parent.appendChild(ul);
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
 * @param {{ totalAttempts: number, mean: number, perCodeFinds: Record<string, number> } | null} stats
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
async function loadAndPaintStats(n, targets, found, all, userFoundCodes, opts = {}) {
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
  renderExtraStats(stats, targets, all, userFoundCodes);
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
async function handleFinish(n, targets, all, info) {
  const widgetContainer = /** @type {HTMLElement} */ (document.getElementById('turnstile-widget'));
  const deviceId = getOrCreateDeviceId(window.localStorage, () => crypto.randomUUID());
  const found = info.foundCodes.length;

  // On localhost we skip the CF Turnstile SDK entirely — see
  // turnstileSiteKey.js for the rationale. Server-side accepts an
  // empty token when TURNSTILE_SECRET is unset (local.settings.json
  // default), so the no-op functions round-trip cleanly.
  const ensureTurnstileFn = SKIP_TURNSTILE
    ? () => Promise.resolve()
    : () => ensureTurnstile({ container: widgetContainer, siteKey: TURNSTILE_SITE_KEY });
  const getTurnstileTokenFn = SKIP_TURNSTILE
    ? () => Promise.resolve('')
    : getTurnstileToken;

  await runFinishFlow({
    n,
    found,
    totalCount: info.totalCount,
    foundCodes: info.foundCodes,
    wrongCodes: info.wrongCodes,
    durationMs: info.durationMs,
    deviceId,
    store: window.localStorage,
    ensureTurnstile: ensureTurnstileFn,
    getTurnstileToken: getTurnstileTokenFn,
    submitResult,
    fetchStats,
    onLoading: () => paintStatsPanel(found, info.totalCount, null, { loading: true }),
    onCleared: () => paintStatsPanel(found, info.totalCount, null),
    onStats: (stats) => {
      paintStatsPanel(found, targets.length, stats);
      applyFindRatesToTiles(/** @type {HTMLElement} */ (document.getElementById('find-result-found')), stats);
      applyFindRatesToTiles(/** @type {HTMLElement} */ (document.getElementById('find-missed')), stats);
      renderExtraStats(stats, targets, all, new Set(info.foundCodes));
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
  mountDevReset();
  migrateScores(window.localStorage);

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
        paintStatsPanel(foundCodes.size, result.targets.length, null, { loading: true });
        // Stats panel is gated on Cosmos, not this device's localStorage:
        // always GET, and let the response decide (totalAttempts === 0 →
        // formatScoreLine falls back to score-only, paintStatsPanel skips
        // the caption). This way puzzles you finished on a different
        // device — or before submit-tracking shipped — still show stats.
        loadAndPaintStats(n, result.targets, foundCodes.size, all, foundCodes);
        // Re-paint on a soft language switch so found/missed tile hover
        // labels + the description re-translate without a page reload.
        document.addEventListener('langchanged', () => {
          paintDescription(result.entry.description);
          renderResult(result.targets, foundCodes);
          paintStatsPanel(foundCodes.size, result.targets.length, null, { loading: true });
          loadAndPaintStats(n, result.targets, foundCodes.size, all, foundCodes);
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
      // Skipped on localhost — see SKIP_TURNSTILE above.
      if (!SKIP_TURNSTILE) {
        const widgetContainer = /** @type {HTMLElement} */ (document.getElementById('turnstile-widget'));
        ensureTurnstile({ container: widgetContainer, siteKey: TURNSTILE_SITE_KEY })
          .catch(() => { /* preload failure is silent — handleFinish retries */ });
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
        onFinish: (info) => handleFinish(n, result.targets, all, info),
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
