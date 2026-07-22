import test from 'node:test';
import assert from 'node:assert/strict';
import { decideBuzz, validateBotSkill, BOT_SKILLS, DEFAULT_BOT_SKILL, BOT_SKILL_ORDER } from './partyBot.js';

/** A deterministic rng that yields the given values in order, then repeats the last.
 *  @param {number[]} values */
function seq(values) {
  let i = 0;
  return () => {
    const v = values[Math.min(i, values.length - 1)];
    i += 1;
    return v;
  };
}

const Q = { options: ['fr', 'de', 'it', 'es'], answer: 'fr' };

test('validateBotSkill: known skills pass through, unknown falls back to default', () => {
  assert.equal(validateBotSkill('easy'), 'easy');
  assert.equal(validateBotSkill('medium'), 'medium');
  assert.equal(validateBotSkill('hard'), 'hard');
  assert.equal(validateBotSkill('brutal'), DEFAULT_BOT_SKILL);
  assert.equal(validateBotSkill(undefined), DEFAULT_BOT_SKILL);
  assert.equal(validateBotSkill(42), DEFAULT_BOT_SKILL);
  // hasOwnProperty guard: an inherited property name must not read as a skill.
  assert.equal(validateBotSkill('toString'), DEFAULT_BOT_SKILL);
});

test('BOT_SKILL_ORDER lists every preset, hardest last, easiest first', () => {
  assert.deepEqual([...BOT_SKILL_ORDER].sort(), Object.keys(BOT_SKILLS).sort());
  const accs = BOT_SKILL_ORDER.map((s) => BOT_SKILLS[s].accuracy);
  assert.deepEqual(accs, [...accs].sort((a, b) => a - b)); // ascending accuracy
});

test('decideBuzz: a low accuracy roll picks the correct answer', () => {
  // rng #1 = 0 (< any accuracy) => correct; rng #2 = 0 => delay at the minimum.
  const { choice, delayMs } = decideBuzz(Q, 'medium', seq([0, 0]));
  assert.equal(choice, 'fr');
  assert.equal(delayMs, BOT_SKILLS.medium.delayMinMs);
});

test('decideBuzz: a high accuracy roll picks a wrong option, never the answer', () => {
  // rng #1 = 0.99 (>= 0.5 easy accuracy) => wrong; rng #2 picks the wrong index;
  // rng #3 sets the delay.
  const { choice } = decideBuzz(Q, 'easy', seq([0.99, 0, 0]));
  assert.notEqual(choice, 'fr');
  assert.ok(Q.options.includes(choice));
});

test('decideBuzz: wrong-pick index spans all non-answer options and clamps at 1', () => {
  const others = ['de', 'it', 'es'];
  // index 0, middle, and the rng===1 edge (must clamp to the last, not undefined)
  assert.equal(decideBuzz(Q, 'easy', seq([0.99, 0, 0])).choice, others[0]);
  assert.equal(decideBuzz(Q, 'easy', seq([0.99, 0.5, 0])).choice, others[1]);
  assert.equal(decideBuzz(Q, 'easy', seq([0.99, 1, 0])).choice, others[2]);
});

test('decideBuzz: delay is drawn inside the skill window', () => {
  for (const skill of BOT_SKILL_ORDER) {
    const cfg = BOT_SKILLS[skill];
    assert.equal(decideBuzz(Q, skill, seq([0, 0])).delayMs, cfg.delayMinMs);
    assert.equal(decideBuzz(Q, skill, seq([0, 1])).delayMs, cfg.delayMaxMs);
    const mid = decideBuzz(Q, skill, seq([0, 0.5])).delayMs;
    assert.ok(mid >= cfg.delayMinMs && mid <= cfg.delayMaxMs);
  }
});

test('decideBuzz: every skill delay window fits inside the 20s question clock', () => {
  for (const skill of BOT_SKILL_ORDER) {
    // A generous margin so the bot always buzzes before the host timer reveals.
    assert.ok(BOT_SKILLS[skill].delayMaxMs <= 18000, `${skill} max delay under 18s`);
    assert.ok(BOT_SKILLS[skill].delayMinMs >= 0, `${skill} min delay non-negative`);
  }
});

test('decideBuzz: a degenerate one-option board still answers rather than blank', () => {
  const solo = { options: ['fr'], answer: 'fr' };
  const { choice } = decideBuzz(solo, 'easy', seq([0.99, 0, 0]));
  assert.equal(choice, 'fr');
});

test('decideBuzz: an unknown skill is coerced to the default and still decides', () => {
  const { choice, delayMs } = decideBuzz(Q, 'nope', seq([0, 0]));
  assert.equal(choice, 'fr');
  assert.equal(delayMs, BOT_SKILLS[DEFAULT_BOT_SKILL].delayMinMs);
});

test('decideBuzz: deterministic under a fixed seed', () => {
  const a = decideBuzz(Q, 'hard', seq([0.3, 0.7]));
  const b = decideBuzz(Q, 'hard', seq([0.3, 0.7]));
  assert.deepEqual(a, b);
});
