/**
 * Build the engagement portion of the achievement-evaluator snapshot
 * from the client's localStorage state (Feature S Phase 4.5).
 *
 * Pre-Phase-4.5, these fields came from `dailyMe`'s server response,
 * which read them off `profile.syncBlob.engagement`. That worked but
 * coupled UX (achievement-on-action celebration) to the syncBlob
 * push cadence: throttle the push and the predicate sees stale data
 * for up to the throttle interval. Phase 4.5 inverts the source —
 * localStorage is canonical for the device's own state; the syncBlob
 * is just the cross-device carrier and can be pushed lazily.
 *
 * Cross-device freshness still flows in via the migration pull (first
 * boot) and via `syncMerge`'s blob handoff (QR-link). Within a single
 * device's session, localStorage is always the truth.
 *
 * Output shape exactly matches the engagement fields the server used
 * to return on `dailyMe`, so `flags/achievementsBaseline.js` can
 * overlay this onto the server snapshot with `Object.assign` —
 * predicates in `flags/achievements.js` don't change.
 */

import { loadState } from './engagementCounters.js';
import { computeStreak, dayLogToStreakRows } from './streakCompute.js';

/**
 * @typedef {{
 *   dailySharesCount: number,
 *   quizSharesCount: number,
 *   findflagSharesCount: number,
 *   coffeeClicked: boolean,
 *   quiz60sCurrentStreak: number,
 *   quiz60sMaxStreak: number,
 *   quiz60sDistinctDays: number,
 * }} EngagementOverlay
 *
 * @typedef {import('./engagementCounters.js').Store} Store
 */

/**
 * Read engagement state from localStorage and project it to the
 * snapshot field names the achievement evaluator expects.
 *
 * `todayDayId` is injected (typically `warsawDayNumber(Date.now())`)
 * so the streak's `currentStreak` resets correctly when the player
 * hasn't played today. Pass `null`/`undefined` to leave currentStreak
 * derived purely from the log (no "missed today" reset) — useful in
 * tests where the calendar isn't relevant.
 *
 * @param {Store} store
 * @param {number | null | undefined} todayDayId
 * @returns {EngagementOverlay}
 */
export function buildEngagementOverlay(store, todayDayId) {
  const state = loadState(store);

  const rows = dayLogToStreakRows(state.quiz60sDayLog);
  const streak = computeStreak({
    rows,
    latestId: typeof todayDayId === 'number' && Number.isInteger(todayDayId) && todayDayId >= 0
      ? todayDayId
      : undefined,
  });

  return {
    dailySharesCount: state.shares.daily,
    // The local-state key is `flagquiz`; the snapshot field is
    // `quizSharesCount` (the consumer-side name in flags/achievements.js
    // and the historical dailyMe field). The mapping lives here so a
    // future rename only touches one place.
    quizSharesCount: state.shares.flagquiz,
    findflagSharesCount: state.shares.findflag,
    coffeeClicked: state.coffeeClickCount >= 1,
    quiz60sCurrentStreak: streak.currentStreak,
    quiz60sMaxStreak: streak.maxStreak,
    quiz60sDistinctDays: streak.totalPlayed,
  };
}

/**
 * Overlay localStorage-derived engagement signals onto a server-side
 * snapshot. Used by `flags/achievementsBaseline.js` right after each
 * `fetchDailyMe` so predicates in `flags/achievements.js` see the
 * up-to-the-millisecond local counters instead of whatever the server
 * had at last syncBlob push.
 *
 * Non-engagement fields (daily streak, mastery, quiz aggregates, ttt,
 * nickname/linked) pass through from the server unchanged — those
 * sources don't live in localStorage and the server is canonical for
 * them.
 *
 * If `serverSnapshot` is null/undefined (rare error path), returns a
 * standalone overlay with the engagement fields populated and nothing
 * else. The caller's predicates that don't care about engagement will
 * just see undefined for their inputs, matching the pre-Phase-4.5
 * behaviour when `fetchDailyMe` failed.
 *
 * @param {Record<string, unknown> | null | undefined} serverSnapshot
 * @param {Store} store
 * @param {number | null | undefined} todayDayId
 * @returns {Record<string, unknown>}
 */
export function mergeEngagementOverlay(serverSnapshot, store, todayDayId) {
  const overlay = buildEngagementOverlay(store, todayDayId);
  if (!serverSnapshot || typeof serverSnapshot !== 'object') {
    return { ...overlay };
  }
  return { ...serverSnapshot, ...overlay };
}
