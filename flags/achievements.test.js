import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  STREAK_ACHIEVEMENTS,
  MASTERY_ACHIEVEMENTS,
  QUIZ_ACHIEVEMENTS,
  QUIZ_60S_VARIANTS,
  ALL_ACHIEVEMENTS,
  evaluateAchievements,
  diffNewlyEarnedAchievements,
} from './achievements.js';

// --- Per-rule fixtures -----------------------------------------------------

test('first-daily fires the moment totalCompleted >= 1', () => {
  const rule = ruleById('first-daily');
  assert.equal(rule.predicate({ totalCompleted: 0 }), false);
  assert.equal(rule.predicate({ totalCompleted: 1 }), true);
  assert.equal(rule.predicate({ totalCompleted: 50 }), true);
});

test('first-daily ignores totalPlayed — only completions count', () => {
  // A player who opened 10 puzzles but never finished one isn't a "daily player" yet.
  const rule = ruleById('first-daily');
  assert.equal(rule.predicate({ totalPlayed: 10, totalCompleted: 0 }), false);
});

test('daily-habit fires at maxStreak >= 7, not before', () => {
  const rule = ruleById('daily-habit');
  assert.equal(rule.predicate({ maxStreak: 6 }), false);
  assert.equal(rule.predicate({ maxStreak: 7 }), true);
  assert.equal(rule.predicate({ maxStreak: 100 }), true);
});

test('daily-habit reads maxStreak, not currentStreak', () => {
  // A player who once had a 14-day streak and then missed a day still has the badge.
  const rule = ruleById('daily-habit');
  assert.equal(rule.predicate({ currentStreak: 0, maxStreak: 14 }), true);
  assert.equal(rule.predicate({ currentStreak: 14, maxStreak: 6 }), false);
});

test('two-weeks-strong fires at maxStreak >= 14', () => {
  const rule = ruleById('two-weeks-strong');
  assert.equal(rule.predicate({ maxStreak: 13 }), false);
  assert.equal(rule.predicate({ maxStreak: 14 }), true);
});

test('monthly-devotee fires at maxStreak >= 30', () => {
  const rule = ruleById('monthly-devotee');
  assert.equal(rule.predicate({ maxStreak: 29 }), false);
  assert.equal(rule.predicate({ maxStreak: 30 }), true);
});

// --- Mastery tier ----------------------------------------------------------

test('clean-sweep fires at cleanSweeps >= 1', () => {
  const rule = ruleById('clean-sweep');
  assert.equal(rule.predicate({ cleanSweeps: 0 }), false);
  assert.equal(rule.predicate({ cleanSweeps: 1 }), true);
  assert.equal(rule.predicate({ cleanSweeps: 99 }), true);
});

test('ten-clean-sweeps fires at cleanSweeps >= 10', () => {
  const rule = ruleById('ten-clean-sweeps');
  assert.equal(rule.predicate({ cleanSweeps: 9 }), false);
  assert.equal(rule.predicate({ cleanSweeps: 10 }), true);
});

test('hundred-clean-sweeps fires at cleanSweeps >= 100', () => {
  const rule = ruleById('hundred-clean-sweeps');
  assert.equal(rule.predicate({ cleanSweeps: 99 }), false);
  assert.equal(rule.predicate({ cleanSweeps: 100 }), true);
});

test('honest-attempt tier fires at attemptedFinishes >= 1 / 10 / 100', () => {
  assert.equal(ruleById('honest-attempt').predicate({ attemptedFinishes: 0 }), false);
  assert.equal(ruleById('honest-attempt').predicate({ attemptedFinishes: 1 }), true);
  assert.equal(ruleById('ten-honest-attempts').predicate({ attemptedFinishes: 9 }), false);
  assert.equal(ruleById('ten-honest-attempts').predicate({ attemptedFinishes: 10 }), true);
  assert.equal(ruleById('hundred-honest-attempts').predicate({ attemptedFinishes: 99 }), false);
  assert.equal(ruleById('hundred-honest-attempts').predicate({ attemptedFinishes: 100 }), true);
});

test('honest-attempt reads attemptedFinishes, not clean/flawless/zero counters', () => {
  // The casual tier and the perfection tier share daily submissions
  // as their source but track different facets — pin the separation.
  assert.equal(ruleById('honest-attempt').predicate({ cleanSweeps: 99 }), false);
  assert.equal(ruleById('honest-attempt').predicate({ flawlessSweeps: 99 }), false);
  assert.equal(ruleById('honest-attempt').predicate({ zeroScoreFinishes: 99 }), false);
});

test('flawless-sweep fires at flawlessSweeps >= 1', () => {
  const rule = ruleById('flawless-sweep');
  assert.equal(rule.predicate({ flawlessSweeps: 0 }), false);
  assert.equal(rule.predicate({ flawlessSweeps: 1 }), true);
});

test('empty-slate fires at zeroScoreFinishes >= 1', () => {
  const rule = ruleById('empty-slate');
  assert.equal(rule.predicate({ zeroScoreFinishes: 0 }), false);
  assert.equal(rule.predicate({ zeroScoreFinishes: 1 }), true);
});

// --- Quiz tier ---------------------------------------------------------------

test('first-sprint fires at quizAttempts60s >= 1', () => {
  const rule = ruleById('first-sprint');
  assert.equal(rule.predicate({ quizAttempts60s: 0 }), false);
  assert.equal(rule.predicate({ quizAttempts60s: 1 }), true);
});

test('cartographer fires only when every sovereign variant has been tried', () => {
  const rule = ruleById('cartographer');
  assert.equal(rule.predicate({ quiz60sTouchedVariants: [...QUIZ_60S_VARIANTS] }), true);
  // Missing any one → not earned.
  for (let i = 0; i < QUIZ_60S_VARIANTS.length; i++) {
    const without = QUIZ_60S_VARIANTS.filter((_, j) => j !== i);
    assert.equal(
      rule.predicate({ quiz60sTouchedVariants: [...without] }),
      false,
      `missing ${QUIZ_60S_VARIANTS[i]} → not earned`,
    );
  }
});

// Feature V. The badge says "all 7 continents (plus All Countries)". It used
// to be a bare `touched >= 7`, which was only correct while exactly 7 variants
// existed. `weird` made 8, so counting let a player skip a continent and still
// earn it. Pool-growth makes counting wrong in general: any deck we add moves
// the number, and the non-sovereign pool grows with data work.
test('cartographer: a non-sovereign deck cannot stand in for a continent', () => {
  const rule = ruleById('cartographer');
  const sixSovereign = QUIZ_60S_VARIANTS.filter((v) => v !== 'oceania');
  assert.equal(sixSovereign.length, 6);
  assert.equal(
    rule.predicate({ quiz60sTouchedVariants: [...sixSovereign, 'weird'] }),
    false,
    'six continents + weird must NOT earn Cartographer — Oceania was never played',
  );
});

test('cartographer tolerates a malformed / missing touched list (defensive)', () => {
  const rule = ruleById('cartographer');
  assert.equal(rule.predicate({}), false);
  assert.equal(rule.predicate({ quiz60sTouchedVariants: /** @type {any} */ ('oops') }), false);
  assert.equal(rule.predicate({ quiz60sTouchedVariants: /** @type {any} */ (null) }), false);
});

test('volume tier fires at 100 / 500 / 1000 quizAttempts60s', () => {
  assert.equal(ruleById('hundred-sprints').predicate({ quizAttempts60s: 99 }), false);
  assert.equal(ruleById('hundred-sprints').predicate({ quizAttempts60s: 100 }), true);
  assert.equal(ruleById('five-hundred-sprints').predicate({ quizAttempts60s: 499 }), false);
  assert.equal(ruleById('five-hundred-sprints').predicate({ quizAttempts60s: 500 }), true);
  assert.equal(ruleById('thousand-sprints').predicate({ quizAttempts60s: 999 }), false);
  assert.equal(ruleById('thousand-sprints').predicate({ quizAttempts60s: 1000 }), true);
});

test('volume tier reads quizAttempts60s, not the loyalty or skill counters', () => {
  // A player with a 100-day streak but few actual attempts must not
  // accidentally earn a volume badge; a high best-score doesn't count.
  assert.equal(ruleById('hundred-sprints').predicate({ quiz60sMaxStreak: 999 }), false);
  assert.equal(ruleById('hundred-sprints').predicate({ quizBestScore60s: 999 }), false);
});

test('skill tier fires at score thresholds 30 / 40 / 50', () => {
  assert.equal(ruleById('quick-recall').predicate({ quizBestScore60s: 29 }), false);
  assert.equal(ruleById('quick-recall').predicate({ quizBestScore60s: 30 }), true);
  assert.equal(ruleById('snap-recognition').predicate({ quizBestScore60s: 39 }), false);
  assert.equal(ruleById('snap-recognition').predicate({ quizBestScore60s: 40 }), true);
  assert.equal(ruleById('flag-whisperer').predicate({ quizBestScore60s: 49 }), false);
  assert.equal(ruleById('flag-whisperer').predicate({ quizBestScore60s: 50 }), true);
});

test('each "Cleared <variant>" rule reads the corresponding variant key', () => {
  // Per-continent / per-variant predicates are 1:1 with QUIZ_60S_VARIANTS;
  // walk every one of them so a typo in a single id is caught.
  const idByVariant = {
    countries: 'all-countries-cleared',
    europe: 'europe-cleared',
    asia: 'asia-cleared',
    africa: 'africa-cleared',
    'north-america': 'north-america-cleared',
    'south-america': 'south-america-cleared',
    oceania: 'oceania-cleared',
  };
  for (const v of QUIZ_60S_VARIANTS) {
    const rule = ruleById(idByVariant[v]);
    assert.equal(rule.predicate({ quiz60sClearedVariants: [] }), false, `${v}: empty array → not earned`);
    assert.equal(rule.predicate({ quiz60sClearedVariants: [v] }), true, `${v}: variant present → earned`);
    // Wrong variant in the array doesn't accidentally fire.
    const other = v === 'countries' ? 'europe' : 'countries';
    assert.equal(rule.predicate({ quiz60sClearedVariants: [other] }), false, `${v}: other variant only → not earned`);
  }
});

test('cleared predicates tolerate a malformed quiz60sClearedVariants (defensive)', () => {
  const rule = ruleById('europe-cleared');
  assert.equal(rule.predicate({ quiz60sClearedVariants: /** @type {any} */ ('oops') }), false);
  assert.equal(rule.predicate({ quiz60sClearedVariants: /** @type {any} */ (null) }), false);
  // Empty snapshot — the field is just missing.
  assert.equal(rule.predicate({}), false);
});

test('atlas-champion fires only when EVERY variant is cleared', () => {
  const rule = ruleById('atlas-champion');
  // Missing any one variant → not earned.
  for (let i = 0; i < QUIZ_60S_VARIANTS.length; i++) {
    const without = QUIZ_60S_VARIANTS.filter((_, j) => j !== i);
    assert.equal(
      rule.predicate({ quiz60sClearedVariants: [...without] }),
      false,
      `missing ${QUIZ_60S_VARIANTS[i]} → not earned`,
    );
  }
  // All present → earned.
  assert.equal(rule.predicate({ quiz60sClearedVariants: [...QUIZ_60S_VARIANTS] }), true);
});

test('QUIZ_60S_VARIANTS length matches the per-variant rule count (drift detector)', () => {
  // Per-variant "Cleared <X>" rules are 1:1 with QUIZ_60S_VARIANTS.
  // Adding a new variant to QUIZ_60S_VARIANTS without adding a matching
  // rule (or vice versa) is a latent inconsistency this catches loudly.
  const clearedRules = QUIZ_ACHIEVEMENTS.filter((r) => r.id.endsWith('-cleared'));
  assert.equal(
    clearedRules.length,
    QUIZ_60S_VARIANTS.length,
    `expected ${QUIZ_60S_VARIANTS.length} "Cleared <variant>" rules to match QUIZ_60S_VARIANTS, got ${clearedRules.length}`,
  );
});

test('quiz rules do NOT cross-contaminate (each reads only its own counter)', () => {
  // Pin the field-mapping so a future copy-paste rename can't silently
  // wire a quiz rule to a daily counter or vice versa.
  assert.equal(ruleById('first-sprint').predicate({ totalCompleted: 99 }), false);
  assert.equal(ruleById('quick-recall').predicate({ cleanSweeps: 99 }), false);
  assert.equal(ruleById('europe-cleared').predicate({ quizBestScore60s: 99 }), false);
});

// --- Loyalty tier (60s quiz streak / distinct days) ------------------------

test('sprint-habit / steady-sprinter / monthly-sprinter fire at 7 / 14 / 30 day streak (reads maxStreak)', () => {
  assert.equal(ruleById('sprint-habit').predicate({ quiz60sMaxStreak: 6 }), false);
  assert.equal(ruleById('sprint-habit').predicate({ quiz60sMaxStreak: 7 }), true);
  assert.equal(ruleById('steady-sprinter').predicate({ quiz60sMaxStreak: 13 }), false);
  assert.equal(ruleById('steady-sprinter').predicate({ quiz60sMaxStreak: 14 }), true);
  assert.equal(ruleById('monthly-sprinter').predicate({ quiz60sMaxStreak: 29 }), false);
  assert.equal(ruleById('monthly-sprinter').predicate({ quiz60sMaxStreak: 30 }), true);
});

test('loyalty streak rules read maxStreak, not currentStreak (an earned streak stays earned)', () => {
  // Mirrors the daily-streak tier: the player who once reached a
  // 14-day streak keeps the badge even if they later miss a day.
  assert.equal(ruleById('sprint-habit').predicate({ quiz60sCurrentStreak: 0, quiz60sMaxStreak: 7 }), true);
  assert.equal(ruleById('sprint-habit').predicate({ quiz60sCurrentStreak: 7, quiz60sMaxStreak: 6 }), false);
});

test('quiz-centurion fires at 100 distinct days', () => {
  const rule = ruleById('quiz-centurion');
  assert.equal(rule.predicate({ quiz60sDistinctDays: 99 }), false);
  assert.equal(rule.predicate({ quiz60sDistinctDays: 100 }), true);
});

test('loyalty rules do NOT cross-contaminate (read their own quiz60s counters only)', () => {
  // Streak rules read quiz60sMaxStreak specifically — not the daily
  // maxStreak, not the distinct-days count, not the engagement counters.
  assert.equal(ruleById('sprint-habit').predicate({ maxStreak: 99 }), false);
  assert.equal(ruleById('sprint-habit').predicate({ quiz60sDistinctDays: 99 }), false);
  assert.equal(ruleById('quiz-centurion').predicate({ quiz60sMaxStreak: 99 }), false);
});

// --- Endurance tier ---------------------------------------------------------

test('marathon fires at quizAttemptsAll >= 1', () => {
  const rule = ruleById('marathon');
  assert.equal(rule.predicate({ quizAttemptsAll: 0 }), false);
  assert.equal(rule.predicate({ quizAttemptsAll: 1 }), true);
});

test('world-tour fires at quizVariantsTouchedAll >= 7', () => {
  const rule = ruleById('world-tour');
  assert.equal(rule.predicate({ quizVariantsTouchedAll: 6 }), false);
  assert.equal(rule.predicate({ quizVariantsTouchedAll: 7 }), true);
});

test('iron-memory needs both attempts >= 1 AND low-wrong <= 2', () => {
  const rule = ruleById('iron-memory');
  // No endurance plays at all — the snapshot-default sentinel keeps it locked.
  assert.equal(rule.predicate({ quizAllLowWrongAny: Number.MAX_SAFE_INTEGER }), false);
  // Attempts but no good round yet — still locked.
  assert.equal(rule.predicate({ quizAttemptsAll: 5, quizAllLowWrongAny: 7 }), false);
  // Attempts + at least one round at the threshold — earned.
  assert.equal(rule.predicate({ quizAttemptsAll: 5, quizAllLowWrongAny: 2 }), true);
  // Defensive: low-wrong reported but attempts is missing → still false.
  assert.equal(rule.predicate({ quizAllLowWrongAny: 0 }), false);
});

test('perfect-round fires as soon as any endurance variant lands in the perfected set', () => {
  const rule = ruleById('perfect-round');
  assert.equal(rule.predicate({ quizAllPerfectedVariants: [] }), false);
  assert.equal(rule.predicate({ quizAllPerfectedVariants: ['oceania'] }), true);
  // Defensive: malformed/missing array → locked.
  assert.equal(rule.predicate({}), false);
  assert.equal(rule.predicate({ quizAllPerfectedVariants: /** @type {any} */ ('oops') }), false);
});

test('all-countries-mastered fires only on the "countries" variant being perfected', () => {
  const rule = ruleById('all-countries-mastered');
  // Other variants perfected but not countries → locked.
  assert.equal(rule.predicate({ quizAllPerfectedVariants: ['europe', 'asia'] }), false);
  // countries perfected → earned.
  assert.equal(rule.predicate({ quizAllPerfectedVariants: ['countries'] }), true);
});

test('endurance-atlas fires only when EVERY variant is in the perfected set', () => {
  const rule = ruleById('endurance-atlas');
  for (let i = 0; i < QUIZ_60S_VARIANTS.length; i++) {
    const without = QUIZ_60S_VARIANTS.filter((_, j) => j !== i);
    assert.equal(
      rule.predicate({ quizAllPerfectedVariants: [...without] }),
      false,
      `missing ${QUIZ_60S_VARIANTS[i]} → not earned`,
    );
  }
  assert.equal(rule.predicate({ quizAllPerfectedVariants: [...QUIZ_60S_VARIANTS] }), true);
});

// --- Social tier ------------------------------------------------------------

test('identified fires when hasNickname is strict-true', () => {
  const rule = ruleById('identified');
  assert.equal(rule.predicate({ hasNickname: true }), true);
  assert.equal(rule.predicate({ hasNickname: false }), false);
  assert.equal(rule.predicate({}), false);
  // Defensive: a truthy non-boolean must not satisfy the predicate.
  assert.equal(rule.predicate({ hasNickname: /** @type {any} */ ('true') }), false);
  assert.equal(rule.predicate({ hasNickname: /** @type {any} */ (1) }), false);
});

test('daily-sharer fires at dailySharesCount >= 1', () => {
  const rule = ruleById('daily-sharer');
  assert.equal(rule.predicate({ dailySharesCount: 0 }), false);
  assert.equal(rule.predicate({ dailySharesCount: 1 }), true);
});

test('quiz-sharer fires at quizSharesCount >= 1', () => {
  const rule = ruleById('quiz-sharer');
  assert.equal(rule.predicate({ quizSharesCount: 0 }), false);
  assert.equal(rule.predicate({ quizSharesCount: 1 }), true);
});

test('connected fires when hasLinkedDevice is strict-true', () => {
  const rule = ruleById('matrix');
  assert.equal(rule.predicate({ hasLinkedDevice: true }), true);
  assert.equal(rule.predicate({ hasLinkedDevice: false }), false);
  assert.equal(rule.predicate({}), false);
  assert.equal(rule.predicate({ hasLinkedDevice: /** @type {any} */ ('yes') }), false);
});

test('custom-crafter fires at findflagSharesCount >= 1', () => {
  const rule = ruleById('custom-crafter');
  assert.equal(rule.predicate({ findflagSharesCount: 0 }), false);
  assert.equal(rule.predicate({ findflagSharesCount: 1 }), true);
});

test('angel-investor fires when coffeeClicked is strict-true', () => {
  const rule = ruleById('angel-investor');
  assert.equal(rule.predicate({ coffeeClicked: true }), true);
  assert.equal(rule.predicate({ coffeeClicked: false }), false);
  assert.equal(rule.predicate({}), false);
  // Defensive against a future server-shape change where the field is
  // returned as a count (1) rather than a boolean — must NOT qualify.
  assert.equal(rule.predicate({ coffeeClicked: /** @type {any} */ (1) }), false);
});

// --- TTT tier --------------------------------------------------------------

test('first-ttt-win fires when hasWonTtt is strict-true', () => {
  const rule = ruleById('first-ttt-win');
  assert.equal(rule.predicate({ hasWonTtt: true }), true);
  assert.equal(rule.predicate({ hasWonTtt: false }), false);
  assert.equal(rule.predicate({}), false);
  // Defensive: a truthy non-boolean must not satisfy the predicate.
  assert.equal(rule.predicate({ hasWonTtt: /** @type {any} */ (1) }), false);
});

test('first-ttt-loss fires when hasLostTtt is strict-true', () => {
  const rule = ruleById('first-ttt-loss');
  assert.equal(rule.predicate({ hasLostTtt: true }), true);
  assert.equal(rule.predicate({ hasLostTtt: false }), false);
  assert.equal(rule.predicate({}), false);
});

test('ten-ttt-games / hundred-ttt-games fire at 10 / 100 tttGamesPlayed', () => {
  assert.equal(ruleById('ten-ttt-games').predicate({ tttGamesPlayed: 9 }), false);
  assert.equal(ruleById('ten-ttt-games').predicate({ tttGamesPlayed: 10 }), true);
  assert.equal(ruleById('hundred-ttt-games').predicate({ tttGamesPlayed: 99 }), false);
  assert.equal(ruleById('hundred-ttt-games').predicate({ tttGamesPlayed: 100 }), true);
});

test('TTT rules do NOT cross-contaminate (won vs lost vs count are independent)', () => {
  // Winning shouldn't accidentally fire First Loss; the count tiers
  // shouldn't fire from a single win/loss flag; etc.
  assert.equal(ruleById('first-ttt-win').predicate({ tttGamesPlayed: 99, hasWonTtt: false }), false);
  assert.equal(ruleById('first-ttt-loss').predicate({ tttGamesPlayed: 99, hasLostTtt: false }), false);
  assert.equal(ruleById('ten-ttt-games').predicate({ hasWonTtt: true, hasLostTtt: true }), false);
  // And a daily-puzzle champion shouldn't get a TTT achievement.
  assert.equal(ruleById('first-ttt-win').predicate({ totalCompleted: 99, cleanSweeps: 99 }), false);
});

test('social rules do NOT cross-contaminate (each reads only its own counter)', () => {
  // Pin the field-mapping so a future rename can't silently wire a
  // share rule to the wrong surface or to a daily counter.
  assert.equal(ruleById('identified').predicate({ dailySharesCount: 99 }), false);
  assert.equal(ruleById('daily-sharer').predicate({ quizSharesCount: 99 }), false);
  assert.equal(ruleById('daily-sharer').predicate({ findflagSharesCount: 99 }), false);
  assert.equal(ruleById('quiz-sharer').predicate({ dailySharesCount: 99 }), false);
  assert.equal(ruleById('custom-crafter').predicate({ dailySharesCount: 99 }), false);
  assert.equal(ruleById('custom-crafter').predicate({ quizSharesCount: 99 }), false);
  assert.equal(ruleById('matrix').predicate({ hasNickname: true }), false);
  assert.equal(ruleById('angel-investor').predicate({ dailySharesCount: 99 }), false);
  assert.equal(ruleById('daily-sharer').predicate({ totalCompleted: 99 }), false);
});

test('endurance rules do NOT cross-contaminate (each reads only its own counter)', () => {
  // Endurance counters must not satisfy 60s rules, and vice versa.
  assert.equal(ruleById('marathon').predicate({ quizAttempts60s: 99 }), false);
  assert.equal(ruleById('perfect-round').predicate({ quiz60sClearedVariants: ['oceania'] }), false);
  assert.equal(ruleById('first-sprint').predicate({ quizAttemptsAll: 99 }), false);
  assert.equal(ruleById('oceania-cleared').predicate({ quizAllPerfectedVariants: ['oceania'] }), false);
});

test('mastery rules do NOT cross-contaminate (each reads only its own counter)', () => {
  // Pin the field-mapping so a future copy-paste rename can't silently
  // wire a rule to the wrong counter.
  assert.equal(ruleById('clean-sweep').predicate({ zeroScoreFinishes: 99 }), false);
  assert.equal(ruleById('empty-slate').predicate({ cleanSweeps: 99 }), false);
  // flawless-sweep must read flawlessSweeps specifically — having lots
  // of clean sweeps (with mistakes along the way) shouldn't qualify.
  assert.equal(ruleById('flawless-sweep').predicate({ cleanSweeps: 99 }), false);
  assert.equal(ruleById('flawless-sweep').predicate({ zeroScoreFinishes: 99 }), false);
});

// --- Snapshot defensiveness ------------------------------------------------

test('every predicate handles a null snapshot without throwing', () => {
  for (const rule of ALL_ACHIEVEMENTS) {
    assert.equal(rule.predicate({}), false, `${rule.id} should return false on empty snapshot`);
  }
});

test('every predicate handles non-numeric fields without throwing', () => {
  const garbage = /** @type {any} */ ({
    maxStreak: 'oops', totalCompleted: null, cleanSweeps: undefined, zeroScoreFinishes: NaN,
  });
  for (const rule of ALL_ACHIEVEMENTS) {
    assert.doesNotThrow(() => rule.predicate(garbage));
    assert.equal(rule.predicate(garbage), false);
  }
});

// --- Rule-set hygiene ------------------------------------------------------

test('every rule has a unique id (across all tiers)', () => {
  const ids = ALL_ACHIEVEMENTS.map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length, `duplicate ids: ${ids.join(', ')}`);
});

test('every rule has non-empty name, description, hint, and an inline SVG icon', () => {
  for (const rule of ALL_ACHIEVEMENTS) {
    assert.ok(rule.name.length > 0, `${rule.id}: name`);
    assert.ok(rule.description.length > 0, `${rule.id}: description`);
    assert.ok(rule.hint.length > 0, `${rule.id}: hint`);
    // Icons are inline SVG markup — palette-faithful, currentColor
    // fill. Smoke-test the shape so a future rename or refactor that
    // drops the SVG can't sneak through.
    assert.ok(rule.icon.startsWith('<svg '), `${rule.id}: icon should be SVG markup`);
    assert.ok(rule.icon.includes('currentColor'), `${rule.id}: icon should use currentColor for palette`);
    assert.ok(rule.icon.endsWith('</svg>'), `${rule.id}: icon should close </svg>`);
  }
});

// --- evaluateAchievements --------------------------------------------------

test('evaluateAchievements returns all rules in declaration order (streak then mastery)', () => {
  const out = evaluateAchievements({});
  assert.deepEqual(
    out.map((s) => s.rule.id),
    ALL_ACHIEVEMENTS.map((r) => r.id),
  );
});

test('evaluateAchievements marks every status earned=false for empty snapshot', () => {
  const out = evaluateAchievements({});
  for (const s of out) assert.equal(s.earned, false);
});

test('evaluateAchievements marks earned=true for the rules whose predicates fire', () => {
  const out = evaluateAchievements({ totalCompleted: 1, maxStreak: 7 });
  const earned = out.filter((s) => s.earned).map((s) => s.rule.id);
  assert.deepEqual(earned.sort(), ['daily-habit', 'first-daily']);
});

test('evaluateAchievements with mastery counters lights up the mastery tier independently', () => {
  const out = evaluateAchievements({
    cleanSweeps: 1, flawlessSweeps: 1, attemptedFinishes: 1, zeroScoreFinishes: 1,
  });
  const earned = out.filter((s) => s.earned).map((s) => s.rule.id);
  // No streak fields → streak tier all locked. Mastery: clean-sweep,
  // flawless-sweep, honest-attempt, empty-slate fire (one each at the
  // tier-1 threshold). The ×10 / ×100 tiers stay locked at this level.
  assert.deepEqual(earned.sort(), [
    'clean-sweep', 'empty-slate', 'flawless-sweep', 'honest-attempt',
  ]);
});

test('evaluateAchievements tolerates a null snapshot (no profile data fetched yet)', () => {
  const out = evaluateAchievements(null);
  for (const s of out) assert.equal(s.earned, false);
});

test('evaluateAchievements at a 30-day streak earns every streak badge', () => {
  const out = evaluateAchievements({ totalCompleted: 30, maxStreak: 30 });
  const earnedStreak = out.filter((s) => s.earned).map((s) => s.rule.id);
  // Streak-only snapshot — mastery tier stays locked.
  assert.deepEqual(
    earnedStreak.sort(),
    STREAK_ACHIEVEMENTS.map((r) => r.id).sort(),
    'all streak rules should be earned (mastery stays locked without mastery data)',
  );
});

test('evaluateAchievements with a full snapshot earns every badge across every tier', () => {
  const out = evaluateAchievements({
    totalCompleted: 30, maxStreak: 30, cleanSweeps: 100, flawlessSweeps: 1, attemptedFinishes: 100, zeroScoreFinishes: 1,
    quizAttempts60s: 1000, quizVariantsTouched60s: 7, quizBestScore60s: 50,
    quiz60sTouchedVariants: [...QUIZ_60S_VARIANTS],
    quiz60sClearedVariants: [...QUIZ_60S_VARIANTS],
    quizAttemptsAll: 50, quizVariantsTouchedAll: 7, quizAllLowWrongAny: 0,
    quizAllPerfectedVariants: [...QUIZ_60S_VARIANTS],
    hasNickname: true, hasLinkedDevice: true,
    dailySharesCount: 1, quizSharesCount: 1, findflagSharesCount: 1, coffeeClicked: true,
    quiz60sCurrentStreak: 30, quiz60sMaxStreak: 30, quiz60sDistinctDays: 100,
    tttGamesPlayed: 100, hasWonTtt: true, hasLostTtt: true,
  });
  assert.ok(out.every((s) => s.earned), 'all rules should be earned');
});

// --- diffNewlyEarnedAchievements -------------------------------------------

test('diffNewlyEarnedAchievements: null before → every earned rule in after counts as new', () => {
  const newly = diffNewlyEarnedAchievements(null, { totalCompleted: 1 });
  assert.deepEqual(newly.map((r) => r.id), ['first-daily']);
});

test('diffNewlyEarnedAchievements: empty before → every earned rule in after counts as new', () => {
  const newly = diffNewlyEarnedAchievements({}, { totalCompleted: 1, cleanSweeps: 1 });
  assert.deepEqual(newly.map((r) => r.id).sort(), ['clean-sweep', 'first-daily']);
});

test('diffNewlyEarnedAchievements: same earned set → empty (already-earned isn\'t a re-unlock)', () => {
  const snap = { totalCompleted: 1, cleanSweeps: 1 };
  const newly = diffNewlyEarnedAchievements(snap, snap);
  assert.deepEqual(newly, []);
});

test('diffNewlyEarnedAchievements: only the rules that crossed the threshold are returned', () => {
  const before = { totalCompleted: 1 }; // first-daily already earned
  const after = { totalCompleted: 1, cleanSweeps: 1 }; // + clean-sweep just crossed
  const newly = diffNewlyEarnedAchievements(before, after);
  assert.deepEqual(newly.map((r) => r.id), ['clean-sweep']);
});

test('diffNewlyEarnedAchievements: multi-tier crossings return every newly-earned rule', () => {
  // Player who finishes their first ever puzzle AND it's a clean sweep
  // AND it's day 7 of a streak gets three new badges at once.
  const before = { totalCompleted: 0, maxStreak: 6, cleanSweeps: 0 };
  const after = { totalCompleted: 1, maxStreak: 7, cleanSweeps: 1 };
  const newly = diffNewlyEarnedAchievements(before, after);
  assert.deepEqual(
    newly.map((r) => r.id).sort(),
    ['clean-sweep', 'daily-habit', 'first-daily'],
  );
});

test('diffNewlyEarnedAchievements: null after → empty (no snapshot, nothing to compare)', () => {
  const newly = diffNewlyEarnedAchievements({ totalCompleted: 1 }, null);
  assert.deepEqual(newly, []);
});

test('diffNewlyEarnedAchievements: going backwards is ignored (lost badges aren\'t newly earned)', () => {
  // Defensive — predicate counters are monotonic in practice, but if
  // some data corruption flipped them, the diff still only reports
  // forward unlocks. Losing first-daily isn't an "unlock event".
  const before = { totalCompleted: 1 };
  const after = { totalCompleted: 0 };
  const newly = diffNewlyEarnedAchievements(before, after);
  assert.deepEqual(newly, []);
});

test('diffNewlyEarnedAchievements: returns rules in ALL_ACHIEVEMENTS declaration order', () => {
  // The celebration cascade plays in array order; pinning this so a
  // future code change can't accidentally reorder them (which would
  // change which card pops first on a multi-unlock).
  const newly = diffNewlyEarnedAchievements({}, {
    totalCompleted: 30, maxStreak: 30, cleanSweeps: 100, flawlessSweeps: 1, attemptedFinishes: 100, zeroScoreFinishes: 1,
    quizAttempts60s: 1000, quizVariantsTouched60s: 7, quizBestScore60s: 50,
    quiz60sTouchedVariants: [...QUIZ_60S_VARIANTS],
    quiz60sClearedVariants: [...QUIZ_60S_VARIANTS],
    quizAttemptsAll: 50, quizVariantsTouchedAll: 7, quizAllLowWrongAny: 0,
    quizAllPerfectedVariants: [...QUIZ_60S_VARIANTS],
    hasNickname: true, hasLinkedDevice: true,
    dailySharesCount: 1, quizSharesCount: 1, findflagSharesCount: 1, coffeeClicked: true,
    quiz60sCurrentStreak: 30, quiz60sMaxStreak: 30, quiz60sDistinctDays: 100,
    tttGamesPlayed: 100, hasWonTtt: true, hasLostTtt: true,
  });
  assert.deepEqual(
    newly.map((r) => r.id),
    ALL_ACHIEVEMENTS.map((r) => r.id),
  );
});

// --- Helpers ---------------------------------------------------------------

/** @param {string} id */
function ruleById(id) {
  const rule = ALL_ACHIEVEMENTS.find((r) => r.id === id);
  if (!rule) throw new Error(`no rule with id ${id}`);
  return rule;
}

// --- grid icons ------------------------------------------------------------
// The `gridIcon(n)` family renders "n of 16" as a 4x4 grid. It originally
// emitted ONLY the filled cells over an outlined box, which meant the low
// counts rendered as a broken asset rather than as progress: `first-daily`
// (n=1) was a single square in the top-left corner of an empty rectangle,
// and `empty-slate` (n=0) was an empty rectangle full stop. Reported from
// the daily result toast, where it sat next to a normal centred glyph and
// read as a missing image.

/** Every achievement whose icon is a 4x4 progress grid, with its filled count. */
const GRID_ICONS = [
  { id: 'empty-slate', filled: 0 },
  { id: 'first-daily', filled: 1 },
  { id: 'daily-habit', filled: 7 },
];

test('grid icons draw all 16 cells so a low count reads as progress, not a broken icon', () => {
  for (const { id } of GRID_ICONS) {
    const rule = ALL_ACHIEVEMENTS.find((r) => r.id === id);
    assert.ok(rule, `${id}: rule not found`);
    const rects = (rule.icon.match(/<rect /g) || []).length;
    assert.equal(rects, 16, `${id}: expected all 16 grid cells to be drawn, got ${rects}`);
  }
});

test('grid icons mark exactly the earned cells as filled', () => {
  // Unfilled cells carry an explicit opacity; filled ones do not. If this
  // inverts, every badge silently reads as complete.
  for (const { id, filled } of GRID_ICONS) {
    const rule = ALL_ACHIEVEMENTS.find((r) => r.id === id);
    assert.ok(rule, `${id}: rule not found`);
    const ghosted = (rule.icon.match(/<rect [^>]*opacity=/g) || []).length;
    assert.equal(16 - ghosted, filled, `${id}: expected ${filled} solid cells, got ${16 - ghosted}`);
  }
});

test('grid icons carry no sub-pixel stroke', () => {
  // The old outline used stroke-width="0.5" on a 16-unit viewBox. At the
  // profile badge's 20px render that is ~0.6px, which rounds away on a
  // standard-DPI display (same trap as PR #540 -> #541). Filled rects need
  // no stroke at all, so the safest pin is that none is declared.
  for (const { id } of GRID_ICONS) {
    const rule = ALL_ACHIEVEMENTS.find((r) => r.id === id);
    assert.ok(rule, `${id}: rule not found`);
    assert.ok(!/stroke-width="0?\.\d+"/.test(rule.icon), `${id}: sub-pixel stroke-width in icon`);
  }
});
