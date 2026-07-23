import test from 'node:test';
import assert from 'node:assert/strict';
import { decideBuzz, validateBotSkill, delayWindowFor, BOT_SKILLS, QUESTION_PACE, DEFAULT_BOT_SKILL, BOT_SKILL_ORDER } from './partyBot.js';

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

test('decideBuzz: every delay window fits inside the 20s question clock', () => {
  // Every window a bot can draw from, base and per-question alike — a window that
  // ran past the clock would leave the bot silent and the question timing out.
  /** @type {[string, { delayMinMs: number, delayMaxMs: number }][]} */
  const windows = [
    ...BOT_SKILL_ORDER.map((s) => /** @type {[string, any]} */ ([`base/${s}`, BOT_SKILLS[s]])),
    ...Object.entries(QUESTION_PACE).flatMap(([qid, bySkill]) =>
      Object.entries(bySkill).map(([s, w]) => /** @type {[string, any]} */ ([`${qid}/${s}`, w]))),
  ];
  for (const [name, w] of windows) {
    // A generous margin so the bot always buzzes before the host timer reveals.
    assert.ok(w.delayMaxMs <= 18000, `${name} max delay under 18s`);
    assert.ok(w.delayMinMs >= 0, `${name} min delay non-negative`);
    assert.ok(w.delayMinMs < w.delayMaxMs, `${name} window is a real range`);
  }
});

test('spot-the-flag buzzes later than a flag pick, at every skill', () => {
  // The whole point of the override: reading three criteria against four tiles is
  // slower than one recognition, so the bot must not arrive at flag-pick speed.
  //
  // Later at BOTH ends is the requirement — deliberately not "spot's earliest
  // clears flag-pick's latest". That stronger form was tried and rejected: it
  // forces the windows apart, and the gap it opens at Hard hands a strong player
  // the bonus nearly every time, which is not what Hard is for. The two windows
  // overlapping is intended (see QUESTION_PACE).
  for (const skill of BOT_SKILL_ORDER) {
    const base = BOT_SKILLS[skill];
    const spot = QUESTION_PACE.spotFlag[skill];
    assert.ok(spot.delayMinMs > base.delayMinMs,
      `${skill}: spot starts later (${spot.delayMinMs} > ${base.delayMinMs})`);
    assert.ok(spot.delayMaxMs > base.delayMaxMs,
      `${skill}: spot ends later (${spot.delayMaxMs} > ${base.delayMaxMs})`);
  }
});

test('spot-the-flag windows are wider than the base, and stay in skill order', () => {
  for (const skill of BOT_SKILL_ORDER) {
    const base = BOT_SKILLS[skill];
    const spot = QUESTION_PACE.spotFlag[skill];
    assert.ok(spot.delayMaxMs - spot.delayMinMs > base.delayMaxMs - base.delayMinMs,
      `${skill}: spot's window is wider than the base's`);
  }
  const mins = BOT_SKILL_ORDER.map((s) => QUESTION_PACE.spotFlag[s].delayMinMs);
  assert.deepEqual(mins, [...mins].sort((a, b) => b - a), 'easy is slowest, hard is quickest');
});

test('delayWindowFor: the question picks the window, unknown ids fall back to the skill', () => {
  assert.deepEqual(delayWindowFor('spotFlag', 'hard'), QUESTION_PACE.spotFlag.hard);
  assert.deepEqual(delayWindowFor('flagPick', 'hard'), BOT_SKILLS.hard);
  assert.deepEqual(delayWindowFor('mapPick', 'hard'), BOT_SKILLS.hard);
  assert.deepEqual(delayWindowFor(undefined, 'hard'), BOT_SKILLS.hard);
  // An inherited property name must not read as a question override.
  assert.deepEqual(delayWindowFor('toString', 'hard'), BOT_SKILLS.hard);
});

test('decideBuzz: a spot-the-flag question draws from the spot window, not the base', () => {
  const spotQ = { ...Q, questionId: 'spotFlag' };
  for (const skill of BOT_SKILL_ORDER) {
    const win = QUESTION_PACE.spotFlag[skill];
    assert.equal(decideBuzz(spotQ, skill, seq([0, 0])).delayMs, win.delayMinMs);
    assert.equal(decideBuzz(spotQ, skill, seq([0, 1])).delayMs, win.delayMaxMs);
  }
  // The accuracy roll is untouched: only WHEN it buzzes moved, not whether it is right.
  assert.equal(decideBuzz(spotQ, 'hard', seq([0.99, 0, 0.5])).choice !== spotQ.answer, true);
});

test('decideBuzz: a flag-pick question is unchanged by the spot override', () => {
  const flagQ = { ...Q, questionId: 'flagPick' };
  for (const skill of BOT_SKILL_ORDER) {
    assert.equal(decideBuzz(flagQ, skill, seq([0, 0])).delayMs, BOT_SKILLS[skill].delayMinMs);
    assert.equal(decideBuzz(flagQ, skill, seq([0, 1])).delayMs, BOT_SKILLS[skill].delayMaxMs);
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
