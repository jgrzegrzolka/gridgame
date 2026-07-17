/**
 * Aggregate quiz counters from a player's `quizRecords` doc.
 *
 * Pure: no DOM, no clock, no Cosmos client. Feeds the Feature O
 * achievement evaluator via `/api/v1/daily/me`.
 *
 * The doc holds one sub-entry per `(variant, mode)` slot, keyed
 * `"<variant>:<mode>"` — plus, until the Phase 1c backfill runs, legacy
 * `"<variant>:<mode>:<sov|all>"` keys from before Feature V. Both shapes are
 * folded together here: variant and mode sit at the same indices either way,
 * and a variant that appears under both shapes counts once (the loop keys its
 * Maps by variant, not by configKey).
 *
 * In `60s` (timed) mode, sub-entry `score` is the number of correct
 * answers — higher is better. In `all` (endurance) mode, `score` is
 * the wrong-guess count — *lower* is better (a perfect round = 0).
 * The compute below splits the records by mode and emits parallel
 * fields per mode:
 *
 *   60s mode →
 *     - `quizAttempts60s`        : sum of `attempts`
 *     - `quizVariantsTouched60s` : distinct variants with any 60s finish
 *     - `quiz60sTouchedVariants` : the names of those variants, sorted.
 *                                  Cartographer needs the names: a count
 *                                  can be reached by any 7 decks, including
 *                                  ones that aren't continents.
 *     - `quizBestScore60s`       : max PB score across every 60s slot
 *     - `quiz60sClearedVariants` : variants where the best 60s PB ≥ sov pool
 *                                  size. A variant with no entry in
 *                                  `sovPoolSizes` can never clear — that's
 *                                  how `weird` is kept out of the released
 *                                  continent badges.
 *
 *   `all` (endurance) mode →
 *     - `quizAttemptsAll`            : sum of `attempts`
 *     - `quizVariantsTouchedAll`     : distinct variants with any endurance finish
 *     - `quizAllLowWrongAny`         : lowest wrong-count across every endurance slot
 *                                      (Number.MAX_SAFE_INTEGER when the player has
 *                                      never finished an endurance round — keeps the
 *                                      "≤ N wrong" predicates from spuriously firing
 *                                      on a never-played snapshot)
 *     - `quizAllPerfectedVariants`   : variants where the best (lowest) endurance
 *                                      wrong count is 0 — a flawless endurance run
 *
 * Defensive on shape: missing `records` returns all-zero / empty.
 * Sub-entries with non-numeric `score` or `attempts` are silently
 * skipped — a future pre-v:1 row shouldn't crash the read path. Real
 * rows from `buildQuizRecordDoc` / `mergeQuizRecord` always have
 * valid values.
 *
 * `sovPoolSizes` is injected (rather than hardcoded here) so the
 * caller can swap in test fixtures and so the source of truth for
 * pool sizes stays in `dailyMe.js` (one place, pinned by a drift
 * detector test in `flags/countries.test.js`).
 */

const NO_ENDURANCE_PLAYS = Number.MAX_SAFE_INTEGER;

/**
 * @typedef {{
 *   records?: Record<string, { score?: unknown, attempts?: unknown }> | null,
 * }} QuizRecordsDoc
 *
 * @typedef {{
 *   quizAttempts60s: number,
 *   quizVariantsTouched60s: number,
 *   quiz60sTouchedVariants: string[],
 *   quizBestScore60s: number,
 *   quiz60sClearedVariants: string[],
 *   quizAttemptsAll: number,
 *   quizVariantsTouchedAll: number,
 *   quizAllLowWrongAny: number,
 *   quizAllPerfectedVariants: string[],
 * }} QuizResult
 */

/**
 * @param {QuizRecordsDoc | null | undefined} doc
 * @param {Record<string, number>} sovPoolSizes  variant key → sov pool size
 * @returns {QuizResult}
 */
function computeQuiz(doc, sovPoolSizes) {
  /** @type {QuizResult} */
  const empty = {
    quizAttempts60s: 0,
    quizVariantsTouched60s: 0,
    quiz60sTouchedVariants: [],
    quizBestScore60s: 0,
    quiz60sClearedVariants: [],
    quizAttemptsAll: 0,
    quizVariantsTouchedAll: 0,
    quizAllLowWrongAny: NO_ENDURANCE_PLAYS,
    quizAllPerfectedVariants: [],
  };
  if (!doc || typeof doc !== 'object' || !doc.records || typeof doc.records !== 'object') {
    return empty;
  }

  let quizAttempts60s = 0;
  let quizBestScore60s = 0;
  let quizAttemptsAll = 0;
  let quizAllLowWrongAny = NO_ENDURANCE_PLAYS;
  // Keyed by variant, not configKey, so a variant's current `europe:60s` and
  // its legacy `europe:60s:sov` / `:all` entries fold into one. Only the best
  // matters for the cleared check — clearing any sweep of the variant proves
  // the same mastery.
  /** @type {Map<string, number>} */
  const best60sByVariant = new Map();
  // Same folding for endurance: a "perfect" round under any of a variant's
  // keys proves the player can name every flag in it, time pressure aside.
  /** @type {Map<string, number>} */
  const lowestWrongAllByVariant = new Map();
  const touched60s = new Set();
  const touchedAll = new Set();

  for (const [configKey, entry] of Object.entries(doc.records)) {
    if (!entry || typeof entry !== 'object') continue;
    const parts = configKey.split(':');
    // Both configKey shapes: "<variant>:<mode>" (current) and the legacy
    // "<variant>:<mode>:<sov|all>". Variant and mode sit at the same indices
    // either way, and the dropped scope segment never fed this compute.
    //
    // This `continue` is load-bearing and silent: a shape this loop can't
    // parse doesn't throw, it just makes every quiz counter read as if the
    // player never played, which would revoke already-earned achievements.
    // Widen the gate BEFORE any client emits a new shape, never after.
    if (parts.length !== 2 && parts.length !== 3) continue;
    const [variant, mode] = parts;

    const score = typeof entry.score === 'number' && Number.isFinite(entry.score) ? entry.score : null;
    const attempts = typeof entry.attempts === 'number' && Number.isFinite(entry.attempts) ? entry.attempts : 0;

    if (mode === '60s') {
      quizAttempts60s += Math.max(0, attempts);
      touched60s.add(variant);
      if (score !== null) {
        if (score > quizBestScore60s) quizBestScore60s = score;
        const prev = best60sByVariant.get(variant) ?? -Infinity;
        if (score > prev) best60sByVariant.set(variant, score);
      }
    } else if (mode === 'all') {
      quizAttemptsAll += Math.max(0, attempts);
      touchedAll.add(variant);
      if (score !== null) {
        if (score < quizAllLowWrongAny) quizAllLowWrongAny = score;
        const prev = lowestWrongAllByVariant.get(variant) ?? Infinity;
        if (score < prev) lowestWrongAllByVariant.set(variant, score);
      }
    }
    // Any other mode (future-proofing) is silently ignored.
  }

  const cleared = [];
  for (const [variant, best] of best60sByVariant) {
    const threshold = sovPoolSizes[variant];
    if (typeof threshold === 'number' && best >= threshold) cleared.push(variant);
  }
  cleared.sort();

  const perfected = [];
  for (const [variant, lowest] of lowestWrongAllByVariant) {
    if (lowest === 0) perfected.push(variant);
  }
  perfected.sort();

  return {
    quizAttempts60s,
    quizVariantsTouched60s: touched60s.size,
    // Feature V: the NAMES, not just the count. Cartographer claims "tried
    // every 60s variant", which a bare count only expressed while exactly
    // seven variants existed — the `weird` deck made eight and let a player
    // skip a continent and still hit 7. Any future deck would do the same, so
    // the predicate has to name what it wants.
    quiz60sTouchedVariants: [...touched60s].sort(),
    quizBestScore60s,
    quiz60sClearedVariants: cleared,
    quizAttemptsAll,
    quizVariantsTouchedAll: touchedAll.size,
    quizAllLowWrongAny,
    quizAllPerfectedVariants: perfected,
  };
}

module.exports = { computeQuiz, NO_ENDURANCE_PLAYS };
