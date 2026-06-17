import { test } from 'node:test';
import assert from 'node:assert/strict';

import { STREAK_ACHIEVEMENTS, evaluateAchievements } from './achievements.js';

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

// --- Snapshot defensiveness ------------------------------------------------

test('every predicate handles a null snapshot without throwing', () => {
  for (const rule of STREAK_ACHIEVEMENTS) {
    assert.equal(rule.predicate({}), false, `${rule.id} should return false on empty snapshot`);
  }
});

test('every predicate handles non-numeric fields without throwing', () => {
  const garbage = /** @type {any} */ ({ maxStreak: 'oops', totalCompleted: null });
  for (const rule of STREAK_ACHIEVEMENTS) {
    assert.doesNotThrow(() => rule.predicate(garbage));
    assert.equal(rule.predicate(garbage), false);
  }
});

// --- Rule-set hygiene ------------------------------------------------------

test('every rule has a unique id', () => {
  const ids = STREAK_ACHIEVEMENTS.map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length, `duplicate ids: ${ids.join(', ')}`);
});

test('every rule has non-empty name, description, hint, and a single-character icon', () => {
  for (const rule of STREAK_ACHIEVEMENTS) {
    assert.ok(rule.name.length > 0, `${rule.id}: name`);
    assert.ok(rule.description.length > 0, `${rule.id}: description`);
    assert.ok(rule.hint.length > 0, `${rule.id}: hint`);
    // Emoji can be multi-codepoint (combining marks, variation selectors).
    // Cap loosely at 4 for sanity, not bytes.
    assert.ok(rule.icon.length > 0 && rule.icon.length <= 4, `${rule.id}: icon`);
  }
});

// --- evaluateAchievements --------------------------------------------------

test('evaluateAchievements returns all rules in declaration order', () => {
  const out = evaluateAchievements({});
  assert.deepEqual(
    out.map((s) => s.rule.id),
    STREAK_ACHIEVEMENTS.map((r) => r.id),
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

test('evaluateAchievements tolerates a null snapshot (no profile data fetched yet)', () => {
  const out = evaluateAchievements(null);
  for (const s of out) assert.equal(s.earned, false);
});

test('evaluateAchievements at a 30-day streak earns every streak badge', () => {
  const out = evaluateAchievements({ totalCompleted: 30, maxStreak: 30 });
  assert.ok(out.every((s) => s.earned), 'all rules should be earned');
});

// --- Helpers ---------------------------------------------------------------

/** @param {string} id */
function ruleById(id) {
  const rule = STREAK_ACHIEVEMENTS.find((r) => r.id === id);
  if (!rule) throw new Error(`no rule with id ${id}`);
  return rule;
}
