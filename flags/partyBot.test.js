import test from 'node:test';
import assert from 'node:assert/strict';
import { decideBuzz, validateBotSkill, delayWindowFor, accuracyFor, veilSightMs, BOT_SKILLS, QUESTION_PROFILE, VEIL_SIGHT, VEIL_CEILING_MS, DEFAULT_BOT_SKILL, BOT_SKILL_ORDER } from './partyBot.js';

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
    ...Object.entries(QUESTION_PROFILE).flatMap(([qid, bySkill]) =>
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
  // overlapping is intended (see QUESTION_PROFILE).
  // The floor may TIE the base's (easy does, at 6 s) — a spot window that starts
  // no earlier and ends much later is still later overall, and forcing the floor
  // up just to satisfy a strict `>` would be the tail wagging the dog. The ceiling
  // is what has to move.
  for (const skill of BOT_SKILL_ORDER) {
    const base = BOT_SKILLS[skill];
    const spot = delayWindowFor('spotFlag', skill);
    assert.ok(spot.delayMinMs >= base.delayMinMs,
      `${skill}: spot starts no earlier (${spot.delayMinMs} >= ${base.delayMinMs})`);
    assert.ok(spot.delayMaxMs > base.delayMaxMs,
      `${skill}: spot ends later (${spot.delayMaxMs} > ${base.delayMaxMs})`);
  }
});

test('spot-the-flag is the question a bot gets RIGHT more often, at every skill', () => {
  // The other half of the override, and it pulls the opposite way to the delay:
  // spot-the-flag is the gentlest question in the show (the answer is on screen,
  // the criteria are printed beside it) — it is slow, not hard. An Easy bot
  // getting half of these wrong read as broken rather than easy.
  for (const skill of BOT_SKILL_ORDER) {
    const base = BOT_SKILLS[skill].accuracy;
    const spot = accuracyFor('spotFlag', skill);
    assert.ok(spot > base, `${skill}: ${spot} > ${base}`);
    assert.ok(spot <= 1, `${skill}: still a probability`);
    // Never a certainty — every skill has to whiff sometimes or it reads scripted.
    assert.ok(spot < 1, `${skill}: still misses occasionally`);
  }
  const accs = BOT_SKILL_ORDER.map((s) => accuracyFor('spotFlag', s));
  assert.deepEqual(accs, [...accs].sort((a, b) => a - b), 'still ascending by skill');
});

test('accuracyFor: the question picks the accuracy, everything else keeps the skill preset', () => {
  assert.equal(accuracyFor('flagPick', 'easy'), BOT_SKILLS.easy.accuracy);
  assert.equal(accuracyFor('mapPick', 'easy'), BOT_SKILLS.easy.accuracy);
  assert.equal(accuracyFor(undefined, 'easy'), BOT_SKILLS.easy.accuracy);
  assert.equal(accuracyFor('toString', 'easy'), BOT_SKILLS.easy.accuracy);
  assert.equal(accuracyFor('spotFlag', 'easy'), QUESTION_PROFILE.spotFlag.easy.accuracy);
});

test('decideBuzz: the spot accuracy override actually reaches the roll', () => {
  const spotQ = { ...Q, questionId: 'spotFlag' };
  // 0.6 is above Easy's base accuracy (0.5) but below its spot accuracy (0.8):
  // wrong on a flag pick, right on a spot-the-flag. One roll, two verdicts.
  assert.notEqual(decideBuzz({ ...Q, questionId: 'flagPick' }, 'easy', seq([0.6, 0, 0])).choice, Q.answer);
  assert.equal(decideBuzz(spotQ, 'easy', seq([0.6, 0, 0])).choice, Q.answer);
});

test('spot-the-flag windows are wider than the base, and stay in skill order', () => {
  for (const skill of BOT_SKILL_ORDER) {
    const base = BOT_SKILLS[skill];
    const spot = delayWindowFor('spotFlag', skill);
    assert.ok(spot.delayMaxMs - spot.delayMinMs > base.delayMaxMs - base.delayMinMs,
      `${skill}: spot's window is wider than the base's`);
  }
  const mins = BOT_SKILL_ORDER.map((s) => delayWindowFor('spotFlag', s).delayMinMs);
  assert.deepEqual(mins, [...mins].sort((a, b) => b - a), 'easy is slowest, hard is quickest');
});

test('delayWindowFor: the question picks the window, unknown ids fall back to the skill', () => {
  assert.deepEqual(delayWindowFor('spotFlag', 'hard'), {
    delayMinMs: QUESTION_PROFILE.spotFlag.hard.delayMinMs,
    delayMaxMs: QUESTION_PROFILE.spotFlag.hard.delayMaxMs,
  });
  // The base window, minus the accuracy the preset also carries.
  const baseHard = { delayMinMs: BOT_SKILLS.hard.delayMinMs, delayMaxMs: BOT_SKILLS.hard.delayMaxMs };
  assert.deepEqual(delayWindowFor('flagPick', 'hard'), baseHard);
  assert.deepEqual(delayWindowFor('mapPick', 'hard'), baseHard);
  assert.deepEqual(delayWindowFor(undefined, 'hard'), baseHard);
  // An inherited property name must not read as a question override.
  assert.deepEqual(delayWindowFor('toString', 'hard'), baseHard);
});

test('decideBuzz: a spot-the-flag question draws from the spot window, not the base', () => {
  const spotQ = { ...Q, questionId: 'spotFlag' };
  for (const skill of BOT_SKILL_ORDER) {
    const win = QUESTION_PROFILE.spotFlag[skill];
    assert.equal(decideBuzz(spotQ, skill, seq([0, 0])).delayMs, win.delayMinMs);
    assert.equal(decideBuzz(spotQ, skill, seq([0, 1])).delayMs, win.delayMaxMs);
  }
  // A roll above even the raised spot accuracy still lands on a wrong option.
  assert.notEqual(decideBuzz(spotQ, 'hard', seq([0.99, 0, 0.5])).choice, spotQ.answer);
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

// ---- the veil ----
// A veiled round hides the tiles and clears them over the clock. A bot is handed
// the answer, so without this it buzzed at its usual speed while every human was
// still looking at a grey square — the veil handicapped exactly one side.

/** A veiled flag question: full clarity at 80% of the 20s window, i.e. 16s. */
const VEILED_FLAG = { ...Q, questionId: 'flagPick', clearFrac: 0.8 };

test('VEIL_SIGHT covers every skill, in order, as a real fraction of the clear time', () => {
  assert.deepEqual(Object.keys(VEIL_SIGHT).sort(), [...BOT_SKILL_ORDER].sort());
  for (const [skill, frac] of Object.entries(VEIL_SIGHT)) {
    assert.ok(frac > 0 && frac <= 1, `${skill} sight is a fraction of the way to clear`);
  }
  const fracs = BOT_SKILL_ORDER.map((s) => VEIL_SIGHT[s]);
  assert.deepEqual(fracs, [...fracs].sort((a, b) => b - a), 'easy needs the clearest tile, hard the least');
});

test('veilSightMs: zero unless the round is actually veiled', () => {
  assert.equal(veilSightMs(VEILED_FLAG, 'hard', false), 0, 'tricky off');
  assert.ok(veilSightMs(VEILED_FLAG, 'hard', true) > 0, 'tricky on');
  // A statistics question refuses the veil outright (veilActive), so its bots are
  // never delayed even in a tricky room.
  assert.equal(veilSightMs({ ...Q, questionId: 'superlative', clearFrac: 0.2 }, 'hard', true), 0);
});

test('veilSightMs: a better bot reads a more obscured tile, and sight scales with the clear time', () => {
  const [easy, medium, hard] = ['easy', 'medium', 'hard'].map((s) => veilSightMs(VEILED_FLAG, s, true));
  assert.ok(hard < medium && medium < easy, 'hard sees first, easy last');
  // Outlines clear in half the time a flag does (0.4 vs 0.8), so sight halves too.
  const map = veilSightMs({ ...Q, questionId: 'mapPick', clearFrac: 0.4 }, 'hard', true);
  assert.equal(map, Math.round(hard / 2));
});

test('veilSightMs: a missing clearFrac falls back to the category default, never to zero', () => {
  const noFrac = { ...Q, questionId: 'flagPick' };
  assert.equal(veilSightMs(noFrac, 'hard', true), veilSightMs(VEILED_FLAG, 'hard', true));
});

test('decideBuzz: a veiled round pushes every skill later than the same question unveiled', () => {
  for (const skill of BOT_SKILL_ORDER) {
    for (const roll of [0, 0.5, 1]) {
      const clear = decideBuzz(VEILED_FLAG, skill, seq([0, roll])).delayMs;
      const veiled = decideBuzz(VEILED_FLAG, skill, seq([0, roll]), { tricky: true }).delayMs;
      assert.ok(veiled > clear, `${skill} at roll ${roll}: veiled ${veiled} > clear ${clear}`);
    }
  }
});

test('decideBuzz: a veiled buzz never runs past the ceiling, at any skill or roll', () => {
  for (const skill of BOT_SKILL_ORDER) {
    for (const roll of [0, 0.25, 0.5, 0.75, 1]) {
      const veiled = decideBuzz(VEILED_FLAG, skill, seq([0, roll]), { tricky: true }).delayMs;
      assert.ok(veiled <= VEIL_CEILING_MS, `${skill} at roll ${roll}: ${veiled} <= ${VEIL_CEILING_MS}`);
    }
    // The veiled spot-the-flag round is the worst case — the latest window on the
    // slowest-clearing category — and it has to stay inside the clock too.
    const spot = decideBuzz({ ...Q, questionId: 'spotFlag', clearFrac: 0.8 }, skill, seq([0, 1]), { tricky: true });
    assert.ok(spot.delayMs <= VEIL_CEILING_MS, `veiled spot ${skill}: ${spot.delayMs}`);
  }
});

test('decideBuzz: a veiled bot waits for sight, so a human who can see it has a real chance', () => {
  // The whole point. A hard bot used to buzz at 1-3s against tiles that are not
  // fully clear until 16s; it now arrives after it could plausibly have seen them.
  // Tiles are ~40% clear at 6.4 s, which is where a sharp player can first read a
  // familiar flag; the bot must not be there before them. It must also not sit out
  // half the round waiting — the veil should cost it roughly what it costs a
  // person, not hand the bonus to whoever is fastest among the humans.
  const earliest = decideBuzz(VEILED_FLAG, 'hard', seq([0, 0]), { tricky: true }).delayMs;
  assert.ok(earliest >= 6400, `a veiled hard bot's earliest buzz (${earliest}) leaves the room a chance`);
  assert.ok(earliest <= 9000, `a veiled hard bot (${earliest}) still turns up while the round is live`);
});

test('decideBuzz: the veil moves when the bot answers, never whether it is right', () => {
  // Same accuracy rolls, veiled and not: the same choice comes out both times.
  const clear = decideBuzz(VEILED_FLAG, 'easy', seq([0.99, 0.5, 0.5]));
  const veiled = decideBuzz(VEILED_FLAG, 'easy', seq([0.99, 0.5, 0.5]), { tricky: true });
  assert.equal(veiled.choice, clear.choice);
  assert.notEqual(veiled.choice, VEILED_FLAG.answer);
});

test('decideBuzz: deterministic under a fixed seed', () => {
  const a = decideBuzz(Q, 'hard', seq([0.3, 0.7]));
  const b = decideBuzz(Q, 'hard', seq([0.3, 0.7]));
  assert.deepEqual(a, b);
});
