import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  STREAK_ACHIEVEMENTS,
  MASTERY_ACHIEVEMENTS,
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

test('empty-slate fires at zeroScoreFinishes >= 1', () => {
  const rule = ruleById('empty-slate');
  assert.equal(rule.predicate({ zeroScoreFinishes: 0 }), false);
  assert.equal(rule.predicate({ zeroScoreFinishes: 1 }), true);
});

test('mastery rules do NOT cross-contaminate (clean-sweep ignores zeroScoreFinishes, etc.)', () => {
  // Pin the field-mapping so a future copy-paste rename can't silently
  // wire clean-sweep to the wrong counter.
  assert.equal(ruleById('clean-sweep').predicate({ zeroScoreFinishes: 99 }), false);
  assert.equal(ruleById('empty-slate').predicate({ cleanSweeps: 99 }), false);
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
  const out = evaluateAchievements({ cleanSweeps: 1, zeroScoreFinishes: 1 });
  const earned = out.filter((s) => s.earned).map((s) => s.rule.id);
  // No streak fields → streak tier all locked. Mastery: clean-sweep + empty-slate fire.
  assert.deepEqual(earned.sort(), ['clean-sweep', 'empty-slate']);
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

test('evaluateAchievements with a full snapshot earns every badge across both tiers', () => {
  const out = evaluateAchievements({
    totalCompleted: 30, maxStreak: 30, cleanSweeps: 100, zeroScoreFinishes: 1,
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
    totalCompleted: 30, maxStreak: 30, cleanSweeps: 100, zeroScoreFinishes: 1,
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
