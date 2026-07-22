import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FAKE_FLAGS } from './fakeFlags.js';

test('FAKE_FLAGS: exactly three flags', () => {
  assert.equal(FAKE_FLAGS.length, 3);
});

test('FAKE_FLAGS: each is a self-contained 3:2 inline SVG', () => {
  for (const svg of FAKE_FLAGS) {
    assert.match(svg, /^<svg\b/, 'starts with <svg');
    assert.match(svg, /viewBox="0 0 36 24"/, 'native 3:2 so it fills a flag stamp');
    assert.match(svg, /<\/svg>$/, 'closes the svg');
  }
});

test('FAKE_FLAGS: no external references (safe for innerHTML)', () => {
  for (const svg of FAKE_FLAGS) {
    // No url()/href/src that could reach out; no clipPath ids that could collide
    // across three copies rendered into the same document.
    assert.doesNotMatch(svg, /url\(|href=|src=|<image|clipPath|id=/i);
  }
});

test('FAKE_FLAGS: the array is frozen so callers can\'t mutate the shared set', () => {
  assert.ok(Object.isFrozen(FAKE_FLAGS));
});
