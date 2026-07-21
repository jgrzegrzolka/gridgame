import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextRadioId, RADIO_KEYS } from './radioGroup.js';

const LENGTHS = ['short', 'medium', 'long'];
const FIRST_PICK_MODES = ['flags-all', 'flags-weird', 'map-outlines', 'spot-flag'];

test('nextRadioId: right and down step forward, left and up step back', () => {
  // Both axes, because a segmented row reads horizontal but Up/Down is what a
  // screen reader user reaches for and role="radiogroup" promises them.
  assert.equal(nextRadioId(LENGTHS, 'short', 'ArrowRight'), 'medium');
  assert.equal(nextRadioId(LENGTHS, 'short', 'ArrowDown'), 'medium');
  assert.equal(nextRadioId(LENGTHS, 'medium', 'ArrowLeft'), 'short');
  assert.equal(nextRadioId(LENGTHS, 'medium', 'ArrowUp'), 'short');
});

test('nextRadioId: both ends wrap', () => {
  // Stopping at the end of a small radiogroup reads as broken rather than bounded.
  assert.equal(nextRadioId(LENGTHS, 'long', 'ArrowRight'), 'short', 'forward off the end');
  assert.equal(nextRadioId(LENGTHS, 'short', 'ArrowLeft'), 'long', 'back off the start');
  // The one that a hand-written `(i - 1) % n` gets wrong: JS keeps the sign, so
  // stepping back from index 0 lands on -1 and the caller reads undefined.
  assert.equal(nextRadioId(FIRST_PICK_MODES, 'flags-all', 'ArrowLeft'), 'spot-flag');
});

test('nextRadioId: Home and End jump to the ends', () => {
  assert.equal(nextRadioId(FIRST_PICK_MODES, 'map-outlines', 'Home'), 'flags-all');
  assert.equal(nextRadioId(FIRST_PICK_MODES, 'flags-all', 'End'), 'spot-flag');
});

test('nextRadioId: a key the group does not own is left alone', () => {
  // Returning null rather than a value is what lets the handler skip
  // preventDefault, so Tab still moves on and page shortcuts still fire.
  for (const key of ['Tab', 'Enter', ' ', 'a', 'Escape', 'PageDown']) {
    assert.equal(nextRadioId(LENGTHS, 'short', key), null, `${key} is not ours`);
  }
});

test('nextRadioId: a current value outside the list steps from the start', () => {
  // Reachable for real: a room that has not told us its setting yet, or a value
  // from a newer build. Must not throw, and must not return undefined.
  assert.equal(nextRadioId(FIRST_PICK_MODES, 'no-such-mode', 'ArrowRight'), 'flags-all');
  assert.equal(nextRadioId(FIRST_PICK_MODES, '', 'ArrowRight'), 'flags-all');
});

test('nextRadioId: an empty or missing group returns null rather than throwing', () => {
  assert.equal(nextRadioId([], 'short', 'ArrowRight'), null);
  assert.equal(nextRadioId(/** @type {any} */ (null), 'short', 'ArrowRight'), null);
});

test('nextRadioId: stepping all the way round returns to where it started', () => {
  // The property that matters more than any single step: no option is skipped and
  // none is visited twice, for either direction.
  for (const dir of ['ArrowRight', 'ArrowLeft']) {
    let at = FIRST_PICK_MODES[0];
    const seen = [at];
    for (let i = 0; i < FIRST_PICK_MODES.length - 1; i += 1) {
      at = /** @type {string} */ (nextRadioId(FIRST_PICK_MODES, at, dir));
      seen.push(at);
    }
    assert.equal(new Set(seen).size, FIRST_PICK_MODES.length, `${dir} visits every option once`);
    assert.equal(nextRadioId(FIRST_PICK_MODES, at, dir), FIRST_PICK_MODES[0], `${dir} closes the loop`);
  }
});

test('RADIO_KEYS: exactly the keys the handler claims to own', () => {
  assert.deepEqual([...RADIO_KEYS].sort(),
    ['ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'End', 'Home'].sort());
});
