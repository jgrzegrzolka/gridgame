/**
 * Aggregate quiz counters from a player's `quizRecords` doc.
 *
 * Pure: no DOM, no clock, no Cosmos client. Feeds the Feature O
 * achievement evaluator via `/api/v1/daily/me`.
 *
 *   - `quizAttempts60s` — sum of `attempts` across every configKey
 *     whose mode segment is `60s`. Total finishes ever, PB or not.
 *
 *   - `quizVariantsTouched60s` — count of distinct variants the
 *     player has finished a 60s round of (any `includeAll` value).
 *     Drives "tried every variant" achievements.
 *
 *   - `quizBestScore60s` — max PB score across every 60s configKey.
 *     Drives the skill-threshold tier (Quick Recall / Snap
 *     Recognition / Flag Whisperer).
 *
 *   - `quiz60sClearedVariants` — variants where the best 60s PB
 *     (across both `includeAll` values) meets or exceeds the
 *     variant's sov pool size. "You named every flag in this
 *     continent within 60 s." Returned as a sorted array; tests pin
 *     ordering so a future ordering refactor can't quietly change
 *     iteration order for downstream consumers.
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

/**
 * @typedef {{
 *   records?: Record<string, { score?: unknown, attempts?: unknown }> | null,
 * }} QuizRecordsDoc
 *
 * @typedef {{
 *   quizAttempts60s: number,
 *   quizVariantsTouched60s: number,
 *   quizBestScore60s: number,
 *   quiz60sClearedVariants: string[],
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
    quizBestScore60s: 0,
    quiz60sClearedVariants: [],
  };
  if (!doc || typeof doc !== 'object' || !doc.records || typeof doc.records !== 'object') {
    return empty;
  }

  let quizAttempts60s = 0;
  let quizBestScore60s = 0;
  // Per-variant best PB across `:sov` and `:all` configKeys; only the
  // higher of the two matters for the cleared-variants check (clearing
  // either pool sweep proves the same mastery).
  /** @type {Map<string, number>} */
  const bestByVariant = new Map();
  const touchedVariants = new Set();

  for (const [configKey, entry] of Object.entries(doc.records)) {
    if (!entry || typeof entry !== 'object') continue;
    const parts = configKey.split(':');
    if (parts.length !== 3) continue;
    const [variant, mode] = parts;
    if (mode !== '60s') continue;

    const score = typeof entry.score === 'number' && Number.isFinite(entry.score) ? entry.score : null;
    const attempts = typeof entry.attempts === 'number' && Number.isFinite(entry.attempts) ? entry.attempts : 0;

    quizAttempts60s += Math.max(0, attempts);
    touchedVariants.add(variant);

    if (score !== null) {
      if (score > quizBestScore60s) quizBestScore60s = score;
      const prev = bestByVariant.get(variant) ?? -Infinity;
      if (score > prev) bestByVariant.set(variant, score);
    }
  }

  const cleared = [];
  for (const [variant, best] of bestByVariant) {
    const threshold = sovPoolSizes[variant];
    if (typeof threshold === 'number' && best >= threshold) cleared.push(variant);
  }
  cleared.sort();

  return {
    quizAttempts60s,
    quizVariantsTouched60s: touchedVariants.size,
    quizBestScore60s,
    quiz60sClearedVariants: cleared,
  };
}

module.exports = { computeQuiz };
