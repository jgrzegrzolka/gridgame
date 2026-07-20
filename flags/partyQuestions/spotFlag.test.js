import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadCountries } from '../group.js';
import { sovereignPool } from '../flagPools.js';
import {
  generate, isCorrect, buildPuzzle, randomSpec, filtersFor, failingClause,
  clausesFromPrompt, isSpottable, SPOT_COLORS, SPOT_MOTIFS, SPOT_CLAUSES,
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
