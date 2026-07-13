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
 * `group` splits the catalog into the fixed **picture** trio (flags / map) and
 * the open-ended **metric** family (population / area / density / …future GDP,
 * coffee). The lobby renders the two groups differently: picture modes get a
 * per-mode stepper + toggle, the metric family collapses to one "world facts"
 * control with a shared count spread across the enabled metrics (see
 * {@link buildPartyPlan}). Adding a metric = one more `group: 'metric'` entry
 * here + its round module + i18n; the setup UI grows by one chip, not one row.
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
];

/** The fixed picture trio (flags / territories / map), in catalog order. */
export const PICTURE_MODES = PARTY_MODES.filter((m) => m.group === 'picture');
/** The open-ended world-metric family (population / area / density / …). */
export const METRIC_MODES = PARTY_MODES.filter((m) => m.group === 'metric');

/** @type {Record<string, PartyMode>} */
const MODE_BY_ID = Object.fromEntries(PARTY_MODES.map((m) => [m.id, m]));

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

/**
 * Fisher-Yates shuffle with an injectable RNG (so callers can seed it in tests).
 * Returns a new array; the input is not mutated.
 * @template T
 * @param {T[]} arr
 * @param {() => number} rng
 * @returns {T[]}
 */
function shuffle(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}

/**
 * Spread `n` world-facts rounds across the enabled metric modes, as a list of
 * `n` mode ids in play order. Balanced first (round-robin so each metric gets a
 * near-equal share) then shuffled, with the leftover rounds (`n % metrics`)
 * handed to a random subset — so a 6-round / 3-metric game is always 2 each in a
 * random order, and a 7-round game is 3/2/2 with a random metric getting the
 * extra. This is the "picked at random from the facts you choose" the lobby
 * promises: which facts play is the host's pick; how many of each is the deal.
 *
 * Unknown / non-metric ids are dropped; `n <= 0` or no metrics yields `[]`.
 *
 * @param {number} n  how many world-facts rounds to deal
 * @param {string[]} metricIds  the enabled metric mode ids
 * @param {() => number} [rng]
 * @returns {string[]}  `n` metric mode ids, in play order
 */
export function distributeWorldFacts(n, metricIds, rng = Math.random) {
  const ids = Array.isArray(metricIds)
    ? metricIds.filter((id) => MODE_BY_ID[id] && MODE_BY_ID[id].group === 'metric')
    : [];
  if (!ids.length || !Number.isFinite(n) || n <= 0) return [];
  const rounds = Math.min(Math.floor(n), MAX_TOTAL_ROUNDS);
  const order = shuffle(ids, rng); // randomise which metric takes the remainder
  /** @type {string[]} */
  const out = [];
  for (let i = 0; i < rounds; i++) out.push(order[i % order.length]);
  return shuffle(out, rng); // randomise play order
}

/**
 * Build a plan from the lobby setup shape: picture modes contribute one segment
 * each (their own round count, catalog order); the world-facts family expands
 * its single shared count into one-round metric segments dealt by
 * {@link distributeWorldFacts}, appended after the picture block. The result is
 * a normal `Segment[]` the server validates like any other plan — no server or
 * room change is needed to group the metric modes, the grouping lives entirely
 * in how the client turns its setup into segments here.
 *
 * @param {{ picture: Record<string, { on: boolean, n: number }>, facts: { on: boolean, n: number, metrics: Record<string, boolean> } }} setup
 * @param {() => number} [rng]
 * @returns {Segment[]}
 */
export function buildPartyPlan(setup, rng = Math.random) {
  /** @type {Segment[]} */
  const plan = [];
  const picture = (setup && setup.picture) || {};
  for (const m of PICTURE_MODES) {
    const st = picture[m.id];
    if (st && st.on && Number.isFinite(st.n) && st.n > 0) {
      plan.push({ poolId: m.poolId, roundId: m.roundId, rounds: Math.min(Math.floor(st.n), MAX_ROUNDS_PER_MODE) });
    }
  }
  const facts = (setup && setup.facts) || null;
  if (facts && facts.on && Number.isFinite(facts.n) && facts.n > 0) {
    const enabled = METRIC_MODES.filter((m) => facts.metrics && facts.metrics[m.id]).map((m) => m.id);
    for (const id of distributeWorldFacts(facts.n, enabled, rng)) {
      const m = MODE_BY_ID[id];
      plan.push({ poolId: m.poolId, roundId: m.roundId, rounds: 1 });
    }
  }
  return plan;
}
