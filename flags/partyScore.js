/**
 * Scoring for a Flag Party round. Pure — no state, no DOM.
 *
 * A round awards a flat {@link CORRECT_POINTS} for any correct answer, plus a
 * decaying speed bonus for the first few correct answers *by arrival order*
 * (the room records buzzes in the order the server received them — see
 * `flags/partyRoom.js` and the "buzz-order is authoritative" note in
 * `PARTY.md`). The speed bonus is suppressed in solo play: with one seat
 * there is no race to reward.
 */

/** Points for any correct answer, regardless of speed. */
export const CORRECT_POINTS = 10;

/**
 * Speed bonus by rank among the correct answers, in arrival order. Index 0 is
 * the first correct answer, 1 the second, and so on; ranks past the end score
 * 0. Tune the curve here — the room and page read it through
 * {@link speedBonusForRank}, never inline.
 *
 * @type {number[]}
 */
export const SPEED_BONUS = [5, 3, 1];

/**
 * @param {number} rank 0-based rank among the correct answers
 * @returns {number}
 */
export function speedBonusForRank(rank) {
  return SPEED_BONUS[rank] ?? 0;
}

/**
 * @typedef {{ playerId: string, correct: boolean }} ScoredBuzz
 */

/** Score multiplier for the game's final block — the block that decides it plays
 *  for double, so a trailing player who chose its terrain (draft) or just gets
 *  hot at the end can still swing the result. */
export const FINAL_BLOCK_MULTIPLIER = 2;

/**
 * Points earned this round, keyed by playerId. `buzzesInOrder` must be in
 * server arrival order — that order is what the speed bonus ranks against.
 * Players who never buzzed simply aren't in the input and score nothing.
 *
 * `multiplier` scales every awarded point (base + speed bonus); it's
 * {@link FINAL_BLOCK_MULTIPLIER} for final-block rounds and 1 everywhere else.
 * A wrong answer scores 0 regardless of the multiplier.
 *
 * @param {ScoredBuzz[]} buzzesInOrder
 * @param {{ applySpeedBonus?: boolean, multiplier?: number }} [opts]
 * @returns {Record<string, number>}
 */
export function scoreRound(buzzesInOrder, { applySpeedBonus = true, multiplier = 1 } = {}) {
  /** @type {Record<string, number>} */
  const points = {};
  let correctRank = 0;
  for (const buzz of buzzesInOrder) {
    if (!buzz.correct) {
      points[buzz.playerId] = 0;
      continue;
    }
    let earned = CORRECT_POINTS;
    if (applySpeedBonus) earned += speedBonusForRank(correctRank);
    points[buzz.playerId] = earned * multiplier;
    correctRank += 1;
  }
  return points;
}
