/**
 * Aggregate a list of daily-result rows into the shape rendered by the
 * client. Pure: no I/O, no time, no globals.
 *
 * Each row is the subset of a Cosmos doc we query for:
 *   { foundCodes: string[], wrongCodes: string[], totalCount: number }
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
 *     perWrongCode: { [code]: number },       // count of how many submissions clicked this wrong (non-target) flag
 *     mean: number,                           // arithmetic mean of foundCodes.length, rounded to one decimal place
 *     topPct: number,                         // % of rows where they got everything (0–100, int)
 *   }
 *
 * We use the arithmetic mean (not the median) so the headline number
 * matches what the per-tile %s already imply. An earlier version used
 * median for outlier-robustness, but at low traffic that produced
 * "Average score: 9/9" alongside per-tile rates of 67% — mathematically
 * coherent (median of [1, 9, 9] is 9) but indistinguishable from a bug.
 */

function emptyStats() {
  return { totalAttempts: 0, perCodeFinds: {}, perWrongCode: {}, mean: 0, topPct: 0 };
}

function aggregate(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return emptyStats();

  // Drop local-dev rows before counting anything. They're tagged
  // server-side (see api/src/lib/requestHost.js) so the owner's local
  // testing never pollutes community stats. Prod rows never have the
  // field, so this is a no-op for real traffic.
  rows = rows.filter((r) => r && r.local !== true);
  if (rows.length === 0) return emptyStats();

  const perCodeFinds = {};
  const perWrongCode = {};
  const lengths = [];
  let totalCount = 0;

  for (const row of rows) {
    const codes = row.foundCodes || [];
    for (const code of codes) {
      perCodeFinds[code] = (perCodeFinds[code] || 0) + 1;
    }
    const wrong = row.wrongCodes || [];
    for (const code of wrong) {
      perWrongCode[code] = (perWrongCode[code] || 0) + 1;
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

  const sum = lengths.reduce((a, b) => a + b, 0);
  // Round to one decimal place. Integer rounding was too lossy at
  // low N — with two submissions (2/3 and 3/3) the mean is 2.5,
  // which Math.round bumps up to 3, so the headline reads "Average
  // score: 3/3" while the per-tile %s clearly show one player missed
  // a tile. One decimal is honest about the half ("2.5/3") and still
  // collapses to an integer ("3" / "6" / "9") when the mean is whole.
  const mean = Math.round(sum / lengths.length * 10) / 10;

  const perfect = totalCount > 0
    ? lengths.filter((l) => l === totalCount).length
    : 0;
  const topPct = Math.round((perfect / rows.length) * 100);

  return { totalAttempts: rows.length, perCodeFinds, perWrongCode, mean, topPct };
}

module.exports = { aggregate };
