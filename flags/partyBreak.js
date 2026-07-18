/**
 * The between-rounds **break** view for Flag Party: given the scoreboard at the
 * previous break (or null, for the first break of the game) and the scoreboard
 * now, produce the standings the break screen renders — each row's round gain,
 * rank movement, and gap to the leader, plus the round's MVP.
 *
 * Pure, so `flagParty/page.js` stays thin DOM glue and the arithmetic is
 * unit-tested. The client never holds per-round point history; it only snapshots
 * the cumulative scoreboard at each break and diffs two snapshots here.
 *
 * @typedef {{ playerId: string, nickname: string, score: number }} BoardRow
 * @typedef {Object} BreakRow
 * @property {string} playerId
 * @property {string} nickname
 * @property {number} score       cumulative total now
 * @property {number} blockGain   points earned in the round that just ended
 * @property {number | null} rankDelta  places climbed since the previous break
 *   (positive = moved up, negative = dropped, 0 = held); null on the first break,
 *   where there is no previous standing to move from
 * @property {number} gapToLeader  the leader's score minus this row's score (0 for
 *   the leader)
 */

/**
 * Build the break standings. `currBoard` is the live scoreboard (already sorted
 * descending by score, as the server sends it); `prevBoard` is the snapshot from
 * the previous break, or null before the first break. Rows come back in
 * `currBoard` order.
 *
 * @param {BoardRow[] | null} prevBoard
 * @param {BoardRow[]} currBoard
 * @returns {{ rows: BreakRow[], mvp: string | null }}
 */
export function roundBreak(prevBoard, currBoard) {
  const curr = Array.isArray(currBoard) ? currBoard : [];
  /** @type {Map<string, number>} playerId -> score at the previous break */
  const prevScore = new Map();
  /** @type {Map<string, number>} playerId -> 0-based rank at the previous break */
  const prevRank = new Map();
  if (Array.isArray(prevBoard)) {
    prevBoard.forEach((r, i) => { prevScore.set(r.playerId, r.score); prevRank.set(r.playerId, i); });
  }
  const hasPrev = Array.isArray(prevBoard);
  const leaderScore = curr.length ? curr[0].score : 0;

  /** @type {BreakRow[]} */
  const rows = curr.map((r, i) => {
    const wasScore = prevScore.has(r.playerId) ? /** @type {number} */ (prevScore.get(r.playerId)) : 0;
    // Rank delta needs a prior *position*; a player who wasn't seated at the last
    // break (a late join) has no rank to move from, so their delta is null too.
    const hadRank = prevRank.has(r.playerId);
    const rankDelta = hasPrev && hadRank ? /** @type {number} */ (prevRank.get(r.playerId)) - i : null;
    return {
      playerId: r.playerId,
      nickname: r.nickname,
      score: r.score,
      blockGain: Math.max(0, r.score - wasScore),
      rankDelta,
      gapToLeader: Math.max(0, leaderScore - r.score),
    };
  });

  // MVP = the biggest gainer in the round. Ties break toward the higher total
  // (curr is sorted by score, so the earlier row wins), and a round where nobody
  // scored has no MVP.
  /** @type {string | null} */
  let mvp = null;
  let best = 0;
  for (const row of rows) {
    if (row.blockGain > best) { best = row.blockGain; mvp = row.playerId; }
  }
  return { rows, mvp };
}
