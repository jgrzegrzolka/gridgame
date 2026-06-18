/**
 * Aggregate cross-game engagement signals from a player's `profiles`
 * row + their `engagementEvents` history.
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
 *   - `hasLinkedDevice` — `true` iff the player's profile row has a
 *     numeric `linkedAt` field (sync flow successfully ran). Drives
 *     the "Connected" achievement.
 *
 *   - `dailySharesCount` / `quizSharesCount` / `findflagSharesCount`
 *     — counts of `kind: 'share'` events by surface. Drive the three
 *     Sharer achievements. The `'flagquiz'` surface covers both 60s
 *     and endurance rounds (the mode is embedded in `contextHint`).
 *
 *   - `coffeeClicked` — `true` iff at least one `kind: 'coffee_click'`
 *     event exists for the device. Drives "Angel Investor". Trust-
 *     based — no payment verification, just intent.
 *
 * Defensive on shape: missing/null inputs return zero/false. Events
 * lacking a recognisable `surface` field are silently skipped (a
 * future kind/surface that doesn't match the known list shouldn't
 * inflate any existing counter).
 */

/**
 * @typedef {{ nickname?: unknown, linkedAt?: unknown } | null | undefined} ProfileRow
 * @typedef {{
 *   kind?: unknown,
 *   payload?: { surface?: unknown } | null | undefined,
 * }} EngagementEventRow
 *
 * @typedef {{
 *   hasNickname: boolean,
 *   hasLinkedDevice: boolean,
 *   dailySharesCount: number,
 *   quizSharesCount: number,
 *   findflagSharesCount: number,
 *   coffeeClicked: boolean,
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
    hasLinkedDevice: false,
    dailySharesCount: 0,
    quizSharesCount: 0,
    findflagSharesCount: 0,
    coffeeClicked: false,
  };

  if (profile && typeof profile === 'object') {
    const nick = profile.nickname;
    // Non-empty string only — the profiles row carries `nickname: null`
    // for devices that have only requested deletion or never set one.
    if (typeof nick === 'string' && nick.length > 0) {
      result.hasNickname = true;
    }
    // linkedAt is a unix-ms timestamp set when sync completes. Any
    // finite numeric value counts as linked; null / missing means
    // the device has never been through the sync flow.
    const linkedAt = profile.linkedAt;
    if (typeof linkedAt === 'number' && Number.isFinite(linkedAt)) {
      result.hasLinkedDevice = true;
    }
  }

  if (!Array.isArray(events)) return result;
  for (const ev of events) {
    if (!ev || typeof ev !== 'object') continue;
    if (ev.kind === 'coffee_click') {
      result.coffeeClicked = true;
      continue;
    }
    if (ev.kind !== 'share') continue;
    if (!ev.payload || typeof ev.payload !== 'object') continue;
    const surface = ev.payload.surface;
    if (surface === 'daily') result.dailySharesCount++;
    else if (surface === 'flagquiz') result.quizSharesCount++;
    else if (surface === 'findflag') result.findflagSharesCount++;
    // Other surfaces (ttt) are tracked for analytics but don't feed
    // any current achievement — skip rather than fold into a generic
    // "any share" counter we'd then have to gate.
  }

  return result;
}

module.exports = { computeEngagement };
