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
 *
 * Degraded snapshots:
 *   `/api/v1/daily/me` soft-degrades — if its profiles / tttPairs / quiz
 *   reads fail it still answers 200, with that slice zeroed. A zeroed
 *   slice looks exactly like a player who hasn't earned those rules, so
 *   a degraded snapshot used as the diff axis reports every
 *   already-earned rule as newly earned the moment a healthy read lands.
 *   That is not theoretical: it fired five cards on a 60s give-up
 *   scoring 0. The server now flags such an answer `partial: true`, and
 *   a partial snapshot is never a diff axis on either side. Same
 *   reasoning as the null baseline above — an unknown is not a "no".
 *
 * Two cached snapshots, deliberately:
 *   `baseline` is the diff axis and only ever holds a trusted (non-
 *   partial) snapshot. `lastSnapshot` is the newest one whatever its
 *   state, because display consumers (daily/page.js repaints its streak
 *   line from getCachedAchievementsBaseline right after the diff) would
 *   rather show a degraded snapshot than nothing — the fields they read
 *   come from the endpoint's one HARD dependency, which cannot be
 *   partial without the request failing outright.
 */

import { fetchDailyMe } from '../daily/streakClient.js';
import { diffNewlyEarnedAchievements } from './achievements.js';
import { mergeEngagementOverlay } from './engagementSnapshot.js';
import { warsawDayNumber } from './warsawDay.js';

/**
 * Build the snapshot the predicates actually run against. Combines the
 * server-derived fields from `fetchDailyMe` (daily streak, mastery,
 * quiz aggregates, nickname/linked, TTT) with the localStorage-derived
 * engagement fields (share counts, coffee click, 60s streak). Local
 * wins for the engagement portion — Phase 4.5's whole point is to
 * decouple achievement-on-action celebration from the syncBlob push
 * cadence. The server keeps returning these fields too for backward
 * compatibility; we just overlay them.
 *
 * `store` and `now` are reads on the browser globals; injected here
 * via the helper layer below so tests don't need them.
 *
 * @param {Record<string, unknown> | null | undefined} serverSnap
 * @returns {Record<string, unknown> | null}
 */
function withLocalEngagement(serverSnap) {
  if (!serverSnap) return null;
  // Browser-only globals — guard so the module loads under node tests.
  /** @type {any} */
  const g = /** @type {any} */ (globalThis);
  const store = g.window && g.window.localStorage ? g.window.localStorage : null;
  if (!store) return /** @type {Record<string, unknown>} */ (serverSnap);
  const todayDayId = warsawDayNumber(Date.now());
  return mergeEngagementOverlay(serverSnap, store, todayDayId);
}

/**
 * The diff axis. Only ever a trusted snapshot — see the header note.
 * @type {import('../daily/streakClient.js').StreakResult | null}
 */
let baseline = null;

/**
 * The newest snapshot regardless of trust, for display consumers.
 * @type {import('../daily/streakClient.js').StreakResult | null}
 */
let lastSnapshot = null;

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
    const merged = withLocalEngagement(snap);
    if (merged) {
      lastSnapshot = /** @type {any} */ (merged);
      // A degraded boot read leaves the baseline null, which the diff
      // already knows how to handle: skip, and let the cards show on the
      // next visit. Better a late card than five wrong ones.
      if (merged.partial !== true) baseline = /** @type {any} */ (merged);
    }
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
  // Let the boot prefetch settle so the diff runs against it rather than
  // racing it. The fetch below happens either way — an unusable baseline
  // costs the player their cards this round, and it must not also cost
  // display consumers their refreshed snapshot.
  if (inflight) await inflight;

  const fresh = await fetchDailyMe(deviceId, { bypassCache: true });
  if (!fresh) return [];
  const merged = /** @type {any} */ (withLocalEngagement(fresh));
  lastSnapshot = merged;

  // A degraded read is not evidence of anything. Don't diff it, and
  // above all don't let it become the axis — the next healthy read
  // would then show every already-earned rule crossing at once, which
  // is the flood this whole guard exists to stop.
  if (merged.partial === true) return [];

  const before = baseline;
  baseline = merged;
  // Boot fetch never completed (or was never called): the achievement
  // still earns server-side, it'll show up on the next page visit.
  if (before === null) return [];
  return diffNewlyEarnedAchievements(before, merged);
}

/**
 * Read the most recent snapshot the helper has fetched, from the most
 * recent prime or refresh. Used by callers like daily/page.js that need
 * the snapshot for non-achievement purposes (the streak hint, the
 * personal-stats line) so they don't issue a second fetchDailyMe right
 * after refreshAchievementsAndDiff.
 *
 * This is `lastSnapshot`, not the diff axis: a degraded read is still
 * the freshest thing we know, and the streak fields these callers read
 * are never the degraded part. Anything that COMPARES two snapshots
 * must not use this — see the header note.
 *
 * @returns {import('../daily/streakClient.js').StreakResult | null}
 */
export function getCachedAchievementsBaseline() {
  return lastSnapshot;
}

/**
 * Test-only escape hatch — reset the module state so a unit test can
 * exercise the prime → refresh flow without state from a previous
 * test bleeding in. Real callers never need this.
 */
export function __resetAchievementsBaselineForTest() {
  baseline = null;
  lastSnapshot = null;
  inflight = null;
}
