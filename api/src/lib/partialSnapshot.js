/**
 * Did a soft dependency of a snapshot endpoint fail?
 *
 * `/api/v1/daily/me` issues four Cosmos reads in one wave and treats
 * three of them as SOFT: a failure degrades that slice of the snapshot to
 * zeros / falses rather than 500'ing the whole answer. That is the right
 * call for the endpoint — a Cosmos blip on the TTT counters shouldn't
 * cost the player their streak display.
 *
 * It is the wrong call for anything that DIFFS two snapshots. A degraded
 * snapshot says `hasWonTtt: false`, which is indistinguishable from a
 * player who has never won a game, so `flags/achievementsBaseline.js`
 * read it as "not earned yet", and the next healthy read looked like the
 * player had just earned it. In production that fired five already-earned
 * cards — Identified, Matrix, First TTT Win, First TTT Loss, Ten TTT
 * Games — on a 60s quiz give-up that scored 0. Exactly the set fed by the
 * profiles + tttPairs reads, including a pair that cannot both be earned
 * by one event.
 *
 * So the endpoint marks a degraded answer `partial: true` and the client
 * refuses to use it as a diff axis. "A read failed" means *unknown*, not
 * *not earned*.
 *
 * Both failure shapes count, and the second is the one that bit us:
 *
 *   - `status: 'rejected'` — the query threw. Already logged.
 *   - `status: 'fulfilled'` with `value.ok !== true` — the query answered
 *     with a failure (throttle, timeout, bad status). `dailyMe` only ever
 *     read `.docs` behind an `if (…value.ok)`, so this degraded the
 *     snapshot **silently**: no rejection, no warn, nothing in App
 *     Insights to find afterwards.
 *
 * A successful read returning zero documents is NOT a failure. New
 * players legitimately have no profile row and no TTT pairs; calling that
 * partial would suppress the first-earn card for everyone who has just
 * started, which is the same bug pointed the other way.
 */

/**
 * @typedef {{ status: string, value?: { ok?: unknown } | null, reason?: unknown }} SettledRead
 */

/**
 * @param {SettledRead | null | undefined} settled a `Promise.allSettled` entry
 * @returns {boolean} true when this read cannot be trusted to describe the player
 */
function isReadFailed(settled) {
  if (!settled || settled.status !== 'fulfilled') return true;
  const value = settled.value;
  if (!value || typeof value !== 'object') return true;
  return value.ok !== true;
}

/**
 * @param {Array<SettledRead | null | undefined>} settledReads
 * @returns {boolean} true when at least one read failed
 */
function anyReadFailed(settledReads) {
  return settledReads.some(isReadFailed);
}

module.exports = { isReadFailed, anyReadFailed };
