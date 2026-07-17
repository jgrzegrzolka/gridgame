import { t, countryName } from '../i18n.js';
import { generateCode, isValidRoomCode, serverUrlFor } from '../flags/roomNet.js';
import { deckIconHtml } from '../flags/deckIcons.js';
import { getOrCreateDeviceId } from '../flags/identity.js';
import { displayNickname } from '../flags/nickname.js';
import { loadCountries } from '../flags/group.js';
import { initialPartyClientState, reducePartyMessage, withLocalBuzz, pickPartyCelebration, isCleanReveal } from '../flags/partyClient.js';
import { runCelebration } from '../confetti.js';
import { CORRECT_POINTS, SPEED_BONUS } from '../flags/partyScore.js';
import { QUESTION_SECONDS, revealSecondsFor, BLOCK_BREAK_SECONDS, BLOCK_INTRO_SECONDS, PICK_TIMEOUT_SECONDS, secondsLeft, remainingFraction, veilProgress, namesRevealed, isMetricRound, DEFAULT_REVEAL, REVEAL_OPTIONS, NAME_REVEAL_OPTIONS } from '../flags/partyTiming.js';
import { BLOCK_ROUNDS, PICTURE_MODES, METRIC_MODES, PARTY_MODES, buildPartyPlan, isBlockBoundary, isBlockStart, isFinalBlock, blockIndexForRound, blockCount } from '../flags/partyPlan.js';
import { blockBreak } from '../flags/partyBreak.js';
import { formatValue } from '../flags/metricLens.js';
import { METRIC_ICONS, METRIC_HUES, METRIC_SHORT } from '../flags/metricVisuals.js';
import { METRIC_FILES } from '../flags/metrics/index.js';
import { SUPERLATIVE_METRICS, superlativeMetricByRoundId, hintFor } from '../flags/partyRounds/superlativeCatalog.js';
import { renderableRoundIds, roundRenderAction, canRenderQuestion } from './staleGuard.js';
import { buildAvatar, shareUrl } from '../common.js';

/** @typedef {import('../flags/partyClient.js').PartyClientState} PartyClientState */

const NICKNAME_KEY = 'gridgame.nickname';
// Setup state (the grouped picture-modes + world-facts shape). Supersedes the
// old per-mode PLAN_KEY, which is still read once for a one-time migration of a
// returning host's saved choices into the new shape.
const SETUP_KEY = 'gridgame.party.setup';
const PLAN_KEY = 'gridgame.party.plan';
const TRICKY_KEY = 'gridgame.party.tricky';
const REVEAL_KEY = 'gridgame.party.reveal';
const MODE_KEY = 'gridgame.party.mode';

/** The reveal-timing categories the host configures under tricky mode, in the
 *  order they appear in the setup. `label` reuses the mode-short i18n so "Flags /
 *  Maps / Population" read the same as the mode dials above. */
const REVEAL_CATS = [
  { key: 'flag', labelKey: 'party.modeShort.flagsAll', label: 'Flags' },
  { key: 'map', labelKey: 'party.modeShort.mapOutlines', label: 'Maps' },
  { key: 'metric', labelKey: 'party.groupFacts', label: 'World facts' },
];

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
  'flags-territories': { key: 'party.mode.flagsTerritories', full: 'Flags: others', shortKey: 'party.modeShort.flagsTerritories', short: 'Others' },
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


/** Every round id this build can render: the two fixed picture rounds plus every
 *  superlative metric round in the catalog. The server (PartyKit, its own
 *  deploy) can be a build ahead of a still-open tab and deal a round id outside
 *  this set; when that happens {@link roundRenderAction} reloads us onto the new
 *  build rather than rendering a broken round. See `flagParty/staleGuard.js`. */
const KNOWN_ROUND_IDS = renderableRoundIds(SUPERLATIVE_METRICS.map((m) => m.roundId));

/** Little pictures leading each setup row, distinct enough to tell apart at a
 *  glance. The artwork is shared with flagQuiz's deck indicator via
 *  `flags/deckIcons.js` — promoted there when that second consumer arrived
 *  (Feature V). Only the sizing is ours: `.gs-thumb` / `.gs-contour` in
 *  index.css put them in a 24x24 slot leading a settings row, which is not
 *  the box flagQuiz wants, so the shared module deliberately ships artwork
 *  without sizing and each consumer passes its own class.
 *
 *  Keyed by party mode id, which is not the deck id — this table is the
 *  mapping. Rendered via `iconSpan` (innerHTML), so `<img>` and inline `<svg>`
 *  both work. */
const SETUP_ICONS = {
  'flags-all': deckIconHtml('flags', { className: 'gs-thumb' }),
  'flags-territories': deckIconHtml('weird', { className: 'gs-thumb' }),
  'map-outlines': deckIconHtml('outlines', { className: 'gs-contour' }),
};

/** Metric key (the flags/metrics registry) for a superlative round id. The
 *  catalog states it outright now — it used to be resolved the long way round,
 *  via the values file both registries happened to name.
 *
 *  Feeds the shared per-metric icon + hue (flags/metricVisuals.js) so the party
 *  chips, the prompt lead, and the flagsdata / findFlag metric hub all wear one
 *  visual identity. Covers the population round's legacy `superlative` roundId
 *  (its mode id is `superlative-pop`) like everything else, because the catalog
 *  is keyed by roundId — an older round-id-keyed icon table missed exactly that
 *  case and rendered population prompts with no icon or hue.
 *
 *  @param {string} roundId @returns {string | null} */
function metricKeyForRound(roundId) {
  const m = superlativeMetricByRoundId(roundId);
  return m ? m.key : null;
}

/** Values file for a metric key, for the reveal strip's fetch. */
const METRIC_FILE_BY_KEY = Object.fromEntries(METRIC_FILES.map((m) => [m.key, m.file]));

/** Party mode id -> catalog mode, so the draft's hand cards and block attribution
 *  resolve a mode id to its round type (for the icon) and label. */
const MODE_BY_ID = Object.fromEntries(PARTY_MODES.map((m) => [m.id, m]));

/** The icon HTML for a draft card: the picture thumbnail for a picture mode, or
 *  the metric's own icon for a statistic. Empty string if unknown. */
function modeIconHtml(/** @type {string} */ modeId) {
  if (SETUP_ICONS[modeId]) return SETUP_ICONS[modeId];
  const mode = MODE_BY_ID[modeId];
  if (!mode) return '';
  const key = metricKeyForRound(mode.roundId);
  return (key && METRIC_ICONS[key]) || '';
}

/** The per-metric hue for a statistic mode (for the draft card accent), or null. */
function modeHue(/** @type {string} */ modeId) {
  const mode = MODE_BY_ID[modeId];
  if (!mode) return null;
  const key = metricKeyForRound(mode.roundId);
  return (key && METRIC_HUES[key]) || null;
}

/** The icon HTML for a **block title card** — the same artwork as {@link
 *  modeIconHtml} but at the card's hero size (its own classes rather than the
 *  setup row's tiny slot). Empty string for an unknown mode (the caller shows a
 *  generic Flags card instead). */
function blockCardIconHtml(/** @type {string} */ modeId) {
  if (modeId === 'flags-all') return deckIconHtml('flags', { className: 'blockcard-thumb' });
  if (modeId === 'flags-territories') return deckIconHtml('weird', { className: 'blockcard-thumb' });
  if (modeId === 'map-outlines') return deckIconHtml('outlines', { className: 'blockcard-contour' });
  const mode = MODE_BY_ID[modeId];
  const key = mode ? metricKeyForRound(mode.roundId) : null;
  return (key && METRIC_ICONS[key]) || '';
}

/**
 * Resolve a mode's SHORT label to `{ key, fallback }` — pure, no `t()` — so the
 * mapping can be pinned by a test (the DOM `modeShort` below is a thin `t()`
 * wrapper). Metric modes take their short name from METRIC_SHORT keyed off the
 * ROUND id, which differs from the mode id for population ('superlative-pop' vs
 * roundId 'superlative'); picture modes fall back to their own MODE_LABELS
 * `shortKey`. A mode that resolves to neither returns `{ key: undefined }`,
 * which `flagParty/modeLabels.test.js` asserts can never happen — that gap is
 * exactly what crashed the lobby (an undefined key reached `t()` → `.split`).
 *
 * @param {string} id  a PICTURE_MODES / METRIC_MODES mode id
 * @returns {{ key: string | undefined, fallback: string | undefined }}
 */
export function modeShortLabel(id) {
  const mode = METRIC_MODES.find((m) => m.id === id);
  const metricKey = metricKeyForRound(mode ? mode.roundId : id);
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
 * Which catalog mode a block's title card should announce, resolved from what the
 * client actually knows about the block.
 *
 * - **Drafted block** (`lastPick` present) → the exact picked mode id, so a stat
 *   block names its specific metric ("Coffee production") and a flag block names
 *   its pool ("Flags: countries" vs "Flags: others"). This is the precise path,
 *   and the only one in a Draft game.
 * - **Custom / setlist block** (no `lastPick`) → derived from the question's
 *   `roundId`, which is 1:1 with a mode for the map round and every superlative
 *   metric (`superlative-coffee` etc.). The one exception is the two flag pools,
 *   which **share** `roundId: 'flagPick'` and so can't be told apart from the wire
 *   alone → returns `null`, the caller's cue to show a generic "Flags" card.
 * - Unknown / unrenderable round id → `null` (generic), though the stale-build
 *   guard means such a round never reaches the card anyway.
 *
 * @param {{ picker: string, modeId: string } | null | undefined} lastPick
 * @param {string | undefined} roundId
 * @returns {string | null}  a PARTY_MODES mode id, or null for the generic case
 */
export function blockModeId(lastPick, roundId) {
  if (lastPick && lastPick.modeId && MODE_BY_ID[lastPick.modeId]) return lastPick.modeId;
  if (roundId === 'flagPick') return null; // ambiguous pool → generic Flags card
  const mode = PARTY_MODES.find((m) => m.roundId === roundId);
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
   *  phase (a "Play again" round → final fires a fresh show). */
  let finalCelebrated = false;

  // ---- element refs ----
  const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));
  const statusEl = $('party-status');
  const sections = {
    start: $('pt-start'), lobby: $('pt-lobby'), round: $('pt-round'), blockcard: $('pt-blockcard'), pick: $('pt-pick'), break: $('pt-break'), final: $('pt-final'),
  };
  const roomCodeEl = $('room-code');
  const playersEl = $('players');
  const startBtn = /** @type {HTMLButtonElement} */ ($('start-game'));
  const waitEl = $('lobby-wait');
  const roundPill = $('round-pill');
  const timerEl = $('round-timer');
  const timerFill = $('round-timer-fill');
  const timerLabel = $('round-timer-label');
  const promptEl = $('prompt');
  const promptLead = $('prompt-lead');
  const promptTarget = $('prompt-target');
  const gridEl = $('flags-grid');
  const footEl = $('round-foot');
  const finalSub = $('final-sub');
  const finalBoard = $('final-board');
  const breakPill = $('break-pill');
  const breakMvp = $('break-mvp');
  const breakStandingsLabel = $('break-standings-label');
  const breakBoard = $('break-board');
  const blockCardCount = $('blockcard-count');
  const blockCardIc = $('blockcard-ic');
  const blockCardName = $('blockcard-name');
  const blockCardRounds = $('blockcard-rounds');
  const blockCardPick = $('blockcard-pick');
  const blockCardDouble = $('blockcard-double');
  const partyModeEl = $('party-mode');
  const modeDraftBtn = $('mode-draft');
  const modeCustomBtn = $('mode-custom');
  const pickPill = $('pick-pill');
  const pickLead = $('pick-lead');
  const pickHand = $('pick-hand');
  const pickWatch = $('pick-watch');
  const playAgainBtn = /** @type {HTMLButtonElement} */ ($('play-again'));
  const roundToSettingsBtn = /** @type {HTMLButtonElement} */ ($('round-to-settings'));
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
  const gameSetupEl = $('game-setup');
  const gsModesEl = $('gs-modes');
  const gsMixEl = $('gs-mix');
  const gsRoundsEl = $('gs-rounds');

  /** @type {Map<string, { code: string, name: string }>} */
  const byCode = new Map();

  // Metric values for each superlative round's reveal strip, keyed by roundId
  // (the round is judged server-side; the client only needs the numbers to show
  // the ranking after the answer is out). Fetched once at load, best-effort: a
  // missing metric just means that round's reveal shows no numbers.
  /** @type {Record<string, { values: Record<string, number>, format: string }>} */
  const metricByRound = {};

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

  function showSection(/** @type {'start'|'lobby'|'round'|'blockcard'|'pick'|'break'|'final'|null} */ which) {
    for (const [k, node] of Object.entries(sections)) node.hidden = k !== which;
  }

  function send(/** @type {object} */ msg) {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }

  // ---- how to play: draft vs custom setlist ----
  // The host chooses at the lobby. Draft (the default) is zero-setup: the players
  // pick each block as they go. Custom setup opens the game-setup panel below to
  // build the whole show up front. Persisted per device.
  /** @type {'draft' | 'setlist'} */
  let partyMode = loadPartyMode();
  function loadPartyMode() {
    try { return window.localStorage.getItem(MODE_KEY) === 'setlist' ? 'setlist' : 'draft'; } catch { return 'draft'; }
  }
  function savePartyMode() {
    try { window.localStorage.setItem(MODE_KEY, partyMode); } catch { /* private mode */ }
  }

  // ---- game setup (host-only lobby plan) ----
  // The host picks which modes play. Under the block model every enabled mode is
  // one 5-round block, so a mode is simply on or off. The fixed picture trio
  // (flags / territories / map) each get a toggle; the world-facts family is a
  // row of colour chips, and each chosen statistic is its own block (five rounds
  // of that one metric). The choice is local (persisted per device) until Start,
  // when buildPartyPlan() turns it into a segment plan that rides the 'start'
  // message and the server validates; this is just the picker.
  /** @typedef {{ picture: Record<string, { on: boolean }>, facts: { metrics: Record<string, boolean> } }} SetupState */
  /** @type {SetupState} */
  const setupState = loadSetup();
  // Game-wide tricky-mode toggle (not per-mode). Persisted per device like the
  // plan; rides on the 'start' message and the server broadcasts it back so
  // every client veils the tiles in step.
  let trickyOn = loadTricky();
  // Per-category reveal timing (fraction of the window each veil clears at). The
  // flag/map/metric veil fractions are only meaningful when tricky is on; `name`
  // (the world-facts name-reveal point, null = off) is independent of tricky.
  // Persisted and sent with the plan on start.
  /** @type {{ flag: number, map: number, metric: number, name: number | null }} */
  let revealState = loadReveal();

  function loadTricky() {
    try { return window.localStorage.getItem(TRICKY_KEY) === '1'; } catch { return false; }
  }
  function saveTricky() {
    try { window.localStorage.setItem(TRICKY_KEY, trickyOn ? '1' : '0'); } catch { /* private mode */ }
  }
  /** Load the saved reveal config, snapping each value to an allowed option and
   *  filling any gap with the default (so a stale / partial store can't break it). */
  function loadReveal() {
    /** @type {any} */
    let raw = null;
    try { raw = JSON.parse(window.localStorage.getItem(REVEAL_KEY) || 'null'); } catch { /* private mode */ }
    const pick = (/** @type {any} */ v, /** @type {number} */ def) =>
      (REVEAL_OPTIONS.includes(v) ? v : def);
    // Names: null is explicit "off"; a missing field (older store) defaults on.
    const pickName = (/** @type {any} */ v) =>
      (v === null ? null : (NAME_REVEAL_OPTIONS.includes(v) ? v : DEFAULT_REVEAL.name));
    const r = raw && typeof raw === 'object' ? raw : {};
    return {
      flag: pick(r.flag, DEFAULT_REVEAL.flag),
      map: pick(r.map, DEFAULT_REVEAL.map),
      metric: pick(r.metric, DEFAULT_REVEAL.metric),
      name: pickName(r.name),
    };
  }
  function saveReveal() {
    try { window.localStorage.setItem(REVEAL_KEY, JSON.stringify(revealState)); } catch { /* private mode */ }
  }

  /** True when the setup would produce at least one block (a game needs rounds). */
  function hasAnyRounds(/** @type {SetupState} */ s) {
    if (PICTURE_MODES.some((m) => s.picture[m.id] && s.picture[m.id].on)) return true;
    return METRIC_MODES.some((m) => s.facts.metrics[m.id]);
  }

  /** The default setup: 3 blocks on, not everything. Flags: countries and Map:
   *  outlines play, plus one statistic block (Population — the most familiar
   *  metric). Flags: others and every other statistic start off, so a fresh game
   *  is 3 blocks / 15 rounds. Since each statistic is now its own block,
   *  everything-on would be dozens of blocks, so the default deliberately picks a
   *  single stat to keep the length sane. */
  function defaultSetup() {
    /** @type {Record<string, { on: boolean }>} */
    const picture = {};
    for (const m of PICTURE_MODES) picture[m.id] = { on: m.id !== 'flags-territories' };
    /** @type {Record<string, boolean>} */
    const metrics = {};
    for (const m of METRIC_MODES) metrics[m.id] = m.id === 'superlative-pop';
    return { picture, facts: { metrics } };
  }

  /** Coerce a stored / partial setup to a valid one, filling gaps from the
   *  default and never returning an all-off (zero-block) state. Reads only `on`
   *  for picture modes and the per-metric booleans; a stored per-mode count (`n`,
   *  the retired stepper) or the old facts master toggle (`facts.on`) is dropped. */
  function sanitizeSetup(/** @type {any} */ raw) {
    const def = defaultSetup();
    /** @type {Record<string, { on: boolean }>} */
    const picture = {};
    for (const m of PICTURE_MODES) {
      const e = raw && raw.picture && raw.picture[m.id];
      picture[m.id] = e && typeof e === 'object' ? { on: !!e.on } : def.picture[m.id];
    }
    // An old store carried a facts master toggle: if it was off, treat every
    // metric as off regardless of the per-metric flags (they were inert then).
    const factsWasOff = raw && raw.facts && typeof raw.facts.on === 'boolean' && !raw.facts.on;
    /** @type {Record<string, boolean>} */
    const metrics = {};
    for (const m of METRIC_MODES) {
      const v = raw && raw.facts && raw.facts.metrics ? raw.facts.metrics[m.id] : undefined;
      metrics[m.id] = factsWasOff ? false : (v == null ? def.facts.metrics[m.id] : !!v);
    }
    const s = { picture, facts: { metrics } };
    return hasAnyRounds(s) ? s : def;
  }

  /** One-time migration of a returning host's old per-mode plan (PLAN_KEY) into
   *  the block shape: any picture mode with a positive count carries over as on;
   *  each metric that had rounds becomes its own statistic block. Round counts are
   *  dropped — a mode is now a block, not a count. */
  function migrateModeState(/** @type {any} */ raw) {
    /** @type {Record<string, { on: boolean }>} */
    const picture = {};
    for (const m of PICTURE_MODES) {
      const e = raw[m.id];
      picture[m.id] = { on: !!(e && e.on && (typeof e.n !== 'number' || e.n >= 1)) };
    }
    /** @type {Record<string, boolean>} */
    const metrics = {};
    for (const m of METRIC_MODES) {
      const e = raw[m.id];
      metrics[m.id] = !!(e && e.on);
    }
    return sanitizeSetup({ picture, facts: { metrics } });
  }

  function loadSetup() {
    try {
      const raw = JSON.parse(window.localStorage.getItem(SETUP_KEY) || 'null');
      if (raw && raw.picture && raw.facts) return sanitizeSetup(raw);
    } catch { /* private mode / malformed */ }
    // Fall back to a one-time migration from the old per-mode plan store.
    try {
      const old = JSON.parse(window.localStorage.getItem(PLAN_KEY) || 'null');
      if (old && typeof old === 'object') return migrateModeState(old);
    } catch { /* ignore */ }
    return defaultSetup();
  }
  function saveSetup() {
    try { window.localStorage.setItem(SETUP_KEY, JSON.stringify(setupState)); } catch { /* private mode */ }
  }
  /** The plan to send on Start: one block per enabled mode (picture or statistic). */
  function currentPlan() {
    return buildPartyPlan(setupState);
  }
  /** How many blocks the current setup plays: enabled picture modes + enabled statistics. */
  function blocksOn() {
    let n = 0;
    for (const m of PICTURE_MODES) if (setupState.picture[m.id] && setupState.picture[m.id].on) n += 1;
    for (const m of METRIC_MODES) if (setupState.facts.metrics[m.id]) n += 1;
    return n;
  }

  // Thin `t()` wrappers over the pure resolvers (modeFullLabel / modeShortLabel
  // above) — the id→label mapping lives up there so it can be pinned by
  // flagParty/modeLabels.test.js; here we just localize the resolved key.
  const modeLabel = (/** @type {string} */ id) => {
    const { key, fallback } = modeFullLabel(id);
    return t(key, fallback);
  };
  const modeShort = (/** @type {string} */ id) => {
    const { key, fallback } = modeShortLabel(id);
    return t(key, fallback);
  };

  // ---- setup row builders (shared bits) ----
  /** @param {string} svg */
  function iconSpan(svg) {
    const span = el('span', 'gs-ic');
    span.innerHTML = svg;
    span.setAttribute('aria-hidden', 'true');
    return span;
  }
  /** @param {string} key @param {string} fallback */
  function sectionLabel(key, fallback) {
    const s = el('div', 'gs-sec', t(key, fallback));
    s.dataset.i18nKey = key;
    return s;
  }
  /** The site's shared switch, wired to callbacks. @param {() => boolean} getOn @param {(on: boolean) => void} onToggle @param {string} ariaLabel */
  function toggleEl(getOn, onToggle, ariaLabel) {
    const sw = document.createElement('label');
    sw.className = 'scope-toggle-switch';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = getOn();
    input.setAttribute('aria-label', ariaLabel);
    input.addEventListener('change', () => onToggle(input.checked));
    const track = el('span', 'scope-toggle-track');
    track.appendChild(el('span', 'scope-toggle-thumb'));
    sw.append(input, track);
    return sw;
  }

  /** Build the setup rows once; their values are painted by updateSetup(). */
  function buildSetup() {
    gsModesEl.innerHTML = '';

    // The fixed picture trio — a picture icon, a name, and a toggle each. Every
    // enabled mode is exactly one 5-round block, so there's no per-mode count and
    // no need to label each row "1 block": on or off.
    gsModesEl.appendChild(sectionLabel('party.groupPictures', 'Flags & maps'));
    for (const m of PICTURE_MODES) {
      const row = el('div', 'gs-mode');
      row.dataset.mode = m.id;
      row.appendChild(iconSpan(SETUP_ICONS[m.id]));
      row.appendChild(el('span', 'gs-name', modeLabel(m.id)));
      row.appendChild(toggleEl(() => setupState.picture[m.id].on, (on) => togglePicture(m.id, on), modeLabel(m.id)));
      gsModesEl.appendChild(row);
    }

    // The world-facts family: a row of colour chips, one per statistic. Each
    // chosen statistic is its own block (five rounds of that metric), so a chip is
    // a block toggle — no master switch. A new metric costs one chip here.
    gsModesEl.appendChild(sectionLabel('party.groupFacts', 'World facts'));
    const factsHint = el('p', 'gs-facts-hint', t('party.factsHint2', 'Each statistic you pick is its own block'));
    factsHint.id = 'gs-facts-hint';
    gsModesEl.appendChild(factsHint);

    const chips = el('div', 'gs-chips');
    chips.id = 'gs-chips';
    for (const m of METRIC_MODES) {
      const chip = el('button', 'gs-chip');
      /** @type {HTMLButtonElement} */ (chip).type = 'button';
      chip.dataset.metric = m.id;
      const metricKey = metricKeyForRound(m.roundId);
      chip.style.setProperty('--mc', (metricKey && METRIC_HUES[metricKey]) || 'currentColor');
      chip.appendChild(iconSpan((metricKey && METRIC_ICONS[metricKey]) || ''));
      chip.appendChild(el('span', 'gs-chip-label', modeShort(m.id)));
      chip.addEventListener('click', () => toggleMetric(m.id));
      chips.appendChild(chip);
    }
    gsModesEl.appendChild(chips);

    // World-facts name reveal: on a facts round the challenge is the fact, not
    // flag recognition, so the country names fade onto the tiles partway through
    // the clock (or never, if the host picks "Off"). Independent of tricky mode —
    // it fires in a normal game too — so it lives here on the facts block, not in
    // the tricky reveal box below. A native <select> with an Off option + the
    // allowed fractions, mirroring the tricky reveal pickers' look.
    const namesBox = el('div', 'gs-reveal gs-names');
    const namesRow = el('div', 'gs-reveal-row');
    namesRow.appendChild(el('span', 'gs-reveal-name', t('party.nameRevealHint', 'Show country names after…')));
    const namesSel = document.createElement('select');
    namesSel.className = 'gs-reveal-pick';
    namesSel.setAttribute('aria-label', t('party.nameRevealHint', 'Show country names after…'));
    const offOpt = document.createElement('option');
    offOpt.value = 'off';
    offOpt.textContent = t('party.namesOff', 'Off');
    if (revealState.name === null) offOpt.selected = true;
    namesSel.appendChild(offOpt);
    for (const opt of NAME_REVEAL_OPTIONS) {
      const o = document.createElement('option');
      o.value = String(opt);
      o.textContent = `${Math.round(opt * 100)}%`;
      if (opt === revealState.name) o.selected = true;
      namesSel.appendChild(o);
    }
    namesSel.addEventListener('change', () => {
      if (namesSel.value === 'off') { revealState.name = null; saveReveal(); return; }
      const v = Number(namesSel.value);
      if (NAME_REVEAL_OPTIONS.includes(v)) { revealState.name = v; saveReveal(); }
    });
    namesRow.appendChild(namesSel);
    namesBox.appendChild(namesRow);
    gsModesEl.appendChild(namesBox);

    // Game-wide tricky toggle (a mode-frame row with no stepper) + the
    // per-category reveal-timing pickers shown only while tricky is on.
    const trickyRow = el('div', 'gs-mode gs-option');
    const nameCol = el('span', 'gs-name');
    nameCol.appendChild(el('span', 'gs-opt-title', t('party.tricky', 'Tricky mode')));
    nameCol.appendChild(el('span', 'gs-opt-hint', t('party.trickyHint', 'Flags start hidden and clear as the clock runs')));
    trickyRow.appendChild(nameCol);
    trickyRow.appendChild(toggleEl(() => trickyOn, (on) => { trickyOn = on; saveTricky(); syncRevealVisibility(); }, t('party.tricky', 'Tricky mode')));
    gsModesEl.appendChild(trickyRow);

    // Per-category reveal timing, shown only while tricky is on. Each category
    // (Flags / Maps / World facts) picks when its veil fully clears, as a
    // fraction of the question window (later = harder). A native <select> keeps
    // it compact and accessible on a phone.
    const revealBox = el('div', 'gs-reveal');
    revealBox.id = 'gs-reveal';
    revealBox.appendChild(el('p', 'gs-reveal-hint', t('party.revealHint', 'Clear the flag after…')));
    for (const cat of REVEAL_CATS) {
      const line = el('div', 'gs-reveal-row');
      line.appendChild(el('span', 'gs-reveal-name', t(cat.labelKey, cat.label)));
      const sel = document.createElement('select');
      sel.className = 'gs-reveal-pick';
      sel.dataset.cat = cat.key;
      sel.setAttribute('aria-label', t(cat.labelKey, cat.label));
      for (const opt of REVEAL_OPTIONS) {
        const o = document.createElement('option');
        o.value = String(opt);
        o.textContent = `${Math.round(opt * 100)}%`;
        if (opt === revealState[/** @type {'flag'|'map'|'metric'} */ (cat.key)]) o.selected = true;
        sel.appendChild(o);
      }
      sel.addEventListener('change', () => {
        const v = Number(sel.value);
        if (REVEAL_OPTIONS.includes(v)) { revealState[/** @type {'flag'|'map'|'metric'} */ (cat.key)] = v; saveReveal(); }
      });
      line.appendChild(sel);
      revealBox.appendChild(line);
    }
    gsModesEl.appendChild(revealBox);
    syncRevealVisibility();

    updateSetup();
  }

  /** Show the per-category reveal pickers only while tricky mode is on. */
  function syncRevealVisibility() {
    const box = gsModesEl.querySelector('#gs-reveal');
    if (box) /** @type {HTMLElement} */ (box).hidden = !trickyOn;
  }

  // ---- setup mutations ----
  function togglePicture(/** @type {string} */ id, /** @type {boolean} */ on) {
    // A game needs at least one block — refuse a toggle-off that would zero everything.
    const tentative = { ...setupState, picture: { ...setupState.picture, [id]: { on } } };
    if (!hasAnyRounds(tentative)) { updateSetup(); return; }
    setupState.picture[id].on = on;
    saveSetup();
    updateSetup();
  }
  function toggleMetric(/** @type {string} */ id) {
    const metrics = setupState.facts.metrics;
    const next = !metrics[id];
    // Each statistic is its own block — a chip is a block toggle. A game needs at
    // least one block, so refuse a toggle-off that would zero everything.
    const tentative = { ...setupState, facts: { metrics: { ...metrics, [id]: next } } };
    if (!hasAnyRounds(tentative)) { updateSetup(); return; }
    metrics[id] = next;
    saveSetup();
    updateSetup();
  }

  /** Repaint toggles, chips, the block count, and the collapsed mode mix. */
  function updateSetup() {
    gsMixEl.innerHTML = '';
    for (const m of PICTURE_MODES) {
      const st = setupState.picture[m.id];
      const row = /** @type {HTMLElement | null} */ (gsModesEl.querySelector(`[data-mode="${m.id}"]`));
      if (row) {
        row.classList.toggle('off', !st.on);
        const inp = /** @type {HTMLInputElement | null} */ (row.querySelector('input')); if (inp) inp.checked = st.on;
      }
      if (st.on) gsMixEl.appendChild(el('span', '', modeShort(m.id)));
    }
    // Chips: each is a block toggle, coloured (on) when its statistic is chosen.
    for (const m of METRIC_MODES) {
      const chip = gsModesEl.querySelector(`.gs-chip[data-metric="${m.id}"]`);
      if (chip) {
        const active = !!setupState.facts.metrics[m.id];
        chip.classList.toggle('on', active);
        chip.classList.toggle('off', !active);
        chip.setAttribute('aria-pressed', String(active));
        if (active) gsMixEl.appendChild(el('span', '', modeShort(m.id)));
      }
    }
    // The meta reads "N blocks" — the game's length unit is now the block.
    gsRoundsEl.textContent = String(blocksOn());
  }

  /** On a language switch, repaint the JS-set labels (sections, rows, chips, mix). */
  function repaintSetupLabels() {
    for (const s of /** @type {NodeListOf<HTMLElement>} */ (gsModesEl.querySelectorAll('.gs-sec'))) {
      const key = s.dataset.i18nKey; if (key) s.textContent = t(key, s.textContent || '');
    }
    for (const m of PICTURE_MODES) {
      const row = gsModesEl.querySelector(`[data-mode="${m.id}"]`);
      const nm = row && row.querySelector('.gs-name');
      if (nm) nm.textContent = modeLabel(m.id);
    }
    const factsHint = gsModesEl.querySelector('#gs-facts-hint');
    if (factsHint) factsHint.textContent = t('party.factsHint2', 'Each statistic you pick is its own block');
    for (const m of METRIC_MODES) {
      const lbl = gsModesEl.querySelector(`.gs-chip[data-metric="${m.id}"] .gs-chip-label`);
      if (lbl) lbl.textContent = modeShort(m.id);
    }
    const optTitle = gsModesEl.querySelector('.gs-option .gs-opt-title');
    if (optTitle) optTitle.textContent = t('party.tricky', 'Tricky mode');
    const optHint = gsModesEl.querySelector('.gs-option .gs-opt-hint');
    if (optHint) optHint.textContent = t('party.trickyHint', 'Flags start hidden and clear as the clock runs');
    const revealHint = gsModesEl.querySelector('.gs-reveal-hint');
    if (revealHint) revealHint.textContent = t('party.revealHint', 'Clear the flag after…');
    for (const cat of REVEAL_CATS) {
      const nm = gsModesEl.querySelector(`.gs-reveal-pick[data-cat="${cat.key}"]`);
      const nameEl = nm && nm.previousElementSibling;
      if (nameEl) nameEl.textContent = t(cat.labelKey, cat.label);
    }
    const namesLabel = gsModesEl.querySelector('.gs-names .gs-reveal-name');
    if (namesLabel) namesLabel.textContent = t('party.nameRevealHint', 'Show country names after…');
    const namesOff = gsModesEl.querySelector('.gs-names option[value="off"]');
    if (namesOff) namesOff.textContent = t('party.namesOff', 'Off');
    updateSetup();
  }

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

  // ---- round clock ----
  // Everyone renders the countdown; only the host's timer fires the transition
  // (send 'reveal' when a question runs out, 'next' when a reveal has lingered),
  // so the room advances on its own with no host button to press. Timing lives
  // here on the page by design — the room reducer stays time-free. Caveat: the
  // pace depends on the host's tab staying awake; if the host drops mid-round
  // the room can stall at a reveal (documented in PARTY.md, server-alarm is the
  // future fix). All-present-buzzed still auto-reveals server-side regardless.
  /** @type {string | null} phase:roundIndex the clock is currently counting */
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
  //     the country-name strips onto metric tiles once `nameFrac` of the window
  //     has passed (independent of tricky; see `nameActive`).
  // Both live on the grid (which persists across tile rebuilds — only its
  // innerHTML is replaced), so a re-render mid-question (a late join, a buzz
  // notification) never resets either animation. The timings ride on the question
  // itself (`clearFrac` / `nameFrac`, stamped server-side from the host's config),
  // so every client flips in step and each round can differ.
  let veilRaf = 0;
  /** True when this question should fade country names on (world-facts round with
   *  the host's name reveal enabled). */
  function nameActive() {
    return !!(state.question && isMetricRound(state.question.roundId) && state.question.nameFrac != null);
  }
  /** True when this question's tiles are veiled: the host's tricky mode, or the
   *  always-tricky final block (regardless of the host's setting). **Never on a
   *  statistics round** — the veil is a flag / outline recognition challenge, but
   *  on a "which grows the most coffee?" round the flag is incidental, so hiding it
   *  tests the wrong thing. Stat rounds have the name-reveal for their own
   *  flag-identity problem (see `nameActive`). */
  function veilActive() {
    if (state.question && isMetricRound(state.question.roundId)) return false;
    return state.tricky || isFinalBlock(state.roundIndex, state.totalRounds);
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
      const nameFrac = state.question ? state.question.nameFrac : null;
      gridEl.classList.toggle('names-shown', namesRevealed(clockDeadline, now, clockTotalMs, nameFrac));
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

  /** (Re)start the countdown when the phase or round changes; otherwise leave it. */
  function syncClock() {
    const mode = clockMode();
    const token = `${mode}:${state.roundIndex}`;
    if (token === clockToken) return;
    clockToken = token;
    clockFired = false;
    // The reveal length depends on the round, not the room: a clean sweep (every
    // present player got it right) snaps on; a miss holds so the correct flag
    // can be read. Question time is fixed. (flagQuiz's correct-fast/wrong-slow.)
    // The draft pick has its own fixed window.
    const clean = mode === 'reveal' && isCleanReveal(state.roster, state.reveal);
    // A block-boundary reveal plays two beats — the answer tiles for a normal
    // reveal, then the standings break — so the host holds the sum before sending
    // `next`, keeping the break its full duration after the answer is shown. An
    // ordinary reveal is just its own beat.
    const revealSecs = atBlockBreak() ? revealSecondsFor(clean) + BLOCK_BREAK_SECONDS : revealSecondsFor(clean);
    // The pick has no visible countdown (choosing isn't a race); its clock is the
    // long invisible anti-stall fallback that force-picks only an absent picker.
    const secs = mode === 'picking' ? PICK_TIMEOUT_SECONDS : (mode === 'reveal' ? revealSecs : QUESTION_SECONDS);
    clockTotalMs = secs * 1000;
    clockDeadline = Date.now() + clockTotalMs;
    // Only the question phase shows the round bar. The reveal and the pick are
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
  // successfully render a server-dealt round (proof our build is compatible), so
  // it re-arms for a future deploy while blocking a reload loop if the reload
  // came back on the same stale build. sessionStorage: per-tab, gone on close.
  const UPDATE_RELOAD_KEY = 'gridgame.party.updateReload';
  const updateReloadTried = () => { try { return window.sessionStorage.getItem(UPDATE_RELOAD_KEY) === '1'; } catch { return false; } };
  const markUpdateReload = () => { try { window.sessionStorage.setItem(UPDATE_RELOAD_KEY, '1'); } catch { /* private mode */ } };
  const clearUpdateReload = () => { try { window.sessionStorage.removeItem(UPDATE_RELOAD_KEY); } catch { /* private mode */ } };

  /** The blocked fallback: a stale tab that reloaded and is *still* on an old
   *  build (cached HTML, offline). Show a plain notice in the round frame rather
   *  than looping the reload or rendering the broken round. */
  function renderUpdateNotice() {
    roundPill.textContent = '';
    timerEl.hidden = true;
    promptLead.hidden = true; promptLead.textContent = '';
    promptTarget.textContent = t('party.updateNeeded', 'A new version is available. Refresh the page to keep playing.');
    gridEl.innerHTML = '';
    footEl.innerHTML = '';
  }

  // ---- between-blocks break ----
  // The break is a longer reveal, not a room phase: at a block boundary the room
  // stays in `reveal`, the host just holds BLOCK_BREAK_SECONDS instead of the
  // usual reveal beat, and every client paints the standings break in place of
  // the answer. `prevBreakBoard` is the scoreboard snapshot from the last break
  // (null before the first), so each break diffs against the last to show block
  // gains and rank movement. Reset when a fresh game begins (lobby).
  /** @type {Array<{ playerId: string, nickname: string, score: number }> | null} */
  let prevBreakBoard = null;
  /** The baseline for the NEXT break, captured when a break is first shown but
   *  not committed to `prevBreakBoard` until the next block's question arrives —
   *  so re-renders of the same break keep diffing against the old baseline
   *  (committing early would zero the deltas mid-break). */
  let pendingBreakBoard = null;
  /** Guards the once-per-break capture against repeated renders of one break. */
  let breakSnapToken = null;
  /** Guards the once-per-break standings-movement animation (the rows sliding from
   *  their previous rank to the new one), so render()'s re-runs don't replay it. */
  let breakAnimToken = null;
  /** True once this device has sent its pick for the current draft turn, so a
   *  double-tap can't fire two picks; reset when we leave the picking phase. */
  let pickSent = false;

  // ---- block title card ----
  // A short beat (BLOCK_INTRO_SECONDS) announcing a new block before its first
  // round, on blocks 2..N (the opener starts play straight away). It's a
  // client-side hold: the question is already dealt, but we show the card first
  // and only start the round + clock + veil when the beat ends — so it costs no
  // answer time, and because every client (host included) holds the same beat it
  // introduces no clock drift. `blockIntroToken` guards the once-per-block-start
  // arm against render()'s many re-runs; `blockIntroActive` is true while the
  // beat is on screen.
  let blockIntroTimer = 0;
  /** @type {string | null} */
  let blockIntroToken = null;
  let blockIntroActive = false;
  function armBlockIntro(/** @type {string} */ token) {
    blockIntroToken = token;
    blockIntroActive = true;
    window.clearTimeout(blockIntroTimer);
    blockIntroTimer = window.setTimeout(() => { blockIntroActive = false; render(); }, BLOCK_INTRO_SECONDS * 1000);
  }
  function resetBlockIntro() {
    window.clearTimeout(blockIntroTimer);
    blockIntroTimer = 0;
    blockIntroToken = null;
    blockIntroActive = false;
    resetBlockBreakAnswer();
  }

  // ---- block-boundary answer beat ----
  // A block ends on its 5th round, and the client shows the standings break in
  // place of that reveal — which meant the block's LAST round never got to show
  // its correct / wrong answers. So a boundary reveal now plays two beats: first
  // the answer tiles for a normal reveal beat (proper/wrong answers, like every
  // other round), then the standings break. A client-side hold flips between
  // them, exactly like the block-intro card; the host holds the whole window
  // (answer beat + break) before it sends `next`, so the break keeps its full
  // duration. `blockBreakToken` guards the once-per-boundary arm against
  // render()'s re-runs; `blockBreakAnswerActive` is true while the answer tiles
  // are on screen, false once we've flipped to the standings.
  let blockBreakTimer = 0;
  /** @type {string | null} */
  let blockBreakToken = null;
  let blockBreakAnswerActive = false;
  function armBlockBreakAnswer(/** @type {string} */ token) {
    blockBreakToken = token;
    blockBreakAnswerActive = true;
    window.clearTimeout(blockBreakTimer);
    const clean = isCleanReveal(state.roster, state.reveal);
    blockBreakTimer = window.setTimeout(() => { blockBreakAnswerActive = false; render(); }, revealSecondsFor(clean) * 1000);
  }
  function resetBlockBreakAnswer() {
    window.clearTimeout(blockBreakTimer);
    blockBreakTimer = 0;
    blockBreakToken = null;
    blockBreakAnswerActive = false;
  }

  /** True when the current reveal is a between-blocks break (a boundary round
   *  with another block to follow). Client-derived from roundIndex + totalRounds
   *  — no plan needed. */
  function atBlockBreak() {
    return state.phase === 'reveal' && !!state.reveal
      && isBlockBoundary(state.roundIndex, state.totalRounds);
  }

  // ---- render ----
  function render() {
    if (!activeRoom) { stopClock(); stopVeil(); showSection('start'); return; }
    // Leaving (or not yet in) the final screen re-arms the one-shot celebration.
    if (state.phase !== 'final') finalCelebrated = false;
    // Re-arm the pick guard whenever we're not mid-pick, so the next draft turn
    // accepts a fresh choice.
    if (state.phase !== 'picking') pickSent = false;
    if (state.phase === 'question' || state.phase === 'reveal') {
      // A question this build can't render means the server is a build ahead of
      // us (its deploy landed while this tab stayed open). Reload onto the new
      // build once; the seat survives (room code in URL, pid persisted).
      // `canRenderQuestion` judges the whole question, not just its round id — a
      // known metric dealt in a direction we have no copy for is skew too, and
      // rendering it anyway would mis-score silently.
      const q = state.question;
      const action = roundRenderAction(canRenderQuestion(q, KNOWN_ROUND_IDS), updateReloadTried());
      if (action === 'reload') { markUpdateReload(); stopClock(); stopVeil(); window.location.reload(); return; }
      if (action === 'blocked') { stopClock(); stopVeil(); showSection('round'); renderUpdateNotice(); return; }
      clearUpdateReload();
      // Leaving a break (the next block's first question is here): the standings
      // we just showed become the baseline the following break diffs against.
      if (state.phase === 'question' && pendingBreakBoard) { prevBreakBoard = pendingBreakBoard; pendingBreakBoard = null; }
      // Every block opens with a title-card beat before its first round — the
      // opening block included, so it doubles as the synchronized "get ready" beat
      // at game start (the host who clicked Start doesn't see the first question
      // ahead of the other seats). The question is already dealt; we hold the card
      // and start the round + clock + veil only when the beat ends, so the card
      // costs no answer time. Armed once per block-start (the token guards
      // render()'s re-runs from restarting it).
      if (state.phase === 'question' && isBlockStart(state.roundIndex, state.totalRounds)) {
        const token = String(state.roundIndex);
        if (blockIntroToken !== token) armBlockIntro(token);
        if (blockIntroActive) { stopClock(); stopVeil(); showSection('blockcard'); renderBlockCard(); return; }
      }
      // At a block boundary the reveal becomes the standings break instead of the
      // answer tiles. The clock still runs (host advances after the break beat),
      // just against the break duration; syncClock reads atBlockBreak() for it.
      // A block-boundary reveal plays two beats: the answer tiles first (so the
      // block's last round shows proper/wrong answers like any other round), then
      // the standings break. The client-side hold flips between them; syncClock
      // holds the whole window (answer beat + break) so the break keeps its beat.
      if (atBlockBreak()) {
        const token = String(state.roundIndex);
        if (blockBreakToken !== token) armBlockBreakAnswer(token);
        if (blockBreakAnswerActive) { stopVeil(); showSection('round'); renderRound(); syncClock(); return; }
        stopVeil(); showSection('break'); renderBreak(); syncClock(); return;
      }
      showSection('round'); renderRound(); syncClock();
      // The veil + name reveal animate during the question only; the reveal phase
      // always shows crisp tiles (stopVeil pins `--veil-p` to 1 and clears
      // `names-shown`). Run the loop when tricky is on, when a world-facts round
      // has name-reveal enabled, or on the always-tricky final block (the block
      // that decides the game plays veiled regardless of the host's setting — it
      // finally gives the veil a home, since draft never shows the toggle).
      if (state.phase === 'question' && (veilActive() || nameActive())) startVeil(); else stopVeil();
    }
    else if (state.phase === 'picking') { stopVeil(); showSection('pick'); renderPick(); syncClock(); }
    else if (state.phase === 'final') { stopClock(); stopVeil(); showSection('final'); renderFinal(); }
    else {
      // Lobby = a fresh game (or play-again reset): forget the block baselines so
      // the first break of the next game shows gains-from-zero, no deltas, and
      // clear any pending block-intro beat.
      prevBreakBoard = null; pendingBreakBoard = null; breakSnapToken = null; breakAnimToken = null;
      resetBlockIntro();
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
    // Draft-vs-custom is the host's choice; the game-setup panel only shows under
    // Custom. Both are host-only, lobby-only.
    partyModeEl.hidden = !hostSetup;
    syncPartyMode();
    gameSetupEl.hidden = !(hostSetup && partyMode === 'setlist');
  }

  /** Reflect the selected mode on the two doors (and the setup panel's visibility
   *  is handled by renderLobby). */
  function syncPartyMode() {
    modeDraftBtn.classList.toggle('on', partyMode === 'draft');
    modeCustomBtn.classList.toggle('on', partyMode === 'setlist');
    modeDraftBtn.setAttribute('aria-pressed', String(partyMode === 'draft'));
    modeCustomBtn.setAttribute('aria-pressed', String(partyMode === 'setlist'));
  }

  function renderRound() {
    const q = state.question;
    if (!q) return;
    // Only the host can abort a game back to the settings screen (it resets the
    // whole room); guests just have Home. The adjacent `·` hides itself via CSS
    // when this button is hidden, so there's nothing else to toggle.
    roundToSettingsBtn.hidden = !state.isHost;
    // The pill carries the act structure: which block of how many, and the round
    // within the whole game. Makes the block boundaries legible during play, not
    // just at the break.
    const totalBlocks = Math.max(1, Math.ceil(state.totalRounds / BLOCK_ROUNDS));
    roundPill.textContent = fmt(t('party.roundBlock', 'Block {b}/{blocks} · Round {n}/{total}'), {
      b: blockIndexForRound(state.roundIndex) + 1, blocks: totalBlocks,
      n: state.roundIndex + 1, total: state.totalRounds,
    });
    // On the first round of a drafted block, name who chose it ("Zosia's pick").
    if (state.lastPick) {
      const seat = state.roster.find((r) => r.playerId === state.lastPick?.picker);
      if (seat) {
        roundPill.appendChild(el('span', 'pill-pick', ` · ${fmt(t('party.blockPick', "{name}'s pick"), { name: seat.nickname })}`));
      }
    }
    // The final block scores double and plays veiled — badge it so the stakes read.
    if (isFinalBlock(state.roundIndex, state.totalRounds)) {
      roundPill.appendChild(el('span', 'pill-double', t('party.doublePoints', 'Double points')));
    }
    const isReveal = state.phase === 'reveal' && state.reveal;
    const isMap = q.roundId === 'mapPick';
    const superCfg = superlativeMetricByRoundId(q.roundId);
    const isSuperlative = superCfg !== null;
    // Country-name rounds (flag / map) show one prominent line, nothing else:
    // the tiles already say you're matching a flag or outline, so a "Which flag?"
    // cue was just extra reading. Superlative rounds instead lead the criterion
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
      // from q.roundId via [data-metric] in index.css — the same per-metric hue
      // the setup chips use).
      // `q.prompt` is off the wire, so it's a bare string to the checker; narrow
      // it here rather than widening hintFor, so flagQuiz's typed call site keeps
      // the check. Anything that isn't 'least' reads as 'most' — the same
      // either-way branch this line has always been.
      const label = hintFor(superCfg, q.prompt === 'least' ? 'least' : 'most');
      promptEl.classList.add('superlative');
      promptEl.dataset.metric = q.roundId;
      const promptMetricKey = metricKeyForRound(q.roundId);
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
    // whole ranking is readable at a glance — the round's learning payoff. Only
    // on reveal (the numbers are hidden during the question), and only when the
    // population data actually loaded.
    const metricData = isSuperlative ? metricByRound[q.roundId] : null;
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
        // World-facts rounds fade the country name onto each tile once the clock
        // passes the host's name-reveal point (the grid's `names-shown` class,
        // toggled by the veil loop). The strip is pre-rendered here; CSS keeps it
        // hidden until then. Name only, no value — the value would leak the answer.
        const named = isSuperlative && q.nameFrac != null;
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
    // The map round is the literal mirror of flag-pick: same tile, just swap the
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

  /** The draft pick screen: the picker chooses the next block from a hand of
   *  cards; everyone else watches "X is choosing". The pick countdown (drawn by
   *  the clock) is visible to all; the host's timer fires `forcePick` at 0. */
  function renderPick() {
    const totalBlocks = Math.max(1, Math.ceil(state.totalRounds / BLOCK_ROUNDS));
    const nextBlock = blockIndexForRound(state.roundIndex) + 2; // 1-based: the block being chosen
    pickPill.textContent = fmt(t('party.choosingBlock', 'Choosing block {n} of {total}'), { n: nextBlock, total: totalBlocks });

    // Server-authoritative: the server told us whether we're the picker (never
    // re-derived from `you === picker`, which a stale identity could get wrong).
    const youPick = state.youPick;
    const pickerSeat = state.roster.find((r) => r.playerId === state.picker);
    const pickerName = pickerSeat ? pickerSeat.nickname : t('party.aPlayer', 'A player');

    if (youPick) {
      pickLead.hidden = false;
      pickLead.textContent = t('party.yourPick', 'Your pick, choose the next block');
      pickWatch.hidden = true;
      pickHand.hidden = false;
      pickHand.innerHTML = '';
      for (const modeId of state.hand || []) {
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
          send({ type: 'pick', modeId });
        });
        pickHand.appendChild(card);
      }
    } else {
      pickLead.hidden = true;
      pickHand.hidden = true;
      pickWatch.hidden = false;
      pickWatch.innerHTML = '';
      pickWatch.appendChild(buildAvatar(state.picker || ''));
      pickWatch.appendChild(el('p', 'pick-watch-name', fmt(t('party.isChoosing', '{name} is choosing…'), { name: pickerName })));
    }
  }

  /** The block title card: a short beat before each block's first round (the
   *  opening block included — it doubles as the game's "get ready" beat), naming
   *  the block number, its mode (icon + full label, metric hue on the icon),
   *  "5 rounds", who picked it (draft), and the double-points stakes on the final
   *  block. Paints in `#pt-blockcard`; the round follows when the beat elapses
   *  (see `render` / `armBlockIntro`). A big-card counterpart to the round pill's
   *  "Zosia's pick" attribution — the deferred "full title card" from PARTY.md. */
  function renderBlockCard() {
    const totalBlocks = Math.max(1, Math.ceil(state.totalRounds / BLOCK_ROUNDS));
    const blockNum = blockIndexForRound(state.roundIndex) + 1;
    blockCardCount.textContent = fmt(t('party.blockCardCount', 'Block {n} of {total}'), { n: blockNum, total: totalBlocks });

    const modeId = blockModeId(state.lastPick, state.question ? state.question.roundId : undefined);
    if (modeId) {
      blockCardIc.innerHTML = blockCardIconHtml(modeId);
      blockCardIc.style.setProperty('--mc', modeHue(modeId) || 'currentColor');
      const label = modeFullLabel(modeId);
      blockCardName.textContent = t(label.key || '', label.fallback || '');
    } else {
      // The one ambiguous case: a custom-setup flag block, whose pool ('countries'
      // vs 'others') isn't on the wire — announce it generically.
      blockCardIc.innerHTML = deckIconHtml('flags', { className: 'blockcard-thumb' });
      blockCardIc.style.setProperty('--mc', 'currentColor');
      blockCardName.textContent = t('party.modeShort.flagsAll', 'Flags');
    }

    blockCardRounds.textContent = fmt(t('party.blockCardRounds', '{n} rounds'), { n: BLOCK_ROUNDS });

    // Draft: name who chose this block (the big-card version of the round pill's
    // "Zosia's pick"). Absent on a custom block (no picker).
    blockCardPick.innerHTML = '';
    const pickSeat = state.lastPick ? state.roster.find((r) => r.playerId === state.lastPick?.picker) : null;
    blockCardPick.hidden = !pickSeat;
    if (pickSeat) {
      blockCardPick.appendChild(buildAvatar(pickSeat.playerId));
      blockCardPick.appendChild(el('span', 'blockcard-pick-name', fmt(t('party.blockPick', "{name}'s pick"), { name: pickSeat.nickname })));
    }

    // The final block scores double and plays veiled — announce the stakes.
    const isFinal = isFinalBlock(state.roundIndex, state.totalRounds);
    blockCardDouble.hidden = !isFinal;
    if (isFinal) blockCardDouble.textContent = t('party.doublePoints', 'Double points');
  }

  /** The between-blocks standings break: the block's MVP, then the full board
   *  with rank movement since the last break and each player's own gap to the
   *  leader. Paints in `#pt-break`; the host's clock advances to the next block
   *  after BLOCK_BREAK_SECONDS. */
  function renderBreak() {
    const totalBlocks = Math.max(1, Math.ceil(state.totalRounds / BLOCK_ROUNDS));
    const endedBlock = blockIndexForRound(state.roundIndex) + 1;
    breakPill.textContent = fmt(t('party.afterBlock', 'After block {n} of {total}'), { n: endedBlock, total: totalBlocks });

    const board = state.scoreboard || [];
    const { rows, mvp } = blockBreak(prevBreakBoard, board);

    // MVP banner — hidden when nobody scored in the block.
    const mvpRow = mvp ? rows.find((r) => r.playerId === mvp) : null;
    breakMvp.innerHTML = '';
    breakMvp.hidden = !mvpRow;
    if (mvpRow) {
      breakMvp.appendChild(buildAvatar(mvpRow.playerId));
      const txt = el('span', 'break-mvp-text');
      txt.append(document.createTextNode(`${t('party.blockMvp', 'Best of the block')} · `), el('span', 'break-mvp-name', mvpRow.nickname));
      breakMvp.appendChild(txt);
      breakMvp.appendChild(el('span', 'break-mvp-gain', `+${mvpRow.blockGain}`));
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
      // No ▲/▼ delta arrow: the rank movement is shown by the row physically
      // sliding to its new place (animateStandingsMovement, from the same
      // `rankDelta`), so a second numeric indicator would be redundant.
      row.appendChild(el('span', 'sc', String(r.score)));
      breakBoard.appendChild(row);
      rowNodes.push(row);
    });

    // Capture this board as the baseline for the next break, once per break.
    const token = String(state.roundIndex);
    if (breakSnapToken !== token) {
      breakSnapToken = token;
      pendingBreakBoard = board.map((e) => ({ playerId: e.playerId, nickname: e.nickname, score: e.score }));
    }

    // Once per break, play the standings movement: each row starts at the slot it
    // held at the last break and slides to its new one, so climbers rise past the
    // players they overtook and the overtaken visibly drop. Guarded by its own
    // token so render()'s re-runs during the break don't replay it.
    if (breakAnimToken !== token) {
      breakAnimToken = token;
      animateStandingsMovement(rowNodes, rows);
    }
  }

  /**
   * Slide the break's standings rows from their previous rank to the new one — a
   * FLIP driven by `rankDelta` (places climbed since the last break, from
   * `blockBreak`). A row that moved up starts `rankDelta` slots lower and rises to
   * place; one that dropped starts higher and falls. Rows are uniform height, so
   * one measured stride (row + gap) converts a rank delta to a pixel offset. The
   * climber gets a lifted z-index so it reads as passing over the row it overtakes.
   *
   * Pure decoration (the final positions are already correct in the DOM), so it's
   * skipped entirely under `prefers-reduced-motion` — unlike the tricky veil, this
   * carries no gameplay advantage.
   *
   * @param {HTMLElement[]} nodes  row node per `rows` entry, in new order
   * @param {import('../flags/partyBreak.js').BreakRow[]} rows
   */
  function animateStandingsMovement(nodes, rows) {
    if (prefersReducedMotion() || nodes.length < 2) return;
    const stride = nodes[1].offsetTop - nodes[0].offsetTop;
    if (!stride) return;
    let moved = false;
    // Seat every moving row at its OLD slot, transitions off.
    rows.forEach((r, i) => {
      const d = r.rankDelta;
      if (d == null || d === 0) return;
      moved = true;
      const node = nodes[i];
      node.style.transition = 'none';
      node.style.transform = `translateY(${d * stride}px)`;
      node.style.zIndex = d > 0 ? '2' : '1'; // climbers pass over the overtaken
    });
    if (!moved) return;
    // Commit the start positions, then release to the new slots next frame.
    void breakBoard.offsetHeight;
    window.requestAnimationFrame(() => {
      rows.forEach((r, i) => {
        if (r.rankDelta == null || r.rankDelta === 0) return;
        const node = nodes[i];
        node.style.transition = 'transform 0.8s cubic-bezier(0.22, 0.61, 0.36, 1)';
        node.style.transform = 'translateY(0)';
      });
    });
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
    // No "Next round" button and no countdown: the round advances on its own
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
        countUp(sc, entry.score, 600, delay + 200);
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
   * Tick a score element from 0 up to its final value with an ease-out, so the
   * winner's total feels earned rather than just appearing. Starts after
   * `delayMs` (used to line up with the row's cascade landing).
   * @param {HTMLElement} node @param {number} to @param {number} durationMs @param {number} delayMs
   */
  function countUp(node, to, durationMs, delayMs) {
    if (to <= 0) { node.textContent = '0'; return; }
    node.textContent = '0';
    window.setTimeout(() => {
      const start = performance.now();
      const step = (/** @type {number} */ now) => {
        const p = Math.min(1, (now - start) / durationMs);
        const eased = 1 - Math.pow(1 - p, 3);
        node.textContent = String(Math.round(eased * to));
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

  for (const btn of [modeDraftBtn, modeCustomBtn]) {
    btn.addEventListener('click', () => {
      partyMode = /** @type {'draft'|'setlist'} */ (btn.dataset.mode === 'setlist' ? 'setlist' : 'draft');
      savePartyMode();
      syncPartyMode();
      gameSetupEl.hidden = !(state.isHost && state.phase === 'lobby' && partyMode === 'setlist');
    });
  }
  startBtn.addEventListener('click', () => {
    // Draft is zero-setup: the players pick each block, so the start carries no
    // plan (the server builds the opening Flags block and sizes the game from the
    // seat count). Custom sends the built plan as before. Tricky / reveal ride
    // along either way.
    if (partyMode === 'draft') {
      send({ type: 'start', draft: true, tricky: trickyOn, reveal: revealState });
    } else {
      send({ type: 'start', plan: currentPlan(), tricky: trickyOn, reveal: revealState });
    }
  });
  playAgainBtn.addEventListener('click', () => send({ type: 'playAgain' }));
  roundToSettingsBtn.addEventListener('click', () => send({ type: 'backToLobby' }));

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

  buildSetup();

  // Re-render dynamic text (country names, labels) on a soft language switch.
  document.addEventListener('langchanged', () => { paintJoinError(); repaintSetupLabels(); render(); });

  // ---- load data + route ----
  // Countries (for names + flags) and every superlative round's metric (for the
  // reveal strip) load together. Metrics are best-effort: a failed fetch just
  // means that round's reveal shows no numbers, so it can't block the game;
  // countries failing still falls through to a bare render().
  Promise.all([
    fetch('../flags/countries.json').then((r) => r.json()).then(loadCountries),
    ...SUPERLATIVE_METRICS.map((m) =>
      fetch(`../flags/metrics/${METRIC_FILE_BY_KEY[m.key]}`).then((r) => r.json()).catch(() => null)),
  ])
    .then(([countries, ...metrics]) => {
      for (const c of countries) byCode.set(c.code, c);
      SUPERLATIVE_METRICS.forEach(({ roundId }, i) => {
        const m = metrics[i];
        if (m && m.values) metricByRound[roundId] = { values: m.values, format: m.format || 'compact' };
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
