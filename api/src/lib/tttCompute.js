/**
 * Aggregate TTT signals from a player's `tttPairs` rows.
 *
 * Pure: no DOM, no clock, no Cosmos client. Feeds the Feature O
 * achievement evaluator via `/api/v1/daily/me`.
 *
 *   - `hasPlayedTtt` — `true` iff any tttPairs row exists for this
 *     device. Drives "First Tic Tac Toe". Catches online games only
 *     (offline-vs-AI plays don't write Cosmos).
 *
 *   - `hasWonTtt` — `true` iff the player has won at least one TTT
 *     game across either mode (3x3 or 9x9). Drives "First Win".
 *
 *   - `hasLostTtt` — `true` iff the player has lost at least one TTT
 *     game across either mode. Drives "First Loss" — there's no shame
 *     in losing, the badge says "you showed up and played".
 *
 * Defensive on shape: missing `m3x3` / `m9x9` sub-objects, non-numeric
 * or negative counters all collapse to 0. Real rows from
 * `mergePairResult` always have valid values.
 *
 * Draws aren't surfaced today — adding "First Draw" later is one more
 * boolean and the same loop.
 */

/**
 * @typedef {{ wins?: unknown, losses?: unknown, draws?: unknown }} ModeCounters
 * @typedef {{ m3x3?: ModeCounters | null, m9x9?: ModeCounters | null }} TttPairRow
 *
 * @typedef {{
 *   hasPlayedTtt: boolean,
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
 * @param {TttPairRow[] | null | undefined} rows
 * @returns {TttResult}
 */
function computeTttSignals(rows) {
  /** @type {TttResult} */
  const result = { hasPlayedTtt: false, hasWonTtt: false, hasLostTtt: false };
  if (!Array.isArray(rows) || rows.length === 0) return result;
  result.hasPlayedTtt = true;
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const m3 = row.m3x3 && typeof row.m3x3 === 'object' ? row.m3x3 : null;
    const m9 = row.m9x9 && typeof row.m9x9 === 'object' ? row.m9x9 : null;
    const wins = (m3 ? safeCount(m3.wins) : 0) + (m9 ? safeCount(m9.wins) : 0);
    const losses = (m3 ? safeCount(m3.losses) : 0) + (m9 ? safeCount(m9.losses) : 0);
    if (wins > 0) result.hasWonTtt = true;
    if (losses > 0) result.hasLostTtt = true;
    // Once both have flipped to true, no point reading more rows.
    if (result.hasWonTtt && result.hasLostTtt) break;
  }
  return result;
}

module.exports = { computeTttSignals };
