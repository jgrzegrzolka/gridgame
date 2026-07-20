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
 *   attemptedFinishes?: number,
 *   zeroScoreFinishes?: number,
 *   quizAttempts60s?: number,
 *   quizVariantsTouched60s?: number,
 *   quiz60sTouchedVariants?: string[],
 *   quizBestScore60s?: number,
 *   quiz60sClearedVariants?: string[],
 *   quizAttemptsAll?: number,
 *   quizVariantsTouchedAll?: number,
 *   quizAllLowWrongAny?: number,
 *   quizAllPerfectedVariants?: string[],
 *   hasNickname?: boolean,
 *   hasLinkedDevice?: boolean,
 *   dailySharesCount?: number,
 *   quizSharesCount?: number,
 *   findflagSharesCount?: number,
 *   coffeeClicked?: boolean,
 *   quiz60sCurrentStreak?: number,
 *   quiz60sMaxStreak?: number,
 *   quiz60sDistinctDays?: number,
 *   tttGamesPlayed?: number,
 *   hasWonTtt?: boolean,
 *   hasLostTtt?: boolean,
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
      const x = 0.5 + col * 4;
      const y = 0.5 + row * 4;
      // Every cell is drawn; the unearned ones are ghosted. Emitting only
      // the filled cells (the original approach) made low counts look like
      // a failed image rather than progress — `first-daily` was one square
      // in the corner of an empty box, and `empty-slate` was the empty box
      // alone. Ghosting gives both a grid to sit in, so "1 of 16" is
      // legible at a glance and the zero state reads as "nothing yet"
      // rather than "no icon".
      const ghost = count < filled ? '' : ' opacity="0.2"';
      cells.push(`<rect x="${x}" y="${y}" width="3" height="3"${ghost}/>`);
      count++;
    }
  }
  // No outline: the ghosted cells already bound the shape. The old frame
  // used stroke-width="0.5" on this 16-unit viewBox, which at the profile
  // badge's 20px render is ~0.6px and rounds away on standard-DPI screens
  // (the sub-pixel-hairline trap from PR #540 -> #541), so it was doing
  // nothing there anyway.
  return `<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">${cells.join('')}</svg>`;
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

// Magnifying glass — the honest-attempt tier (1 / ×10 / ×100).
// Reads as "you looked, you tried" without overlapping the brush
// (which is mastery / clean-sweep) or the stopwatch (which is 60s).
// Same shared-shape + label trick as BRUSH_SHAPES so the three tiers
// stay visually consistent.
const GLASS_SHAPES =
  '<rect x="5" y="2" width="4" height="2"/>' +
  '<rect x="3" y="4" width="2" height="2"/>' +
  '<rect x="9" y="4" width="2" height="2"/>' +
  '<rect x="2" y="6" width="2" height="3"/>' +
  '<rect x="10" y="6" width="2" height="3"/>' +
  '<rect x="3" y="9" width="2" height="2"/>' +
  '<rect x="9" y="9" width="2" height="2"/>' +
  '<rect x="5" y="11" width="4" height="2"/>' +
  '<rect x="10" y="10" width="2" height="2"/>' +
  '<rect x="11" y="11" width="2" height="2"/>' +
  '<rect x="12" y="12" width="2" height="2"/>' +
  '<rect x="13" y="13" width="2" height="2"/>';

const ICON_GLASS =
  '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">' +
  GLASS_SHAPES +
  '</svg>';

/**
 * @param {string} label
 * @param {number} fontSize
 * @returns {string}
 */
function glassWithLabel(label, fontSize) {
  return '<svg viewBox="0 0 16 24" fill="currentColor" aria-hidden="true">' +
    GLASS_SHAPES +
    `<text x="8" y="22" font-size="${fontSize}" font-weight="700" text-anchor="middle" font-family="ui-sans-serif, system-ui, sans-serif">${label}</text>` +
    '</svg>';
}
const ICON_GLASS_X10 = glassWithLabel('×10', 8);
const ICON_GLASS_X100 = glassWithLabel('×100', 7);

// Stopwatch: round face (built as 4 rect strips around a hollow
// centre), crown button on top, minute hand pointing up from centre.
// Matches the homepage tile icon for the 60s Quiz card.
const STOPWATCH_SHAPES =
  '<rect x="7" y="0" width="2" height="2"/>' +    // crown stem
  '<rect x="6" y="1" width="4" height="1"/>' +    // crown cap
  '<rect x="3" y="3" width="10" height="2"/>' +    // face top
  '<rect x="2" y="5" width="2" height="6"/>' +     // face left
  '<rect x="12" y="5" width="2" height="6"/>' +    // face right
  '<rect x="3" y="11" width="10" height="2"/>' +   // face bottom
  '<rect x="7" y="6" width="2" height="3"/>';      // minute hand

const ICON_STOPWATCH =
  '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">' +
  STOPWATCH_SHAPES +
  '</svg>';

// Stopwatch + day-label tier — drives the loyalty achievements
// (Sprint Habit / Steady Sprinter / Monthly Sprinter / Quiz
// Centurion). Same shared-shape pattern as the brushes / glasses.
/**
 * @param {string} label
 * @returns {string}
 */
function stopwatchWithLabel(label) {
  return '<svg viewBox="0 0 16 24" fill="currentColor" aria-hidden="true">' +
    STOPWATCH_SHAPES +
    `<text x="8" y="22" font-size="7" font-weight="700" text-anchor="middle" font-family="ui-sans-serif, system-ui, sans-serif">${label}</text>` +
    '</svg>';
}
const ICON_STOPWATCH_7D = stopwatchWithLabel('7d');
const ICON_STOPWATCH_14D = stopwatchWithLabel('14d');
const ICON_STOPWATCH_30D = stopwatchWithLabel('30d');
const ICON_STOPWATCH_100D = stopwatchWithLabel('100d');
// Volume tier — total 60s attempts. ×N labels distinguish these from
// the day-streak tier above which uses "Nd" labels.
const ICON_STOPWATCH_X100 = stopwatchWithLabel('×100');
const ICON_STOPWATCH_X500 = stopwatchWithLabel('×500');
const ICON_STOPWATCH_X1000 = stopwatchWithLabel('×1k');

// Globe: octagon outline + horizontal equator + vertical meridian.
const ICON_GLOBE =
  '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">' +
  '<rect x="5" y="1" width="6" height="2"/>' +
  '<rect x="3" y="3" width="2" height="2"/>' +
  '<rect x="11" y="3" width="2" height="2"/>' +
  '<rect x="2" y="5" width="2" height="6"/>' +
  '<rect x="12" y="5" width="2" height="6"/>' +
  '<rect x="3" y="11" width="2" height="2"/>' +
  '<rect x="11" y="11" width="2" height="2"/>' +
  '<rect x="5" y="13" width="6" height="2"/>' +
  '<rect x="3" y="7" width="10" height="2"/>' +    // equator
  '<rect x="7" y="3" width="2" height="10"/>' +    // meridian
  '</svg>';

// Lightning bolt for the skill-tier (best 60s score).
const BOLT_SHAPE = '<path d="M10 0L4 9L8 9L6 16L13 7L9 7Z"/>';

/**
 * @param {string} label
 * @param {number} fontSize
 * @returns {string}
 */
function boltWithLabel(label, fontSize) {
  return '<svg viewBox="0 0 16 24" fill="currentColor" aria-hidden="true">' +
    BOLT_SHAPE +
    `<text x="8" y="22" font-size="${fontSize}" font-weight="700" text-anchor="middle" font-family="ui-sans-serif, system-ui, sans-serif">${label}</text>` +
    '</svg>';
}
const ICON_BOLT_30 = boltWithLabel('30', 8);
const ICON_BOLT_40 = boltWithLabel('40', 8);
const ICON_BOLT_50 = boltWithLabel('50', 8);

// Flag + 2-letter region label for the per-variant "Cleared"
// achievements. Same shared-shape pattern as the brushes — the only
// thing that changes between tiles is the label.
const FLAG_SHAPES =
  '<rect x="2" y="1" width="2" height="14"/>' +    // pole
  '<rect x="4" y="2" width="9" height="6"/>';       // fabric

/**
 * @param {string} label
 * @returns {string}
 */
function flagWithLabel(label) {
  return '<svg viewBox="0 0 16 24" fill="currentColor" aria-hidden="true">' +
    FLAG_SHAPES +
    `<text x="8" y="22" font-size="8" font-weight="700" text-anchor="middle" font-family="ui-sans-serif, system-ui, sans-serif">${label}</text>` +
    '</svg>';
}
const ICON_FLAG_EU = flagWithLabel('EU');
const ICON_FLAG_AS = flagWithLabel('AS');
const ICON_FLAG_AF = flagWithLabel('AF');
const ICON_FLAG_NA = flagWithLabel('NA');
const ICON_FLAG_SA = flagWithLabel('SA');
const ICON_FLAG_OC = flagWithLabel('OC');
const ICON_FLAG_WO = flagWithLabel('WO');

// Trophy for the Atlas Champion meta achievement (cleared every
// variant including the impossible-feeling 195-flag "all countries"
// one). Previously deleted; re-added for this distinct ultimate-
// trophy concept.
const ICON_TROPHY =
  '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">' +
  '<rect x="4" y="2" width="8" height="6"/>' +
  '<rect x="2" y="3" width="2" height="4"/>' +
  '<rect x="12" y="3" width="2" height="4"/>' +
  '<rect x="7" y="8" width="2" height="3"/>' +
  '<rect x="4" y="11" width="8" height="1"/>' +
  '<rect x="3" y="12" width="10" height="2"/>' +
  '</svg>';

// Hollow ring — the shared base for the endurance tier. Suggests the
// "round" / loop of a full endurance pass. Iron Memory and Perfect
// Round overlay a small numeric label below it (see ringWithLabel).
const RING_SHAPES =
  '<rect x="4" y="2" width="8" height="2"/>' +
  '<rect x="4" y="12" width="8" height="2"/>' +
  '<rect x="2" y="4" width="2" height="8"/>' +
  '<rect x="12" y="4" width="2" height="8"/>';

const ICON_RING =
  '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">' +
  RING_SHAPES +
  '</svg>';

/**
 * @param {string} label
 * @returns {string}
 */
function ringWithLabel(label) {
  return '<svg viewBox="0 0 16 24" fill="currentColor" aria-hidden="true">' +
    RING_SHAPES +
    `<text x="8" y="22" font-size="8" font-weight="700" text-anchor="middle" font-family="ui-sans-serif, system-ui, sans-serif">${label}</text>` +
    '</svg>';
}
const ICON_RING_LE2 = ringWithLabel('≤2'); // "≤2"
const ICON_RING_0 = ringWithLabel('0');

// Diagonal path/arrow trail — for World Tour (endurance variety).
// Reads as "journey across all variants" without overlapping the
// 60s Cartographer's globe glyph.
const ICON_PATH =
  '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">' +
  '<rect x="1" y="13" width="3" height="2"/>' +
  '<rect x="5" y="11" width="2" height="2"/>' +
  '<rect x="7" y="9" width="2" height="2"/>' +
  '<rect x="9" y="7" width="2" height="2"/>' +
  '<rect x="11" y="5" width="2" height="2"/>' +
  '<rect x="12" y="3" width="3" height="2"/>' +
  '<rect x="11" y="1" width="2" height="2"/>' +
  '<rect x="13" y="3" width="2" height="2"/>' +
  '</svg>';

// Crown — the depth-of-knowledge meta trophy. Distinct from
// ICON_TROPHY (Atlas Champion / 60s meta) so the two ultimate
// achievements read as different ultimate trophies at a glance.
const ICON_CROWN =
  '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">' +
  '<rect x="2" y="3" width="2" height="4"/>' +
  '<rect x="3" y="2" width="2" height="2"/>' +
  '<rect x="7" y="4" width="2" height="3"/>' +
  '<rect x="7" y="2" width="2" height="2"/>' +
  '<rect x="12" y="3" width="2" height="4"/>' +
  '<rect x="11" y="2" width="2" height="2"/>' +
  '<rect x="2" y="7" width="12" height="3"/>' +
  '<rect x="4" y="11" width="2" height="2"/>' +
  '<rect x="10" y="11" width="2" height="2"/>' +
  '<rect x="2" y="13" width="12" height="2"/>' +
  '</svg>';

// Nametag — a small badge with a horizontal "name line" inside the
// frame. Drives the "Identified" social achievement.
const ICON_NAMETAG =
  '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">' +
  '<rect x="2" y="3" width="12" height="2"/>' +
  '<rect x="2" y="11" width="12" height="2"/>' +
  '<rect x="2" y="5" width="2" height="6"/>' +
  '<rect x="12" y="5" width="2" height="6"/>' +
  '<rect x="4" y="7" width="8" height="2"/>' +
  '</svg>';

// Share arrow — upward arrow rising from a box. Shared base shape
// for both share achievements; the surface (daily vs flagquiz) is
// communicated via a 1-letter label in 16x24 viewBox.
const SHARE_SHAPES =
  '<rect x="7" y="2" width="2" height="6"/>' +     // arrow stem
  '<rect x="5" y="4" width="2" height="2"/>' +     // arrowhead left
  '<rect x="9" y="4" width="2" height="2"/>' +     // arrowhead right
  '<rect x="3" y="9" width="2" height="5"/>' +     // box left
  '<rect x="11" y="9" width="2" height="5"/>' +    // box right
  '<rect x="3" y="13" width="10" height="2"/>';    // box bottom

/**
 * @param {string} label
 * @returns {string}
 */
function shareWithLabel(label) {
  return '<svg viewBox="0 0 16 24" fill="currentColor" aria-hidden="true">' +
    SHARE_SHAPES +
    `<text x="8" y="22" font-size="8" font-weight="700" text-anchor="middle" font-family="ui-sans-serif, system-ui, sans-serif">${label}</text>` +
    '</svg>';
}
const ICON_SHARE_DAILY = shareWithLabel('D');
const ICON_SHARE_QUIZ = shareWithLabel('Q');
const ICON_SHARE_FIND = shareWithLabel('F');

// Two overlapping link rings — Connected achievement (devices linked
// via sync). Reads as "two things joined" without overlapping any
// existing icon glyph.
const ICON_LINK =
  '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">' +
  // left ring
  '<rect x="1" y="5" width="2" height="2"/>' +
  '<rect x="1" y="9" width="2" height="2"/>' +
  '<rect x="3" y="3" width="2" height="2"/>' +
  '<rect x="3" y="11" width="2" height="2"/>' +
  '<rect x="5" y="5" width="2" height="2"/>' +
  '<rect x="5" y="9" width="2" height="2"/>' +
  // right ring
  '<rect x="9" y="5" width="2" height="2"/>' +
  '<rect x="9" y="9" width="2" height="2"/>' +
  '<rect x="11" y="3" width="2" height="2"/>' +
  '<rect x="11" y="11" width="2" height="2"/>' +
  '<rect x="13" y="5" width="2" height="2"/>' +
  '<rect x="13" y="9" width="2" height="2"/>' +
  // bridge between them
  '<rect x="7" y="7" width="2" height="2"/>' +
  '</svg>';

// Tic-tac-toe grid — clean # shape (two vertical bars crossed by two
// horizontal bars). Shared base for the W / L / ×10 / ×100 tier
// icons; same pattern as BRUSH_SHAPES / GLASS_SHAPES / RING_SHAPES.
const TTT_GRID_SHAPES =
  '<rect x="5" y="1" width="2" height="14"/>' +
  '<rect x="9" y="1" width="2" height="14"/>' +
  '<rect x="1" y="5" width="14" height="2"/>' +
  '<rect x="1" y="9" width="14" height="2"/>';

/**
 * @param {string} label
 * @param {number} fontSize
 * @returns {string}
 */
function tttGridWithLabel(label, fontSize) {
  return '<svg viewBox="0 0 16 24" fill="currentColor" aria-hidden="true">' +
    TTT_GRID_SHAPES +
    `<text x="8" y="22" font-size="${fontSize}" font-weight="700" text-anchor="middle" font-family="ui-sans-serif, system-ui, sans-serif">${label}</text>` +
    '</svg>';
}
const ICON_TTT_WIN = tttGridWithLabel('W', 8);
const ICON_TTT_LOSS = tttGridWithLabel('L', 8);
const ICON_TTT_X10 = tttGridWithLabel('×10', 8);
const ICON_TTT_X100 = tttGridWithLabel('×100', 7);

// Coffee cup with rising steam — Angel Investor. Pixel-art cup body
// (squarish) + handle on the right + two steam lines above.
const ICON_COFFEE =
  '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">' +
  // steam
  '<rect x="5" y="0" width="1" height="2"/>' +
  '<rect x="6" y="2" width="1" height="2"/>' +
  '<rect x="8" y="0" width="1" height="2"/>' +
  '<rect x="9" y="2" width="1" height="2"/>' +
  // cup top (rim)
  '<rect x="2" y="5" width="10" height="2"/>' +
  // cup body
  '<rect x="3" y="7" width="8" height="5"/>' +
  // handle
  '<rect x="12" y="7" width="2" height="2"/>' +
  '<rect x="13" y="9" width="1" height="2"/>' +
  '<rect x="12" y="11" width="2" height="1"/>' +
  // saucer
  '<rect x="2" y="13" width="10" height="2"/>' +
  '</svg>';

// Globe + small star above for the standalone "All Countries
// Mastered" endurance achievement — distinct from ICON_FLAG_WO
// (60s All Countries Cleared) so they don't collide on the grid.
const ICON_GLOBE_STAR =
  '<svg viewBox="0 0 16 24" fill="currentColor" aria-hidden="true">' +
  '<text x="8" y="6" font-size="8" font-weight="700" text-anchor="middle" font-family="ui-sans-serif, system-ui, sans-serif">★</text>' +
  '<rect x="5" y="9" width="6" height="2"/>' +
  '<rect x="3" y="11" width="2" height="2"/>' +
  '<rect x="11" y="11" width="2" height="2"/>' +
  '<rect x="2" y="13" width="2" height="6"/>' +
  '<rect x="12" y="13" width="2" height="6"/>' +
  '<rect x="3" y="19" width="2" height="2"/>' +
  '<rect x="11" y="19" width="2" height="2"/>' +
  '<rect x="5" y="21" width="6" height="2"/>' +
  '<rect x="3" y="15" width="10" height="2"/>' +
  '<rect x="7" y="11" width="2" height="10"/>' +
  '</svg>';

/** @type {AchievementRule[]} */
export const MASTERY_ACHIEVEMENTS = [
  // ---- Casual / engagement tier — submitted with some finds AND
  // some wrongs, the realistic majority of plays. Sits at the top of
  // the mastery cluster because every player who'd ever earn a
  // Clean Sweep would have earned one of these first.
  {
    id: 'honest-attempt',
    icon: ICON_GLASS,
    name: 'Honest Attempt',
    description: 'Submitted a daily with some flags found and some wrong guesses — proof you played.',
    hint: 'Finish a daily with at least one flag found and at least one wrong guess.',
    predicate: (s) => num(s.attemptedFinishes) >= 1,
  },
  {
    id: 'ten-honest-attempts',
    icon: ICON_GLASS_X10,
    name: 'Ten Honest Attempts',
    description: 'Submitted ten dailies with some flags found and some wrong guesses.',
    hint: 'Finish ten dailies with at least one flag found and at least one wrong guess.',
    predicate: (s) => num(s.attemptedFinishes) >= 10,
  },
  {
    id: 'hundred-honest-attempts',
    icon: ICON_GLASS_X100,
    name: 'Hundred Honest Attempts',
    description: 'Submitted a hundred dailies with some flags found and some wrong guesses.',
    hint: 'Finish a hundred dailies with at least one flag found and at least one wrong guess.',
    predicate: (s) => num(s.attemptedFinishes) >= 100,
  },
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

// 60s quiz variants in declaration order — used by Atlas Champion's
// "every variant cleared" predicate and pinned by the rule-hygiene
// tests so a new variant landing in the catalog without updating this
// list fails CI.
export const QUIZ_60S_VARIANTS = /** @type {const} */ ([
  'countries',
  'europe',
  'asia',
  'africa',
  'north-america',
  'south-america',
  'oceania',
]);

/** @type {AchievementRule[]} */
export const QUIZ_ACHIEVEMENTS = [
  {
    id: 'first-sprint',
    icon: ICON_STOPWATCH,
    name: 'First Sprint',
    description: 'Finished your first 60s quiz.',
    hint: 'Finish one 60s flag quiz.',
    predicate: (s) => num(s.quizAttempts60s) >= 1,
  },
  {
    id: 'cartographer',
    icon: ICON_GLOBE,
    name: 'Cartographer',
    description: 'Tried every 60s quiz variant — all 6 continents (plus All Countries).',
    hint: 'Finish a 60s round in every continent and in All Countries.',
    // Names, not a count — see hasTouched60s. Scoped to QUIZ_60S_VARIANTS so
    // decks that aren't slices of the world (weird / outlines / facts) can
    // neither satisfy this badge nor, by being added, make it harder. Nobody
    // loses a badge to this change: before `weird` existed the only way to
    // reach 7 was to touch exactly these 7.
    predicate: (s) => QUIZ_60S_VARIANTS.every((v) => hasTouched60s(s, v)),
  },
  // ---- Volume tier — total 60s attempts ever (every finish, PB or
  // not). The reward for sheer time invested. Counts include 0-score
  // rounds — the engagement signal is "you showed up to play",
  // regardless of how many flags you got.
  {
    id: 'hundred-sprints',
    icon: ICON_STOPWATCH_X100,
    name: 'Hundred Sprints',
    description: 'Finished a hundred 60s quizzes.',
    hint: 'Finish a hundred 60s quizzes.',
    predicate: (s) => num(s.quizAttempts60s) >= 100,
  },
  {
    id: 'five-hundred-sprints',
    icon: ICON_STOPWATCH_X500,
    name: 'Five Hundred Sprints',
    description: 'Finished five hundred 60s quizzes.',
    hint: 'Finish five hundred 60s quizzes.',
    predicate: (s) => num(s.quizAttempts60s) >= 500,
  },
  {
    id: 'thousand-sprints',
    icon: ICON_STOPWATCH_X1000,
    name: 'Thousand Sprints',
    description: 'Finished a thousand 60s quizzes — that\'s loyal.',
    hint: 'Finish a thousand 60s quizzes.',
    predicate: (s) => num(s.quizAttempts60s) >= 1000,
  },
  // ---- Loyalty tier — rewards coming back day after day. Same shape
  // as the daily streak tier, sourced from quiz_play engagement events
  // (one row per device per day per mode). Reads `quiz60sMaxStreak`
  // not `currentStreak` so an earned streak stays earned even if the
  // player breaks the streak later.
  {
    id: 'sprint-habit',
    icon: ICON_STOPWATCH_7D,
    name: 'Sprint Habit',
    description: 'Played a 60s quiz 7 days in a row.',
    hint: 'Reach a 7-day 60s quiz streak.',
    predicate: (s) => num(s.quiz60sMaxStreak) >= 7,
  },
  {
    id: 'steady-sprinter',
    icon: ICON_STOPWATCH_14D,
    name: 'Steady Sprinter',
    description: 'Played a 60s quiz 14 days in a row.',
    hint: 'Reach a 14-day 60s quiz streak.',
    predicate: (s) => num(s.quiz60sMaxStreak) >= 14,
  },
  {
    id: 'monthly-sprinter',
    icon: ICON_STOPWATCH_30D,
    name: 'Monthly Sprinter',
    description: 'Played a 60s quiz 30 days in a row.',
    hint: 'Reach a 30-day 60s quiz streak.',
    predicate: (s) => num(s.quiz60sMaxStreak) >= 30,
  },
  {
    id: 'quiz-centurion',
    icon: ICON_STOPWATCH_100D,
    name: 'Quiz Centurion',
    description: 'Played a 60s quiz on a hundred different days.',
    hint: 'Play a 60s quiz on 100 different days.',
    predicate: (s) => num(s.quiz60sDistinctDays) >= 100,
  },
  {
    id: 'quick-recall',
    icon: ICON_BOLT_30,
    name: 'Quick Recall',
    description: 'Scored 30 in a single 60s quiz.',
    hint: 'Reach a 60s quiz score of 30.',
    predicate: (s) => num(s.quizBestScore60s) >= 30,
  },
  {
    id: 'snap-recognition',
    icon: ICON_BOLT_40,
    name: 'Snap Recognition',
    description: 'Scored 40 in a single 60s quiz.',
    hint: 'Reach a 60s quiz score of 40.',
    predicate: (s) => num(s.quizBestScore60s) >= 40,
  },
  {
    id: 'flag-whisperer',
    icon: ICON_BOLT_50,
    name: 'Flag Whisperer',
    description: 'Scored 50 in a single 60s quiz.',
    hint: 'Reach a 60s quiz score of 50.',
    predicate: (s) => num(s.quizBestScore60s) >= 50,
  },
  // Per-variant "Cleared" — declared smallest pool first so the
  // easiest-to-earn tile sits at the top of the mastery cluster on
  // the profile grid. Threshold = sovereign pool size for the variant.
  // A legacy with-territories PB that met the sovereign count still
  // counts: computeQuiz folds a variant's old and new configKeys
  // together and takes the best.
  {
    id: 'south-america-cleared',
    icon: ICON_FLAG_SA,
    name: 'South America Cleared',
    description: 'Named every sovereign flag of South America in a single 60s round.',
    hint: 'Name every sovereign flag of South America in a single 60s round.',
    predicate: (s) => hasCleared(s, 'south-america'),
  },
  {
    id: 'oceania-cleared',
    icon: ICON_FLAG_OC,
    name: 'Oceania Cleared',
    description: 'Named every sovereign flag of Oceania in a single 60s round.',
    hint: 'Name every sovereign flag of Oceania in a single 60s round.',
    predicate: (s) => hasCleared(s, 'oceania'),
  },
  {
    id: 'north-america-cleared',
    icon: ICON_FLAG_NA,
    name: 'North America Cleared',
    description: 'Named every sovereign flag of North America in a single 60s round.',
    hint: 'Name every sovereign flag of North America in a single 60s round.',
    predicate: (s) => hasCleared(s, 'north-america'),
  },
  {
    id: 'europe-cleared',
    icon: ICON_FLAG_EU,
    name: 'Europe Cleared',
    description: 'Named every sovereign flag of Europe in a single 60s round.',
    hint: 'Name every sovereign flag of Europe in a single 60s round.',
    predicate: (s) => hasCleared(s, 'europe'),
  },
  {
    id: 'asia-cleared',
    icon: ICON_FLAG_AS,
    name: 'Asia Cleared',
    description: 'Named every sovereign flag of Asia in a single 60s round.',
    hint: 'Name every sovereign flag of Asia in a single 60s round.',
    predicate: (s) => hasCleared(s, 'asia'),
  },
  {
    id: 'africa-cleared',
    icon: ICON_FLAG_AF,
    name: 'Africa Cleared',
    description: 'Named every sovereign flag of Africa in a single 60s round.',
    hint: 'Name every sovereign flag of Africa in a single 60s round.',
    predicate: (s) => hasCleared(s, 'africa'),
  },
  {
    id: 'all-countries-cleared',
    icon: ICON_FLAG_WO,
    name: 'All Countries Cleared',
    description: 'Named every sovereign flag in the world in a single 60s round.',
    hint: 'Name every sovereign flag in the world in a single 60s round.',
    predicate: (s) => hasCleared(s, 'countries'),
  },
  {
    id: 'atlas-champion',
    icon: ICON_TROPHY,
    name: 'Atlas Champion',
    description: 'Cleared every 60s quiz variant — the ultimate trophy.',
    hint: 'Clear every continent AND the All Countries variant.',
    predicate: (s) => QUIZ_60S_VARIANTS.every((v) => hasCleared(s, v)),
  },
  // ---- Endurance (`all` mode) tier ---------------------------------------
  // Easiest at the top of the cluster, same convention as the 60s side.
  {
    id: 'marathon',
    icon: ICON_RING,
    name: 'Marathon',
    description: 'Finished your first endurance quiz.',
    hint: 'Finish one endurance quiz.',
    predicate: (s) => num(s.quizAttemptsAll) >= 1,
  },
  {
    id: 'world-tour',
    icon: ICON_PATH,
    name: 'World Tour',
    description: 'Finished an endurance quiz in every variant — all 7.',
    hint: 'Finish an endurance round in every variant.',
    predicate: (s) => num(s.quizVariantsTouchedAll) >= 7,
  },
  {
    id: 'iron-memory',
    icon: ICON_RING_LE2,
    name: 'Iron Memory',
    description: 'Finished an endurance quiz with no more than 2 wrong guesses.',
    hint: 'Finish an endurance round with at most 2 wrong guesses.',
    // The attempts guard prevents a spurious fire on the empty/never-
    // played snapshot — quizAllLowWrongAny would have its sentinel
    // value, but the guard makes the intent explicit too.
    predicate: (s) => num(s.quizAttemptsAll) >= 1 && num(s.quizAllLowWrongAny) <= 2,
  },
  {
    id: 'perfect-round',
    icon: ICON_RING_0,
    name: 'Perfect Round',
    description: 'Finished an endurance quiz with no wrong guesses.',
    hint: 'Finish an endurance round without any wrong guess.',
    predicate: (s) => hasPerfected(s, null),
  },
  {
    id: 'all-countries-mastered',
    icon: ICON_GLOBE_STAR,
    name: 'All Countries Mastered',
    description: 'Named every sovereign flag in the world in an endurance round with no wrong guesses.',
    hint: 'Name every sovereign flag in the world without any wrong guess.',
    predicate: (s) => hasPerfected(s, 'countries'),
  },
  {
    id: 'endurance-atlas',
    icon: ICON_CROWN,
    name: 'Endurance Atlas',
    description: 'Mastered every endurance quiz variant — the depth-of-knowledge trophy.',
    hint: 'Finish every endurance variant without any wrong guess.',
    predicate: (s) => QUIZ_60S_VARIANTS.every((v) => hasPerfected(s, v)),
  },
];

/** @type {AchievementRule[]} */
export const SOCIAL_ACHIEVEMENTS = [
  {
    id: 'identified',
    icon: ICON_NAMETAG,
    name: 'Identified',
    description: 'Set a nickname on your profile.',
    hint: 'Pick a nickname on your profile page.',
    predicate: (s) => s.hasNickname === true,
  },
  {
    id: 'matrix',
    icon: ICON_LINK,
    name: 'Matrix',
    description: 'Linked two devices via the sync flow.',
    hint: 'Link a second device on the Sync page.',
    predicate: (s) => s.hasLinkedDevice === true,
  },
  {
    id: 'daily-sharer',
    icon: ICON_SHARE_DAILY,
    name: 'Daily Sharer',
    description: 'Shared a daily puzzle result.',
    hint: 'Tap share on a daily puzzle result.',
    predicate: (s) => num(s.dailySharesCount) >= 1,
  },
  {
    id: 'quiz-sharer',
    icon: ICON_SHARE_QUIZ,
    name: 'Quiz Sharer',
    description: 'Shared a flag quiz result.',
    hint: 'Tap share on a flag quiz result.',
    predicate: (s) => num(s.quizSharesCount) >= 1,
  },
  {
    id: 'custom-crafter',
    icon: ICON_SHARE_FIND,
    name: 'Custom Crafter',
    description: 'Shared a custom puzzle you built in Make a puzzle.',
    hint: 'Tap share on a custom-puzzle result.',
    predicate: (s) => num(s.findflagSharesCount) >= 1,
  },
  {
    id: 'angel-investor',
    icon: ICON_COFFEE,
    name: 'Angel Investor',
    description: 'Bought the developer a coffee — thanks for the support!',
    hint: 'Buy the developer a coffee from the burger menu.',
    predicate: (s) => s.coffeeClicked === true,
  },
];

/** @type {AchievementRule[]} */
export const TTT_ACHIEVEMENTS = [
  {
    id: 'first-ttt-win',
    icon: ICON_TTT_WIN,
    name: 'First Win',
    description: 'Won your first tic-tac-toe game.',
    hint: 'Win a tic-tac-toe round.',
    predicate: (s) => s.hasWonTtt === true,
  },
  {
    id: 'first-ttt-loss',
    icon: ICON_TTT_LOSS,
    name: 'First Loss',
    description: "Lost a tic-tac-toe game — happens to the best of us.",
    hint: 'Lose a tic-tac-toe round (the badge of solidarity).',
    predicate: (s) => s.hasLostTtt === true,
  },
  {
    id: 'ten-ttt-games',
    icon: ICON_TTT_X10,
    name: 'Ten Games',
    description: 'Played ten tic-tac-toe games.',
    hint: 'Play ten tic-tac-toe rounds.',
    predicate: (s) => num(s.tttGamesPlayed) >= 10,
  },
  {
    id: 'hundred-ttt-games',
    icon: ICON_TTT_X100,
    name: 'Hundred Games',
    description: 'Played a hundred tic-tac-toe games.',
    hint: 'Play a hundred tic-tac-toe rounds.',
    predicate: (s) => num(s.tttGamesPlayed) >= 100,
  },
];

/**
 * Default rule order on the profile page. Streak first (every player
 * touches the daily flow), mastery second (gated on at least one
 * completion), quiz third (a separate game-mode tier), social fourth
 * (cross-game engagement signals), TTT last (its own game tier — one
 * rule for now; more land here when TTT activity picks up).
 * Declared this way so a newcomer sees the streak tier first — the
 * most accessible badges sit at the top of the grid.
 *
 * @type {AchievementRule[]}
 */
export const ALL_ACHIEVEMENTS = [
  ...STREAK_ACHIEVEMENTS,
  ...MASTERY_ACHIEVEMENTS,
  ...QUIZ_ACHIEVEMENTS,
  ...SOCIAL_ACHIEVEMENTS,
  ...TTT_ACHIEVEMENTS,
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

/**
 * Defensive lookup for the "Cleared <variant>" predicates — the
 * server returns the cleared set as a sorted array, but a malformed
 * or pre-quiz-compute response could yield `undefined` / non-array.
 * Mirrors the role `num` plays for numeric snapshot fields.
 *
 * @param {Snapshot} snapshot
 * @param {string} variant
 * @returns {boolean}
 */
function hasCleared(snapshot, variant) {
  const arr = snapshot.quiz60sClearedVariants;
  return Array.isArray(arr) && arr.includes(variant);
}

/**
 * Has the player finished a 60s round in `variant`? Mirrors `hasCleared`'s
 * defensive shape.
 *
 * Named lookup rather than the old `quizVariantsTouched60s >= 7` count. The
 * count only meant "tried every variant" while exactly seven variants existed;
 * Feature V's `weird` deck made eight, so six continents plus weird reached 7
 * and earned Cartographer with a continent never played. Counting is wrong in
 * principle here, not just off by one: every future deck moves the number.
 *
 * @param {Snapshot} snapshot
 * @param {string} variant
 * @returns {boolean}
 */
function hasTouched60s(snapshot, variant) {
  const arr = snapshot.quiz60sTouchedVariants;
  return Array.isArray(arr) && arr.includes(variant);
}

/**
 * Endurance-mode analogue of `hasCleared`. Pass a variant key to ask
 * "did this specific variant go perfect" or `null` to ask "did any
 * variant go perfect" (used by "Perfect Round" — fires on the first
 * endurance round the player finishes with zero wrong, regardless of
 * which variant).
 *
 * @param {Snapshot} snapshot
 * @param {string | null} variant
 * @returns {boolean}
 */
function hasPerfected(snapshot, variant) {
  const arr = snapshot.quizAllPerfectedVariants;
  if (!Array.isArray(arr)) return false;
  if (variant === null) return arr.length >= 1;
  return arr.includes(variant);
}
