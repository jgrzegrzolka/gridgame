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
 * **Requires an actual race** — see {@link scoreQuestionDetailed}. If only one
 * player got the question right they were "first" by default, having beaten
 * nobody, so no speed bonus is paid.
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
 * Was this award the **first** correct answer — the one seat that actually won
 * the race? Drives the reveal's "⚡ Fastest" badge.
 *
 * Exists because the badge was rendered on `award.speed > 0`, and
 * {@link SPEED_BONUS} pays the first THREE correct answers (5 / 3 / 1). So a
 * question three people got right tagged all three as Fastest, which is how a
 * real game showed two winners of the same race. The seats behind still keep
 * their speed points; they are simply not called first.
 *
 * Identified by the bonus's VALUE rather than by a rank threaded through the
 * wire: `SPEED_BONUS[0]` is its unique maximum, so matching it picks out rank 0
 * exactly. That soundness depends on the curve strictly decreasing, which a test
 * pins — change {@link SPEED_BONUS} to a curve with a repeated first entry and
 * that test fails rather than the badge quietly doubling up again.
 *
 * @param {{ speed: number } | undefined | null} award
 * @returns {boolean}
 */
export function wasFastest(award) {
  return !!award && award.speed === SPEED_BONUS[0];
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
 * Points by how close a wrong answer was, for questions that rank their options
 * rather than just marking one right — today that is the world-facts
 * (superlative) question, where the four flags have a true order and picking the
 * second-biggest is real knowledge rather than a miss.
 *
 * Index is the pick's rank in the question's own direction: 0 is the answer, 1
 * the runner-up, and so on. **Index 0 is listed for readability only** — a
 * correct pick is paid through `base`, never through closeness, so that the
 * meaning of `base` ("you were right") survives. The two agree by construction:
 * `CLOSENESS_LADDER[0] === CORRECT_POINTS`, pinned by a test.
 *
 * The cost of this curve, measured over 2,000 simulated 5-question rounds
 * against the previous all-or-nothing scoring: a player who knows the answer
 * scores 2.4x what a random tapper scores, down from 4.0x. In exchange, rounds
 * ending in a dead heat for first fall from ~31% to ~11%, because six possible
 * round totals become thirty-five. Closer boards, far fewer ties. That trade was
 * made deliberately (Jan, 2026-07-19); if the game starts feeling flat, raise
 * this curve rather than adding a separate skill bonus.
 *
 * @type {number[]}
 */
export const CLOSENESS_LADDER = [CORRECT_POINTS, 5, 2, 0];

/**
 * Closeness points for a pick at `rank` (0 = the answer). Rank 0 and anything
 * out of range score 0: a correct pick is paid as `base`, and a question with no
 * ranking (flag-pick, map-pick) passes no rank at all.
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
 * right or wrong, nothing in between" — which is every question but the
 * world-facts one, and is why closeness can be added without touching flag-pick
 * or map-pick scoring at all.
 *
 * @typedef {{ playerId: string, correct: boolean, rank?: number }} ScoredBuzz
 * @typedef {{ base: number, speed: number, solo: number, closeness: number, total: number }} Award
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
 * down to totals, kept because the room's seat arithmetic and a good deal of the
 * test suite only ever want the number. The reveal carries the itemised version
 * so the break's chips describe the scoring rules rather than guessing at them
 * from the total (which stopped being decidable once {@link SOLE_SURVIVOR_BONUS}
 * matched `SPEED_BONUS[0]`).
 *
 * `total` is always `base + speed + solo + closeness`, so a caller can trust
 * either half of the shape without re-deriving the other. `base` and `closeness`
 * are mutually exclusive by construction: you were either right (base) or near
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
  // Sole survivor is decided across the whole question, not per buzz, so it has
  // to be counted before any award is handed out. Players who never buzzed
  // aren't in the input at all, so "one correct buzz" already means "one player
  // in the room got it".
  const correctCount = buzzesInOrder.filter((b) => b.correct).length;
  const soloBonus = applySoloBonus && correctCount === 1 ? SOLE_SURVIVOR_BONUS : 0;
  // No race, no race bonus. A lone correct answer is "first" having beaten
  // nobody, so paying it SPEED_BONUS[0] rewarded a race that never happened —
  // and it stacked with the sole-survivor bonus, making that question worth 20
  // against everyone else's 0. Measured at 24% of questions in a four-player
  // game, which made it the single most common way a scoreboard blew open.
  //
  // Every other outcome already tops out at a 15-point swing (15/13/11/0,
  // 15/13/0/0). Dropping this makes the sole-survivor case 15/0/0/0 and the
  // maximum swing uniform, which is the same answer the race logic gives on its
  // own. The sole-survivor bonus itself is untouched: knowing something nobody
  // else did is still worth SOLE_SURVIVOR_BONUS, it just no longer collects a
  // sprint medal for running alone.
  const raced = correctCount > 1;
  let correctRank = 0;
  for (const buzz of buzzesInOrder) {
    if (!buzz.correct) {
      // A wrong pick can still pay, if the question ranked its options and this
      // one landed near the top. Deliberately gets no speed bonus: speed ranks
      // among CORRECT answers, so paying it here would reward buzzing fast on a
      // question you didn't know.
      const closeness = closenessForRank(buzz.rank);
      awards[buzz.playerId] = { base: 0, speed: 0, solo: 0, closeness, total: closeness };
      continue;
    }
    const base = CORRECT_POINTS;
    const speed = applySpeedBonus && raced ? speedBonusForRank(correctRank) : 0;
    const solo = soloBonus;
    awards[buzz.playerId] = {
      base, speed, solo, closeness: 0, total: base + speed + solo,
    };
    correctRank += 1;
  }
  return awards;
}
