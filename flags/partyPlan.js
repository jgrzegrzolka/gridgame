/**
 * The game plan for a Flag Party match: an ordered list of segments, each a
 * pool + a round type + a round count. Today one game is 4 of each: 4 sovereign
 * flag-pick, 4 non-sovereign flag-pick, 4 sovereign map, then 4 sovereign
 * most/least-populous rounds (16 total). Modelling it as *data*
 * (not a hardcoded "11 rounds, switch at 3/6") is the seed of the future
 * settings page, where the host will pick modes and rounds-per-mode — that page
 * just edits this array.
 *
 * The server maps each `poolId` to an actual flag pool (`flags/flagPools.js`)
 * and each `roundId` to a round module (`flags/partyRounds/<id>.js`); this
 * module stays pure and agnostic of both.
 *
 * @typedef {{ poolId: string, roundId: string, rounds: number }} Segment
 */

/** @type {Segment[]} */
export const DEFAULT_PLAN = [
  { poolId: 'sovereign', roundId: 'flagPick', rounds: 4 },
  { poolId: 'nonSovereign', roundId: 'flagPick', rounds: 4 },
  { poolId: 'sovereign', roundId: 'mapPick', rounds: 4 },
  { poolId: 'sovereign', roundId: 'superlative', rounds: 4 },
];

/**
 * @param {Segment[]} plan
 * @returns {number}
 */
export function totalRounds(plan) {
  return plan.reduce((sum, seg) => sum + seg.rounds, 0);
}

/**
 * A **block** is {@link BLOCK_ROUNDS} consecutive rounds — the show's act unit.
 * Under the block model (Iteration 8) every enabled mode contributes exactly one
 * block, so a game is a run of 5-round acts with a standings **break** between
 * them. The break is a page-layer concern (a longer reveal, see
 * `flags/partyTiming.js`), not a room phase — the helpers below are the pure
 * arithmetic the page and client key off, derived from the plan's total alone.
 * Blocks map to rounds, not to segments: a picture block is one 5-round segment,
 * but the world-facts block is five 1-round metric segments, so "which block am
 * I in" is round arithmetic, never a segment count.
 */
export const BLOCK_ROUNDS = 5;

/**
 * The 0-based block a given 0-based round falls in. Pure round arithmetic — a
 * block is always {@link BLOCK_ROUNDS} rounds wide regardless of how the plan's
 * segments happen to be sliced.
 * @param {number} index
 * @returns {number}
 */
export function blockIndexForRound(index) {
  return Math.floor(index / BLOCK_ROUNDS);
}

/**
 * How many blocks a plan runs. Only the final block may be short (a plan built
 * from block-shaped modes is always a whole number of 5s, but a custom / legacy
 * plan need not be), so round up.
 * @param {Segment[]} plan
 * @returns {number}
 */
export function blockCount(plan) {
  return Math.ceil(totalRounds(plan) / BLOCK_ROUNDS);
}

/**
 * The core block-boundary rule, keyed on the round index and the game's total
 * round count alone: a 0-based round is a boundary when it's the last round of
 * its block AND another block follows (so never the game's final round — that
 * reveal advances to the final board, not an inter-block break). Takes the total
 * rather than the plan so the **client** can call it (it knows `roundIndex` and
 * `totalRounds` from every reveal, but never holds the plan). Fires exactly
 * `blockCount - 1` times per game.
 * @param {number} index
 * @param {number} total  the game's total round count
 * @returns {boolean}
 */
export function isBlockBoundary(index, total) {
  return (index + 1) % BLOCK_ROUNDS === 0 && index < total - 1;
}

/**
 * Whether a 0-based round is a block boundary in a given plan — the server-side
 * convenience over {@link isBlockBoundary} for callers that hold the plan.
 * @param {Segment[]} plan
 * @param {number} index
 * @returns {boolean}
 */
export function isBlockEnd(plan, index) {
  return isBlockBoundary(index, totalRounds(plan));
}

/**
 * Whether a 0-based round is the **first round of a block after the opener** —
 * the beat where the client announces the new block with its title card. True
 * for block 2..N's first round, false for the game's opening block (round 0,
 * which starts play rather than announcing a switch) and for every mid-block
 * round. Keyed on index + total (like {@link isBlockBoundary}) so the client can
 * call it from a question alone. Fires exactly `blockCount - 1` times per game,
 * the mirror of {@link isBlockBoundary}.
 * @param {number} index
 * @param {number} total  the game's total round count
 * @returns {boolean}
 */
export function isBlockStart(index, total) {
  return index > 0 && index < total && index % BLOCK_ROUNDS === 0;
}

/**
 * Whether a 0-based round falls in the game's **final block** — the block that
 * decides the game, which scores double and is always played tricky. Keyed on the
 * round index and total (like {@link isBlockBoundary}), so the client can call it
 * from a reveal / question alone. A **single-block game has no final block**
 * (there's no earlier block to contrast, so doubling / veiling it throughout would
 * be pointless and surprising): returns false unless the game runs 2+ blocks.
 * @param {number} index
 * @param {number} total  the game's total round count
 * @returns {boolean}
 */
export function isFinalBlock(index, total) {
  const blocks = Math.ceil(total / BLOCK_ROUNDS);
  return blocks > 1 && blockIndexForRound(index) === blocks - 1;
}

/**
 * The segment a given 0-based round falls in. A round index past the end clamps
 * to the last segment — harmless, since the server only generates a question
 * for a round the room will actually play (the extra question on the final
 * round is discarded by `applyNext`).
 *
 * @param {Segment[]} plan
 * @param {number} index
 * @returns {Segment}
 */
function segmentForRound(plan, index) {
  let acc = 0;
  for (const seg of plan) {
    if (index < acc + seg.rounds) return seg;
    acc += seg.rounds;
  }
  return plan[plan.length - 1];
}

/**
 * Which pool the given 0-based round draws from.
 * @param {Segment[]} plan
 * @param {number} index
 * @returns {string}
 */
export function poolIdForRound(plan, index) {
  return segmentForRound(plan, index).poolId;
}

/**
 * Which round type the given 0-based round plays.
 * @param {Segment[]} plan
 * @param {number} index
 * @returns {string}
 */
export function roundIdForRound(plan, index) {
  return segmentForRound(plan, index).roundId;
}

/**
 * The catalog of game modes a host can pick from in the lobby setup. Each mode
 * is a (roundId, poolId) pair with a stable `id` the UI and localStorage key
 * off; the human label lives in i18n (`party.mode.*`), not here, so this stays
 * pure. Order is the order modes appear in the setup list and the order their
 * segments land in a built plan (flags, then territories, then the map finale).
 * Adding a mode here makes it selectable; nothing else changes.
 *
 * `group` splits the catalog into the fixed **picture** trio (flags / map) and
 * the open-ended **metric** family (population / area / density / …future GDP,
 * coffee). The lobby renders the two groups differently — picture modes as rows,
 * the metric family as colour chips — but each enabled mode of either group is
 * one block (see {@link buildPartyPlan}); a statistic is its own per-metric
 * block. Adding a metric = one more `group: 'metric'` entry here + its round
 * module + i18n; the setup UI grows by one chip, not one row.
 *
 * @typedef {{ id: string, roundId: string, poolId: string, group: 'picture' | 'metric' }} PartyMode
 * @type {PartyMode[]}
 */
export const PARTY_MODES = [
  { id: 'flags-all', roundId: 'flagPick', poolId: 'sovereign', group: 'picture' },
  { id: 'flags-territories', roundId: 'flagPick', poolId: 'nonSovereign', group: 'picture' },
  { id: 'map-outlines', roundId: 'mapPick', poolId: 'sovereign', group: 'picture' },
  { id: 'superlative-pop', roundId: 'superlative', poolId: 'sovereign', group: 'metric' },
  { id: 'superlative-area', roundId: 'superlative-area', poolId: 'sovereign', group: 'metric' },
  { id: 'superlative-density', roundId: 'superlative-density', poolId: 'sovereign', group: 'metric' },
  { id: 'superlative-gdp', roundId: 'superlative-gdp', poolId: 'sovereign', group: 'metric' },
  { id: 'superlative-gdppc', roundId: 'superlative-gdppc', poolId: 'sovereign', group: 'metric' },
  { id: 'superlative-coffee', roundId: 'superlative-coffee', poolId: 'sovereign', group: 'metric' },
  { id: 'superlative-wine', roundId: 'superlative-wine', poolId: 'sovereign', group: 'metric' },
  { id: 'superlative-cocoa', roundId: 'superlative-cocoa', poolId: 'sovereign', group: 'metric' },
  { id: 'superlative-banana', roundId: 'superlative-banana', poolId: 'sovereign', group: 'metric' },
  { id: 'superlative-apple', roundId: 'superlative-apple', poolId: 'sovereign', group: 'metric' },
  { id: 'superlative-elevation', roundId: 'superlative-elevation', poolId: 'sovereign', group: 'metric' },
  { id: 'superlative-coastline', roundId: 'superlative-coastline', poolId: 'sovereign', group: 'metric' },
  { id: 'superlative-forest', roundId: 'superlative-forest', poolId: 'sovereign', group: 'metric' },
  { id: 'superlative-oil', roundId: 'superlative-oil', poolId: 'sovereign', group: 'metric' },
  { id: 'superlative-rice', roundId: 'superlative-rice', poolId: 'sovereign', group: 'metric' },
  { id: 'superlative-coal', roundId: 'superlative-coal', poolId: 'sovereign', group: 'metric' },
  { id: 'superlative-sheep', roundId: 'superlative-sheep', poolId: 'sovereign', group: 'metric' },
  { id: 'superlative-cattle', roundId: 'superlative-cattle', poolId: 'sovereign', group: 'metric' },
  { id: 'superlative-beer', roundId: 'superlative-beer', poolId: 'sovereign', group: 'metric' },
  { id: 'superlative-tea', roundId: 'superlative-tea', poolId: 'sovereign', group: 'metric' },
  { id: 'superlative-sugarcane', roundId: 'superlative-sugarcane', poolId: 'sovereign', group: 'metric' },
  { id: 'superlative-gold', roundId: 'superlative-gold', poolId: 'sovereign', group: 'metric' },
  { id: 'superlative-alcohol', roundId: 'superlative-alcohol', poolId: 'sovereign', group: 'metric' },
  { id: 'superlative-meat', roundId: 'superlative-meat', poolId: 'sovereign', group: 'metric' },
  { id: 'superlative-borders', roundId: 'superlative-borders', poolId: 'sovereign', group: 'metric' },
  { id: 'superlative-olive-oil', roundId: 'superlative-olive-oil', poolId: 'sovereign', group: 'metric' },
  { id: 'superlative-honey', roundId: 'superlative-honey', poolId: 'sovereign', group: 'metric' },
  { id: 'superlative-temperature', roundId: 'superlative-temperature', poolId: 'sovereign', group: 'metric' },
  { id: 'superlative-happiness', roundId: 'superlative-happiness', poolId: 'sovereign', group: 'metric' },
  { id: 'superlative-corruption', roundId: 'superlative-corruption', poolId: 'sovereign', group: 'metric' },
  { id: 'superlative-tourism', roundId: 'superlative-tourism', poolId: 'sovereign', group: 'metric' },
  { id: 'superlative-electricity', roundId: 'superlative-electricity', poolId: 'sovereign', group: 'metric' },
];

/** The fixed picture trio (flags / territories / map), in catalog order. */
export const PICTURE_MODES = PARTY_MODES.filter((m) => m.group === 'picture');
/** The open-ended world-metric family (population / area / density / …). */
export const METRIC_MODES = PARTY_MODES.filter((m) => m.group === 'metric');

/** Bounds a host's choices stay inside — a defence against a malformed plan
 *  over the wire as much as a sane ceiling for the lobby steppers. */
export const MAX_ROUNDS_PER_MODE = 30;
export const MAX_TOTAL_ROUNDS = 100;

/**
 * The catalog mode a segment belongs to (matched on roundId + poolId), or null
 * if the segment references no known mode.
 * @param {Segment} seg
 * @returns {string | null}
 */
function modeIdForSegment(seg) {
  const m = PARTY_MODES.find((x) => x.roundId === seg.roundId && x.poolId === seg.poolId);
  return m ? m.id : null;
}

/**
 * Rounds-per-mode for a plan, as a `{ modeId: count }` map covering every
 * catalog mode (0 when a mode isn't in the plan). Segments that map to the same
 * mode sum. This is what the lobby setup reads to seed its steppers.
 * @param {Segment[]} plan
 * @returns {Record<string, number>}
 */
export function countsForPlan(plan) {
  /** @type {Record<string, number>} */
  const counts = {};
  for (const m of PARTY_MODES) counts[m.id] = 0;
  for (const seg of plan) {
    const id = modeIdForSegment(seg);
    if (id) counts[id] += seg.rounds;
  }
  return counts;
}

/**
 * Build a plan from a `{ modeId: count }` map: one segment per catalog mode with
 * a positive count, in catalog order, each clamped to `MAX_ROUNDS_PER_MODE`.
 * Modes at 0 (or off) are dropped. This is what the host's lobby sends on start.
 * @param {Record<string, number>} counts
 * @returns {Segment[]}
 */
export function planFromModeCounts(counts) {
  /** @type {Segment[]} */
  const plan = [];
  for (const m of PARTY_MODES) {
    const n = counts[m.id];
    if (Number.isInteger(n) && n > 0) {
      plan.push({ poolId: m.poolId, roundId: m.roundId, rounds: Math.min(n, MAX_ROUNDS_PER_MODE) });
    }
  }
  return plan;
}

/**
 * Sanitize an untrusted plan arriving from a host over the wire: keep only
 * segments that reference a real catalog mode with an integer count >= 1, clamp
 * each to `MAX_ROUNDS_PER_MODE`, and cap the running total at
 * `MAX_TOTAL_ROUNDS`. Returns the cleaned plan, or null when nothing valid
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
    const rounds = /** @type {any} */ (seg).rounds;
    if (!Number.isInteger(rounds) || rounds < 1) continue;
    let n = Math.min(rounds, MAX_ROUNDS_PER_MODE);
    if (total + n > MAX_TOTAL_ROUNDS) n = MAX_TOTAL_ROUNDS - total;
    if (n < 1) break;
    out.push({ poolId: /** @type {Segment} */ (seg).poolId, roundId: /** @type {Segment} */ (seg).roundId, rounds: n });
    total += n;
  }
  return out.length ? out : null;
}

/**
 * Build a plan from the lobby setup shape. Under the **block model** (Iteration
 * 8) every enabled mode is one {@link BLOCK_ROUNDS}-round block, and that now
 * includes each statistic on its own: an on picture mode becomes one 5-round
 * segment, and **each enabled metric becomes its own 5-round block** of that one
 * metric (not a mixed world-facts block). So the block count is exactly the
 * number of enabled modes: picture modes on + statistics on. The result is a
 * normal `Segment[]` the server validates like any other plan — no server or room
 * change is needed, the block model lives entirely in how the client turns its
 * setup into segments here.
 *
 * Order: the picture blocks (catalog order), then the statistic blocks (catalog
 * order). A per-metric block reads as a coherent little quiz ("five coffee
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
      plan.push({ poolId: m.poolId, roundId: m.roundId, rounds: BLOCK_ROUNDS });
    }
  }
  const metrics = (setup && setup.facts && setup.facts.metrics) || {};
  for (const m of METRIC_MODES) {
    if (metrics[m.id]) {
      plan.push({ poolId: m.poolId, roundId: m.roundId, rounds: BLOCK_ROUNDS });
    }
  }
  return plan;
}
