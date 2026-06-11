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
 *     v:           1                         // schema version — set unconditionally on every native
 *                                            //   write. Migration playbook: when the shape changes,
 *                                            //   ship a backfill that fills the new field with a
 *                                            //   sensible default on prior rows AND sets
 *                                            //   `backfilled: true` on touched rows. See
 *                                            //   infra/operations.md "Cosmos data migration policy".
 *     local?:      true                      // OPTIONAL — present only when the server detected a
 *                                            //   localhost request (npm run dev:swa). Aggregator
 *                                            //   filters these out of community stats. Owner-side
 *                                            //   `SELECT * FROM c WHERE c.local = true` query
 *                                            //   finds dev pollution for manual cleanup.
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
 * `local` is added to the doc ONLY when the caller passes `true`. Prod
 * traffic never has the field; local-dev traffic always does. Absence
 * = "prod or pre-feature"; presence = "definitely a dev row".
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
 *   local?: boolean,
 * }} input
 */
function buildDailyResultDoc({ puzzleId, deviceId, foundCodes, wrongCodes = [], totalCount, durationMs, now, local }) {
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
    v: 1,
  };
  if (local === true) doc.local = true;
  return doc;
}

module.exports = { buildDailyResultDoc };
