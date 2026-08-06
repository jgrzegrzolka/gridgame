import { t, countryName } from '../i18n.js';
import { generateCode, isValidRoomCode, serverUrlFor, httpServerUrlFor } from '../flags/roomNet.js';
import { probeRoomStatus } from '../flags/roomProbe.js';
import { deckIconHtml } from '../flags/deckIcons.js';
import { getOrCreateDeviceId } from '../flags/identity.js';
// Note the near-collision with this file's own `activeRoom` local, which is the
// room this tab is CONNECTED to right now. These three are about the room the
// DEVICE remembers being in, which outlives the connection and is what the start
// screen offers a way back into. The two disagree the moment you leave.
import { rememberActiveRoom, readActiveRoom, forgetActiveRoom } from '../flags/activeRoom.js';
import { displayNickname } from '../flags/nickname.js';
import { loadCountries } from '../flags/group.js';
import { initialPartyClientState, reducePartyMessage, withLocalBuzz, pickPartyCelebration, isCleanReveal, isBlankReveal, revealOrder } from '../flags/partyClient.js';
import { showBotSeat } from './botSeat.js';
import { setupSummaryParts, canStartGame } from './lobbySetup.js';
import { dockSpecFor } from './dockSpec.js';
import { setDock } from '../common.js';
import { pauseCardStep } from './pauseCard.js';
import { runCelebration } from '../confetti.js';
import { QUESTION_SECONDS, revealSecondsFor, barPaints, ROUND_BREAK_SECONDS, ROUND_INTRO_SECONDS, PICK_TIMEOUT_SECONDS, secondsLeft, remainingFraction, veilProgress, namesRevealed, isMetricQuestion, veilActive as veilActiveFor, DEFAULT_REVEAL, LEDGER_COUNT_MS, LEDGER_SLIDE_MS, LEDGER_ENTER_STAGGER_MS, ledgerSchedule, passLedgerSchedule, LEDGER_PASS_COUNT_MS, LEDGER_PASS_SLIDE_MS, CHART_REVEAL_SECONDS, initialHold, beginHold, endHold, heldMsAt, PAUSE_POPUP_DELAY_MS, breakAllowedIn, honoursSchedule, HONOUR_STRIP_CYCLE_MS, BOARD_ROW_STAGGER_MS, FINAL_CELEBRATION_OFFSET_MS } from '../flags/partyTiming.js';
import { ROUND_QUESTIONS, METRIC_MODES, PARTY_MODES, isRoundBoundary, isRoundStart, roundIndexAt, roundCount } from '../flags/partyPlan.js';
import { roundBreak, breakOpeningOrder } from '../flags/partyBreak.js';
import { emptyTally, addQuestionToTally } from '../flags/partyRoundTally.js';
import { formatValue } from '../flags/metricLens.js';
import { CLOSENESS_LADDER, wasFastest } from '../flags/partyScore.js';

/** The glyph on each round-gain chip, one per scoring bucket. Icon-only (the
 *  number sits beside it) so the chip stays free of i18n — a `⚡ +8` reads the
 *  same in every locale, and the bucket pass banner carries the worded label. */
const CHIP_ICON = { base: '✓', speed: '⚡', solo: '★', closeness: '≈' };
/** Fixed order the bucket passes run in — the order the break banks them: what you
 *  knew (base), then how fast (speed), then the rarer bonuses (only-one, close). */
const CHIP_ORDER = /** @type {const} */ (['base', 'speed', 'solo', 'closeness']);
import { barFractions, railWidthPx, chartUnitLine } from '../flags/partyChart.js';
import { capPickers } from '../flags/pickAvatars.js';
import { clausesFromPrompt, missLabel, filtersFor } from '../flags/partyQuestions/spotFlag.js';
import { renderSpotCriteria } from '../flags/filterChips.js';
import { METRIC_ICONS, METRIC_HUES, METRIC_SHORT } from '../flags/metricVisuals.js';
import { METRIC_FILES } from '../flags/metrics/index.js';
import { SUPERLATIVE_METRICS, superlativeMetricByQuestionId, hintFor } from '../flags/partyQuestions/superlativeCatalog.js';
import { resolveRoundCount, validateGameLength, validateFirstPickMode, DEFAULT_FIRST_PICK, canVeilMode, representativeModeFor, GAME_LENGTHS, DEFAULT_GAME_LENGTH, PICKS_PER_PLAYER_OPTIONS, validatePicksPerPlayer } from '../flags/partyDraft.js';
import { renderableQuestionIds, questionRenderAction, canRenderQuestion, canRenderHand } from './staleGuard.js';
import { createSectionSwapper } from './sectionSwap.js';
import { nextRadioId, paintRadioGroup, RADIO_KEYS } from './radioGroup.js';
import { buildAvatar, shareUrl, wireJoinCodeField } from '../common.js';
import { heartbeatAction, PING_INTERVAL_MS } from '../flags/heartbeat.js';

/** @typedef {import('../flags/partyClient.js').PartyClientState} PartyClientState */

/** How often the heartbeat wakes up to ask `heartbeatAction` what to do. Faster
 *  than the ping interval on purpose: the tick is also what notices a stale
 *  socket, and pacing it to PING_INTERVAL_MS would make that check granular to
 *  15s — up to a third of the pick window spent on a screen we know is dead. */
const HEARTBEAT_TICK_MS = Math.round(PING_INTERVAL_MS / 3);

const NICKNAME_KEY = 'gridgame.nickname';
// The host's chosen game length ('short' / 'medium' / 'long') — the only thing
// the host stores, since everything else about a draft falls out of it.
//
// Replaces `gridgame.party.picksPerPlayer`, which held a 1-4 pick count. Left
// unread rather than migrated: the numbers do not map onto the three lengths
// (picks 1 meant a different game at every table size, which is exactly what the
// lengths fixed), so a returning host gets the medium default and re-picks once.
//
// The host-built "Custom setup" door was retired before that: it stored a plan, a
// tricky toggle and per-category reveal timing (`gridgame.party.{setup,plan,
// tricky,reveal,mode}`). Draft is the only way a game starts now, so the plan
// comes from the players' picks and the veil timing is a fixed constant
// (DEFAULT_REVEAL). Those five keys are dead for the same reason.
const LENGTH_KEY = 'gridgame.party.gameLength';
// The host's remembered first round, carried into each room they host the same
// way the length is. A host who always opens on Spot the flag should not re-pick
// it every game.
const FIRST_PICK_KEY = 'gridgame.party.opener';
const FIRST_PICK_VEIL_KEY = 'gridgame.party.openerVeil';
// Even-picks sizing, remembered per device the same way the length is. Two keys:
// whether the mode is on, and which count it holds — so toggling the mode off and
// on again returns to the count the host last chose rather than a default.
const PICKS_MODE_KEY = 'gridgame.party.evenPicks';
const PICKS_N_KEY = 'gridgame.party.picksPerPlayer';

/** Scattered reveal order for the six tricky-mode veil panels, so the flag
 *  materialises in patches rather than strictly left-to-right (which would give
 *  a flag away by which side lights up first). Indexes the 3×2 cover grid. */
const VEIL_ORDER = [0, 4, 2, 5, 1, 3];

/** Lobby copy for each catalog mode (`flags/partyPlan.js` PARTY_MODES). The
 *  catalog stays pure (ids only); labels live here, translated via i18n with the
 *  English text as the fallback. `full` shows in the dial row, `short` in the
 *  collapsed summary mix.
 *
 *  **A metric's `full` names the subject and never the direction.** These labels
 *  used to end in the direction the question could be dealt in ("Coffee
 *  production: most", "Happiness score: happiest & least happy"), which is noise
 *  on the one screen that uses them — the draft pick card. The direction is
 *  chosen by the server when the round starts and announced twice already: on the
 *  round title card and, throughout the question, as the criterion label
 *  `hintFor` resolves. On the two-directional metrics the suffix wasn't even
 *  information, since "most & least" was true of every one of them.
 *
 *  The picture modes carry a `full` form ("Flags: countries", "Map: outlines") as
 *  their canonical catalog name, but no surface renders it any more: the lobby
 *  first-round row, the draft pick card AND the round card all show the SHORT
 *  name (Flags / Weird / Spot / Maps), so a round is named the same way
 *  everywhere. The full picture labels stay only to satisfy the test's "every
 *  mode has a full label" invariant; metrics have no short, so they keep `full`.
 *
 *  Pinned by `flagParty/modeLabels.test.js`, over these fallbacks AND over both
 *  shipped locales: the player reads the i18n string, so pinning only the
 *  fallback would let pl.json drift back unnoticed. */
const MODE_LABELS = {
  'flags-all': { key: 'party.mode.flagsAll', full: 'Flags: countries', shortKey: 'party.modeShort.flagsAll', short: 'Flags' },
  'flags-weird': { key: 'party.mode.flagsWeird', full: 'Weird flags', shortKey: 'party.modeShort.flagsWeird', short: 'Weird' },
  'map-outlines': { key: 'party.mode.mapOutlines', full: 'Map: outlines', shortKey: 'party.modeShort.mapOutlines', short: 'Maps' },
  'spot-flag': { key: 'party.mode.spotFlag', full: 'Spot the flag', shortKey: 'party.modeShort.spotFlag', short: 'Spot' },
  'superlative-pop': { key: 'party.mode.superlativePop', full: 'Population' },
  'superlative-area': { key: 'party.mode.superlativeArea', full: 'Land area' },
  'superlative-density': { key: 'party.mode.superlativeDensity', full: 'Population density' },
  'superlative-gdp': { key: 'party.mode.superlativeGdp', full: 'GDP' },
  'superlative-gdppc': { key: 'party.mode.superlativeGdppc', full: 'GDP per capita' },
  'superlative-coffee': { key: 'party.mode.superlativeCoffee', full: 'Coffee production' },
  'superlative-wine': { key: 'party.mode.superlativeWine', full: 'Wine production' },
  'superlative-cocoa': { key: 'party.mode.superlativeCocoa', full: 'Cocoa production' },
  'superlative-banana': { key: 'party.mode.superlativeBanana', full: 'Banana production' },
  'superlative-apple': { key: 'party.mode.superlativeApple', full: 'Apple production' },
  'superlative-elevation': { key: 'party.mode.superlativeElevation', full: 'Elevation' },
  'superlative-coastline': { key: 'party.mode.superlativeCoastline', full: 'Coastline length' },
  'superlative-forest': { key: 'party.mode.superlativeForest', full: 'Forest cover' },
  'superlative-oil': { key: 'party.mode.superlativeOil', full: 'Oil production' },
  'superlative-rice': { key: 'party.mode.superlativeRice', full: 'Rice production' },
  'superlative-coal': { key: 'party.mode.superlativeCoal', full: 'Coal production' },
  'superlative-sheep': { key: 'party.mode.superlativeSheep', full: 'Sheep per capita' },
  'superlative-cattle': { key: 'party.mode.superlativeCattle', full: 'Cattle per capita' },
  'superlative-beer': { key: 'party.mode.superlativeBeer', full: 'Beer consumption per capita' },
  'superlative-tea': { key: 'party.mode.superlativeTea', full: 'Tea production' },
  'superlative-sugarcane': { key: 'party.mode.superlativeSugarcane', full: 'Sugarcane production' },
  'superlative-gold': { key: 'party.mode.superlativeGold', full: 'Gold production' },
  'superlative-alcohol': { key: 'party.mode.superlativeAlcohol', full: 'Alcohol consumption per capita' },
  'superlative-meat': { key: 'party.mode.superlativeMeat', full: 'Meat consumption per capita' },
  'superlative-borders': { key: 'party.mode.superlativeBorders', full: 'Bordering countries' },
  'superlative-olive-oil': { key: 'party.mode.superlativeOliveOil', full: 'Olive oil production' },
  'superlative-honey': { key: 'party.mode.superlativeHoney', full: 'Honey production' },
  'superlative-temperature': { key: 'party.mode.superlativeTemperature', full: 'Average temperature' },
  'superlative-happiness': { key: 'party.mode.superlativeHappiness', full: 'Happiness score' },
  'superlative-corruption': { key: 'party.mode.superlativeCorruption', full: 'Government integrity' },
  'superlative-tourism': { key: 'party.mode.superlativeTourism', full: 'Tourist arrivals per capita' },
  'superlative-electricity': { key: 'party.mode.superlativeElectricity', full: 'Electricity use per capita' },
  'superlative-mcdonalds': { key: 'party.mode.superlativeMcdonalds', full: "McDonald's per million people" },
  'superlative-nobel': { key: 'party.mode.superlativeNobel', full: 'Nobel laureates' },
  'superlative-nobel-pc': { key: 'party.mode.superlativeNobelPc', full: 'Nobel laureates per million people' },
  'superlative-summer-medals': { key: 'party.mode.superlativeSummerMedals', full: 'Summer Olympic medals' },
  'superlative-summer-medals-pc': { key: 'party.mode.superlativeSummerMedalsPc', full: 'Summer Olympic medals per million people' },
  'superlative-winter-medals': { key: 'party.mode.superlativeWinterMedals', full: 'Winter Olympic medals' },
  'superlative-winter-medals-pc': { key: 'party.mode.superlativeWinterMedalsPc', full: 'Winter Olympic medals per million people' },
  // Metric families (`flags/partyDraft.js` METRIC_FAMILIES) label the CARD, not a
  // mode — the members keep their own labels above for the round title, which
  // names the statistic that was actually dealt.
  //
  // `sub` is the honesty line and only families have one: without it a player
  // picks "Economy" and is asked about GDP per capita with no warning. It states
  // the range up front so the round is a reveal rather than a substitution — the
  // same contract the 'most' / 'least' direction has always run under.
  economy: {
    key: 'party.mode.economy',
    full: 'Economy',
    subKey: 'party.modeSub.economy',
    sub: 'GDP, total or per person',
  },
  nobel: {
    key: 'party.mode.nobel',
    full: 'Nobel laureates',
    subKey: 'party.modeSub.nobel',
    sub: 'Total or per person',
  },
  olympicMedals: {
    key: 'party.mode.olympicMedals',
    full: 'Olympic medals',
    subKey: 'party.modeSub.olympicMedals',
    sub: 'Summer or Winter, total or per person',
  },
  population: {
    key: 'party.mode.population',
    full: 'Population',
    subKey: 'party.modeSub.population',
    sub: 'Total or per square kilometre',
  },
};


/** Every question id this build can render: the two fixed picture questions plus every
 *  superlative metric question in the catalog. The server (PartyKit, its own
 *  deploy) can be a build ahead of a still-open tab and deal a question id outside
 *  this set; when that happens {@link questionRenderAction} reloads us onto the new
 *  build rather than rendering a broken question. See `flagParty/staleGuard.js`. */
const KNOWN_QUESTION_IDS = renderableQuestionIds(SUPERLATIVE_METRICS.map((m) => m.questionId));

/** Every hand card id this build can put a name on — derived from MODE_LABELS
 *  itself, because that map is exactly what fails when the server deals a card we
 *  don't know: a missing entry yields an undefined i18n key, and `t(undefined)`
 *  takes the render down. Deriving it (rather than listing ids again) means a
 *  future family can't be added to the catalog and forgotten here. */
const KNOWN_CARD_IDS = new Set(Object.keys(MODE_LABELS));

/** Little pictures leading each draft hand card, distinct enough to tell apart at
 *  a glance. The artwork is shared with flagQuiz's round-settings pill via
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
  'spot-flag': deckIconHtml('spot', { className: 'mode-thumb' }),
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
 *  the metric's own icon for a statistic. Empty string if unknown.
 *
 *  A hand card can be a metric FAMILY id (`economy`), which is not a catalog
 *  mode, so it resolves to the family's representative first —
 *  `representativeModeFor` is the identity for every other id. */
export function modeIconHtml(/** @type {string} */ cardId) {
  if (MODE_ICONS[cardId]) return MODE_ICONS[cardId];
  const mode = MODE_BY_ID[representativeModeFor(cardId)];
  if (!mode) return '';
  const key = metricKeyForQuestion(mode.questionId);
  return (key && METRIC_ICONS[key]) || '';
}

/** The per-metric hue for a statistic card (for the draft card accent), or null.
 *  Family-aware, same as {@link modeIconHtml}. */
export function modeHue(/** @type {string} */ cardId) {
  const mode = MODE_BY_ID[representativeModeFor(cardId)];
  if (!mode) return null;
  const key = metricKeyForQuestion(mode.questionId);
  return (key && METRIC_HUES[key]) || null;
}

/** The icon HTML for a **round title card** — the same artwork as {@link
 *  modeIconHtml} but at the card's hero size (its own classes rather than the
 *  setup row's tiny slot). Empty string for an unknown mode (the caller shows a
 *  generic Flags card instead). */
export function roundCardIconHtml(/** @type {string} */ modeId) {
  if (modeId === 'flags-all') return deckIconHtml('flags', { className: 'roundcard-thumb' });
  // The weird deck's artwork is an INLINE svg, not an <img>, so the circular
  // `object-fit: cover` on `.roundcard-thumb` does not reach it — inline SVG
  // scales by `preserveAspectRatio`, whose default (`meet`) would letterbox the
  // 32x24 jolly roger inside the 56px circle and leave transparent wedges above
  // and below it. `slice` is the cover equivalent. Applied here rather than in
  // `deckIcons.js` because every other surface draws this icon as a rectangle,
  // where letterboxing is the correct behaviour.
  if (modeId === 'flags-weird') {
    return deckIconHtml('weird', { className: 'roundcard-thumb' })
      .replace('<svg ', '<svg preserveAspectRatio="xMidYMid slice" ');
  }
  if (modeId === 'map-outlines') return deckIconHtml('outlines', { className: 'roundcard-contour' });
  // The magnifier is inline SVG on a 24x24 viewBox, so it needs the same `slice`
  // treatment as the jolly roger above to fill the circle instead of letterboxing.
  if (modeId === 'spot-flag') {
    return deckIconHtml('spot', { className: 'roundcard-thumb' })
      .replace('<svg ', '<svg preserveAspectRatio="xMidYMid slice" ');
  }
  const mode = MODE_BY_ID[modeId];
  const key = mode ? metricKeyForQuestion(mode.questionId) : null;
  return (key && METRIC_ICONS[key]) || '';
}

/**
 * The state of each dot on the round card's progress row: `'done'` for rounds
 * already played, `'now'` for the one being announced, `''` for the rest.
 *
 * Pure so the arithmetic is pinned rather than eyeballed through a game — the
 * card only shows for {@link ROUND_INTRO_SECONDS} at a round boundary, which is
 * an expensive place to notice an off-by-one.
 *
 * @param {number} roundNum  1-based round being announced
 * @param {number} totalRounds
 * @returns {Array<'done' | 'now' | ''>}
 */
export function roundPipStates(roundNum, totalRounds) {
  const total = Number.isFinite(totalRounds) ? Math.max(0, Math.floor(totalRounds)) : 0;
  const now = Number.isFinite(roundNum) ? Math.floor(roundNum) : 0;
  return Array.from({ length: total }, (_, i) => {
    const n = i + 1;
    if (n === now) return 'now';
    return n < now ? 'done' : '';
  });
}

/**
 * The glyph for a game length: one, two or three strokes, so the control reads
 * as "longer" before the label is read. `currentColor` throughout, so the
 * stylesheet owns the accent and the unselected step-back.
 *
 * Empty string for an unknown length — the caller renders an empty slot rather
 * than a broken box, matching {@link roundCardIconHtml}.
 *
 * @param {string} length  one of GAME_LENGTHS
 * @returns {string}
 */
export function lengthIconHtml(length) {
  const rows = { short: [12], medium: [8, 16], long: [6, 12, 18] }[length];
  if (!rows) return '';
  return '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">' +
    rows.map((y) => `<path d="M7 ${y}h10" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>`).join('') +
    '</svg>';
}

/**
 * The glyph for an even-picks count: one, two or three filled pips — a pick per
 * round, so the control reads as "each player picks this many" alongside the
 * numeral. Filled dots rather than the length control's strokes so the two modes
 * are distinct at a glance. Same `currentColor` contract as {@link lengthIconHtml}.
 *
 * @param {number} n  1, 2 or 3
 * @returns {string}
 */
export function picksIconHtml(n) {
  // Strict on the number, not just the object lookup: bracket access coerces
  // `'2'` to the key `2`, so guard the type first to keep a stray string out.
  if (n !== 1 && n !== 2 && n !== 3) return '';
  const cols = { 1: [12], 2: [8, 16], 3: [6, 12, 18] }[n];
  return '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">' +
    cols.map((cx) => `<circle cx="${cx}" cy="12" r="2.6" fill="currentColor"/>`).join('') +
    '</svg>';
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
 * A card's second line, or null if it has none. Only metric FAMILIES carry one —
 * it states the range the family can resolve to, so the round's variant reads as
 * a reveal rather than a substitution.
 *
 * Returning null (rather than an empty `{key, fallback}`) is what lets the caller
 * skip the element entirely: an empty `.pick-card-sub` would still take its
 * margin and make family cards taller than their neighbours for no reason.
 *
 * @param {string} id
 * @returns {{ key: string, fallback: string } | null}
 */
export function modeSubLabel(id) {
  const ml = MODE_LABELS[id];
  return ml && ml.subKey && ml.sub ? { key: ml.subKey, fallback: ml.sub } : null;
}

/**
 * Which catalog mode a round's title card should announce, resolved from what the
 * client actually knows about the round.
 *
 * **Every round is a pick, round 1 included.** The host's lobby choice for round 1
 * rides the wire as an ordinary `draftPick` (see `applyStart`), so `lastPick` is
 * present for it too — the exact picked mode id, whether that is a specific metric
 * ("Coffee production") or a flag pool ("Flags: countries" vs "Flags: others"). No
 * firstPick special case: there is no such thing as an firstPick round any more.
 *
 * The `questionId` path below is the fallback for the one case `lastPick` can miss:
 * a mid-round reconnect, whose resume snapshot has no `draftPick`. It is 1:1 with a
 * mode for the map question and every superlative, so those resolve; the two flag
 * pools share `flagPick` and can't be told apart from the wire alone → `null`, the
 * caller's cue to show a generic "Flags" card. Unknown question id → `null` too.
 *
 * @param {{ picker: string, modeId: string } | null | undefined} lastPick
 * @param {string | undefined} questionId
 * @returns {string | null}  a PARTY_MODES mode id, or null for the generic case
 */
export function roundModeId(lastPick, questionId) {
  if (lastPick && lastPick.modeId && MODE_BY_ID[lastPick.modeId]) return lastPick.modeId;
  if (questionId === 'flagPick') return null; // ambiguous pool, no pick → generic Flags card
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
  /** Heartbeat marks — see `flags/heartbeat.js` for why an idle socket needs
   *  traffic at all. `lastRecvAt` is stamped by EVERY inbound message, not just
   *  pongs: any traffic proves the socket is alive, and on a busy round that
   *  means the ping never fires. */
  let lastRecvAt = /** @type {number | null} */ (null);
  let lastPingAt = /** @type {number | null} */ (null);
  let heartbeatTimer = 0;
  /** Fire the finish celebration (confetti / fireworks) exactly once per final
   *  screen. render() re-runs on every message and on a language switch, so a
   *  guard keeps the burst from re-triggering; reset when we leave the final
   *  phase (a "Play again" question → final fires a fresh show). */
  let finalCelebrated = false;

  // ---- element refs ----
  const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));
  const statusEl = $('party-status');
  const sections = {
    start: $('pt-start'), lobby: $('pt-lobby'), question: $('pt-question'), roundcard: $('pt-roundcard'), pick: $('pt-pick'), break: $('pt-break'),
    // The finish is three screens, not one: the honour beats, the winner's own
    // beat, and the board. All three are ordinary sections so the swapper, the
    // dock map and the `[hidden]` guards treat them like every other screen.
    honour: $('pt-honour'), winner: $('pt-winner'), final: $('pt-final'),
  };
  const roomCodeEl = $('room-code');
  const playersEl = $('players');
  const startBtn = /** @type {HTMLButtonElement} */ ($('start-game'));
  const waitEl = $('lobby-wait');
  const timerEl = $('question-timer');
  const timerFill = $('question-timer-fill');
  const timerLabel = $('question-timer-label');
  const promptEl = $('prompt');
  const promptLead = $('prompt-lead');
  const promptTarget = $('prompt-target');
  const promptUnit = $('prompt-unit');
  const gridEl = $('flags-grid');
  const holdReadEl = $('hold-read');
  const holdBtn = /** @type {HTMLButtonElement} */ ($('hold-btn'));
  const holdBtnLabel = $('hold-btn-label');
  const holdWho = $('hold-who');
  // The resume line and the one clickable thing on it. Split because the line is
  // a sentence ("You are in Q7S22 Rejoin") where only the last word acts — the
  // element that shows and hides is not the element you press.
  const resumeBtn = $('resume-room');
  const resumeGo = /** @type {HTMLButtonElement} */ ($('resume-go'));
  const resumeCodeEl = $('resume-code');
  const pauseDialog = /** @type {HTMLDialogElement} */ ($('pause-dialog'));
  const pauseBodyEl = $('pause-body');
  const pauseSubEl = $('pause-sub');
  const pauseGoEl = /** @type {HTMLButtonElement} */ ($('pause-go'));
  // The break's own surface — no dialog, see index.html. A sibling of <main>, so
  // its `position: fixed` resolves against the viewport rather than the screen
  // swap's transform (the same rule the dock's placement encodes).
  // The game itself, which recedes behind the break veil. Cached like every other
  // ref on this page rather than re-queried per paint: `paintBreak` runs on every
  // render, and a `querySelector` there would be the one DOM lookup in the file
  // that repeats for no reason.
  const partyMain = /** @type {HTMLElement} */ (document.querySelector('.party'));
  const breakVeil = $('break-veil');
  const breakPlay = /** @type {HTMLButtonElement} */ ($('break-play'));
  const breakWho = $('break-who');
  const breakQueuedEl = $('break-queued');
  const footEl = $('question-foot');
  const finalSub = $('final-sub');
  const finalWinner = $('final-winner');
  const finalHonours = $('final-honours');
  const finalBoard = $('final-board');
  const honourBody = $('honour-body');
  const honourDots = $('honour-dots');
  const winnerAv = $('winner-av');
  const winnerName = $('winner-name');
  const winnerScore = $('winner-score');
  const winnerCrown = $('winner-crown');
  const breakMvp = $('break-mvp');
  const breakStandingsLabel = $('break-standings-label');
  const breakBoard = $('break-board');
  const breakPass = $('break-pass');
  const roundCardCount = $('roundcard-count');
  const roundCardIc = $('roundcard-ic');
  const roundCardRing = $('roundcard-ring-fill');
  const roundCardName = $('roundcard-name');
  const roundCardPick = $('roundcard-pick');
  const lobbySetupEl = $('lobby-setup');
  // The setup card's collapsed header: the button that opens it, and the two
  // slots its one-line summary paints into.
  const setupHead = /** @type {HTMLButtonElement} */ ($('setup-head'));
  const setupBody = $('setup-body');
  const setupSumIc = $('setup-sum-ic');
  const setupSum = $('setup-sum');
  const botSeat = $('bot-seat');
  const botLevelBtns = /** @type {HTMLButtonElement[]} */ (
    [...botSeat.querySelectorAll('.bot-lv')]);
  const draftLengthGroup = $('draft-length-group');
  const draftLengthHint = $('draft-length-hint');
  // Scoped to the length group (not the whole field) so the even-picks segments
  // below don't land in here — the two radiogroups are painted independently.
  const draftPickBtns = /** @type {HTMLButtonElement[]} */ (
    [...draftLengthGroup.querySelectorAll('.dl-pick')]);
  // One, two, three strokes. Painted here rather than sitting in the HTML so the
  // markup stays the flat, translatable shell the rest of the page keeps.
  for (const btn of draftPickBtns) {
    const icon = btn.querySelector('.dl-ic');
    if (icon) icon.innerHTML = lengthIconHtml(btn.dataset.length ?? '');
  }
  // Even-picks sizing: a switch on the header, a parallel 1/2/3 radiogroup that
  // replaces the length one when the mode is on, and two label spans (one shown at
  // a time) so the field names whichever mode is active.
  const draftPicksGroup = $('draft-picks-group');
  const draftPicksBtns = /** @type {HTMLButtonElement[]} */ (
    [...draftPicksGroup.querySelectorAll('.dl-pick')]);
  for (const btn of draftPicksBtns) {
    const icon = btn.querySelector('.dl-ic');
    if (icon) icon.innerHTML = picksIconHtml(Number(btn.dataset.picks));
  }
  const draftPicksToggle = /** @type {HTMLInputElement} */ ($('draft-picks-toggle'));
  const draftPicksToggleLabel = /** @type {HTMLElement} */ (draftPicksToggle.closest('.scope-toggle'));
  const draftLengthLabel = $('draft-length-label');
  const draftPicksLabel = $('draft-picks-label');
  const draftFirstPickEl = $('draft-first-pick');
  const draftFirstPickGroup = $('draft-first-pick-group');
  const draftFirstPickVeil = /** @type {HTMLInputElement} */ ($('draft-first-pick-veil'));
  const draftFirstPickVeilLabel = /** @type {HTMLElement} */ (draftFirstPickVeil.closest('.scope-toggle'));
  const draftFirstPickBtns = /** @type {HTMLButtonElement[]} */ (
    [...draftFirstPickEl.querySelectorAll('.dl-pick')]);
  // Each firstPick segment wears its own mode's artwork, so the row is recognisable
  // before the labels are read — and it is the SAME icon the draft hand and the
  // round card use for that mode, so a host learns one picture per round type.
  for (const btn of draftFirstPickBtns) {
    const icon = btn.querySelector('.dl-ic');
    if (icon) icon.innerHTML = modeIconHtml(btn.dataset.firstPick ?? '');
  }
  const pickPill = $('pick-pill');
  const pickLead = $('pick-lead');
  const pickHand = $('pick-hand');
  const pickWatch = $('pick-watch');
  const pickBoard = $('pick-board');
  // The page's single dock. Its CONTENTS are rebuilt by `mountDock` on every
  // screen change, so the two items the page drives — Play again, Back to
  // settings — must be looked up live. Caching either at boot would hold an
  // element that stops being in the document at the first phase change: its
  // click listener would be dead and `hidden` would be set on a detached node.
  // Pinned by dockSpec.test.js.
  const partyDock = $('party-dock');
  const dockItem = (/** @type {string} */ id) =>
    /** @type {HTMLElement | null} */ (partyDock.querySelector(`#${id}`));
  /** The spec currently mounted, so an unchanged screen doesn't rebuild the bar
   *  under the user's finger (a remount would drop a press mid-tap). */
  let mountedDockSpec = partyDock.dataset.dock ?? null;
  const joinError = $('join-error');
  const joinForm = /** @type {HTMLFormElement} */ ($('join-form'));
  const joinCodeInput = /** @type {HTMLInputElement} */ ($('join-code'));
  const joinGoBtn = /** @type {HTMLButtonElement} */ ($('join-go'));
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

  /** Loaded countries by code. Declared as the full Country (which is what
   *  `loadCountries` actually puts in here) rather than the `{ code, name }` this
   *  used to claim: spot-the-flag's reveal reads `motifs` / `primaryColors` off
   *  these to work out which clause each wrong flag missed.
   *  @type {Map<string, import('../flags/group.js').Country>} */
  const byCode = new Map();

  // Metric values for each superlative question's reveal strip, keyed by questionId
  // (the question is judged server-side; the client only needs the numbers to show
  // the ranking after the answer is out). Fetched once at load, best-effort: a
  // missing metric just means that question's reveal shows no numbers.
  /** @type {Record<string, { values: Record<string, number>, format: string, key: string, year: number | null }>} */
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
    // The field's underline turns pink with the message, so the error reads as
    // being about this control rather than as a line that happens to sit near it.
    joinForm.classList.add('is-error');
  }
  function paintJoinError() {
    if (!lastJoinError) return;
    const { key, fallback, params } = lastJoinError;
    joinError.textContent = params ? fmt(t(key, fallback), params) : t(key, fallback);
  }
  function clearJoinError() {
    lastJoinError = null;
    joinError.hidden = true;
    joinError.textContent = '';
    joinForm.classList.remove('is-error');
  }

  /** The one screen-change primitive — every `showSection` call goes through it,
   *  so a screen change looks the same wherever it comes from. The sequencing
   *  (and its edge cases: the same screen asked for on every clock tick, a beat
   *  interrupting a swap mid-flight) lives in `sectionSwap.js` where it is
   *  unit-tested; this is only the DOM half. */
  const swapper = createSectionSwapper({
    show: (which) => { for (const [k, node] of Object.entries(sections)) node.hidden = k !== which; },
    mark: (name, cls, on) => { sections[name].classList.toggle(cls, on); },
    schedule: (fn, ms) => window.setTimeout(fn, ms),
    cancel: (handle) => { window.clearTimeout(handle); },
    reduced: prefersReducedMotion,
    // The finish board choreographs itself and therefore has to start when it is
    // actually on screen — `renderFinal` builds it during the out phase.
    onShown: (which) => {
      // The break ledger measures row heights for its FLIP, so it can only run once
      // the section is actually visible — see `startBreakLedger`.
      if (which === 'break') startBreakLedger();
      // The finish no longer needs a hook here: its beats are driven by the
      // ceremony's own clock (`playCeremony`), which paints each screen and THEN
      // asks for it, rather than building a board and waiting to be told it is
      // visible.
    },
  });

  function showSection(/** @type {'start'|'lobby'|'question'|'roundcard'|'pick'|'break'|'honour'|'winner'|'final'|null} */ which) {
    // Leaving the break ends the ledger's claim on the board, so the next break
    // builds and animates from scratch. See `breakBuilt`. Stays outside the
    // swapper and keyed on the request (not on the swap completing): it is a
    // logical fact about where the show is, and delaying it by the out phase
    // would let a re-render rebuild the ledger during the fade.
    if (which !== 'break') { breakBuilt = false; breakLedgerPending = null; }
    syncDock(which);
    swapper.to(which);
    // A queued break is handed to the room from HERE rather than from render(),
    // and the ordering is the reason: render decides the screen and then calls
    // this, so anything asking "may a break start now?" earlier in render is
    // still looking at the previous screen. This is the one place that knows
    // where the show has actually got to, and every path into a new screen —
    // including render's several early returns — goes through it.
    flushQueuedBreak();
  }

  /**
   * Point the page's one dock at whatever this screen wants (`dockSpec.js`).
   *
   * Applied on the REQUEST, not when the swap finishes: the dock is outside the
   * animation now, so it has no reason to wait for it, and changing it up front
   * means the bar never shows the previous screen's actions over the new one.
   *
   * Remounts only on a real change — rebuilding an identical bar would destroy
   * and recreate the button under a finger that is already on it.
   *
   * @param {string | null} which
   */
  function syncDock(which) {
    const spec = dockSpecFor(which);
    partyDock.hidden = spec === null;
    if (spec === null || spec === mountedDockSpec) return;
    setDock(spec, partyDock);
    mountedDockSpec = spec;
    // A remount builds fresh items from the catalog, so a queued break would
    // silently repaint itself back to "Pause" on every screen change. Re-applied
    // here, at the one place that knows the bar was just rebuilt.
    paintBreakControl();
  }

  /** @returns {boolean} whether the socket was open enough to actually send.
   *  Most callers ignore this — a dropped `buzz` is covered by the reconnect —
   *  but the hold button needs to know, since lighting up on a press that never
   *  left the tab would show a freeze that isn't happening. */
  function send(/** @type {object} */ msg) {
    if (!(ws && ws.readyState === WebSocket.OPEN)) return false;
    ws.send(JSON.stringify(msg));
    return true;
  }

  // ---- bots (host-only) ----
  // A bot is a server-driven seat added from the empty seat at the foot of the
  // lobby's player list (see `flags/partyBot.js`, and `botSeat.js` for when that
  // seat shows).
  // The client only sends `addBot` / `removeBot`; everything about how a bot plays
  // lives server-side.
  //
  // Nothing is remembered between adds. The seat used to store the last-picked
  // difficulty (`gridgame.party.botSkill`) so the Add button had something to
  // apply — but each level is its own button now, so a preference has nothing
  // left to pre-fill. Restoring it could only mark a button that isn't a
  // selection, which reads as state the tap doesn't actually depend on.
  /** @param {string | undefined} skill */
  function botSkillLabel(skill) {
    const key = { easy: 'party.botEasy', medium: 'party.botMedium', hard: 'party.botHard' }[String(skill)]
      || 'party.botMedium';
    return t(key, String(skill || 'Medium'));
  }

  // ---- game length (host-only) ----
  // The host chooses a LENGTH and the picks fall out, not the other way round.
  // Picks-per-player was legible but it was not a length: `seats x picks + 2`
  // meant one setting bought a 7-minute game at two seats and a 45-minute one at
  // ten, and the answer moved under the host every time somebody joined. The
  // round count is now a flat 4 / 7 / 10 (`roundCountFor`) that the seat count
  // cannot touch at all, so the hint below stops changing as people arrive.
  // Persisted per device; the server re-validates whatever we send.
  //
  // The ROOM is authoritative once connected: the length is shared state, so a
  // guest renders the host's choice read-only rather than a stale local one, and
  // two host devices in the same room cannot disagree. localStorage survives only
  // as the seed a host opens a fresh room with.
  function loadLength() {
    try {
      return validateGameLength(window.localStorage.getItem(LENGTH_KEY));
    } catch { return DEFAULT_GAME_LENGTH; }
  }
  function saveLength(length) {
    try { window.localStorage.setItem(LENGTH_KEY, length); } catch { /* private mode */ }
  }

  /** The length to render: the room's, once it has told us one. */
  function currentLength() {
    return validateGameLength(state.length);
  }

  /** The remembered even-picks count (1/2/3), defaulting to 2 — the middle, and a
   *  sensible game at most table sizes. Read only to seed a fresh room and to
   *  restore the count when the mode is switched back on. */
  function loadPicksN() {
    try {
      return validatePicksPerPlayer(Number(window.localStorage.getItem(PICKS_N_KEY))) ?? 2;
    } catch { return 2; }
  }
  function savePicksN(/** @type {number} */ n) {
    try { window.localStorage.setItem(PICKS_N_KEY, String(n)); } catch { /* private mode */ }
  }
  /** Whether this device last had even-picks sizing on. */
  function loadPicksMode() {
    try { return window.localStorage.getItem(PICKS_MODE_KEY) === '1'; } catch { return false; }
  }
  function savePicksMode(/** @type {boolean} */ on) {
    try { window.localStorage.setItem(PICKS_MODE_KEY, on ? '1' : '0'); } catch { /* private mode */ }
  }
  /** The picksPerPlayer this device would seed a fresh room with: the remembered
   *  count when the mode is on, null (size by length) when off. */
  function loadPicks() {
    return loadPicksMode() ? loadPicksN() : null;
  }

  /** The even-picks sizing to render: the room's value (1/2/3), or null when the
   *  game is sized by length. Room-authoritative, like {@link currentLength}. */
  function currentPicks() {
    return validatePicksPerPlayer(state.picksPerPlayer);
  }
  /** Whether the lobby is showing even-picks mode right now. */
  function picksModeOn() {
    return currentPicks() !== null;
  }

  function loadFirstPick() {
    try {
      return validateFirstPickMode(window.localStorage.getItem(FIRST_PICK_KEY));
    } catch { return DEFAULT_FIRST_PICK; }
  }
  function saveFirstPick(firstPick) {
    try { window.localStorage.setItem(FIRST_PICK_KEY, firstPick); } catch { /* private mode */ }
  }
  function loadFirstPickVeil() {
    try { return window.localStorage.getItem(FIRST_PICK_VEIL_KEY) === '1'; } catch { return false; }
  }
  function saveFirstPickVeil(/** @type {boolean} */ on) {
    try { window.localStorage.setItem(FIRST_PICK_VEIL_KEY, on ? '1' : '0'); } catch { /* private mode */ }
  }

  /** The first round to render: the room's, once it has told us one. */
  function currentFirstPick() {
    return validateFirstPickMode(state.firstPick);
  }

  /** Whether the first round is veiled: the room's value, painted by every seat. */
  function currentFirstPickVeil() {
    return state.firstPickVeil === true;
  }

  /** Rooms this device has already pushed its remembered length into. */
  const seededRooms = new Set();

  /**
   * Carry this device's remembered lobby settings — the game length and the
   * first round — into a room it hosts, once. Without this the stored
   * preferences would be unreachable: the room opens on its own defaults and
   * nothing would ever tell it otherwise, so a host who always plays Long, or
   * always opens on Spot the flag, would have to re-pick every single game.
   *
   * Keyed by room code and guarded on the value actually differing, so it fires
   * at most once per room and never fights a host who changes their mind.
   */
  function seedHostSettings() {
    const code = activeRoom ? activeRoom.code : null;
    if (!code || !state.isHost || state.phase !== 'lobby') return;
    if (seededRooms.has(code)) return;
    seededRooms.add(code);
    // Sent unconditionally, not only when it differs from what the room shows.
    // The server treats a null room length as "an old client is hosting, size the
    // game from the start message instead" — so a modern host must always claim
    // the room, even when their choice happens to match the default.
    send({ type: 'setLength', length: loadLength() });
    // The first round rides the same one-shot claim, but NOT for the same
    // reason, and the difference is worth stating so nobody later "fixes" one to
    // match the other. A null room length is load-bearing — the server reads it
    // as "size the game from the start message" — while a null first-round choice is not,
    // because `validateFirstPickMode` maps null and 'flags-all' to the same round.
    // This send is symmetry plus remembered-preference delivery, not a protocol
    // requirement: it is what carries a host who always opens on Spot the flag
    // into their room without re-picking.
    send({ type: 'setFirstPick', firstPick: loadFirstPick(), veil: loadFirstPickVeil() });
    // Even-picks sizing rides the same one-shot claim, carrying the host's
    // remembered mode into the room. `loadPicks()` is null when the mode is off,
    // which the server resolves to the length above — so an off host sends null
    // and the room sizes by length, exactly as before this setting existed.
    send({ type: 'setPicks', picksPerPlayer: loadPicks() });
  }

  /** Seats currently in the room — the other half of the length arithmetic. */
  function seatCount() {
    return state.roster.filter((r) => r.present).length;
  }

  /** Rounds a start would actually deal. Fixed per length; only even-picks mode
   *  reads the seat count (seats × N), which is why this still takes one. */
  function effectiveRounds() {
    return resolveRoundCount(seatCount(), currentLength(), currentPicks());
  }

  /**
   * The hint under the control: just how many rounds the game runs. It reads the
   * same in both sizing modes — the length label and, in even-picks mode, the
   * "Everyone picks N" field label already say how the number was reached, so the
   * hint only carries the number itself.
   */
  function lengthHintText() {
    return fmt(t('party.lengthRounds', '{r} rounds'), { r: effectiveRounds() });
  }

  /**
   * Paint the length / even-picks control: which segment is checked, the mode
   * switch, and whether this seat may change any of it. Guests see the same control
   * in the same place, disabled — the sizing is something they are told, not
   * hidden from them, because it decides how long they are staying.
   *
   * Two sizing modes share the field: the length table (Short/Medium/Long) and
   * even picks (1/2/3). Only one radiogroup shows at a time; the switch flips
   * between them and the field label names whichever is active.
   */
  function syncDraftLength() {
    const picks = currentPicks();
    const on = picks !== null;
    // Swap which radiogroup and which label span is shown.
    draftLengthGroup.hidden = on;
    draftPicksGroup.hidden = !on;
    draftLengthLabel.hidden = on;
    draftPicksLabel.hidden = !on;
    if (on) {
      paintRadioGroup(draftPicksBtns, draftPicksGroup, 'picks', String(picks), state.isHost);
    } else {
      paintRadioGroup(draftPickBtns, draftLengthGroup, 'length', currentLength(), state.isHost);
    }
    // The mode switch: shown to everyone (guests read it, like the segments), only
    // the host may flip it — same read-only shape as the first-round veil switch.
    draftPicksToggleLabel.classList.toggle('is-disabled', !state.isHost);
    draftPicksToggle.disabled = !state.isHost;
    draftPicksToggle.checked = on;
    draftLengthHint.textContent = lengthHintText();
    // The closed card has to say the same thing this control does, so it repaints
    // on the same beat rather than on its own.
    syncSetupSummary();
  }

  /**
   * Is the setup card open? Deliberately NOT persisted across visits: a host who
   * opened it once to change the length would then find it open on every future
   * lobby, which defeats the point of a card that collapses. It resets to closed
   * with the page, and closed is what the lobby is designed around.
   */
  let setupOpen = false;

  /** How long the panel takes to open — must match the `grid-template-rows`
   *  transition on `.setup-body` in index.css. It only gates when the overflow
   *  clip is released, so being a few ms out is harmless; being much SHORTER
   *  than the animation is not, since the panel would stop clipping while it is
   *  still growing. */
  const SETUP_SETTLE_MS = 280;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let setupSettleTimer;

  /**
   * Open or close the setup card. Four things move together and all four are
   * load-bearing: the class drives the animation, `aria-expanded` is what a
   * screen reader reads off the header button, `inert` is what actually takes
   * the collapsed controls out of the tab order (the panel is still laid out as
   * a 0fr grid row, so without it a keyboard user tabs into segments they cannot
   * see and changes the game blind), and `is-settled` releases the panel's
   * overflow clip once it has finished growing so the two switches' hover tips
   * can be drawn outside the card.
   *
   * The settle is deliberately asymmetric: released on a delay when opening,
   * revoked immediately when closing, so the clip is always back in place before
   * the panel starts to shrink.
   */
  function setSetupOpen(open) {
    setupOpen = open;
    lobbySetupEl.classList.toggle('is-open', open);
    setupHead.setAttribute('aria-expanded', String(open));
    if (open) setupBody.removeAttribute('inert');
    else setupBody.setAttribute('inert', '');
    clearTimeout(setupSettleTimer);
    if (!open) { lobbySetupEl.classList.remove('is-settled'); return; }
    setupSettleTimer = setTimeout(() => lobbySetupEl.classList.add('is-settled'), SETUP_SETTLE_MS);
  }

  /**
   * Paint the collapsed card's one-line summary: what we play first, how big the
   * game is, how many rounds that comes to. For anyone who never opens the card
   * this line IS the setup, so it repaints from the same room state on the same
   * beat as the controls it stands in for — every caller of `syncDraftLength` /
   * `syncDraftFirstPick` gets it for free.
   *
   * The mode icon is `modeIconHtml`, the identical artwork the segment below
   * carries, so the picture in the closed card and the picture in the open one
   * can never disagree.
   */
  function syncSetupSummary() {
    const firstPick = currentFirstPick();
    setupSumIc.innerHTML = modeIconHtml(firstPick);
    setupSum.textContent = '';
    const parts = setupSummaryParts({
      mode: modeShortLabel(firstPick),
      length: currentLength(),
      picks: currentPicks(),
      rounds: effectiveRounds(),
    });
    parts.forEach((part, i) => {
      if (i > 0) setupSum.appendChild(el('span', 'sum-sep', ' · '));
      const text = part.args
        ? fmt(t(part.key, part.fallback), part.args)
        : t(part.key, part.fallback);
      setupSum.appendChild(el('span', part.muted ? 'sum-muted' : '', text));
    });
  }

  /**
   * Paint the first-round control. Same contract as the length above: guests see
   * the host's choice in the same place, disabled but not dimmed, because the
   * first round is something they are told rather than something withheld.
   */
  function syncDraftFirstPick() {
    paintRadioGroup(draftFirstPickBtns, draftFirstPickGroup, 'firstPick', currentFirstPick(), state.isHost);
    // The veil switch: shown to everyone in the lobby (guests read it, like the
    // firstPick buttons), but only the host may flip it. A guest's copy wears the
    // shared read-only treatment (`.is-disabled`) and a truly-disabled checkbox, so
    // it reports its value the same way the radiogroup reports the host's choice.
    draftFirstPickVeilLabel.classList.toggle('is-disabled', !state.isHost);
    draftFirstPickVeil.disabled = !state.isHost;
    draftFirstPickVeil.checked = currentFirstPickVeil();
    syncSetupSummary();
  }

  /**
   * Choose the first round. Like the length, the host asks the room and repaints
   * when the room agrees, rather than changing it locally and announcing it — so
   * every seat paints one server-owned value. The veil rides every setFirstPick so a
   * mode change never drops the host's armed veil (the server keeps the last one
   * on an omitted field, but sending it is clearer than relying on that).
   */
  function setFirstPick(next, focus) {
    if (!state.isHost) return;
    const firstPick = validateFirstPickMode(next);
    if (firstPick !== currentFirstPick()) {
      saveFirstPick(firstPick);
      send({ type: 'setFirstPick', firstPick, veil: loadFirstPickVeil() });
    }
    if (!focus) return;
    const active = draftFirstPickBtns.find((b) => b.dataset.firstPick === firstPick);
    if (active) active.focus();
  }

  /** Arm or disarm the first round's veil. Host-only, same ask-the-room pattern
   *  as {@link setFirstPick}: send the change and let the broadcast repaint every
   *  seat, rather than flipping local state and announcing it. */
  function setFirstPickVeil(on) {
    if (!state.isHost || on === currentFirstPickVeil()) return;
    saveFirstPickVeil(on);
    send({ type: 'setFirstPick', firstPick: currentFirstPick(), veil: on });
  }

  /**
   * Choose a length. The host does not change it locally and tell the room; it
   * asks the room and repaints when the room agrees, so every seat (including
   * this one) is painting the same server-owned value. Ignored for a guest, whose
   * buttons are disabled anyway — this is the keyboard's back door.
   */
  function setGameLength(next, focus) {
    if (!state.isHost) return;
    const length = validateGameLength(next);
    if (length !== currentLength()) {
      saveLength(length);
      send({ type: 'setLength', length });
    }
    if (!focus) return;
    const active = draftPickBtns.find((b) => b.dataset.length === length);
    if (active) active.focus();
  }

  /**
   * Flip even-picks sizing on or off. On sends the remembered count (so the field
   * comes back where the host left it); off sends null, which the server resolves
   * back to the length the room still holds. Same ask-the-room pattern as the
   * length: send it and let the broadcast repaint every seat.
   */
  function setPicksMode(on) {
    if (!state.isHost) return;
    savePicksMode(on);
    const next = on ? loadPicksN() : null;
    if (next !== currentPicks()) send({ type: 'setPicks', picksPerPlayer: next });
  }

  /**
   * Choose the even-picks count (1/2/3). Remembered per device and sent to the
   * room. Only reachable while the mode is on (the segments are hidden otherwise).
   */
  function setPicksValue(next, focus) {
    if (!state.isHost) return;
    const n = validatePicksPerPlayer(next);
    if (n === null) return;
    savePicksN(n);
    if (n !== currentPicks()) send({ type: 'setPicks', picksPerPlayer: n });
    if (!focus) return;
    const active = draftPicksBtns.find((b) => Number(b.dataset.picks) === n);
    if (active) active.focus();
  }

  // Thin `t()` wrapper over the pure resolvers — the id→label mapping lives up
  // there so it can be pinned by flagParty/modeLabels.test.js; here we just
  // localize the resolved key. The picture modes resolve to their SHORT label, so
  // a draft pick card reads the same word as the lobby's first-round row (Flags /
  // Weird / Spot / Maps) — the two surfaces name the same round the same way.
  // Only the picture modes carry a `shortKey`; metric cards keep their full name,
  // which carries the "per capita" qualifiers a short form would drop.
  const modeLabel = (/** @type {string} */ id) => {
    const ml = MODE_LABELS[id];
    const { key, fallback } = ml && ml.shortKey ? modeShortLabel(id) : modeFullLabel(id);
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
    const socket = new WebSocket(wsUrl(activeRoom.code, activeRoom.intent));
    ws = socket;
    socket.addEventListener('open', () => { reconnectAttempts = 0; startHeartbeat(); });
    socket.addEventListener('message', (e) => handleMessage(String(e.data)));
    socket.addEventListener('close', () => {
      // Only the CURRENT socket may drive a reconnect. The heartbeat abandons a
      // stale socket by nulling `ws` and reconnecting immediately; if that
      // abandoned socket's close event turns up later (ours took 30+ s to arrive
      // in testing, and sometimes never did), this guard stops it advancing the
      // backoff a second time and tearing down the connection that replaced it.
      if (ws !== socket) return;
      stopHeartbeat();
      if (!rejected) scheduleReconnect();
    });
  }

  /**
   * Poke an idle connection and notice when it has died without saying so.
   *
   * A half-open socket never fires `close`, so `scheduleReconnect` is never
   * reached and the client sits on a stale screen believing it is connected —
   * the Flag Party bug where one player watched the standings while the rest of
   * the table moved on to the pick. The tick runs faster than the ping interval
   * and lets `heartbeatAction` decide; sizing the timer to the interval would
   * make the stale check granular to 15s.
   */
  function startHeartbeat() {
    stopHeartbeat();
    lastRecvAt = Date.now();
    lastPingAt = null;
    heartbeatTimer = window.setInterval(() => {
      const action = heartbeatAction(Date.now(), { lastRecvAt, lastPingAt });
      if (action === 'ping') {
        lastPingAt = Date.now();
        // Deliberately not `send()` — that helper drops the message when the
        // socket isn't OPEN, which is exactly the state we're trying to detect.
        // A throw here means the socket is gone, so fall through to reconnect.
        try {
          if (ws) ws.send(JSON.stringify({ type: 'ping' }));
          return;
        } catch { /* dead socket — reconnect below */ }
      } else if (action !== 'reconnect') {
        return;
      }
      // Stale: abandon this socket and reconnect ourselves. We must NOT wait for
      // the close event to do it.
      //
      // The first version of this did exactly that — call `close()` and let the
      // close handler run the usual backoff — and it deadlocked. `close()` only
      // *starts* the closing handshake; the event fires when the peer completes
      // it. Against a connection that has stopped behaving, that never happens:
      // in the browser the socket went to readyState 2 (CLOSING) and sat there
      // for the remaining 28 s of the test with no close event. The heartbeat had
      // already stopped itself, so nothing was left to retry and the client hung
      // permanently — strictly worse than the stale screen this exists to fix.
      //
      // So: drop our reference first (which disarms the close handler via its
      // `ws !== socket` guard), then close on a best-effort basis, then schedule
      // the reconnect directly. The handshake can take as long as it likes.
      stopHeartbeat();
      const dead = ws;
      ws = null;
      try { if (dead) dead.close(); } catch { /* best effort — already gone */ }
      if (!rejected) scheduleReconnect();
    }, HEARTBEAT_TICK_MS);
  }

  function stopHeartbeat() {
    clearInterval(heartbeatTimer);
    heartbeatTimer = 0;
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
    // Any inbound traffic proves the socket is alive, so stamp before parsing —
    // even a message this build can't understand is evidence of a live peer.
    lastRecvAt = Date.now();
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    // The pong exists only to be received. It carries no state, and running it
    // through the reducer + render would repaint the screen every 15s for
    // nothing — including rebuilding the grid mid-question.
    if (msg.type === 'pong') return;
    const { state: next, effects } = reducePartyMessage(state, msg);
    state = next;
    // A hold press/release must NOT go through render(): that rebuilds the grid,
    // and rebuilding the chart mid-reveal replays its entrance cascade — so every
    // time anyone pressed, the thing they were trying to read would jump. Only
    // the status line changes, so only the status line is repainted.
    if (msg.type === 'holding') { syncAndPaintHold(); return; }
    // Same reasoning as `holding` above: a pause changes the clock and one line
    // of text, and nothing else on screen. Going through render() would rebuild
    // the grid — so the question people are mid-answer on would flicker and
    // reshuffle at the exact moment the room froze.
    if (msg.type === 'paused') { syncPauseAccounting(); paintPause(); return; }
    if (msg.type === 'roster' && typeof msg.hostId === 'string') roomHostId = msg.hostId;
    // `hostId` first: it names the host outright. The `isHost` fallback is for a
    // server older than that field, which only ever told you about yourself.
    if (msg.type === 'welcome' && typeof msg.hostId === 'string') roomHostId = msg.hostId;
    else if (msg.type === 'welcome' && msg.isHost) roomHostId = state.you;
    for (const eff of effects) {
      if (eff.type === 'close') {
        rejected = true;
        try { if (ws) ws.close(); } catch { /* already closed */ }
        activeRoom = null;
        // The server has told us this room is not somewhere we can be — gone,
        // full, or already playing. Whatever the reason, offering a way back
        // into it would just repeat the rejection, so the memory goes with it.
        forgetActiveRoom(window.localStorage);
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

  /**
   * @param {string} code
   * @param {'create'|'join'} intent
   * @param {{ push?: boolean }} [opts]  `push` adds a history entry, so Back
   *   leaves the room instead of leaving the site. Set for every user-initiated
   *   entry; left off on the boot path, where the URL already names the room and
   *   pushing would bury the entry the player arrived on.
   */
  function enterRoom(code, intent, opts = {}) {
    rejected = false;
    reconnectAttempts = 0;
    clearJoinError();
    state = initialPartyClientState();
    activeRoom = { code, intent };
    // Written down before the socket is even open, and deliberately not
    // conditional on the join succeeding: the case this exists for is the player
    // whose page went away, and the entry is what gets them back. A code that
    // turns out to be dead is cleared when the server says so (the reject path).
    rememberActiveRoom(window.localStorage, { game: 'party', code, at: Date.now() });
    const url = new URL(location.href);
    url.searchParams.set('room', code);
    if (opts.push) history.pushState(null, '', url.toString());
    else history.replaceState(null, '', url.toString());
    render();
    connect();
  }

  /**
   * Leave the room and go back to the start screen, without touching history —
   * the caller has either just been moved by the browser (Back) or is about to
   * rewrite the URL itself.
   */
  function leaveRoom() {
    // `activeRoom` first, so the close handler's `scheduleReconnect` sees there
    // is no room to go back to; then the same drop-reference-then-close order the
    // heartbeat uses above, so a socket that never completes its handshake can't
    // hold anything up. The remembered room is deliberately KEPT: leaving is
    // exactly when the way back matters.
    activeRoom = null;
    stopHeartbeat();
    const dead = ws;
    ws = null;
    try { if (dead) dead.close(); } catch { /* best effort — already gone */ }
    state = initialPartyClientState();
    render();
  }

  // Back leaves the ROOM, not the site. Entering a room pushes a history entry
  // (see `enterRoom`), so the browser's own Back — and the phone edge-swipe that
  // is the same gesture, and the way most accidental exits actually happen —
  // lands on the start screen with the way back in still offered, instead of
  // dumping the player off the page with the code gone.
  window.addEventListener('popstate', () => {
    const code = new URLSearchParams(location.search).get('room');
    const wanted = code && isValidRoomCode(code.toUpperCase()) ? code.toUpperCase() : null;
    if (!wanted && activeRoom) { leaveRoom(); return; }
    // Forward again, back into the room. Replace rather than push: the entry we
    // are landing on already exists, and pushing here would grow the stack every
    // time the player oscillated.
    if (wanted && (!activeRoom || activeRoom.code !== wanted)) enterRoom(wanted, 'join');
  });

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
    // Idle, not hidden: the bar keeps its slot so nothing below it moves.
    timerEl.classList.add('is-idle');
  }

  // ---- hold to read ----
  // The chart reveal's beat is a fixed guess, and sometimes it is wrong. Any seat
  // can press and hold to freeze the countdown and let go when it has finished
  // reading, so the room pays for what that player actually needed rather than a
  // flat extension applied to every question.
  //
  // Every client runs this same accounting off the broadcast holders set, so all
  // of them freeze together; the host's copy is the one that decides when `next`
  // fires, exactly as it already does for the unfrozen clock. Small drift between
  // clients doesn't matter — they each render their own countdown already.
  //
  // Held time is UNBOUNDED — "hold to read" means what it says — so nothing here
  // expires a hold and there is no allowance to run out. What makes that safe is
  // that every way a hold can end is handled where it happens, rather than timed
  // out centrally: let go (the pointer/key handlers below), the screen going away
  // (`visibilitychange` / `pagehide`), the phase moving on (the client reducer
  // clears holders), and — the one case this tab can never cover, because it is
  // already gone — the socket dropping, which `party/partyGameServer.js` releases
  // from `onClose`. Remove any one of those and a hold can get stuck for good.
  /** @type {import('../flags/partyTiming.js').HoldState} */
  let hold = initialHold();
  /** Whether THIS device's finger is currently down, so the local button state
   *  doesn't wait for the server to echo our own press back. */
  let holdPressed = false;

  /** Total ms the current reveal has been frozen for, as of now. */
  function heldNow() {
    return heldMsAt(hold, Date.now());
  }

  // ---- paused for an absent player ----
  // Same accounting as hold-to-read, and deliberately the same primitive: a
  // pause is just a freeze nobody has to keep their finger on. The differences
  // are that it applies to EVERY timed phase rather than the chart reveal (a
  // player who dropped mid-question is exactly who a running question clock hurts
  // most), and that it is driven by `state.pausedFor` from the server instead of
  // a local press, so every screen in the room freezes on the same message.
  //
  // Reset per phase exactly like `hold`, and for the same reason: the offset is
  // measured against the CURRENT phase's deadline, so banked time from an
  // earlier beat would push a fresh clock absurdly far out. A pause can outlive
  // its phase (buzzes still land while frozen, so a question can auto-reveal
  // under one), which is why `startClock` re-arms the stretch immediately
  // instead of just zeroing it.
  /** @type {import('../flags/partyTiming.js').HoldState} */
  let pause = initialHold();

  /** Whether the room's clock is frozen right now, for EITHER reason.
   *
   *  A drop-pause and a break are one freeze with two causes, so they share the
   *  arithmetic and compose: a room can be waiting for an absent seat while
   *  somebody has also asked for a break, and it un-freezes only when both are
   *  gone. Keeping two `HoldState`s instead would double the bookkeeping to
   *  answer a question nothing asks — the clock only wants "frozen or not". */
  function frozenNow() {
    return state.pausedFor !== null || state.breakBy !== null;
  }

  /** Advance the pause clock to now, following the server's answer. */
  function syncPauseAccounting() {
    const now = Date.now();
    pause = frozenNow() ? beginHold(pause, now) : endHold(pause, now);
  }

  // ---- the break: a pause any seat asks for ----
  // The freeze is the same one `pause` above accounts for. What is different is
  // who starts it (anyone), who ends it (anyone), and what it puts on screen: a
  // greyed game and one play button, rather than the card that explains a drop.
  //
  // Pressed during a QUESTION it does not freeze anything — the 20 s window is a
  // shared race and a mid-question freeze is free thinking time. It queues
  // instead, and this device flushes it at the next screen a break is allowed in.
  // The queue is local: nothing has happened to the room until it is sent.
  let breakQueued = false;

  /**
   * The beat the show is on, in the vocabulary `breakAllowedIn` speaks.
   *
   * Neither the room's phase nor the screen answers this alone, which is the
   * whole reason it is a function. The **reveal has no screen of its own** — it
   * is painted into `#pt-question`, over the grid you just answered on — so
   * asking the swapper would report "question" for the calmest beat in the show
   * and queue every break for a reveal that had already happened. Asking the room
   * instead misses the round card, which is a client-side beat inside the
   * question phase and the one screen most likely to be pressed on.
   *
   * So: the screen decides the two beats only it knows about, and the room
   * decides the rest.
   */
  function breakPhaseNow() {
    if (swapper.target === 'roundcard' || swapper.target === 'break') return swapper.target;
    return state.phase;
  }

  /** Send the break now if this screen allows one, else remember the press.
   *  Pressing again while queued cancels — the item stays live rather than
   *  greying out, so the second press has something to undo. */
  function toggleBreak() {
    // Already on a break: this is the resume, wherever it was pressed from.
    if (state.breakBy !== null) { send({ type: 'endBreak' }); return; }
    if (breakQueued) { breakQueued = false; paintBreakControl(); return; }
    if (breakAllowedIn(breakPhaseNow())) { send({ type: 'requestBreak' }); return; }
    breakQueued = true;
    paintBreakControl();
  }

  /** Hand a queued break to the room once the show reaches a beat that can take
   *  one. Called on every render, so it fires on the first reveal after the
   *  press whichever way the room got there (the clock, the last buzz landing,
   *  a seat dropping). */
  function flushQueuedBreak() {
    if (!breakQueued) return;
    if (state.breakBy !== null) { breakQueued = false; paintBreakControl(); return; }
    if (!breakAllowedIn(breakPhaseNow())) return;
    breakQueued = false;
    send({ type: 'requestBreak' });
    paintBreakControl();
  }

  /** The dock item + the question-screen pill, which say the same thing at two
   *  scales: 11px in the bar cannot carry the sentence, and the sentence alone
   *  would not be where the finger is. */
  function paintBreakControl() {
    breakQueuedEl.hidden = !breakQueued;
    if (breakQueued) breakQueuedEl.textContent = t('party.breakQueued', 'Pause after this question');
    const item = dockItem('party-pause');
    if (!item) return;
    // Rose rather than greyed: greyed reads as disabled (the dock's own rule),
    // and this item is very much still pressable — pressing it again cancels.
    item.classList.toggle('is-queued', breakQueued);
    const label = /** @type {HTMLElement | null} */ (item.querySelector('.dock-item__label'));
    if (!label) return;
    const key = breakQueued ? 'party.breakQueuedShort' : 'party.breakAction';
    // The `data-i18n` moves with the text, not just the text: a language switch
    // re-applies every marked element from its key, so leaving the original key
    // in place would silently repaint "Pause" over a queued item.
    label.dataset.i18n = key;
    label.textContent = t(key, breakQueued ? 'Queued' : 'Pause');
  }

  /** Show or hide the break veil and name who asked for it. Cheap and
   *  independent of render(), like the pause card: a break must not rebuild the
   *  grid underneath a question people are mid-answer on. */
  function paintBreak() {
    const who = state.breakBy;
    const on = who !== null && activeRoom !== null;
    breakVeil.hidden = !on;
    partyMain.classList.toggle('is-break', on);
    if (!on) return;
    breakWho.textContent = '';
    const entry = state.roster.find((r) => r.playerId === who);
    // The roster update and the break can cross, so the name is briefly unknown.
    // Say "someone" rather than painting a headless sentence — same beat of
    // uncertainty the hold line already handles this way.
    const name = entry ? entry.nickname : t('party.holdReadingSomeone', 'Someone');
    breakWho.appendChild(buildAvatar(who));
    breakWho.appendChild(el('span', undefined, fmt(t('party.breakBy', '{name} paused the game'), { name })));
  }

  /** Pending "show the popup" timer, or 0. Held so a pause that ends inside the
   *  delay never surfaces a card at all. */
  let pausePopupTimer = 0;

  /** Fill the card from the current pause. Separate from opening it so a pause
   *  that moves to a SECOND absentee updates the text of a card already open. */
  function paintPauseText() {
    const who = state.pausedFor;
    if (!who) return;
    const entry = state.roster.find((r) => r.playerId === who);
    // Same beat of uncertainty as a hold: the roster update and the pause can
    // cross, so the name is briefly unknown. Say "someone" rather than painting
    // a headless sentence.
    const name = entry ? entry.nickname : t('party.holdReadingSomeone', 'Someone');
    pauseBodyEl.textContent = fmt(
      t('party.pausedBody', '{name} dropped out. The game is holding for them, and starts again the moment they are back.'),
      { name },
    );
    // Only the host can release the room, and hosting migrates on a disconnect,
    // so whoever is offered this button is always someone actually present.
    pauseGoEl.hidden = !state.isHost;
    // Everyone else is told whose call it is, rather than being shown a button
    // that would do nothing for them. (No need to exclude the paused seat:
    // `applyDisconnect` migrates hosting away before it settles the pause, so
    // the host is never the player the room is waiting for.)
    const host = state.roster.find((r) => r.playerId === roomHostId);
    pauseSubEl.hidden = state.isHost || !host;
    if (!pauseSubEl.hidden && host) {
      pauseSubEl.textContent = fmt(t('party.pausedHostHint', '{host} can choose to play on without them.'), { host: host.nickname });
    }
  }

  /** Open, update or close the pause card. Cheap and independent of render(),
   *  like `syncAndPaintHold`: a pause must not rebuild the grid underneath a
   *  question people are mid-answer on.
   *
   *  The decision itself lives in `pauseCard.js` so every path through it is
   *  unit-tested — including leaving the room mid-pause, which this used to get
   *  wrong. Everything here is just carrying the answer out.
   *
   *  @param {boolean} [delayElapsed]  set only by the delay firing. */
  function paintPause(delayElapsed = false) {
    const step = pauseCardStep({
      // Deliberately the room, not just `state.pausedFor`: on the way out those
      // two disagree, and the card belongs to the room.
      inRoom: activeRoom !== null,
      pausedFor: state.pausedFor,
      isOpen: pauseDialog.open,
      timerPending: pausePopupTimer !== 0,
      delayElapsed,
    });
    if (step === 'close') {
      if (pausePopupTimer) { clearTimeout(pausePopupTimer); pausePopupTimer = 0; }
      if (pauseDialog.open) pauseDialog.close();
      return;
    }
    if (step === 'repaint') { paintPauseText(); return; }
    if (step === 'open') { paintPauseText(); pauseDialog.showModal(); return; }
    if (step === 'schedule') {
      pausePopupTimer = window.setTimeout(() => {
        pausePopupTimer = 0;
        // Re-asked rather than assumed: the room can have resumed, or this
        // client left it, while the delay was running.
        paintPause(true);
      }, PAUSE_POPUP_DELAY_MS);
    }
  }

  /** Total ms the room has been paused for, across every phase, as of now. */
  function pausedNow() {
    return heldMsAt(pause, Date.now());
  }

  /** Start / stop freezing, following the holders set. Called whenever it changes
   *  and on every clock tick. */
  function syncHoldAccounting() {
    const now = Date.now();
    const anyone = state.holders.length > 0;
    hold = anyone ? beginHold(hold, now) : endHold(hold, now);
  }

  /** Advance the hold clock, then repaint the button and the "who is reading"
   *  line. Named for both halves because the first one is load-bearing and
   *  invisible: `tickClock` relies on this call to keep held time accruing, so a
   *  future reader who takes it for a pure repaint and moves it inside an
   *  `if (changed)` would quietly stop the freeze from advancing.
   *
   *  Deliberately cheap and independent of render(), so a press never rebuilds
   *  the chart being read. */
  function syncAndPaintHold() {
    syncHoldAccounting();
    holdBtn.classList.toggle('held', holdPressed);
    holdBtnLabel.textContent = holdPressed
      ? t('party.holdReadingYou', 'You are reading…')
      : t('party.holdToRead', 'Hold to read');
    // A countdown that silently stops looks broken, so the freeze always names
    // whose finger is on it. Others only: that you are holding is already obvious
    // from the button under your thumb.
    const others = state.holders.filter((id) => id !== state.you);
    const entry = others.length > 0 ? state.roster.find((r) => r.playerId === others[0]) : null;
    if (others.length > 0) {
      // A seat can leave mid-hold, and the server's release crosses with our
      // roster update either way round, so the name can genuinely be unknown for
      // a beat. Say "someone" rather than rendering a headless " is reading...".
      const name = entry ? entry.nickname : t('party.holdReadingSomeone', 'Someone');
      const extra = others.length - 1;
      holdWho.textContent = fmt(t('party.holdReading', '{name} is reading…'), { name })
        + (extra > 0 ? ` +${extra}` : '');
    } else {
      holdWho.textContent = '';
    }
  }

  /** Show or hide the control as the chart comes and goes. Hiding it always
   *  releases first: a button that vanishes with a press still registered would
   *  never see its own pointerup, so this device would hold the room until the
   *  phase changed. */
  function syncHoldControl(/** @type {boolean} */ visible) {
    if (!visible && holdPressed) setHoldPressed(false);
    holdReadEl.hidden = !visible;
    if (visible) syncAndPaintHold();
  }

  /** Tell the room this device is (or is no longer) holding. Idempotent locally
   *  so a pointercancel following a pointerup can't send a second release. */
  function setHoldPressed(/** @type {boolean} */ on) {
    if (holdPressed === on) return;
    // `send` drops silently when the socket isn't open, which on a press would
    // light the button up while nothing actually froze -- and leave no release to
    // send later. Better to ignore the press than to lie about it.
    if (on && !send({ type: 'hold', on: true })) return;
    holdPressed = on;
    if (!on) send({ type: 'hold', on: false });
    // Paint immediately rather than waiting for our own press to round-trip, so
    // the button responds to the finger, not to the network.
    syncAndPaintHold();
  }

  // `preventDefault` on pointerdown plus `touch-action: none` in the CSS is what
  // stops a phone treating this as a long-press (text selection / context menu)
  // instead of a hold. pointercancel and pointerleave both release: a finger that
  // slides off the button, or a gesture the browser takes over, must not leave
  // the room frozen waiting on a press this device no longer thinks is happening.
  holdBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); setHoldPressed(true); });
  for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) {
    holdBtn.addEventListener(ev, () => setHoldPressed(false));
  }
  holdBtn.addEventListener('contextmenu', (e) => e.preventDefault());

  // The host stops waiting. The room decides what that means (usually the game
  // runs again; occasionally the pause moves onto a second absentee), and the
  // answer comes back as a `paused` broadcast like any other — so nothing is
  // predicted here.
  pauseGoEl.addEventListener('click', () => send({ type: 'resume' }));

  // Esc closes a <dialog> for free, which here would let someone dismiss the
  // only explanation on screen for a game that is still frozen — and nothing
  // would bring it back until the pause changed. The card leaves when the room
  // resumes, and not before.
  pauseDialog.addEventListener('cancel', (e) => e.preventDefault());

  // ---- back into a room this device is already in ----

  const PROBE_URL_BASE = httpServerUrlFor(window.location.hostname, 'party');
  /** Sequencer for in-flight probes, so a slow answer for a room we no longer
   *  care about (a `forgetActiveRoom` from a rejected join, another paint
   *  starting a fresh probe) cannot flip the button on later. Every paint
   *  bumps this before dispatching, and only the paint that owns the top value
   *  is allowed to touch the DOM. */
  let probeSeq = 0;

  /** Show or hide the way back in, and name the room. Called on every render of
   *  the start screen, because the memory can change under us (a reject clears
   *  it; a Back out of a room leaves one behind).
   *
   *  Hides the line by default and asks the server whether the room is still
   *  worth walking back into (`flags/roomProbe.js`). A dead room silently
   *  forgets itself — offering the resume shortcut into a room whose players
   *  all gave up would land the returner alone with the old scoreboard, which
   *  reads as broken. The alive check itself lives on the server, which is the
   *  only side that knows both the last-traffic time and who is present.
   *
   *  Hiding and forgetting are driven by DIFFERENT answers, which is the whole
   *  reason the probe reports three states. Hiding is this paint's decision and
   *  the next paint undoes it; forgetting erases the only record of the code and
   *  nothing brings it back. So an `unknown` — a cold PartyKit start, a dropped
   *  request, a body we do not recognise — hides and stops there. Only the
   *  server actually saying the room is dead may erase it. Collapsing the two
   *  destroyed the way back into live rooms whenever the network hiccuped. */
  async function paintResume() {
    const entry = readActiveRoom(window.localStorage, 'party', Date.now(), isValidRoomCode);
    // Hide first. If a stale line was showing from a previous paint, we must not
    // leave it up while the probe is in flight (the room may already be gone).
    // The probe's own callback re-shows it only if the answer is alive.
    resumeBtn.hidden = true;
    if (!entry) return;
    const seq = ++probeSeq;
    const status = await probeRoomStatus(PROBE_URL_BASE + entry.code, window.fetch.bind(window));
    // A later paint (or an entirely different session) already made this
    // decision moot; do not touch the DOM.
    if (seq !== probeSeq) return;
    if (status !== 'alive') {
      if (status === 'dead') forgetActiveRoom(window.localStorage);
      return;
    }
    resumeCodeEl.textContent = entry.code;
    resumeBtn.hidden = false;
  }

  resumeGo.addEventListener('click', () => {
    const entry = readActiveRoom(window.localStorage, 'party', Date.now(), isValidRoomCode);
    // Gone stale between paint and tap (a six-hour-old row, another tab that
    // rejected out of it). Repaint rather than connect to a room we no longer
    // believe in.
    if (!entry) { paintResume(); return; }
    // Always a join: the room already exists, and `create` on an occupied code
    // is what the server rejects as a collision.
    enterRoom(entry.code, 'join', { push: true });
  });
  // Keyboard equivalent: space/enter held down repeat-fires keydown, and keyup
  // ends it — the same press-and-hold shape without a pointer.
  holdBtn.addEventListener('keydown', (e) => {
    if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); setHoldPressed(true); }
  });
  holdBtn.addEventListener('keyup', (e) => {
    if (e.key === ' ' || e.key === 'Enter') setHoldPressed(false);
  });
  // A hold is unbounded, so the ways one could get stuck are closed at source
  // rather than timed out. These two cover the screen going away with a finger
  // still down -- tab switched, phone locked, laptop closed, page navigated --
  // which is otherwise indistinguishable from someone still reading. The case
  // neither can cover (the tab dies outright, or the network drops) is handled
  // server-side, where `onClose` releases the seat.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) setHoldPressed(false);
  });
  window.addEventListener('pagehide', () => setHoldPressed(false));

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
    // A world-facts reveal draws the ranked chart, which needs its own longer
    // beat whether or not the question was swept: the ranking is the payoff of
    // the question, not a consolation for missing it.
    const chart = chartNow(mode);
    const revealSecs = atRoundBreak()
      ? revealSecondsFor(clean, chart) + ROUND_BREAK_SECONDS
      : revealSecondsFor(clean, chart);
    // The pick has no visible countdown (choosing isn't a race); its clock is the
    // long invisible anti-stall fallback that force-picks only an absent picker.
    const secs = mode === 'picking' ? PICK_TIMEOUT_SECONDS : (mode === 'reveal' ? revealSecs : QUESTION_SECONDS);
    clockTotalMs = secs * 1000;
    clockDeadline = Date.now() + clockTotalMs;
    // A fresh beat gets a fresh hold allowance. Reset here, on the token change,
    // rather than on the phase change: this is the one place that already knows a
    // genuinely new countdown has started, so a re-render mid-reveal can't hand
    // the room a second helping of reading time.
    hold = initialHold();
    holdPressed = false;
    // Rebased onto this phase's deadline. The immediate re-sync matters: a
    // question that auto-revealed while the room was frozen arrives here still
    // paused, and zeroing without re-arming would quietly let the new clock run.
    pause = initialHold();
    syncPauseAccounting();
    // Which phases paint a bar is one rule, unit-pinned in partyTiming: the
    // question, plus the chart reveal (where the bar is hold-to-read's missing
    // feedback — see `barPaints`). The short reveal and the pick stay bar-less,
    // but bar-less by going inert, not by leaving the layout, so answering does
    // not yank the prompt and the flags upward. `hidden` is cleared here in case
    // the update notice set it.
    timerEl.hidden = false;
    timerEl.classList.toggle('is-idle', !barPaints(mode, chart));
    timerEl.setAttribute('data-mode', mode);
    if (!clockInterval) clockInterval = window.setInterval(tickClock, 200);
    tickClock();
  }

  function tickClock() {
    const mode = clockMode();
    const now = Date.now();
    // Held time pushes the deadline out rather than pausing a counter, so the
    // freeze survives a tick the browser skips (a backgrounded tab, a slow
    // frame) — the clock is always derived from wall time, never accumulated.
    if (mode === 'reveal' && !holdReadEl.hidden) syncAndPaintHold();
    syncPauseAccounting();
    // Both freezes ride the same offset. A pause applies to every timed phase,
    // a hold only to the chart reveal, and they compose: the room can be paused
    // while someone is also holding the chart open.
    const held = (mode === 'reveal' ? heldNow() : 0) + pausedNow();
    // The boundary answer beat rides the SAME held offset as the reveal deadline
    // below, so the chart never disappears out from under a hold. Re-rendering
    // here (rather than from a timer callback) also means the break path gets to
    // run `syncHoldControl(false)` and put the button away.
    if (roundBreakAnswerActive && now >= roundBreakAnswerDeadline + held) {
      roundBreakAnswerActive = false;
      render();
      return;
    }
    const left = secondsLeft(clockDeadline + held, now);
    // The question and the chart reveal paint; the short reveal and the pick
    // don't (`barPaints`). Both painted phases run the held offset through the
    // fraction as well as the deadline, which is what makes a hold *stall* the
    // bar rather than let it drain under a frozen room: while a finger is down,
    // `held` grows in lockstep with `now`, so `deadline + held - now` — the
    // remaining time — holds exactly still. That stall is the only on-screen
    // proof a press landed. (`held` is zero outside the reveal.)
    if (barPaints(mode, chartNow(mode))) {
      timerFill.style.width = `${remainingFraction(clockDeadline + held, now, clockTotalMs) * 100}%`;
      // Running-out urgency belongs to answering only. The chart reveal is a
      // screen for reading, so its bar drains without ever pulsing at you.
      timerEl.classList.toggle('low', mode === 'question' && left <= 5);
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
    // The notice replaces the whole question frame, so here the bar really does
    // go — there is no layout underneath it left to preserve.
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
  /** The built-but-not-yet-played break ledger, waiting for the section to actually
   *  be on screen. `renderBreak` builds the rows synchronously (it runs ~SWAP_OUT_MS
   *  before the swapper unhides the section), but the ledger's FLIP measures row
   *  heights — a measurement that reads zero while the section is still display:none,
   *  which flattened every rank-change slide. So the params are held here and played
   *  from `onShown('break')`, the same beat the finish board starts from. */
  let breakLedgerPending = /** @type {{ nodes: HTMLElement[], rows: import('../flags/partyBreak.js').BreakRow[], splits: Array<{ base: number, speed: number, solo: number, closeness: number }>, canPass: boolean, hasPrev: boolean, token: string } | null} */ (null);
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
  // A short beat (ROUND_INTRO_SECONDS) announcing a round before its first
  // question — every round, the first pick included (its card names the host's chosen first-round
  // mode). It's a client-side hold: the question is already dealt, but we
  // show the card first
  // and only start the question + clock + veil when the beat ends — so it costs no
  // answer time, and because every client (host included) holds the same beat it
  // introduces no clock drift. `roundIntroToken` guards the once-per-round-start
  // arm against render()'s many re-runs; `roundIntroActive` is true while the
  // beat is on screen.
  let roundIntroTimer = 0;
  /** @type {string | null} */
  let roundIntroToken = null;
  let roundIntroActive = false;
  /** Wall-clock instant the beat ends; the ring drains against it. */
  let roundIntroDeadline = 0;
  let roundIntroRaf = 0;
  function armRoundIntro(/** @type {string} */ token) {
    roundIntroToken = token;
    roundIntroActive = true;
    window.clearTimeout(roundIntroTimer);
    // Arm the ring from a stopped loop and a full circle, so nothing about this
    // round's countdown depends on how the previous one ended. Without this the
    // `if (roundIntroRaf) return` guard below keys on a handle left over from the
    // last round instead of on this one: rAF doesn't fire in a hidden tab but
    // `setTimeout` does, so backgrounding the tab across a beat strands a
    // non-zero handle and the next round's ring never arms.
    stopRoundIntroRing();
    roundIntroDeadline = Date.now() + ROUND_INTRO_SECONDS * 1000;
    roundIntroTimer = window.setTimeout(() => { roundIntroActive = false; render(); }, ROUND_INTRO_SECONDS * 1000);
  }
  function resetRoundIntro() {
    window.clearTimeout(roundIntroTimer);
    roundIntroTimer = 0;
    roundIntroToken = null;
    roundIntroActive = false;
    stopRoundIntroRing();
    resetRoundBreakAnswer();
  }

  // The round card's draining ring: the same "time is running out" language as the
  // question bar (pink over the muted-soft track, `remainingFraction` off a
  // deadline), curled around the mode icon so the card says how long the beat has
  // left instead of ending without warning. Deliberately NOT a CSS animation keyed
  // on the card becoming visible: the shared section swap holds the card back ~120 ms
  // while this beat's setTimeout is already running, so an animation would finish
  // that much after the question arrives. Driving it off the same deadline the
  // timeout uses keeps the ring honest — it empties exactly when play starts.
  // A ring is a timer, not decoration, so it is not gated on reduced motion; the
  // loop is only alive for the ~2 s beat. Note this is deliberately *smoother*
  // than the question bar, which keeps its 0.2 s width transition inside a
  // `no-preference` query and so steps for a reduced-motion player: at 2 s the
  // ring would read as a stutter rather than a countdown if it stepped too, and
  // both still tell the same truth about time left. Same reason the ring runs on
  // rAF while the bar ticks on a 200 ms interval — ten visible steps is fine
  // across 20 s and wrong across 2 s.
  function startRoundIntroRing() {
    if (roundIntroRaf) return;
    // `EMPTY` is the whole circle spent; `pathLength=100` on the element makes the
    // offset plain percent, so this never has to know the circumference.
    const EMPTY = 100;
    const paint = (/** @type {number} */ off) => { roundCardRing.style.strokeDashoffset = off.toFixed(1); };
    const step = () => {
      // Paint the terminal frame on the way out. rAF stops a frame or two shy of
      // the deadline, so without this the ring visibly quits at ~99% drained and
      // the card cuts away before the circle ever closes.
      if (!roundIntroActive) { paint(EMPTY); roundIntroRaf = 0; return; }
      const p = remainingFraction(roundIntroDeadline, Date.now(), ROUND_INTRO_SECONDS * 1000);
      paint((1 - p) * EMPTY);
      roundIntroRaf = window.requestAnimationFrame(step);
    };
    // Paint frame 0 synchronously: the card mounts with a full ring rather than
    // whatever the last round left, one frame before rAF gets its turn.
    step();
  }
  function stopRoundIntroRing() {
    if (roundIntroRaf) { window.cancelAnimationFrame(roundIntroRaf); roundIntroRaf = 0; }
    roundCardRing.style.strokeDashoffset = '0';
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
  //
  // The flip is a DEADLINE the reveal clock checks, not a `setTimeout`. It was a
  // timeout, and that was a bug: a hold extends `clockDeadline` but could not
  // extend a timer already counting down, so holding on a boundary chart — every
  // 5th question — yanked the chart away to the standings at the normal beat
  // while the held seconds silently went to lengthening the break instead. One
  // clock that knows about holds cannot disagree with itself; two could, and did.
  let roundBreakAnswerDeadline = 0;
  /** @type {string | null} */
  let roundBreakToken = null;
  let roundBreakAnswerActive = false;
  function armRoundBreakAnswer(/** @type {string} */ token) {
    roundBreakToken = token;
    roundBreakAnswerActive = true;
    const clean = isCleanReveal(state.roster, state.reveal);
    roundBreakAnswerDeadline = Date.now() + revealSecondsFor(clean, chartReveal()) * 1000;
  }
  function resetRoundBreakAnswer() {
    roundBreakAnswerDeadline = 0;
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
    // Leaving the room entirely (kicked, rejected): tear down every running loop,
    // the round-intro beat included, so nothing keeps animating a screen the
    // player can no longer see.
    // `paintPause` before the early return, not after it: the card is a modal in
    // the top layer, so a screen change does not take it down. Leaving a room
    // mid-pause used to strand it over the start screen — Esc suppressed, and a
    // guest with no button on it — until a reload.
    if (!activeRoom) {
      // A break dies with the room the same way the pause card does, and for the
      // same reason: nobody is going to send this client a `break` message about
      // a game it walked out of, so a veil left up would sit over the start
      // screen with its only button wired to a socket that is gone.
      breakQueued = false;
      endCeremony();
      stopClock(); stopVeil(); resetRoundIntro(); paintPause(); paintBreak(); paintResume(); showSection('start');
      return;
    }
    // Put the hold button away by default; only the chart-reveal path below turns
    // it back on. Doing it here rather than per-branch means every screen that
    // returns early (the standings break, the round card, the pick, the final
    // board) is covered — the break was the one that wasn't, which left the
    // button live inside a hidden section with a press still registered.
    syncHoldControl(false);
    // Repainted on every render as well as on its own message, because two other
    // things move it: a `welcome` (reconnecting into a room that is already
    // paused) and a `roster` (hosting migrating onto this seat, which is what
    // decides whether the button is ours to press).
    paintPause();
    // The break's veil follows the same rule, plus one of its own: a queued break
    // is handed to the room as soon as the show reaches a beat that can take it,
    // and render() runs on every message — so the flush lands on the first reveal
    // after the press whichever way the room got there (the clock running out,
    // the last buzz landing, a seat dropping).
    paintBreak();
    // Leaving (or not yet in) the final screen re-arms the one-shot celebration —
    // and tears the ceremony down with it. Both halves matter: a Play again that
    // reaches the lobby while a beat is still armed would otherwise pull the
    // honour screen back over the lobby some seconds later.
    if (state.phase !== 'final') { finalCelebrated = false; endCeremony(); }
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
      if (action === 'blocked') { stopClock(); stopVeil(); resetRoundIntro(); showSection('question'); renderUpdateNotice(); return; }
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
          // The award arrives itemised, so the tally only adds up numbers the
          // server already attributed.
          roundTally = addQuestionToTally(roundTally, state.reveal.breakdown);
        }
      }
      // Every round opens with a title-card beat before its first question — the
      // first round included, so it doubles as the synchronized "get ready" beat
      // at game start (the host who clicked Start doesn't see the first question
      // ahead of the other seats). The question is already dealt; we hold the card
      // and start the question + clock + veil only when the beat ends, so the card
      // costs no answer time. Armed once per round-start (the token guards
      // render()'s re-runs from restarting it).
      if (state.phase === 'question' && isRoundStart(state.questionIndex, state.totalQuestions)) {
        const token = String(state.questionIndex);
        if (roundIntroToken !== token) armRoundIntro(token);
        if (roundIntroActive) { stopClock(); stopVeil(); showSection('roundcard'); renderRoundCard(); startRoundIntroRing(); return; }
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
    else if (state.phase === 'picking') {
      // Same skew guard as the question path, on the other surface a newer server
      // can reach us through: a hand card id this build can't label (a metric
      // family added since this tab loaded). Routed to the same one-shot reload
      // rather than rendering a card with no name — see `canRenderHand`.
      const handAction = questionRenderAction(canRenderHand(state.hand, KNOWN_CARD_IDS), updateReloadTried());
      if (handAction === 'reload') { markUpdateReload(); stopClock(); stopVeil(); window.location.reload(); return; }
      if (handAction === 'blocked') { stopClock(); stopVeil(); resetRoundIntro(); showSection('question'); renderUpdateNotice(); return; }
      stopVeil(); showSection('pick'); renderPick(); syncClock();
    }
    // No `showSection('final')` here any more: the finish is three screens, and
    // which of them is on stage is the ceremony's decision, not render()'s.
    // Forcing the board from here would cut every beat off at the first message
    // that happened to arrive during it.
    else if (state.phase === 'final') { stopClock(); stopVeil(); resetRoundIntro(); renderFinal(); }
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
    const inLobby = state.phase === 'lobby';
    const hostSetup = state.isHost && inLobby;
    for (const r of state.roster) {
      const isBot = /** @type {any} */ (r).bot === true;
      const chip = el('div', 'chip' + (r.present ? '' : ' away') + (isBot ? ' bot' : ''));
      chip.appendChild(buildAvatar(r.playerId));
      chip.appendChild(el('span', 'chip-name', r.nickname));
      if (isBot) {
        // The difficulty word doubles as the "this is a bot" mark; the chip's
        // `.bot` class adds the robot glyph. No score/skill leak worth hiding —
        // everyone can see who the bots are and how hard they play.
        chip.appendChild(el('span', 'chip-bot', botSkillLabel(/** @type {any} */ (r).skill)));
      }
      if (r.playerId === roomHostId) chip.appendChild(el('span', 'chip-host', t('party.host', 'host')));
      // The host can pull a bot back out while still in the lobby.
      if (isBot && hostSetup) {
        const rm = /** @type {HTMLButtonElement} */ (el('button', 'chip-remove'));
        rm.type = 'button';
        rm.textContent = '×';
        rm.setAttribute('aria-label', t('party.removeBot', 'Remove bot'));
        rm.addEventListener('click', () => send({ type: 'removeBot', botId: r.playerId }));
        chip.appendChild(rm);
      }
      playersEl.appendChild(chip);
    }
    // The empty seat closes the list; `showBotSeat` owns the three conditions.
    botSeat.hidden = !showBotSeat({
      isHost: state.isHost, inLobby, seatCount: state.roster.length,
    });
    startBtn.hidden = !hostSetup;
    // Two seats, not one. The rule and the reasoning live in `canStartGame` —
    // in short, every scoring bucket this game has is a comparison against other
    // seats, so a room of one pays out against nobody. A bot counts, and the seat
    // that adds one sits directly above this button.
    startBtn.disabled = !canStartGame({ seatCount: seatCount() });
    waitEl.hidden = !(!state.isHost && inLobby);
    // The whole setup card shows to everyone in the lobby, not just the host — the
    // length decides how long they are staying and the first round is what they
    // play first, so both are things to be told rather than surprised by.
    // `syncDraftLength` / `syncDraftFirstPick` disable the controls for guests.
    lobbySetupEl.hidden = !inLobby;
    syncDraftLength();
    syncDraftFirstPick();
    seedHostSettings();
  }

  function renderQuestion() {
    const q = state.question;
    if (!q) return;
    // Only the host can abort a game back to the settings screen (it resets the
    // whole room); guests just have Home. The adjacent `·` hides itself via CSS
    // when this button is hidden, so there's nothing else to toggle.
    // Looked up live: the dock is rebuilt on every screen change, so this is a
    // different element each time the question screen comes round.
    const backItem = dockItem('question-to-settings');
    if (backItem) backItem.hidden = !state.isHost;
    // The pill used to carry "Round 1/6 · Question 1/30". Both are gone. The
    // question total was the most alarming number on the screen and the least
    // useful — it says the show is long, not where you are — and the round
    // fraction was answering a question the round card has already answered, in
    // a beat of its own, moments earlier.
    //
    // What survives is the only thing here a player cannot get elsewhere: who
    // chose this round. That appears on the first question of a drafted round
    // and nowhere else, so the pill is usually absent entirely rather than
    // present-and-empty (an empty pill still paints its border and padding).
    const isReveal = state.phase === 'reveal' && state.reveal;
    const isMap = q.questionId === 'mapPick';
    const superCfg = superlativeMetricByQuestionId(q.questionId);
    const isSuperlative = superCfg !== null;
    const isSpot = q.questionId === 'spotFlag';
    // Decoded once per render and reused by the prompt and the reveal strips.
    // Null only when the spec names something this build can't label, which
    // `canRenderQuestion` has already routed to a reload before we get here.
    const spotClauses = isSpot ? clausesFromPrompt(q.prompt) : null;
    // Country-name questions (flag / map) show one prominent line, nothing else:
    // the tiles already say you're matching a flag or outline, so a "Which flag?"
    // cue was just extra reading. Superlative questions instead lead the criterion
    // label with the metric's icon (below) — a picture reads the stat faster than
    // the phrase alone. Reset both cues each render, then the branches opt in.
    promptEl.classList.remove('superlative', 'criteria');
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
    } else if (isSpot) {
      // Spot-the-flag states its criteria instead of naming a target, and the
      // SAME line stays up through the reveal: the criteria are what the answer
      // has to be read against, so removing them at the moment the answer lands
      // would take away the explanation just as it becomes useful.
      //
      // Rendered through `renderSpotCriteria`: the colour/motif half wears the
      // identical swatch + motif marks the findFlag / daily headers use (off the
      // same `filtersFor` object). A country rule-out clause renders as a plain
      // "not France" — NAME ONLY, NO flag thumbnail, deliberately: a flag beside it
      // would point straight at the tile to reject and defeat the recognise-the-flag
      // point of the clause (see renderSpotCriteria). The `criteria` class drops the
      // 28px target to 20px so the line stops competing with the four flags.
      promptEl.classList.add('criteria');
      const spotCountryCodes = (spotClauses || []).filter((c) => c.group === 'country').map((c) => c.value);
      promptTarget.replaceChildren(renderSpotCriteria(filtersFor(spotClauses || []), spotCountryCodes, t));
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
      const c = byCode.get(code);
      // Spot-the-flag's reveal names the clause each wrong flag missed ("not
      // green"), reusing the superlative pop strip. Without it the mode reads as
      // arbitrary even when it is provably fair: you are told you were wrong and
      // never told what you failed to notice, which is the whole lesson of the
      // round. The answer tile gets a bare name — it broke no rule.
      if (isSpot && isReveal && spotClauses && c) {
        return { name: countryName(c), value: missLabel(c, spotClauses, t) };
      }
      if (!(isSuperlative && isReveal) || !metricData) return null;
      const v = metricData.values[code];
      if (v == null) return null;
      return { name: c ? countryName(c) : code, value: formatValue(v, metricData.format) };
    };

    gridEl.innerHTML = '';
    // The world-facts REVEAL is a ranking, not four tiles. Every other reveal,
    // and the world-facts question phase itself, still draws the grid.
    const drawsChart = isReveal && !!state.reveal && chartReveal();
    gridEl.classList.toggle('as-chart', drawsChart);
    // The chart's scale, under the title. Only on the chart itself: during the
    // question no number is on screen for it to explain, and a unit hanging under
    // an unanswered "Most Olympic medals" is noise at best and a hint at worst.
    paintChartUnit(drawsChart ? metricData : null);
    // The hold control comes and goes with the chart for the same reason: there
    // is nothing to read on any other screen, and a pause button on a 0.9 s clean
    // reveal would only ever be pressed by accident.
    syncHoldControl(drawsChart);
    if (drawsChart) {
      gridEl.appendChild(buildRankChart(/** @type {any} */ (state.reveal), metricData));
    } else
    for (const code of (state.question ? state.question.options : [])) {
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
    // Every reveal gets the foot, chart or not. It was briefly suppressed here
    // as duplication, which was wrong: the chart says WHAT the ranking was and
    // which row you landed on, but only the foot says who was fastest, who was
    // the only one, and that nobody knew it. That is per-PLAYER information the
    // ranking structurally cannot carry, and it is what every other question
    // type shows after an answer.
    if (isReveal) renderRevealFoot();
  }

  /**
   * @param {string} code
   * @param {{ isMap: boolean, selectable: boolean, selected: boolean, correct: boolean, wrong: boolean, dim: boolean, pickers: string[], pop?: { name: string, value: string } | null, veil?: boolean, named?: boolean }} opts
   */
  /**
   * True when the current reveal should draw the ranked chart instead of tiles.
   * Gated on the server having actually sent a ranking, so a client running
   * against an older PartyKit build falls back to the tile reveal rather than
   * rendering an empty chart (see memory `project_party_stale_client_skew`).
   */
  /** Whether the beat now on screen is a chart reveal — the one input `barPaints`
   *  needs beyond the mode. Both clock functions ask through here rather than each
   *  re-deriving it, so the bar cannot paint on one tick and not the next because
   *  two copies of the same expression drifted apart.
   *  @param {string} mode @returns {boolean} */
  function chartNow(mode) {
    return mode === 'reveal' && chartReveal();
  }

  function chartReveal() {
    return !!(state.phase === 'reveal' && state.reveal
      && Array.isArray(state.reveal.ranking) && state.reveal.ranking.length > 0);
  }

  /** Paint (or hide) the chart's scale line. The line itself is assembled by
   *  `chartUnitLine` in flags/partyChart.js, where it is unit-tested; this is
   *  only the DOM half.
   *  @param {{ key: string, year: number | null } | null} metricData
   *    null on any screen that isn't a chart reveal, which hides the line. */
  function paintChartUnit(metricData) {
    const line = chartUnitLine(metricData, t);
    promptUnit.textContent = line;
    promptUnit.hidden = line === '';
  }

  /**
   * The world-facts reveal: the four options as a ranked bar chart, best first,
   * each row carrying who picked it and what that pick paid.
   *
   * This REPLACES the tile grid rather than sitting under it. The question asked
   * how four countries compare, and four tiles in their dealt order cannot answer
   * that — the numbers sat in whatever order the options happened to be shuffled
   * into. Sorted rows are the answer to the question actually asked.
   *
   * Nothing highlights the winner: the ranking already says who won by putting it
   * on top. The only outlined row is YOURS — correct-green if you got it,
   * wrong-red if you didn't — because how you did is the one thing a ranking
   * cannot show.
   *
   * @param {{ ranking: string[], values?: Record<string, number> | null,
   *   picks: Record<string, string> }} reveal
   * @param {{ format?: string } | null} metricData  formatting only. The VALUES come
   *   from the reveal, so the chart cannot disagree with what the server scored.
   */
  function buildRankChart(reveal, metricData) {
    const chart = el('div', 'rank-chart');
    const ranking = reveal.ranking;
    const values = reveal.values || {};
    // Bar geometry lives in `flags/partyChart.js` — pure, and tested for the
    // cases that fail silently here (a negative metric, identical values, a
    // missing value). See barFractions.
    const fracs = barFractions(ranking, values);
    // Every column is a fixed width so the four rows share one vertical grid and
    // the values line up (see index.css). The rail is the one track that can't be
    // a constant — it holds one avatar per player who picked that row — so its
    // width is stamped once here, from the BUSIEST row, rather than left to each
    // row's own content. Sized like the CSS stacks them: 22px each, overlapping
    // by 6px after the first.
    chart.style.setProperty('--rail-w', String(railWidthPx(ranking, reveal.picks)) + 'px');
    ranking.forEach((code, rank) => {
      const row = el('div', 'rank-row');
      row.style.setProperty('--d', String(rank * 110) + 'ms');
      if (reveal.picks[state.you] === code) {
        row.classList.add(rank === 0 ? 'you-right' : 'you-wrong');
      }
      row.appendChild(el('span', 'rank-pos', '#' + String(rank + 1)));
      const fl = el('span', 'rank-flag');
      const img = document.createElement('img');
      img.src = '../flags/svg/' + code + '.svg';
      img.alt = '';
      fl.appendChild(img);
      row.appendChild(fl);
      // Name over bar in the flexible column; the VALUE is its own fixed column
      // beside it, not a caption sharing the name's baseline. It is the answer to
      // the question the round asked, and as a 12px muted tail on the name it
      // read as an annotation and sat at a different x on every row.
      const body = el('span', 'rank-body');
      const c = byCode.get(code);
      body.appendChild(el('span', 'rank-name', c ? countryName(c) : code));
      const track = el('span', 'rank-track');
      const fill = document.createElement('i');
      track.appendChild(fill);
      body.appendChild(track);
      row.appendChild(body);
      const v = values[code];
      row.appendChild(el('span', 'rank-val',
        typeof v === 'number' && metricData ? formatValue(v, metricData.format) : ''));
      const rail = el('span', 'rank-rail');
      /** @type {string[]} */
      const rowPickers = [];
      for (const [pid, choice] of Object.entries(reveal.picks)) {
        if (choice === code) rowPickers.push(pid);
      }
      // Capped, or one popular country would size the rail for the whole chart
      // and squeeze the country name on every row — see `railWidthPx`, which
      // measures through the same split.
      appendPickers(rail, rowPickers);
      row.appendChild(rail);
      // Everyone on a row scores the same, because closeness is rank-based. So the
      // row states its price once rather than a number per avatar, and the chart
      // doubles as the scoring key — after two questions nobody needs the rules
      // explained. This is the one thing that would NOT work under value-based
      // closeness, where two players on a row could score differently.
      const pts = CLOSENESS_LADDER[rank] || 0;
      const ptsEl = el('span', 'rank-pts', pts > 0 ? '+' + String(pts) : '0');
      if (rail.childElementCount) ptsEl.classList.add('live');
      row.appendChild(ptsEl);
      chart.appendChild(row);
      // Next frame, so the width transition has a 0 -> n to animate instead of
      // painting its final value immediately.
      requestAnimationFrame(() => {
        fill.style.width = String(fracs[rank] * 100) + '%';
      });
    });
    return chart;
  }


  /**
   * Fill a pick row — a tile's `.picks` or a chart row's `.rank-rail` — with at
   * most `PICK_AVATAR_CAP` faces, then a `+N` marker for everyone else.
   *
   * One helper for both surfaces: the cap is a single rule
   * (`flags/pickAvatars.js`) and the two rows differ only in the CSS that sizes
   * them. Two copies is how one of them would quietly stop being capped.
   *
   * @param {HTMLElement} host  an empty `.picks` / `.rank-rail`
   * @param {string[]} pickerIds  playerIds in buzz order, so the faces kept are
   *   the players who got there first
   */
  function appendPickers(host, pickerIds) {
    const { shown, overflow } = capPickers(pickerIds);
    for (const pid of shown) host.appendChild(buildAvatar(pid));
    if (!overflow) return;
    const more = el('span', 'more', '+' + String(overflow));
    // The marker is a count, not decoration, so it reads as words to a screen
    // reader rather than as a bare "+11".
    const label = fmt(t('party.morePickers', '{n} more'), { n: String(overflow) });
    more.title = label;
    more.setAttribute('aria-label', label);
    host.appendChild(more);
  }

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
      appendPickers(p, opts.pickers);
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
    // Every round is announced the same way, the last one included — it is an
    // ordinary rotation pick, so "round N of N" is the whole story.
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
        const label = el('span', 'pick-card-label', modeLabel(modeId));
        // A family card names its range on a second line (see MODE_LABELS). Only
        // families have one, so every other card is untouched.
        const sub = modeSubLabel(modeId);
        if (sub) label.appendChild(el('span', 'pick-card-sub', t(sub.key, sub.fallback)));
        card.appendChild(label);
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
      pickWatch.appendChild(el('p', 'pick-watch-name',
        fmt(t('party.isChoosing', '{name} is choosing…'), { name: pickerName })));
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
   *  first round included — it doubles as the game's "get ready" beat), naming
   *  the round number, its mode (icon + full label, metric hue on the icon),
   *  "5 questions", who picked it (draft), and the double-points stakes on the final
   *  round. Paints in `#pt-roundcard`; the question follows when the beat elapses
   *  (see `render` / `armRoundIntro`). A big-card counterpart to the question pill's
   *  "Zosia's pick" attribution — the deferred "full title card" from PARTY.md. */
  function renderRoundCard() {
    const totalRounds = Math.max(1, Math.ceil(state.totalQuestions / ROUND_QUESTIONS));
    const roundNum = roundIndexAt(state.questionIndex) + 1;
    // Dots, not "Round 3 of 6": the shape of the game reads at a glance and the
    // card opens on its artwork instead of a sentence. Every round is a pip row,
    // the last one included — it is an ordinary round now, not a named closing act.
    //
    // The dots are decoration to a screen reader, so the sentence they replace
    // rides along as the container's label. That is why `party.roundCardCount`
    // is still here despite nothing rendering it as text.
    roundCardCount.textContent = '';
    roundCardCount.classList.add('is-pips');
    roundCardCount.setAttribute('aria-label',
      fmt(t('party.roundCardCount', 'Round {n} of {total}'), { n: roundNum, total: totalRounds }));
    for (const state of roundPipStates(roundNum, totalRounds)) {
      const pip = el('span', 'roundcard-pip' + (state ? ` ${state}` : ''));
      pip.setAttribute('aria-hidden', 'true');
      roundCardCount.appendChild(pip);
    }

    const modeId = roundModeId(state.lastPick, state.question ? state.question.questionId : undefined);
    if (modeId) {
      roundCardIc.innerHTML = roundCardIconHtml(modeId);
      roundCardIc.style.setProperty('--mc', modeHue(modeId) || 'currentColor');
      // Short name for the picture decks (Flags / Weird / Spot / Maps), the full
      // name for metric rounds (which have no short). `modeLabel` picks the right
      // one — so the round card names a round the SAME way as the lobby's
      // first-round row and the draft pick card, instead of the old colon form
      // ("Flags: countries").
      roundCardName.textContent = modeLabel(modeId);
    } else {
      // Only reached when the pool is genuinely unknowable — a flag round whose pick
      // attribution is missing (a mid-round reconnect). Announce generically.
      roundCardIc.innerHTML = deckIconHtml('flags', { className: 'roundcard-thumb' });
      roundCardIc.style.setProperty('--mc', 'currentColor');
      roundCardName.textContent = t('party.modeShort.flagsAll', 'Flags');
    }

    // Draft: name who chose this round. Now the only place it is said — the
    // question screen's pill used to repeat it moments later.
    roundCardPick.innerHTML = '';
    const pickSeat = state.lastPick ? state.roster.find((r) => r.playerId === state.lastPick?.picker) : null;
    roundCardPick.hidden = !pickSeat;
    if (pickSeat) {
      roundCardPick.appendChild(buildAvatar(pickSeat.playerId));
      roundCardPick.appendChild(el('span', 'roundcard-pick-name', fmt(t('party.roundPick', "{name}'s pick"), { name: pickSeat.nickname })));
    }
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

    const board = state.scoreboard || [];
    // No previous break means the first round of the game: the ledger opens
    // alphabetically rather than in final order (see `breakOpeningOrder`).
    const hasPrev = Array.isArray(prevBreakBoard) && prevBreakBoard.length > 0;
    const { rows, mvp } = roundBreak(prevBreakBoard, board);

    // MVP banner — hidden when nobody scored in the round. Built now but held
    // invisible (no `.in`) until the bucket passes settle; playLedger reveals it.
    const mvpRow = mvp ? rows.find((r) => r.playerId === mvp) : null;
    breakMvp.innerHTML = '';
    breakMvp.hidden = !mvpRow;
    breakMvp.classList.remove('in');
    if (mvpRow) {
      // No avatar here — the MVP line is a caption ("Best of the round · Ada
      // +8"), not a roster row, and the mock draws it text-only.
      const txt = el('span', 'break-mvp-text');
      txt.append(document.createTextNode(`${t('party.roundMvp', 'Best of the round')} · `), el('span', 'break-mvp-name', mvpRow.nickname));
      breakMvp.appendChild(txt);
      breakMvp.appendChild(el('span', 'break-mvp-gain', `+${mvpRow.roundGain}`));
    }

    breakStandingsLabel.textContent = t('party.standings', 'Standings');

    // Fresh break: clear any leftover pass banner from the previous one.
    breakPass.className = 'break-pass';
    breakPass.textContent = '';

    breakBoard.innerHTML = '';
    /** @type {HTMLElement[]} the row node per `rows` entry, for the slide animation */
    const rowNodes = [];
    /** @type {boolean[]} does row i's itemised split add up to its round total? */
    const rowReconciles = [];
    /** @type {Array<{ base: number, speed: number, solo: number, closeness: number }>} per-row round split */
    const rowSplits = [];
    rows.forEach((r, i) => {
      const you = r.playerId === state.you;
      const row = el('div', 'scoreline' + (you ? ' you' : ' other'));
      row.appendChild(el('span', 'rank', String(i + 1)));
      row.appendChild(buildAvatar(r.playerId));
      row.appendChild(el('span', 'nm', r.nickname));
      // Tight single-line row: rank · avatar · name · total, nothing reserved for a
      // gain chip. The round's gain isn't a persistent chip; each bucket flies into
      // the total during the ledger (see `playLedger`), so the settled board rests
      // on totals and even a long nickname keeps the whole line. Rank movement is
      // the row sliding to its new place, so there's no ▲/▼ arrow either.
      row.appendChild(el('span', 'sc', String(r.score)));
      // The per-bucket split drives the fly-in. It "reconciles" when its buckets add
      // up to the round total; only then can we attribute the gain bucket by bucket.
      // A mid-round join / reconnect that missed questions won't reconcile — that
      // row counts up in one go instead (see `playLedger`'s fallback).
      const split = roundTally[r.playerId] || { base: 0, speed: 0, solo: 0, closeness: 0 };
      rowReconciles.push(r.roundGain > 0 && split.base + split.speed + split.solo + split.closeness === r.roundGain);
      rowSplits.push(split);
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
    // number it stamps is what its own deferred steps check before painting. The
    // bucket-pass path needs every scoring row's split to reconcile; if any is
    // best-effort, the whole break counts up in one go instead (see playLedger).
    const canPass = rows.every((r, i) => r.roundGain === 0 || rowReconciles[i]);
    breakSeq += 1;
    breakAnimToken = String(breakSeq);
    // Hold the ledger until the section is on screen — measuring row heights while
    // it is still display:none gives a zero stride and no rank-change slide. Runs
    // now only if the break is already shown (a reconnect re-entering it); otherwise
    // `onShown('break')` plays it. See `breakLedgerPending`.
    breakLedgerPending = { nodes: rowNodes, rows, splits: rowSplits, canPass, hasPrev, token: breakAnimToken };
    if (swapper.shown === 'break') startBreakLedger();
  }

  /** Play the break's ledger once, now that the section is actually visible.
   *  Called from `onShown('break')` (the normal path) or immediately when the break
   *  is already on screen. Idempotent: consuming the pending params stops a repeat. */
  function startBreakLedger() {
    const p = breakLedgerPending;
    if (!p) return;
    breakLedgerPending = null;
    playLedger(p.nodes, p.rows, p.splits, p.canPass, p.hasPrev, p.token);
  }

  /**
   * Play the break's standings as a **ledger** — told in the order the round
   * actually happened rather than handing over a finished ranking. The board
   * arrives at last break's totals (seated in last break's order — or, on the
   * first break of the game, alphabetically, since there is no prior standing to
   * open from), holds a beat, then climbs one SCORING BUCKET at a time — a
   * "Correct" pass banks everyone's
   * base, then "Speed", then "Only one" / "Close" — re-ranking after each. An
   * overtake driven by speed happens ON the speed pass, in front of you: the
   * board narrates *why* it moved, and every bucket earns a labelled beat so a
   * player can read what the points were made of. The MVP line fades in last.
   *
   * The seating is a FLIP: the DOM holds the rows in FINAL order, and an inline
   * `translateY` offsets each to its CURRENT slot; releasing the transition slides
   * it home. One measured stride (row + gap) converts a slot delta to pixels.
   *
   * `canPass` is false when any scoring row's split didn't reconcile (a mid-round
   * join / reconnect): there's no trustworthy per-bucket breakdown, so we fall back
   * to counting every score up at once — the old ledger, kept for exactly this.
   *
   * Pure decoration — the final scores and positions are already correct in the DOM
   * before this runs, so `prefers-reduced-motion` skips straight to them. The
   * `token` is the break's identity: every deferred step re-checks it, so a break
   * that ends early (a fast host clock, a reconnect) can't paint over the next screen.
   *
   * @param {HTMLElement[]} nodes  row node per `rows` entry, in FINAL rank order
   * @param {import('../flags/partyBreak.js').BreakRow[]} rows
   * @param {Array<{ base: number, speed: number, solo: number, closeness: number }>} splits  per-row round split
   * @param {boolean} canPass  every scoring row's split reconciles → run bucket passes
   * @param {boolean} hasPrev  is there a previous break to open in the order of? (false = first round → open alphabetically)
   * @param {string} token  this break's identity; see above
   */
  function playLedger(nodes, rows, splits, canPass, hasPrev, token) {
    const scores = nodes.map((n) => /** @type {HTMLElement} */ (n.querySelector('.sc')));
    const revealMvp = () => { if (!breakMvp.hidden) breakMvp.classList.add('in'); };
    const passLabel = (/** @type {string} */ kind) => (kind === 'base' ? t('party.passCorrect', 'Correct')
      : kind === 'speed' ? t('party.passSpeed', 'Speed')
        : kind === 'solo' ? t('party.soleSurvivor', 'Only one')
          : t('party.passClose', 'Close'));

    if (prefersReducedMotion()) {
      // No motion: land straight on the settled totals. The gain fly-in is pure
      // decoration (the totals are already correct in the DOM), so nothing to play.
      rows.forEach((r, i) => { scores[i].textContent = String(r.score); });
      revealMvp();
      return;
    }

    // Beat 1: rows fade in showing where everyone stood before the round. Fading
    // only — the seat offsets below own `transform`, and an entrance that animated
    // it would erase them (see `scoreline-fade-in`).
    rows.forEach((r, i) => {
      scores[i].textContent = String(r.prevScore);
      nodes[i].classList.add('enter-fade');
      nodes[i].style.setProperty('--enter-delay', `${(rows.length - 1 - i) * LEDGER_ENTER_STAGGER_MS}ms`);
    });
    const stride = nodes.length > 1 ? nodes[1].offsetTop - nodes[0].offsetTop : 0;

    // Running score per FINAL index, and the slot each row currently occupies.
    const running = rows.map((r) => r.prevScore);
    const curSlot = new Array(rows.length).fill(-1);
    // Order the final-indices by current running score (stable on ties by final
    // index, so the settled order matches `rows`). Returns slot → final-index.
    const orderNow = () => rows.map((_, i) => i).sort((a, b) => running[b] - running[a] || a - b);
    // Seat every row at `order`, sliding over `slideMs` (0 = snap). A row rising to
    // a smaller slot rides above the one it passes.
    const seat = (/** @type {number[]} */ order, /** @type {number} */ slideMs) => {
      order.forEach((fi, slot) => {
        const rose = curSlot[fi] >= 0 && slot < curSlot[fi];
        nodes[fi].style.transition = slideMs > 0 ? `transform ${slideMs}ms cubic-bezier(0.22, 0.61, 0.36, 1)` : 'none';
        nodes[fi].style.transform = slot === fi ? '' : `translateY(${(slot - fi) * stride}px)`;
        nodes[fi].style.zIndex = curSlot[fi] >= 0 && slot !== curSlot[fi] ? (rose ? '2' : '1') : '';
        const rank = /** @type {HTMLElement} */ (nodes[fi].querySelector('.rank'));
        if (rank) rank.textContent = String(slot + 1);
        curSlot[fi] = slot;
      });
    };
    // Open in last break's order (prevScore descending, which `orderNow` gives
    // since running === prevScore here); the first break has no prior standing, so
    // it opens alphabetically instead — see `breakOpeningOrder`.
    seat(breakOpeningOrder(rows, hasPrev), 0);
    void breakBoard.offsetHeight; // commit the start positions before releasing

    const stillOurs = () => breakAnimToken === token;

    if (!canPass) {
      // Fallback: no trustworthy split, so count every score up in one go and slide
      // once — no per-bucket fly-in, just the totals.
      const { countAt, slideAt } = ledgerSchedule(rows.length);
      window.setTimeout(() => {
        if (!stillOurs()) return;
        rows.forEach((r, i) => { countUp(scores[i], r.prevScore, r.score, LEDGER_COUNT_MS, 0, () => !stillOurs()); running[i] = r.score; });
      }, countAt);
      window.setTimeout(() => { if (!stillOurs()) return; seat(orderNow(), LEDGER_SLIDE_MS); revealMvp(); }, slideAt);
      return;
    }

    // A gain flies in: a chip pops just left of the total, holds, then merges into
    // the score as it counts. Overlay only (absolute, reserves no row width), so a
    // long nickname keeps the whole line. Transient by design — the settled board
    // rests on totals; the pass banner + the fly are the beat it's read.
    const FLY_HOLD_MS = 360;
    const flyGain = (/** @type {number} */ i, /** @type {string} */ kind, /** @type {number} */ value) => {
      const chip = el('span', `fchip ${kind} enter`, `${CHIP_ICON[kind]} +${value}`);
      chip.setAttribute('aria-label', `${value} ${passLabel(kind)}`);
      nodes[i].appendChild(chip);
      const from = running[i];
      running[i] = from + value;
      window.setTimeout(() => {
        if (!stillOurs()) { chip.remove(); return; }
        chip.classList.remove('enter');
        chip.classList.add('fly'); // CSS carries the merge transform + fade
        countUp(scores[i], from, running[i], LEDGER_PASS_COUNT_MS - FLY_HOLD_MS, 0, () => !stillOurs());
        scores[i].classList.remove('bump'); void scores[i].offsetWidth; scores[i].classList.add('bump');
        window.setTimeout(() => chip.remove(), LEDGER_PASS_COUNT_MS - FLY_HOLD_MS + 140);
      }, FLY_HOLD_MS);
    };

    // One beat per bucket anyone earned, in CHIP_ORDER. Each pass names the bucket
    // (the pill inline with "Standings"), flies each earner's chip into their total,
    // then (after a settle) re-ranks. Absolute offsets off the tested schedule so
    // the ordering itself is under test.
    const active = CHIP_ORDER.filter((k) => splits.some((s) => (s[k] || 0) > 0));
    const sched = passLedgerSchedule(rows.length, active.length);
    active.forEach((kind, p) => {
      const { countAt, slideAt } = sched.steps[p];
      window.setTimeout(() => {
        if (!stillOurs()) return;
        breakPass.className = `break-pass in ${kind}`;
        breakPass.textContent = `${CHIP_ICON[kind]}  ${passLabel(kind)}`;
        rows.forEach((r, i) => { const add = splits[i][kind] || 0; if (add > 0) flyGain(i, kind, add); });
      }, countAt);
      window.setTimeout(() => { if (!stillOurs()) return; seat(orderNow(), LEDGER_PASS_SLIDE_MS); }, slideAt);
    });

    // Last: clear the banner and bring in the round's verdict.
    window.setTimeout(() => {
      if (!stillOurs()) return;
      breakPass.className = 'break-pass';
      breakPass.textContent = '';
      revealMvp();
    }, sched.settleAt);
  }


  function renderRevealFoot() {
    const list = el('div', 'toast-list');
    const points = (state.reveal && state.reveal.points) || {};
    const breakdown = (state.reveal && state.reveal.breakdown) || {};
    // The question beat everyone: name it. No points move, but a shared groan is
    // the moment, and silence made a question nobody got look identical to one
    // everybody got wrong on their own.
    if (isBlankReveal(state.roster, state.reveal)) {
      footEl.appendChild(el('p', 'nobody-knew', t('party.nobodyKnew', 'Nobody knew that one')));
    }
    // Ordered by THIS question's points, biggest first — the reveal is "who nailed
    // this one", not the running standings (which the break screen is for). The
    // server sends the board by cumulative total, so re-sort here (see `revealOrder`).
    for (const entry of revealOrder(state.scoreboard, points)) {
      const pts = points[entry.playerId] || 0;
      const toast = el('div', 'toast');
      toast.appendChild(buildAvatar(entry.playerId));
      toast.appendChild(el('span', 'toast-name', entry.nickname));
      // Badges read off the itemised award. "Fastest" goes through
      // `wasFastest` rather than `speed > 0`: the speed bonus now pays every
      // correct seat, so `> 0` would tag the whole field as Fastest. The award
      // carries an explicit `fastest` flag set on exactly the race winner. A sole
      // survivor shows "Only one" without "Fastest" -- with nobody to race,
      // `fastest` is false.
      const award = breakdown[entry.playerId];
      if (wasFastest(award)) toast.appendChild(el('span', 'fast', `⚡ ${t('party.fastest', 'Fastest')}`));
      if (award && award.solo > 0) toast.appendChild(el('span', 'solo', `★ ${t('party.soleSurvivor', 'Only one')}`));
      toast.appendChild(el('span', 'pts' + (pts === 0 ? ' zero' : ''), `+${pts}`));
      list.appendChild(toast);
    }
    footEl.appendChild(list);
    // No "Next question" button and no countdown: the question advances on its own
    // after a short beat (the host's clock sends 'next'), so the reveal just
    // shows who scored and moves on.
  }

  // ---- the finish, as a ceremony ----
  // Three beats: the honours one screen at a time, then the winner's own screen,
  // then the board with the winner's card continued as its header.
  //
  // The order is deliberate and must not be "improved" by showing the winner
  // first. Once the result is known the room stops watching -- people talk, reach
  // for phones, argue about the last question -- so anything after the result
  // gets talked over, which is why award ceremonies run the minor categories
  // first. While the result is still unknown, every honour is live information
  // about someone who might have won; after the board the same line is a rosette
  // handed to a loser.

  /** The ceremony's epoch, and the timers it is running.
   *
   *  Every step is scheduled against an ABSOLUTE offset from this epoch and the
   *  delay is recomputed against `Date.now()` when the step is armed. A throttled
   *  tab therefore loses smoothness but never position -- a step whose moment has
   *  already passed fires at once instead of shifting everything after it, which
   *  is what an accumulated counter would do. */
  let ceremonyEpoch = 0;
  /** @type {number[]} */
  let ceremonyTimers = [];
  /** Which screen the ceremony wants on stage. Non-null for as long as it owns
   *  the finish, so a re-render mid-ceremony (a roster message, a language
   *  switch) repaints the beat that is up rather than dragging the board over it. */
  let ceremonyScreen = /** @type {'honour' | 'winner' | 'final' | null} */ (null);
  /** The honours this finish is cycling, kept for the board's strip. */
  let ceremonyHonours = /** @type {any[]} */ ([]);
  /** The strip's cycle on the board. Separate from the beats above because it
   *  keeps running long after the ceremony is "over" -- the board is a screen
   *  people sit on. */
  let honourStripTimer = 0;
  /** Whether this finish's burst has already gone off. `finalCelebrated` cannot
   *  answer this: it means "the finish has been rendered once", and it is set the
   *  moment the ceremony STARTS -- some nine seconds before the burst is due. A
   *  player who skips in that window would otherwise get no burst at all, which
   *  is the one thing the ending owes everybody. */
  let celebrationDone = false;

  /** How long the winner's score takes to climb, and when it starts. Local to
   *  this beat rather than in partyTiming: they are inside one screen's own
   *  choreography, where partyTiming's schedule is about the ORDER of the beats,
   *  which is the thing that regresses. */
  const WINNER_COUNT_MS = 900;
  const WINNER_COUNT_AT_MS = 420;
  /** The crown lands after the number has stopped: the score is the fact and the
   *  crown is the verdict, so arriving together would make one of them noise. */
  const WINNER_CROWN_AT_MS = 1100;

  /** Glyphs are part of the title, not decoration: each honour is recognisable
   *  from across a table before its label has been read. */
  const HONOUR_GLYPHS = { fastest: '⚡', bestRound: '✓', thoughtful: '⏳' };

  function stopCeremony() {
    for (const h of ceremonyTimers) window.clearTimeout(h);
    ceremonyTimers = [];
  }

  /** Tear the whole finish down: the beats, the strip's cycle, and the claim on
   *  the screen. Called when the room leaves `final` — a Play again, a Back to
   *  settings, or leaving the room entirely. Without this, an armed beat fires
   *  seconds later and pulls an honour screen back over the lobby. */
  function endCeremony() {
    stopCeremony();
    if (honourStripTimer) { window.clearInterval(honourStripTimer); honourStripTimer = 0; }
    ceremonyScreen = null;
    ceremonyHonours = [];
    // Re-armed with the rest of it, so a Play again gets a fresh burst — the same
    // rule `finalCelebrated` follows one line up in render().
    celebrationDone = false;
  }

  /** Arm one ceremony step at an absolute offset from the epoch. */
  function atCeremony(/** @type {number} */ offsetMs, /** @type {() => void} */ fn) {
    ceremonyTimers.push(window.setTimeout(fn, Math.max(0, ceremonyEpoch + offsetMs - Date.now())));
  }

  /** @param {any} h */
  function honourTitle(h) {
    if (h.id === 'fastest') return t('party.honourFastest', 'Fastest hand');
    if (h.id === 'bestRound') {
      // Named by the round's MODE ("Best in Flags"), which is what makes the
      // title say something the leaderboard does not. A round whose mode we
      // cannot name (an eviction lost it) falls back to the plain wording rather
      // than rendering the placeholder.
      const name = h.modeId ? modeLabel(h.modeId) : null;
      return name
        ? fmt(t('party.honourBestRound', 'Best in {round}'), { round: name })
        : t('party.honourBestRoundPlain', 'Best round');
    }
    return t('party.honourThoughtful', 'Thoughtful answers');
  }

  /** @param {any} h */
  function honourValueText(h) {
    if (h.id === 'fastest') {
      const lang = document.documentElement.lang || 'en';
      const seconds = (h.value / 1000).toLocaleString(lang, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
      return fmt(t('party.honourFastestValue', '{seconds} s on average'), { seconds });
    }
    if (h.id === 'bestRound') return fmt(t('party.honourBestRoundValue', '+{points} points'), { points: h.value });
    return fmt(t('party.honourThoughtfulValue', 'last click, {correct} of {total} right'),
      { correct: h.value, total: h.outOf ?? h.value });
  }

  /** Paint one honour beat. The body is rebuilt rather than mutated so the glyph
   *  stamp and the avatar's halo pulses restart -- see the note in index.html.
   *  Inside the beat the parts arrive in order (glyph, what it was for, avatar,
   *  name, the number) so there is something to follow rather than a card
   *  appearing whole.
   *  @param {any} h @param {number} index @param {number} total */
  function paintHonourBeat(h, index, total) {
    honourBody.innerHTML = '';
    honourBody.appendChild(el('span', 'honour-glyph', HONOUR_GLYPHS[h.id] ?? ''));
    honourBody.appendChild(el('span', 'honour-label', honourTitle(h)));
    const av = el('span', 'honour-av');
    av.appendChild(buildAvatar(h.playerId));
    honourBody.appendChild(av);
    honourBody.appendChild(el('span', 'honour-name', h.nickname || ''));
    honourBody.appendChild(el('span', 'honour-value', honourValueText(h)));
    honourDots.innerHTML = '';
    for (let i = 0; i < total; i += 1) honourDots.appendChild(el('i', i === index ? 'on' : undefined));
  }

  /** @param {any} winner  the scoreboard row that won, or null on a tie / a board
   *   nobody scored on. */
  function paintWinnerBeat(winner) {
    winnerAv.innerHTML = '';
    winnerCrown.hidden = true;
    winnerCrown.classList.remove('land');
    if (!winner) {
      // A tie has no winner to crown. The beat still runs -- the shape of the
      // ending must not change at the one moment it is most surprising -- but it
      // carries the tie caption instead of a name and a number.
      winnerName.textContent = t('party.tie', "It's a tie!");
      winnerScore.textContent = '';
      return;
    }
    winnerAv.appendChild(buildAvatar(winner.playerId));
    winnerName.textContent = winner.nickname;
    // The DOM shows 0 before the timer starts -- never a flash of the final value
    // -- and the count begins a beat in, so the number moves where the eye has
    // already landed.
    winnerScore.textContent = '0';
    // Abandoned if the beat is skipped out from under it, so a count does not go
    // on ticking against a hidden screen after the board has arrived.
    countUp(winnerScore, 0, winner.score, WINNER_COUNT_MS, WINNER_COUNT_AT_MS,
      () => ceremonyScreen !== 'winner');
    ceremonyTimers.push(window.setTimeout(() => {
      winnerCrown.textContent = t('party.honourWinner', '♛ Winner');
      winnerCrown.hidden = false;
      winnerCrown.classList.add('land');
    }, WINNER_CROWN_AT_MS));
  }

  /** Fire the finish burst, once per finish, whichever route the ending took.
   *  @param {any[]} board */
  function celebrate(board) {
    if (celebrationDone) return;
    celebrationDone = true;
    runCelebration(pickPartyCelebration({ scoreboard: board, you: state.you }));
  }

  /** Run the whole ceremony from now. Called once per finish. */
  function playCeremony(/** @type {any[]} */ honours, /** @type {any} */ winner, /** @type {any[]} */ board) {
    stopCeremony();
    ceremonyHonours = honours;
    ceremonyEpoch = Date.now();
    // Claimed SYNCHRONOUSLY, before a single timer is armed. The first beat is
    // scheduled at offset 0, but a `setTimeout(fn, 0)` still yields — and a
    // message landing in that gap would find `ceremonyScreen` null with
    // `finalCelebrated` already true, take the no-animation path, and paint the
    // board over a ceremony that was about to start. A few milliseconds wide,
    // and the sort of thing that only ever reproduces in front of someone.
    ceremonyScreen = honours.length > 0 ? 'honour' : 'winner';
    const schedule = honoursSchedule(honours.length);

    honours.forEach((h, i) => {
      atCeremony(schedule.beats[i].inAt, () => {
        ceremonyScreen = 'honour';
        paintHonourBeat(h, i, honours.length);
        sections.honour.classList.remove('beat-out');
        sections.honour.classList.add('beat-in');
        showSection('honour');
      });
      // Energy at the EDGES of the beat, never in the middle: a fast deal in, a
      // long still middle to read it in, a fast leave. A slow symmetric fade
      // reads as a bad connection rather than a ceremony.
      atCeremony(schedule.beats[i].outAt, () => {
        sections.honour.classList.remove('beat-in');
        sections.honour.classList.add('beat-out');
      });
    });

    atCeremony(schedule.winnerAt, () => {
      ceremonyScreen = 'winner';
      sections.winner.classList.remove('beat-in');
      void sections.winner.offsetWidth;
      sections.winner.classList.add('beat-in');
      paintWinnerBeat(winner);
      showSection('winner');
    });
    // The burst belongs to the winner's arrival, not to the board: it punctuates
    // the moment the result is given rather than covering rows still landing.
    atCeremony(schedule.winnerAt + FINAL_CELEBRATION_OFFSET_MS, () => celebrate(board));
    atCeremony(schedule.boardAt, () => {
      ceremonyScreen = 'final';
      renderBoard(board, winner, true);
      showSection('final');
    });
  }

  /**
   * The board: winner header, honours strip, then the ranked rows starting at 2.
   *
   * The header and the strip are SIBLINGS of the scrolling list, never inside it.
   * If they scrolled away the whole structure would lose its point -- the result
   * is meant to stay visible however far down the list you go, and an honoured
   * seat is meant to keep its mention when its own row scrolls out of view.
   *
   * @param {any[]} board
   * @param {any} winner  null on a tie, or on a board nobody scored on
   * @param {boolean} animate
   */
  function renderBoard(board, winner, animate) {
    const tie = !winner && board.length > 1;
    // No heading on this screen: the winner card IS the heading now. The caption
    // survives only for the tie, where there is no card to carry the message.
    finalSub.textContent = tie ? t('party.tie', "It's a tie!") : '';
    finalSub.hidden = !tie;

    finalWinner.hidden = !winner;
    finalWinner.innerHTML = '';
    if (winner) {
      finalWinner.appendChild(buildAvatar(winner.playerId));
      const text = el('div', 'fw-text');
      text.appendChild(el('span', 'fw-name', winner.nickname));
      text.appendChild(el('span', 'fw-crown', t('party.honourWinner', '♛ Winner')));
      finalWinner.appendChild(text);
      finalWinner.appendChild(el('span', 'fw-score', String(winner.score)));
      // Landed, not arriving: it is the same card the winner beat just showed,
      // shrinking into its place at the top of the board.
      finalWinner.classList.toggle('land', animate);
    }

    paintHonourStrip(animate);

    // Rows start at 2: the winner is the header, not a row. On a tie nobody is
    // the header, so the list runs from 1 and reads as the plain ranking it is.
    const rows = winner ? board.slice(1) : board;
    const firstRank = winner ? 2 : 1;
    finalBoard.innerHTML = '';
    rows.forEach((entry, i) => {
      const row = el('div', 'scoreline other' + (entry.playerId === state.you ? ' you' : ''));
      row.appendChild(el('span', 'rank', String(firstRank + i)));
      row.appendChild(buildAvatar(entry.playerId));
      row.appendChild(el('span', 'nm', entry.nickname));
      // No count-up: the score already counted on the winner's screen, and a
      // board that re-reveals what was just announced is the thing this whole
      // structure exists to avoid.
      row.appendChild(el('span', 'sc', String(entry.score)));
      if (animate) {
        row.classList.add('enter-board');
        row.style.setProperty('--enter-delay', `${i * BOARD_ROW_STAGGER_MS}ms`);
      }
      finalBoard.appendChild(row);
    });
    // Always at the top. The header and the strip are pinned there, so the top is
    // where the story is; your own row is a flick away, and nothing moves on its
    // own once the rows have landed.
    finalBoard.scrollTop = 0;
  }

  /** Start (or restart) the honours strip's cycle.
   *
   *  ONE reserved line rather than a title under each honoured seat: a second
   *  line per row would cost a row's height for every player to say something
   *  only three of them earned, and it would take an honoured seat's mention off
   *  screen the moment its row scrolled out of view. */
  function paintHonourStrip(/** @type {boolean} */ animate) {
    if (honourStripTimer) { window.clearInterval(honourStripTimer); honourStripTimer = 0; }
    const honours = ceremonyHonours;
    finalHonours.hidden = honours.length === 0;
    if (honours.length === 0) return;
    let i = 0;
    const paint = () => {
      const h = honours[i % honours.length];
      finalHonours.innerHTML = '';
      finalHonours.appendChild(el('span', 'fh-glyph', HONOUR_GLYPHS[h.id] ?? ''));
      const text = el('div', 'fh-text');
      text.appendChild(el('span', 'fh-label', honourTitle(h)));
      text.appendChild(el('span', 'fh-who', h.nickname || ''));
      finalHonours.appendChild(text);
      finalHonours.appendChild(el('span', 'fh-value', honourValueText(h)));
      if (animate) {
        finalHonours.classList.remove('swap');
        void finalHonours.offsetWidth;
        finalHonours.classList.add('swap');
      }
      i += 1;
    };
    paint();
    // A single honour has nothing to cycle to, so it simply sits there.
    if (honours.length > 1) honourStripTimer = window.setInterval(paint, HONOUR_STRIP_CYCLE_MS);
  }

  /** Cut the ceremony short and go straight to the board.
   *
   *  ANY seat may skip, which is a deliberate widening of the design note's
   *  "a host tap". Nothing about the ceremony is broadcast -- it is built from
   *  the final payload every client already has -- so one player skipping changes
   *  nothing for anyone else, and a guest who cannot leave a twelve-second ending
   *  on the fourth playthrough is in a hostage situation the host is not. */
  function skipCeremony() {
    if (ceremonyScreen === null || ceremonyScreen === 'final') return;
    stopCeremony();
    const board = state.scoreboard || [];
    ceremonyScreen = 'final';
    renderBoard(board, winnerRowOf(board), false);
    showSection('final');
    // Skipping the ceremony must not skip the celebration: `stopCeremony` has
    // just cancelled the burst armed on the winner's beat, and the burst is the
    // one thing the ending owes everybody. `celebrate` is idempotent, so a skip
    // that lands after it already went off changes nothing.
    celebrate(board);
  }

  /** The scoreboard row that won, or null when nobody did: a tie at the top has
   *  no single winner to crown, and a board where nobody scored has none either
   *  (crowning a 0 is worse than crowning nobody). Mirrors `winnerIdsOf` on the
   *  server, which decides the same question for the honours pool -- the two
   *  must agree, or the winner would be offered an honour on their own board.
   *  @param {any[]} board */
  function winnerRowOf(board) {
    const top = board[0];
    if (!top || !(top.score > 0)) return null;
    if (board.length > 1 && board[1].score === top.score) return null;
    return top;
  }

  function renderFinal() {
    const board = state.scoreboard || [];
    const winner = winnerRowOf(board);
    // The honours ride the final payload. Absent from a server older than this
    // build, which simply means no honour beats -- the board still arrives,
    // exactly as it did before.
    const honours = Array.isArray(state.honours) ? state.honours : [];

    // A ceremony already in flight owns the screen: a re-render must repaint the
    // beat that is up, not drag the board forward over it.
    if (ceremonyScreen !== null) {
      if (ceremonyScreen === 'final') renderBoard(board, winner, false);
      showSection(ceremonyScreen);
      applyFinalDock();
      return;
    }

    const firstShow = !finalCelebrated;
    const animate = firstShow && !prefersReducedMotion();
    if (firstShow) finalCelebrated = true;

    if (!animate) {
      // Reduced motion, or a board being repainted after the fact: no beats, no
      // count-up, no crossfade. The strip itself stays -- it is content, not
      // motion -- so an honoured seat is still named.
      ceremonyHonours = honours;
      ceremonyScreen = 'final';
      renderBoard(board, winner, false);
      showSection('final');
      if (firstShow) celebrate(board);
      applyFinalDock();
      return;
    }
    playCeremony(honours, winner, board);
    applyFinalDock();
  }

  function applyFinalDock() {
    // Only the host can restart, so "Play again" shows for the host alone;
    // everyone else sees just "Home". (The dock has no separators, and hidden
    // items drop out with the remaining ones re-centring — so hiding Play
    // again leaves Home centred on its own.) Live lookup, same as the question
    // screen's Back to settings — the dock is rebuilt per screen.
    const againItem = dockItem('play-again');
    if (againItem) againItem.hidden = !state.isHost;
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
  $('create-room').addEventListener('click', () => enterRoom(generateCode(), 'create', { push: true }));

  // Normalises as you type and keeps Join inert below 5 characters. Shared with
  // Tic-Tac-Toe's identical row — see wireJoinCodeField in common.js.
  wireJoinCodeField(joinCodeInput, joinGoBtn);
  // A new attempt clears the previous rejection, so the pink underline doesn't
  // outlive the code that earned it.
  joinCodeInput.addEventListener('input', () => { if (lastJoinError) clearJoinError(); });

  joinForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const code = joinCodeInput.value.trim().toUpperCase();
    // Unreachable through the UI (the submit button is disabled until the code
    // is valid, which also gates Enter) — kept as the guard for any other path
    // into submit, and because the server should never be sent garbage.
    if (!isValidRoomCode(code)) {
      showJoinError('ttt.codeMustBe5', 'Code must be 5 characters');
      return;
    }
    clearJoinError();
    enterRoom(code, 'join', { push: true });
  });

  for (const btn of draftPickBtns) {
    btn.addEventListener('click', () => setGameLength(btn.dataset.length, false));
  }
  // Arrow keys move the selection within the group and wrap. Home/End jump to the
  // ends. This is the behaviour a radiogroup is expected to have, and the reason
  // the control is one tab stop rather than three.
  draftLengthGroup.addEventListener('keydown', (e) => {
    if (!RADIO_KEYS.includes(e.key)) return;
    // A guest's control is read-only, so leave their arrow keys alone rather than
    // swallowing them into a change the server would refuse anyway.
    if (!state.isHost) return;
    e.preventDefault();
    const next = nextRadioId([...GAME_LENGTHS], currentLength(), e.key);
    if (next) setGameLength(next, true);
  });
  // Even-picks: the switch flips the mode, the 1/2/3 segments pick the count. Same
  // click + arrow-key contract as the length group, through the same helpers.
  draftPicksToggle.addEventListener('change', () => setPicksMode(draftPicksToggle.checked));
  for (const btn of draftPicksBtns) {
    btn.addEventListener('click', () => setPicksValue(Number(btn.dataset.picks), false));
  }
  draftPicksGroup.addEventListener('keydown', (e) => {
    if (!RADIO_KEYS.includes(e.key)) return;
    if (!state.isHost) return;
    e.preventDefault();
    const ids = PICKS_PER_PLAYER_OPTIONS.map(String);
    const next = nextRadioId(ids, String(currentPicks()), e.key);
    if (next) setPicksValue(Number(next), true);
  });
  for (const btn of draftFirstPickBtns) {
    btn.addEventListener('click', () => setFirstPick(btn.dataset.firstPick, false));
  }
  // Same keyboard contract as the length group, through the same helper -- these
  // two rows were a copy of each other before `radioGroup.js` existed.
  draftFirstPickGroup.addEventListener('keydown', (e) => {
    if (!RADIO_KEYS.includes(e.key)) return;
    if (!state.isHost) return;
    e.preventDefault();
    const ids = draftFirstPickBtns.map((b) => b.dataset.firstPick ?? '');
    const next = nextRadioId(ids, currentFirstPick(), e.key);
    if (next) setFirstPick(next, true);
  });
  draftFirstPickVeil.addEventListener('change', () => setFirstPickVeil(draftFirstPickVeil.checked));
  // The setup card opens and closes for EVERYONE, host and guest alike. It is not
  // a permission — a guest who wants to read the veil switch or the exact length
  // can, they simply cannot move anything once it is open.
  setupHead.addEventListener('click', () => setSetupOpen(!setupOpen));
  // Bots: the host taps a difficulty and that IS the add — one gesture, no
  // separate confirm. The server mints the seat and broadcasts the roster, which
  // repaints the list, so the new bot lands directly above the seat that was just
  // pressed, wearing the level that was tapped and a remove ×. That chip is also
  // where the level's NAME first appears, which is how a host learns what the
  // dots meant.
  for (const btn of botLevelBtns) {
    btn.addEventListener('click', () => {
      if (!state.isHost) return;
      send({ type: 'addBot', skill: btn.dataset.skill });
    });
  }
  startBtn.addEventListener('click', () => {
    // Draft is the only way a game starts: zero setup, so the start carries no
    // plan (the server builds the first round from the host's chosen firstPick and
    // sizes the game from the seat count) and no reveal config (the veil clear
    // timing is a fixed constant now — see DEFAULT_REVEAL). Both host inputs, the
    // length and the first round, already reached the room over `setLength` /
    // `setFirstPick` during the lobby, so `length` rides along only as the legacy
    // fallback described below.
    //
    // A `draft: true` flag rode along until the server that needed it was gone.
    // It selected the draft branch on the pre-#974 server, which is no longer
    // deployed (`deploy-partykit.yml` shipped the draft-only server from `main`),
    // so nothing reads it any more. Note the ordering constraint if a start field
    // is ever added the same way: PartyKit and the SWA site deploy on separate
    // workflows, so the server has to understand a field before the client sends
    // it, and has to stop needing one before the client drops it.
    send({ type: 'start', length: currentLength() });
  });
  // Delegated on the dock itself, not bound to the buttons: `mountDock` replaces
  // the dock's children on every screen change, so a listener attached to an
  // item would go down with the element the first time the phase moved. The dock
  // element itself is the one thing that survives, so it carries the handler.
  partyDock.addEventListener('click', (e) => {
    const target = /** @type {HTMLElement | null} */ (e.target);
    if (!target) return;
    if (target.closest('#play-again')) send({ type: 'playAgain' });
    else if (target.closest('#question-to-settings')) send({ type: 'backToLobby' });
    else if (target.closest('#party-pause')) toggleBreak();
  });

  // The one thing on the break veil. Same handler as the dock item, so "start a
  // break" and "end a break" are one decision in one place — which is what keeps
  // a queued break cancellable from either surface.
  breakPlay.addEventListener('click', () => toggleBreak());

  // Skipping the ceremony: a tap anywhere on an honour or winner beat goes
  // straight to the board. On the beats themselves rather than a labelled button,
  // because a "Skip" control on screen invites you to use it the first time —
  // and the first time is the one time the ending is worth watching.
  sections.honour.addEventListener('click', () => skipCeremony());
  sections.winner.addEventListener('click', () => skipCeremony());

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
        // `key` and `year` are carried for the chart's scale line ("medals ·
        // 2026"); `chartUnitLine` assembles it from them. The file's own `m.unit`
        // is deliberately NOT carried: those strings are English, and several are
        // less precise than their translations (the gdpPerCapita file says "US$"
        // where the string says "US$/person"), so keeping one as a fallback would
        // mislabel a per-capita chart rather than merely fail to translate it. An
        // untranslated metric shows the year alone.
        if (m && m.values) {
          metricByQuestion[questionId] = {
            values: m.values,
            format: m.format || 'compact',
            key: String(m.key || ''),
            year: typeof m.year === 'number' ? m.year : null,
          };
        }
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
