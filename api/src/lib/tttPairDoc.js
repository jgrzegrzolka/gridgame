/**
 * Pure builder + merge logic for the Cosmos `tttPairs` container — one
 * row per (deviceId, opponentId) pair, from THIS device's perspective.
 * Holds rolling head-to-head counters for both modes.
 *
 * Doc shape:
 *   {
 *     id:           "{deviceId}:{opponentId}",
 *     deviceId:     string,    // partition key — this device's id
 *     opponentId:   string,
 *     m3x3:         { wins, losses, draws },
 *     m9x9:         { wins, losses, draws },
 *     lastPlayedAt: number,    // unix ms
 *     v:            1,
 *   }
 *
 * Why one row per pair (and not one row per game): we don't need replay,
 * we don't need the move sequence, we don't even need who won which
 * specific game — only the running score. Storage is therefore O(distinct
 * opponents) rather than O(games played), which keeps Cosmos lean as
 * the same two players play many rematches.
 *
 * Two rows per pair (one per perspective): both clients independently
 * POST after the `finished` effect. Each row is partitioned by THIS
 * device's id, so a future "show me all of Alice's matchups" query is
 * single-partition.
 *
 * The merge is intentionally tolerant of partial / missing existing rows
 * — missing counter buckets default to 0 — so an out-of-band edit or a
 * future schema bump that adds a new bucket can't NaN the math.
 */

const COUNTERS = ['wins', 'losses', 'draws'];

/**
 * @param {{ wins?: number, losses?: number, draws?: number } | undefined} from
 */
function normalisedCounters(from) {
  /** @type {{ wins: number, losses: number, draws: number }} */
  const out = { wins: 0, losses: 0, draws: 0 };
  if (from && typeof from === 'object') {
    for (const k of COUNTERS) {
      const v = /** @type {any} */ (from)[k];
      if (typeof v === 'number' && Number.isFinite(v) && v >= 0) {
        /** @type {any} */ (out)[k] = Math.floor(v);
      }
    }
  }
  return out;
}

/**
 * Build the Cosmos doc to upsert after a single game result. Existing row
 * may be null (first game for this pair) or a previous row (we increment).
 *
 * @param {{
 *   existing: any,
 *   deviceId: string,
 *   opponentId: string,
 *   mode: '3x3' | '9x9',
 *   outcome: 'win' | 'loss' | 'draw',
 *   now: number,
 * }} input
 */
function mergePairResult({ existing, deviceId, opponentId, mode, outcome, now }) {
  const m3x3 = normalisedCounters(existing && existing.m3x3);
  const m9x9 = normalisedCounters(existing && existing.m9x9);
  const target = mode === '3x3' ? m3x3 : m9x9;
  const counterKey = outcome === 'win' ? 'wins' : outcome === 'loss' ? 'losses' : 'draws';
  target[counterKey] += 1;
  return {
    id: `${deviceId}:${opponentId}`,
    deviceId,
    opponentId,
    m3x3,
    m9x9,
    lastPlayedAt: now,
    v: 1,
  };
}

module.exports = { mergePairResult };
