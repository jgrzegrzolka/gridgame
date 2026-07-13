import { t, countryName } from '../i18n.js';
import { generateCode, isValidRoomCode, serverUrlFor } from '../flags/roomNet.js';
import { getOrCreateDeviceId } from '../flags/identity.js';
import { displayNickname } from '../flags/nickname.js';
import { loadCountries } from '../flags/group.js';
import { initialPartyClientState, reducePartyMessage, withLocalBuzz, pickPartyCelebration, isCleanReveal } from '../flags/partyClient.js';
import { runCelebration } from '../confetti.js';
import { CORRECT_POINTS, SPEED_BONUS } from '../flags/partyScore.js';
import { QUESTION_SECONDS, revealSecondsFor, secondsLeft, remainingFraction, veilProgress, DEFAULT_REVEAL, REVEAL_OPTIONS } from '../flags/partyTiming.js';
import { MAX_ROUNDS_PER_MODE, PICTURE_MODES, METRIC_MODES, buildPartyPlan } from '../flags/partyPlan.js';
import { formatValue } from '../flags/metricLens.js';
import { renderableRoundIds, roundRenderAction } from './staleGuard.js';
import { buildAvatar, renderPlayingAs, shareUrl } from '../common.js';

/** @typedef {import('../flags/partyClient.js').PartyClientState} PartyClientState */

const NICKNAME_KEY = 'gridgame.nickname';
// Setup state (the grouped picture-modes + world-facts shape). Supersedes the
// old per-mode PLAN_KEY, which is still read once for a one-time migration of a
// returning host's saved choices into the new shape.
const SETUP_KEY = 'gridgame.party.setup';
const PLAN_KEY = 'gridgame.party.plan';
const TRICKY_KEY = 'gridgame.party.tricky';
const REVEAL_KEY = 'gridgame.party.reveal';

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
  'superlative-pop': { key: 'party.mode.superlativePop', full: 'Population: most & least', shortKey: 'party.modeShort.superlativePop', short: 'Population' },
  'superlative-area': { key: 'party.mode.superlativeArea', full: 'Land area: largest & smallest', shortKey: 'party.modeShort.superlativeArea', short: 'Land area' },
  'superlative-density': { key: 'party.mode.superlativeDensity', full: 'Population density: most & least', shortKey: 'party.modeShort.superlativeDensity', short: 'Density' },
  'superlative-gdp': { key: 'party.mode.superlativeGdp', full: 'GDP: largest & smallest', shortKey: 'party.modeShort.superlativeGdp', short: 'GDP' },
  'superlative-gdppc': { key: 'party.mode.superlativeGdppc', full: 'GDP per capita: largest & smallest', shortKey: 'party.modeShort.superlativeGdppc', short: 'GDP per capita' },
  'superlative-coffee': { key: 'party.mode.superlativeCoffee', full: 'Coffee production: most', shortKey: 'party.modeShort.superlativeCoffee', short: 'Coffee' },
  'superlative-wine': { key: 'party.mode.superlativeWine', full: 'Wine production: most', shortKey: 'party.modeShort.superlativeWine', short: 'Wine' },
  'superlative-cocoa': { key: 'party.mode.superlativeCocoa', full: 'Cocoa production: most', shortKey: 'party.modeShort.superlativeCocoa', short: 'Cocoa' },
  'superlative-banana': { key: 'party.mode.superlativeBanana', full: 'Banana production: most', shortKey: 'party.modeShort.superlativeBanana', short: 'Banana' },
  'superlative-apple': { key: 'party.mode.superlativeApple', full: 'Apple production: most', shortKey: 'party.modeShort.superlativeApple', short: 'Apple' },
  'superlative-elevation': { key: 'party.mode.superlativeElevation', full: 'Highest elevation: highest & lowest', shortKey: 'party.modeShort.superlativeElevation', short: 'Elevation' },
  'superlative-coastline': { key: 'party.mode.superlativeCoastline', full: 'Coastline length: longest & shortest', shortKey: 'party.modeShort.superlativeCoastline', short: 'Coastline' },
  'superlative-forest': { key: 'party.mode.superlativeForest', full: 'Forest cover: most & least forested', shortKey: 'party.modeShort.superlativeForest', short: 'Forest' },
  'superlative-oil': { key: 'party.mode.superlativeOil', full: 'Oil production: most', shortKey: 'party.modeShort.superlativeOil', short: 'Oil' },
  'superlative-rice': { key: 'party.mode.superlativeRice', full: 'Rice production: most', shortKey: 'party.modeShort.superlativeRice', short: 'Rice' },
  'superlative-coal': { key: 'party.mode.superlativeCoal', full: 'Coal production: most', shortKey: 'party.modeShort.superlativeCoal', short: 'Coal' },
  'superlative-sheep': { key: 'party.mode.superlativeSheep', full: 'Sheep per capita: most & fewest', shortKey: 'party.modeShort.superlativeSheep', short: 'Sheep' },
};

/** Per-round config for the superlative rounds, keyed by the server `roundId`.
 *  Maps each metric round to the values file it fetches for the reveal strip and
 *  the hint copy for its direction prompt. Adding a metric superlative round =
 *  one entry here + the PARTY_MODES / MODE_LABELS entries + i18n. */
const SUPERLATIVE_MODES = {
  'superlative': {
    file: 'population.json',
    hintMost: { key: 'party.hintMost', fallback: 'Most populous' },
    hintLeast: { key: 'party.hintLeast', fallback: 'Least populous' },
  },
  'superlative-area': {
    file: 'area.json',
    hintMost: { key: 'party.hintMostArea', fallback: 'Largest area' },
    hintLeast: { key: 'party.hintLeastArea', fallback: 'Smallest area' },
  },
  'superlative-density': {
    file: 'density.json',
    hintMost: { key: 'party.hintMostDensity', fallback: 'Highest density' },
    hintLeast: { key: 'party.hintLeastDensity', fallback: 'Lowest density' },
  },
  'superlative-gdp': {
    file: 'gdp.json',
    hintMost: { key: 'party.hintMostGdp', fallback: 'Largest GDP' },
    hintLeast: { key: 'party.hintLeastGdp', fallback: 'Smallest GDP' },
  },
  'superlative-gdppc': {
    file: 'gdpPerCapita.json',
    hintMost: { key: 'party.hintMostGdppc', fallback: 'Largest GDP (per capita)' },
    hintLeast: { key: 'party.hintLeastGdppc', fallback: 'Smallest GDP (per capita)' },
  },
  // Crops are 'most'-only rounds (superlative.js locks direction to 'most'), so
  // no hintLeast: "smallest producer" is an obscure question and is never dealt.
  'superlative-coffee': {
    file: 'coffee.json',
    hintMost: { key: 'party.hintMostCoffee', fallback: 'Largest coffee production' },
  },
  'superlative-wine': {
    file: 'wine.json',
    hintMost: { key: 'party.hintMostWine', fallback: 'Largest wine production' },
  },
  'superlative-cocoa': {
    file: 'cocoa.json',
    hintMost: { key: 'party.hintMostCocoa', fallback: 'Largest cocoa production' },
  },
  'superlative-banana': {
    file: 'banana.json',
    hintMost: { key: 'party.hintMostBanana', fallback: 'Largest banana production' },
  },
  'superlative-apple': {
    file: 'apple.json',
    hintMost: { key: 'party.hintMostApple', fallback: 'Largest apple production' },
  },
  'superlative-elevation': {
    file: 'elevation.json',
    hintMost: { key: 'party.hintMostElevation', fallback: 'Highest point' },
    hintLeast: { key: 'party.hintLeastElevation', fallback: 'Lowest highpoint' },
  },
  'superlative-coastline': {
    file: 'coastline.json',
    hintMost: { key: 'party.hintMostCoastline', fallback: 'Longest coast' },
    hintLeast: { key: 'party.hintLeastCoastline', fallback: 'Shortest coast' },
  },
  'superlative-forest': {
    file: 'forest.json',
    hintMost: { key: 'party.hintMostForest', fallback: 'Most forested' },
    hintLeast: { key: 'party.hintLeastForest', fallback: 'Least forested' },
  },
  'superlative-oil': {
    file: 'oil.json',
    hintMost: { key: 'party.hintMostOil', fallback: 'Largest oil production' },
  },
  'superlative-rice': {
    file: 'rice.json',
    hintMost: { key: 'party.hintMostRice', fallback: 'Largest rice production' },
  },
  'superlative-coal': {
    file: 'coal.json',
    hintMost: { key: 'party.hintMostCoal', fallback: 'Largest coal production' },
  },
  // Sheep per capita is two-directional like forest (both extremes are good
  // questions among sheep-raising countries: "more sheep than people" at the top).
  'superlative-sheep': {
    file: 'sheepPerCapita.json',
    hintMost: { key: 'party.hintMostSheep', fallback: 'Most sheep per person' },
    hintLeast: { key: 'party.hintLeastSheep', fallback: 'Fewest sheep per person' },
  },
};

/** Every round id this build can render: the two fixed picture rounds plus the
 *  superlative metric rounds above. The server (PartyKit, its own deploy) can be
 *  a build ahead of a still-open tab and deal a round id outside this set; when
 *  that happens {@link roundRenderAction} reloads us onto the new build rather
 *  than rendering a broken round. See `flagParty/staleGuard.js`. */
const KNOWN_ROUND_IDS = renderableRoundIds(Object.keys(SUPERLATIVE_MODES));

/** Little pictures leading each setup row, distinct enough to tell apart at a
 *  glance. The two flag modes get real flag thumbnails (a country flag for
 *  "countries", the Jolly Roger for "others" — a flag, on-theme for a party
 *  game, and unmistakably not a specific country); the map mode gets the actual
 *  Italy contour asset (the same silhouette the round renders); the world-facts
 *  lead gets a stat-bar chart. Flag artwork carries its own colours by nature
 *  (like every `flags/svg/*.svg`); the chart is monochrome `currentColor`.
 *  Rendered via `iconSpan` (innerHTML), so `<img>` and inline `<svg>` both work;
 *  sizing is by class in index.css (`.gs-thumb` / `.gs-contour` / plain svg). */
const SETUP_ICONS = {
  // A representative country flag (France — a clean tricolour that reads as "a
  // flag" at 20px). Swap the code to re-pick; nothing keys off which country.
  'flags-all': '<img class="gs-thumb" src="../flags/svg/fr.svg" alt="" />',
  // Jolly Roger — a flag with no country, for the non-sovereign "others" pool.
  'flags-territories': '<svg class="gs-thumb" viewBox="0 0 32 24" xmlns="http://www.w3.org/2000/svg"><rect width="32" height="24" fill="#241f22"/><g stroke="#fff" stroke-width="2.4" stroke-linecap="round"><line x1="10" y1="13" x2="22" y2="19"/><line x1="22" y1="13" x2="10" y2="19"/></g><g fill="#fff"><circle cx="9.4" cy="12.6" r="1.5"/><circle cx="22.6" cy="12.6" r="1.5"/><circle cx="9.4" cy="19.4" r="1.5"/><circle cx="22.6" cy="19.4" r="1.5"/></g><ellipse cx="16" cy="10.5" rx="5" ry="5.3" fill="#fff"/><rect x="12.6" y="13.6" width="6.8" height="3.4" rx="1" fill="#fff"/><circle cx="14" cy="10" r="1.4" fill="#241f22"/><circle cx="18" cy="10" r="1.4" fill="#241f22"/><rect x="15.3" y="11.6" width="1.4" height="2" fill="#241f22"/></svg>',
  // The Italy contour asset — the same silhouette the map round shows.
  'map-outlines': '<img class="gs-contour" src="../flags/contours/it.svg" alt="" />',
  // World-facts lead: an ascending stat-bar chart (statistics / metrics).
  worldFacts: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="3" y="13" width="4.4" height="8" rx="1"/><rect x="9.8" y="8" width="4.4" height="13" rx="1"/><rect x="16.6" y="4" width="4.4" height="17" rx="1"/></svg>',
};

/** Per-metric chip icons — same line style, tinted by the chip's own hue in CSS. */
const METRIC_ICONS = {
  'superlative-pop': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3"/><path d="M3.5 20c0-3 2.6-5 5.5-5s5.5 2 5.5 5"/><path d="M16 5.5a3 3 0 0 1 0 5.4M17 15c2.3.5 4 2.4 4 5"/></svg>',
  'superlative-area': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h16"/><path d="M4 20l5-9 3.5 5L15 12l5 8"/></svg>',
  'superlative-density': '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="6" cy="6" r="1.4"/><circle cx="12" cy="6" r="1.4"/><circle cx="18" cy="6" r="1.4"/><circle cx="6" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="18" cy="12" r="1.4"/><circle cx="9" cy="18" r="1.4"/><circle cx="15" cy="18" r="1.4"/></svg>',
  // GDP total: a stack of coins (an economy's overall size).
  'superlative-gdp': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v5c0 1.66 3.13 3 7 3s7-1.34 7-3V6"/><path d="M5 11v5c0 1.66 3.13 3 7 3s7-1.34 7-3v-5"/></svg>',
  // GDP per capita: a single $ coin (wealth per head).
  'superlative-gdppc': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8"/><path d="M12 7v10"/><path d="M14.5 9.2c-.6-.7-1.5-1-2.5-1-1.4 0-2.5.7-2.5 1.9 0 1.2 1 1.6 2.5 1.9s2.5.7 2.5 1.9c0 1.2-1.1 1.9-2.5 1.9-1 0-1.9-.3-2.5-1"/></svg>',
  // Coffee production: a steaming coffee cup with a handle.
  'superlative-coffee': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9h13v5a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4V9z"/><path d="M17 10h2a2.5 2.5 0 0 1 0 5h-2"/><path d="M8 3.5v2M12 3.5v2"/></svg>',
  // Wine production: a wine glass on a base.
  'superlative-wine': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7 4h10l-1 6a4 4 0 0 1-8 0z"/><path d="M12 14v5"/><path d="M8 19h8"/></svg>',
  // Cocoa production: a cocoa pod (elongated ridged fruit) with a stem.
  'superlative-cocoa': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M15.5 4.5c3 2 4 6 2.5 9.5s-5.5 5.5-9 5-5.5-4-4.5-7.5 4-8 8-8c1.4 0 2 .5 3 1z"/><path d="M11 6.5v11"/></svg>',
  // Banana production: a curved banana.
  'superlative-banana': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 5c0 7 4 12 11 12 1.6 0 2.8-.3 3.5-.8-1 .3-6 .2-9.5-3.2S6.7 5.6 7 4.5C6.2 4.9 5 4.5 5 5z"/></svg>',
  // Apple production: a round apple with a leaf and stem.
  'superlative-apple': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 8c-1-1.5-3-2.5-5-2-2 .5-3 2.5-3 5 0 4 3 8 5.5 8 .9 0 1.4-.4 2.5-.4s1.6.4 2.5.4C17 19 20 15 20 11c0-2.5-1-4.5-3-5-2-.5-4 .5-5 2z"/><path d="M12 8c0-2 .5-3.5 2.5-4.5"/></svg>',
  // Highest elevation: a single tall peak with a snowcap (distinct from area's low range).
  'superlative-elevation': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h16"/><path d="M12 4L20 20H4z"/><path d="M9.4 11.7l2.6 1.6 2.6-1.6"/></svg>',
  // Coastline length: three stacked waves (water / shoreline), distinct from the peak.
  'superlative-coastline': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8c1.5 0 1.5 1.5 3 1.5S10.5 8 12 8s1.5 1.5 3 1.5S19.5 8 21 8"/><path d="M3 13c1.5 0 1.5 1.5 3 1.5S10.5 13 12 13s1.5 1.5 3 1.5S19.5 13 21 13"/><path d="M3 18c1.5 0 1.5 1.5 3 1.5S10.5 18 12 18s1.5 1.5 3 1.5S19.5 18 21 18"/></svg>',
  // Forest cover: a two-tier pine with a centred trunk, distinct from elevation's bare peak.
  'superlative-forest': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 7.5 10H10l-3.5 5h4v4h3v-4h4L14 10h2.5z"/></svg>',
  // Oil production: an oil derrick (a pumpjack tower) with a ground line.
  'superlative-oil': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 21 9 5l8 12M7 15h6M4 21h16M9 5l3-2 1 3"/></svg>',
  // Rice production: a bowl of rice with a pair of chopsticks resting across it.
  'superlative-rice': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12h16a8 8 0 0 1-16 0zM8 12a4 4 0 0 1 8 0M14 5l5-2M15 8l5-2"/></svg>',
  // Coal production: a chunky lump of coal (an irregular faceted rock).
  'superlative-coal': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9 3 15l4 4 8 1 5-5-2-6-6-3zM6 9l6 2m0 0 3-4m-3 4-1 8m1-8 8 1"/></svg>',
  // Sheep per capita: a woolly body (bumpy top) with a small head and two legs.
  'superlative-sheep': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 8a2.5 2.5 0 0 1 4.5-1.5A2.5 2.5 0 0 1 17 8a2.5 2.5 0 0 1 .3 5A2.5 2.5 0 0 1 15 15H9a2.5 2.5 0 0 1-2.3-3.5A2.5 2.5 0 0 1 9 8z"/><circle cx="6.5" cy="9.5" r="2"/><path d="M5 8 3.5 7"/><path d="M10 15.5V18M14 15.5V18"/></svg>',
};

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
    start: $('pt-start'), lobby: $('pt-lobby'), round: $('pt-round'), final: $('pt-final'),
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
  const playAgainBtn = /** @type {HTMLButtonElement} */ ($('play-again'));
  const roundToSettingsBtn = /** @type {HTMLButtonElement} */ ($('round-to-settings'));
  const playingAsEl = $('playing-as');
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

  function showSection(/** @type {'start'|'lobby'|'round'|'final'|null} */ which) {
    for (const [k, node] of Object.entries(sections)) node.hidden = k !== which;
  }

  function send(/** @type {object} */ msg) {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }

  // ---- game setup (host-only lobby plan) ----
  // The host picks which modes play and how many rounds each. The fixed picture
  // trio (flags / territories / map) each get a stepper + toggle; the
  // open-ended world-facts family collapses to one shared count spread across
  // the metrics the host enables via chips. The choice is local (persisted per
  // device) until Start, when buildPartyPlan() turns it into a segment plan that
  // rides the 'start' message and the server validates; this is just the picker.
  /** @typedef {{ picture: Record<string, { on: boolean, n: number }>, facts: { on: boolean, n: number, metrics: Record<string, boolean> } }} SetupState */
  /** @type {SetupState} */
  const setupState = loadSetup();
  // Game-wide tricky-mode toggle (not per-mode). Persisted per device like the
  // plan; rides on the 'start' message and the server broadcasts it back so
  // every client veils the tiles in step.
  let trickyOn = loadTricky();
  // Per-category reveal timing (fraction of the window each veil clears at). Only
  // meaningful when tricky is on; persisted and sent with the plan on start.
  /** @type {{ flag: number, map: number, metric: number }} */
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
    const r = raw && typeof raw === 'object' ? raw : {};
    return {
      flag: pick(r.flag, DEFAULT_REVEAL.flag),
      map: pick(r.map, DEFAULT_REVEAL.map),
      metric: pick(r.metric, DEFAULT_REVEAL.metric),
    };
  }
  function saveReveal() {
    try { window.localStorage.setItem(REVEAL_KEY, JSON.stringify(revealState)); } catch { /* private mode */ }
  }

  // A function declaration (hoisted) rather than a const arrow: defaultSetup()
  // calls it via the `const setupState = loadSetup()` init above, which runs
  // before a const would be initialized (temporal dead zone).
  function clampRounds(/** @type {number} */ n) { return Math.min(MAX_ROUNDS_PER_MODE, Math.max(1, Math.floor(n))); }

  /** True when the setup would produce at least one round (a game needs rounds). */
  function hasAnyRounds(/** @type {SetupState} */ s) {
    if (PICTURE_MODES.some((m) => s.picture[m.id] && s.picture[m.id].on)) return true;
    return s.facts.on && METRIC_MODES.some((m) => s.facts.metrics[m.id]);
  }

  /** The default setup: everything on, ~2 rounds per mode. Every picture mode is
   *  2 rounds; the world-facts group is on with all metrics chosen and a shared
   *  count of 2 per metric (so a fresh game is 3 picture modes × 2 + the facts,
   *  the "2 of each" default Jan asked for). Scales as metrics are added — the
   *  facts count tracks 2 × the metric count (clamped). */
  function defaultSetup() {
    /** @type {Record<string, { on: boolean, n: number }>} */
    const picture = {};
    for (const m of PICTURE_MODES) picture[m.id] = { on: true, n: 2 };
    /** @type {Record<string, boolean>} */
    const metrics = {};
    for (const m of METRIC_MODES) metrics[m.id] = true;
    return { picture, facts: { on: true, n: clampRounds(2 * METRIC_MODES.length), metrics } };
  }

  /** Coerce a stored / partial setup to a valid one, filling gaps from the
   *  default and never returning an all-off (zero-round) state. */
  function sanitizeSetup(/** @type {any} */ raw) {
    const def = defaultSetup();
    /** @type {Record<string, { on: boolean, n: number }>} */
    const picture = {};
    for (const m of PICTURE_MODES) {
      const e = raw && raw.picture && raw.picture[m.id];
      picture[m.id] = e && typeof e.n === 'number' && e.n >= 1
        ? { on: !!e.on, n: clampRounds(e.n) } : def.picture[m.id];
    }
    /** @type {Record<string, boolean>} */
    const metrics = {};
    for (const m of METRIC_MODES) {
      const v = raw && raw.facts && raw.facts.metrics ? raw.facts.metrics[m.id] : undefined;
      metrics[m.id] = v == null ? def.facts.metrics[m.id] : !!v;
    }
    const fRaw = raw && raw.facts;
    const n = fRaw && typeof fRaw.n === 'number' && fRaw.n >= 1 ? clampRounds(fRaw.n) : def.facts.n;
    let on = fRaw ? !!fRaw.on : def.facts.on;
    if (on && !METRIC_MODES.some((m) => metrics[m.id])) on = false;
    const s = { picture, facts: { on, n, metrics } };
    return hasAnyRounds(s) ? s : def;
  }

  /** One-time migration of a returning host's old per-mode plan (PLAN_KEY) into
   *  the new grouped shape: picture modes carry over 1:1; the metric modes fold
   *  into the facts group, their counts summing to the shared count. */
  function migrateModeState(/** @type {any} */ raw) {
    /** @type {Record<string, { on: boolean, n: number }>} */
    const picture = {};
    for (const m of PICTURE_MODES) {
      const e = raw[m.id];
      picture[m.id] = e && typeof e.n === 'number' && e.n >= 1 ? { on: !!e.on, n: clampRounds(e.n) } : { on: true, n: 1 };
    }
    /** @type {Record<string, boolean>} */
    const metrics = {};
    let n = 0;
    for (const m of METRIC_MODES) {
      const e = raw[m.id];
      const on = !!(e && e.on);
      metrics[m.id] = on;
      if (on && e && typeof e.n === 'number') n += clampRounds(e.n);
    }
    const anyMetric = METRIC_MODES.some((m) => metrics[m.id]);
    return sanitizeSetup({ picture, facts: { on: anyMetric, n: Math.max(1, n), metrics } });
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
  /** The plan to send on Start: picture segments + the world-facts deal. */
  function currentPlan() {
    return buildPartyPlan(setupState);
  }
  /** Effective world-facts round count (0 unless the group is on with >=1 metric). */
  function factsRounds() {
    return setupState.facts.on && METRIC_MODES.some((m) => setupState.facts.metrics[m.id])
      ? setupState.facts.n : 0;
  }

  const modeLabel = (/** @type {string} */ id) => t(MODE_LABELS[id].key, MODE_LABELS[id].full);
  const modeShort = (/** @type {string} */ id) => t(MODE_LABELS[id].shortKey, MODE_LABELS[id].short);

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
  /** A −/count/+ stepper wired to callbacks. @param {() => number} getN @param {(d: number) => void} onStep */
  function stepperEl(getN, onStep) {
    const stepper = el('span', 'gs-stepper');
    const minus = el('button', 'gs-step', '−');
    /** @type {HTMLButtonElement} */ (minus).type = 'button';
    minus.setAttribute('aria-label', t('party.fewer', 'Fewer rounds'));
    minus.addEventListener('click', () => onStep(-1));
    const count = el('span', 'gs-count', String(getN()));
    const plus = el('button', 'gs-step', '+');
    /** @type {HTMLButtonElement} */ (plus).type = 'button';
    plus.setAttribute('aria-label', t('party.more', 'More rounds'));
    plus.addEventListener('click', () => onStep(1));
    stepper.append(minus, count, plus);
    return stepper;
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

    // The fixed picture trio — a picture icon, a stepper, and a toggle each.
    gsModesEl.appendChild(sectionLabel('party.groupPictures', 'Flags & maps'));
    for (const m of PICTURE_MODES) {
      const row = el('div', 'gs-mode');
      row.dataset.mode = m.id;
      row.appendChild(iconSpan(SETUP_ICONS[m.id]));
      row.appendChild(el('span', 'gs-name', modeLabel(m.id)));
      row.appendChild(stepperEl(() => setupState.picture[m.id].n, (d) => stepPicture(m.id, d)));
      row.appendChild(toggleEl(() => setupState.picture[m.id].on, (on) => togglePicture(m.id, on), modeLabel(m.id)));
      gsModesEl.appendChild(row);
    }

    // The open-ended world-facts family: one shared "Guess the stat" control
    // (a stepper for how many facts rounds + a master toggle) with colour chips
    // below for which facts are in play. The shared count is spread across the
    // enabled metrics at Start (buildPartyPlan / distributeWorldFacts), so a new
    // metric costs one chip here, not one more row.
    gsModesEl.appendChild(sectionLabel('party.groupFacts', 'World facts'));
    const factsRow = el('div', 'gs-mode gs-facts');
    factsRow.id = 'gs-facts';
    factsRow.appendChild(iconSpan(SETUP_ICONS.worldFacts));
    const factsName = el('span', 'gs-name');
    factsName.appendChild(el('span', 'gs-opt-title', t('party.factsLead', 'Guess the stat')));
    factsName.appendChild(el('span', 'gs-opt-hint', t('party.factsHint', 'Picked at random from the facts you choose')));
    factsRow.appendChild(factsName);
    factsRow.appendChild(stepperEl(() => setupState.facts.n, stepFacts));
    factsRow.appendChild(toggleEl(() => setupState.facts.on, toggleFacts, t('party.factsLead', 'Guess the stat')));
    gsModesEl.appendChild(factsRow);

    const chips = el('div', 'gs-chips');
    chips.id = 'gs-chips';
    for (const m of METRIC_MODES) {
      const chip = el('button', 'gs-chip');
      /** @type {HTMLButtonElement} */ (chip).type = 'button';
      chip.dataset.metric = m.id;
      chip.appendChild(iconSpan(METRIC_ICONS[m.id]));
      chip.appendChild(el('span', 'gs-chip-label', modeShort(m.id)));
      chip.addEventListener('click', () => toggleMetric(m.id));
      chips.appendChild(chip);
    }
    gsModesEl.appendChild(chips);

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
  function stepPicture(/** @type {string} */ id, /** @type {number} */ d) {
    const st = setupState.picture[id];
    st.n = clampRounds(st.n + d);
    saveSetup();
    updateSetup();
  }
  function togglePicture(/** @type {string} */ id, /** @type {boolean} */ on) {
    // A game needs rounds — refuse a toggle-off that would zero everything.
    const tentative = { ...setupState, picture: { ...setupState.picture, [id]: { ...setupState.picture[id], on } } };
    if (!hasAnyRounds(tentative)) { updateSetup(); return; }
    setupState.picture[id].on = on;
    saveSetup();
    updateSetup();
  }
  function stepFacts(/** @type {number} */ d) {
    setupState.facts.n = clampRounds(setupState.facts.n + d);
    saveSetup();
    updateSetup();
  }
  function toggleFacts(/** @type {boolean} */ on) {
    // Turning the group on with no fact chosen enables them all (a sensible
    // default over an on-but-empty state that plays nothing).
    if (on && !METRIC_MODES.some((m) => setupState.facts.metrics[m.id])) {
      for (const m of METRIC_MODES) setupState.facts.metrics[m.id] = true;
    }
    const tentative = { ...setupState, facts: { ...setupState.facts, on } };
    if (!hasAnyRounds(tentative)) { updateSetup(); return; }
    setupState.facts.on = on;
    saveSetup();
    updateSetup();
  }
  function toggleMetric(/** @type {string} */ id) {
    const metrics = setupState.facts.metrics;
    // Tapping a chip while the group is off re-activates the group with just it.
    if (!setupState.facts.on) {
      for (const m of METRIC_MODES) metrics[m.id] = m.id === id;
      setupState.facts.on = true;
      saveSetup();
      updateSetup();
      return;
    }
    const next = !metrics[id];
    const enabledAfter = METRIC_MODES.filter((m) => (m.id === id ? next : metrics[m.id]));
    // Never leave the group on with zero facts (turn it off via its own toggle
    // instead) — snap the chip back.
    if (!next && enabledAfter.length === 0) { updateSetup(); return; }
    metrics[id] = next;
    saveSetup();
    updateSetup();
  }

  /** Repaint counts, toggles, chips, the round total, and the collapsed mix. */
  function updateSetup() {
    let total = 0;
    gsMixEl.innerHTML = '';
    for (const m of PICTURE_MODES) {
      const st = setupState.picture[m.id];
      const row = /** @type {HTMLElement | null} */ (gsModesEl.querySelector(`[data-mode="${m.id}"]`));
      if (row) {
        row.classList.toggle('off', !st.on);
        const c = row.querySelector('.gs-count'); if (c) c.textContent = String(st.n);
        const inp = /** @type {HTMLInputElement | null} */ (row.querySelector('input')); if (inp) inp.checked = st.on;
      }
      if (st.on) {
        total += st.n;
        const part = el('span');
        part.append(document.createTextNode(`${modeShort(m.id)} `), el('span', 'n', String(st.n)));
        gsMixEl.appendChild(part);
      }
    }
    // World-facts lead row: count, toggle, off state.
    const factsRow = /** @type {HTMLElement | null} */ (gsModesEl.querySelector('#gs-facts'));
    if (factsRow) {
      factsRow.classList.toggle('off', !setupState.facts.on);
      const c = factsRow.querySelector('.gs-count'); if (c) c.textContent = String(setupState.facts.n);
      const inp = /** @type {HTMLInputElement | null} */ (factsRow.querySelector('input')); if (inp) inp.checked = setupState.facts.on;
    }
    // Chips: coloured (on) when the group is on and the metric is chosen.
    for (const m of METRIC_MODES) {
      const chip = gsModesEl.querySelector(`.gs-chip[data-metric="${m.id}"]`);
      if (chip) {
        const active = setupState.facts.on && !!setupState.facts.metrics[m.id];
        chip.classList.toggle('on', active);
        chip.classList.toggle('off', !active);
        chip.setAttribute('aria-pressed', String(active));
      }
    }
    const fr = factsRounds();
    if (fr > 0) {
      total += fr;
      const part = el('span');
      part.append(document.createTextNode(`${t('party.groupFacts', 'World facts')} `), el('span', 'n', String(fr)));
      gsMixEl.appendChild(part);
    }
    gsRoundsEl.textContent = String(total);
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
    const factsTitle = gsModesEl.querySelector('#gs-facts .gs-opt-title');
    if (factsTitle) factsTitle.textContent = t('party.factsLead', 'Guess the stat');
    const factsHint = gsModesEl.querySelector('#gs-facts .gs-opt-hint');
    if (factsHint) factsHint.textContent = t('party.factsHint', 'Picked at random from the facts you choose');
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

  // ---- tricky-mode veil ----
  // When the host enabled tricky mode, each question tile clears over the same
  // clock the countdown bar counts. We drive a single `--veil-p` (0 hidden → 1
  // clear) on the grid via rAF for a smooth grey/blur/panel resolve; the CSS
  // does the rest. Setting it on the grid (which persists across tile rebuilds,
  // only its innerHTML is replaced) means a re-render mid-question — a late join,
  // a buzz notification — never resets the animation. The clear timing rides on
  // the question itself (`clearFrac`, stamped server-side from the host's
  // per-category config), so each round can veil for a different span.
  let veilRaf = 0;
  function startVeil() {
    if (veilRaf) return;
    const step = () => {
      if (state.phase !== 'question' || !state.tricky) { veilRaf = 0; return; }
      const clearFrac = (state.question && state.question.clearFrac) || DEFAULT_REVEAL.flag;
      const p = veilProgress(clockDeadline, Date.now(), clockTotalMs, clearFrac);
      gridEl.style.setProperty('--veil-p', p.toFixed(4));
      veilRaf = window.requestAnimationFrame(step);
    };
    veilRaf = window.requestAnimationFrame(step);
  }
  function stopVeil() {
    if (veilRaf) { window.cancelAnimationFrame(veilRaf); veilRaf = 0; }
    gridEl.style.setProperty('--veil-p', '1');
  }

  /** (Re)start the countdown when the phase or round changes; otherwise leave it. */
  function syncClock() {
    const mode = state.phase === 'reveal' ? 'reveal' : 'question';
    const token = `${mode}:${state.roundIndex}`;
    if (token === clockToken) return;
    clockToken = token;
    clockFired = false;
    // The reveal length depends on the round, not the room: a clean sweep (every
    // present player got it right) snaps on; a miss holds so the correct flag
    // can be read. Question time is fixed. (flagQuiz's correct-fast/wrong-slow.)
    const clean = mode === 'reveal' && isCleanReveal(state.roster, state.reveal);
    clockTotalMs = (mode === 'reveal' ? revealSecondsFor(clean) : QUESTION_SECONDS) * 1000;
    clockDeadline = Date.now() + clockTotalMs;
    // Only the question phase shows the shrinking bar. The reveal has no timer of
    // its own — a sub-second bar read as a flicker — so it runs its clock unseen
    // and just advances after the beat (short when clean, longer on a miss).
    timerEl.hidden = mode === 'reveal';
    timerEl.setAttribute('data-mode', mode);
    if (!clockInterval) clockInterval = window.setInterval(tickClock, 200);
    tickClock();
  }

  function tickClock() {
    const mode = state.phase === 'reveal' ? 'reveal' : 'question';
    const now = Date.now();
    const left = secondsLeft(clockDeadline, now);
    // Only the question phase paints a bar; the reveal is bar-less (the clock
    // still runs below to advance the room, it just isn't drawn).
    if (mode === 'question') {
      timerFill.style.width = `${remainingFraction(clockDeadline, now, clockTotalMs) * 100}%`;
      timerEl.classList.toggle('low', left <= 5);
      timerLabel.textContent = String(left);
    }
    if (left <= 0 && !clockFired) {
      clockFired = true;
      // Host only: end the phase. A stale 'reveal'/'next' for a phase that
      // already advanced is ignored by the room reducer, so this is safe even
      // if the all-buzzed auto-reveal beat us to it.
      if (state.isHost) send({ type: mode === 'reveal' ? 'next' : 'reveal' });
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

  // ---- render ----
  function render() {
    if (!activeRoom) { stopClock(); stopVeil(); showSection('start'); return; }
    // Leaving (or not yet in) the final screen re-arms the one-shot celebration.
    if (state.phase !== 'final') finalCelebrated = false;
    if (state.phase === 'question' || state.phase === 'reveal') {
      // A round id this build can't render means the server is a build ahead of
      // us (its deploy landed while this tab stayed open). Reload onto the new
      // build once; the seat survives (room code in URL, pid persisted).
      const q = state.question;
      const action = q ? roundRenderAction(KNOWN_ROUND_IDS.has(q.roundId), updateReloadTried()) : 'render';
      if (action === 'reload') { markUpdateReload(); stopClock(); stopVeil(); window.location.reload(); return; }
      if (action === 'blocked') { stopClock(); stopVeil(); showSection('round'); renderUpdateNotice(); return; }
      clearUpdateReload();
      showSection('round'); renderRound(); syncClock();
      // The veil animates during the question only; the reveal always shows the
      // crisp, full-colour tiles (stopVeil pins `--veil-p` to 1).
      if (state.phase === 'question' && state.tricky) startVeil(); else stopVeil();
    }
    else if (state.phase === 'final') { stopClock(); stopVeil(); showSection('final'); renderFinal(); }
    else { stopClock(); stopVeil(); showSection('lobby'); renderLobby(); }
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
    startBtn.hidden = !(state.isHost && inLobby);
    // The host can start as soon as they're seated — a room of one is allowed
    // (play alone), and more players can join before the tap. The guard only
    // greys out the impossible empty-roster case.
    startBtn.disabled = state.roster.filter((r) => r.present).length < 1;
    waitEl.hidden = !(!state.isHost && inLobby);
    // Game setup is the host's to configure, and only in the lobby.
    gameSetupEl.hidden = !(state.isHost && inLobby);
  }

  function renderRound() {
    const q = state.question;
    if (!q) return;
    // Only the host can abort a game back to the settings screen (it resets the
    // whole room); guests just have Home. The adjacent `·` hides itself via CSS
    // when this button is hidden, so there's nothing else to toggle.
    roundToSettingsBtn.hidden = !state.isHost;
    roundPill.textContent = fmt(t('party.round', 'Round {n} of {total}'), {
      n: state.roundIndex + 1, total: state.totalRounds,
    });
    const isReveal = state.phase === 'reveal' && state.reveal;
    const isMap = q.roundId === 'mapPick';
    const superCfg = SUPERLATIVE_MODES[q.roundId] || null;
    const isSuperlative = superCfg !== null;
    // Country-name rounds (flag / map) show one prominent line, nothing else:
    // the tiles already say you're matching a flag or outline, so a "Which flag?"
    // cue was just extra reading. Superlative rounds instead lead the criterion
    // label with the metric's icon (below) — a picture reads the stat faster than
    // the phrase alone. Reset both cues each render, then the branches opt in.
    promptEl.classList.remove('superlative');
    delete promptEl.dataset.metric;
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
      const least = q.prompt === 'least';
      const label = least ? superCfg.hintLeast : superCfg.hintMost;
      promptEl.classList.add('superlative');
      promptEl.dataset.metric = q.roundId;
      promptLead.innerHTML = METRIC_ICONS[q.roundId] || '';
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
        gridEl.appendChild(flagOpt(code, { isMap, selectable: state.myChoice == null, selected, correct: false, wrong: false, dim, pickers: [], pop: null, veil: state.tricky }));
      }
    }

    footEl.innerHTML = '';
    if (isReveal) renderRevealFoot();
  }

  /**
   * @param {string} code
   * @param {{ isMap: boolean, selectable: boolean, selected: boolean, correct: boolean, wrong: boolean, dim: boolean, pickers: string[], pop?: { name: string, value: string } | null, veil?: boolean }} opts
   */
  function flagOpt(code, opts) {
    const node = document.createElement(opts.selectable ? 'button' : 'div');
    node.className = 'opt' + (opts.selected ? ' sel' : '') + (opts.correct ? ' correct' : '') + (opts.wrong ? ' wrong' : '') + (opts.dim ? ' dim' : '') + (opts.pop ? ' pop' : '') + (opts.veil ? ' veil' : '');
    // On reveal, name the flag/outline you got wrong — the shared bottom strip
    // (common.css `.opt.wrong[data-name]`, same as flagQuiz) tells you what you
    // actually picked; the correct answer's name is already in the prompt header.
    // Suppressed when a superlative pop-strip is present (`opts.pop`): that strip
    // already carries every tile's name + value, so the ::after would double up.
    if (opts.wrong && !opts.pop) {
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

  startBtn.addEventListener('click', () => send({ type: 'start', plan: currentPlan(), tricky: trickyOn, reveal: revealState }));
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

  // ---- "playing as" line ----
  function paintPlayingAs() {
    renderPlayingAs(playingAsEl, deviceId, myName, t('party.playingAs', 'Playing as'));
  }
  paintPlayingAs();
  buildSetup();

  // Re-render dynamic text (country names, labels) on a soft language switch.
  document.addEventListener('langchanged', () => { paintPlayingAs(); paintJoinError(); repaintSetupLabels(); render(); });

  // ---- load data + route ----
  // Countries (for names + flags) and every superlative round's metric (for the
  // reveal strip) load together. Metrics are best-effort: a failed fetch just
  // means that round's reveal shows no numbers, so it can't block the game;
  // countries failing still falls through to a bare render().
  const metricEntries = Object.entries(SUPERLATIVE_MODES);
  Promise.all([
    fetch('../flags/countries.json').then((r) => r.json()).then(loadCountries),
    ...metricEntries.map(([, cfg]) =>
      fetch(`../flags/metrics/${cfg.file}`).then((r) => r.json()).catch(() => null)),
  ])
    .then(([countries, ...metrics]) => {
      for (const c of countries) byCode.set(c.code, c);
      metricEntries.forEach(([roundId], i) => {
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
