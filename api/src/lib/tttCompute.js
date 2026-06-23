/**
 * Aggregate TTT signals from a player's `tttPairs` rows.
 *
 * Pure: no DOM, no clock, no Cosmos client. Feeds the Feature O
 * achievement evaluator via `/api/v1/daily/me`.
 *
 *   - `tttGamesPlayed` — total TTT games played across both modes
 *     (3x3 + 9x9) and every opponent, derived as
 *     `Σ (wins + losses + draws)` over every row. Drives the count
 *     tiers (Ten Games, Hundred Games). Catches online games only —
 *     offline-vs-AI plays don't write Cosmos.
 *
 *   - `tttGamesPlayed9x9` — same shape but restricted to `m9x9`.
 *     Drives the "9×9 Player" achievement. Counts every 9×9 game
 *     played online, regardless of outcome (including give-ups).
 *
 *   - `hasWonTtt` — `true` iff the player has won at least one TTT
 *     game across either mode. Drives "First Win".
 *
 *   - `hasWon9x9` — `true` iff the player has won at least one
 *     `m9x9` game. Drives "9×9 Winner". Includes wins where the
 *     opponent gave up — the helper that produces row outcomes
 *     (`flags/tttPairOutcome.js#deriveTttOutcome`) only reports
 *     `'win'` when the player themselves did NOT give up, so any
 *     win counted here is a win-from-the-player's-perspective.
 *
 *   - `hasLostTtt` — `true` iff the player has lost at least one TTT
 *     game across either mode. Drives "First Loss" — there's no shame
 *     in losing, the badge says "you showed up and played".
 *
 * Defensive on shape: missing `m3x3` / `m9x9` sub-objects, non-numeric
 * or negative counters all collapse to 0. Real rows from
 * `mergePairResult` always have valid values.
 */

/**
 * @typedef {{ wins?: unknown, losses?: unknown, draws?: unknown }} ModeCounters
 * @typedef {{ m3x3?: ModeCounters | null, m9x9?: ModeCounters | null }} TttPairRow
 *
 * @typedef {{
 *   tttGamesPlayed: number,
 *   tttGamesPlayed9x9: number,
 *   hasWonTtt: boolean,
 *   hasWon9x9: boolean,
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
    tttGamesPlayed9x9: 0,
    hasWonTtt: false,
    hasWon9x9: false,
    hasLostTtt: false,
  };
  if (!Array.isArray(rows) || rows.length === 0) return result;
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const m3 = row.m3x3 && typeof row.m3x3 === 'object' ? modeTotals(row.m3x3) : modeTotals(null);
    const m9 = row.m9x9 && typeof row.m9x9 === 'object' ? modeTotals(row.m9x9) : modeTotals(null);
    const wins = m3.wins + m9.wins;
    const losses = m3.losses + m9.losses;
    const draws = m3.draws + m9.draws;
    result.tttGamesPlayed += wins + losses + draws;
    result.tttGamesPlayed9x9 += m9.wins + m9.losses + m9.draws;
    if (wins > 0) result.hasWonTtt = true;
    if (m9.wins > 0) result.hasWon9x9 = true;
    if (losses > 0) result.hasLostTtt = true;
  }
  return result;
}

module.exports = { computeTttSignals };
