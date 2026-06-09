/**
 * Aggregate a list of daily-result rows into the shape rendered by the
 * client. Pure: no I/O, no time, no globals.
 *
 * Each row is the subset of a Cosmos doc we query for:
 *   { foundCodes: string[], totalCount: number }
 *
 * The server only stores the player's *first* submission per puzzle
 * (the insert handler 409s on duplicates), so these rows already
 * represent honest first-attempt-per-device data — the aggregator
 * doesn't need to dedupe.
 *
 * Returns:
 *   {
 *     totalAttempts: number,                  // rows.length
 *     perCodeFinds: { [code]: number },       // count per code across all rows
 *     median: number,                         // median of foundCodes.length
 *     topPct: number,                         // % of rows where they got everything (0–100, int)
 *   }
 */

function aggregate(rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return { totalAttempts: 0, perCodeFinds: {}, median: 0, topPct: 0 };
  }

  const perCodeFinds = {};
  const lengths = [];
  let totalCount = 0;

  for (const row of rows) {
    const codes = row.foundCodes || [];
    for (const code of codes) {
      perCodeFinds[code] = (perCodeFinds[code] || 0) + 1;
    }
    lengths.push(codes.length);
    // Every row for one puzzle should report the same totalCount; we
    // take the first non-zero value we see and use it for the "perfect"
    // check below. Done in a separate pass so rows that arrive before
    // we've learned totalCount still get evaluated correctly.
    if (!totalCount && typeof row.totalCount === 'number' && row.totalCount > 0) {
      totalCount = row.totalCount;
    }
  }

  lengths.sort((a, b) => a - b);
  const mid = Math.floor(lengths.length / 2);
  const median = lengths.length % 2 === 0
    ? (lengths[mid - 1] + lengths[mid]) / 2
    : lengths[mid];

  const perfect = totalCount > 0
    ? lengths.filter((l) => l === totalCount).length
    : 0;
  const topPct = Math.round((perfect / rows.length) * 100);

  return { totalAttempts: rows.length, perCodeFinds, median, topPct };
}

module.exports = { aggregate };
