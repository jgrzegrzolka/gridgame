import test from 'node:test';
import assert from 'node:assert/strict';
import { decideBuzz, validateBotSkill, delayWindowFor, accuracyFor, buzzAccuracy, modeKeyFor, spreadGapOf, statAccuracyFor, veilSightMs, BOT_SKILLS, MODE_PROFILE, STAT_ACCURACY, PICKER_BONUS, ACCURACY_CEILING, VEIL_SIGHT, VEIL_CEILING_MS, DEFAULT_BOT_SKILL, BOT_SKILL_ORDER } from './partyBot.js';

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
    // Every mode override, resolved through delayWindowFor so an entry that
    // overrides only `accuracy` is checked against the base window it inherits.
    ...Object.keys(MODE_PROFILE).flatMap((mode) =>
      BOT_SKILL_ORDER.map((s) => /** @type {[string, any]} */ ([`${mode}/${s}`, delayWindowFor(mode, s)]))),
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
  // overlapping is intended (see MODE_PROFILE).
  // The floor may TIE the base's (easy does, at 6 s) — a spot window that starts
  // no earlier and ends much later is still later overall, and forcing the floor
  // up just to satisfy a strict `>` would be the tail wagging the dog. The ceiling
  // is what has to move.
  for (const skill of BOT_SKILL_ORDER) {
    const base = BOT_SKILLS[skill];
    const spot = delayWindowFor('spot-flag', skill);
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
    const spot = accuracyFor('spot-flag', skill);
    assert.ok(spot > base, `${skill}: ${spot} > ${base}`);
    assert.ok(spot <= 1, `${skill}: still a probability`);
    // Never a certainty — every skill has to whiff sometimes or it reads scripted.
    assert.ok(spot < 1, `${skill}: still misses occasionally`);
  }
  const accs = BOT_SKILL_ORDER.map((s) => accuracyFor('spot-flag', s));
  assert.deepEqual(accs, [...accs].sort((a, b) => a - b), 'still ascending by skill');
});

test('accuracyFor: the mode picks the accuracy, everything else keeps the skill preset', () => {
  // The unlisted modes: sovereign flags IS the base preset (it's what the numbers
  // were calibrated on), and every statistics mode is absent by design — its
  // accuracy comes from the question, not the table.
  assert.equal(accuracyFor('flags-all', 'easy'), BOT_SKILLS.easy.accuracy);
  assert.equal(accuracyFor('superlative-gdp', 'easy'), BOT_SKILLS.easy.accuracy);
  assert.equal(accuracyFor(undefined, 'easy'), BOT_SKILLS.easy.accuracy);
  assert.equal(accuracyFor('toString', 'easy'), BOT_SKILLS.easy.accuracy);
  assert.equal(accuracyFor('spot-flag', 'easy'), MODE_PROFILE['spot-flag'].easy.accuracy);
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
    const spot = delayWindowFor('spot-flag', skill);
    assert.ok(spot.delayMaxMs - spot.delayMinMs > base.delayMaxMs - base.delayMinMs,
      `${skill}: spot's window is wider than the base's`);
  }
  const mins = BOT_SKILL_ORDER.map((s) => delayWindowFor('spot-flag', s).delayMinMs);
  assert.deepEqual(mins, [...mins].sort((a, b) => b - a), 'easy is slowest, hard is quickest');
});

test('delayWindowFor: the question picks the window, unknown ids fall back to the skill', () => {
  assert.deepEqual(delayWindowFor('spot-flag', 'hard'), {
    delayMinMs: MODE_PROFILE['spot-flag'].hard.delayMinMs,
    delayMaxMs: MODE_PROFILE['spot-flag'].hard.delayMaxMs,
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
    const win = MODE_PROFILE['spot-flag'][skill];
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

// ---- the mode ladder ----
// Which round it is decides how often a bot is right. The two flag modes are the
// same question module over different pools, so this is the half of the dial a
// question-keyed table could not express at all.

test('the picture modes run easiest to hardest: spot, flags, weird flags, outlines', () => {
  // The ladder itself, at every skill. Everybody knows the French flag; almost
  // nobody knows Wallis and Futuna's; an outline has no colours or emblem to go on
  // at all. A bot that hit all three at the same rate would be playing a different
  // game from the table.
  for (const skill of BOT_SKILL_ORDER) {
    const ladder = ['spot-flag', 'flags-all', 'flags-weird', 'map-outlines']
      .map((mode) => accuracyFor(mode, skill));
    assert.deepEqual(ladder, [...ladder].sort((a, b) => b - a),
      `${skill}: ${ladder.join(' > ')} descends`);
    // Strictly, not merely non-increasing — a tie would mean one of the four
    // stopped saying anything.
    for (let i = 1; i < ladder.length; i += 1) {
      assert.ok(ladder[i] < ladder[i - 1], `${skill}: rung ${i} is genuinely harder`);
    }
  }
});

test('every mode accuracy is a real probability, ascending by skill', () => {
  for (const [mode, bySkill] of Object.entries(MODE_PROFILE)) {
    const accs = BOT_SKILL_ORDER.map((s) => accuracyFor(mode, s));
    assert.deepEqual(accs, [...accs].sort((a, b) => a - b), `${mode}: harder bots are more accurate`);
    for (const [i, a] of accs.entries()) {
      assert.ok(a > 0 && a < 1, `${mode}/${BOT_SKILL_ORDER[i]}: ${a} misses sometimes and lands sometimes`);
    }
    assert.ok(Object.keys(bySkill).length === BOT_SKILL_ORDER.length, `${mode}: covers every skill`);
  }
});

test('modeKeyFor: the stamped mode wins, an unambiguous question id is the fallback', () => {
  assert.equal(modeKeyFor({ modeId: 'flags-weird', questionId: 'flagPick' }), 'flags-weird');
  // A room snapshot written before the server stamped modeId.
  assert.equal(modeKeyFor({ questionId: 'spotFlag' }), 'spot-flag');
  assert.equal(modeKeyFor({ questionId: 'mapPick' }), 'map-outlines');
  // flagPick is exactly the ambiguity the stamp exists to resolve — guessing
  // flags-all would hand an old weird-flags round the wrong (easier) numbers, so
  // an unstamped one plays at the base preset, which is what it played before.
  assert.equal(modeKeyFor({ questionId: 'flagPick' }), null);
  assert.equal(modeKeyFor({}), null);
  assert.equal(modeKeyFor({ questionId: 'toString' }), null);
});

test('decideBuzz: weird flags are harder than flags on the same roll', () => {
  // One roll, two verdicts — the same proof the spot override gets, in the other
  // direction. 0.45 is under Easy's base 0.5 and over its weird-flag 0.35.
  assert.equal(decideBuzz({ ...Q, modeId: 'flags-all' }, 'easy', seq([0.45, 0, 0])).choice, Q.answer);
  assert.notEqual(decideBuzz({ ...Q, modeId: 'flags-weird' }, 'easy', seq([0.45, 0, 0])).choice, Q.answer);
  // And outlines are harder still: 0.32 clears weird flags but not the map.
  assert.equal(decideBuzz({ ...Q, modeId: 'flags-weird' }, 'easy', seq([0.32, 0, 0])).choice, Q.answer);
  assert.notEqual(decideBuzz({ ...Q, modeId: 'map-outlines' }, 'easy', seq([0.32, 0, 0])).choice, Q.answer);
});

test('decideBuzz: the mode moves accuracy alone — weird flags buzz at base speed', () => {
  // Only spot-the-flag overrides the window. How hard a round is and how long it
  // takes to answer are separate dials; weird flags turn only the first.
  for (const skill of BOT_SKILL_ORDER) {
    for (const mode of ['flags-weird', 'map-outlines']) {
      assert.equal(decideBuzz({ ...Q, modeId: mode }, skill, seq([0, 0])).delayMs, BOT_SKILLS[skill].delayMinMs);
      assert.equal(decideBuzz({ ...Q, modeId: mode }, skill, seq([0, 1])).delayMs, BOT_SKILLS[skill].delayMaxMs);
    }
  }
});

// ---- statistics: the question, not the mode ----
// "Which of these produces the most coffee — Brazil, Iceland, Mongolia, Norway"
// and "…Brazil, Vietnam, Colombia, Indonesia" are the same mode and nothing like
// the same question, so a statistics round's difficulty is read off the question.

/** A runaway: the answer is far clear of the field. */
const RUNAWAY = {
  options: ['cn', 'ng', 'pl', 'fj'], answer: 'cn',
  ranking: ['cn', 'ng', 'pl', 'fj'], values: { cn: 1400, ng: 220, pl: 38, fj: 1 },
  modeId: 'superlative-pop', questionId: 'superlative',
};
/** A coin flip: the top two are neck and neck. */
const NECK_AND_NECK = {
  options: ['cn', 'in', 'pl', 'fj'], answer: 'cn',
  ranking: ['cn', 'in', 'pl', 'fj'], values: { cn: 1410, in: 1400, pl: 38, fj: 1 },
  modeId: 'superlative-pop', questionId: 'superlative',
};

test('spreadGapOf: a runaway answer scores near 1, a coin flip near 0', () => {
  const runaway = spreadGapOf(RUNAWAY);
  const close = spreadGapOf(NECK_AND_NECK);
  assert.ok(runaway !== null && close !== null);
  assert.ok(runaway > 0.8, `runaway ${runaway}`);
  assert.ok(close < 0.05, `coin flip ${close}`);
});

test('spreadGapOf: survives negative values, where a ratio would not', () => {
  // Average temperature goes below zero, and several shipped metrics are index
  // scores where a ratio means nothing at all. Subtraction handles both; this is
  // the reason the gap is a spread fraction and not the generator's GAP_RATIO.
  const coldest = {
    options: ['ru', 'ca', 'pl', 'qa'], answer: 'ru',
    ranking: ['ru', 'ca', 'pl', 'qa'], values: { ru: -5, ca: -3, pl: 9, qa: 27 },
    modeId: 'superlative-temperature',
  };
  const gap = spreadGapOf(coldest);
  assert.ok(gap !== null && gap > 0 && gap < 1, `a real fraction, got ${gap}`);
  assert.equal(gap, 2 / 32);
});

test('spreadGapOf: null for anything that is not a ranked statistic', () => {
  // Cast because a flag-pick question shares no field with the ranked shape — which
  // is the point of the case: decideBuzz hands this function every question it sees.
  assert.equal(spreadGapOf(/** @type {any} */ (Q)), null, 'a flag pick has no ranking');
  assert.equal(spreadGapOf({ ranking: ['a', 'b'] }), null, 'no values');
  assert.equal(spreadGapOf({ ranking: ['a'], values: { a: 1 } }), null, 'no runner-up');
  assert.equal(spreadGapOf({ ranking: ['a', 'b'], values: { a: 5, b: 5 } }), null, 'no spread to divide by');
  assert.equal(spreadGapOf({ ranking: ['a', 'b'], values: { a: 5 } }), null, 'a missing value');
});

test('statAccuracyFor: rises with the gap, spans the range, ascends by skill', () => {
  for (const skill of BOT_SKILL_ORDER) {
    const range = STAT_ACCURACY[skill];
    assert.equal(statAccuracyFor(0, skill), range.min);
    assert.equal(statAccuracyFor(1, skill), range.max);
    assert.ok(statAccuracyFor(0.5, skill) > range.min && statAccuracyFor(0.5, skill) < range.max);
    // Out-of-range inputs clamp rather than extrapolating past a probability.
    assert.equal(statAccuracyFor(-1, skill), range.min);
    assert.equal(statAccuracyFor(2, skill), range.max);
    assert.ok(range.min > 0 && range.max < 1, `${skill}: still a probability at both ends`);
  }
  for (const gap of [0, 0.5, 1]) {
    const accs = BOT_SKILL_ORDER.map((s) => statAccuracyFor(gap, s));
    assert.deepEqual(accs, [...accs].sort((a, b) => a - b), `gap ${gap}: harder bots are more accurate`);
  }
});

test('a statistic straddles the flag pick: a clear one is easier, a close one harder', () => {
  // The point of the range. A world-facts round is not uniformly easier or harder
  // than recognising a flag — it depends entirely on how far apart the numbers are,
  // which is the same thing that decides it for a person.
  for (const skill of BOT_SKILL_ORDER) {
    const base = BOT_SKILLS[skill].accuracy;
    assert.ok(buzzAccuracy(RUNAWAY, skill) > base, `${skill}: a runaway beats a flag pick`);
    assert.ok(buzzAccuracy(NECK_AND_NECK, skill) < base, `${skill}: a coin flip is worse`);
  }
});

test('buzzAccuracy: a statistics question ignores the mode table entirely', () => {
  // Even given a mode that HAS an override, the question wins — a statistics round
  // has no fixed difficulty for the table to state.
  const mislabelled = { ...RUNAWAY, modeId: 'map-outlines' };
  assert.equal(buzzAccuracy(mislabelled, 'easy'), buzzAccuracy(RUNAWAY, 'easy'));
  assert.notEqual(buzzAccuracy(mislabelled, 'easy'), accuracyFor('map-outlines', 'easy'));
});

// ---- the picker's edge ----
// A person drafts the category they know. A bot that picked and then played the
// round exactly as it plays every other one is the only seat for which the pick
// meant nothing.

test('buzzAccuracy: the round a bot picked gets exactly the bonus', () => {
  for (const skill of BOT_SKILL_ORDER) {
    for (const q of [{ ...Q, modeId: 'flags-weird' }, { ...Q, modeId: 'flags-all' }, RUNAWAY]) {
      const plain = buzzAccuracy(q, skill);
      const picked = buzzAccuracy(q, skill, { picked: true });
      assert.equal(picked, Math.min(ACCURACY_CEILING, plain + PICKER_BONUS));
      assert.ok(picked > plain, `${skill}/${q.modeId}: the pick is worth something`);
    }
  }
});

test('buzzAccuracy: the bonus never buys certainty', () => {
  // Hard spot-the-flag (0.97) plus the bonus would exceed 1. A bot that cannot
  // miss reads as scripted rather than skilled, so the ceiling holds it short.
  const best = buzzAccuracy({ ...Q, modeId: 'spot-flag' }, 'hard', { picked: true });
  assert.equal(best, ACCURACY_CEILING);
  assert.ok(best < 1);
  // The widest statistic at Hard is the other candidate for overflow.
  assert.ok(buzzAccuracy(RUNAWAY, 'hard', { picked: true }) < 1);
});

test('decideBuzz: the picker bonus reaches the roll, and moves nothing else', () => {
  // 0.55 is above Easy's base 0.5 and below its picked 0.58: wrong on someone
  // else's round, right on its own. One roll, two verdicts.
  const q = { ...Q, modeId: 'flags-all' };
  assert.notEqual(decideBuzz(q, 'easy', seq([0.55, 0, 0])).choice, Q.answer);
  assert.equal(decideBuzz(q, 'easy', seq([0.55, 0, 0]), { picked: true }).choice, Q.answer);
  // Accuracy only — a bot does not also get faster on its own round.
  for (const skill of BOT_SKILL_ORDER) {
    for (const roll of [0, 0.5, 1]) {
      assert.equal(
        decideBuzz(q, skill, seq([0, roll]), { picked: true }).delayMs,
        decideBuzz(q, skill, seq([0, roll])).delayMs,
        `${skill} at roll ${roll}: same window`,
      );
    }
  }
});
