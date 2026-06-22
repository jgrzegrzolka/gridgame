/**
 * Aggregate cross-game engagement signals from a player's `profiles`
 * row + their `syncBlob.engagement` section.
 *
 * Pure: no DOM, no clock, no Cosmos client. Feeds the Feature O
 * achievement evaluator via `/api/v1/daily/me`.
 *
 * **Source change (Feature S Phase 4):** pre-Phase-4 this read from
 * `engagementEvents` rows (cross-partition Cosmos scan); post-Phase-4
 * it reads from the `engagement` section of the client-owned `syncBlob`
 * field on the profile doc (single-partition point read — already
 * needed for nickname + linkedAt, so zero extra query). Output shape
 * is identical so `dailyMe.js` callers and the client `achievements.js`
 * predicates didn't have to change.
 *
 * Per-signal mapping:
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
 *     — counts by surface from `blob.shares.{daily, flagquiz, findflag}`.
 *     Drive the three Sharer achievements. The `ttt` surface is also
 *     tracked client-side but isn't surfaced here today (no current
 *     achievement consumes it — see flags/engagementCounters.js for
 *     the closed list).
 *
 *   - `coffeeClicked` — `true` iff `blob.coffeeClickCount >= 1`. Drives
 *     "Angel Investor". Pre-Phase-4 this was a boolean derived from
 *     "is there at least one coffee_click event row?"; post-Phase-4
 *     the client maintains a count and we threshold on >= 1 for the
 *     same effect. A future Big-Investor tier could threshold higher
 *     without a snapshot shape change.
 *
 * Defensive on shape: missing/null inputs return zero/false. Unknown
 * keys silently ignored. Behaviour matches the pre-Phase-4 version so
 * a client that was relying on the old defaults sees the same output.
 */

/**
 * @typedef {{ nickname?: unknown, linkedAt?: unknown } | null | undefined} ProfileRow
 *
 * @typedef {{
 *   shares?: { daily?: unknown, flagquiz?: unknown, findflag?: unknown, ttt?: unknown } | null | undefined,
 *   coffeeClickCount?: unknown,
 * } | null | undefined} SyncBlobEngagement
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
 * @param {SyncBlobEngagement} engagement
 * @returns {EngagementResult}
 */
function computeEngagement(profile, engagement) {
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

  if (!engagement || typeof engagement !== 'object') return result;

  // Shares: read each surface defensively. A non-integer or negative
  // value (e.g. from a hand-edited / future-shape blob) reads as zero
  // rather than coercing — keeps the snapshot honest.
  if (engagement.shares && typeof engagement.shares === 'object') {
    const s = engagement.shares;
    if (Number.isInteger(s.daily) && /** @type {number} */ (s.daily) > 0) {
      result.dailySharesCount = /** @type {number} */ (s.daily);
    }
    if (Number.isInteger(s.flagquiz) && /** @type {number} */ (s.flagquiz) > 0) {
      result.quizSharesCount = /** @type {number} */ (s.flagquiz);
    }
    if (Number.isInteger(s.findflag) && /** @type {number} */ (s.findflag) > 0) {
      result.findflagSharesCount = /** @type {number} */ (s.findflag);
    }
  }

  // Coffee: threshold on >= 1 for backward-compat with the pre-Phase-4
  // boolean. The actual count lives in the blob too but isn't surfaced
  // here — only the "at least one" achievement gate is used today.
  if (Number.isInteger(engagement.coffeeClickCount) && /** @type {number} */ (engagement.coffeeClickCount) >= 1) {
    result.coffeeClicked = true;
  }

  return result;
}

module.exports = { computeEngagement };
