import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  roundCountFor,
  validatePicksPerPlayer,
  pickerFor,
  handFor,
  isValidPick,
  OPENING_MODE_ID,
  REPEATABLE_MODE_IDS,
  MAX_DRAFT_ROUNDS,
  PICKS_PER_PLAYER_OPTIONS,
  DEFAULT_PICKS_PER_PLAYER,
  HAND_SIZE,
  canVeilMode,
} from './partyDraft.js';
import { PARTY_MODES, PICTURE_MODES, METRIC_MODES } from './partyPlan.js';
import { veilActive } from './partyTiming.js';

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

// ---- roundCountFor ----

test('roundCountFor: players x picks + 1', () => {
  assert.equal(roundCountFor(3, 2), 7);   // 3 seats x 2 picks + the opener
  assert.equal(roundCountFor(2, 1), 3);
  assert.equal(roundCountFor(4, 4), 17);
  assert.equal(roundCountFor(1, 3), 4);
});

test('roundCountFor: every seat picks exactly picksPerPlayer times', () => {
  // rounds - 1 (the fixed opener) is the number of picks, split evenly.
  for (const players of [1, 2, 3, 4]) {
    for (const picks of PICKS_PER_PLAYER_OPTIONS) {
      assert.equal(roundCountFor(players, picks) - 1, players * picks, `${players}p x ${picks}`);
    }
  }
});

test('roundCountFor: defaults to one pick each', () => {
  assert.equal(roundCountFor(3), roundCountFor(3, DEFAULT_PICKS_PER_PLAYER));
  assert.equal(roundCountFor(3), 4);
});

test('roundCountFor: a bad picks value falls back rather than throwing', () => {
  assert.equal(roundCountFor(3, 99), 4);
  assert.equal(roundCountFor(3, 0), 4);
  assert.equal(roundCountFor(3, NaN), 4);
});

test('roundCountFor: at least one round, junk seat count coerces to the opener alone', () => {
  assert.equal(roundCountFor(0, 2), 1);
  assert.equal(roundCountFor(-5, 2), 1);
  assert.equal(roundCountFor(NaN, 2), 1);
});

test('roundCountFor: the ceiling is a backstop a normal room never reaches', () => {
  // The worst offered combination in a 4-player room is well under the cap...
  assert.ok(roundCountFor(4, 4) < MAX_DRAFT_ROUNDS);
  // ...but an absurd room is still bounded.
  assert.equal(roundCountFor(500, 4), MAX_DRAFT_ROUNDS);
});

// ---- validatePicksPerPlayer ----

test('validatePicksPerPlayer: accepts exactly the offered set', () => {
  for (const n of PICKS_PER_PLAYER_OPTIONS) assert.equal(validatePicksPerPlayer(n), n);
});

test('validatePicksPerPlayer: anything else falls back to the default, never clamps', () => {
  // 5 is out of the set; falling back (not clamping to 4) keeps a buggy client visible.
  for (const bad of [0, 5, 99, -1, 2.5, NaN, '2', null, undefined, {}]) {
    assert.equal(validatePicksPerPlayer(bad), DEFAULT_PICKS_PER_PLAYER, String(bad));
  }
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
  // b is last -> picks round 2. If b then climbs above a, a is now last but the
  // no-repeat clause still gives the next pick to a (b already picked).
  assert.equal(pickerFor(board('a', 'b'), []), 'b');
  assert.equal(pickerFor(board('b', 'a'), ['b']), 'a');
});

test('pickerFor: null only when there is nobody on the board', () => {
  assert.equal(pickerFor([], []), null);
  assert.equal(pickerFor([], ['a']), null);
});

test('pickerFor: the rotation wraps once everyone has picked', () => {
  // A host can set more rounds than seats, so after a full rotation the pool
  // resets and the lowest-ranked seat picks again.
  assert.equal(pickerFor(board('a', 'b'), ['a', 'b']), 'b');
  assert.equal(pickerFor(board('a', 'b'), ['a', 'b', 'b']), 'a');
  assert.equal(pickerFor(board('a', 'b'), ['a', 'b', 'b', 'a']), 'b', 'and wraps again');
});

test('pickerFor: wrapping never hands two picks in a row to one seat', () => {
  // The regression the count-based rotation exists to prevent: a set-based
  // "not yet picked" test wraps once and then feeds every round to the same seat.
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

test('handFor: returns HAND_SIZE ids, no non-repeatable already used', () => {
  const hand = handFor(['map-outlines'], seeded(1));
  assert.equal(hand.length, HAND_SIZE);
  assert.ok(!hand.includes('map-outlines'), 'a played one-shot mode is gone');
  assert.equal(new Set(hand).size, hand.length, 'no duplicates in a hand');
});

test('handFor: surfaces the unused picture modes (they are few and characterful)', () => {
  const hand = handFor(['map-outlines'], seeded(7));
  for (const id of REPEATABLE_MODE_IDS) assert.ok(hand.includes(id), `expected ${id} in the hand`);
});

test('handFor: Flags and Weird flags stay on offer however often they are played', () => {
  // They are the game itself, and Flags is the fixed opener — the no-repeat rule
  // retired it before anyone could choose it even once.
  const playedALot = [...REPEATABLE_MODE_IDS, ...REPEATABLE_MODE_IDS, 'map-outlines'];
  const hand = handFor(playedALot, seeded(11));
  for (const id of REPEATABLE_MODE_IDS) assert.ok(hand.includes(id), `${id} still offered`);
  assert.ok(!hand.includes('map-outlines'), 'the one-shot modes still drop out');
});

test('handFor: the picture modes always lead, in catalog order', () => {
  // The common choice must not be a search through ten cards, and a returning
  // player should find them where they were last time.
  const picIds = PICTURE_MODES.map((m) => m.id);
  for (const seed of [1, 2, 3, 42, 999]) {
    const hand = handFor([], seeded(seed));
    assert.deepEqual(hand.slice(0, picIds.length), picIds, `seed ${seed}`);
  }
});

test('handFor: a played one-shot picture mode drops out without disturbing the order', () => {
  const hand = handFor(['map-outlines'], seeded(5));
  assert.deepEqual(hand.slice(0, REPEATABLE_MODE_IDS.length), REPEATABLE_MODE_IDS,
    'the repeatable pair still leads, still in order');
  assert.ok(!hand.includes('map-outlines'));
});

test('handFor: the statistics below stay shuffled', () => {
  // Fixed order up top is deliberate; fixed order across 30-odd metrics would
  // just favour whatever sorts first.
  const metricIds = new Set(METRIC_MODES.map((m) => m.id));
  const tails = new Set();
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    tails.add(handFor([], seeded(seed)).filter((id) => metricIds.has(id)).join(','));
  }
  assert.ok(tails.size > 1, 'different seeds give different statistics');
});

test('handFor: fills the rest with statistics', () => {
  // After the opener, all three picture modes are still on offer (the two
  // repeatables plus the unplayed outlines), so statistics fill the remaining
  // seven of ten.
  const hand = handFor([OPENING_MODE_ID], seeded(3));
  const metricIds = new Set(METRIC_MODES.map((m) => m.id));
  const metricsInHand = hand.filter((id) => metricIds.has(id));
  assert.equal(metricsInHand.length, HAND_SIZE - PICTURE_MODES.length);
});

test('handFor: shrinks gracefully when few modes remain', () => {
  // Everything played except the last two statistics. The hand is those two plus
  // the repeatable pair, which never runs out — so a late-game picker always has
  // a real choice rather than a single forced card.
  const allButTwo = [...PICTURE_MODES, ...METRIC_MODES].map((m) => m.id).slice(0, -2);
  const hand = handFor(allButTwo, seeded(9));
  assert.equal(hand.length, 2 + REPEATABLE_MODE_IDS.length);
  for (const id of REPEATABLE_MODE_IDS) assert.ok(hand.includes(id), `${id} always available`);
});

test('handFor: never empties, even with the whole catalog played', () => {
  // The old rule could deal an empty hand once everything was used; the picker
  // then had nothing to choose and the server picked at random for them.
  const everything = [...PICTURE_MODES, ...METRIC_MODES].map((m) => m.id);
  assert.deepEqual(handFor(everything, seeded(4)), REPEATABLE_MODE_IDS);
});

test('handFor: deterministic under a seeded rng', () => {
  assert.deepEqual(handFor([OPENING_MODE_ID], seeded(42)), handFor([OPENING_MODE_ID], seeded(42)));
});

// ---- isValidPick ----

test('isValidPick: a real, unused catalog mode passes', () => {
  assert.equal(isValidPick('map-outlines', [OPENING_MODE_ID]), true);
});

test('isValidPick: a repeatable mode passes however often it has been played', () => {
  for (const id of REPEATABLE_MODE_IDS) {
    assert.equal(isValidPick(id, [id]), true, `${id} after one play`);
    assert.equal(isValidPick(id, [id, id, id]), true, `${id} after three`);
  }
});

test('isValidPick: rejects a repeat, an unknown mode, and non-strings', () => {
  assert.equal(isValidPick('map-outlines', ['map-outlines']), false); // already played
  assert.equal(isValidPick('not-a-mode', []), false);
  assert.equal(isValidPick(/** @type {any} */ (null), []), false);
  assert.equal(isValidPick(/** @type {any} */ (42), []), false);
});

test('canVeilMode: only the picture trio can be veiled', () => {
  for (const m of PICTURE_MODES) assert.equal(canVeilMode(m.id), true, `${m.id} should be veilable`);
  for (const m of METRIC_MODES) assert.equal(canVeilMode(m.id), false, `${m.id} should not be veilable`);
  assert.equal(canVeilMode('no-such-mode'), false, 'an unknown mode is never veilable');
});

// The pick card offers the veil chip off canVeilMode, but what actually paints
// the veil at question time is veilActive. If the two ever disagree, a picker
// could arm a veil that never appears (or the chip would hide on a mode that
// veils fine). Pin them to each other across the whole catalog rather than
// trusting two hand-maintained lists to stay in step.
test('canVeilMode agrees with veilActive for every catalog mode', () => {
  for (const m of PARTY_MODES) {
    assert.equal(canVeilMode(m.id), veilActive(true, m.questionId), `${m.id} disagrees`);
  }
});
