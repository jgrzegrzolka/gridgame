/**
 * The game plan for a Flag Party match: an ordered list of segments, each a
 * pool + a round count. Today one game is 5 sovereign rounds then 5
 * non-sovereign rounds, all flag-pick. Modelling it as *data* (not a hardcoded
 * "10 rounds, switch at 6") is the seed of the future settings page, where the
 * host will pick modes and rounds-per-mode — that page just edits this array.
 *
 * The server maps each `poolId` to an actual flag pool (`flags/flagPools.js`);
 * this module stays pure and pool-agnostic.
 *
 * @typedef {{ poolId: string, rounds: number }} Segment
 */

/** @type {Segment[]} */
export const DEFAULT_PLAN = [
  { poolId: 'sovereign', rounds: 5 },
  { poolId: 'nonSovereign', rounds: 5 },
];

/**
 * @param {Segment[]} plan
 * @returns {number}
 */
export function totalRounds(plan) {
  return plan.reduce((sum, seg) => sum + seg.rounds, 0);
}

/**
 * Which pool the given 0-based round draws from. A round index past the end
 * clamps to the last segment's pool — harmless, since the server only
 * generates a question for a round the room will actually play (the extra
 * question on the final round is discarded by `applyNext`).
 *
 * @param {Segment[]} plan
 * @param {number} index
 * @returns {string}
 */
export function poolIdForRound(plan, index) {
  let acc = 0;
  for (const seg of plan) {
    if (index < acc + seg.rounds) return seg.poolId;
    acc += seg.rounds;
  }
  return plan[plan.length - 1].poolId;
}
