/**
 * Aggregate mastery counters from a player's daily submission rows.
 *
 * Pure: no DOM, no clock, no Cosmos client. Feeds the Feature O
 * achievement evaluator via `/api/v1/daily/me`.
 *
 *   - `cleanSweeps` — count of submissions where the player found
 *     every answer (`foundCodes.length === totalCount`). The
 *     equivalent of "you 100%'d a puzzle". A second clean sweep on
 *     the *same* puzzle (replay path) increments this — the rule's
 *     job is to count *moments of mastery*, not unique puzzles.
 *
 *   - `flawlessSweeps` — clean sweep AND zero wrong guesses
 *     (`wrongCodes.length === 0`). The "Flawless Sweep" achievement —
 *     harder than a clean sweep because every guess has to land
 *     in the target set, no spaghetti-throwing.
 *
 *   - `attemptedFinishes` — "you played, you tried, you missed some".
 *     Found at least one flag AND made at least one wrong guess.
 *     Captures the realistic middle of the daily playerbase: not
 *     sweep-tier, not zero-score, just intentional play with
 *     imperfect execution. Drives the casual engagement tier
 *     (Honest Attempt → Hundred Honest Attempts).
 *
 *   - `zeroScoreFinishes` — count of submissions where the player
 *     submitted with no found answers (`foundCodes.length === 0`).
 *     The "we've all been there" badge ships with `>= 1`. Captured
 *     as a number not a boolean so a future "ten brick walls" tier
 *     doesn't need a schema change.
 *
 * Defensive on shape: rows missing `foundCodes` or `totalCount`, or
 * with non-array `foundCodes`, are silently skipped — a future
 * pre-v:1 row shouldn't crash the read path. Real rows from
 * `buildDailyResultDoc` always have valid values. `wrongCodes` is
 * tolerated as either missing or non-array — a row without it is
 * treated as "we don't know whether it was flawless" and doesn't
 * count toward flawlessSweeps or attemptedFinishes. Real rows
 * always carry it.
 */

/**
 * @typedef {{
 *   foundCodes?: unknown,
 *   wrongCodes?: unknown,
 *   totalCount?: unknown,
 * }} MasteryRow
 *
 * @typedef {{
 *   cleanSweeps: number,
 *   flawlessSweeps: number,
 *   attemptedFinishes: number,
 *   zeroScoreFinishes: number,
 * }} MasteryResult
 */

/**
 * @param {MasteryRow[]} docs
 * @returns {MasteryResult}
 */
function computeMastery(docs) {
  let cleanSweeps = 0;
  let flawlessSweeps = 0;
  let attemptedFinishes = 0;
  let zeroScoreFinishes = 0;
  if (!Array.isArray(docs)) return { cleanSweeps, flawlessSweeps, attemptedFinishes, zeroScoreFinishes };
  for (const doc of docs) {
    if (!doc || typeof doc !== 'object') continue;
    const found = doc.foundCodes;
    const wrong = doc.wrongCodes;
    const total = doc.totalCount;
    if (!Array.isArray(found)) continue;
    if (typeof total !== 'number' || !Number.isFinite(total)) continue;
    if (found.length === 0) zeroScoreFinishes++;
    else if (found.length === total) {
      cleanSweeps++;
      if (Array.isArray(wrong) && wrong.length === 0) flawlessSweeps++;
    }
    // attemptedFinishes is orthogonal to clean/flawless — counts any
    // submission with at least one found AND at least one wrong. A
    // clean sweep that had wrong guesses on the way still qualifies
    // (the player did intentionally play, errors and all).
    if (Array.isArray(wrong) && found.length >= 1 && wrong.length >= 1) {
      attemptedFinishes++;
    }
  }
  return { cleanSweeps, flawlessSweeps, attemptedFinishes, zeroScoreFinishes };
}

module.exports = { computeMastery };
