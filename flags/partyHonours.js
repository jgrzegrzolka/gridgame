/**
 * The Flag Party finish's **honours**: three titles handed to seats that did not
 * win, read out one screen at a time before the result is known.
 *
 * Every number here comes from data the game already computes and then throws
 * away — buzz order and correctness (which the reveal scores off), and the
 * per-round point gains the between-rounds break already tallies. Nothing new is
 * measured; the room just stops discarding it (`flags/partyRoom.js`'s
 * `honourStats`).
 *
 * Pure, so `flagParty/page.js` stays DOM glue and every rule below — who is
 * eligible, who wins a tie, what happens at two seats — is a unit test rather
 * than something you can only see by playing a game out.
 *
 * @typedef {Object} SeatStat
 * @property {number} buzzes  questions this seat answered at all
 * @property {number} timed  of those, how many had a measurable latency. Lower
 *   than `buzzes` when a durable-object eviction lost the question's deal time
 *   (see `party/partyGameServer.js`) — the mean is taken over `timed`, so a lost
 *   question drops out of the average instead of counting as zero.
 * @property {number} latencyMs  summed ms from the question appearing to the buzz
 * @property {number} correct  of `buzzes`, how many were right
 *
 * @typedef {Object} HonourStats
 * @property {Record<string, SeatStat>} seats
 * @property {Array<{ modeId: string | null, gains: Record<string, number> }>} rounds
 *   one entry per round played, in order.
 *
 * @typedef {Object} Honour
 * @property {'fastest' | 'bestRound' | 'thoughtful'} id
 * @property {string} playerId
 * @property {number} value  the honour's headline number, in its own unit:
 *   mean buzz latency in ms (`fastest`), points gained (`bestRound`), correct
 *   answers (`thoughtful`).
 * @property {number} [outOf]  `thoughtful` only — questions answered, so the
 *   client can render "8 of 10 right" without re-deriving it.
 * @property {number} [round]  `bestRound` only — the 0-based round index.
 * @property {string | null} [modeId]  `bestRound` only — the round's mode, so the
 *   client can name it ("Best in Flags") with its own labels.
 */

/**
 * Minimum share of a seat's own answers that must be **right** before it can be
 * called thoughtful.
 *
 * The other two honours carry no floor on purpose — fastest hand is nerve, not
 * accuracy, and a player who mashes to win it pays for it in last place. This
 * one is different because the title makes a claim about judgement: "last click,
 * 2 of 10 right" reads as a consolation prize for being slow AND wrong, which is
 * worse than saying nothing. A product call, not a derived constant.
 */
export const THOUGHTFUL_ACCURACY_FLOOR = 0.5;

/** A seat with nothing recorded at all — never buzzed, or joined after the
 *  stats started. Kept out of every pool: a title won by not playing is a bug.
 *  @param {SeatStat | undefined} s */
function played(s) {
  return !!s && s.buzzes > 0;
}

/** Mean ms from a question appearing to this seat's buzz, or null when nothing
 *  was timed. @param {SeatStat} s */
function meanLatency(s) {
  return s.timed > 0 ? s.latencyMs / s.timed : null;
}

/**
 * Candidates for one honour, best first, each with the numeric `metric` the
 * assignment step compares. `metric` is always "higher is more deserving", so
 * fastest-hand negates its latency rather than inverting the comparator
 * everywhere downstream.
 *
 * @param {'fastest' | 'bestRound' | 'thoughtful'} id
 * @param {HonourStats} stats
 * @param {Set<string>} pool  seats still eligible (non-winners, not yet honoured)
 * @returns {Array<{ playerId: string, metric: number, extra: Partial<Honour> }>}
 */
function candidatesFor(id, stats, pool) {
  /** @type {Array<{ playerId: string, metric: number, extra: Partial<Honour> }>} */
  const out = [];
  if (id === 'fastest') {
    // Counts EVERY answer, wrong ones included — the honour is nerve, not
    // accuracy, so there is deliberately no correctness filter here.
    for (const pid of pool) {
      const s = stats.seats[pid];
      if (!played(s)) continue;
      const mean = meanLatency(s);
      if (mean === null) continue;
      out.push({ playerId: pid, metric: -mean, extra: { value: Math.round(mean) } });
    }
    return out.sort((a, b) => b.metric - a.metric);
  }
  if (id === 'bestRound') {
    // The single best ROUND anyone in the pool had, not their best total. One
    // entry per seat: their own strongest round.
    /** @type {Map<string, { gain: number, round: number, modeId: string | null }>} */
    const best = new Map();
    stats.rounds.forEach((round, i) => {
      for (const [pid, gain] of Object.entries(round.gains || {})) {
        if (!pool.has(pid) || !played(stats.seats[pid])) continue;
        if (gain <= 0) continue;
        const held = best.get(pid);
        if (!held || gain > held.gain) best.set(pid, { gain, round: i, modeId: round.modeId ?? null });
      }
    });
    for (const [pid, b] of best) {
      out.push({ playerId: pid, metric: b.gain, extra: { value: b.gain, round: b.round, modeId: b.modeId } });
    }
    return out.sort((a, b) => b.metric - a.metric);
  }
  // thoughtful: the best accuracy among the seats that click LAST. "Slowest" is
  // relative to the field rather than an absolute threshold — a fast room and a
  // slow room both have someone who takes their time — so the pool is split at
  // its own median latency and the slower half competes on accuracy.
  /** @type {Array<{ playerId: string, mean: number, s: SeatStat }>} */
  const timed = [];
  for (const pid of pool) {
    const s = stats.seats[pid];
    if (!played(s)) continue;
    const mean = meanLatency(s);
    if (mean === null) continue;
    timed.push({ playerId: pid, mean, s });
  }
  if (timed.length === 0) return out;
  timed.sort((a, b) => b.mean - a.mean);
  // At least one candidate always survives the split, so a two-seat pool still
  // has a slowest seat rather than rounding down to none.
  const slowCount = Math.max(1, Math.floor(timed.length / 2));
  for (const c of timed.slice(0, slowCount)) {
    const accuracy = c.s.correct / c.s.buzzes;
    if (accuracy < THOUGHTFUL_ACCURACY_FLOOR) continue;
    out.push({ playerId: c.playerId, metric: accuracy, extra: { value: c.s.correct, outOf: c.s.buzzes } });
  }
  return out.sort((a, b) => b.metric - a.metric);
}

/**
 * How far the leading candidate is ahead of the rest of the field, normalised to
 * [0, 1] over the field's own spread.
 *
 * This is what stops the honours from restating the leaderboard. Assigned by
 * absolute value, a strong player collects every title and the ceremony says the
 * same thing three times; assigned by distinctiveness, each title goes to the
 * seat who OWNS that category by the widest margin, so three different people
 * are named. A lone candidate is maximally distinctive (nobody to be ahead of).
 *
 * @param {Array<{ metric: number }>} cands  best-first
 * @returns {number}
 */
function distinctiveness(cands) {
  if (cands.length === 0) return -1;
  if (cands.length === 1) return 1;
  const spread = cands[0].metric - cands[cands.length - 1].metric;
  if (spread <= 0) return 0;
  return (cands[0].metric - cands[1].metric) / spread;
}

/** Presentation order, independent of the order the titles were assigned in:
 *  the ceremony always runs fastest → best round → thoughtful, so a replay of
 *  the same game is the same show. */
const HONOUR_ORDER = /** @type {const} */ (['fastest', 'bestRound', 'thoughtful']);

/**
 * Award the honours.
 *
 * Rules, all pinned by tests:
 * - honours go to seats that did **not** win — the winner's mark is ♛ Zwycięzca,
 *   awarded separately on their own screen. On a tie every tied leader is
 *   excluded, since none of them is "the loser" any title would be consoling.
 * - never the same seat twice; the title falls through to the next candidate.
 * - fewer eligible seats than titles just means fewer honours. Never pad.
 * - titles are handed out **most distinctive first**, so the clearest claim gets
 *   its first choice of seat rather than whichever category happens to be listed
 *   first.
 *
 * @param {HonourStats | null | undefined} stats
 * @param {string[]} winnerIds  the seats excluded from the pool (one winner, or
 *   every tied leader). Callers that have no winner at all pass `[]`.
 * @param {string[]} seatIds  every seat in the game, so a stats record that
 *   outlived a seat cannot award a title to a ghost.
 * @returns {Honour[]}  in presentation order
 */
export function computeHonours(stats, winnerIds, seatIds) {
  if (!stats || !stats.seats) return [];
  const excluded = new Set(winnerIds || []);
  const seatSet = new Set(seatIds || []);
  const pool = new Set(
    Object.keys(stats.seats).filter((pid) => seatSet.has(pid) && !excluded.has(pid)),
  );
  const rounds = Array.isArray(stats.rounds) ? stats.rounds : [];
  /** @type {HonourStats} */
  const safe = { seats: stats.seats, rounds };

  /** @type {Map<string, Honour>} */
  const awarded = new Map();
  const remaining = new Set(HONOUR_ORDER);
  // Recomputed every round rather than once up front: removing a seat from the
  // pool changes who leads the OTHER categories and by how much, which is the
  // whole point of assigning by distinctiveness.
  while (remaining.size > 0 && pool.size > 0) {
    /** @type {{ id: typeof HONOUR_ORDER[number], cands: ReturnType<typeof candidatesFor>, score: number, count: number } | null} */
    let best = null;
    for (const id of remaining) {
      const cands = candidatesFor(id, safe, pool);
      if (cands.length === 0) continue;
      const score = distinctiveness(cands);
      const count = cands.length;
      // SCARCEST category first, then most distinctive.
      //
      // Scarcity leads because it is what keeps a title from being starved: a
      // category only one seat qualifies for (thoughtful, which has an accuracy
      // floor) loses its single candidate the moment a broader category takes
      // them, and then goes unawarded while the ceremony pads out at two beats.
      // Handing out the constrained titles first is the standard fix, and it
      // serves distinctiveness rather than competing with it — a category with
      // one candidate is by definition owned outright.
      //
      // Distinctiveness then breaks the ties among equally-scarce categories,
      // which is where it does its real work: it stops a strong player
      // collecting every title by absolute value and the ceremony saying the
      // same thing three times.
      if (!best || count < best.count || (count === best.count && score > best.score)) {
        best = { id, cands, score, count };
      }
    }
    // Nothing left that anyone in the pool qualifies for.
    if (!best) break;
    const top = best.cands[0];
    awarded.set(best.id, /** @type {Honour} */ ({
      id: best.id,
      playerId: top.playerId,
      value: 0,
      ...top.extra,
    }));
    remaining.delete(best.id);
    pool.delete(top.playerId);
  }

  return HONOUR_ORDER.map((id) => awarded.get(id)).filter(
    /** @returns {h is Honour} */ (h) => !!h,
  );
}

/**
 * The seats a win excludes from the honours pool: the top scorer, or every seat
 * tied at the top. A board where nobody scored has no winner at all — an ending
 * that crowned a 0 would be worse than one that crowns nobody.
 *
 * @param {Array<{ playerId: string, score: number }> | null | undefined} scoreboard
 *   sorted descending, as the server sends it
 * @returns {string[]}
 */
export function winnerIdsOf(scoreboard) {
  const board = Array.isArray(scoreboard) ? scoreboard : [];
  if (board.length === 0) return [];
  const top = board[0].score;
  if (!(top > 0)) return [];
  return board.filter((r) => r.score === top).map((r) => r.playerId);
}
