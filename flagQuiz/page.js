import {
  createQuiz,
  VARIANTS,
  MODES,
  defaultModeFor,
  isTimedMode,
  timedRemainingMs,
  timedBudgetUsedMs,
  lowerScoreWins,
  formatTime,
  recordResult,
  scoreColor,
  poolFor,
  targetFor,
  isQuizShowMap,
  setQuizShowMap,
  getQuizLastVariant,
  setQuizLastVariant,
  getQuizLastMode,
  setQuizLastMode,
  pickCelebration,
  mistakesAfterGiveUp,
  countModeProgressRatio,
  variantHasLeaderboard,
} from '../flags/quiz.js';
import { loadCountries } from '../flags/group.js';

/** @typedef {import('../flags/group.js').Country} Country */
import { t, countryName } from '../i18n.js';
import { runCelebration } from '../confetti.js';
import { buildQuizMenu } from './menu.js';
import {
  poolOptions,
  modeOptions,
  roundPillModel,
  roundQuery,
  resolveRoundConfig,
} from './roundSettings.js';
import { quizResultView } from './resultView.js';
import { deckIconHtml } from '../flags/deckIcons.js';
import { QUIZ_MAP_CONFIG } from './mapConfig.js';
import { mountNicknameMenuItem, shareUrl } from '../common.js';
import { bumpShare, bumpQuiz60sDay, pushEngagementBlob } from '../flags/engagementCounters.js';
import { warsawDayNumber } from '../flags/warsawDay.js';
import { ensureProfile } from '../flags/autoProfile.js';
import { IDENTITY_STORAGE_KEY } from '../flags/identity.js';
import { trySyncDevices, resolveIdentityAndHydrate } from '../flags/syncHydrate.js';
import { quizRecordConfigKey } from '../flags/quizRecordConfigKey.js';
import { submitQuizRecord } from '../flags/quizRecordSubmit.js';
import {
  shouldPushQuizRecord,
  computeTodayPbCandidate,
  utcDateKey,
  getLastQuizRecordPushedAt,
  markQuizRecordPushed,
  getQuizDayBest,
  setQuizDayBest,
} from '../flags/quizRecordThrottle.js';
import { madeAnyQuizPick } from '../flags/quizEngagement.js';

/**
 * Wrap `submitQuizRecord` with the throttle decision. Push policy lives
 * in `flags/quizRecordThrottle.js` — this wrapper just gathers the
 * call-site inputs (sentinel, per-config day-best cache, today-PB
 * computation) and stamps both caches after a successful push.
 *
 * The day-best cache is the fix for the empty-leaderboard bug: without
 * it, a niche-config finish (e.g. oceania-all) that isn't an all-time
 * PB but IS the first-of-day-for-this-config would get dropped by the
 * 30 min throttle and never write the leaderboard row. With it, the
 * `isTodayPbCandidate` signal forces the push for any finish that
 * would change today's `dailyLeaderboards` row server-side.
 *
 * `engaged` is computed once at the call site via `madeAnyQuizPick` so
 * this gate and the 60s day-log gate see the same engagement signal.
 *
 * When skipped, returns a synthetic `{ outcome: 'ok' }` so
 * `runLeaderboardCycle` continues to the fetch step — the leaderboard
 * still paints, just without an incoming write to display.
 *
 * @param {{
 *   deviceId: string,
 *   configKey: string,
 *   score: number,
 *   durationMs: number,
 *   lowerWins: boolean,
 *   isNew: boolean,
 *   engaged: boolean,
 * }} args
 * @returns {Promise<{ outcome: 'ok' } | { outcome: 'failed', reason: string }>}
 */
async function maybeSubmitQuizRecord({ deviceId, configKey, score, durationMs, lowerWins, isNew, engaged }) {
  const store = window.localStorage;
  const now = Date.now();
  const lastPushedAt = getLastQuizRecordPushedAt(store);
  const dayBest = getQuizDayBest(store, configKey);
  const isTodayPbCandidate = computeTodayPbCandidate({
    dayBest, entry: { score, durationMs }, lowerWins, now,
  });
  if (!shouldPushQuizRecord({ engaged, isNew, isTodayPbCandidate, lastPushedAt, now })) {
    return { outcome: 'ok' };
  }
  const result = await submitQuizRecord({ deviceId, configKey, score, durationMs, lowerWins });
  if (result.outcome === 'ok') {
    markQuizRecordPushed(store, now);
    // Only stamp the day-best cache when this push actually changed
    // (or created) today's leaderboard row server-side. Throttle-path
    // pushes don't, so we don't lie about the server's state.
    if (isTodayPbCandidate) {
      setQuizDayBest(store, configKey, { date: utcDateKey(now), score, durationMs });
    }
  }
  return result;
}
import { fetchLeaderboard } from '../flags/dailyLeaderboardFetch.js';
import { renderLeaderboard } from '../flags/dailyLeaderboardRender.js';
import { avatarSvg } from '../flags/avatar.js';
import { runLeaderboardCycle } from '../flags/leaderboardLifecycle.js';
import { buildQuizShareTitle } from '../flags/quizShareTitle.js';
import { celebrate } from '../flags/achievementCelebrate.js';
import { primeAchievementsBaseline, refreshAchievementsAndDiff } from '../flags/achievementsBaseline.js';
import { mountFlagMap, addHideButton, paintCountryFlag, settleFlagToTint, revealFlagImage, computeCountriesBbox, computeMainlandBbox } from './flagMap.js';
import { attachZoomPan, regionalFrame } from './mapZoom.js';
import { openFlagZoom, wireFlagZoomBackdropClose } from '../flags/flagZoom.js';
import { wireFlagLightbox } from '../flags/flagLightbox.js';

export async function bootFlagQuiz() {
  const quizMenuEl = document.getElementById('quiz-menu');
  const gameEl = document.getElementById('game');
  const countryNameEl = document.getElementById('country-name');
  const choicesEl = document.getElementById('choices');
  const resultEl = document.getElementById('result');
  const finalScoreLineEl = document.getElementById('final-score-line');
  const finalScoreEl = document.getElementById('final-score');
  const resultClearedEl = document.getElementById('result-cleared');
  const resultRecordEl = document.getElementById('result-record');
  const leaderboardEl = document.getElementById('daily-leaderboard');
  const leaderboardTitleEl = document.getElementById('leaderboard-title');
  const leaderboardBodyEl = document.getElementById('leaderboard-body');
  const playTimerEl = document.getElementById('play-time');
  const playHeadEl = document.getElementById('play-head');
  const playBoardEl = document.getElementById('play-board');
  const playScoreEl = document.getElementById('play-score');
  const playScoreValueEl = document.getElementById('play-score-value');
  const playMissEl = document.getElementById('play-miss');
  const playMissValueEl = document.getElementById('play-miss-value');
  const roundPillEl = /** @type {HTMLButtonElement} */ (document.getElementById('round-pill'));
  const roundPillIcoEl = document.getElementById('round-pill-ico');
  const roundPillLabelEl = document.getElementById('round-pill-label');
  const roundTrayEl = document.getElementById('round-tray');
  const roundPoolsEl = document.getElementById('round-pools');
  const roundModesEl = document.getElementById('round-modes');
  const roundCatcherEl = document.getElementById('round-tray-catcher');
  const playAgainEl = /** @type {HTMLAnchorElement} */ (document.getElementById('play-again'));
  const progressBarEl = document.getElementById('progress-bar');
  const giveUpEl = /** @type {HTMLButtonElement | null} */ (document.getElementById('give-up'));
  const playAgainInlineEl = /** @type {HTMLAnchorElement | null} */ (
    document.getElementById('play-again-inline')
  );
  const flagMapEl = /** @type {HTMLElement | null} */ (
    document.getElementById('flag-map-section')
  );
  const zoomEl = /** @type {HTMLDialogElement | null} */ (document.getElementById('zoom'));
  if (zoomEl) wireFlagZoomBackdropClose(zoomEl);
  // Tap the enlarged flag to open it bigger in a lightbox (shared behaviour
  // across the home page + /flagsdata/).
  if (zoomEl) wireFlagLightbox(zoomEl.querySelector('img'), t);

  const DEFAULT_VARIANT = 'countries';

  // Anonymous per-device ID used to address this player's row in the
  // cloud quiz-records doc. Same key as daily-puzzle submissions —
  // clearing localStorage resets both at once, which is the intended
  // identity model (zero PII, zero account).
  //
  // Feature W: resolve it durably — restoring the original deviceId +
  // rebuilding `flagquiz.best.*` from Cosmos if localStorage was evicted. Fast
  // path (local id present) = no network. See resolveIdentityAndHydrate.
  const deviceId = await resolveIdentityAndHydrate({
    store: window.localStorage, randomUUID: () => window.crypto.randomUUID(),
  });

  // Background sync for linked devices — refreshes `flagquiz.best.*`
  // from the server at most once per hour so the picker shows
  // personal-bests that include plays from the other linked device.
  // Unlinked users exit on the identity gate without any network.
  void trySyncDevices({
    deviceId, store: window.localStorage, identityKey: IDENTITY_STORAGE_KEY,
  });

  // Achievement baseline lives in flags/achievementsBaseline.js — the
  // shared module so this page's finish diff AND any post-action
  // share/coffee diff use the same axis (no double-firing across two
  // earn moments). common.js's wireBurgerDismiss already primes it,
  // but doing it again here is idempotent and avoids racing the
  // burger-wiring call.
  primeAchievementsBaseline(deviceId);

  const params = new URLSearchParams(window.location.search);
  // Resolution order per axis: explicit deep-link → player's last saved
  // pick → default. Last-pick memory means returning players land on the
  // category and the clock they actually play, not "All countries, 60s"
  // every time. The two axes resolve independently (see resolveRoundConfig)
  // so a shared `?v=europe` link no longer silently resets the mode.
  let { variantKey: currentVariantKey, modeKey: currentModeKey } = resolveRoundConfig({
    urlVariant: params.get('v'),
    urlMode: params.get('n'),
    savedVariant: getQuizLastVariant(window.localStorage),
    savedMode: getQuizLastMode(window.localStorage),
    defaultVariant: DEFAULT_VARIANT,
    defaultMode: defaultModeFor(),
  });

  /** The live round's handle — set by `launch`, replaced on every restart. */
  /** @type {{ refreshI18n: () => void, teardown: () => void, pause: () => void, resume: () => void } | null} */
  let game = null;
  /** The full country list, once fetched. Every restart reuses it. */
  /** @type {Country[]} */
  let countries = [];

  // ── Round-settings tray ──────────────────────────────────────────
  // Opening it PAUSES the round rather than ending it: `game.pause()` stops
  // the clock and stops picks registering, and the board dims behind the
  // panel. That is the whole behavioural point of the pill — the old paths
  // (a burger link, a popover link) all navigated, which threw away
  // whatever round you were in the middle of just to look at your options.
  let trayOpen = false;

  function setTrayOpen(open) {
    if (open === trayOpen) return;
    trayOpen = open;
    roundPillEl.setAttribute('aria-expanded', String(open));
    // On the body, not on #game: the counters and the progress bar both live
    // outside the play panel, and all three surfaces recede together.
    document.body.classList.toggle('is-tray-open', open);
    progressBarEl.classList.toggle('is-paused', open);
    roundCatcherEl.hidden = !open;
    if (open) {
      roundTrayEl.hidden = false;
      // Drop `hidden` first, then add the class on the next frame: an
      // element going from `display:none` straight to its open state has
      // no starting style to transition FROM, so the panel would snap in.
      window.requestAnimationFrame(() => {
        if (trayOpen) roundTrayEl.classList.add('is-open');
      });
      if (game) game.pause();
    } else {
      roundTrayEl.classList.remove('is-open');
      // Keep it out of the tab order once the fade has finished, and only
      // if it hasn't been reopened in the meantime.
      window.setTimeout(() => {
        if (!trayOpen) roundTrayEl.hidden = true;
      }, 240);
      if (game) game.resume();
    }
  }

  // Drop the penalty-flash class once the keyframes finish, so the next
  // wrong click can restart the animation cleanly via reflow. Bound once
  // here rather than per round: `startGame` runs again on every settings
  // change now, and a per-round binding would stack a listener each time.
  playTimerEl.addEventListener('animationend', () => {
    playTimerEl.classList.remove('penalty');
  });

  roundPillEl.addEventListener('click', (e) => {
    e.stopPropagation();
    setTrayOpen(!trayOpen);
  });
  roundCatcherEl.addEventListener('click', () => setTrayOpen(false));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && trayOpen) {
      setTrayOpen(false);
      roundPillEl.focus();
    }
  });

  /** Paint the pill: which pool, which clock, and the deck's icon. */
  function renderPill() {
    const { deck, label } = roundPillModel({
      variantKey: currentVariantKey, modeKey: currentModeKey, t,
    });
    roundPillIcoEl.innerHTML = deckIconHtml(deck, { base: '../' });
    roundPillLabelEl.textContent = label;
  }

  /**
   * Paint the tray's two chip rows.
   *
   * No confirm step: the chip IS the change. `pick` restarts the round on
   * the new setting immediately and leaves the tray open, so changing both
   * pool and clock is two taps rather than four.
   */
  function renderTray() {
    roundPoolsEl.innerHTML = '';
    for (const opt of poolOptions(currentVariantKey)) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = opt.active ? 'pill round-chip active' : 'pill round-chip';
      // Only pools that are a different KIND of question carry an icon —
      // see `poolOptions`. The seven continent chips are deliberately bare.
      if (opt.marked) {
        const ico = document.createElement('span');
        ico.className = 'round-chip-ico';
        ico.innerHTML = deckIconHtml(opt.deck, { base: '../' });
        chip.appendChild(ico);
      }
      chip.appendChild(document.createTextNode(
        t(`variant.${opt.key}`, VARIANTS[opt.key].label),
      ));
      chip.addEventListener('click', () => launch(opt.key, currentModeKey));
      roundPoolsEl.appendChild(chip);
    }

    roundModesEl.innerHTML = '';
    for (const opt of modeOptions(currentModeKey)) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = opt.active ? 'pill round-chip active' : 'pill round-chip';
      chip.textContent = t(`quiz.mode.${opt.key}`, opt.key);
      chip.addEventListener('click', () => launch(currentVariantKey, opt.key));
      roundModesEl.appendChild(chip);
    }
  }

  /**
   * Start a round on a configuration, tearing down whatever was running.
   *
   * This is the seam the pill needed: settings used to change by navigating
   * to `?v=…&n=…` and letting a page load do the resetting, which is why
   * `startGame` could get away with never cleaning up after itself. Now the
   * only navigation left is the initial load, and every subsequent
   * configuration change comes through here.
   *
   * The address bar is kept in step with `replaceState` — not for
   * navigation, but because the share button copies `location.href` and
   * "Play again" is a plain link to it. Without this, sharing after two chip
   * taps would send a friend to the round you started on, not the one you
   * played.
   *
   * @param {string} key   variant to play
   * @param {string} mode  mode to play it in
   */
  function launch(key, mode) {
    if (game) game.teardown();
    currentVariantKey = key;
    currentModeKey = mode;
    setQuizLastVariant(window.localStorage, key);
    setQuizLastMode(window.localStorage, mode);
    window.history.replaceState(null, '', roundQuery(key, mode));
    renderPill();
    renderTray();
    game = startGame(key, mode, countries);
    // The tray stays open across a chip tap, so the round it just started
    // has to come up paused — otherwise the new clock would be running
    // behind a dimmed board the player can't act on, and a second chip tap
    // would cost them the seconds they spent deciding.
    if (trayOpen) game.pause();
  }

  return fetch('../flags/countries.json')
    .then((r) => r.json())
    .then(loadCountries)
    .then((raw) => {
      countries = raw;

      // Re-buildable menu — rebuilds clear `menuEl.innerHTML` first so
      // a soft language switch doesn't double the items. The nickname
      // "Your name: …" item is re-inserted after each rebuild for the same
      // reason; without that, the first langchanged would wipe it.
      const rebuildMenu = () => {
        /** @type {HTMLUListElement} */ (quizMenuEl).innerHTML = '';
        buildQuizMenu(/** @type {HTMLUListElement} */ (quizMenuEl), {
          relativeBase: '',
          statsCurrent: false,
        });
        mountNicknameMenuItem({
          rootEl: quizMenuEl,
          profileHref: '../profile/',
        });
      };
      rebuildMenu();

      launch(currentVariantKey, currentModeKey);
      document.addEventListener('langchanged', () => {
        rebuildMenu();
        renderPill();
        renderTray();
        game.refreshI18n();
      });
    })
    .catch((err) => {
      document.body.textContent = `${t('game.failedToLoad', 'Failed to load:')} ${err.message}`;
    });

  function startGame(key, mode, raw) {
    const pool = poolFor(key, raw);
    const target = targetFor(mode, pool);
    const quiz = createQuiz(pool, target);
    const timed = isTimedMode(mode);
    const modeDef = MODES[mode];
    const budgetMs = timed && modeDef.kind === 'timed' ? modeDef.budgetMs : 0;
    const penaltyMs = timed && modeDef.kind === 'timed' ? modeDef.penaltyMs : 0;
    // Which cost the play row reports: the clock in 60s, the mistake count
    // when there is none. Read by CSS rather than branched over in JS, so
    // there is one place that knows the row has two layouts.
    playHeadEl.dataset.clock = timed ? '60s' : 'all';
    // The head outlives individual rounds (it holds the settings pill), so
    // each round has to un-finish it rather than assume a fresh document.
    playHeadEl.hidden = false;
    playHeadEl.classList.remove('is-finished');

    let currentAnswer = null;
    let wrongCount = 0;
    let answeredCount = 0;
    let gameOver = false;
    let gaveUp = false;
    const startTime = Date.now();
    let timerRaf = 0;
    /** Pending `advanceTo` timer, so a restart doesn't render into a dead round. */
    let advanceTimer = 0;

    // ── Pause ────────────────────────────────────────────────────────
    // Opening the settings tray stops the round without ending it. The
    // timer is wall-clock (`Date.now() - startTime`), so pausing means
    // banking the time spent paused and subtracting it — freezing the rAF
    // instead would drift, because the clock would resume from wherever
    // real time had moved to.
    let pausedMs = 0;
    let pausedAt = 0;
    /** Elapsed play time, excluding anything spent with the tray open. */
    function playElapsedMs() {
      return (pausedAt || Date.now()) - startTime - pausedMs;
    }

    /** @type {SVGElement | null} */
    let mapSvg = null;
    // Pan/zoom handle for the mounted map, captured so the answer fly-in
    // can drive the viewBox programmatically. Null until mountMap resolves.
    /** @type {ReturnType<typeof attachZoomPan> | null} */
    let mapZoomHandle = null;
    // True between a successful mountMap and the next hideMap. Tracked
    // separately from `mapSvg` because the mount is async — the flag is
    // set synchronously so a rapid toggle-on/off can't double-mount.
    let mapMounted = false;
    // Set once the click → flag-zoom handler is attached to flagMapEl.
    // The handler lives on the container (not the inner SVG), so it
    // survives re-mounts; we only want to bind it once.
    let mapClickWired = false;
    // Answer-paint history: every markCountry pushes {code, kind} here
    // so a map mounted LATE (the player flips "Show map" on mid-round or
    // after finishing) can replay the round's fills onto the fresh SVG.
    /** @type {{ code: string, kind: 'correct' | 'wrong' }[]} */
    const painted = [];

    /**
     * Record + paint an answered country. Single source of truth for the
     * map fill so a late mount replays exactly what live play would have
     * drawn. No-op on the SVG itself until a map is mounted (mapSvg null).
     * @param {string} code
     * @param {'correct' | 'wrong'} kind
     */
    function markCountry(code, kind) {
      // Keep only the most-recently answered country as a live flag image;
      // demote the previous one to its flat tint first. Caps the map's
      // per-fly-in settle repaint at one image instead of re-rasterising every
      // flag already down — the remaining hitch on a full 60s / all-flags run.
      const prev = painted[painted.length - 1];
      painted.push({ code, kind });
      if (prev && prev.code !== code) settleFlagToTint(mapSvg, prev.code);
      paintCountryFlag(mapSvg, code, '../flags/svg/', kind);
      flyToAnsweredCountry(code);
    }

    /** rAF handle for an in-flight throttled reveal, or 0 when idle. */
    let revealRaf = 0;
    /** Frame width the board was last revealed at — so re-revealing after a
     *  pure pan (same zoom, rasters still cached) is skipped, and only a real
     *  zoom change re-runs the throttle. */
    let lastRevealWidth = 0;
    /**
     * Reveal every answered country as its full flag `<image>`, a few per
     * frame, so the end-of-round "show the whole board" doesn't rasterise every
     * flag in one frame and freeze the tab. Each step drops `.is-tinted` from a
     * batch (its correctness wash → the real flag). Idempotent and restartable.
     */
    function revealAllFlagsThrottled() {
      if (!mapSvg || painted.length === 0) return;
      const raf = window.requestAnimationFrame;
      if (typeof raf !== 'function') {
        for (const p of painted) revealFlagImage(mapSvg, p.code);
        return;
      }
      if (revealRaf) window.cancelAnimationFrame(revealRaf);
      const queue = painted.slice();
      const PER_FRAME = 3; // a few flags per frame — smooth "develop" without a spike
      const step = () => {
        for (let i = 0; i < PER_FRAME && queue.length; i++) {
          revealFlagImage(mapSvg, queue.shift().code);
        }
        revealRaf = queue.length ? raf(step) : 0;
      };
      revealRaf = raf(step);
    }
    /**
     * Called (synchronously) whenever the map settles. Only acts in review
     * (`.is-finished`): re-shows the whole board, throttled. Skipped after a
     * pure pan (same zoom) since those rasters are still cached — only a zoom
     * change, whose new scale invalidates the cache, re-runs the reveal. Re-tints
     * everything first (cheap, in this same synchronous block so no image flash),
     * then reveals it a few per frame.
     * @param {{ x: number, y: number, width: number, height: number }} vb
     */
    function onMapSettle(vb) {
      if (!mapSvg || painted.length === 0) return;
      if (!flagMapEl || !flagMapEl.classList.contains('is-finished')) return;
      const w = vb && vb.width;
      if (w && Math.abs(w - lastRevealWidth) < 1) return; // same zoom: cached, leave as-is
      lastRevealWidth = w || 0;
      for (const p of painted) settleFlagToTint(mapSvg, p.code);
      revealAllFlagsThrottled();
    }

    /**
     * Smoothly fly the map to the country that was just answered so the
     * player can see where it lit up (at world scale a single country is
     * a speck). Frames it regionally — country plus surrounding context —
     * and STAYS there: the camera follows each answer, so while you read
     * the next flag the map rests on the country you just placed. The one
     * zoom-out back to the whole filled board happens once, at game end
     * (`showResult`) — calmer to watch and less work than easing out after
     * every answer. A rapid streak just retargets: `animateTo` cancels any
     * in-flight tween so the camera chases the latest answer, never stutters.
     * No-op when no map is mounted or the round has ended (the result
     * screen owns the view then). Covers correct and wrong answers alike —
     * both light up the asked country, and seeing a missed country's
     * location is worth the trip.
     *
     * @param {string} code
     */
    function flyToAnsweredCountry(code) {
      if (!mapSvg || !mapZoomHandle || gameOver) return;
      // Fly to the country's main landmass, not its far-flung overseas
      // territories: France's fr group spans French Guiana / Réunion, the USA's
      // spans Alaska + Hawaii, Spain's the Canaries, … so the union bbox would
      // zoom the camera out to most of the globe. computeMainlandBbox clusters
      // the country's paths and frames the biggest one; contiguous countries
      // are one cluster, so it matches computeCountriesBbox for them.
      const bb = computeMainlandBbox(mapSvg, code) || computeCountriesBbox(mapSvg, [code]);
      if (!bb) return;
      const frame = regionalFrame(bb, mapZoomHandle.getOriginal());
      mapZoomHandle.animateTo(frame, { durationMs: 480 });
    }

    // Click → flag zoom popup. The map is non-interactive while the
    // round is in progress (no `.is-finished` on the section); once the
    // round ends `.is-finished` is set and every country becomes a
    // review surface. Lookup is built from `raw` (the full 269-entry
    // country list), NOT the deck's `pool` — territories like Isle of
    // Man / Guernsey / Jersey aren't quiz items in a sovereign deck, but
    // they're still rendered on the map and the player can click them to
    // see the flag. (Feature V: the `weird` deck quizzes some of these;
    // the map lookup stays the full list either way.)
    const byCode = new Map(raw.map((c) => [c.code, c]));
    function wireMapClick() {
      if (!flagMapEl || mapClickWired) return;
      mapClickWired = true;
      flagMapEl.addEventListener('click', (e) => {
        if (!flagMapEl.classList.contains('is-finished')) return;
        const target = /** @type {Element | null} */ (e.target);
        if (!target) return;
        // Resolve to a country ISO2 code. Two shapes:
        //   1. Overlay hit-target — carries `data-hit-for="va"`.
        //   2. Country path — walk up to find the first [id] ancestor
        //      whose value is a known country code. Handles both
        //      single-path countries (id="es") and `<g id="ru">`
        //      wrappers whose child paths have their own ids
        //      (`ru-main`, `gb-eng`, etc.) that aren't real codes.
        let code = (typeof target.getAttribute === 'function')
          ? target.getAttribute('data-hit-for')
          : null;
        if (!code) {
          let el = /** @type {Element | null} */ (target);
          while (el) {
            const id = el.id;
            if (id && byCode.has(id)) { code = id; break; }
            el = el.parentElement;
          }
        }
        if (!code) return;
        const country = byCode.get(code);
        if (!country) return;
        openFlagZoom(zoomEl, {
          code: country.code,
          displayName: countryName(country),
          svgBase: '../flags/svg/',
        });
      });
    }

    function mountMap() {
      if (!flagMapEl || !QUIZ_MAP_CONFIG[key] || mapMounted) return;
      const cfg = QUIZ_MAP_CONFIG[key];
      const variantCodes = pool.map((c) => c.code);
      const excludes = new Set(cfg.cropExcludes || []);
      const cropCodes = cfg.crop
        ? variantCodes.filter((c) => !excludes.has(c))
        : null;
      mapMounted = true;
      flagMapEl.hidden = false;
      flagMapEl.setAttribute('aria-hidden', 'false');
      // Leaving the collapsed strip for the live map: drop `.is-collapsed`
      // so the chip flips back to its "hide" glyph. mountFlagMap replaces
      // the section's innerHTML, so the collapsed chip is rebuilt fresh.
      flagMapEl.classList.remove('is-collapsed');
      // Mounting after the round already ended (player reopened the map on
      // the result screen, via the toggle chip or the burger toggle): the
      // section is already parented into the result panel by showResult, so
      // we only mark it reviewable — no re-parent here.
      if (gameOver) {
        flagMapEl.classList.add('is-finished');
      }
      void mountFlagMap({
        container: flagMapEl,
        url: cfg.url,
        cropCodes,
        cropPad: cfg.cropPad,
        // Microstate overlays only land on countries the player will
        // actually be quizzed on — the world map is geographically
        // wide and we don't want pink rings decorating Caribbean /
        // Pacific microstates that aren't part of the Asian round.
        scopeCodes: variantCodes,
        fullscreenLabel: t('menu.fullscreen', 'Toggle fullscreen'),
        // Top-left toggle chip → collapse the map in place (chip stays put,
        // flips to a "show" eye) and persist the choice — the same path the
        // burger toggle drives.
        onToggle: toggleMapVisibility,
        toggleLabel: t('menu.hideMap', 'Hide map'),
      }).then((svg) => {
        mapSvg = svg;
        // Wheel-zoom + pinch + drag-pan + double-tap-reset. Attached
        // once the SVG is in the DOM (and after cropToCountries has
        // set the final viewBox, since mapZoom reads that as the
        // "original" bounds for clamping).
        if (svg) {
          mapZoomHandle = attachZoomPan(svg, { onSettle: onMapSettle, containZoomOut: true, freePan: false });
          // Replay the round so far — fills every country already
          // answered before this (possibly late) mount. Uses
          // paintCountryFlag directly (not markCountry) so a late mount
          // doesn't fire the answer fly-in for every historical fill.
          for (let i = 0; i < painted.length; i++) {
            const p = painted[i];
            paintCountryFlag(svg, p.code, '../flags/svg/', p.kind);
            // Every replayed flag starts as its cheap wash/tint. Mid-round the
            // newest stays a live image (matching live play); post-game we
            // throttle-reveal the whole board below instead of rasterising it
            // all in this one loop.
            if (gameOver || i < painted.length - 1) settleFlagToTint(svg, p.code);
          }
          // Late mount after the round ended: show the board a few flags per
          // frame rather than all at once (no fly-in settle fires here).
          if (gameOver) {
            lastRevealWidth = mapZoomHandle.getOriginal().width;
            revealAllFlagsThrottled();
          }
        }
      });
      wireMapClick();
    }

    function hideMap() {
      if (!flagMapEl) return;
      mapMounted = false;
      if (revealRaf) { window.cancelAnimationFrame(revealRaf); revealRaf = 0; }
      lastRevealWidth = 0;
      if (mapZoomHandle) mapZoomHandle.teardown();
      mapZoomHandle = null;
      mapSvg = null;
      flagMapEl.classList.remove('is-finished');
      // Drop the inlined SVG (the heavy part — this is the perf relief) and
      // render the slim collapsed strip: the SAME toggle chip, in the SAME
      // top-left corner, now showing a "show map" eye. The click handler
      // stays bound to flagMapEl (the container) and is gated on
      // `.is-finished`, so it's inert until a re-mount restores it.
      renderCollapsedMap();
    }

    /**
     * Render the collapsed map strip: the section stays visible but holds
     * only the toggle chip (no SVG), so the chip keeps its exact top-left
     * position and just flips to the "show map" eye. Shared by hideMap and
     * the initial paint when the player has the map off. The chip is rebuilt
     * here because mountFlagMap's innerHTML replacement wipes it on mount.
     */
    function renderCollapsedMap() {
      if (!flagMapEl) return;
      flagMapEl.hidden = false;
      flagMapEl.setAttribute('aria-hidden', 'false');
      flagMapEl.classList.add('is-collapsed');
      flagMapEl.innerHTML = '';
      addHideButton(flagMapEl, t('menu.showMap', 'Show map'), toggleMapVisibility);
    }

    /**
     * Live response to the burger menu's "Show map" toggle — mount or
     * collapse the map in place, no page reload. Variants with no map asset
     * (none today, but the table is the gate) silently no-op.
     * @param {boolean} show
     */
    function setMapVisible(show) {
      if (show) mountMap();
      else hideMap();
    }

    /**
     * The toggle chip's click. Flips to the opposite of the current state:
     * a mounted map collapses, a collapsed one re-mounts. Reads `mapMounted`
     * at click time so the same handler serves the chip in both states.
     */
    function toggleMapVisibility() {
      applyMapPreference(!mapMounted);
    }

    /**
     * Single entry point for the in-map toggle chip. Persists the choice
     * against THIS MODE's `gridgame.flagquiz.showMap.<mode>` key and applies
     * it live. The chip on the map (a "show" chip even on the collapsed
     * strip) is the only show/hide control, so there's no burger toggle to
     * keep in sync.
     *
     * Per mode, because the two modes want opposite things: in 60s the map
     * is a distraction you pay for in seconds, with no clock it's the point.
     * A single preference could only ever be right for one of them.
     * @param {boolean} show
     */
    function applyMapPreference(show) {
      setQuizShowMap(localStorage, mode, show);
      setMapVisible(show);
    }

    // Initial paint: for any variant that has a map, show the live map or
    // the collapsed toggle chip per this mode's saved preference. Variants
    // with no map asset leave the section hidden.
    if (QUIZ_MAP_CONFIG[key]) {
      if (isQuizShowMap(localStorage, mode)) mountMap();
      else renderCollapsedMap();
    }

    // Result-screen data is captured once when showResult fires so a soft
    // language switch can re-derive the whole screen — headline, record line,
    // clean-sweep eyebrow — without re-running recordResult or re-firing the
    // celebration. Null until the game ends; refreshI18n's
    // `paintResultLabels` no-ops until then.
    /** @type {{ isNew: boolean, best: { score: number, time: number }, elapsed: number, budgetUsed: number, gaveUp: boolean } | null} */
    let resultLabelData = null;

    // Captured by `runLeaderboardCycle`'s paint callback so a soft language
    // switch can re-render translated labels without re-issuing the fetch.
    /** @type {{ state: 'loading' | 'ready' | 'failed', data?: { top: any[], you: any } } | null} */
    let leaderboardState = null;

    function paintLeaderboard() {
      if (!leaderboardState) return;
      leaderboardEl.hidden = false;
      // The "Today's leaderboard" header is for the populated panel —
      // showing it above a "Loading…" spinner reads as a promise the
      // page hasn't kept yet. Reveals on first non-loading paint.
      leaderboardTitleEl.hidden = leaderboardState.state === 'loading';
      // Endurance mode stores `score = wrongCount` (lower wins). Showing
      // that as the leaderboard column reads as "Janko 0" — which the
      // player parses as "Janko got 0 correct" instead of "Janko got 0
      // wrong". Transform back to a correct-count display for that mode.
      // Timed (60s) mode already stores `score = correctCount`, no
      // transform needed.
      const formatScore = timed ? undefined : (n) => String(target - n);
      // 60s mode only: a row whose score reaches the pool size cleared
      // every flag in the category → the renderer shows its finish time
      // next to the score. Endurance mode stores wrong-counts (lower
      // wins), so "cleared all" isn't a score threshold there — pass null
      // to suppress the time.
      const poolTotal = timed ? pool.length : null;
      const subtree = renderLeaderboard({
        state: leaderboardState.state,
        data: leaderboardState.data,
        ownDeviceId: deviceId,
        t,
        formatScore,
        formatTime,
        poolTotal,
        avatarSvg,
      });
      leaderboardBodyEl.innerHTML = '';
      leaderboardBodyEl.appendChild(subtree);
    }

    // For timed mode the progress bar is the countdown — we widen it from
    // 0% to 100% as the budget burns down, so the visual matches the
    // dwindling timer rather than the meaningless "questions done" ratio.
    if (timed) {
      progressBarEl.style.transform = 'scaleX(0)';
    }

    function flashPenalty() {
      playTimerEl.classList.remove('penalty');
      // Force a reflow so the re-added class triggers the animation again
      // even if a previous flash is still mid-flight.
      void playTimerEl.offsetWidth;
      playTimerEl.classList.add('penalty');
    }

    /** How many the player has, and what it has cost them so far. */
    function paintCounters() {
      playScoreValueEl.textContent = String(answeredCount);
      playMissValueEl.textContent = String(wrongCount);
      // Zero isn't news — it drops to grey rather than sitting in a verdict
      // colour for a round that has produced no verdict yet.
      playScoreEl.classList.toggle('is-zero', answeredCount === 0);
      playMissEl.classList.toggle('is-zero', wrongCount === 0);
    }

    /** Last ten seconds of the budget — the one point the clock changes meaning. */
    const LOW_TIME_MS = 10_000;

    function tickTimer() {
      if (timed) {
        const elapsedMs = playElapsedMs();
        const remaining = timedRemainingMs({ budgetMs, penaltyMs, elapsedMs, wrongCount });
        playTimerEl.textContent = formatTime(remaining);
        playTimerEl.classList.toggle('is-low', remaining < LOW_TIME_MS);
        // Drive the bar with `transform: scaleX` (not `width`): scaleX is a
        // compositor-only property, so updating it every frame is smooth and
        // costs no layout — where a per-frame `width` write would relayout /
        // repaint on each frame, which is what made the map lag on mobile.
        // transform-origin:left (set in CSS) grows the bar from the left.
        progressBarEl.style.transform = `scaleX(${(budgetMs - remaining) / budgetMs})`;
        if (remaining <= 0 && !gameOver) {
          gameOver = true;
          showResult();
          return;
        }
      } else {
        playTimerEl.textContent = formatTime(playElapsedMs());
      }
      timerRaf = requestAnimationFrame(tickTimer);
    }

    /**
     * Paint the prompt line for a question: the country to find. Split out so
     * the language-switch refresh re-paints it the same way.
     * @param {any} q
     */
    function paintPrompt(q) {
      countryNameEl.textContent = countryName(q.answer);
    }

    /** The question on screen, so a language switch can re-paint its prompt. */
    let currentQ = null;

    function render(q) {
      currentAnswer = q.answer;
      currentQ = q;
      paintPrompt(q);
      choicesEl.innerHTML = '';
      for (const c of q.choices) {
        const tile = document.createElement('button');
        tile.className = 'flag-choice';
        tile.dataset.code = c.code;
        const img = document.createElement('img');
        img.src = `../flags/svg/${c.code}.svg`;
        img.alt = '';
        tile.appendChild(img);
        tile.addEventListener('click', () => onAnswer(c, tile));
        choicesEl.appendChild(tile);
      }
      // Warm the next round's flags while the player reads the current
      // one, so render(quiz.next()) hits the browser cache. Replaces the
      // old preload-everything-at-start strategy that queued the first
      // visible flags behind ~200 background prefetches.
      const upcoming = quiz.peek();
      if (upcoming) {
        for (const c of upcoming.choices) {
          new Image().src = `../flags/svg/${c.code}.svg`;
        }
      }
    }

    function disableAllTiles() {
      for (const t of choicesEl.querySelectorAll('.flag-choice')) {
        /** @type {HTMLButtonElement} */ (t).disabled = true;
      }
    }

    // The handle is kept so `teardown` can cancel a pending advance: a
    // settings change mid-reveal would otherwise fire ~1.2s later and render
    // the OLD round's next question into the new round's grid.
    function advanceTo(nextQ, delayMs) {
      if (!nextQ) {
        advanceTimer = window.setTimeout(() => {
          if (!gameOver) {
            gameOver = true;
            showResult();
          }
        }, delayMs);
      } else {
        advanceTimer = window.setTimeout(() => { if (!gameOver) render(nextQ); }, delayMs);
      }
    }

    function onAnswer(chosen, tile) {
      if (gameOver) return;
      // A paused round takes no picks. `pointer-events: none` on the dimmed
      // board already stops the mouse, but a keyboard user can still reach a
      // focused tile with Enter, and a tap that lands in the same frame the
      // tray opens would otherwise burn a question the player never saw.
      if (pausedAt) return;
      if (chosen.code === currentAnswer.code) {
        answeredCount++;
        paintCounters();
        if (!timed) {
          progressBarEl.style.transform = `scaleX(${countModeProgressRatio(answeredCount, wrongCount, target)})`;
        }
        tile.classList.add('correct');
        disableAllTiles();
        // currentAnswer.code is the ISO2 of the country in question.
        // Fill the country's contour with its flag + green outline.
        // Records into `painted` so a map mounted later replays it.
        markCountry(currentAnswer.code, 'correct');
        advanceTo(quiz.next(), 150);
      } else if (timed) {
        // 60s is one-shot per question, same as count mode: a wrong
        // pick advances the round. The cabinet (quiz.addToCabinet)
        // queues the missed answer for revisit if the main pool
        // exhausts before time runs out — your second chance is at the
        // end, not in-place. Penalty (flashPenalty / wrongCount++)
        // still applies so random clickers are punished by lost
        // budget.
        wrongCount++;
        paintCounters();
        tile.classList.add('wrong');
        // Overlay the wrong country's name on the tile itself — the
        // .flag-choice.wrong[data-name]::after rule paints a strip
        // across the flag's bottom. Replaces the standalone .feedback
        // line so the map below has more vertical room.
        tile.dataset.name = countryName(chosen);
        const correctTile = choicesEl.querySelector(`[data-code="${currentAnswer.code}"]`);
        if (correctTile) correctTile.classList.add('correct');
        disableAllTiles();
        flashPenalty();
        // Map: fill the ASKED-ABOUT country (currentAnswer.code) with its
        // flag + red outline, matching count mode's semantics — the player
        // sees the flag they missed. The clicked-country tracking we used
        // during multi-attempt was lossy (latest-wins would flip the red to
        // green if that country later came up correct); the cabinet pattern
        // makes the asked-about marking honest — a wrong stays wrong unless
        // revisited and corrected.
        markCountry(currentAnswer.code, 'wrong');
        quiz.addToCabinet(currentAnswer);
        advanceTo(quiz.next(), 1200);
      } else {
        // Count mode is one-shot: a wrong pick ends the question. We
        // reveal the correct tile so the player learns what it was, then
        // advance to a fresh 4-flag set. This keeps mistakes <= target,
        // which lets the result/stats screens render as "correct/target".
        wrongCount++;
        paintCounters();
        tile.classList.add('wrong');
        // Overlay the wrong-pick name on the tile (same strip pattern
        // as timed mode above) so the player sees what they clicked
        // even though they're focused on the now-revealed correct tile.
        tile.dataset.name = countryName(chosen);
        const correctTile = choicesEl.querySelector(`[data-code="${currentAnswer.code}"]`);
        if (correctTile) correctTile.classList.add('correct');
        disableAllTiles();
        progressBarEl.style.transform = `scaleX(${countModeProgressRatio(answeredCount, wrongCount, target)})`;
        // Map: the asked-about country (currentAnswer.code) is the one
        // the player missed — flag-fill + red-outline *that*, not the wrong
        // choice. The clicked-wrong tile's country may not have been asked
        // yet and shouldn't get pre-marked here.
        markCountry(currentAnswer.code, 'wrong');
        advanceTo(quiz.next(), 1200);
      }
    }

    /**
     * Paint the result screen's localized strings from `resultLabelData`.
     * No-op until showResult has populated the data. Idempotent —
     * `bestEl.textContent = …` wipes any prior "new record!" badge, and
     * the badge is re-appended on each call so a soft language switch
     * mid-result re-translates correctly.
     */
    function paintResultLabels() {
      if (!resultLabelData) return;
      const { isNew, best, elapsed, budgetUsed, gaveUp: rgaveUp } = resultLabelData;
      // What goes big, what colour it is, and what the quiet line says — all
      // decided in resultView.js, which is where the "which round earns the
      // clean-sweep screen" rule is tested. This function only paints.
      const view = quizResultView({
        modeKey: mode,
        answeredCount, wrongCount, target,
        budgetUsed, elapsedMs: elapsed, gaveUp: rgaveUp, best,
      });

      resultClearedEl.hidden = !view.clearedAll;
      resultClearedEl.querySelector('#result-cleared-label').textContent =
        t('quiz.clearedAll', 'Cleared every flag');

      finalScoreEl.textContent = view.headline;
      finalScoreLineEl.style.color = scoreColor(view.colorRatio);

      // "44 / 44 · record 0:53.467" on a clean sweep; "record 51" otherwise.
      const record = [
        t('quiz.record', 'record'),
        view.recordScore,
        view.recordTime && view.recordScore ? t('game.in', 'in') : null,
        view.recordTime,
      ].filter(Boolean).join(' ');
      resultRecordEl.textContent = view.detail ? `${view.detail} · ${record}` : record;

      if (isNew) {
        resultRecordEl.appendChild(document.createTextNode(' '));
        const badge = document.createElement('span');
        badge.className = 'new-badge';
        badge.textContent = t('game.newRecord', 'new record!');
        resultRecordEl.appendChild(badge);
      }
    }

    /**
     * Mount the inline share button at the end of the final-score line.
     * Touch-only (matches daily / findFlag / TTT) — desktop's OS share
     * sheet is heavy for what's conceptually "copy this URL", and a
     * silent clipboard path is too quiet to be discoverable, so we just
     * don't render the icon there. Click → shareUrl(currentURL, title +
     * "Can you beat me?"), with a 1.5 s `.copied` flash on clipboard
     * success.
     *
     * The current URL already encodes variant + mode (?v=…&n=…) so a
     * recipient lands on the exact same configuration.
     *
     * Idempotent — bails if the button already exists, so a hot re-paint
     * (lang switch) doesn't double-mount.
     *
     * @param {number} correct  Correct-answer count for this round.
     */
    function mountShareButton(correct) {
      const isTouchDevice = typeof window.matchMedia === 'function'
        && window.matchMedia('(pointer: coarse)').matches;
      if (!isTouchDevice) return;
      if (document.getElementById('result-share')) return;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'share-link';
      btn.id = 'result-share';
      btn.setAttribute('aria-label', t('quiz.share.aria', 'Share result'));
      const iconEl = document.createElement('span');
      iconEl.className = 'share-icon';
      iconEl.setAttribute('aria-hidden', 'true');
      btn.appendChild(iconEl);
      btn.onclick = async () => {
        const title = buildQuizShareTitle({
          template: t('quiz.share.title', 'Yet Another Quiz: {variant} {mode}, {score}'),
          variant: t(`variant.${key}`, VARIANTS[key].label),
          mode: t(`quiz.mode.${mode}`, mode),
          timed,
          correct,
          target,
        });
        const text = t('quiz.share.text', 'Can you beat me?');
        const r = await shareUrl(window.location.href, { title, text });
        if (r === 'copied') {
          btn.classList.add('copied');
          setTimeout(() => btn.classList.remove('copied'), 1500);
        }
        if (r === 'shared' || r === 'copied') {
          void ensureProfile(deviceId);
          // Feature S Phase 3: local counter + syncBlob push replaces
          // the engagementEvents POST. Achievement diff still reads
          // the server snapshot during the Phase 3 → Phase 4 window;
          // Phase 4 will rewire it to localStorage.
          bumpShare(window.localStorage, 'flagquiz');
          void pushEngagementBlob(deviceId, window.localStorage);
          void refreshAchievementsAndDiff(deviceId).then((newly) => {
            if (newly.length > 0) void celebrate(newly);
          });
        }
      };
      finalScoreLineEl.appendChild(btn);
    }

    function showResult() {
      cancelAnimationFrame(timerRaf);
      // Excludes anything spent with the settings tray open — a paused
      // round must not bank the pause as playing time, in either mode.
      const elapsed = playElapsedMs();

      // Global leaderboards exist only for the "All countries" variant — the
      // small player base left every continent board empty, and each continent
      // finish still cost a Free-tier Cosmos write. When false, both finish
      // branches skip the whole leaderboard cycle (no submit → no write, no
      // fetch → no board) and keep the panel hidden. Local PBs below are
      // recorded for every variant regardless.
      const hasLeaderboard = variantHasLeaderboard(key);

      if (timed) {
        // The headline and its colour are painted by `paintResultLabels`
        // below, off the view model — they used to be set here as well, which
        // meant a soft language switch re-derived them from one place and the
        // finish from another.
        //
        // Record "budget consumed", not wall clock — bounds at the
        // budget for time-outs, lower only when the pool exhausts under
        // budget. nextBest's lower-time tiebreaker then rewards
        // efficient rounds; a wall-clock metric would perversely favour
        // the round that burned more penalties. See timedBudgetUsedMs
        // docstring and tests for the contract.
        const budgetUsed = timedBudgetUsedMs({
          budgetMs, penaltyMs, elapsedMs: elapsed, wrongCount, gaveUp,
        });

        const { best, isNew } = recordResult(
          localStorage, key, mode, { score: answeredCount, time: budgetUsed },
        );
        resultLabelData = { isNew, best, elapsed, budgetUsed, gaveUp };
        paintResultLabels();
        // Cloud write on every finish (not just PBs): F5 added server-side
        // attempts + lastPlayedAt counters that depend on it. The chained
        // leaderboard fetch lands after the server's leaderboard write
        // completes so the just-played row is visible on this paint.
        void ensureProfile(deviceId);
        // Feature S Phase 3: 60s-mode finish records the Warsaw day on
        // the local day log (idempotent per day) and mirrors to the
        // syncBlob. Drives Sprint Habit / Steady Sprinter / Monthly
        // Sprinter / Quiz Centurion achievements — Phase 4 will rewire
        // the achievement evaluator to compute streak from this log
        // instead of the server snapshot.
        const engaged = madeAnyQuizPick({ answeredCount, wrongCount });
        const today60s = warsawDayNumber(Date.now());
        if (today60s !== null && engaged) {
          bumpQuiz60sDay(window.localStorage, today60s);
          void pushEngagementBlob(deviceId, window.localStorage);
        }
        let cycleP;
        if (hasLeaderboard) {
          const configKey = quizRecordConfigKey(key, mode);
          cycleP = runLeaderboardCycle({
            submitImpl: () => maybeSubmitQuizRecord({
              deviceId, configKey,
              score: answeredCount, durationMs: budgetUsed, lowerWins: false,
              isNew, engaged,
            }),
            fetchImpl: () => fetchLeaderboard({ configKey, deviceId, fresh: true }),
            paint: (s) => { leaderboardState = s; paintLeaderboard(); },
          });
        } else {
          // Continent variant: no board. Keep the panel hidden and resolve
          // so the achievement diff below still chains.
          leaderboardState = null;
          leaderboardEl.hidden = true;
          cycleP = Promise.resolve();
        }
        const { tier, intensity } = pickCelebration({
          found: answeredCount,
          // total isn't meaningful for 60s mode (the round ends when the
          // budget runs out, not when the pool is exhausted); isTimed
          // suppresses the sweep branch of pickCelebration so this
          // value is unused.
          total: 0,
          isTimed: true,
          isNew,
          prematurelyGaveUp: gaveUp,
        });
        runCelebration(tier, { intensity });
        // Achievement diff: chain off the leaderboard cycle so the
        // bypassCache fetch lands AFTER submitQuizRecord has settled
        // server-side (the cycle awaits the submit internally before
        // resolving). Uses the shared baseline so this finish and any
        // post-finish share / coffee click on the same page session
        // share one diff axis (no double-firing).
        void cycleP.then(async () => {
          const newly = await refreshAchievementsAndDiff(deviceId);
          if (newly.length > 0) void celebrate(newly);
        });
      } else {
        // Count mode is one-shot per question, so correct + wrong = target.
        // We still store wrongCount as best.score (lower-wins) for
        // backward-compat with nextBest's tiebreaker, but the display is
        // "correct/target" so the player reads it the same way as a
        // timed-mode score — see resultView.js, which owns that translation
        // along with the headline and its colour.
        const { best, isNew } = recordResult(
          localStorage, key, mode, { score: wrongCount, time: elapsed }, lowerScoreWins,
        );
        resultLabelData = { isNew, best, elapsed, budgetUsed: 0, gaveUp };
        paintResultLabels();
        void ensureProfile(deviceId);
        // No engagement counter for endurance-mode plays — pre-Phase-3
        // we wrote them defensively for a possible future achievement,
        // but Phase 3 dropped that speculation. Add a bumpQuizAllDay
        // call back if such an achievement actually lands.
        let cycleP;
        if (hasLeaderboard) {
          const configKey = quizRecordConfigKey(key, mode);
          const engaged = madeAnyQuizPick({ answeredCount, wrongCount });
          cycleP = runLeaderboardCycle({
            submitImpl: () => maybeSubmitQuizRecord({
              deviceId, configKey,
              score: wrongCount, durationMs: elapsed, lowerWins: true,
              isNew, engaged,
            }),
            fetchImpl: () => fetchLeaderboard({ configKey, deviceId, fresh: true }),
            paint: (s) => { leaderboardState = s; paintLeaderboard(); },
          });
        } else {
          // Continent variant: no board. Keep the panel hidden and resolve
          // so the achievement diff below still chains.
          leaderboardState = null;
          leaderboardEl.hidden = true;
          cycleP = Promise.resolve();
        }
        const { tier, intensity } = pickCelebration({
          found: answeredCount,
          total: target,
          isTimed: false,
          isNew,
          prematurelyGaveUp: gaveUp,
        });
        runCelebration(tier, { intensity });
        // Achievement diff — mirrors the 60s branch. Chains off the
        // leaderboard cycle so the bypassCache fetch lands AFTER
        // submitQuizRecord has settled server-side. Catches the
        // endurance tier (Marathon, World Tour, Iron Memory, Perfect
        // Round, All Countries Mastered, Endurance Atlas).
        void cycleP.then(async () => {
          const newly = await refreshAchievementsAndDiff(deviceId);
          if (newly.length > 0) void celebrate(newly);
        });
      }

      mountShareButton(answeredCount);

      // Re-parent the contour map section into the result panel, above the
      // leaderboard. It was mounted as a child of #game so the player sees
      // it filling in live; on finish we want the final pattern — or, if the
      // player hid the map, its collapsed toggle chip so they can still open
      // it for review — to sit next to the score recap instead of vanishing
      // with the play UI. No-op for variants with no map (section stays
      // hidden in #game).
      //
      // `.is-finished` is set only when the map is actually mounted — the
      // click handler reads it to open the flag-zoom popup. Map clicks are
      // ignored during play; once the round ends every country becomes a
      // review surface.
      if (flagMapEl && !flagMapEl.hidden) {
        resultEl.insertBefore(flagMapEl, leaderboardEl);
        if (mapMounted) {
          flagMapEl.classList.add('is-finished');
          // Zoom out to the whole filled-in board for review — the one and
          // only zoom-out, now that the round is over. Overrides the fly-in
          // that the final answer just started.
          if (mapZoomHandle) mapZoomHandle.animateReset({ durationMs: 640 });
        }
      }

      gameEl.hidden = true;
      progressBarEl.hidden = true;
      resultEl.hidden = false;
      // Keep the pill, drop the counters — see `.play-head.is-finished`.
      playHeadEl.classList.add('is-finished');
    }

    // Both "play again" links point at the round's own URL, which `launch`
    // has just written with replaceState — so they replay what you're
    // actually playing, not what you arrived on.
    playAgainEl.href = window.location.pathname + window.location.search;
    if (playAgainInlineEl) {
      playAgainInlineEl.href = window.location.pathname + window.location.search;
    }

    // Not `{ once: true }` any more: the listener has to be removable, because
    // a settings change replaces the round underneath it and the old closure
    // would otherwise still be holding a live reference to the dead round's
    // counters. `teardown` detaches it.
    function onGiveUp() {
      if (gameOver) return;
      gameOver = true;
      gaveUp = true;
      wrongCount = mistakesAfterGiveUp({ modeKey: mode, target, answeredCount, wrongCount });
      showResult();
    }
    if (giveUpEl) giveUpEl.addEventListener('click', onGiveUp);

    gameEl.hidden = false;
    paintCounters();
    tickTimer();
    render(quiz.next());

    return {
      /**
       * Freeze the round. The clock stops accruing (see `playElapsedMs`),
       * `onAnswer` stops accepting picks, and the board dims via the
       * `.is-tray-open` class the caller sets. Idempotent.
       */
      pause() {
        if (gameOver || pausedAt) return;
        pausedAt = Date.now();
      },
      /** Resume, banking however long the pause lasted. Idempotent. */
      resume() {
        if (!pausedAt) return;
        pausedMs += Date.now() - pausedAt;
        pausedAt = 0;
      },

      /**
       * Stop this round and give back every surface it had claimed, so
       * `launch` can start the next one into a clean page.
       *
       * This exists because settings changes stopped being navigations. A
       * page load used to be the teardown: new document, new listeners, new
       * timers. Everything below is one of those the browser used to do for
       * us — miss one and it leaks into the next round (a stray rAF driving
       * two clocks, a queued `advanceTo` painting a dead question, the map
       * of the pool you just left).
       */
      teardown() {
        gameOver = true;
        cancelAnimationFrame(timerRaf);
        if (revealRaf) { window.cancelAnimationFrame(revealRaf); revealRaf = 0; }
        window.clearTimeout(advanceTimer);
        if (mapZoomHandle) mapZoomHandle.teardown();
        mapZoomHandle = null;
        mapSvg = null;
        if (giveUpEl) giveUpEl.removeEventListener('click', onGiveUp);

        // The map section is re-parented into #result when a round ends;
        // put it back where the play screen expects it before the next
        // round mounts into it.
        if (flagMapEl && flagMapEl.parentElement === resultEl) {
          playBoardEl.appendChild(flagMapEl);
        }
        if (flagMapEl) flagMapEl.classList.remove('is-finished');

        // Result panel back to its unpainted state — otherwise finishing a
        // round, changing the pool, and finishing again would show the new
        // score under the old leaderboard.
        resultEl.hidden = true;
        leaderboardEl.hidden = true;
        leaderboardBodyEl.innerHTML = '';
        finalScoreLineEl.style.color = '';
        resultRecordEl.textContent = '';
        // The clean-sweep eyebrow is the one bit of the result panel that is
        // hidden rather than emptied, so it needs its own reset — a sweep
        // followed by an ordinary round would otherwise keep congratulating.
        resultClearedEl.hidden = true;
        const shareBtn = document.getElementById('result-share');
        if (shareBtn) shareBtn.remove();

        progressBarEl.hidden = false;
        progressBarEl.style.transform = 'scaleX(0)';
        playTimerEl.classList.remove('penalty', 'is-low');
      },

      /**
       * Soft language switch: re-translate every text surface this
       * game owns. Mid-round → the current country prompt re-paints
       * (the pill and tray are the caller's, and it repaints those).
       * Post-round → result screen labels re-paint from the captured
       * `resultLabelData`. The timer keeps running (in 60s mode this is
       * the intended behaviour — the lang flip doesn't pause the budget).
       */
      refreshI18n() {
        if (currentQ) paintPrompt(currentQ);
        paintResultLabels();
        // The share button itself stays mounted across a lang switch —
        // re-rendering it would clear any in-flight `.copied` flash and
        // the click handler reads t(…) fresh on each click anyway, so
        // the title/text already follow the live language. Only the
        // static aria-label needs an explicit re-paint.
        const shareBtn = document.getElementById('result-share');
        if (shareBtn) shareBtn.setAttribute('aria-label', t('quiz.share.aria', 'Share result'));
        // Re-paint the leaderboard panel so its labels ("Loading…",
        // empty-state copy, "You" suffix) come back in the new language.
        // Bails out if no leaderboard render has happened yet (refreshI18n
        // can fire mid-game before showResult sets leaderboardState).
        paintLeaderboard();
      },
    };
  }
}
