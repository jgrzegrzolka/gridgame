/**
 * The game plan for a Flag Party match: an ordered list of segments, each a
 * pool + a question type + a question count. Today one game is 4 of each: 4 sovereign
 * flag-pick, 4 non-sovereign flag-pick, 4 sovereign map, then 4 sovereign
 * most/least-populous questions (16 total). Modelling it as *data*
 * (not a hardcoded "11 questions, switch at 3/6") is the seed of the future
 * settings page, where the host will pick modes and questions-per-mode — that page
 * just edits this array.
 *
 * The server maps each `poolId` to an actual flag pool (`flags/flagPools.js`)
 * and each `questionId` to a question module (`flags/partyQuestions/<id>.js`); this
 * module stays pure and agnostic of both.
 *
 * `veil` is set only by a draft pick: the picker may choose to veil their own
 * round (see `canVeilMode` — picture modes only), so the veil is a property of
 * the round rather than of the game. Absent on every host-built segment, where
 * the game-wide tricky toggle still decides.
 *
 * @typedef {{ poolId: string, questionId: string, questions: number, veil?: boolean }} Segment
 */

/** @type {Segment[]} */
export const DEFAULT_PLAN = [
  { poolId: 'sovereign', questionId: 'flagPick', questions: 4 },
  { poolId: 'nonSovereign', questionId: 'flagPick', questions: 4 },
  { poolId: 'sovereign', questionId: 'mapPick', questions: 4 },
  { poolId: 'sovereign', questionId: 'superlative', questions: 4 },
];

/**
 * @param {Segment[]} plan
 * @returns {number}
 */
export function totalQuestions(plan) {
  return plan.reduce((sum, seg) => sum + seg.questions, 0);
}

/**
 * A **round** is {@link ROUND_QUESTIONS} consecutive questions — the show's act unit.
 * Under the round model (Iteration 8) every enabled mode contributes exactly one
 * round, so a game is a run of 5-question acts with a standings **break** between
 * them. The break is a page-layer concern (a longer reveal, see
 * `flags/partyTiming.js`), not a room phase — the helpers below are the pure
 * arithmetic the page and client key off, derived from the plan's total alone.
 * Rounds map to questions, not to segments: a picture round is one 5-question segment,
 * but the world-facts round is five 1-question metric segments, so "which round am
 * I in" is question arithmetic, never a segment count.
 */
export const ROUND_QUESTIONS = 5;

/**
 * The 0-based round a given 0-based question falls in. Pure question arithmetic — a
 * round is always {@link ROUND_QUESTIONS} questions wide regardless of how the plan's
 * segments happen to be sliced.
 * @param {number} index
 * @returns {number}
 */
export function roundIndexAt(index) {
  return Math.floor(index / ROUND_QUESTIONS);
}

/**
 * How many rounds a plan runs. Only the final round may be short (a plan built
 * from round-shaped modes is always a whole number of 5s, but a custom / legacy
 * plan need not be), so round up.
 * @param {Segment[]} plan
 * @returns {number}
 */
export function roundCount(plan) {
  return Math.ceil(totalQuestions(plan) / ROUND_QUESTIONS);
}

/**
 * The core round-boundary rule, keyed on the question index and the game's total
 * question count alone: a 0-based question is a boundary when it's the last question of
 * its round AND another round follows (so never the game's final question — that
 * reveal advances to the final board, not an inter-round break). Takes the total
 * rather than the plan so the **client** can call it (it knows `questionIndex` and
 * `totalQuestions` from every reveal, but never holds the plan). Fires exactly
 * `roundCount - 1` times per game.
 * @param {number} index
 * @param {number} total  the game's total question count
 * @returns {boolean}
 */
export function isRoundBoundary(index, total) {
  return (index + 1) % ROUND_QUESTIONS === 0 && index < total - 1;
}


/**
 * Whether a 0-based question is the **first question of a round** — the beat where the
 * client shows the round's title card. True for the first question of EVERY round,
 * **including the opening round (question 0)**: the card is also the synchronized
 * "get ready" beat at game start, so the host who just clicked Start doesn't face
 * the first question a moment before the other seats have oriented (every client
 * holds the same card beat, and the question clock starts only after it). False for
 * every mid-round question. Keyed on index + total (like {@link isRoundBoundary}) so
 * the client can call it from a question alone. Fires exactly `roundCount` times
 * per game (once per round).
 * @param {number} index
 * @param {number} total  the game's total question count
 * @returns {boolean}
 */
export function isRoundStart(index, total) {
  return index >= 0 && index < total && index % ROUND_QUESTIONS === 0;
}

/**
 * Whether a 0-based question falls in the game's **final round** — the round that
 * decides the game, which scores double and is always played tricky. Keyed on the
 * question index and total (like {@link isRoundBoundary}), so the client can call it
 * from a reveal / question alone. A **single-round game has no final round**
 * (there's no earlier round to contrast, so doubling / veiling it throughout would
 * be pointless and surprising): returns false unless the game runs 2+ rounds.
 * @param {number} index
 * @param {number} total  the game's total question count
 * @returns {boolean}
 */
export function isFinalRound(index, total) {
  const rounds = Math.ceil(total / ROUND_QUESTIONS);
  return rounds > 1 && roundIndexAt(index) === rounds - 1;
}

/**
 * The segment a given 0-based question falls in. A question index past the end clamps
 * to the last segment — harmless, since the server only generates a question
 * for a question the room will actually play (the extra question on the final
 * question is discarded by `applyNext`).
 *
 * @param {Segment[]} plan
 * @param {number} index
 * @returns {Segment}
 */
function segmentAt(plan, index) {
  let acc = 0;
  for (const seg of plan) {
    if (index < acc + seg.questions) return seg;
    acc += seg.questions;
  }
  return plan[plan.length - 1];
}

/**
 * Which pool the given 0-based question draws from.
 * @param {Segment[]} plan
 * @param {number} index
 * @returns {string}
 */
export function poolIdAt(plan, index) {
  return segmentAt(plan, index).poolId;
}

/**
 * Which question type the given 0-based question plays.
 * @param {Segment[]} plan
 * @param {number} index
 * @returns {string}
 */
export function questionIdAt(plan, index) {
  return segmentAt(plan, index).questionId;
}

/**
 * The catalog of game modes a host can pick from in the lobby setup. Each mode
 * is a (questionId, poolId) pair with a stable `id` the UI and localStorage key
 * off; the human label lives in i18n (`party.mode.*`), not here, so this stays
 * pure. Order is the order modes appear in the setup list and the order their
 * segments land in a built plan (flags, then territories, then the map finale).
 * Adding a mode here makes it selectable; nothing else changes.
 *
 * `group` splits the catalog into the fixed **picture** trio (flags / map) and
 * the open-ended **metric** family (population / area / density / …future GDP,
 * coffee). The lobby renders the two groups differently — picture modes as rows,
 * the metric family as colour chips — but each enabled mode of either group is
 * one round (see {@link buildPartyPlan}); a statistic is its own per-metric
 * round. Adding a metric = one more `group: 'metric'` entry here + its question
 * module + i18n; the setup UI grows by one chip, not one row.
 *
 * @typedef {{ id: string, questionId: string, poolId: string, group: 'picture' | 'metric' }} PartyMode
 * @type {PartyMode[]}
 */
export const PARTY_MODES = [
  { id: 'flags-all', questionId: 'flagPick', poolId: 'sovereign', group: 'picture' },
  { id: 'flags-weird', questionId: 'flagPick', poolId: 'nonSovereign', group: 'picture' },
  { id: 'map-outlines', questionId: 'mapPick', poolId: 'sovereign', group: 'picture' },
  { id: 'superlative-pop', questionId: 'superlative', poolId: 'sovereign', group: 'metric' },
  { id: 'superlative-area', questionId: 'superlative-area', poolId: 'sovereign', group: 'metric' },
  { id: 'superlative-density', questionId: 'superlative-density', poolId: 'sovereign', group: 'metric' },
  { id: 'superlative-gdp', questionId: 'superlative-gdp', poolId: 'sovereign', group: 'metric' },
  { id: 'superlative-gdppc', questionId: 'superlative-gdppc', poolId: 'sovereign', group: 'metric' },
  { id: 'superlative-coffee', questionId: 'superlative-coffee', poolId: 'sovereign', group: 'metric' },
  { id: 'superlative-wine', questionId: 'superlative-wine', poolId: 'sovereign', group: 'metric' },
  { id: 'superlative-cocoa', questionId: 'superlative-cocoa', poolId: 'sovereign', group: 'metric' },
  { id: 'superlative-banana', questionId: 'superlative-banana', poolId: 'sovereign', group: 'metric' },
  { id: 'superlative-apple', questionId: 'superlative-apple', poolId: 'sovereign', group: 'metric' },
  { id: 'superlative-elevation', questionId: 'superlative-elevation', poolId: 'sovereign', group: 'metric' },
  { id: 'superlative-coastline', questionId: 'superlative-coastline', poolId: 'sovereign', group: 'metric' },
  { id: 'superlative-forest', questionId: 'superlative-forest', poolId: 'sovereign', group: 'metric' },
  { id: 'superlative-oil', questionId: 'superlative-oil', poolId: 'sovereign', group: 'metric' },
  { id: 'superlative-rice', questionId: 'superlative-rice', poolId: 'sovereign', group: 'metric' },
  { id: 'superlative-coal', questionId: 'superlative-coal', poolId: 'sovereign', group: 'metric' },
  { id: 'superlative-sheep', questionId: 'superlative-sheep', poolId: 'sovereign', group: 'metric' },
  { id: 'superlative-cattle', questionId: 'superlative-cattle', poolId: 'sovereign', group: 'metric' },
  { id: 'superlative-beer', questionId: 'superlative-beer', poolId: 'sovereign', group: 'metric' },
  { id: 'superlative-tea', questionId: 'superlative-tea', poolId: 'sovereign', group: 'metric' },
  { id: 'superlative-sugarcane', questionId: 'superlative-sugarcane', poolId: 'sovereign', group: 'metric' },
  { id: 'superlative-gold', questionId: 'superlative-gold', poolId: 'sovereign', group: 'metric' },
  { id: 'superlative-alcohol', questionId: 'superlative-alcohol', poolId: 'sovereign', group: 'metric' },
  { id: 'superlative-meat', questionId: 'superlative-meat', poolId: 'sovereign', group: 'metric' },
  { id: 'superlative-borders', questionId: 'superlative-borders', poolId: 'sovereign', group: 'metric' },
  { id: 'superlative-olive-oil', questionId: 'superlative-olive-oil', poolId: 'sovereign', group: 'metric' },
  { id: 'superlative-honey', questionId: 'superlative-honey', poolId: 'sovereign', group: 'metric' },
  { id: 'superlative-temperature', questionId: 'superlative-temperature', poolId: 'sovereign', group: 'metric' },
  { id: 'superlative-happiness', questionId: 'superlative-happiness', poolId: 'sovereign', group: 'metric' },
  { id: 'superlative-corruption', questionId: 'superlative-corruption', poolId: 'sovereign', group: 'metric' },
  { id: 'superlative-tourism', questionId: 'superlative-tourism', poolId: 'sovereign', group: 'metric' },
  { id: 'superlative-electricity', questionId: 'superlative-electricity', poolId: 'sovereign', group: 'metric' },
];

/** The fixed picture trio (flags / territories / map), in catalog order. */
export const PICTURE_MODES = PARTY_MODES.filter((m) => m.group === 'picture');
/** The open-ended world-metric family (population / area / density / …). */
export const METRIC_MODES = PARTY_MODES.filter((m) => m.group === 'metric');

/** Bounds a host's choices stay inside — a defence against a malformed plan
 *  over the wire as much as a sane ceiling for the lobby steppers. */
export const MAX_QUESTIONS_PER_MODE = 30;
export const MAX_TOTAL_QUESTIONS = 100;

/**
 * The catalog mode a segment belongs to (matched on questionId + poolId), or null
 * if the segment references no known mode.
 * @param {Segment} seg
 * @returns {string | null}
 */
function modeIdForSegment(seg) {
  const m = PARTY_MODES.find((x) => x.questionId === seg.questionId && x.poolId === seg.poolId);
  return m ? m.id : null;
}



/**
 * Sanitize an untrusted plan arriving from a host over the wire: keep only
 * segments that reference a real catalog mode with an integer count >= 1, clamp
 * each to `MAX_QUESTIONS_PER_MODE`, and cap the running total at
 * `MAX_TOTAL_QUESTIONS`. Returns the cleaned plan, or null when nothing valid
 * survives (the server then falls back to `DEFAULT_PLAN`). The server must never
 * trust a client-supplied plan directly.
 * @param {unknown} plan
 * @returns {Segment[] | null}
 */
export function validatePlan(plan) {
  if (!Array.isArray(plan)) return null;
  /** @type {Segment[]} */
  const out = [];
  let total = 0;
  for (const seg of plan) {
    if (!seg || typeof seg !== 'object') continue;
    const id = modeIdForSegment(/** @type {Segment} */ (seg));
    if (!id) continue;
    const questions = /** @type {any} */ (seg).questions;
    if (!Number.isInteger(questions) || questions < 1) continue;
    let n = Math.min(questions, MAX_QUESTIONS_PER_MODE);
    if (total + n > MAX_TOTAL_QUESTIONS) n = MAX_TOTAL_QUESTIONS - total;
    if (n < 1) break;
    /** @type {Segment} */
    const clean = { poolId: /** @type {Segment} */ (seg).poolId, questionId: /** @type {Segment} */ (seg).questionId, questions: n };
    // A draft round's veil rides on the segment, so it has to be carried across
    // explicitly — this rebuilds segments field-by-field, so an unlisted key is
    // dropped. Only the literal `true` survives, and the key stays absent
    // otherwise so an unveiled segment keeps its original shape.
    if (/** @type {Segment} */ (seg).veil === true) clean.veil = true;
    out.push(clean);
    total += n;
  }
  return out.length ? out : null;
}

/**
 * Build a plan from the lobby setup shape. Under the **round model** (Iteration
 * 8) every enabled mode is one {@link ROUND_QUESTIONS}-question round, and that now
 * includes each statistic on its own: an on picture mode becomes one 5-question
 * segment, and **each enabled metric becomes its own 5-question round** of that one
 * metric (not a mixed world-facts round). So the round count is exactly the
 * number of enabled modes: picture modes on + statistics on. The result is a
 * normal `Segment[]` the server validates like any other plan — no server or room
 * change is needed, the round model lives entirely in how the client turns its
 * setup into segments here.
 *
 * Order: the picture rounds (catalog order), then the statistic rounds (catalog
 * order). A per-metric round reads as a coherent little quiz ("five coffee
 * questions") and gives Iteration 9's draft its "I pick Coffee" moment for free.
 *
 * @param {{ picture: Record<string, { on: boolean }>, facts: { metrics: Record<string, boolean> } }} setup
 * @returns {Segment[]}
 */
export function buildPartyPlan(setup) {
  /** @type {Segment[]} */
  const plan = [];
  const picture = (setup && setup.picture) || {};
  for (const m of PICTURE_MODES) {
    if (picture[m.id] && picture[m.id].on) {
      plan.push({ poolId: m.poolId, questionId: m.questionId, questions: ROUND_QUESTIONS });
    }
  }
  const metrics = (setup && setup.facts && setup.facts.metrics) || {};
  for (const m of METRIC_MODES) {
    if (metrics[m.id]) {
      plan.push({ poolId: m.poolId, questionId: m.questionId, questions: ROUND_QUESTIONS });
    }
  }
  return plan;
}
