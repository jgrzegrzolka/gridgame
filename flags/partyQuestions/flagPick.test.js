import { test } from 'node:test';
import assert from 'node:assert/strict';
import { id, generate, isCorrect } from './flagPick.js';

const POOL = [
  { code: 'jp' }, { code: 'kr' }, { code: 'cn' }, { code: 'th' },
  { code: 'fr' }, { code: 'de' }, { code: 'it' }, { code: 'es' },
];

test('id is stable', () => {
  assert.equal(id, 'flagPick');
});

test('generate: four unique options, one of them the answer, prompt == answer', () => {
  for (let i = 0; i < 50; i++) {
    const q = generate(POOL);
    assert.equal(q.options.length, 4);
    assert.equal(new Set(q.options).size, 4, 'options are distinct');
    assert.ok(q.options.includes(q.answer), 'the answer is among the options');
    assert.equal(q.prompt, q.answer, 'prompt names the target country');
    for (const code of q.options) {
      assert.ok(POOL.some((c) => c.code === code), 'options come from the pool');
    }
  }
});

test('generate: honours the exclude set so a game does not repeat a country', () => {
  // Exclude 2 of 8 — 6 remain, comfortably above the 4 needed, so the
  // exclusion is honoured rather than falling back to the full pool.
  const exclude = new Set(['jp', 'kr']);
  for (let i = 0; i < 50; i++) {
    const q = generate(POOL, exclude);
    assert.ok(!exclude.has(q.answer), `answer ${q.answer} was already used`);
  }
});

test('generate: falls back to the full pool when exclude would starve it', () => {
  const exclude = new Set(POOL.map((c) => c.code)); // everything excluded
  const q = generate(POOL, exclude); // must not throw — falls back
  assert.equal(q.options.length, 4);
});

test('isCorrect: only the answer code is correct', () => {
  const q = { prompt: 'jp', options: ['jp', 'kr', 'cn', 'th'], answer: 'jp' };
  assert.equal(isCorrect(q, 'jp'), true);
  assert.equal(isCorrect(q, 'kr'), false);
  assert.equal(isCorrect(q, 'zz'), false);
});
