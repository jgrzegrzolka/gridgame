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
 *     foundCodes:  string[]                  // 2-letter country codes
 *     totalCount:  int                       // size of puzzle's answer set
 *     durationMs:  int
 *     submittedAt: int                       // unix ms
 *   }
 *
 * Time is injected (not Date.now()-inside) so callers can pin
 * `submittedAt` in tests and so the function stays pure.
 */

/**
 * @param {{
 *   puzzleId: number,
 *   deviceId: string,
 *   foundCodes: string[],
 *   totalCount: number,
 *   durationMs: number,
 *   now: number,
 * }} input
 */
function buildDailyResultDoc({ puzzleId, deviceId, foundCodes, totalCount, durationMs, now }) {
  return {
    id: `${puzzleId}:${deviceId}`,
    puzzleId,
    deviceId,
    foundCodes,
    totalCount,
    durationMs,
    submittedAt: now,
  };
}

module.exports = { buildDailyResultDoc };
