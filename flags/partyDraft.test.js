import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  blockCountFor,
  pickerFor,
  handFor,
  isValidPick,
  OPENING_MODE_ID,
  MAX_DRAFT_BLOCKS,
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

test('blockCountFor: players + 1, capped at MAX_DRAFT_BLOCKS', () => {
  assert.equal(blockCountFor(1), 2);
  assert.equal(blockCountFor(2), 3);
  assert.equal(blockCountFor(3), 4);
  assert.equal(blockCountFor(4), 5);
  assert.equal(blockCountFor(10), MAX_DRAFT_BLOCKS); // capped
});

test('blockCountFor: "everyone picks exactly once" holds for 2-to-4 players', () => {
  // picks = blocks - 1 (block 1 is the fixed opener); it should equal the seat count.
  for (const players of [2, 3, 4]) {
    assert.equal(blockCountFor(players) - 1, players, `${players} players`);
  }
});

test('blockCountFor: at least one block, junk coerces to 1', () => {
  assert.equal(blockCountFor(0), 1);
  assert.equal(blockCountFor(-5), 1);
  assert.equal(blockCountFor(NaN), 1);
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

test('pickerFor: null when everyone eligible has already picked', () => {
  assert.equal(pickerFor(board('a', 'b'), ['a', 'b']), null);
  assert.equal(pickerFor([], []), null);
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
