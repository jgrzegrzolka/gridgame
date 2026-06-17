/**
 * Feature O — achievement rule library.
 *
 * Pure logic: takes a `snapshot` of the player's data, returns which
 * achievements are earned. The profile page is the only consumer
 * today; future surfaces (a celebration popup on earn, the finish
 * screen) plug into the same rule set without re-deriving anything.
 *
 * Each rule is `{ id, predicate, name, description, icon }`:
 *   - `id` is a stable string used as a localStorage key for the
 *     "earnedAt" timestamp and as a CSS selector. Never rename a
 *     released id — that would orphan the badge for everyone who
 *     already earned it.
 *   - `predicate(snapshot)` returns true when the achievement is
 *     unlocked. Defensive against missing snapshot fields — if the
 *     data isn't there, the predicate just returns false (no throws).
 *   - `name` + `description` are the player-facing strings. English
 *     only in v1 — the same shape will hold `{en, pl}` once PL polish
 *     lands.
 *   - `icon` is a single emoji glyph rendered prominently on the
 *     badge tile. Plain unicode so it survives without an icon font.
 *
 * The "snapshot" shape is intentionally narrow — just the inputs each
 * rule needs. The profile page fills it from `fetchDailyMe()`; more
 * sources (quizRecords, tttPairs) will join as later phases expand
 * the rule set.
 *
 * @typedef {{
 *   currentStreak?: number,
 *   maxStreak?: number,
 *   totalPlayed?: number,
 *   totalCompleted?: number,
 *   cleanSweeps?: number,
 *   zeroScoreFinishes?: number,
 * }} Snapshot
 *
 * @typedef {{
 *   id: string,
 *   icon: string,
 *   name: string,
 *   description: string,
 *   hint: string,
 *   predicate: (snapshot: Snapshot) => boolean,
 * }} AchievementRule
 */

/** @type {AchievementRule[]} */
export const MASTERY_ACHIEVEMENTS = [
  {
    id: 'clean-sweep',
    icon: '🎯',
    name: 'Clean Sweep',
    description: 'Finished a daily puzzle 100%.',
    hint: 'Find every answer in one daily puzzle.',
    predicate: (s) => num(s.cleanSweeps) >= 1,
  },
  {
    id: 'perfect-five',
    icon: '🏆',
    name: 'Perfect Five',
    description: 'Cleared five daily puzzles 100%.',
    hint: 'Get a clean sweep on five daily puzzles.',
    predicate: (s) => num(s.cleanSweeps) >= 5,
  },
  {
    id: 'empty-slate',
    icon: '🧱',
    name: 'Empty Slate',
    description: "Submitted a daily without finding a single flag — we've all been there.",
    hint: 'Submit a daily with zero flags found (the badge of solidarity).',
    predicate: (s) => num(s.zeroScoreFinishes) >= 1,
  },
];

/** @type {AchievementRule[]} */
export const STREAK_ACHIEVEMENTS = [
  {
    id: 'first-daily',
    icon: '🔥',
    name: 'First Daily',
    description: 'Completed your first daily puzzle.',
    hint: 'Finish one daily puzzle.',
    predicate: (s) => num(s.totalCompleted) >= 1,
  },
  {
    id: 'daily-habit',
    icon: '🔥',
    name: 'Daily Habit',
    description: 'Played the daily puzzle 7 days in a row.',
    hint: 'Reach a 7-day streak.',
    predicate: (s) => num(s.maxStreak) >= 7,
  },
  {
    id: 'two-weeks-strong',
    icon: '🔥',
    name: 'Two Weeks Strong',
    description: 'Kept the daily streak going for 14 days.',
    hint: 'Reach a 14-day streak.',
    predicate: (s) => num(s.maxStreak) >= 14,
  },
  {
    id: 'monthly-devotee',
    icon: '🌟',
    name: 'Monthly Devotee',
    description: 'A full month of daily puzzles without missing one.',
    hint: 'Reach a 30-day streak.',
    predicate: (s) => num(s.maxStreak) >= 30,
  },
];

/**
 * Default rule order on the profile page. Streak first (every player
 * touches the daily flow), mastery second (gated on at least one
 * completion). Declared this way so a newcomer sees the streak tier
 * first — the most accessible badges sit at the top of the grid.
 *
 * @type {AchievementRule[]}
 */
export const ALL_ACHIEVEMENTS = [
  ...STREAK_ACHIEVEMENTS,
  ...MASTERY_ACHIEVEMENTS,
];

/**
 * @typedef {{
 *   rule: AchievementRule,
 *   earned: boolean,
 * }} AchievementStatus
 *
 * Evaluate a rule set against a snapshot. Returns the rules in
 * declaration order, each tagged with whether the player has earned
 * it. Order is the rendering order on the profile page — declare from
 * easiest to hardest so a newcomer sees the achievable badges first.
 *
 * @param {Snapshot | null} snapshot
 * @param {AchievementRule[]} [rules]
 * @returns {AchievementStatus[]}
 */
export function evaluateAchievements(snapshot, rules = ALL_ACHIEVEMENTS) {
  const safe = snapshot ?? {};
  return rules.map((rule) => ({
    rule,
    earned: rule.predicate(safe) === true,
  }));
}

/**
 * @param {unknown} x
 * @returns {number}
 */
function num(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}
