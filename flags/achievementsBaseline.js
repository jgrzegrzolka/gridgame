/**
 * Shared boot-time baseline + post-action diff for the achievement
 * cascade. Pre-fetches the player's snapshot once per page session and
 * exposes a `refreshAndDiff` call that any earn-moment can use:
 *
 *   import { primeAchievementsBaseline, refreshAchievementsAndDiff }
 *     from '../flags/achievementsBaseline.js';
 *   import { celebrate } from '../flags/achievementCelebrate.js';
 *
 *   primeAchievementsBaseline(deviceId);          // boot
 *   …
 *   const newly = await refreshAchievementsAndDiff(deviceId);  // post-action
 *   if (newly.length > 0) void celebrate(newly);
 *
 * Why a shared helper rather than open-coding the boot + diff pattern
 * in every page: there are now ~8 earn-moments spread across the
 * daily, quiz, profile, sync, findFlag pages plus the cross-page
 * coffee-click delegation in common.js. The diff logic is identical
 * at every site. One module = one place to update if the snapshot
 * shape ever changes.
 *
 * Race semantics:
 *   - If the boot prefetch hasn't completed (or wasn't called) by the
 *     time refreshAndDiff fires, the diff returns []. The achievement
 *     still earns server-side; it'll show up on the next page visit.
 *     Choosing this over "treat null baseline as empty" because the
 *     latter would flood a returning player with cards for every
 *     already-earned rule on the first action of any page.
 *   - The boot prefetch is in-flight-cached so two calls to
 *     primeAchievementsBaseline never trigger two roundtrips.
 */

import { fetchDailyMe } from '../daily/streakClient.js';
import { diffNewlyEarnedAchievements } from './achievements.js';

/** @type {import('../daily/streakClient.js').StreakResult | null} */
let baseline = null;

/** @type {Promise<void> | null} */
let inflight = null;

/**
 * Kick off the boot-time snapshot fetch. Cached path (no bypass) — it's
 * just establishing the pre-action state. Safe to call multiple times;
 * a second call piggybacks on the first request.
 *
 * @param {string} deviceId
 */
export function primeAchievementsBaseline(deviceId) {
  if (baseline !== null || inflight !== null) return;
  inflight = fetchDailyMe(deviceId).then((snap) => {
    if (snap) baseline = snap;
    inflight = null;
  });
}

/**
 * Fetch the fresh post-action snapshot and diff it against the
 * baseline. Returns the rules newly earned by this action (empty when
 * the baseline isn't ready yet, or when nothing crossed a threshold).
 *
 * Side effect: updates the cached baseline to the fresh snapshot so the
 * next earn-moment compares against this one. That's why two earn-
 * actions in the same page session (e.g., share then coffee click)
 * each only fire their own newly-earned cards, never each other's.
 *
 * @param {string} deviceId
 * @returns {Promise<import('./achievements.js').AchievementRule[]>}
 */
export async function refreshAchievementsAndDiff(deviceId) {
  if (baseline === null) {
    // Boot fetch hasn't completed (or wasn't called). Skip silently —
    // the achievement still earns server-side; it'll show up on the
    // next page visit.
    if (inflight) await inflight;
    if (baseline === null) return [];
  }
  const fresh = await fetchDailyMe(deviceId, { bypassCache: true });
  if (!fresh) return [];
  const before = baseline;
  baseline = fresh;
  return diffNewlyEarnedAchievements(before, fresh);
}

/**
 * Read the most recent snapshot the helper has cached (the baseline
 * after the most recent prime or refresh). Used by callers like
 * daily/page.js that need the snapshot for non-achievement purposes
 * (the streak hint, the personal-stats line) so they don't issue a
 * second fetchDailyMe right after refreshAchievementsAndDiff.
 *
 * @returns {import('../daily/streakClient.js').StreakResult | null}
 */
export function getCachedAchievementsBaseline() {
  return baseline;
}

/**
 * Test-only escape hatch — reset the module state so a unit test can
 * exercise the prime → refresh flow without state from a previous
 * test bleeding in. Real callers never need this.
 */
export function __resetAchievementsBaselineForTest() {
  baseline = null;
  inflight = null;
}
