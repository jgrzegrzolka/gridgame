/**
 * Persisted per-puzzle results for the daily catalog. Stored under a
 * single localStorage key as `{ [n]: { f, t, c? } }` so reading the
 * archive's score column is one parse, not one localStorage call per
 * tile. Short field names keep the serialised blob compact — there
 * will eventually be hundreds of entries.
 *
 * - `f` / `t` — found count / total. Always present. Drives the
 *   archive tile's "5/9" text and gradient.
 * - `c` — list of found country codes. Optional; only present for
 *   puzzles finished after the schema was extended (2026-06-06).
 *   Required to re-render the found/missed flag grids on revisit.
 *
 * **First-attempt-only:** `saveScore` is a no-op when a record already
 * exists for that N. The archive shows "your first attempt" — replays
 * can't overwrite it. Mirrors the server-side rule (insert-only Cosmos,
 * 409 on duplicate (puzzleId, deviceId)) so local and Cosmos stay in
 * lockstep on the same "first attempt wins" promise.
 *
 * Previous behavior (before this change): last-result-wins — replays
 * overwrote the archive entry. Flipped to first-attempt because the
 * server-side rule is the long-term intended honesty rule, and a
 * mismatch between client and server semantics confused players in
 * testing (Cosmos kept their first attempt; local showed their replay).
 */

export const STORAGE_KEY = 'daily.scores';

/** @typedef {{ f: number, t: number, c?: string[] }} DailyScore */
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
      scores[n] = score;
    }
    return scores;
  } catch {
    return {};
  }
}

/**
 * Save a score for puzzle N — but only if there's no existing record
 * for that N. Replays are silently dropped so the archive locks in the
 * player's first attempt (see the file header for the first-attempt
 * rule and why it's there).
 *
 * The optional `foundCodes` argument makes the saved record "full" —
 * without it only the {f, t} headline is kept, which is enough for the
 * archive's score column but not enough to re-render the result page
 * on revisit.
 *
 * @param {{ getItem(key: string): string | null, setItem(key: string, value: string): void }} store
 * @param {number} n
 * @param {number} found
 * @param {number} total
 * @param {string[]} [foundCodes]
 */
export function saveScore(store, n, found, total, foundCodes) {
  try {
    const scores = loadScores(store);
    if (scores[n]) return; // first-attempt-only: never overwrite
    /** @type {DailyScore} */
    const score = { f: found, t: total };
    if (Array.isArray(foundCodes)) score.c = [...foundCodes];
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
 * page (puzzle finished AND we have the codes the player found).
 * Old `{f, t}`-only records return false — the player will replay
 * them, then the next save captures the full shape.
 *
 * @param {DailyScore | undefined} score
 * @returns {score is DailyScore & { c: string[] }}
 */
export function isCompleteRecord(score) {
  return !!score && Array.isArray(score.c);
}
