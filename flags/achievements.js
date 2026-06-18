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
 *   flawlessSweeps?: number,
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

/**
 * Render N cells of a 4×4 grid as a monochrome SVG. The shared visual
 * language for streak + Empty Slate achievements: a small pixel-art
 * grid that fills as the threshold grows. `n=0` renders just the
 * grid outline, `n=16` is the full-house "you did everything" state.
 *
 * 4×4 = 16 cells. The streak tier caps at 16 even though the 30-day
 * threshold is higher — what the icon communicates is "more filled =
 * deeper streak", not the exact count. The number lives in the name.
 *
 * @param {number} n  filled cells, clamped to [0, 16]
 * @returns {string}  SVG markup, currentColor fill
 */
function gridIcon(n) {
  const filled = Math.max(0, Math.min(16, Math.floor(n)));
  /** @type {string[]} */
  const cells = [];
  let count = 0;
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 4; col++) {
      if (count < filled) {
        const x = 0.5 + col * 4;
        const y = 0.5 + row * 4;
        cells.push(`<rect x="${x}" y="${y}" width="3" height="3"/>`);
      }
      count++;
    }
  }
  // Frame the empty/zero state so Empty Slate reads as "you submitted
  // a zero", not "no icon". For non-zero states the frame is invisible
  // (under the filled cells) — same path either way for visual unity.
  return `<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><rect x="0" y="0" width="16" height="16" fill="none" stroke="currentColor" stroke-width="0.5" opacity="0.35"/>${cells.join('')}</svg>`;
}

const ICON_CHECKMARK =
  '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">' +
  '<path d="M14 4L6 12L2 8L3.5 6.5L6 9L12.5 2.5Z"/>' +
  '</svg>';

const ICON_STAR =
  '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">' +
  '<path d="M8 1L10 6L15 6L11 9L13 14L8 11L3 14L5 9L1 6L6 6Z"/>' +
  '</svg>';

// Slanted broom: diagonal handle from upper-right, horizontal band,
// three bristle clumps. Used for the Clean Sweep tier.
const BRUSH_SHAPES =
  '<rect x="11" y="0" width="2" height="2"/>' +
  '<rect x="9" y="2" width="2" height="2"/>' +
  '<rect x="7" y="4" width="2" height="2"/>' +
  '<rect x="3" y="6" width="9" height="2"/>' +
  '<rect x="3" y="8" width="2" height="6"/>' +
  '<rect x="7" y="8" width="2" height="6"/>' +
  '<rect x="10" y="8" width="2" height="6"/>';

const ICON_BRUSH =
  '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">' +
  BRUSH_SHAPES +
  '</svg>';

// Brush + "×N" multiplier label below. Taller viewBox so the brush
// keeps its size and the label sits underneath.
const ICON_BRUSH_X10 =
  '<svg viewBox="0 0 16 24" fill="currentColor" aria-hidden="true">' +
  BRUSH_SHAPES +
  '<text x="8" y="22" font-size="8" font-weight="700" text-anchor="middle" font-family="ui-sans-serif, system-ui, sans-serif">×10</text>' +
  '</svg>';

const ICON_BRUSH_X100 =
  '<svg viewBox="0 0 16 24" fill="currentColor" aria-hidden="true">' +
  BRUSH_SHAPES +
  '<text x="8" y="22" font-size="7" font-weight="700" text-anchor="middle" font-family="ui-sans-serif, system-ui, sans-serif">×100</text>' +
  '</svg>';

/** @type {AchievementRule[]} */
export const MASTERY_ACHIEVEMENTS = [
  {
    id: 'clean-sweep',
    icon: ICON_BRUSH,
    name: 'Clean Sweep',
    description: 'Finished a daily puzzle 100%.',
    hint: 'Find every answer in one daily puzzle.',
    predicate: (s) => num(s.cleanSweeps) >= 1,
  },
  {
    id: 'ten-clean-sweeps',
    icon: ICON_BRUSH_X10,
    name: 'Ten Clean Sweeps',
    description: 'Finished ten daily puzzles 100%.',
    hint: 'Get a clean sweep on ten daily puzzles.',
    predicate: (s) => num(s.cleanSweeps) >= 10,
  },
  {
    id: 'hundred-clean-sweeps',
    icon: ICON_BRUSH_X100,
    name: 'Hundred Clean Sweeps',
    description: 'Finished a hundred daily puzzles 100%.',
    hint: 'Get a clean sweep on a hundred daily puzzles.',
    predicate: (s) => num(s.cleanSweeps) >= 100,
  },
  {
    id: 'flawless-sweep',
    icon: ICON_STAR,
    name: 'Flawless Sweep',
    description: 'Finished a daily 100% with no wrong guesses.',
    hint: 'Get a clean sweep without any wrong answer.',
    predicate: (s) => num(s.flawlessSweeps) >= 1,
  },
  {
    id: 'empty-slate',
    icon: gridIcon(0),
    name: 'Empty Slate',
    description: 'Submitted a daily without finding a single flag.',
    hint: 'Submit a daily with zero flags found (the badge of solidarity).',
    predicate: (s) => num(s.zeroScoreFinishes) >= 1,
  },
];

/** @type {AchievementRule[]} */
export const STREAK_ACHIEVEMENTS = [
  {
    id: 'first-daily',
    icon: gridIcon(1),
    name: 'First Daily',
    description: 'Completed your first daily puzzle.',
    hint: 'Finish one daily puzzle.',
    predicate: (s) => num(s.totalCompleted) >= 1,
  },
  {
    id: 'daily-habit',
    icon: gridIcon(7),
    name: 'Daily Habit',
    description: 'Played the daily puzzle 7 days in a row.',
    hint: 'Reach a 7-day streak.',
    predicate: (s) => num(s.maxStreak) >= 7,
  },
  {
    id: 'two-weeks-strong',
    icon: gridIcon(14),
    name: 'Two Weeks Strong',
    description: 'Kept the daily streak going for 14 days.',
    hint: 'Reach a 14-day streak.',
    predicate: (s) => num(s.maxStreak) >= 14,
  },
  {
    id: 'monthly-devotee',
    icon: gridIcon(16),
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
 * Return the rules that are earned in `after` but were NOT earned in
 * `before` — the "newly unlocked" set the celebration card should
 * fire for. Pure: takes snapshots in, returns rule array, no DOM.
 *
 * Either snapshot may be `null` (e.g. pre-fetch on a fresh page load
 * means there's no `before` baseline) — null is treated as an empty
 * snapshot, so a null `before` makes every earned rule in `after`
 * count as newly unlocked.
 *
 * Going backwards (a rule earned in `before` but not in `after`) is
 * intentionally ignored — losing a badge isn't an unlock event and
 * shouldn't pop a card. Predicate counters are monotonically
 * non-decreasing in practice; the guard is defensive.
 *
 * @param {Snapshot | null} before
 * @param {Snapshot | null} after
 * @param {AchievementRule[]} [rules]
 * @returns {AchievementRule[]}
 */
export function diffNewlyEarnedAchievements(before, after, rules = ALL_ACHIEVEMENTS) {
  const beforeIds = new Set(
    evaluateAchievements(before, rules)
      .filter((s) => s.earned)
      .map((s) => s.rule.id),
  );
  return evaluateAchievements(after, rules)
    .filter((s) => s.earned && !beforeIds.has(s.rule.id))
    .map((s) => s.rule);
}

/**
 * @param {unknown} x
 * @returns {number}
 */
function num(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}
