/**
 * Scoring for a Flag Party question. Pure — no state, no DOM.
 *
 * A question pays from four buckets: a flat {@link CORRECT_POINTS} for being
 * right, a {@link speedBonusForRank speed bonus} that ranks the correct answers
 * by how quickly they arrived, a {@link SOLE_SURVIVOR_BONUS} for being the only
 * one right, and — on questions whose options have a true order (world facts) —
 * {@link CLOSENESS_LADDER closeness} points for a near miss. The speed and solo
 * bonuses are suppressed in solo play: with one seat there is no race and no
 * "only one" to be.
 *
 * The rebalance (Jan, 2026-07-22): the flat base used to dwarf everything, so an
 * easy mode where everyone is right (spot-the-flag) came down to a tiny 5/3/1
 * garnish and being quick barely mattered. The speed ladder is now **sized to
 * how many got it right**, so it reaches every correct seat and grows with the
 * race — a big field makes speed the deciding factor, a small one leaves the
 * base (knowing) in charge. See {@link speedBonusForRank}.
 */

/** Points for a correct answer on a right/wrong question (flag-pick, map-pick,
 *  spot-the-flag). Ranked questions score through {@link CLOSENESS_LADDER}
 *  instead — see {@link scoreQuestionDetailed}. */
export const CORRECT_POINTS = 5;

/**
 * Speed bonus for the correct answer at 0-based arrival `rank`, among
 * `correctCount` correct answers. Unlike the old fixed 5/3/1 (which paid only the
 * first three), this pays **every** correct seat and stretches with the race: the
 * slowest correct answer scores 0 and each place up is worth one more, with a
 * **winner bump** so first place always clears second by two.
 *
 *   correctCount 6 -> 6/4/3/2/1/0 by arrival   ·   3 -> 3/1/0   ·   2 -> 2/0
 *
 * That is what makes an easy mode a genuine race and a hard mode still mostly
 * about knowing: with K correct the fastest earns K, so the speed spread grows
 * exactly when correctness stops being the scarce thing.
 *
 * No race, no bonus: `correctCount < 2` pays 0 for everyone (a lone correct
 * answer was "first" having beaten nobody).
 *
 * @param {number} rank 0-based arrival rank among the correct answers
 * @param {number} correctCount how many got it right (the size of the race)
 * @returns {number}
 */
export function speedBonusForRank(rank, correctCount) {
  if (correctCount < 2) return 0; // no race
  if (rank < 0 || rank >= correctCount) return 0;
  if (rank === 0) return correctCount; // winner bump: first clears second by two
  return correctCount - 1 - rank;
}

/**
 * Was this award the **first** correct answer — the one seat that actually won
 * the race? Drives the reveal's "⚡ Fastest" badge.
 *
 * Now an explicit flag on the award rather than an inference from the bonus's
 * value: once the ladder became {@link speedBonusForRank sized to the race}, the
 * winner's bonus is no longer a fixed constant (it is `correctCount`), so there
 * is nothing global to compare against. `scoreQuestionDetailed` sets `fastest`
 * on exactly the rank-0 correct buzz of a real race, and the reveal reads it.
 *
 * @param {{ fastest?: boolean } | undefined | null} award
 * @returns {boolean}
 */
export function wasFastest(award) {
  return !!(award && award.fastest);
}

/**
 * Bonus for being the **only** player who got a question right. Knowing the
 * obscure flag alone. Off in solo play for the same reason the speed bonus is:
 * with one seat there is nobody to be the only one *against*.
 *
 * Deliberately small (1). The old value (5, equal to the old first speed bonus)
 * made a lucky lone-correct on a hard question worth as much as a clean race win
 * and was the single biggest way a scoreboard blew open. Being uniquely right is
 * still recognised, it just no longer swings the board.
 */
export const SOLE_SURVIVOR_BONUS = 1;

/**
 * Points for a pick on a ranked question (world facts), by the pick's rank in the
 * question's own direction: index 0 the exact answer, then runner-up, third,
 * fourth. A ranked question pays partial credit because picking the second-biggest
 * is real knowledge rather than a miss.
 *
 * **Index 0 is the exact answer** and is paid as `base` (see
 * {@link scoreQuestionDetailed}), so it reads as "you were right", not
 * "closeness". It is a touch above {@link CORRECT_POINTS} (6 vs 5) on purpose:
 * reading a four-way ranking is a harder ask than a right/wrong flag. Crucially
 * it sits **above** the runner-up (3), so being exactly right always out-scores
 * being close.
 *
 * @type {number[]}
 */
export const CLOSENESS_LADDER = [6, 3, 2, 0];

/**
 * Closeness points for a *wrong* pick at `rank` (0 = the answer). Rank 0 and
 * anything out of range score 0: a correct pick is paid as `base`, and a question
 * with no ranking (flag-pick, map-pick) passes no rank at all.
 *
 * @param {number | undefined} rank 0-based rank of the pick in the question's ranking
 * @returns {number}
 */
export function closenessForRank(rank) {
  if (typeof rank !== 'number' || !Number.isInteger(rank) || rank <= 0) return 0;
  return CLOSENESS_LADDER[rank] ?? 0;
}

/**
 * `rank` is the pick's 0-based position in the question's ranking, and is only
 * present for questions that HAVE a ranking. Absent means "this question is
 * right or wrong, nothing in between" — every question but the world-facts one.
 *
 * @typedef {{ playerId: string, correct: boolean, rank?: number }} ScoredBuzz
 * @typedef {{ base: number, speed: number, solo: number, closeness: number, fastest: boolean, total: number }} Award
 */

/**
 * Points earned this question, keyed by playerId. `buzzesInOrder` must be in
 * server arrival order — that order is what the speed bonus ranks against.
 * Players who never buzzed simply aren't in the input and score nothing.
 *
 * @param {ScoredBuzz[]} buzzesInOrder
 * @param {{ applySpeedBonus?: boolean, applySoloBonus?: boolean }} [opts]
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
 * down to totals. The reveal carries the itemised version so the break's chips
 * describe the scoring rules rather than inferring them from the total.
 *
 * `total` is always `base + speed + solo + closeness`. `base` and `closeness` are
 * mutually exclusive by construction: you were either right (base) or near
 * (closeness), never both.
 *
 * @param {ScoredBuzz[]} buzzesInOrder
 * @param {{ applySpeedBonus?: boolean, applySoloBonus?: boolean }} [opts]
 *   `applySoloBonus` defaults to `applySpeedBonus`: both are off in exactly the
 *   same situation (solo play), so a caller that already said "one seat" doesn't
 *   have to say it twice.
 * @returns {Record<string, Award>}
 */
export function scoreQuestionDetailed(
  buzzesInOrder,
  { applySpeedBonus = true, applySoloBonus = applySpeedBonus } = {},
) {
  /** @type {Record<string, Award>} */
  const awards = {};
  // Sole survivor and the size of the race are both decided across the whole
  // question, so count the correct answers before handing out any award. Players
  // who never buzzed aren't in the input, so "one correct buzz" already means
  // "one player in the room got it".
  const correctCount = buzzesInOrder.filter((b) => b.correct).length;
  const soloBonus = applySoloBonus && correctCount === 1 ? SOLE_SURVIVOR_BONUS : 0;
  const raced = correctCount > 1;
  let correctRank = 0;
  for (const buzz of buzzesInOrder) {
    if (!buzz.correct) {
      // A wrong pick can still pay, if the question ranked its options and this
      // one landed near the top. Never earns speed: speed ranks among CORRECT
      // answers, so paying it here would reward buzzing fast on a question you
      // didn't know.
      const closeness = closenessForRank(buzz.rank);
      awards[buzz.playerId] = { base: 0, speed: 0, solo: 0, closeness, fastest: false, total: closeness };
      continue;
    }
    // A ranked question pays the exact answer (its rank is 0) through the top of
    // the closeness ladder; a right/wrong question pays the flat CORRECT_POINTS.
    // Both mean "you were right", so both land in `base`.
    const base = typeof buzz.rank === 'number' ? CLOSENESS_LADDER[0] : CORRECT_POINTS;
    const speed = applySpeedBonus && raced ? speedBonusForRank(correctRank, correctCount) : 0;
    const fastest = applySpeedBonus && raced && correctRank === 0;
    awards[buzz.playerId] = {
      base, speed, solo: soloBonus, closeness: 0, fastest, total: base + speed + soloBonus,
    };
    correctRank += 1;
  }
  return awards;
}
