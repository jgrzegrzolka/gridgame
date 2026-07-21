import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadCountries } from '../group.js';
import { sovereignPool } from '../flagPools.js';
import {
  generate, isCorrect, buildPuzzle, randomSpec, filtersFor, failingClause,
  clausesFromPrompt, isSpottable, SPOT_COLORS, SPOT_MOTIFS, SPOT_CLAUSES,
  missLabel, spotTitle,
} from './spotFlag.js';
import { matchesFilters } from '../flagsFilter.js';

const raw = JSON.parse(readFileSync(new URL('../countries.json', import.meta.url), 'utf8'));
const POOL = sovereignPool(loadCountries(raw));
const PRIMARY = /** @type {const} */ ({ colorField: 'primaryColors' });

/** Deterministic rng so a failure is reproducible rather than a once-a-week flake.
 *  @param {number} seed @returns {() => number} */
function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** @type {Map<string, import('../group.js').Country>} */
const byCode = new Map(POOL.map((c) => [c.code, c]));

/** The country behind a code, or a loud failure. Every code under test comes
 *  from a question this pool generated, so a miss is a bug, not a data gap.
 *  @param {string} code @returns {import('../group.js').Country} */
function at(code) {
  const c = byCode.get(code);
  if (!c) throw new Error(`no country for ${code}`);
  return c;
}

/** A question's clause list, asserted present -- the prompt is one we just
 *  generated, so an undecodable spec is a failure worth naming here.
 *  @param {string} prompt @returns {import('./spotFlag.js').Clause[]} */
function clausesOf(prompt) {
  const c = clausesFromPrompt(prompt);
  if (!c) throw new Error(`prompt did not decode: ${prompt}`);
  return c;
}

test('generate: exactly one option satisfies the whole spec', () => {
  const rng = seeded(1);
  for (let i = 0; i < 300; i += 1) {
    const q = generate(POOL, undefined, rng);
    const all = filtersFor(clausesOf(q.prompt));
    const matching = q.options.filter((code) => matchesFilters(at(code), all, PRIMARY));
    assert.deepEqual(matching, [q.answer],
      `exactly one match, and it is the answer (spec ${q.prompt}, options ${q.options})`);
  }
});

test('generate: each wrong flag fails exactly one clause, all different', () => {
  // The tightness rule. If two distractors died to the same clause, a third
  // clause would never be tested and the puzzle would be softer than it reads.
  const rng = seeded(2);
  for (let i = 0; i < 300; i += 1) {
    const q = generate(POOL, undefined, rng);
    const clauses = clausesOf(q.prompt);
    const wrong = q.options.filter((c) => c !== q.answer);
    const failed = wrong.map((code) => {
      const c = at(code);
      const misses = clauses.filter((cl) => !matchesFilters(c, filtersFor([cl]), PRIMARY));
      assert.equal(misses.length, 1, `${code} should fail exactly one clause of ${q.prompt}`);
      return `${misses[0].sign}:${misses[0].group}:${misses[0].value}`;
    });
    assert.equal(new Set(failed).size, wrong.length, 'no two distractors fail the same clause');
  }
});

test('generate: always four options, no duplicates', () => {
  const rng = seeded(3);
  for (let i = 0; i < 200; i += 1) {
    const q = generate(POOL, undefined, rng);
    assert.equal(q.options.length, SPOT_CLAUSES + 1);
    assert.equal(new Set(q.options).size, q.options.length);
    assert.ok(q.options.includes(q.answer));
  }
});

test('generate: the answer is not always in the same slot', () => {
  // The quartet is built answer-first, so a missing shuffle would pin it to
  // index 0 and the whole room would learn to tap the first tile.
  const rng = seeded(4);
  const slots = new Map();
  for (let i = 0; i < 400; i += 1) {
    const q = generate(POOL, undefined, rng);
    const slot = q.options.indexOf(q.answer);
    slots.set(slot, (slots.get(slot) || 0) + 1);
  }
  assert.equal(slots.size, 4, 'the answer lands in all four slots');
  for (const [slot, n] of slots) {
    assert.ok(n > 400 * 0.15, `slot ${slot} got ${n}/400, suspiciously skewed`);
  }
});

test('generate: puzzles are varied, not a handful on repeat', () => {
  // A structural check would pass against a generator that emits one puzzle
  // forever, so measure the spread. Real numbers over 1000 draws are ~150
  // distinct answers and ~350 distinct specs; the floors are set well under
  // that so ordinary data edits don't turn this red.
  const rng = seeded(5);
  const answers = new Set();
  const specs = new Set();
  for (let i = 0; i < 1000; i += 1) {
    const q = generate(POOL, undefined, rng);
    answers.add(q.answer);
    specs.add(q.prompt);
  }
  assert.ok(answers.size > 80, `only ${answers.size} distinct answers in 1000 draws`);
  assert.ok(specs.size > 150, `only ${specs.size} distinct specs in 1000 draws`);
});

test('generate: no puzzle can hinge on telling red from green', () => {
  // Roughly one man in twelve cannot make that discrimination, and a spec whose
  // only colours are red and green can force exactly it.
  const rng = seeded(6);
  for (let i = 0; i < 500; i += 1) {
    const clauses = clausesOf(generate(POOL, undefined, rng).prompt);
    const colors = clauses.filter((c) => c.group === 'color').map((c) => c.value);
    assert.ok(!(colors.includes('red') && colors.includes('green')),
      'red and green never share a spec');
    assert.ok(clauses.some((c) => c.group === 'motif'), 'every spec has a non-colour way in');
  }
});

test('generate: a yellow clause never puts an orange flag on the board, and vice versa', () => {
  // Yellow and orange read alike on a thumbnail. If the spec turns on one of them,
  // a tile visibly wearing the other invites "is that yellow or orange?" -- the
  // player loses the round to our palette, not to the flags. So the confusable
  // partner stays off every tile (checked against the visible `primaryColors`,
  // the same field the spot mode matches colour includes against).
  const rng = seeded(11);
  let yellowSpecs = 0;
  let orangeSpecs = 0;
  for (let i = 0; i < 600; i += 1) {
    const q = generate(POOL, undefined, rng);
    const colors = clausesOf(q.prompt).filter((c) => c.group === 'color').map((c) => c.value);
    if (colors.includes('yellow')) {
      yellowSpecs += 1;
      for (const code of q.options) {
        assert.ok(!at(code).primaryColors.includes('orange'),
          `yellow spec ${q.prompt} put an orange tile (${code})`);
      }
    }
    if (colors.includes('orange')) {
      orangeSpecs += 1;
      for (const code of q.options) {
        assert.ok(!at(code).primaryColors.includes('yellow'),
          `orange spec ${q.prompt} put a yellow tile (${code})`);
      }
    }
  }
  // Guard the guard: a parse/data break that stopped producing yellow specs would
  // make the assertions above vacuous. Yellow is common; some must have appeared.
  assert.ok(yellowSpecs > 20, `expected many yellow specs in 600 draws, saw ${yellowSpecs}`);
});

test('randomSpec: yellow and orange never share a spec (the confusable pair as discriminators)', () => {
  // The other half of the same rule, one level up: banning the partner from the
  // tiles is impossible when BOTH are clauses (the spec would demand a colour it
  // also bans), and a spec whose two colours are yellow and orange is itself the
  // misclassification trap. Rejected at the source, exactly like red + green.
  const rng = seeded(12);
  for (let i = 0; i < 3000; i += 1) {
    const spec = randomSpec(rng);
    if (!spec) continue;
    const colors = spec.filter((c) => c.group === 'color').map((c) => c.value);
    assert.ok(!(colors.includes('yellow') && colors.includes('orange')),
      'yellow and orange never share a spec');
  }
});

test('generate: never asks about a flag whose motifs hide in a crest', () => {
  // The tag set records what is TRUE, not what is VISIBLE. Moldova really does
  // carry an animal, a bird and a cross -- all inside a small coat of arms that
  // nobody can resolve at tile size. This mode can only ask about the second.
  const rng = seeded(7);
  for (let i = 0; i < 400; i += 1) {
    for (const code of generate(POOL, undefined, rng).options) {
      assert.ok(isSpottable(at(code)), `${code} carries a coat of arms`);
    }
  }
});

test('generate: an ambiguous colour is never a clause about that flag', () => {
  // 25 countries carry `ambiguousColors` -- the cases we already know reasonable
  // people read differently. Asking a player to confirm one by eye, in public,
  // is picking a fight we documented ourselves.
  const rng = seeded(8);
  for (let i = 0; i < 400; i += 1) {
    const q = generate(POOL, undefined, rng);
    const clauses = clausesOf(q.prompt);
    const colorClauses = clauses.filter((c) => c.group === 'color').map((c) => c.value);
    for (const code of q.options) {
      const amb = at(code).ambiguousColors || [];
      for (const a of amb) {
        assert.ok(!colorClauses.includes(a), `${code}: ambiguous ${a} used as a clause`);
      }
    }
  }
});

test('a flag whose colour is COA/additional never satisfies "not that colour" (Brazil regression)', () => {
  // The reported bug: "x · y · not white" was dealt with Brazil as the answer.
  // Brazil's white (the "Ordem e Progresso" band and its 27 stars) lives in
  // additionalColors, so under the primaryColors view it vanished and "not white"
  // wrongly passed -- but the flag plainly HAS white, so calling it "not white" is
  // false. Excludes now consult the full palette, so Brazil can never answer a
  // white-exclusion spec, while an include still ignores the same additional white.
  const br = at('br');
  assert.ok(br.colors.includes('white'), 'guards the premise: Brazil has white somewhere');
  assert.ok(!br.primaryColors.includes('white'), 'guards the premise: its white is additional-only');

  const excludeWhite = filtersFor([{ group: 'color', value: 'white', sign: 'exclude' }]);
  assert.equal(
    matchesFilters(br, excludeWhite, PRIMARY), false,
    'Brazil must FAIL a "not white" clause -- it has white, additional or not',
  );

  // The asymmetry still holds the other way: an include of that additional-only
  // white keeps ignoring it, so we never DEMAND a colour hidden at thumbnail size.
  const includeWhite = filtersFor([{ group: 'color', value: 'white', sign: 'include' }]);
  assert.equal(
    matchesFilters(br, includeWhite, PRIMARY), false,
    'Brazil must not satisfy "has white" under the room-readable view',
  );
});

test('generate: honours the used-answers exclusion', () => {
  const rng = seeded(9);
  const first = generate(POOL, undefined, rng);
  const used = new Set([first.answer]);
  for (let i = 0; i < 100; i += 1) {
    const q = generate(POOL, used, rng);
    assert.ok(!used.has(q.answer), 'a fresh answer while fresh ones exist');
  }
});

test('generate: the vocabulary stays inside what the client can label', () => {
  const rng = seeded(10);
  for (let i = 0; i < 300; i += 1) {
    const clauses = clausesOf(generate(POOL, undefined, rng).prompt);
    for (const cl of clauses) {
      const known = cl.group === 'color' ? SPOT_COLORS : SPOT_MOTIFS;
      assert.ok(known.includes(cl.value), `${cl.value} is outside the vocabulary`);
    }
  }
});

test('clausesFromPrompt: rejects a spec naming anything this build cannot label', () => {
  // A newer server adding a motif to the vocabulary must reload us, not render a
  // spec with one clause silently dropped -- that would show the room a puzzle
  // whose answer looks plainly wrong.
  assert.equal(clausesFromPrompt('motif:coat-of-arms;color:red;color:-blue'), null,
    'coat-of-arms is outside this mode');
  assert.equal(clausesFromPrompt('color:red;color:-blue'), null, 'too few clauses');
  assert.equal(clausesFromPrompt(''), null, 'empty spec');
});

test('clausesFromPrompt: rejects a spec carrying a clause from outside the vocabulary', () => {
  // The value guard was not enough. It walked only the color and motif groups, so
  // a spec naming a group this mode does not use -- a continent, a statehood, a
  // colour count -- had that clause SILENTLY DROPPED, and if three colour/motif
  // clauses remained the guard still reported the question renderable. The room
  // would then see a three-clause spec for a four-clause question: the tiles that
  // "fail" look like they pass, everyone picks one, everyone is scored wrong.
  //
  // That is the precise failure this guard exists to prevent, so it must reject
  // anything it cannot represent, not just anything it cannot label.
  assert.equal(clausesFromPrompt('continent:Africa,color:red,color:!green,motif:cross'), null,
    'a continent clause is outside this mode');
  assert.equal(clausesFromPrompt('color:red,color:!green,motif:cross,status:un_member'), null,
    'so is a statehood clause');
});

test('failingClause: names the clause a flag misses, null when it satisfies all', () => {
  const rng = seeded(11);
  const q = generate(POOL, undefined, rng);
  const clauses = clausesOf(q.prompt);
  assert.equal(failingClause(at(q.answer), clauses), null, 'the answer fails nothing');
  for (const code of q.options.filter((c) => c !== q.answer)) {
    const miss = failingClause(at(code), clauses);
    assert.ok(miss, `${code} should fail something`);
    assert.ok(!matchesFilters(at(code), filtersFor([miss]), PRIMARY));
  }
});

test('randomSpec: three clauses, at least one motif, distinct values', () => {
  const rng = seeded(12);
  for (let i = 0; i < 500; i += 1) {
    const spec = randomSpec(rng);
    if (!spec) continue; // a red+green draw, correctly refused
    assert.equal(spec.length, SPOT_CLAUSES);
    assert.ok(spec.some((c) => c.group === 'motif'));
    const values = spec.map((c) => c.value);
    assert.equal(new Set(values).size, values.length, 'no clause repeats a value');
  }
});

test('buildPuzzle: returns null rather than a malformed puzzle', () => {
  // A pool of one can satisfy nothing, and the caller retries; it must not throw
  // or hand back a quartet padded with repeats.
  const rng = seeded(13);
  assert.equal(buildPuzzle([POOL[0]], rng), null);
});

test('generate: throws a named error when the pool cannot support a puzzle', () => {
  assert.throws(() => generate([], undefined, seeded(14)), /spotFlag: no puzzle/);
});

test('isCorrect: only the answer code', () => {
  assert.equal(isCorrect({ answer: 'se' }, 'se'), true);
  assert.equal(isCorrect({ answer: 'se' }, 'no'), false);
});

// ---- the reveal's labels ----

/** The identity translator: tests assert the English fallbacks, not a locale. */
const tr = (/** @type {string} */ _key, /** @type {string} */ fallback) => fallback;

test('missLabel: states what the flag IS, which is the inverse of the clause it broke', () => {
  // The easy thing to get backwards, and the reason this lives in a tested module
  // rather than in the reveal's DOM glue. A spec saying "no green" must label the
  // offending tile "green" -- echoing the clause unchanged would print "not green"
  // under a criteria line that already reads "not green", which tells the room
  // nothing and reads as a bug.
  const clauses = /** @type {any} */ ([
    { group: 'color', value: 'green', sign: 'exclude' },   // spec: no green
    { group: 'motif', value: 'cross', sign: 'include' },   // spec: has a cross
  ]);
  // Brazil: green, and no cross. It breaks the "no green" clause first.
  assert.equal(missLabel(at('br'), clauses, tr), 'green',
    'broke a no-X clause, so the tile says it HAS X');

  const crossOnly = /** @type {any} */ ([{ group: 'motif', value: 'cross', sign: 'include' }]);
  // Japan satisfies nothing here: no cross.
  assert.equal(missLabel(at('jp'), crossOnly, tr), 'not cross',
    'broke a has-X clause, so the tile says it has NOT X');
});

test('missLabel: a flag that satisfies the whole spec is labelled with nothing', () => {
  // The answer broke no rule, so its tile carries a bare name.
  const clauses = /** @type {any} */ ([{ group: 'color', value: 'red', sign: 'include' }]);
  assert.equal(missLabel(at('jp'), clauses, tr), '', 'Japan is red, so nothing to say');
});

test('missLabel: every distractor of a generated puzzle gets a non-empty reason', () => {
  // The mode's promise: you are told what you failed to notice. A silent strip
  // would make a provably fair round read as arbitrary.
  const rng = seeded(21);
  for (let i = 0; i < 100; i += 1) {
    const q = generate(POOL, undefined, rng);
    const clauses = clausesOf(q.prompt);
    for (const code of q.options) {
      const label = missLabel(at(code), clauses, tr);
      if (code === q.answer) assert.equal(label, '', `${code} is the answer`);
      else assert.ok(label.length > 0, `${code} should say why it failed`);
    }
  }
});

test('spotTitle: renders the criteria in the findFlag pill language', () => {
  const clauses = /** @type {any} */ ([
    { group: 'color', value: 'red', sign: 'include' },
    { group: 'color', value: 'green', sign: 'exclude' },
    { group: 'motif', value: 'star-or-moon', sign: 'include' },
  ]);
  // The identity translator hands back raw fallbacks, so motifs read as their ids
  // here; a real locale turns 'star-or-moon' into "star or moon". What this pins
  // is the SHAPE findFlag gives a criteria line -- middot separators and a spelled
  // "not" for a negated clause -- because that is what the party screen inherits.
  assert.equal(spotTitle(clauses, tr), 'red · not green · star-or-moon');
});
