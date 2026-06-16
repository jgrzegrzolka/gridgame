/**
 * Reconstitute per-device localStorage caches from the post-merge
 * server view, called after a successful link (source flow) or after
 * the GET /api/v1/sync/link discovery (target flow). The whole point
 * of this module is to make `/daily/archive` and the flagQuiz picker
 * actually reflect what the user expects after linking — that the
 * data merged on the server also shows up on whichever browser they
 * happen to be looking at.
 *
 * Two caches to rebuild:
 *
 *   - `daily.scores` (per-puzzle archive blob): for each server row
 *     write `{f: foundCodes.length, t: totalCount, c: foundCodes}`
 *     under the puzzleId. We OVERWRITE, not additively merge, because
 *     the server's row is the post-merge truth (planDailyMerge with
 *     primary='target' keeps target's row if both devices played the
 *     same puzzle; absent that, source's transfers under target's
 *     deviceId). Local + server can never disagree about who played
 *     first — only the server knows the merge happened.
 *
 *   - Quiz personal-best (`flagquiz.best.<variant>.<mode>[.v2][.all]`):
 *     for each configKey in the server's records map, write `{score,
 *     time: durationMs}`. We also OVERWRITE, because planQuizMerge
 *     already picked the best-of-both server-side (via pickBetterEntry).
 *
 * Pure-ish: takes the server payload + a storage object, returns
 * the writes. The HTTP fetch lives in the caller. Tests don't need
 * network OR a real localStorage.
 */

/**
 * @typedef {{ getItem(key: string): string | null, setItem(key: string, value: string): void }} HydrateStore
 */

const DAILY_SCORES_KEY = 'daily.scores';

/**
 * Build a quiz-PB localStorage key from a configKey. Mirrors
 * `bestKey()` in flags/quiz.js exactly — kept in lockstep so future
 * changes to one update the other in the same edit. We don't import
 * the shared `bestKey` because this module is the only consumer that
 * needs to parse the "<variant>:<mode>:<scope>" wire shape, and
 * pushing parsing into quiz.js would couple it to a server format
 * that doesn't belong there.
 *
 * Returns null when configKey doesn't match the expected three-part
 * shape — defensive against malformed server responses (the row
 * wouldn't have been written via the normal client path either way,
 * but a stale backfill could leave odd keys).
 *
 * @param {string} configKey
 * @returns {string | null}
 */
function bestKeyFromConfigKey(configKey) {
  const parts = configKey.split(':');
  if (parts.length !== 3) return null;
  const [variant, mode, scope] = parts;
  if (!variant || !mode || (scope !== 'sov' && scope !== 'all')) return null;
  const base = mode === 'all'
    ? `flagquiz.best.${variant}.${mode}.v2`
    : `flagquiz.best.${variant}.${mode}`;
  return scope === 'all' ? `${base}.all` : base;
}

/**
 * Apply a hydrate payload to local storage. Returns counts (mostly
 * for tests and for the per-call summary the sync page can log).
 *
 * @param {{
 *   store: HydrateStore,
 *   payload: {
 *     daily: Array<{ puzzleId: number, foundCodes: string[], totalCount: number }>,
 *     records: Record<string, { score: number, durationMs: number }>,
 *   },
 * }} args
 * @returns {{ dailyWritten: number, quizWritten: number }}
 */
export function applyHydratePayload({ store, payload }) {
  let dailyWritten = 0;
  let quizWritten = 0;

  // Daily: read the existing scores blob, write each server row into
  // the map, persist once. One read/write per call instead of N writes
  // — the blob is the storage unit, not the individual entries.
  if (Array.isArray(payload.daily) && payload.daily.length > 0) {
    /** @type {Record<number, { f: number, t: number, c?: string[] }>} */
    let scores = {};
    try {
      const raw = store.getItem(DAILY_SCORES_KEY);
      if (typeof raw === 'string') {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          scores = /** @type {any} */ (parsed);
        }
      }
    } catch {
      // Malformed blob — start fresh. Same defensive parse the existing
      // loadScores() uses; preserving the broken JSON would just shadow
      // the hydrate result.
      scores = {};
    }
    for (const row of payload.daily) {
      if (!Number.isInteger(row.puzzleId) || row.puzzleId < 1) continue;
      const codes = Array.isArray(row.foundCodes) ? row.foundCodes : [];
      scores[row.puzzleId] = {
        f: codes.length,
        t: row.totalCount,
        c: codes,
      };
      dailyWritten += 1;
    }
    try {
      store.setItem(DAILY_SCORES_KEY, JSON.stringify(scores));
    } catch {
      // Quota / private-mode write failure — silent. Next hydrate
      // retries; the page meanwhile shows whatever local already had.
    }
  }

  // Quiz: one localStorage key per (variant, mode, scope) tuple. Skip
  // entries we can't parse a key from.
  if (payload.records && typeof payload.records === 'object') {
    for (const [configKey, entry] of Object.entries(payload.records)) {
      if (!entry || typeof entry.score !== 'number' || typeof entry.durationMs !== 'number') continue;
      const key = bestKeyFromConfigKey(configKey);
      if (!key) continue;
      try {
        store.setItem(key, JSON.stringify({ score: entry.score, time: entry.durationMs }));
        quizWritten += 1;
      } catch {
        // Skip this entry; continue with the rest.
      }
    }
  }

  return { dailyWritten, quizWritten };
}

const ENDPOINT = '/api/v1/sync/hydrate';

/**
 * Fetch + apply in one call. Never-throws — every failure mode
 * leaves the local cache untouched.
 *
 * @param {{
 *   deviceId: string,
 *   store: HydrateStore,
 *   fetchImpl?: typeof fetch,
 * }} args
 * @returns {Promise<{ ok: true, dailyWritten: number, quizWritten: number } | { ok: false }>}
 */
export async function hydrateFromServer({ deviceId, store, fetchImpl = globalThis.fetch }) {
  if (!deviceId) return { ok: false };
  let res;
  try {
    res = await fetchImpl(`${ENDPOINT}?deviceId=${encodeURIComponent(deviceId)}`, {
      method: 'GET',
      headers: { accept: 'application/json' },
    });
  } catch {
    return { ok: false };
  }
  if (!res.ok) return { ok: false };
  /** @type {any} */
  let json;
  try { json = await res.json(); } catch { return { ok: false }; }
  const counts = applyHydratePayload({ store, payload: json });
  return { ok: true, ...counts };
}
