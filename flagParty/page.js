import { t, countryName } from '../i18n.js';
import { generateCode, isValidRoomCode, serverUrlFor } from '../flags/roomNet.js';
import { deckIconHtml } from '../flags/deckIcons.js';
import { getOrCreateDeviceId } from '../flags/identity.js';
import { displayNickname } from '../flags/nickname.js';
import { loadCountries } from '../flags/group.js';
import { initialPartyClientState, reducePartyMessage, withLocalBuzz, pickPartyCelebration, isCleanReveal } from '../flags/partyClient.js';
import { runCelebration } from '../confetti.js';
import { CORRECT_POINTS, SPEED_BONUS, FINAL_ROUND_MULTIPLIER } from '../flags/partyScore.js';
import { QUESTION_SECONDS, revealSecondsFor, ROUND_BREAK_SECONDS, ROUND_INTRO_SECONDS, PICK_TIMEOUT_SECONDS, secondsLeft, remainingFraction, veilProgress, namesRevealed, isMetricQuestion, veilActive as veilActiveFor, DEFAULT_REVEAL, LEDGER_COUNT_MS, LEDGER_ENTER_STAGGER_MS, ledgerSchedule } from '../flags/partyTiming.js';
import { ROUND_QUESTIONS, METRIC_MODES, PARTY_MODES, isRoundBoundary, isRoundStart, isFinalRound, roundIndexAt, roundCount } from '../flags/partyPlan.js';
import { roundBreak } from '../flags/partyBreak.js';
import { emptyTally, addQuestionToTally, chipsFor } from '../flags/partyRoundTally.js';
import { formatValue } from '../flags/metricLens.js';
import { METRIC_ICONS, METRIC_HUES, METRIC_SHORT } from '../flags/metricVisuals.js';
import { METRIC_FILES } from '../flags/metrics/index.js';
import { SUPERLATIVE_METRICS, superlativeMetricByQuestionId, hintFor } from '../flags/partyQuestions/superlativeCatalog.js';
import { roundCountFor, validatePicksPerPlayer, canVeilMode, PICKS_PER_PLAYER_OPTIONS, DEFAULT_PICKS_PER_PLAYER } from '../flags/partyDraft.js';
import { renderableQuestionIds, questionRenderAction, canRenderQuestion } from './staleGuard.js';
import { buildAvatar, shareUrl } from '../common.js';

/** @typedef {import('../flags/partyClient.js').PartyClientState} PartyClientState */

const NICKNAME_KEY = 'gridgame.nickname';
// How many rounds each player picks (1-4). The game's length follows from it
// and the seat count, so this is the only thing the host stores.
//
// The host-built "Custom setup" door was retired: it stored a plan, a tricky
// toggle and per-category reveal timing (`gridgame.party.{setup,plan,tricky,
// reveal,mode}`). Draft is the only way a game starts now, so the plan comes
// from the players' picks and the veil timing is a fixed constant
// (DEFAULT_REVEAL). Those five keys are dead — left unread rather than migrated,
// since nothing in the draft flow has a use for what they held.
const PICKS_KEY = 'gridgame.party.picksPerPlayer';

/** Scattered reveal order for the six tricky-mode veil panels, so the flag
 *  materialises in patches rather than strictly left-to-right (which would give
 *  a flag away by which side lights up first). Indexes the 3×2 cover grid. */
const VEIL_ORDER = [0, 4, 2, 5, 1, 3];

/** Lobby copy for each catalog mode (`flags/partyPlan.js` PARTY_MODES). The
 *  catalog stays pure (ids only); labels live here, translated via i18n with the
 *  English text as the fallback. `full` shows in the dial row, `short` in the
 *  collapsed summary mix. */
const MODE_LABELS = {
  'flags-all': { key: 'party.mode.flagsAll', full: 'Flags: countries', shortKey: 'party.modeShort.flagsAll', short: 'Flags' },
  'flags-weird': { key: 'party.mode.flagsWeird', full: 'Weird flags', shortKey: 'party.modeShort.flagsWeird', short: 'Weird' },
  'map-outlines': { key: 'party.mode.mapOutlines', full: 'Map: outlines', shortKey: 'party.modeShort.mapOutlines', short: 'Maps' },
  'superlative-pop': { key: 'party.mode.superlativePop', full: 'Population: most & least' },
  'superlative-area': { key: 'party.mode.superlativeArea', full: 'Land area: largest & smallest' },
  'superlative-density': { key: 'party.mode.superlativeDensity', full: 'Population density: most & least' },
  'superlative-gdp': { key: 'party.mode.superlativeGdp', full: 'GDP: largest & smallest' },
  'superlative-gdppc': { key: 'party.mode.superlativeGdppc', full: 'GDP per capita: largest & smallest' },
  'superlative-coffee': { key: 'party.mode.superlativeCoffee', full: 'Coffee production: most' },
  'superlative-wine': { key: 'party.mode.superlativeWine', full: 'Wine production: most' },
  'superlative-cocoa': { key: 'party.mode.superlativeCocoa', full: 'Cocoa production: most' },
  'superlative-banana': { key: 'party.mode.superlativeBanana', full: 'Banana production: most' },
  'superlative-apple': { key: 'party.mode.superlativeApple', full: 'Apple production: most' },
  'superlative-elevation': { key: 'party.mode.superlativeElevation', full: 'Highest elevation: highest & lowest' },
  'superlative-coastline': { key: 'party.mode.superlativeCoastline', full: 'Coastline length: longest & shortest' },
  'superlative-forest': { key: 'party.mode.superlativeForest', full: 'Forest cover: most & least forested' },
  'superlative-oil': { key: 'party.mode.superlativeOil', full: 'Oil production: most' },
  'superlative-rice': { key: 'party.mode.superlativeRice', full: 'Rice production: most' },
  'superlative-coal': { key: 'party.mode.superlativeCoal', full: 'Coal production: most' },
  'superlative-sheep': { key: 'party.mode.superlativeSheep', full: 'Sheep per capita: most' },
  'superlative-cattle': { key: 'party.mode.superlativeCattle', full: 'Cattle per capita: most' },
  'superlative-beer': { key: 'party.mode.superlativeBeer', full: 'Beer consumption per capita: most' },
  'superlative-tea': { key: 'party.mode.superlativeTea', full: 'Tea production: most' },
  'superlative-sugarcane': { key: 'party.mode.superlativeSugarcane', full: 'Sugarcane production: most' },
  'superlative-gold': { key: 'party.mode.superlativeGold', full: 'Gold production: most' },
  'superlative-alcohol': { key: 'party.mode.superlativeAlcohol', full: 'Alcohol consumption per capita: most' },
  'superlative-meat': { key: 'party.mode.superlativeMeat', full: 'Meat consumption per capita: most' },
  'superlative-borders': { key: 'party.mode.superlativeBorders', full: 'Bordering countries: most' },
  'superlative-olive-oil': { key: 'party.mode.superlativeOliveOil', full: 'Olive oil production: most' },
  'superlative-honey': { key: 'party.mode.superlativeHoney', full: 'Honey production: most' },
  'superlative-temperature': { key: 'party.mode.superlativeTemperature', full: 'Average temperature: hottest & coldest' },
  'superlative-happiness': { key: 'party.mode.superlativeHappiness', full: 'Happiness score: happiest & least happy' },
  'superlative-corruption': { key: 'party.mode.superlativeCorruption', full: 'Government integrity: most & least corrupt' },
  'superlative-tourism': { key: 'party.mode.superlativeTourism', full: 'Tourist arrivals per capita: most' },
  'superlative-electricity': { key: 'party.mode.superlativeElectricity', full: 'Electricity use per capita: most' },
};


/** Every question id this build can render: the two fixed picture questions plus every
 *  superlative metric question in the catalog. The server (PartyKit, its own
 *  deploy) can be a build ahead of a still-open tab and deal a question id outside
 *  this set; when that happens {@link questionRenderAction} reloads us onto the new
 *  build rather than rendering a broken question. See `flagParty/staleGuard.js`. */
const KNOWN_QUESTION_IDS = renderableQuestionIds(SUPERLATIVE_METRICS.map((m) => m.questionId));

/** Little pictures leading each draft hand card, distinct enough to tell apart at
 *  a glance. The artwork is shared with flagQuiz's deck indicator via
 *  `flags/deckIcons.js` — promoted there when that second consumer arrived
 *  (Feature V). Sizing is the card's: `.pick-card-ic img` in index.css. These
 *  classes carry no rules of their own — they used to size the retired setup
 *  panel's 24x24 rows, and are kept only because the shared module requires a
 *  class name (it deliberately ships artwork without sizing so each consumer
 *  brings its own box).
 *
 *  Keyed by party mode id, which is not the deck id — this table is the
 *  mapping. Injected as innerHTML, so `<img>` and inline `<svg>` both work. */
const MODE_ICONS = {
  'flags-all': deckIconHtml('flags', { className: 'mode-thumb' }),
  'flags-weird': deckIconHtml('weird', { className: 'mode-thumb' }),
  'map-outlines': deckIconHtml('outlines', { className: 'mode-contour' }),
};

/** Metric key (the flags/metrics registry) for a superlative question id. The
 *  catalog states it outright now — it used to be resolved the long way question,
 *  via the values file both registries happened to name.
 *
 *  Feeds the shared per-metric icon + hue (flags/metricVisuals.js) so the party
 *  chips, the prompt lead, and the flagsdata / findFlag metric hub all wear one
 *  visual identity. Covers the population question's legacy `superlative` questionId
 *  (its mode id is `superlative-pop`) like everything else, because the catalog
 *  is keyed by questionId — an older question-id-keyed icon table missed exactly that
 *  case and rendered population prompts with no icon or hue.
 *
 *  @param {string} questionId @returns {string | null} */
function metricKeyForQuestion(questionId) {
  const m = superlativeMetricByQuestionId(questionId);
  return m ? m.key : null;
}

/** Values file for a metric key, for the reveal strip's fetch. */
const METRIC_FILE_BY_KEY = Object.fromEntries(METRIC_FILES.map((m) => [m.key, m.file]));

/** Party mode id -> catalog mode, so the draft's hand cards and round attribution
 *  resolve a mode id to its question type (for the icon) and label. */
const MODE_BY_ID = Object.fromEntries(PARTY_MODES.map((m) => [m.id, m]));

/** The icon HTML for a draft card: the picture thumbnail for a picture mode, or
 *  the metric's own icon for a statistic. Empty string if unknown. */
function modeIconHtml(/** @type {string} */ modeId) {
  if (MODE_ICONS[modeId]) return MODE_ICONS[modeId];
  const mode = MODE_BY_ID[modeId];
  if (!mode) return '';
  const key = metricKeyForQuestion(mode.questionId);
  return (key && METRIC_ICONS[key]) || '';
}

/** The per-metric hue for a statistic mode (for the draft card accent), or null. */
function modeHue(/** @type {string} */ modeId) {
  const mode = MODE_BY_ID[modeId];
  if (!mode) return null;
  const key = metricKeyForQuestion(mode.questionId);
  return (key && METRIC_HUES[key]) || null;
}

/** The icon HTML for a **round title card** — the same artwork as {@link
 *  modeIconHtml} but at the card's hero size (its own classes rather than the
 *  setup row's tiny slot). Empty string for an unknown mode (the caller shows a
 *  generic Flags card instead). */
function roundCardIconHtml(/** @type {string} */ modeId) {
  if (modeId === 'flags-all') return deckIconHtml('flags', { className: 'roundcard-thumb' });
  if (modeId === 'flags-weird') return deckIconHtml('weird', { className: 'roundcard-thumb' });
  if (modeId === 'map-outlines') return deckIconHtml('outlines', { className: 'roundcard-contour' });
  const mode = MODE_BY_ID[modeId];
  const key = mode ? metricKeyForQuestion(mode.questionId) : null;
  return (key && METRIC_ICONS[key]) || '';
}

/**
 * Resolve a mode's SHORT label to `{ key, fallback }` — pure, no `t()` — so the
 * mapping can be pinned by a test. **`modeShortLabel` currently has no production
 * caller** — its `t()` wrapper died with the custom-setup panel, and the round
 * card reaches the short i18n keys directly (`t('party.modeShort.flagsAll', …)`)
 * rather than through this resolver. It is kept because `modeLabels.test.js` pins
 * that every catalog mode resolves to a defined short key, which is the check that
 * caught the undefined-key lobby crash; delete it only together with that suite. Metric modes take their short name from METRIC_SHORT keyed off the
 * QUESTION id, which differs from the mode id for population ('superlative-pop' vs
 * questionId 'superlative'); picture modes fall back to their own MODE_LABELS
 * `shortKey`. A mode that resolves to neither returns `{ key: undefined }`,
 * which `flagParty/modeLabels.test.js` asserts can never happen — that gap is
 * exactly what crashed the lobby (an undefined key reached `t()` → `.split`).
 *
 * @param {string} id  a PICTURE_MODES / METRIC_MODES mode id
 * @returns {{ key: string | undefined, fallback: string | undefined }}
 */
export function modeShortLabel(id) {
  const mode = METRIC_MODES.find((m) => m.id === id);
  const metricKey = metricKeyForQuestion(mode ? mode.questionId : id);
  const short = metricKey ? METRIC_SHORT[metricKey] : null;
  if (short) return { key: short.key, fallback: short.fallback };
  const ml = MODE_LABELS[id];
  return { key: ml && ml.shortKey, fallback: ml && ml.short };
}

/**
 * Resolve a mode's FULL label to `{ key, fallback }` — pure sibling of
 * {@link modeShortLabel}. Every mode has a MODE_LABELS entry with `key` + `full`.
 *
 * @param {string} id
 * @returns {{ key: string | undefined, fallback: string | undefined }}
 */
export function modeFullLabel(id) {
  const ml = MODE_LABELS[id];
  return { key: ml && ml.key, fallback: ml && ml.full };
}

/**
 * Which catalog mode a round's title card should announce, resolved from what the
 * client actually knows about the round.
 *
 * - **Drafted round** (`lastPick` present) → the exact picked mode id, so a stat
 *   round names its specific metric ("Coffee production") and a flag round names
 *   its pool ("Flags: countries" vs "Flags: others"). This is the precise path,
 *   and the only one in a Draft game.
 * - **Opening round** (no `lastPick` — the server-dealt Flags round every draft
 *   starts with) → derived from the question's
 *   `questionId`, which is 1:1 with a mode for the map question and every superlative
 *   metric (`superlative-coffee` etc.). The one exception is the two flag pools,
 *   which **share** `questionId: 'flagPick'` and so can't be told apart from the wire
 *   alone → returns `null`, the caller's cue to show a generic "Flags" card.
 * - Unknown / unrenderable question id → `null` (generic), though the stale-build
 *   guard means such a question never reaches the card anyway.
 *
 * @param {{ picker: string, modeId: string } | null | undefined} lastPick
 * @param {string | undefined} questionId
 * @returns {string | null}  a PARTY_MODES mode id, or null for the generic case
 */
export function roundModeId(lastPick, questionId) {
  if (lastPick && lastPick.modeId && MODE_BY_ID[lastPick.modeId]) return lastPick.modeId;
  if (questionId === 'flagPick') return null; // ambiguous pool → generic Flags card
  const mode = PARTY_MODES.find((m) => m.questionId === questionId);
  return mode ? mode.id : null;
}

/**
 * Boot the Flag Party page: resolve identity, wire the lobby controls, open
 * the WebSocket, and re-render on every server message. Kept thin — all game
 * rules live in the pure modules (`flags/partyRoom.js`, `partyScore.js`,
 * `partyClient.js`); this is DOM + socket glue.
 */
export function bootFlagParty() {
  const deviceId = getOrCreateDeviceId(window.localStorage, () => window.crypto.randomUUID());
  let cachedNick = null;
  try { cachedNick = window.localStorage.getItem(NICKNAME_KEY); } catch { /* private mode */ }
  const myName = displayNickname(deviceId, cachedNick);

  const SERVER_URL = serverUrlFor(window.location.hostname, 'party');

  /** @type {PartyClientState} */
  let state = initialPartyClientState();
  /** @type {{ code: string, intent: 'create' | 'join' } | null} */
  let activeRoom = null;
  /** playerId of the room's host, learned from welcome (self) / roster (hostId). */
  let roomHostId = /** @type {string | null} */ (null);
  /** @type {WebSocket | null} */
  let ws = null;
  let rejected = false;
  let reconnectAttempts = 0;
  let reconnectTimer = 0;
  /** Fire the finish celebration (confetti / fireworks) exactly once per final
   *  screen. render() re-runs on every message and on a language switch, so a
   *  guard keeps the burst from re-triggering; reset when we leave the final
   *  phase (a "Play again" question → final fires a fresh show). */
  let finalCelebrated = false;

  // ---- element refs ----
  const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));
  const statusEl = $('party-status');
  const sections = {
    start: $('pt-start'), lobby: $('pt-lobby'), question: $('pt-question'), roundcard: $('pt-roundcard'), pick: $('pt-pick'), break: $('pt-break'), final: $('pt-final'),
  };
  const roomCodeEl = $('room-code');
  const playersEl = $('players');
  const startBtn = /** @type {HTMLButtonElement} */ ($('start-game'));
  const waitEl = $('lobby-wait');
  const questionPill = $('question-pill');
  const timerEl = $('question-timer');
  const timerFill = $('question-timer-fill');
  const timerLabel = $('question-timer-label');
  const promptEl = $('prompt');
  const promptLead = $('prompt-lead');
  const promptTarget = $('prompt-target');
  const gridEl = $('flags-grid');
  const footEl = $('question-foot');
  const finalSub = $('final-sub');
  const finalBoard = $('final-board');
  const breakPill = $('break-pill');
  const breakMvp = $('break-mvp');
  const breakStandingsLabel = $('break-standings-label');
  const breakBoard = $('break-board');
  const roundCardCount = $('roundcard-count');
  const roundCardIc = $('roundcard-ic');
  const roundCardName = $('roundcard-name');
  const roundCardQuestions = $('roundcard-questions');
  const roundCardPick = $('roundcard-pick');
  const roundCardDouble = $('roundcard-double');
  const draftLengthEl = $('draft-length');
  const draftLengthHint = $('draft-length-hint');
  const draftPickBtns = /** @type {HTMLButtonElement[]} */ (
    [...draftLengthEl.querySelectorAll('.dl-pick')]);
  const pickPill = $('pick-pill');
  const pickLead = $('pick-lead');
  const pickHand = $('pick-hand');
  const pickWatch = $('pick-watch');
  const pickBoard = $('pick-board');
  const playAgainBtn = /** @type {HTMLButtonElement} */ ($('play-again'));
  const questionToSettingsBtn = /** @type {HTMLButtonElement} */ ($('question-to-settings'));
  const joinError = $('join-error');
  const shareBtn = /** @type {HTMLButtonElement} */ ($('share-btn'));
  // Invite icon is touch-only, same as Tic-Tac-Toe: on phones/tablets copying
  // the URL bar is fiddly and the native share sheet (WhatsApp etc.) is the
  // point; desktop users have ctrl-L + ctrl-C, so the room code alone suffices.
  // Hiding it lets the shared `.room-line:has(.share-link:not([hidden]))` rule
  // fall back to the plain centred code line. Visibility depends only on the
  // device, so it's set once here rather than per render.
  const isTouchDevice =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(pointer: coarse)').matches;
  shareBtn.hidden = !isTouchDevice;

  /** @type {Map<string, { code: string, name: string }>} */
  const byCode = new Map();

  // Metric values for each superlative question's reveal strip, keyed by questionId
  // (the question is judged server-side; the client only needs the numbers to show
  // the ranking after the answer is out). Fetched once at load, best-effort: a
  // missing metric just means that question's reveal shows no numbers.
  /** @type {Record<string, { values: Record<string, number>, format: string }>} */
  const metricByQuestion = {};

  // ---- helpers ----
  const fmt = (/** @type {string} */ str, /** @type {Record<string, string|number>} */ params) =>
    str.replace(/\{(\w+)\}/g, (_, k) => (k in params ? String(params[k]) : `{${k}}`));

  /** @param {string} tag @param {string} [cls] @param {string} [text] */
  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  /**
   * Loading variant of the status line: a muted label trailed by the shared
   * pulsing `.loading-dots` (common.css) — the same "something's happening"
   * idiom as daily-stats / sync "loading…". Used for the connecting /
   * reconnecting wait so it reads as a wait, not an error box.
   * @param {string} key @param {string} fallback
   */
  function setLoadingStatus(key, fallback) {
    statusEl.className = 'party-status loading';
    statusEl.textContent = t(key, fallback);
    const dots = el('span', 'loading-dots');
    dots.setAttribute('aria-hidden', 'true');
    dots.innerHTML = '<span></span><span></span><span></span>';
    statusEl.appendChild(dots);
    statusEl.hidden = false;
  }
  function clearStatus() { statusEl.hidden = true; statusEl.textContent = ''; statusEl.className = 'party-status'; }

  // Join-form validation / reject error (pink `.join-error`, shown under the
  // join box). Both the client-side "code must be 5 chars" check and the
  // server's reject reasons (room not found, code taken, in progress) surface
  // here — same placement + styling as Tic-Tac-Toe's `.lobby-error`, instead
  // of the top `.party-status` box which is now reserved for transient
  // connecting / disconnected states. The last key is stashed so a
  // soft language switch re-translates the visible message.
  /** @type {{ key: string, fallback: string, params?: Record<string, string|number> } | null} */
  let lastJoinError = null;
  /**
   * @param {string} key @param {string} fallback
   * @param {Record<string, string|number>} [params]
   */
  function showJoinError(key, fallback, params) {
    lastJoinError = { key, fallback, params };
    paintJoinError();
    joinError.hidden = false;
  }
  function paintJoinError() {
    if (!lastJoinError) return;
    const { key, fallback, params } = lastJoinError;
    joinError.textContent = params ? fmt(t(key, fallback), params) : t(key, fallback);
  }
  function clearJoinError() { lastJoinError = null; joinError.hidden = true; joinError.textContent = ''; }

  function showSection(/** @type {'start'|'lobby'|'question'|'roundcard'|'pick'|'break'|'final'|null} */ which) {
    // Leaving the break ends the ledger's claim on the board, so the next break
    // builds and animates from scratch. See `breakBuilt`.
    if (which !== 'break') breakBuilt = false;
    for (const [k, node] of Object.entries(sections)) node.hidden = k !== which;
  }

  function send(/** @type {object} */ msg) {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }

  // ---- draft length (host-only): how many rounds each player picks ----
  // Length is expressed as picks-per-player, not a total: "each of you picks 2
  // rounds" is something a host can reason about, where a bare "5" left them to
  // work out what it bought. The total (`seats x picks + 1`, the +1 being the
  // opening Flags round) is shown underneath and moves as players join. Persisted
  // per device; the server re-validates whatever we send.
  let picksPerPlayer = loadPicks();

  function loadPicks() {
    try {
      return validatePicksPerPlayer(Number(window.localStorage.getItem(PICKS_KEY)));
    } catch { return DEFAULT_PICKS_PER_PLAYER; }
  }
  function savePicks() {
    try { window.localStorage.setItem(PICKS_KEY, String(picksPerPlayer)); } catch { /* private mode */ }
  }

  /** Seats currently in the room — the other half of the length arithmetic. */
  function seatCount() {
    return state.roster.filter((r) => r.present).length;
  }

  /** Rounds a start would actually deal, given the seats present right now. */
  function effectiveRounds() {
    return roundCountFor(seatCount(), picksPerPlayer);
  }

  /** Paint the picks row: which option is on, and what it currently buys. */
  function syncDraftLength() {
    for (const btn of draftPickBtns) {
      const on = Number(btn.dataset.picks) === picksPerPlayer;
      btn.classList.toggle('on', on);
      btn.setAttribute('aria-pressed', String(on));
    }
    const rounds = effectiveRounds();
    draftLengthHint.textContent = fmt(t('party.draftLengthTotal', '{r} rounds, {q} questions'), {
      r: rounds, q: rounds * ROUND_QUESTIONS,
    });
  }

  // Thin `t()` wrappers over the pure resolvers (modeFullLabel / modeShortLabel
  // above) — the id→label mapping lives up there so it can be pinned by
  // flagParty/modeLabels.test.js; here we just localize the resolved key.
  const modeLabel = (/** @type {string} */ id) => {
    const { key, fallback } = modeFullLabel(id);
    return t(key, fallback);
  };

  // ---- connection ----
  function wsUrl(/** @type {string} */ code, /** @type {'create'|'join'} */ intent) {
    return `${SERVER_URL}${encodeURIComponent(code)}?pid=${encodeURIComponent(deviceId)}` +
      `&nick=${encodeURIComponent(myName)}&intent=${intent}`;
  }

  function connect() {
    if (!activeRoom) return;
    // Connecting / reconnecting are waiting states, so they use the same
    // loading-dots idiom as daily-stats loading (not the bordered error box).
    setLoadingStatus('party.connecting', 'Connecting');
    ws = new WebSocket(wsUrl(activeRoom.code, activeRoom.intent));
    ws.addEventListener('open', () => { reconnectAttempts = 0; });
    ws.addEventListener('message', (e) => handleMessage(String(e.data)));
    ws.addEventListener('close', () => { if (!rejected) scheduleReconnect(); });
  }

  function scheduleReconnect() {
    if (!activeRoom) return;
    // After the first connect, every reconnect is a join (the room exists).
    activeRoom = { ...activeRoom, intent: 'join' };
    reconnectAttempts += 1;
    const delayMs = Math.min(30000, 1000 * 2 ** (reconnectAttempts - 1));
    setLoadingStatus('party.disconnected', 'Disconnected. Reconnecting');
    clearTimeout(reconnectTimer);
    reconnectTimer = window.setTimeout(connect, delayMs);
  }

  function handleMessage(/** @type {string} */ raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    const { state: next, effects } = reducePartyMessage(state, msg);
    state = next;
    if (msg.type === 'roster' && typeof msg.hostId === 'string') roomHostId = msg.hostId;
    if (msg.type === 'welcome' && msg.isHost) roomHostId = state.you;
    for (const eff of effects) {
      if (eff.type === 'close') {
        rejected = true;
        try { if (ws) ws.close(); } catch { /* already closed */ }
        activeRoom = null;
        history.replaceState(null, '', location.pathname);
      }
    }
    if (state.statusOverride) {
      const so = state.statusOverride;
      // A reject bounces us back to the start screen; show it as the pink
      // validation line under the join form (like TTT), not the top status box.
      clearStatus();
      showJoinError(so.key, so.fallback, so.params);
    } else {
      // No override to show, so drop any transient status (connecting /
      // reconnecting) now that a real message has arrived.
      clearStatus();
    }
    render();
  }

  function enterRoom(/** @type {string} */ code, /** @type {'create'|'join'} */ intent) {
    rejected = false;
    reconnectAttempts = 0;
    clearJoinError();
    state = initialPartyClientState();
    activeRoom = { code, intent };
    const url = new URL(location.href);
    url.searchParams.set('room', code);
    history.replaceState(null, '', url.toString());
    render();
    connect();
  }

  // ---- question clock ----
  // Everyone renders the countdown; only the host's timer fires the transition
  // (send 'reveal' when a question runs out, 'next' when a reveal has lingered),
  // so the room advances on its own with no host button to press. Timing lives
  // here on the page by design — the room reducer stays time-free. Caveat: the
  // pace depends on the host's tab staying awake; if the host drops mid-question
  // the room can stall at a reveal (documented in PARTY.md, server-alarm is the
  // future fix). All-present-buzzed still auto-reveals server-side regardless.
  /** @type {string | null} phase:questionIndex the clock is currently counting */
  let clockToken = null;
  let clockDeadline = 0;
  let clockTotalMs = 0;
  let clockFired = false;
  let clockInterval = 0;

  function stopClock() {
    if (clockInterval) { window.clearInterval(clockInterval); clockInterval = 0; }
    clockToken = null;
    timerEl.hidden = true;
  }

  // ---- question-phase reveal animation (tricky veil + world-facts names) ----
  // One rAF loop drives two independent time-based reveals over the same clock
  // the countdown bar counts:
  //   • the tricky-mode veil — a single `--veil-p` (0 hidden → 1 clear) on the
  //     grid for a smooth grey/blur/panel resolve; CSS does the rest.
  //   • the world-facts name reveal — a `names-shown` class on the grid that fades
  //     the country-name strips onto metric tiles once NAME_REVEAL_SECONDS have
  //     passed (independent of tricky; see `nameActive`).
  // Both live on the grid (which persists across tile rebuilds — only its
  // innerHTML is replaced), so a re-render mid-question (a late join, a buzz
  // notification) never resets either animation. The timings ride on the question
  // The veil timing rides on the question itself (`clearFrac`, stamped server-side
  // from the host's config) so each question can differ; the name reveal is a
  // fixed beat every client computes locally. Either way they flip in step.
  let veilRaf = 0;
  /** True when this question fades country names on — every world-facts question
   *  does, at a fixed beat. Nothing to configure and nothing stamped on the wire:
   *  the questionId is enough to know, so a client can decide this alone. */
  function nameActive() {
    return isMetricQuestion(state.question?.questionId);
  }
  /** Whether this question's tiles are veiled. The rules live in partyTiming so
   *  they are unit-pinned; this only supplies the current state. */
  function veilActive() {
    return veilActiveFor(state.tricky, state.question?.questionId);
  }
  function startVeil() {
    if (veilRaf) return;
    const step = () => {
      if (state.phase !== 'question' || !(veilActive() || nameActive())) { veilRaf = 0; return; }
      const now = Date.now();
      if (veilActive()) {
        const clearFrac = (state.question && state.question.clearFrac) || DEFAULT_REVEAL.flag;
        const p = veilProgress(clockDeadline, now, clockTotalMs, clearFrac);
        gridEl.style.setProperty('--veil-p', p.toFixed(4));
      }
      gridEl.classList.toggle('names-shown', nameActive() && namesRevealed(clockDeadline, now, clockTotalMs));
      veilRaf = window.requestAnimationFrame(step);
    };
    veilRaf = window.requestAnimationFrame(step);
  }
  function stopVeil() {
    if (veilRaf) { window.cancelAnimationFrame(veilRaf); veilRaf = 0; }
    gridEl.style.setProperty('--veil-p', '1');
    gridEl.classList.remove('names-shown');
  }

  /** The clock's current mode, from the phase: `picking` gets its own timed beat
   *  (the draft pick), reveal and question as before. */
  function clockMode() {
    if (state.phase === 'picking') return 'picking';
    return state.phase === 'reveal' ? 'reveal' : 'question';
  }

  /** (Re)start the countdown when the phase or question changes; otherwise leave it. */
  function syncClock() {
    const mode = clockMode();
    const token = `${mode}:${state.questionIndex}`;
    if (token === clockToken) return;
    clockToken = token;
    clockFired = false;
    // The reveal length depends on the question, not the room: a clean sweep (every
    // present player got it right) snaps on; a miss holds so the correct flag
    // can be read. Question time is fixed. (flagQuiz's correct-fast/wrong-slow.)
    // The draft pick has its own fixed window.
    const clean = mode === 'reveal' && isCleanReveal(state.roster, state.reveal);
    // A round-boundary reveal plays two beats — the answer tiles for a normal
    // reveal, then the standings break — so the host holds the sum before sending
    // `next`, keeping the break its full duration after the answer is shown. An
    // ordinary reveal is just its own beat.
    const revealSecs = atRoundBreak() ? revealSecondsFor(clean) + ROUND_BREAK_SECONDS : revealSecondsFor(clean);
    // The pick has no visible countdown (choosing isn't a race); its clock is the
    // long invisible anti-stall fallback that force-picks only an absent picker.
    const secs = mode === 'picking' ? PICK_TIMEOUT_SECONDS : (mode === 'reveal' ? revealSecs : QUESTION_SECONDS);
    clockTotalMs = secs * 1000;
    clockDeadline = Date.now() + clockTotalMs;
    // Only the question phase shows the question bar. The reveal and the pick are
    // bar-less (the reveal is sub-second; the pick shouldn't feel timed).
    timerEl.hidden = mode !== 'question';
    timerEl.setAttribute('data-mode', mode);
    if (!clockInterval) clockInterval = window.setInterval(tickClock, 200);
    tickClock();
  }

  function tickClock() {
    const mode = clockMode();
    const now = Date.now();
    const left = secondsLeft(clockDeadline, now);
    // Only the question paints a bar; the reveal and the pick are bar-less (their
    // clocks still run below — the reveal to advance the room, the pick as the
    // invisible force-pick fallback).
    if (mode === 'question') {
      timerFill.style.width = `${remainingFraction(clockDeadline, now, clockTotalMs) * 100}%`;
      timerEl.classList.toggle('low', left <= 5);
      timerLabel.textContent = String(left);
    }
    if (left <= 0 && !clockFired) {
      clockFired = true;
      // Host only: end the phase. A stale message for a phase that already moved
      // on is ignored by the room reducer, so this is safe against the races
      // (all-buzzed auto-reveal, the picker choosing just as the clock expires).
      if (state.isHost) {
        if (mode === 'reveal') send({ type: 'next' });
        else if (mode === 'picking') send({ type: 'forcePick' });
        else send({ type: 'reveal' });
      }
    }
  }

  // ---- stale-client reload guard ----
  // Set only in the instant before a version-skew reload, cleared the moment we
  // successfully render a server-dealt question (proof our build is compatible), so
  // it re-arms for a future deploy while blocking a reload loop if the reload
  // came back on the same stale build. sessionStorage: per-tab, gone on close.
  const UPDATE_RELOAD_KEY = 'gridgame.party.updateReload';
  const updateReloadTried = () => { try { return window.sessionStorage.getItem(UPDATE_RELOAD_KEY) === '1'; } catch { return false; } };
  const markUpdateReload = () => { try { window.sessionStorage.setItem(UPDATE_RELOAD_KEY, '1'); } catch { /* private mode */ } };
  const clearUpdateReload = () => { try { window.sessionStorage.removeItem(UPDATE_RELOAD_KEY); } catch { /* private mode */ } };

  /** The blocked fallback: a stale tab that reloaded and is *still* on an old
   *  build (cached HTML, offline). Show a plain notice in the question frame rather
   *  than looping the reload or rendering the broken question. */
  function renderUpdateNotice() {
    questionPill.textContent = '';
    timerEl.hidden = true;
    promptLead.hidden = true; promptLead.textContent = '';
    promptTarget.textContent = t('party.updateNeeded', 'A new version is available. Refresh the page to keep playing.');
    gridEl.innerHTML = '';
    footEl.innerHTML = '';
  }

  // ---- between-rounds break ----
  // The break is a longer reveal, not a room phase: at a round boundary the room
  // stays in `reveal`, the host just holds ROUND_BREAK_SECONDS instead of the
  // usual reveal beat, and every client paints the standings break in place of
  // the answer. `prevBreakBoard` is the scoreboard snapshot from the last break
  // (null before the first), so each break diffs against the last to show round
  // gains and rank movement. Reset when a fresh game begins (lobby).
  /** @type {Array<{ playerId: string, nickname: string, score: number }> | null} */
  let prevBreakBoard = null;
  /** The baseline for the NEXT break, captured when a break is first shown but
   *  not committed to `prevBreakBoard` until the next round's question arrives —
   *  so re-renders of the same break keep diffing against the old baseline
   *  (committing early would zero the deltas mid-break). */
  let pendingBreakBoard = null;
  /** Guards the once-per-break capture against repeated renders of one break. */
  let breakSnapToken = null;
  /** True while the break currently on screen has already been built and handed to
   *  the ledger animation. A break is identified by *being entered* (cleared in
   *  `showSection`), deliberately NOT by `state.questionIndex`: the index changes
   *  underneath a live break (the `picking` message carries the next one — see
   *  `partyClient`'s picking case), so an index-keyed guard lets a second run start
   *  on top of the first. That was survivable when this was only a FLIP — replaying
   *  a finished slide looks like nothing — but the ledger rewinds the scores to
   *  their pre-round values, so a second run mid-flight made the board jump to the
   *  final total, snap back to zero, and slide before it had finished counting.
   *  While this is true, `renderBreak` leaves the board's DOM completely alone. */
  let breakBuilt = false;
  /** Identifies the in-flight ledger so its deferred steps can tell whether they
   *  still own the board; bumped once per break. */
  let breakAnimToken = null;
  /** Monotonic break counter, the value behind `breakAnimToken`. */
  let breakSeq = 0;
  /** This round's running score breakdown, per player, for the break's chips.
   *  Reset when a round starts; added to once per question (the tokens below guard
   *  render()'s re-runs, which would otherwise count a question twice). */
  let roundTally = emptyTally();
  let tallyRoundToken = null;
  let tallyQuestionToken = null;
  /** True once this device has sent its pick for the current draft turn, so a
   *  double-tap can't fire two picks; reset when we leave the picking phase. */
  let pickSent = false;
  /** Mode ids this picker has armed the veil on for the current turn. Held here
   *  rather than on the card element because renderPick rebuilds the hand on any
   *  state change (a roster update mid-pick would otherwise silently disarm the
   *  chip the picker already tapped). Cleared with `pickSent`. */
  let pickVeil = new Set();

  // ---- round title card ----
  // A short beat (ROUND_INTRO_SECONDS) announcing a new round before its first
  // question, on rounds 2..N (the opener starts play straight away). It's a
  // client-side hold: the question is already dealt, but we show the card first
  // and only start the question + clock + veil when the beat ends — so it costs no
  // answer time, and because every client (host included) holds the same beat it
  // introduces no clock drift. `roundIntroToken` guards the once-per-round-start
  // arm against render()'s many re-runs; `roundIntroActive` is true while the
  // beat is on screen.
  let roundIntroTimer = 0;
  /** @type {string | null} */
  let roundIntroToken = null;
  let roundIntroActive = false;
  function armRoundIntro(/** @type {string} */ token) {
    roundIntroToken = token;
    roundIntroActive = true;
    window.clearTimeout(roundIntroTimer);
    roundIntroTimer = window.setTimeout(() => { roundIntroActive = false; render(); }, ROUND_INTRO_SECONDS * 1000);
  }
  function resetRoundIntro() {
    window.clearTimeout(roundIntroTimer);
    roundIntroTimer = 0;
    roundIntroToken = null;
    roundIntroActive = false;
    resetRoundBreakAnswer();
  }

  // ---- round-boundary answer beat ----
  // A round ends on its 5th question, and the client shows the standings break in
  // place of that reveal — which meant the round's LAST question never got to show
  // its correct / wrong answers. So a boundary reveal now plays two beats: first
  // the answer tiles for a normal reveal beat (proper/wrong answers, like every
  // other question), then the standings break. A client-side hold flips between
  // them, exactly like the question-intro card; the host holds the whole window
  // (answer beat + break) before it sends `next`, so the break keeps its full
  // duration. `roundBreakToken` guards the once-per-boundary arm against
  // render()'s re-runs; `roundBreakAnswerActive` is true while the answer tiles
  // are on screen, false once we've flipped to the standings.
  let roundBreakTimer = 0;
  /** @type {string | null} */
  let roundBreakToken = null;
  let roundBreakAnswerActive = false;
  function armRoundBreakAnswer(/** @type {string} */ token) {
    roundBreakToken = token;
    roundBreakAnswerActive = true;
    window.clearTimeout(roundBreakTimer);
    const clean = isCleanReveal(state.roster, state.reveal);
    roundBreakTimer = window.setTimeout(() => { roundBreakAnswerActive = false; render(); }, revealSecondsFor(clean) * 1000);
  }
  function resetRoundBreakAnswer() {
    window.clearTimeout(roundBreakTimer);
    roundBreakTimer = 0;
    roundBreakToken = null;
    roundBreakAnswerActive = false;
  }

  /** True when the current reveal is a between-rounds break (a boundary question
   *  with another round to follow). Client-derived from questionIndex + totalQuestions
   *  — no plan needed. */
  function atRoundBreak() {
    return state.phase === 'reveal' && !!state.reveal
      && isRoundBoundary(state.questionIndex, state.totalQuestions);
  }

  // ---- render ----
  function render() {
    if (!activeRoom) { stopClock(); stopVeil(); showSection('start'); return; }
    // Leaving (or not yet in) the final screen re-arms the one-shot celebration.
    if (state.phase !== 'final') finalCelebrated = false;
    // Re-arm the pick guard whenever we're not mid-pick, so the next draft turn
    // accepts a fresh choice.
    if (state.phase !== 'picking') { pickSent = false; pickVeil = new Set(); }
    if (state.phase === 'question' || state.phase === 'reveal') {
      // A question this build can't render means the server is a build ahead of
      // us (its deploy landed while this tab stayed open). Reload onto the new
      // build once; the seat survives (room code in URL, pid persisted).
      // `canRenderQuestion` judges the whole question, not just its question id — a
      // known metric dealt in a direction we have no copy for is skew too, and
      // rendering it anyway would mis-score silently.
      const q = state.question;
      const action = questionRenderAction(canRenderQuestion(q, KNOWN_QUESTION_IDS), updateReloadTried());
      if (action === 'reload') { markUpdateReload(); stopClock(); stopVeil(); window.location.reload(); return; }
      if (action === 'blocked') { stopClock(); stopVeil(); showSection('question'); renderUpdateNotice(); return; }
      clearUpdateReload();
      // Leaving a break (the next round's first question is here): the standings
      // we just showed become the baseline the following break diffs against.
      if (state.phase === 'question' && pendingBreakBoard) { prevBreakBoard = pendingBreakBoard; pendingBreakBoard = null; }
      // A new round starts a fresh breakdown: the chips describe the round that
      // just ended, not the game so far.
      if (state.phase === 'question' && isRoundStart(state.questionIndex, state.totalQuestions)) {
        const t = String(state.questionIndex);
        if (tallyRoundToken !== t) { tallyRoundToken = t; roundTally = emptyTally(); }
      }
      // Fold each question's points into the round's tally, once per question. The
      // reveal renders repeatedly while it's on screen, so without the token a
      // re-render would count the same question again and the chips would drift
      // away from the gain beside them.
      if (state.phase === 'reveal' && state.reveal) {
        const t = String(state.questionIndex);
        if (tallyQuestionToken !== t) {
          tallyQuestionToken = t;
          const multiplier = state.reveal.doubled ? FINAL_ROUND_MULTIPLIER : 1;
          roundTally = addQuestionToTally(roundTally, state.reveal.points || {}, multiplier);
        }
      }
      // Every round opens with a title-card beat before its first question — the
      // opening round included, so it doubles as the synchronized "get ready" beat
      // at game start (the host who clicked Start doesn't see the first question
      // ahead of the other seats). The question is already dealt; we hold the card
      // and start the question + clock + veil only when the beat ends, so the card
      // costs no answer time. Armed once per round-start (the token guards
      // render()'s re-runs from restarting it).
      if (state.phase === 'question' && isRoundStart(state.questionIndex, state.totalQuestions)) {
        const token = String(state.questionIndex);
        if (roundIntroToken !== token) armRoundIntro(token);
        if (roundIntroActive) { stopClock(); stopVeil(); showSection('roundcard'); renderRoundCard(); return; }
      }
      // At a round boundary the reveal becomes the standings break instead of the
      // answer tiles. The clock still runs (host advances after the break beat),
      // just against the break duration; syncClock reads atRoundBreak() for it.
      // A round-boundary reveal plays two beats: the answer tiles first (so the
      // round's last question shows proper/wrong answers like any other question), then
      // the standings break. The client-side hold flips between them; syncClock
      // holds the whole window (answer beat + break) so the break keeps its beat.
      if (atRoundBreak()) {
        const token = String(state.questionIndex);
        if (roundBreakToken !== token) armRoundBreakAnswer(token);
        if (roundBreakAnswerActive) { stopVeil(); showSection('question'); renderQuestion(); syncClock(); return; }
        stopVeil(); showSection('break'); renderBreak(); syncClock(); return;
      }
      showSection('question'); renderQuestion(); syncClock();
      // The veil + name reveal animate during the question only; the reveal phase
      // always shows crisp tiles (stopVeil pins `--veil-p` to 1 and clears
      // `names-shown`). Run the loop when tricky is on, or when a world-facts
      // question has name-reveal enabled.
      if (state.phase === 'question' && (veilActive() || nameActive())) startVeil(); else stopVeil();
    }
    else if (state.phase === 'picking') { stopVeil(); showSection('pick'); renderPick(); syncClock(); }
    else if (state.phase === 'final') { stopClock(); stopVeil(); showSection('final'); renderFinal(); }
    else {
      // Lobby = a fresh game (or play-again reset): forget the round baselines so
      // the first break of the next game shows gains-from-zero, no deltas, and
      // clear any pending question-intro beat.
      prevBreakBoard = null; pendingBreakBoard = null; breakSnapToken = null; breakAnimToken = null; breakBuilt = false;
      resetRoundIntro();
      stopClock(); stopVeil(); showSection('lobby'); renderLobby();
    }
  }

  function renderLobby() {
    roomCodeEl.textContent = activeRoom ? activeRoom.code : '-----';
    playersEl.innerHTML = '';
    const label = el('p', 'plabel', `${t('party.players', 'Players')} · ${state.roster.length}`);
    playersEl.appendChild(label);
    for (const r of state.roster) {
      const chip = el('div', 'chip' + (r.present ? '' : ' away'));
      chip.appendChild(buildAvatar(r.playerId));
      chip.appendChild(el('span', 'chip-name', r.nickname));
      if (r.playerId === roomHostId) chip.appendChild(el('span', 'chip-host', t('party.host', 'host')));
      playersEl.appendChild(chip);
    }
    const inLobby = state.phase === 'lobby';
    const hostSetup = state.isHost && inLobby;
    startBtn.hidden = !hostSetup;
    // The host can start as soon as they're seated — a room of one is allowed
    // (play alone), and more players can join before the tap. The guard only
    // greys out the impossible empty-roster case.
    startBtn.disabled = state.roster.filter((r) => r.present).length < 1;
    waitEl.hidden = !(!state.isHost && inLobby);
    // Draft is the only mode, so the length row is the whole host setup: it shows
    // exactly when the start button does.
    draftLengthEl.hidden = !hostSetup;
    syncDraftLength();
  }

  function renderQuestion() {
    const q = state.question;
    if (!q) return;
    // Only the host can abort a game back to the settings screen (it resets the
    // whole room); guests just have Home. The adjacent `·` hides itself via CSS
    // when this button is hidden, so there's nothing else to toggle.
    questionToSettingsBtn.hidden = !state.isHost;
    // The pill carries the act structure: which round of how many, and the question
    // within the whole game. Makes the round boundaries legible during play, not
    // just at the break.
    const totalRounds = Math.max(1, Math.ceil(state.totalQuestions / ROUND_QUESTIONS));
    questionPill.textContent = fmt(t('party.roundQuestion', 'Round {b}/{rounds} · Question {n}/{total}'), {
      b: roundIndexAt(state.questionIndex) + 1, rounds: totalRounds,
      n: state.questionIndex + 1, total: state.totalQuestions,
    });
    // On the first question of a drafted round, name who chose it ("Zosia's pick").
    if (state.lastPick) {
      const seat = state.roster.find((r) => r.playerId === state.lastPick?.picker);
      if (seat) {
        questionPill.appendChild(el('span', 'pill-pick', ` · ${fmt(t('party.roundPick', "{name}'s pick"), { name: seat.nickname })}`));
      }
    }
    // The final round scores double and plays veiled — badge it so the stakes read.
    if (isFinalRound(state.questionIndex, state.totalQuestions)) {
      questionPill.appendChild(el('span', 'pill-double', t('party.doublePoints', 'Double points')));
    }
    const isReveal = state.phase === 'reveal' && state.reveal;
    const isMap = q.questionId === 'mapPick';
    const superCfg = superlativeMetricByQuestionId(q.questionId);
    const isSuperlative = superCfg !== null;
    // Country-name questions (flag / map) show one prominent line, nothing else:
    // the tiles already say you're matching a flag or outline, so a "Which flag?"
    // cue was just extra reading. Superlative questions instead lead the criterion
    // label with the metric's icon (below) — a picture reads the stat faster than
    // the phrase alone. Reset both cues each render, then the branches opt in.
    promptEl.classList.remove('superlative');
    delete promptEl.dataset.metric;
    promptEl.style.removeProperty('--mc');
    promptLead.hidden = true;
    promptLead.textContent = '';
    if (isSuperlative) {
      // Superlative has no target country: the prompt is a direction ('most' /
      // 'least'), shown as a short criterion label ("Largest coffee production").
      // Same label in both phases — stable (no grid shift), and it names the
      // criterion, not the winner, so it never leaks the answer the tiles reveal.
      // The metric icon leads it, tinted with the metric's setting hue (--mc, set
      // from q.questionId via [data-metric] in index.css — the same per-metric hue
      // the setup chips use).
      // `q.prompt` is off the wire, so it's a bare string to the checker; narrow
      // it here rather than widening hintFor, so flagQuiz's typed call site keeps
      // the check. Anything that isn't 'least' reads as 'most' — the same
      // either-way branch this line has always been.
      const label = hintFor(superCfg, q.prompt === 'least' ? 'least' : 'most');
      promptEl.classList.add('superlative');
      promptEl.dataset.metric = q.questionId;
      const promptMetricKey = metricKeyForQuestion(q.questionId);
      promptEl.style.setProperty('--mc', (promptMetricKey && METRIC_HUES[promptMetricKey]) || 'currentColor');
      promptLead.innerHTML = (promptMetricKey && METRIC_ICONS[promptMetricKey]) || '';
      promptLead.hidden = !promptLead.innerHTML;
      promptTarget.textContent = t(label.key, label.fallback);
    } else {
      const targetCode = isReveal && state.reveal ? state.reveal.answer : q.prompt;
      const country = byCode.get(targetCode);
      promptTarget.textContent = country ? countryName(country) : targetCode;
    }

    // On a superlative reveal, each tile shows its country + population so the
    // whole ranking is readable at a glance — the question's learning payoff. Only
    // on reveal (the numbers are hidden during the question), and only when the
    // population data actually loaded.
    const metricData = isSuperlative ? metricByQuestion[q.questionId] : null;
    const popStrip = (/** @type {string} */ code) => {
      if (!(isSuperlative && isReveal) || !metricData) return null;
      const v = metricData.values[code];
      if (v == null) return null;
      const c = byCode.get(code);
      return { name: c ? countryName(c) : code, value: formatValue(v, metricData.format) };
    };

    gridEl.innerHTML = '';
    for (const code of q.options) {
      if (isReveal && state.reveal) {
        const correct = code === state.reveal.answer;
        // Your own wrong pick pulses pink (flagQuiz's "bad" marker); it isn't
        // dimmed like the tiles nobody chose. The correct tile pulses green.
        const myWrong = !correct && state.reveal.picks[state.you] === code;
        /** @type {string[]} */
        const pickers = [];
        for (const [pid, choice] of Object.entries(state.reveal.picks)) {
          if (choice === code) pickers.push(pid);
        }
        gridEl.appendChild(flagOpt(code, { isMap, selectable: false, selected: false, correct, wrong: myWrong, dim: !correct && !myWrong, pickers, pop: popStrip(code) }));
      } else {
        const selected = state.myChoice === code;
        const dim = state.myChoice != null && !selected;
        // World-facts questions fade the country name onto each tile once the clock
        // passes the host's name-reveal point (the grid's `names-shown` class,
        // toggled by the veil loop). The strip is pre-rendered here; CSS keeps it
        // hidden until then. Name only, no value — the value would leak the answer.
        const named = isSuperlative;
        gridEl.appendChild(flagOpt(code, { isMap, selectable: state.myChoice == null, selected, correct: false, wrong: false, dim, pickers: [], pop: null, veil: veilActive(), named }));
      }
    }

    footEl.innerHTML = '';
    if (isReveal) renderRevealFoot();
  }

  /**
   * @param {string} code
   * @param {{ isMap: boolean, selectable: boolean, selected: boolean, correct: boolean, wrong: boolean, dim: boolean, pickers: string[], pop?: { name: string, value: string } | null, veil?: boolean, named?: boolean }} opts
   */
  function flagOpt(code, opts) {
    const node = document.createElement(opts.selectable ? 'button' : 'div');
    node.className = 'opt' + (opts.selected ? ' sel' : '') + (opts.correct ? ' correct' : '') + (opts.wrong ? ' wrong' : '') + (opts.dim ? ' dim' : '') + (opts.pop ? ' pop' : '') + (opts.veil ? ' veil' : '') + (opts.named ? ' named' : '');
    // On reveal, name the flag/outline you got wrong — the shared bottom strip
    // (common.css `.opt.wrong[data-name]`, same as flagQuiz) tells you what you
    // actually picked; the correct answer's name is already in the prompt header.
    // Suppressed when a superlative pop-strip is present (`opts.pop`): that strip
    // already carries every tile's name + value, so the ::after would double up.
    // The `named` case is the world-facts question-phase name reveal: it sets the
    // same `data-name` strip, kept hidden by CSS until the grid gets `names-shown`.
    if ((opts.wrong && !opts.pop) || opts.named) {
      const c = byCode.get(code);
      node.dataset.name = c ? countryName(c) : code;
    }
    if (opts.selectable) {
      /** @type {HTMLButtonElement} */ (node).type = 'button';
      node.addEventListener('click', () => onPick(code));
    }
    const img = document.createElement('img');
    img.className = opts.isMap ? 'contour' : 'flag';
    // The map question is the literal mirror of flag-pick: same tile, just swap the
    // asset folder (contours instead of flags/svg).
    img.src = opts.isMap ? `../flags/contours/${code}.svg` : `../flags/svg/${code}.svg`;
    img.alt = '';
    node.appendChild(img);
    // Tricky mode: six feathered panels over the tile that clear as the question
    // clock runs. The img itself greys + blurs via CSS reading `--veil-p` (set on
    // the grid by the veil loop); the cover cells fade out on their scattered
    // slots. Question phase only — the reveal never passes `veil`.
    if (opts.veil) {
      const cover = el('div', 'veil-cover');
      for (const i of VEIL_ORDER) {
        const cell = el('div', 'veil-cell');
        cell.style.setProperty('--i', String(i));
        cover.appendChild(cell);
      }
      node.appendChild(cover);
    }
    // The locked-in pick is shown by the pink ring + surface tint on the tile
    // itself (`.opt.sel`) — no ✓ badge. On reveal the correct flag is marked by
    // the green pulse alone (matching flagQuiz).
    if (opts.pickers.length) {
      const p = el('div', 'picks');
      for (const pid of opts.pickers) p.appendChild(buildAvatar(pid));
      node.appendChild(p);
    }
    // Superlative reveal only: a bottom strip naming the country and its
    // population, so all four values read as a ranking (the correct tile's green
    // pulse already flags the extreme).
    if (opts.pop) {
      const strip = el('div', 'opt-pop');
      strip.appendChild(el('span', 'nm', opts.pop.name));
      strip.appendChild(el('span', 'val', opts.pop.value));
      node.appendChild(strip);
    }
    return node;
  }

  /** The draft pick screen: the picker chooses the next round from a hand of
   *  cards; everyone else watches "X is choosing". The pick countdown (drawn by
   *  the clock) is visible to all; the host's timer fires `forcePick` at 0. */
  function renderPick() {
    const totalRounds = Math.max(1, Math.ceil(state.totalQuestions / ROUND_QUESTIONS));
    const nextRound = roundIndexAt(state.questionIndex) + 2; // 1-based: the round being chosen
    pickPill.textContent = fmt(t('party.choosingRound', 'Choosing round {n} of {total}'), { n: nextRound, total: totalRounds });

    // Server-authoritative: the server told us whether we're the picker (never
    // re-derived from `you === picker`, which a stale identity could get wrong).
    const youPick = state.youPick;
    const pickerSeat = state.roster.find((r) => r.playerId === state.picker);
    const pickerName = pickerSeat ? pickerSeat.nickname : t('party.aPlayer', 'A player');

    if (youPick) {
      pickLead.hidden = false;
      pickLead.textContent = t('party.yourPick', 'Your pick, choose the next round');
      pickWatch.hidden = true;
      pickHand.hidden = false;
      pickHand.innerHTML = '';
      // Drive the disabled look from `pickSent` rather than only adding it on
      // click: the click handler used to add `.sent` (pointer-events: none) and
      // nothing ever took it off, so from the second pick of a game the hand
      // rendered fine and ignored every tap until a refresh.
      pickHand.classList.toggle('sent', pickSent);
      for (const modeId of state.hand || []) {
        // The chip is a SIBLING of the card, absolutely positioned over its right
        // edge, not a child: a button inside a button is invalid markup and the
        // inner one stops being reachable by keyboard. Both stay real buttons.
        const row = el('div', 'pick-card-row');
        const card = el('button', 'pick-card');
        /** @type {HTMLButtonElement} */ (card).type = 'button';
        const hue = modeHue(modeId);
        if (hue) card.style.setProperty('--mc', hue);
        const ic = el('span', 'pick-card-ic');
        ic.innerHTML = modeIconHtml(modeId);
        ic.setAttribute('aria-hidden', 'true');
        card.appendChild(ic);
        card.appendChild(el('span', 'pick-card-label', modeLabel(modeId)));
        card.addEventListener('click', () => {
          if (pickSent) return;
          pickSent = true;
          pickHand.classList.add('sent');
          card.classList.add('chosen');
          send({ type: 'pick', modeId, veil: pickVeil.has(modeId) });
        });
        row.appendChild(card);
        // Only the picture trio gets the chip: on a statistics question the veil
        // is refused server-side anyway (`canVeilMode`), and a control that does
        // nothing on most of the hand teaches the wrong rule.
        if (canVeilMode(modeId)) {
          card.classList.add('veilable');
          // Square icon button, no text: `.hover-tip` carries the explanation on
          // desktop and `aria-label` carries it everywhere else. The tooltip is
          // hover-only (see common.css), so it is an enhancement, never the only
          // place the meaning lives — hence the label rather than a title.
          const chip = el('button', 'pick-card-veil hover-tip');
          /** @type {HTMLButtonElement} */ (chip).type = 'button';
          chip.innerHTML = `<span class="veil-glyph" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i></span>`;
          const label = t('party.veilChipHint', 'Veil this round: the flags start hidden and clear as the clock runs');
          chip.dataset.tip = t('party.veilChip', 'Veil');
          chip.setAttribute('aria-label', label);
          chip.setAttribute('aria-pressed', String(pickVeil.has(modeId)));
          chip.addEventListener('click', () => {
            if (pickSent) return;
            if (pickVeil.has(modeId)) pickVeil.delete(modeId);
            else pickVeil.add(modeId);
            chip.setAttribute('aria-pressed', String(pickVeil.has(modeId)));
          });
          row.appendChild(chip);
        }
        pickHand.appendChild(row);
      }
    } else {
      pickLead.hidden = true;
      pickHand.hidden = true;
      pickWatch.hidden = false;
      pickWatch.innerHTML = '';
      pickWatch.appendChild(buildAvatar(state.picker || ''));
      pickWatch.appendChild(el('p', 'pick-watch-name', fmt(t('party.isChoosing', '{name} is choosing…'), { name: pickerName })));
    }

    renderPickBoard();
  }

  /**
   * The standings, kept on screen underneath the pick. Watchers used to get an
   * avatar and a name and nothing else for as long as the picker took (up to
   * PICK_TIMEOUT_SECONDS), with the board they'd just been reading gone — and with
   * three of four players watching in a full room, that's most of the table staring
   * at a dead screen. The scoreboard is already in client state throughout
   * `picking`, so keeping it costs nothing on the wire.
   *
   * Every row but the picker's is dimmed, which does the spotlight job the old
   * lone-avatar screen was reaching for while also answering the question the
   * standings raise: you can see *why* this player is choosing (they're losing).
   * The picker's own row is left at full strength rather than the board being
   * dimmed as a whole — a child can't be more opaque than its parent, so a
   * container fade makes "keep one row lit" impossible.
   *
   * **Not shown to the picker.** This screen exists to give the waiting players
   * something to read; the picker already has a decision in front of them, and a
   * scoreboard under it is one more thing to look past. The empty-screen problem
   * this solves was never theirs.
   */
  function renderPickBoard() {
    const board = state.scoreboard || [];
    // A solo game has no standings worth showing and no one to watch.
    pickBoard.hidden = state.youPick || board.length < 2;
    pickBoard.innerHTML = '';
    if (pickBoard.hidden) return;
    board.forEach((r, i) => {
      const you = r.playerId === state.you;
      const isPicker = r.playerId === state.picker;
      const row = el('div', 'scoreline' + (you ? ' you' : ' other') + (isPicker ? ' picking' : ' dimmed'));
      row.appendChild(el('span', 'rank', String(i + 1)));
      row.appendChild(buildAvatar(r.playerId));
      row.appendChild(el('span', 'nm', r.nickname));
      row.appendChild(el('span', 'sc', String(r.score)));
      pickBoard.appendChild(row);
    });
  }

  /** The round title card: a short beat before each round's first question (the
   *  opening round included — it doubles as the game's "get ready" beat), naming
   *  the round number, its mode (icon + full label, metric hue on the icon),
   *  "5 questions", who picked it (draft), and the double-points stakes on the final
   *  round. Paints in `#pt-roundcard`; the question follows when the beat elapses
   *  (see `render` / `armRoundIntro`). A big-card counterpart to the question pill's
   *  "Zosia's pick" attribution — the deferred "full title card" from PARTY.md. */
  function renderRoundCard() {
    const totalRounds = Math.max(1, Math.ceil(state.totalQuestions / ROUND_QUESTIONS));
    const roundNum = roundIndexAt(state.questionIndex) + 1;
    roundCardCount.textContent = fmt(t('party.roundCardCount', 'Round {n} of {total}'), { n: roundNum, total: totalRounds });

    const modeId = roundModeId(state.lastPick, state.question ? state.question.questionId : undefined);
    if (modeId) {
      roundCardIc.innerHTML = roundCardIconHtml(modeId);
      roundCardIc.style.setProperty('--mc', modeHue(modeId) || 'currentColor');
      const label = modeFullLabel(modeId);
      roundCardName.textContent = t(label.key || '', label.fallback || '');
    } else {
      // The one ambiguous case: a custom-setup flag round, whose pool ('countries'
      // vs 'others') isn't on the wire — announce it generically.
      roundCardIc.innerHTML = deckIconHtml('flags', { className: 'roundcard-thumb' });
      roundCardIc.style.setProperty('--mc', 'currentColor');
      roundCardName.textContent = t('party.modeShort.flagsAll', 'Flags');
    }

    roundCardQuestions.textContent = fmt(t('party.roundCardQuestions', '{n} questions'), { n: ROUND_QUESTIONS });

    // Draft: name who chose this round (the big-card version of the question pill's
    // "Zosia's pick"). Absent on a custom round (no picker).
    roundCardPick.innerHTML = '';
    const pickSeat = state.lastPick ? state.roster.find((r) => r.playerId === state.lastPick?.picker) : null;
    roundCardPick.hidden = !pickSeat;
    if (pickSeat) {
      roundCardPick.appendChild(buildAvatar(pickSeat.playerId));
      roundCardPick.appendChild(el('span', 'roundcard-pick-name', fmt(t('party.roundPick', "{name}'s pick"), { name: pickSeat.nickname })));
    }

    // The final round scores double and plays veiled — announce the stakes.
    const isFinal = isFinalRound(state.questionIndex, state.totalQuestions);
    roundCardDouble.hidden = !isFinal;
    if (isFinal) roundCardDouble.textContent = t('party.doublePoints', 'Double points');
  }

  /** The between-rounds standings break: the round's MVP, then the full board
   *  with rank movement since the last break and each player's own gap to the
   *  leader. Paints in `#pt-break`; the host's clock advances to the next round
   *  after ROUND_BREAK_SECONDS. */
  function renderBreak() {
    // Built once per break. Nothing on this screen changes while it's up (no points
    // are scored during a break), so a re-render has nothing to add — and rebuilding
    // the rows underneath a running ledger is exactly the race described on
    // `breakBuilt`. Leave the DOM as the animation left it.
    if (breakBuilt) return;
    breakBuilt = true;

    const totalRounds = Math.max(1, Math.ceil(state.totalQuestions / ROUND_QUESTIONS));
    const endedRound = roundIndexAt(state.questionIndex) + 1;
    breakPill.textContent = fmt(t('party.afterRound', 'After round {n} of {total}'), { n: endedRound, total: totalRounds });

    const board = state.scoreboard || [];
    const { rows, mvp } = roundBreak(prevBreakBoard, board);

    // MVP banner — hidden when nobody scored in the round.
    const mvpRow = mvp ? rows.find((r) => r.playerId === mvp) : null;
    breakMvp.innerHTML = '';
    breakMvp.hidden = !mvpRow;
    if (mvpRow) {
      breakMvp.appendChild(buildAvatar(mvpRow.playerId));
      const txt = el('span', 'break-mvp-text');
      txt.append(document.createTextNode(`${t('party.roundMvp', 'Best of the round')} · `), el('span', 'break-mvp-name', mvpRow.nickname));
      breakMvp.appendChild(txt);
      breakMvp.appendChild(el('span', 'break-mvp-gain', `+${mvpRow.roundGain}`));
    }

    breakStandingsLabel.textContent = t('party.standings', 'Standings');

    breakBoard.innerHTML = '';
    /** @type {HTMLElement[]} the row node per `rows` entry, for the slide animation */
    const rowNodes = [];
    rows.forEach((r, i) => {
      const you = r.playerId === state.you;
      const row = el('div', 'scoreline' + (you ? ' you' : ' other'));
      row.appendChild(el('span', 'rank', String(i + 1)));
      row.appendChild(buildAvatar(r.playerId));
      row.appendChild(el('span', 'nm', r.nickname));
      // The gap to the leader reads on your own row only — it's your race to run.
      if (you && r.gapToLeader > 0) {
        row.appendChild(el('span', 'gap', fmt(t('party.behind', '{n} behind'), { n: r.gapToLeader })));
      }
      // The round's gain, beside the total, broken into what earned it. Hidden
      // until the count-up starts and faded out once the rows have settled, so the
      // board ends up as clean as it was before — the chips answer "what did I just
      // get, and for what?" during the beat where that's the question, then get out
      // of the way. `speed` is the bonus for being among the first correct answers,
      // which was previously invisible the moment the reveal passed.
      const gain = el('span', 'gain');
      const chips = chipsFor(roundTally[r.playerId]);
      // Fall back to the plain total when the tally has nothing to say — a player
      // who joined mid-round, or a reconnect that missed the questions. The number
      // is always right; only the attribution is best-effort.
      if (chips.length && chips.reduce((s, c) => s + c.value, 0) === r.roundGain) {
        for (const c of chips) {
          const chip = el('span', `chip chip-${c.kind}`, `+${c.value}`);
          if (c.kind === 'speed') chip.setAttribute('aria-label', `${c.value} ${t('party.fastest', 'Fastest')}`);
          gain.appendChild(chip);
        }
      } else if (r.roundGain > 0) {
        // Same rule as `chipsFor`: a scoreless round gets no chip at all, never a
        // "+0". The row's total already says it, and a zero chip reads as a jab at
        // whoever had the bad round.
        gain.appendChild(el('span', 'chip chip-base', `+${r.roundGain}`));
      }
      row.appendChild(gain);
      // No ▲/▼ delta arrow: the rank movement is shown by the row physically
      // sliding to its new place (animateStandingsMovement, from the same
      // `rankDelta`), so a second numeric indicator would be redundant.
      row.appendChild(el('span', 'sc', String(r.score)));
      breakBoard.appendChild(row);
      rowNodes.push(row);
    });

    // Capture this board as the baseline for the next break. The `breakBuilt`
    // guard above already makes this once-per-break, but the token is kept as a
    // second belt: it also survives a reconnect that re-enters the same break.
    const token = String(state.questionIndex);
    if (breakSnapToken !== token) {
      breakSnapToken = token;
      pendingBreakBoard = board.map((e) => ({ playerId: e.playerId, nickname: e.nickname, score: e.score }));
    }

    // Play the ledger. Reached once per break (see `breakBuilt`); the sequence
    // number it stamps is what its own deferred steps check before painting.
    breakSeq += 1;
    breakAnimToken = String(breakSeq);
    playLedger(rowNodes, rows, breakAnimToken);
  }

  /**
   * Play the break's standings as a **ledger** — four beats told in the order the
   * round actually happened, rather than handing over a finished ranking:
   *
   *   1. the board arrives showing last break's totals, seated in last break's order
   *   2. a hold, so you read where everyone stood before the round
   *   3. every score counts up at once, each row's `+N` gain fading in beside it
   *   4. the rows slide into their new order, climbers passing over the overtaken
   *
   * Beats 1 and 4 are the FLIP this function has always done (driven by `rankDelta`
   * from `roundBreak`): a row that moved up starts `rankDelta` slots lower and rises
   * to place. Rows are uniform height, so one measured stride (row + gap) converts a
   * rank delta to a pixel offset. What's new is that the board *waits* between the
   * two, and counts, so an overtake reads as caused by the points rather than
   * coincident with them.
   *
   * Pure decoration — the final scores and positions are already correct in the DOM
   * before this runs, so `prefers-reduced-motion` skips straight to them. (Unlike
   * the tricky veil, none of this carries a gameplay advantage.) The `token` is the
   * break's identity: every deferred step re-checks it, so a break that ends early
   * (a fast host clock, a reconnect) can't have its timers paint over the next screen.
   *
   * @param {HTMLElement[]} nodes  row node per `rows` entry, in new order
   * @param {import('../flags/partyBreak.js').BreakRow[]} rows
   * @param {string} token  this break's identity; see above
   */
  function playLedger(nodes, rows, token) {
    const gains = nodes.map((n) => /** @type {HTMLElement} */ (n.querySelector('.gain')));
    const scores = nodes.map((n) => /** @type {HTMLElement} */ (n.querySelector('.sc')));
    // A gain of 0 never earns a chip — "+0" is noise on the row of someone who had
    // a bad round, and they already know.
    const showGain = rows.map((r) => r.roundGain > 0);

    if (prefersReducedMotion()) {
      // No motion, but the round's gains are information, not decoration — so they
      // stay, statically, instead of being animated away.
      gains.forEach((g, i) => { g.classList.toggle('on', showGain[i]); });
      return;
    }

    // Beat 1: the rows arrive, bottom-to-top, showing where everyone stood before
    // the round. Fading only — see `scoreline-fade-in`; the seat offsets below own
    // `transform`, and an entrance that animated it would erase them.
    rows.forEach((r, i) => {
      scores[i].textContent = String(r.prevScore);
      nodes[i].classList.add('enter-fade');
      nodes[i].style.setProperty('--enter-delay', `${(rows.length - 1 - i) * LEDGER_ENTER_STAGGER_MS}ms`);
    });
    const stride = nodes.length > 1 ? nodes[1].offsetTop - nodes[0].offsetTop : 0;
    const movers = stride
      ? rows.map((r, i) => (r.rankDelta ? i : -1)).filter((i) => i >= 0)
      : [];
    for (const i of movers) {
      const d = /** @type {number} */ (rows[i].rankDelta);
      nodes[i].style.transition = 'none';
      nodes[i].style.transform = `translateY(${d * stride}px)`;
      nodes[i].style.zIndex = d > 0 ? '2' : '1'; // climbers pass over the overtaken
    }
    void breakBoard.offsetHeight; // commit the start positions before releasing

    // Beats 3 and 4 are scheduled as ABSOLUTE offsets from now, off the tested
    // `ledgerSchedule()`. They used to be nested timers with relative delays, and
    // the inner one measured its delay from the moment the count *started* rather
    // than the moment it *finished* — so the rows slid while the numbers were still
    // climbing, blurring the two motions the settle beat exists to separate. Flat
    // timers off one clock can't drift that way, and the ordering is unit-pinned.
    const { countAt, slideAt, chipsOffAt } = ledgerSchedule(rows.length);
    const stillOurs = () => breakAnimToken === token;

    // Beat 3: every row counts up at once, its gain chip fading in beside it.
    window.setTimeout(() => {
      if (!stillOurs()) return;
      gains.forEach((g, i) => { if (showGain[i]) g.classList.add('on'); });
      rows.forEach((r, i) => countUp(scores[i], r.prevScore, r.score, LEDGER_COUNT_MS, 0, () => !stillOurs()));
    }, countAt);

    // Beat 4: the counting has finished and been read; now the rows change places.
    window.setTimeout(() => {
      if (!stillOurs()) return;
      for (const i of movers) {
        nodes[i].style.transition = 'transform 0.8s cubic-bezier(0.22, 0.61, 0.36, 1)';
        nodes[i].style.transform = 'translateY(0)';
      }
    }, slideAt);

    // The chips have done their job; drop them so the break settles on a clean
    // board of totals, which is what the remaining seconds are for reading.
    window.setTimeout(() => {
      if (!stillOurs()) return;
      gains.forEach((g) => g.classList.remove('on'));
    }, chipsOffAt);
  }


  function renderRevealFoot() {
    const list = el('div', 'toast-list');
    const fastest = CORRECT_POINTS + (SPEED_BONUS[0] || 0);
    const points = (state.reveal && state.reveal.points) || {};
    for (const entry of state.scoreboard || []) {
      const pts = points[entry.playerId] || 0;
      const toast = el('div', 'toast');
      toast.appendChild(buildAvatar(entry.playerId));
      toast.appendChild(el('span', 'toast-name', entry.nickname));
      if (pts === fastest) toast.appendChild(el('span', 'fast', `⚡ ${t('party.fastest', 'Fastest')}`));
      toast.appendChild(el('span', 'pts' + (pts === 0 ? ' zero' : ''), `+${pts}`));
      list.appendChild(toast);
    }
    footEl.appendChild(list);
    // No "Next question" button and no countdown: the question advances on its own
    // after a short beat (the host's clock sends 'next'), so the reveal just
    // shows who scored and moves on.
  }

  function renderFinal() {
    const board = state.scoreboard || [];
    const top = board[0];
    const tie = board.length > 1 && !!top && board[1].score === top.score;
    // A clear winner needs no "{name} takes it" caption — the pink highlight
    // and the breathing effect on the top row already say it. The subtitle
    // only earns its place on a tie, where there's no single winner row to
    // carry the message.
    finalSub.textContent = tie ? t('party.tie', "It's a tie!") : '';
    finalSub.hidden = !tie;

    // The full finish "moment" — cascade, count-up, subtitle pop, and the
    // confetti / fireworks burst — plays once, on the first render of the
    // final screen. Later re-renders (a language switch, a repeated state
    // message) paint the board statically so nothing re-animates.
    const firstShow = !finalCelebrated;
    const animate = firstShow && !prefersReducedMotion();

    finalBoard.innerHTML = '';
    board.forEach((entry, i) => {
      const isWinner = i === 0 && !tie && entry.score > 0;
      // `.champion` (a sole winner) carries the sustained breathe + glow; a
      // tie's top row still gets `.win` styling but no champion effect.
      const row = el('div', 'scoreline' + (i === 0 ? ' win' : ' other') + (isWinner ? ' champion' : ''));
      row.appendChild(el('span', 'rank', String(i + 1)));
      row.appendChild(buildAvatar(entry.playerId));
      row.appendChild(el('span', 'nm', entry.nickname));
      const sc = el('span', 'sc', String(entry.score));
      row.appendChild(sc);
      if (animate) {
        // Cascade in bottom-to-top so the winner's row lands last, then tick
        // that row's score up once it has settled.
        const delay = (board.length - 1 - i) * 90;
        row.classList.add('enter');
        row.style.setProperty('--enter-delay', `${delay}ms`);
        countUp(sc, 0, entry.score, 600, delay + 200);
      }
      finalBoard.appendChild(row);
    });

    if (firstShow) {
      // Pop only applies to the tie caption (the sole surviving subtitle).
      if (animate && tie) { finalSub.classList.remove('pop'); void finalSub.offsetWidth; finalSub.classList.add('pop'); }
      runCelebration(pickPartyCelebration({ scoreboard: board, you: state.you }));
      finalCelebrated = true;
    }

    // Only the host can restart, so both "Play again" and the "·" separator
    // that divides it from "Home" show for the host alone; everyone else sees
    // just "Home".
    playAgainBtn.hidden = !state.isHost;
    const sep = document.getElementById('result-sep');
    if (sep) sep.hidden = !state.isHost;
  }

  function prefersReducedMotion() {
    return typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  /**
   * Tick a score element from one value up to another with an ease-out, so a total
   * feels earned rather than just appearing. Starts after `delayMs`.
   *
   * Both score animations on this page run through here: the final board counts
   * each row from 0 (`delayMs` lines it up with the row's cascade landing), and the
   * between-rounds ledger counts from the player's total at the previous break up to
   * their new one. They are the same mechanism, so they are the same code — an
   * earlier draft of the ledger added a *second* `countUp` beside this one, and
   * because function declarations hoist with the last winning, every call silently
   * resolved to whichever was later in the file. It read as "the animation just
   * doesn't run".
   *
   * `isStale` lets a caller abandon a run whose screen has moved on; without one the
   * tick always plays out.
   *
   * @param {HTMLElement} node @param {number} from @param {number} to
   * @param {number} durationMs @param {number} delayMs
   * @param {(() => boolean) | undefined} [isStale]
   */
  function countUp(node, from, to, durationMs, delayMs, isStale) {
    // Nothing to count (a scoreless round, or a row that sat out) — show the value.
    if (to <= from) { node.textContent = String(to); return; }
    node.textContent = String(from);
    window.setTimeout(() => {
      if (isStale && isStale()) { node.textContent = String(to); return; }
      const start = performance.now();
      const step = (/** @type {number} */ now) => {
        if (isStale && isStale()) { node.textContent = String(to); return; }
        const p = Math.min(1, (now - start) / durationMs);
        const eased = 1 - Math.pow(1 - p, 3);
        node.textContent = String(Math.round(from + (to - from) * eased));
        if (p < 1) requestAnimationFrame(step);
        else node.textContent = String(to);
      };
      requestAnimationFrame(step);
    }, delayMs);
  }

  function onPick(/** @type {string} */ code) {
    if (state.phase !== 'question' || state.myChoice) return;
    const next = withLocalBuzz(state, code);
    if (next.myChoice === code) {
      state = next;
      send({ type: 'buzz', choice: code });
      render();
    }
  }

  // ---- wire controls ----
  $('create-room').addEventListener('click', () => enterRoom(generateCode(), 'create'));

  $('join-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = /** @type {HTMLInputElement} */ (document.getElementById('join-code'));
    const code = input.value.trim().toUpperCase();
    if (!isValidRoomCode(code)) {
      showJoinError('ttt.codeMustBe5', 'Code must be 5 characters');
      return;
    }
    clearJoinError();
    enterRoom(code, 'join');
  });

  for (const btn of draftPickBtns) {
    btn.addEventListener('click', () => {
      picksPerPlayer = validatePicksPerPlayer(Number(btn.dataset.picks));
      savePicks();
      syncDraftLength();
    });
  }
  startBtn.addEventListener('click', () => {
    // Draft is the only way a game starts: zero setup, so the start carries no
    // plan (the server builds the opening Flags round and sizes the game from the
    // seat count) and no reveal config (the veil clear timing is a fixed constant
    // now — see DEFAULT_REVEAL). The only host input is how many rounds each
    // player picks, so `picks` is the whole message.
    //
    // A `draft: true` flag rode along until the server that needed it was gone.
    // It selected the draft branch on the pre-#974 server, which is no longer
    // deployed (`deploy-partykit.yml` shipped the draft-only server from `main`),
    // so nothing reads it any more. Note the ordering constraint if a start field
    // is ever added the same way: PartyKit and the SWA site deploy on separate
    // workflows, so the server has to understand a field before the client sends
    // it, and has to stop needing one before the client drops it.
    send({ type: 'start', picks: picksPerPlayer });
  });
  playAgainBtn.addEventListener('click', () => send({ type: 'playAgain' }));
  questionToSettingsBtn.addEventListener('click', () => send({ type: 'backToLobby' }));

  // Same share mechanism as Tic-Tac-Toe (common.js `shareUrl` → native sheet,
  // clipboard fallback), so the invite icon behaves identically across the two
  // online games. On a plain clipboard copy the icon morphs to a checkmark for
  // 1.5s via the shared `.copied` class; the native sheet and dismiss/fail
  // paths stay silent (matching TTT).
  shareBtn.addEventListener('click', async () => {
    if (!activeRoom) return;
    const result = await shareUrl(window.location.href, {
      title: t('party.shareTitle', 'Flag Party'),
      text: t('party.shareText', 'Join my Flag Party room:'),
    });
    if (result === 'copied') flashCopied();
  });

  function flashCopied() {
    shareBtn.classList.add('copied');
    window.setTimeout(() => shareBtn.classList.remove('copied'), 1500);
  }

  // Re-render dynamic text (country names, labels) on a soft language switch.
  document.addEventListener('langchanged', () => { paintJoinError(); render(); });

  // ---- load data + route ----
  // Countries (for names + flags) and every superlative question's metric (for the
  // reveal strip) load together. Metrics are best-effort: a failed fetch just
  // means that question's reveal shows no numbers, so it can't round the game;
  // countries failing still falls through to a bare render().
  Promise.all([
    fetch('../flags/countries.json').then((r) => r.json()).then(loadCountries),
    ...SUPERLATIVE_METRICS.map((m) =>
      fetch(`../flags/metrics/${METRIC_FILE_BY_KEY[m.key]}`).then((r) => r.json()).catch(() => null)),
  ])
    .then(([countries, ...metrics]) => {
      for (const c of countries) byCode.set(c.code, c);
      SUPERLATIVE_METRICS.forEach(({ questionId }, i) => {
        const m = metrics[i];
        if (m && m.values) metricByQuestion[questionId] = { values: m.values, format: m.format || 'compact' };
      });
      const roomParam = new URLSearchParams(location.search).get('room');
      if (roomParam && isValidRoomCode(roomParam.toUpperCase())) {
        enterRoom(roomParam.toUpperCase(), 'join');
      } else {
        render();
      }
    })
    .catch(() => { render(); });

  // Show the start screen immediately while countries load.
  render();
}
