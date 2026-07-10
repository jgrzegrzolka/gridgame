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
 * @typedef {{ id: string, roundId: string, poolId: string }} PartyMode
 * @type {PartyMode[]}
 */
export const PARTY_MODES = [
  { id: 'flags-all', roundId: 'flagPick', poolId: 'sovereign' },
  { id: 'flags-territories', roundId: 'flagPick', poolId: 'nonSovereign' },
  { id: 'map-outlines', roundId: 'mapPick', poolId: 'sovereign' },
  { id: 'superlative-pop', roundId: 'superlative', poolId: 'sovereign' },
];

/** Bounds a host's choices stay inside — a defence against a malformed plan
 *  over the wire as much as a sane ceiling for the lobby steppers. */
export const MAX_ROUNDS_PER_MODE = 15;
export const MAX_TOTAL_ROUNDS = 30;

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
