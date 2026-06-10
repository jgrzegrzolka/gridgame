/**
 * Pure builder for the Cosmos document we insert into `dailyResults`
 * when a player finishes a daily puzzle. Kept out of the handler so
 * the field shape + id format have one tested home.
 *
 * Document shape (from FEATURE.md):
 *   {
 *     id:          "{puzzleId}:{deviceId}",  // unique key for the row
 *     puzzleId:    int,
 *     deviceId:    string (UUID),
 *     foundCodes:  string[]                  // 2-letter country codes the player found
 *     wrongCodes:  string[]                  // real countries the player tried that weren't targets
 *     totalCount:  int                       // size of puzzle's answer set
 *     durationMs:  int
 *     submittedAt: int                       // unix ms
 *     incognito?:  boolean                   // OPTIONAL — present only when the client's storage-quota
 *                                            //   heuristic resolved a value. Diagnostic for owner-side
 *                                            //   cleanup of test pollution. Aggregator never filters on it.
 *   }
 *
 * Time is injected (not Date.now()-inside) so callers can pin
 * `submittedAt` in tests and so the function stays pure.
 *
 * `wrongCodes` defaults to `[]` when the caller doesn't supply it
 * (older cached clients during a deploy window). Stored unconditionally
 * so future analytics ("most-wrong-guessed today", "your distractors")
 * have data from every submission instead of having to backfill.
 *
 * `incognito` is added to the doc ONLY when the caller passed a boolean,
 * so rows from clients that don't compute the heuristic (legacy cached,
 * or browsers without the Storage API) don't carry a misleading `false`.
 * Queries should treat absence as "unknown".
 */

/**
 * @param {{
 *   puzzleId: number,
 *   deviceId: string,
 *   foundCodes: string[],
 *   wrongCodes?: string[],
 *   totalCount: number,
 *   durationMs: number,
 *   now: number,
 *   incognito?: boolean,
 * }} input
 */
function buildDailyResultDoc({ puzzleId, deviceId, foundCodes, wrongCodes = [], totalCount, durationMs, now, incognito }) {
  /** @type {Record<string, unknown>} */
  const doc = {
    id: `${puzzleId}:${deviceId}`,
    puzzleId,
    deviceId,
    foundCodes,
    wrongCodes,
    totalCount,
    durationMs,
    submittedAt: now,
  };
  if (typeof incognito === 'boolean') doc.incognito = incognito;
  return doc;
}

module.exports = { buildDailyResultDoc };
