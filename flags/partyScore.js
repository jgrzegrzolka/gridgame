/**
 * Scoring for a Flag Party question. Pure — no state, no DOM.
 *
 * A question awards a flat {@link CORRECT_POINTS} for any correct answer, plus a
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
 * Bonus for being the **only** player who got a question right. Knowing the
 * obscure flag alone used to be worth exactly as much as everyone guessing right
 * together. Off in solo play for the same reason the speed bonus is: with one
 * seat there is nobody to be the only one *against*.
 *
 * Deliberately equal to `SPEED_BONUS[0]` — which is exactly why the breakdown
 * now travels on the wire instead of being re-derived from the total: `15` no
 * longer decomposes uniquely. See `flags/partyRoundTally.js`.
 */
export const SOLE_SURVIVOR_BONUS = 5;

/**
 * @typedef {{ playerId: string, correct: boolean }} ScoredBuzz
 * @typedef {{ base: number, speed: number, solo: number, total: number }} Award
 */

/** Score multiplier for the game's final round — the round that decides it plays
 *  for double, so a trailing player who chose its terrain (draft) or just gets
 *  hot at the end can still swing the result. */
export const FINAL_ROUND_MULTIPLIER = 2;

/**
 * Points earned this question, keyed by playerId. `buzzesInOrder` must be in
 * server arrival order — that order is what the speed bonus ranks against.
 * Players who never buzzed simply aren't in the input and score nothing.
 *
 * `multiplier` scales every awarded point (base + speed bonus); it's
 * {@link FINAL_ROUND_MULTIPLIER} for final-round questions and 1 everywhere else.
 * A wrong answer scores 0 regardless of the multiplier.
 *
 * @param {ScoredBuzz[]} buzzesInOrder
 * @param {{ applySpeedBonus?: boolean, applySoloBonus?: boolean, multiplier?: number }} [opts]
 * @returns {Record<string, number>}
 */
export function scoreQuestion(buzzesInOrder, opts = {}) {
  /** @type {Record<string, number>} */
  const points = {};
  for (const [id, award] of Object.entries(scoreQuestionDetailed(buzzesInOrder, opts))) {
    points[id] = award.total;
  }
  return points;
}

/**
 * The same scoring, itemised: what each player earned and *what earned it*.
 *
 * This is the authoritative shape — {@link scoreQuestion} is a projection of it
 * down to totals, kept because the room's seat arithmetic and a good deal of the
 * test suite only ever want the number. The reveal carries the itemised version
 * so the break's chips describe the scoring rules rather than guessing at them
 * from the total (which stopped being decidable once {@link SOLE_SURVIVOR_BONUS}
 * matched `SPEED_BONUS[0]`).
 *
 * `total` is always `base + speed + solo`, so a caller can trust either half of
 * the shape without re-deriving the other.
 *
 * @param {ScoredBuzz[]} buzzesInOrder
 * @param {{ applySpeedBonus?: boolean, applySoloBonus?: boolean, multiplier?: number }} [opts]
 *   `applySoloBonus` defaults to `applySpeedBonus`: both are off in exactly the
 *   same situation (solo play), so a caller that already said "one seat" doesn't
 *   have to say it twice.
 * @returns {Record<string, Award>}
 */
export function scoreQuestionDetailed(
  buzzesInOrder,
  { applySpeedBonus = true, applySoloBonus = applySpeedBonus, multiplier = 1 } = {},
) {
  /** @type {Record<string, Award>} */
  const awards = {};
  // Sole survivor is decided across the whole question, not per buzz, so it has
  // to be counted before any award is handed out. Players who never buzzed
  // aren't in the input at all, so "one correct buzz" already means "one player
  // in the room got it".
  const correctCount = buzzesInOrder.filter((b) => b.correct).length;
  const soloBonus = applySoloBonus && correctCount === 1 ? SOLE_SURVIVOR_BONUS : 0;
  let correctRank = 0;
  for (const buzz of buzzesInOrder) {
    if (!buzz.correct) {
      awards[buzz.playerId] = { base: 0, speed: 0, solo: 0, total: 0 };
      continue;
    }
    const base = CORRECT_POINTS * multiplier;
    const speed = applySpeedBonus ? speedBonusForRank(correctRank) * multiplier : 0;
    const solo = soloBonus * multiplier;
    awards[buzz.playerId] = { base, speed, solo, total: base + speed + solo };
    correctRank += 1;
  }
  return awards;
}
