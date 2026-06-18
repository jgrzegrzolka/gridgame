/**
 * Aggregate cross-game engagement signals from a player's `profiles`
 * row + their `engagementEvents` share history.
 *
 * Pure: no DOM, no clock, no Cosmos client. Feeds the Feature O
 * achievement evaluator via `/api/v1/daily/me`.
 *
 *   - `hasNickname` — `true` iff the player has set a non-empty
 *     nickname on their profiles row. Drives the "Identified"
 *     achievement. Boolean rather than the nickname itself because
 *     the predicate only cares about the existence signal — and
 *     keeping the actual string out of the snapshot avoids leaking
 *     it to any other consumer.
 *
 *   - `dailySharesCount` — count of `kind: 'share'` events with
 *     `payload.surface === 'daily'`. Drives "Daily Sharer".
 *
 *   - `quizSharesCount` — count of share events with surface
 *     `'flagquiz'`. Drives "Quiz Sharer". (Both 60s and endurance
 *     fire under the same `flagquiz` surface, so we don't split them
 *     here — a future "shared a 60s round specifically" achievement
 *     would parse `contextHint` for the mode segment.)
 *
 * Defensive on shape: missing/null inputs return zero/false. Events
 * lacking a recognisable `surface` field are silently skipped (a
 * future kind/surface that doesn't match the known list shouldn't
 * inflate any existing counter).
 */

/**
 * @typedef {{ nickname?: unknown } | null | undefined} ProfileRow
 * @typedef {{
 *   kind?: unknown,
 *   payload?: { surface?: unknown } | null | undefined,
 * }} EngagementEventRow
 *
 * @typedef {{
 *   hasNickname: boolean,
 *   dailySharesCount: number,
 *   quizSharesCount: number,
 * }} EngagementResult
 */

/**
 * @param {ProfileRow} profile
 * @param {EngagementEventRow[] | null | undefined} events
 * @returns {EngagementResult}
 */
function computeEngagement(profile, events) {
  /** @type {EngagementResult} */
  const result = {
    hasNickname: false,
    dailySharesCount: 0,
    quizSharesCount: 0,
  };

  if (profile && typeof profile === 'object') {
    const nick = profile.nickname;
    // Non-empty string only — the profiles row carries `nickname: null`
    // for devices that have only requested deletion or never set one.
    if (typeof nick === 'string' && nick.length > 0) {
      result.hasNickname = true;
    }
  }

  if (!Array.isArray(events)) return result;
  for (const ev of events) {
    if (!ev || typeof ev !== 'object') continue;
    if (ev.kind !== 'share') continue;
    if (!ev.payload || typeof ev.payload !== 'object') continue;
    const surface = ev.payload.surface;
    if (surface === 'daily') result.dailySharesCount++;
    else if (surface === 'flagquiz') result.quizSharesCount++;
    // Other surfaces (findflag, ttt) are tracked for analytics but
    // don't feed any current achievement — skip rather than fold
    // into a generic "any share" counter we'd then have to gate.
  }

  return result;
}

module.exports = { computeEngagement };
