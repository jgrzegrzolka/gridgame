/**
 * The game plan for a Flag Party match: an ordered list of segments, each a
 * pool + a round type + a round count. Today one game is 3 sovereign flag-pick,
 * 3 non-sovereign flag-pick, then 5 sovereign map rounds. Modelling it as *data*
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
  { poolId: 'sovereign', roundId: 'flagPick', rounds: 3 },
  { poolId: 'nonSovereign', roundId: 'flagPick', rounds: 3 },
  { poolId: 'sovereign', roundId: 'mapPick', rounds: 5 },
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
