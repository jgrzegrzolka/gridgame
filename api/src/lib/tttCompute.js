/**
 * Aggregate TTT signals from a player's `tttPairs` rows.
 *
 * Pure: no DOM, no clock, no Cosmos client. Feeds the Feature O
 * achievement evaluator via `/api/v1/daily/me`.
 *
 *   - `tttGamesPlayed` — total TTT games played against every
 *     opponent, derived as `Σ (wins + losses + draws)` over every row.
 *     Drives the count tiers (Ten Games, Hundred Games). Catches online
 *     games only — offline-vs-AI plays don't write Cosmos.
 *
 *   - `hasWonTtt` — `true` iff the player has won at least one TTT
 *     game. Drives "First Win". Includes wins where the opponent gave
 *     up — the helper that produces row outcomes
 *     (`flags/tttPairOutcome.js#deriveTttOutcome`) only reports
 *     `'win'` when the player themselves did NOT give up, so any
 *     win counted here is a win-from-the-player's-perspective.
 *
 *   - `hasLostTtt` — `true` iff the player has lost at least one TTT
 *     game. Drives "First Loss" — there's no shame in losing, the
 *     badge says "you showed up and played".
 *
 * Defensive on shape: a missing `m3x3` sub-object, non-numeric or
 * negative counters all collapse to 0. Real rows from
 * `mergePairResult` always have valid values. Rows written before the
 * 9×9 board was removed may still carry an `m9x9` sub-object; it is
 * ignored here, so those games no longer count toward any badge.
 */

/**
 * @typedef {{ wins?: unknown, losses?: unknown, draws?: unknown }} ModeCounters
 * @typedef {{ m3x3?: ModeCounters | null }} TttPairRow
 *
 * @typedef {{
 *   tttGamesPlayed: number,
 *   hasWonTtt: boolean,
 *   hasLostTtt: boolean,
 * }} TttResult
 */

/**
 * @param {unknown} x
 * @returns {number}
 */
function safeCount(x) {
  const n = Number(x);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * @param {ModeCounters | null} m
 * @returns {{ wins: number, losses: number, draws: number }}
 */
function modeTotals(m) {
  if (!m) return { wins: 0, losses: 0, draws: 0 };
  return {
    wins: safeCount(m.wins),
    losses: safeCount(m.losses),
    draws: safeCount(m.draws),
  };
}

/**
 * @param {TttPairRow[] | null | undefined} rows
 * @returns {TttResult}
 */
function computeTttSignals(rows) {
  /** @type {TttResult} */
  const result = {
    tttGamesPlayed: 0,
    hasWonTtt: false,
    hasLostTtt: false,
  };
  if (!Array.isArray(rows) || rows.length === 0) return result;
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const m3 = row.m3x3 && typeof row.m3x3 === 'object' ? modeTotals(row.m3x3) : modeTotals(null);
    result.tttGamesPlayed += m3.wins + m3.losses + m3.draws;
    if (m3.wins > 0) result.hasWonTtt = true;
    if (m3.losses > 0) result.hasLostTtt = true;
  }
  return result;
}

module.exports = { computeTttSignals };
