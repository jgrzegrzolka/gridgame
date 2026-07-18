import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  blockCountFor,
  validateBlockCount,
  pickerFor,
  handFor,
  isValidPick,
  OPENING_MODE_ID,
  MAX_DRAFT_BLOCKS,
  MIN_DRAFT_BLOCKS,
  HAND_SIZE,
} from './partyDraft.js';
import { PICTURE_MODES, METRIC_MODES } from './partyPlan.js';

/** Small seeded LCG so the shuffle-based helpers are deterministic in tests.
 *  @param {number} seed */
function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** @param {...string} ids */
const board = (...ids) => ids.map((playerId) => ({ playerId }));

// ---- blockCountFor ----

test('blockCountFor: 2 x players + 1, capped at MAX_DRAFT_BLOCKS', () => {
  assert.equal(blockCountFor(1), 3);
  assert.equal(blockCountFor(2), 5);
  assert.equal(blockCountFor(3), 7);
  assert.equal(blockCountFor(4), 9);
  assert.equal(blockCountFor(10), MAX_DRAFT_BLOCKS); // capped
});

test('blockCountFor: "everyone picks twice" holds while under the cap', () => {
  // picks = blocks - 1 (block 1 is the fixed opener); it should be twice the seats.
  for (const players of [1, 2, 3, 4]) {
    assert.equal(blockCountFor(players) - 1, players * 2, `${players} players`);
  }
});

test('blockCountFor: at least one block, junk coerces to 1', () => {
  assert.equal(blockCountFor(0), 1);
  assert.equal(blockCountFor(-5), 1);
  assert.equal(blockCountFor(NaN), 1);
});

// ---- validateBlockCount ----

test('validateBlockCount: accepts any integer in range', () => {
  for (let n = MIN_DRAFT_BLOCKS; n <= MAX_DRAFT_BLOCKS; n++) {
    assert.equal(validateBlockCount(n, 3), n);
  }
});

test('validateBlockCount: falls back on out-of-range, fractional, or non-numeric', () => {
  assert.equal(validateBlockCount(0, 3), 3);
  assert.equal(validateBlockCount(MAX_DRAFT_BLOCKS + 1, 3), 3);
  assert.equal(validateBlockCount(999, 3), 3);
  assert.equal(validateBlockCount(-4, 3), 3);
  assert.equal(validateBlockCount(2.5, 3), 3);
  assert.equal(validateBlockCount(NaN, 3), 3);
  assert.equal(validateBlockCount('4', 3), 3, 'a numeric string is not a number');
  assert.equal(validateBlockCount(undefined, 3), 3);
  assert.equal(validateBlockCount(null, 3), 3);
});

test('validateBlockCount: clamps a junk fallback into range too', () => {
  assert.equal(validateBlockCount(undefined, 999), MAX_DRAFT_BLOCKS);
  assert.equal(validateBlockCount(undefined, 0), MIN_DRAFT_BLOCKS);
  assert.equal(validateBlockCount(undefined, NaN), MIN_DRAFT_BLOCKS);
});

// ---- pickerFor ----

test('pickerFor: the lowest-ranked (last) seat picks when nobody has yet', () => {
  assert.equal(pickerFor(board('a', 'b', 'c'), []), 'c');
});

test('pickerFor: skips seats that already picked (no repeat)', () => {
  // c already picked; the next-lowest that hasn't is b.
  assert.equal(pickerFor(board('a', 'b', 'c'), ['c']), 'b');
  assert.equal(pickerFor(board('a', 'b', 'c'), ['c', 'b']), 'a');
});

test('pickerFor: two-player game hands the two picks to two different seats', () => {
  // b is last -> picks block 2. If b then climbs above a, a is now last but the
  // no-repeat clause still gives the next pick to a (b already picked).
  assert.equal(pickerFor(board('a', 'b'), []), 'b');
  assert.equal(pickerFor(board('b', 'a'), ['b']), 'a');
});

test('pickerFor: null only when there is nobody on the board', () => {
  assert.equal(pickerFor([], []), null);
  assert.equal(pickerFor([], ['a']), null);
});

test('pickerFor: the rotation wraps once everyone has picked', () => {
  // A host can set more blocks than seats, so after a full rotation the pool
  // resets and the lowest-ranked seat picks again.
  assert.equal(pickerFor(board('a', 'b'), ['a', 'b']), 'b');
  assert.equal(pickerFor(board('a', 'b'), ['a', 'b', 'b']), 'a');
  assert.equal(pickerFor(board('a', 'b'), ['a', 'b', 'b', 'a']), 'b', 'and wraps again');
});

test('pickerFor: wrapping never hands two picks in a row to one seat', () => {
  // The regression the count-based rotation exists to prevent: a set-based
  // "not yet picked" test wraps once and then feeds every block to the same seat.
  const seats = board('a', 'b', 'c');
  /** @type {string[]} */
  const history = [];
  for (let i = 0; i < 9; i++) {
    const picker = pickerFor(seats, history);
    assert.ok(picker, 'a picker is always available with seats on the board');
    history.push(/** @type {string} */ (picker));
  }
  // Three full rotations: every seat picked exactly three times.
  for (const id of ['a', 'b', 'c']) {
    assert.equal(history.filter((p) => p === id).length, 3, `${id} picked 3 times`);
  }
});

test('pickerFor: a departed seat does not stall the rotation', () => {
  // c picked and then left. a and b have one pick each, so the rotation must
  // wrap to them rather than waiting on a seat that will never pick again.
  assert.equal(pickerFor(board('a', 'b'), ['c', 'a', 'b']), 'b');
});

// ---- handFor ----

test('handFor: returns HAND_SIZE ids, none already used', () => {
  const hand = handFor([OPENING_MODE_ID], seeded(1));
  assert.equal(hand.length, HAND_SIZE);
  assert.ok(!hand.includes(OPENING_MODE_ID));
  assert.equal(new Set(hand).size, hand.length, 'no duplicates in a hand');
});

test('handFor: surfaces the unused picture modes (they are few and characterful)', () => {
  // Only flags-all used -> the other two picture modes should both be in the hand.
  const hand = handFor([OPENING_MODE_ID], seeded(7));
  const remainingPics = PICTURE_MODES.filter((m) => m.id !== OPENING_MODE_ID).map((m) => m.id);
  for (const id of remainingPics) assert.ok(hand.includes(id), `expected ${id} in the hand`);
});

test('handFor: fills the rest with statistics', () => {
  const hand = handFor([OPENING_MODE_ID], seeded(3));
  const metricIds = new Set(METRIC_MODES.map((m) => m.id));
  const metricsInHand = hand.filter((id) => metricIds.has(id));
  // 2 picture modes remain + 3 metrics = 5.
  assert.equal(metricsInHand.length, HAND_SIZE - 2);
});

test('handFor: shrinks gracefully when few modes remain', () => {
  const allButTwo = [...PICTURE_MODES, ...METRIC_MODES].map((m) => m.id).slice(0, -2);
  const hand = handFor(allButTwo, seeded(9));
  assert.equal(hand.length, 2);
});

test('handFor: deterministic under a seeded rng', () => {
  assert.deepEqual(handFor([OPENING_MODE_ID], seeded(42)), handFor([OPENING_MODE_ID], seeded(42)));
});

// ---- isValidPick ----

test('isValidPick: a real, unused catalog mode passes', () => {
  assert.equal(isValidPick('map-outlines', [OPENING_MODE_ID]), true);
});

test('isValidPick: rejects a repeat, an unknown mode, and non-strings', () => {
  assert.equal(isValidPick('map-outlines', ['map-outlines']), false); // already played
  assert.equal(isValidPick('not-a-mode', []), false);
  assert.equal(isValidPick(/** @type {any} */ (null), []), false);
  assert.equal(isValidPick(/** @type {any} */ (42), []), false);
});
