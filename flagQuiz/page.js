import {
  createQuiz,
  VARIANTS,
  MODES,
  availableModes,
  defaultModeFor,
  resolveMode,
  isTimedMode,
  timedRemainingMs,
  timedBudgetUsedMs,
  lowerScoreWins,
  accuracyRatio,
  formatTime,
  recordResult,
  scoreColor,
  poolFor,
  targetFor,
  artBaseFor,
  askKindFor,
  isQuizShowMap,
  setQuizShowMap,
  getQuizLastVariant,
  setQuizLastVariant,
  pickCelebration,
  shouldShowBestTime,
  mistakesAfterGiveUp,
  countModeProgressRatio,
  variantHasLeaderboard,
} from '../flags/quiz.js';
import { loadCountries } from '../flags/group.js';

/** @typedef {import('../flags/group.js').Country} Country */
import { t, countryName } from '../i18n.js';
import { runCelebration } from '../confetti.js';
import { buildQuizMenu } from './menu.js';
import { DECKS, deckOf, defaultVariantForDeck } from '../flags/decks.js';
import { deckIconHtml } from '../flags/deckIcons.js';
import { createFactsQuiz } from '../flags/factsQuiz.js';
import { SUPERLATIVE_METRICS } from '../flags/partyQuestions/superlativeCatalog.js';
import { METRIC_FILES } from '../flags/metrics/index.js';
import { METRIC_HUES, metricIconSpan } from '../flags/metricVisuals.js';
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
  const finalScoreLabelEl = document.getElementById('final-score-label');
  const finalScoreEl = document.getElementById('final-score');
  const timeEl = document.getElementById('time');
  const bestEl = document.getElementById('best');
  const leaderboardEl = document.getElementById('daily-leaderboard');
  const leaderboardTitleEl = document.getElementById('leaderboard-title');
  const leaderboardBodyEl = document.getElementById('leaderboard-body');
  const playTimerEl = document.getElementById('play-time');
  const playModeEl = document.getElementById('play-mode');
  const deckSideEl = document.getElementById('deck-side');
  const playAgainEl = /** @type {HTMLAnchorElement} */ (document.getElementById('play-again'));
  const progressBarEl = document.getElementById('progress-bar');
  const modeToggleEl = document.getElementById('mode-toggle');
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
  const urlVariant = params.get('v');
  const urlMode = params.get('n');
  // Resolution order: explicit ?v= deep-link → player's last saved
  // pick → first-visit picker. Last-pick memory means returning
  // players land on the category they actually play, not "All
  // countries" every time.
  const savedVariant = getQuizLastVariant(window.localStorage);
  const currentVariantKey = urlVariant && VARIANTS[urlVariant]
    ? urlVariant
    : (savedVariant ?? DEFAULT_VARIANT);
  // Persist the resolved variant so the next bare-/flagQuiz/ visit lands
  // here. Deep-link visits write through too — if a friend shares ?v=africa
  // and you play it, that becomes your last pick. Feature V deleted the
  // first-visit picker, so there is no longer a state where we withhold this:
  // a bare visit starts DEFAULT_VARIANT and saving that is the truth.
  setQuizLastVariant(window.localStorage, currentVariantKey);

  // Click-away + Escape close the deck popover, matching colorCountPicker's
  // behaviour. Bound once on the document rather than per-render, so
  // re-rendering the indicator each round can't stack listeners.
  //
  // MUST stay above the `return fetch(...)` below. These are statements, not
  // function declarations, so they don't hoist: sitting after the return they
  // were unreachable and the popover simply never closed. Nothing catches
  // that — it typechecks, it tests, it just quietly does nothing.
  document.addEventListener('click', () => {
    if (deckSideEl) deckSideEl.classList.remove('is-expanded');
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && deckSideEl) deckSideEl.classList.remove('is-expanded');
  });

  return fetch('../flags/countries.json')
    .then((r) => r.json())
    .then(loadCountries)
    .then((raw) => {

      // Re-buildable menu — rebuilds clear `menuEl.innerHTML` first so
      // a soft language switch doesn't double the variant list. The
      // nickname "Your name: …" item is re-inserted after each rebuild
      // for the same reason; without that, the first langchanged would
      // wipe it.
      // Set once the round starts (below); holds the live game's
      // language-refresh hook.
      /** @type {{ refreshI18n: () => void } | null} */
      let game = null;
      const rebuildMenu = () => {
        /** @type {HTMLUListElement} */ (quizMenuEl).innerHTML = '';
        buildQuizMenu(/** @type {HTMLUListElement} */ (quizMenuEl), raw, {
          relativeBase: '',
          currentVariantKey,
          currentMode: resolveMode(urlMode, poolFor(currentVariantKey, raw).length, currentVariantKey),
          statsCurrent: false,
        });
        mountNicknameMenuItem({
          rootEl: quizMenuEl,
          profileHref: '../profile/',
        });
      };
      rebuildMenu();


      const variantKey = currentVariantKey;
      let pool = poolFor(variantKey, raw);
      let modeKey = resolveMode(urlMode, pool.length, variantKey);

      // Facts is the one deck whose questions come from world-metric data, not
      // from the country list — so it (and only it) fetches the metric JSONs
      // before the round can start. Every other deck starts synchronously.
      const startWith = (factsMetrics) => {
        game = startGame(variantKey, modeKey, raw, factsMetrics);
        document.addEventListener('langchanged', () => {
          rebuildMenu();
          game.refreshI18n();
        });
      };
      if (askKindFor(variantKey) === 'superlative') {
        return loadFactsMetrics().then(startWith);
      }
      startWith(null);
      return undefined;
    })
    .catch((err) => {
      document.body.textContent = `${t('game.failedToLoad', 'Failed to load:')} ${err.message}`;
    });

  /**
   * The play row's deck indicator: one icon, plus a popover to change deck.
   *
   * Mechanism is `.color-count-side` / `.color-count-options` from common.css
   * — the same dropdown `colorCountPicker.js` uses — rather than a new
   * component. The parked design called for exactly that promotion.
   *
   * No affordance by design (Jan: "it does not need to indicate that its
   * clickable... we can keep screen cleaner"). That's sound only because the
   * burger remains a full path to every deck: this is a shortcut, and anyone
   * who never discovers it loses nothing.
   *
   * @param {string} key   current variant
   * @param {string} mode  current mode, preserved across a deck switch when legal
   * @param {Country[]} raw  the full country list (this fn is defined outside
   *   the fetch closure, so it can't close over it)
   */
  /**
   * Fetch every catalog metric's values file, tolerantly — a file that fails to
   * load just drops that one metric from the deck, the way flagParty treats a
   * failed metric fetch. JSON is FETCHED, never imported: `superlative.js` can
   * import it because it only runs on the server, but this is the browser, and a
   * static JSON import ships a blank page (#767). Returns `{ entry, data }[]`.
   *
   * @returns {Promise<Array<{ entry: any, data: any }>>}
   */
  function loadFactsMetrics() {
    const fileByKey = Object.fromEntries(METRIC_FILES.map((m) => [m.key, m.file]));
    return Promise.all(SUPERLATIVE_METRICS.map((entry) =>
      fetch(`../flags/metrics/${fileByKey[entry.key]}`)
        .then((r) => r.json())
        .then((data) => ({ entry, data }))
        .catch(() => null)))
      .then((list) => /** @type {Array<{ entry: any, data: any }>} */ (list.filter(Boolean)));
  }

  function renderDeckIndicator(key, mode, raw) {
    if (!deckSideEl) return;
    const active = deckOf(key);
    deckSideEl.innerHTML = '';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'deck-ind';
    btn.innerHTML = deckIconHtml(active, { className: 'deck-ind-art' });
    btn.setAttribute('aria-label', t('menu.deck', 'Deck') + ': ' + t(`deck.${active}`, active));
    btn.setAttribute('aria-expanded', 'false');
    deckSideEl.appendChild(btn);

    const opts = document.createElement('span');
    opts.className = 'deck-options';
    for (const deck of DECKS) {
      const to = defaultVariantForDeck(deck.id);
      if (!to) continue;
      const pool = poolFor(to, raw);
      // Keep the player's mode across the switch when the target deck allows
      // it; fall back to that deck's default rather than dead-ending. Threading
      // `to` matters for Facts: it's 60s-only, so a player in `all` mode landing
      // on the Facts pill must get `n=60s`, not a self-correcting `n=all` link.
      const modes = availableModes(pool.length, to);
      const nextMode = modes.includes(mode) ? mode : defaultModeFor(pool.length, to);
      if (nextMode === null) continue;
      const a = document.createElement('a');
      a.className = 'deck-opt';
      a.href = `?v=${deck.id === active ? key : to}&n=${nextMode}`;
      a.title = t(`deck.${deck.id}`, deck.label);
      if (deck.id === active) a.setAttribute('aria-current', 'true');
      a.innerHTML = deckIconHtml(deck.id, { className: 'deck-opt-art' });
      opts.appendChild(a);
    }
    deckSideEl.appendChild(opts);

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = deckSideEl.classList.toggle('is-expanded');
      btn.setAttribute('aria-expanded', String(open));
    });
  }

  function renderModeToggle(key, mode, modes) {
    modeToggleEl.innerHTML = '';
    if (modes.length < 2) return;
    modes.forEach((m, i) => {
      if (i > 0) {
        const sep = document.createElement('span');
        sep.className = 'mode-sep';
        sep.textContent = '|';
        modeToggleEl.appendChild(sep);
      }
      const label = t(`quiz.mode.${m}`, m);
      if (m === mode) {
        const span = document.createElement('span');
        span.className = 'mode-current';
        span.textContent = label;
        modeToggleEl.appendChild(span);
      } else {
        const a = document.createElement('a');
        a.href = `?v=${key}&n=${m}`;
        a.textContent = label;
        modeToggleEl.appendChild(a);
      }
    });
  }

  function startGame(key, mode, raw, factsMetrics) {
    const pool = poolFor(key, raw);
    const target = targetFor(mode, pool);
    // What the prompt asks: a country name (every deck) or a superlative
    // criterion (Facts). Facts draws its questions from world-metric data rather
    // than the pool, so it uses a different source — same shape, so the round
    // loop below is unchanged.
    const ask = askKindFor(key);
    const quiz = ask === 'superlative'
      ? createFactsQuiz({ metrics: /** @type {any} */ (factsMetrics) || [], pool })
      : createQuiz(pool, target);
    const timed = isTimedMode(mode);
    const modeDef = MODES[mode];
    const budgetMs = timed && modeDef.kind === 'timed' ? modeDef.budgetMs : 0;
    const penaltyMs = timed && modeDef.kind === 'timed' ? modeDef.penaltyMs : 0;
    const modes = availableModes(pool.length, key);
    // What this deck's choice tiles are made of. Outlines deals contour
    // silhouettes from a different directory; every other deck deals flags.
    const artBase = artBaseFor(key);
    // The scope label keeps its original job: it says WHERE you are, and is
    // empty on a deck's default variant so the row stays quiet. The deck
    // indicator beside it says WHICH GAME — the one thing the screen can't
    // otherwise tell you, since Flags and Weird flags render identically.
    playModeEl.textContent = key === defaultVariantForDeck(deckOf(key))
      ? ''
      : t(`variant.${key}`, VARIANTS[key].label);
    renderDeckIndicator(key, mode, raw);
    renderModeToggle(key, mode, modes);

    let currentAnswer = null;
    let wrongCount = 0;
    let answeredCount = 0;
    let gameOver = false;
    let gaveUp = false;
    const startTime = Date.now();
    let timerRaf = 0;

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
     * Single entry point for the in-map toggle chip. Persists the choice to
     * the shared `gridgame.flagquiz.showMap` key and applies it live. The
     * chip on the map (a "show" chip even on the collapsed strip) is the
     * only show/hide control, so there's no burger toggle to keep in sync.
     * @param {boolean} show
     */
    function applyMapPreference(show) {
      setQuizShowMap(localStorage, show);
      setMapVisible(show);
    }

    // Initial paint: for any variant that has a map, show the live map or
    // the collapsed toggle chip per the saved preference. Variants with no
    // map asset leave the section hidden.
    if (QUIZ_MAP_CONFIG[key]) {
      if (isQuizShowMap()) mountMap();
      else renderCollapsedMap();
    }

    // Result-screen data is captured once when showResult fires so a
    // soft language switch can re-paint the localized labels (Final
    // score, Your best score, Time, new record) without re-running
    // recordResult or re-firing the celebration. Null until the game
    // ends; refreshI18n's `paintResultLabels` no-ops until then.
    /** @type {{ timed: boolean, isNew: boolean, best: { score: number, time: number }, elapsed: number, budgetUsed: number, gaveUp: boolean } | null} */
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
      // Drop the flash class once the keyframes finish, so the next
      // wrong click can restart the animation cleanly via reflow.
      playTimerEl.addEventListener('animationend', () => {
        playTimerEl.classList.remove('penalty');
      });
    }

    function flashPenalty() {
      playTimerEl.classList.remove('penalty');
      // Force a reflow so the re-added class triggers the animation again
      // even if a previous flash is still mid-flight.
      void playTimerEl.offsetWidth;
      playTimerEl.classList.add('penalty');
    }

    function tickTimer() {
      if (timed) {
        const elapsedMs = Date.now() - startTime;
        const remaining = timedRemainingMs({ budgetMs, penaltyMs, elapsedMs, wrongCount });
        playTimerEl.textContent = formatTime(remaining);
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
        playTimerEl.textContent = formatTime(Date.now() - startTime);
      }
      timerRaf = requestAnimationFrame(tickTimer);
    }

    function countScore() {
      return Math.max(0, target - wrongCount);
    }

    /**
     * Paint the prompt line for a question. Country decks name the country
     * (`#country-name` is a plain string); Facts asks a superlative criterion,
     * led by the metric's icon and tinted with its hue — the same per-metric
     * identity Flag Party's prompt wears, from the same `metricVisuals` source.
     * Split out so the language-switch refresh re-paints it the same way.
     * @param {any} q
     */
    function paintPrompt(q) {
      if (ask === 'superlative') {
        countryNameEl.classList.add('superlative');
        countryNameEl.style.setProperty('--mc', METRIC_HUES[q.prompt.metricKey] || 'currentColor');
        countryNameEl.innerHTML = '';
        countryNameEl.appendChild(metricIconSpan(q.prompt.metricKey, 'facts-prompt-ic'));
        const label = document.createElement('span');
        label.textContent = t(q.prompt.hint.key, q.prompt.hint.fallback);
        countryNameEl.appendChild(label);
      } else {
        countryNameEl.textContent = countryName(q.answer);
      }
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
        img.src = `${artBase}${c.code}.svg`;
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
          new Image().src = `${artBase}${c.code}.svg`;
        }
      }
    }

    function disableAllTiles() {
      for (const t of choicesEl.querySelectorAll('.flag-choice')) {
        /** @type {HTMLButtonElement} */ (t).disabled = true;
      }
    }

    function advanceTo(nextQ, delayMs) {
      if (!nextQ) {
        setTimeout(() => {
          if (!gameOver) {
            gameOver = true;
            showResult();
          }
        }, delayMs);
      } else {
        setTimeout(() => { if (!gameOver) render(nextQ); }, delayMs);
      }
    }

    function onAnswer(chosen, tile) {
      if (gameOver) return;
      if (chosen.code === currentAnswer.code) {
        answeredCount++;
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
      const { timed: t_, isNew, best, elapsed, budgetUsed, gaveUp: rgaveUp } = resultLabelData;
      finalScoreLabelEl.textContent = t('quiz.finalScore', 'Final score:');
      if (t_) {
        // Show "Time" only when the pool exhausted under budget — for a
        // time-out the value is always the budget itself, which the mode
        // label already tells the player. shouldShowBestTime is the
        // shared gate; flagQuiz/stats uses the same function. Also
        // suppressed on give-up: the elapsed time before quitting isn't
        // a meaningful result.
        timeEl.textContent = !rgaveUp && shouldShowBestTime(mode, { time: budgetUsed })
          ? `${t('game.time', 'Time')}: ${formatTime(budgetUsed)}`
          : '';
        bestEl.textContent = shouldShowBestTime(mode, best)
          ? `${t('quiz.yourBestScore', 'Your best score')}: ${best.score} ${t('game.in', 'in')} ${formatTime(best.time)}`
          : `${t('quiz.yourBestScore', 'Your best score')}: ${best.score}`;
      } else {
        // Same give-up suppression in count mode — the elapsed time of a
        // give-up round (often < 2s) is misleading next to the score.
        timeEl.textContent = rgaveUp
          ? ''
          : `${t('game.time', 'Time')}: ${formatTime(elapsed)}`;
        const bestCorrect = Math.max(0, target - best.score);
        bestEl.textContent =
          `${t('quiz.yourBestScore', 'Your best score')}: ${bestCorrect}/${target} ${t('game.in', 'in')} ${formatTime(best.time)}`;
      }
      if (isNew) {
        bestEl.appendChild(document.createTextNode(' '));
        const badge = document.createElement('span');
        badge.className = 'new-badge';
        badge.textContent = t('game.newRecord', 'new record!');
        bestEl.appendChild(badge);
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
      const elapsed = Date.now() - startTime;

      // Global leaderboards exist only for the "All countries" variant — the
      // small player base left every continent board empty, and each continent
      // finish still cost a Free-tier Cosmos write. When false, both finish
      // branches skip the whole leaderboard cycle (no submit → no write, no
      // fetch → no board) and keep the panel hidden. Local PBs below are
      // recorded for every variant regardless.
      const hasLeaderboard = variantHasLeaderboard(key);

      if (timed) {
        // Score = flags answered correctly. There's no "out of target"
        // ratio to colour by, so tint by accuracy (correct vs total picks):
        // a clean sweep is green, a 50/50 round is amber, all-wrong is red.
        const totalPicks = answeredCount + wrongCount;
        const ratio = totalPicks === 0 ? 0 : answeredCount / totalPicks;
        finalScoreEl.textContent = String(answeredCount);
        finalScoreLineEl.style.color = scoreColor(ratio);

        // Record "budget consumed", not wall clock — bounds at the
        // budget for time-outs, lower only when the pool exhausts under
        // budget. nextBest's lower-time tiebreaker then rewards
        // efficient rounds; a wall-clock metric would perversely favour
        // the round that burned more penalties. See timedBudgetUsedMs
        // docstring and tests for the contract.
        const budgetUsed = timedBudgetUsedMs({
          budgetMs, penaltyMs, elapsedMs: elapsed, wrongCount,
        });

        const { best, isNew } = recordResult(
          localStorage, key, mode, { score: answeredCount, time: budgetUsed },
        );
        resultLabelData = { timed: true, isNew, best, elapsed, budgetUsed, gaveUp };
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
        // timed-mode score. Colour tint stays accuracy-based.
        finalScoreEl.textContent = `${answeredCount}/${target}`;
        finalScoreLineEl.style.color = scoreColor(accuracyRatio(wrongCount, target));

        const { best, isNew } = recordResult(
          localStorage, key, mode, { score: wrongCount, time: elapsed }, lowerScoreWins,
        );
        resultLabelData = { timed: false, isNew, best, elapsed, budgetUsed: 0, gaveUp };
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
    }

    playAgainEl.href = window.location.pathname + window.location.search;
    if (playAgainInlineEl) {
      playAgainInlineEl.href = window.location.pathname + window.location.search;
    }

    if (giveUpEl) {
      giveUpEl.addEventListener('click', () => {
        if (gameOver) return;
        gameOver = true;
        gaveUp = true;
        wrongCount = mistakesAfterGiveUp({ modeKey: mode, target, answeredCount, wrongCount });
        showResult();
      }, { once: true });
    }

    gameEl.hidden = false;
    tickTimer();
    render(quiz.next());

    return {
      /**
       * Soft language switch: re-translate every text surface this
       * game owns. Mid-round → play-mode label + mode-toggle links +
       * the current country prompt re-paint. Post-round → result
       * screen labels re-paint from the captured `resultLabelData`.
       * The timer keeps running (in 60s mode this is the intended
       * behaviour — the lang flip doesn't pause the budget).
       */
      refreshI18n() {
        playModeEl.textContent = t(`variant.${key}`, VARIANTS[key].label);
        renderModeToggle(key, mode, modes);
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
