/**
 * Persisted per-puzzle results for the daily catalog. Stored under a
 * single localStorage key as `{ [n]: { f, t, c?, w? } }` so reading the
 * archive's score column is one parse, not one localStorage call per
 * tile. Short field names keep the serialised blob compact — there
 * will eventually be hundreds of entries.
 *
 * - `f` / `t` — found count / total. Always present. Drives the
 *   archive tile's "5/9" text and gradient.
 * - `c` — list of found country codes. Optional; only present for
 *   puzzles finished after the schema was extended (2026-06-06).
 *   Required to re-render the found/missed flag grids on revisit.
 * - `w` — list of the player's wrong-guess codes (flags they clicked
 *   that weren't answers). Optional; only present when the player made
 *   at least one wrong guess, and only for puzzles finished after the
 *   "Your wrong guesses" section shipped. Drives that section on revisit;
 *   its absence just hides the section (perfect play, or an old record).
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

/** @typedef {{ f: number, t: number, c?: string[], w?: string[], cap?: number }} DailyScore */
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
      if (Array.isArray(obj.w) && obj.w.every((/** @type {unknown} */ x) => typeof x === 'string')) {
        score.w = [...obj.w];
      }
      if (Number.isInteger(obj.cap) && obj.cap > 0) score.cap = obj.cap;
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
 * on revisit. `wrongCodes` is stored only when non-empty (perfect play
 * writes no `w`), so the "Your wrong guesses" section stays hidden unless
 * there were actual wrong guesses to show.
 *
 * @param {{ getItem(key: string): string | null, setItem(key: string, value: string): void }} store
 * @param {number} n
 * @param {number} found
 * @param {number} total
 * @param {string[]} [foundCodes]
 * @param {string[]} [wrongCodes]
 * @param {number} [cap]  wrong-guess budget this run was played under.
 *   Omit for an uncapped run — its absence is the marker `livesFromRecord`
 *   reads to decide whether the revisit screen draws a heart row at all.
 */
export function saveScore(store, n, found, total, foundCodes, wrongCodes, cap) {
  try {
    const scores = loadScores(store);
    if (scores[n]) return; // first-attempt-only: never overwrite
    /** @type {DailyScore} */
    const score = { f: found, t: total };
    if (Array.isArray(foundCodes)) score.c = [...foundCodes];
    if (Array.isArray(wrongCodes) && wrongCodes.length > 0) score.w = [...wrongCodes];
    // Only capped runs carry `cap`. Its absence is what tells the revisit
    // screen "this run had no heart budget, don't draw one" — see
    // `livesFromRecord`.
    if (Number.isInteger(cap) && /** @type {number} */ (cap) > 0) score.cap = cap;
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

/**
 * Rebuild the heart gauge for a finished run, or null when the run had none.
 *
 * The hearts are drawn during play by `startGame`, which never runs on the
 * revisit / archive screen — so without this the row would sit empty for a
 * run that genuinely had a budget. That is what players see most of the
 * time, because once today's puzzle is finished every visit is a revisit.
 *
 * **Why not just `DAILY_LIVES - w.length`.** Pre-cap runs have a `w` list
 * too, and those wrong guesses cost nothing — a perfect 13/13 that took 15
 * wrong guesses would render as "0 hearts", i.e. "you were cut off", about
 * a run that was never at risk. The `cap` field is the marker: absent means
 * uncapped, and uncapped runs draw no gauge at all. Nothing is inferred.
 *
 * The cap is read from the record rather than from the current
 * `DAILY_LIVES`, so changing the constant later can't retroactively rewrite
 * how an old run is drawn.
 *
 * @param {DailyScore | undefined} score
 * @returns {{ max: number, left: number } | null}
 */
export function livesFromRecord(score) {
  if (!score) return null;
  const max = score.cap;
  if (!Number.isInteger(max) || /** @type {number} */ (max) <= 0) return null;
  const spent = Array.isArray(score.w) ? score.w.length : 0;
  return { max: /** @type {number} */ (max), left: Math.max(0, /** @type {number} */ (max) - spent) };
}

/**
 * One-shot migrations applied to a loaded scores blob. Pure — returns
 * a new object and a `changed` flag; the store wrapper below persists.
 *
 * Current migrations:
 * - puzzle1_add_li (2026-06-11): puzzle #1 grew from 9 to 10 answers
 *   when Liechtenstein joined (filter refined with `motif:!coat-of-arms`
 *   after we tagged the 8 European COA-cross flags with `cross`). Past
 *   players' records have `t: 9` and `c` without `"li"` — credit them
 *   with the bonus answer so their archive score doesn't appear to
 *   regress. Trigger `t === 9` is itself the idempotency marker: a
 *   migrated record has `t === 10` and never matches again.
 *
 * @param {DailyScores} scores
 * @returns {{ scores: DailyScores, changed: boolean }}
 */
export function applyScoreMigrations(scores) {
  let changed = false;
  const next = { ...scores };
  // Both migrations below SPREAD the existing record rather than building a
  // fresh literal. Rebuilding silently discards every field the migration
  // doesn't name, and the symptom shows up far from the cause: the original
  // form of this one dropped `w`, and gq_add_star then dropped `cap`, which
  // made the revisit heart row vanish for anyone whose record had been
  // migrated. Add fields to `DailyScore` freely; don't re-introduce a literal.
  const p1 = next[1];
  if (p1 && p1.t === 9) {
    const c = Array.isArray(p1.c) ? [...p1.c] : [];
    if (!c.includes('li')) c.push('li');
    next[1] = { ...p1, f: p1.f + 1, t: 10, c };
    changed = true;
  }
  // gq_add_star (2026-07-20): Equatorial Guinea's six emblem stars were
  // missing from countries.json, so it lacked `star-or-moon` and fell out
  // of two star puzzles — #13 (15 → 16) and #45 (11 → 12). Same credit
  // logic as puzzle1_add_li, plus one thing that migration never had to
  // do: gq may already sit in the player's WRONG list, because it was a
  // rejected guess right up until the fix. Leaving it there would keep
  // the result screen calling a correct answer a mistake, so it moves
  // across rather than merely being appended.
  //
  // `t` is its own idempotency marker, as with puzzle1_add_li: a migrated
  // record carries the new total and never matches again.
  for (const [n, oldTotal, newTotal] of [[13, 15, 16], [45, 11, 12]]) {
    const rec = next[n];
    if (!rec || rec.t !== oldTotal) continue;
    const c = Array.isArray(rec.c) ? [...rec.c] : [];
    if (!c.includes('gq')) c.push('gq');
    /** @type {DailyScore} */
    const patched = { ...rec, f: rec.f + 1, t: newTotal, c };
    if (Array.isArray(rec.w)) patched.w = rec.w.filter((code) => code !== 'gq');
    next[n] = patched;
    changed = true;
  }
  return { scores: next, changed };
}

/**
 * Load, migrate, persist if anything changed. Call once at page boot.
 *
 * @param {{ getItem(key: string): string | null, setItem(key: string, value: string): void }} store
 */
export function migrateScores(store) {
  try {
    const { scores, changed } = applyScoreMigrations(loadScores(store));
    if (changed) store.setItem(STORAGE_KEY, JSON.stringify(scores));
  } catch {
    // localStorage may throw in private mode / zero quota; degrade silently.
  }
}
