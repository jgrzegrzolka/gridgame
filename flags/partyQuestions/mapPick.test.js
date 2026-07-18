import { test } from 'node:test';
import assert from 'node:assert/strict';
import { id, generate, isCorrect } from './mapPick.js';
import { CONTOUR_CODES, CONTOUR_CODE_SET } from '../contourPool.js';

// A pool where every code has a contour, plus a couple that don't, to prove the
// narrowing. Uses real contour codes so the CONTOUR_CODE_SET filter keeps them.
const WITH_CONTOUR = CONTOUR_CODES.slice(0, 8).map((code) => ({ code }));
const NO_CONTOUR = [{ code: 'zz' }, { code: 'qx' }];

/**
 * A tiny seeded RNG so the shuffles are deterministic in tests.
 * @param {number} seed
 * @returns {() => number}
 */
function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

test('id is stable', () => {
  assert.equal(id, 'mapPick');
});

test('generate: four distinct options, answer among them, prompt == answer', () => {
  for (let i = 0; i < 50; i++) {
    const q = generate(WITH_CONTOUR, undefined, seeded(i + 1));
    assert.equal(q.options.length, 4);
    assert.equal(new Set(q.options).size, 4, 'options are distinct');
    assert.ok(q.options.includes(q.answer), 'the answer is among the options');
    assert.equal(q.prompt, q.answer, 'prompt names the target country');
  }
});

test('generate: only draws codes that have a contour asset', () => {
  const pool = [...WITH_CONTOUR, ...NO_CONTOUR];
  for (let i = 0; i < 50; i++) {
    const q = generate(pool, undefined, seeded(i + 100));
    for (const code of q.options) {
      assert.ok(CONTOUR_CODE_SET.has(code), `${code} has no contour asset`);
    }
  }
});

test('generate: honours the exclude set so a game does not repeat a country', () => {
  const exclude = new Set(CONTOUR_CODES.slice(0, 2)); // 6 of 8 remain, above the 4 needed
  for (let i = 0; i < 50; i++) {
    const q = generate(WITH_CONTOUR, exclude, seeded(i + 200));
    assert.ok(!exclude.has(q.answer), `answer ${q.answer} was already used`);
  }
});

test('generate: falls back to the full contour set when exclude would starve it', () => {
  const exclude = new Set(WITH_CONTOUR.map((c) => c.code)); // everything excluded
  const q = generate(WITH_CONTOUR, exclude, seeded(7)); // must not throw
  assert.equal(q.options.length, 4);
});

test('isCorrect: only the answer code is correct', () => {
  const q = { prompt: 'pl', options: ['pl', 'de', 'fr', 'it'], answer: 'pl' };
  assert.equal(isCorrect(q, 'pl'), true);
  assert.equal(isCorrect(q, 'de'), false);
  assert.equal(isCorrect(q, 'zz'), false);
});
