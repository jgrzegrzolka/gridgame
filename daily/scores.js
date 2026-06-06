/**
 * Persisted per-puzzle results for the daily catalog. Stored under a
 * single localStorage key as `{ [n]: { f, t, c?, ms? } }` so reading
 * the archive's score column is one parse, not one localStorage call
 * per tile. Short field names keep the serialised blob compact —
 * there will eventually be hundreds of entries.
 *
 * - `f` / `t` — found count / total. Always present. Drives the
 *   archive tile's "5/9" text and gradient.
 * - `c` — list of found country codes. Optional; only present for
 *   puzzles finished after the schema was extended (2026-06-06).
 *   Required to re-render the found/missed flag grids on revisit.
 * - `ms` — elapsed milliseconds. Optional; required to re-render
 *   the time line on revisit.
 *
 * Daily is play-once: replaying an old puzzle overwrites that N's
 * record rather than tracking a best-of. The archive shows "your
 * last result", which is what the player remembers.
 */

const STORAGE_KEY = 'daily.scores';

/** @typedef {{ f: number, t: number, c?: string[], ms?: number }} DailyScore */
/** @typedef {Record<number, DailyScore>} DailyScores */

/**
 * @param {{ getItem(key: string): string | null }} store
 * @returns {DailyScores}
 */
export function loadScores(store) {
  try {
    const raw = store.getItem(STORAGE_KEY);
    if (raw === null) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    /** @type {DailyScores} */
    const scores = {};
    for (const [k, v] of Object.entries(parsed)) {
      const n = Number(k);
      if (!Number.isInteger(n) || n < 1) continue;
      const obj = /** @type {any} */ (v);
      if (!obj || typeof obj.f !== 'number' || typeof obj.t !== 'number') continue;
      /** @type {DailyScore} */
      const score = { f: obj.f, t: obj.t };
      if (Array.isArray(obj.c) && obj.c.every((/** @type {unknown} */ x) => typeof x === 'string')) {
        score.c = [...obj.c];
      }
      if (typeof obj.ms === 'number' && obj.ms >= 0) {
        score.ms = obj.ms;
      }
      scores[n] = score;
    }
    return scores;
  } catch {
    return {};
  }
}

/**
 * Save a score for puzzle N. Always overwrites. The optional
 * `foundCodes` and `elapsedMs` arguments make the saved record
 * "full" — without them only the {f, t} headline is kept, which is
 * enough for the archive's score column but not enough to re-render
 * the result page on revisit.
 *
 * @param {{ getItem(key: string): string | null, setItem(key: string, value: string): void }} store
 * @param {number} n
 * @param {number} found
 * @param {number} total
 * @param {string[]} [foundCodes]
 * @param {number} [elapsedMs]
 */
export function saveScore(store, n, found, total, foundCodes, elapsedMs) {
  try {
    const scores = loadScores(store);
    /** @type {DailyScore} */
    const score = { f: found, t: total };
    if (Array.isArray(foundCodes)) score.c = [...foundCodes];
    if (typeof elapsedMs === 'number' && elapsedMs >= 0) score.ms = elapsedMs;
    scores[n] = score;
    store.setItem(STORAGE_KEY, JSON.stringify(scores));
  } catch {
    // localStorage may throw in private mode / zero quota; degrade silently.
  }
}

/**
 * Render a score as "found/total", or null when there's nothing to render.
 *
 * @param {DailyScore | undefined} score
 * @returns {string | null}
 */
export function formatScore(score) {
  return score ? `${score.f}/${score.t}` : null;
}

/**
 * True iff the saved record is rich enough to re-render the result
 * page (puzzle finished AND we have both the codes the player found
 * and the elapsed time). Old `{f, t}`-only records return false —
 * the player will replay them, then the next save captures the full
 * shape.
 *
 * @param {DailyScore | undefined} score
 * @returns {score is DailyScore & { c: string[], ms: number }}
 */
export function isCompleteRecord(score) {
  return (
    !!score &&
    Array.isArray(score.c) &&
    typeof score.ms === 'number'
  );
}
