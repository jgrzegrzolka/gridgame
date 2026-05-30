import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  pickQuestion,
  createQuiz,
  VARIANTS,
  poolFor,
  targetFor,
  MODES,
  availableModes,
  formatTime,
} from './quiz.js';

/** @typedef {import('./group.js').Country} Country */

const __dirname = dirname(fileURLToPath(import.meta.url));
/** @type {Country[]} */
const countries = JSON.parse(
  readFileSync(join(__dirname, 'countries.json'), 'utf8'),
);

const sample = Array.from({ length: 10 }, (_, i) => ({
  code: `c${i}`,
  name: `Country ${i}`,
}));

test('pickQuestion returns exactly 4 choices by default', () => {
  const q = pickQuestion(sample);
  assert.equal(q.choices.length, 4);
});

test('pickQuestion answer is always one of the choices', () => {
  for (let i = 0; i < 100; i++) {
    const q = pickQuestion(sample);
    assert.ok(
      q.choices.some((c) => c.code === q.answer.code),
      `answer ${q.answer.code} not in choices`,
    );
  }
});

test('pickQuestion choices are all unique', () => {
  for (let i = 0; i < 100; i++) {
    const q = pickQuestion(sample);
    const codes = new Set(q.choices.map((c) => c.code));
    assert.equal(codes.size, 4);
  }
});

test('pickQuestion choices all come from the input pool', () => {
  const inputCodes = new Set(sample.map((c) => c.code));
  for (let i = 0; i < 100; i++) {
    const q = pickQuestion(sample);
    for (const c of q.choices) {
      assert.ok(inputCodes.has(c.code), `${c.code} not from input`);
    }
  }
});

test('pickQuestion answer can land at any of the four positions', () => {
  // With 100 calls and 4 positions, each position should occur at least
  // once with overwhelming probability (~1 in 10^12 chance otherwise).
  const positions = new Set();
  for (let i = 0; i < 100; i++) {
    const q = pickQuestion(sample);
    positions.add(q.choices.findIndex((c) => c.code === q.answer.code));
  }
  assert.equal(positions.size, 4);
});

test('pickQuestion respects a custom choiceCount', () => {
  const q = pickQuestion(sample, 6);
  assert.equal(q.choices.length, 6);
});

test('pickQuestion throws if input is too small', () => {
  assert.throws(
    () => pickQuestion(sample.slice(0, 3)),
    /Need at least 4 entries/,
  );
});

test('VARIANTS contains the expected 9 keys in display order', () => {
  assert.deepEqual(Object.keys(VARIANTS), [
    'europe',
    'asia',
    'africa',
    'north-america',
    'south-america',
    'oceania',
    'others',
    'countries',
    'all',
  ]);
});

test('poolFor throws on an unknown variant', () => {
  assert.throws(() => poolFor('mars', countries), /Unknown variant/);
});

test('poolFor("all") returns every entry from the input', () => {
  assert.equal(poolFor('all', countries).length, countries.length);
});

test('poolFor("countries") = all entries minus "others"', () => {
  const all = countries.length;
  const others = poolFor('others', countries).length;
  assert.equal(poolFor('countries', countries).length, all - others);
});

test('poolFor("europe") returns only category=country with continent=Europe', () => {
  const europe = poolFor('europe', countries);
  assert.ok(europe.length > 0);
  for (const c of europe) {
    assert.equal(c.category, 'country');
    assert.equal(c.continent, 'Europe');
  }
});

test('every variant returns at least 4 entries (enough for a 4-choice question)', () => {
  for (const key of Object.keys(VARIANTS)) {
    const pool = poolFor(key, countries);
    assert.ok(
      pool.length >= 4,
      `variant "${key}" has only ${pool.length} entries`,
    );
  }
});

test('createQuiz never repeats the same answer across the run', () => {
  const quiz = createQuiz(sample, sample.length);
  const seen = new Set();
  let q;
  while ((q = quiz.next())) {
    assert.ok(!seen.has(q.answer.code), `answer ${q.answer.code} repeated`);
    seen.add(q.answer.code);
  }
  assert.equal(seen.size, sample.length);
});

test('createQuiz yields exactly `count` questions then null', () => {
  const quiz = createQuiz(sample, 5);
  for (let i = 0; i < 5; i++) {
    assert.ok(quiz.next(), `expected question #${i + 1}`);
  }
  assert.equal(quiz.next(), null);
});

test('createQuiz choices always include the answer and are unique', () => {
  const quiz = createQuiz(sample, sample.length);
  let q;
  while ((q = quiz.next())) {
    const codes = new Set(q.choices.map((c) => c.code));
    assert.equal(codes.size, 4);
    assert.ok(codes.has(q.answer.code));
  }
});

test('createQuiz throws if count exceeds pool size', () => {
  assert.throws(
    () => createQuiz(sample, sample.length + 1),
    /Cannot ask/,
  );
});

test('MODES contains "20" and "all" in that display order', () => {
  assert.deepEqual(Object.keys(MODES), ['20', 'all']);
});

test('targetFor("20", pool) returns 20 when pool is large enough', () => {
  assert.equal(targetFor('20', countries), 20);
});

test('targetFor("20", tinyPool) clamps to pool length', () => {
  const tinyPool = sample.slice(0, 5);
  assert.equal(targetFor('20', tinyPool), 5);
});

test('targetFor("all", pool) returns the full pool length', () => {
  assert.equal(targetFor('all', countries), countries.length);
});

test('targetFor throws on an unknown mode', () => {
  assert.throws(() => targetFor('99', countries), /Unknown mode/);
});

test('availableModes offers both 20 and all when pool >= 20', () => {
  assert.deepEqual(availableModes(50), ['20', 'all']);
});

test('availableModes still offers 20 exactly at the boundary', () => {
  assert.deepEqual(availableModes(20), ['20', 'all']);
});

test('availableModes hides 20 when pool is below 20', () => {
  assert.deepEqual(availableModes(19), ['all']);
  assert.deepEqual(availableModes(13), ['all']);
  assert.deepEqual(availableModes(4), ['all']);
});

test('availableModes returns "all" alone for an empty pool', () => {
  assert.deepEqual(availableModes(0), ['all']);
});

test('availableModes preserves MODES insertion order', () => {
  // "20" must come first so the menu reads "Label: 20 | all".
  assert.deepEqual(availableModes(100), ['20', 'all']);
});

test('formatTime(0) renders zero with the full three-digit ms field', () => {
  assert.equal(formatTime(0), '0:00.000');
});

test('formatTime pads sub-second values', () => {
  assert.equal(formatTime(1), '0:00.001');
  assert.equal(formatTime(42), '0:00.042');
  assert.equal(formatTime(999), '0:00.999');
});

test('formatTime rolls milliseconds into seconds at 1000', () => {
  assert.equal(formatTime(1000), '0:01.000');
  assert.equal(formatTime(1001), '0:01.001');
});

test('formatTime rolls seconds into minutes at 60000', () => {
  assert.equal(formatTime(59999), '0:59.999');
  assert.equal(formatTime(60000), '1:00.000');
});

test('formatTime handles multi-minute durations without zero-padding the minutes', () => {
  assert.equal(formatTime(123456), '2:03.456');
  assert.equal(formatTime(600000), '10:00.000');
});

test('formatTime floors rather than rounds so it never overshoots elapsed time', () => {
  // 1999ms is just under 2 seconds - must read 0:01.999, not 0:02.000.
  assert.equal(formatTime(1999), '0:01.999');
});
