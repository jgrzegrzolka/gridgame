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
  isDeciderPick,
  deciderPickerFor,
  eligiblePickers,
} from './partyDraft.js';
import { PARTY_MODES, PICTURE_MODES, METRIC_MODES, isFinalRound, ROUND_QUESTIONS } from './partyPlan.js';
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

test('roundCountFor: players x picks + 2', () => {
  assert.equal(roundCountFor(3, 2), 8);   // 3 seats x 2 picks + opener + Decider
  assert.equal(roundCountFor(2, 1), 4);
  assert.equal(roundCountFor(4, 4), 18);
  assert.equal(roundCountFor(1, 3), 5);
});

test('roundCountFor: every seat picks exactly picksPerPlayer times', () => {
  // rounds - 2 (the fixed opener and the Decider, neither of which spends a
  // rotation slot) is the number of rotation picks, split evenly. This is the
  // promise the Decider was kept OUTSIDE the rotation to preserve.
  for (const players of [1, 2, 3, 4]) {
    for (const picks of PICKS_PER_PLAYER_OPTIONS) {
      assert.equal(roundCountFor(players, picks) - 2, players * picks, `${players}p x ${picks}`);
    }
  }
});

test('roundCountFor: defaults to one pick each', () => {
  assert.equal(roundCountFor(3), roundCountFor(3, DEFAULT_PICKS_PER_PLAYER));
  assert.equal(roundCountFor(3), 5);
});

test('roundCountFor: a bad picks value falls back rather than throwing', () => {
  assert.equal(roundCountFor(3, 99), 5);
  assert.equal(roundCountFor(3, 0), 5);
  assert.equal(roundCountFor(3, NaN), 5);
});

test('roundCountFor: junk seat count coerces to the two bookends alone', () => {
  // Unreachable in play (`canStart` needs a seat); this is the input guard.
  assert.equal(roundCountFor(0, 2), 2);
  assert.equal(roundCountFor(-5, 2), 2);
  assert.equal(roundCountFor(NaN, 2), 2);
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

// ---- the Decider ----

test('deciderPickerFor: last place picks, whatever their pick history', () => {
  // The rotation's "hasn't picked yet" clause is deliberately ignored here: the
  // Decider is outside the rotation, so it reads the board and nothing else.
  assert.equal(deciderPickerFor(board('ola', 'jan', 'marek', 'zosia')), 'zosia');
  assert.equal(deciderPickerFor(board('a', 'b')), 'b');
  assert.equal(deciderPickerFor(board('solo')), 'solo');
  assert.equal(deciderPickerFor([]), null);
  assert.equal(deciderPickerFor(/** @type {any} */ (null)), null);
});

test('deciderPickerFor: the leader never picks the Decider, where pickerFor would hand it to them', () => {
  // The finding this phase exists for. Every seat has picked once, so the
  // rotation wraps and hands the decisive round to whoever the tie-break favours
  // — the leader, who lost that tie-break every round and sits last in line.
  const seats = board('leader', 'second', 'last');
  assert.equal(pickerFor(seats, ['last', 'second', 'leader']), 'last');
  assert.equal(deciderPickerFor(seats), 'last');
  // ...and where the histories diverge, the Decider still ignores them.
  assert.equal(pickerFor(seats, ['last', 'last', 'second']), 'leader');
  assert.equal(deciderPickerFor(seats), 'last');
});

test('eligiblePickers: absent seats drop out, order and scores untouched', () => {
  const full = board('leader', 'middle', 'gone', 'last');
  assert.deepEqual(
    eligiblePickers(full, new Set(['leader', 'middle', 'last'])).map((e) => e.playerId),
    ['leader', 'middle', 'last'],
  );
  // An iterable, not only a Set — the room stores presence as a Set but callers
  // shouldn't have to care.
  assert.deepEqual(eligiblePickers(full, ['gone']).map((e) => e.playerId), ['gone']);
  assert.deepEqual(eligiblePickers(full, []), []);
  assert.deepEqual(eligiblePickers(/** @type {any} */ (null), ['a']), []);
});

test('eligiblePickers: the seat that left stops being the one both rules aim at', () => {
  // The reason this filter exists. A player who quits stops scoring, so they sink
  // to the bottom of the board — exactly where both picker rules look. Without
  // the filter the room hands the turn (and, for the Decider, the round that
  // decides the game) to whoever is most likely to have just walked away.
  const afterQuit = board('leader', 'still-here', 'quitter');
  assert.equal(deciderPickerFor(afterQuit), 'quitter', 'unfiltered, the leaver is chosen');
  assert.equal(pickerFor(afterQuit, []), 'quitter', 'by both rules');

  const here = eligiblePickers(afterQuit, new Set(['leader', 'still-here']));
  assert.equal(deciderPickerFor(here), 'still-here');
  assert.equal(pickerFor(here, []), 'still-here');
});

test('isDeciderPick: true only at the boundary into the game\'s last round', () => {
  // A 4-round draft: 20 questions, boundaries after questions 4, 9 and 14.
  const total = 4 * 5;
  assert.equal(isDeciderPick(4, total), false, 'boundary into round 2');
  assert.equal(isDeciderPick(9, total), false, 'boundary into round 3');
  assert.equal(isDeciderPick(14, total), true, 'boundary into round 4 — the Decider');
});

test('isDeciderPick: the round it opens is exactly the round that pays double', () => {
  // The claim worth pinning is NOT `isDeciderPick(i, t) === isFinalRound(i + 1, t)`
  // — that is this function's own body restated, so it catches drift but cannot
  // catch a wrong shared premise. What actually has to hold is a statement about
  // two different questions: the round a Decider pick OPENS is the round the
  // multiplier later doubles, and the multiplier asks `isFinalRound` about the
  // round's own questions, never about the boundary that opened it. If those ever
  // part company, a player is promised double points on a round that pays single.
  for (const rounds of [2, 3, 5, 8]) {
    const total = rounds * ROUND_QUESTIONS;
    let deciderPicks = 0;
    // Every round boundary: the last question of a round with another to follow.
    for (let i = ROUND_QUESTIONS - 1; i < total - 1; i += ROUND_QUESTIONS) {
      /** The questions of the round this pick opens. */
      const opened = [];
      for (let q = i + 1; q < Math.min(i + 1 + ROUND_QUESTIONS, total); q++) opened.push(q);
      const paysDouble = opened.map((q) => isFinalRound(q, total));
      if (isDeciderPick(i, total)) {
        deciderPicks += 1;
        assert.ok(paysDouble.every(Boolean), `the pick at q${i} of ${rounds} rounds opens a round that pays double`);
      } else {
        assert.ok(paysDouble.every((d) => !d), `the pick at q${i} of ${rounds} rounds opens a round that pays single`);
      }
    }
    assert.equal(deciderPicks, 1, `${rounds} rounds: exactly one closing act, never zero or two`);
  }
});

test('deciderPickerFor: a tie for last goes to the last-joined tied seat', () => {
  // The board arrives sorted by score descending with a STABLE sort over
  // insertion-ordered seats (`scoreboardOf`), so seats level on points keep join
  // order and the bottom row is the last of them to have joined. That is the rule
  // — deterministic, and it survives an eviction or a reconnect because
  // `Map.set` on an existing key keeps its position — but nothing stated it, so
  // it was one refactor away from silently changing. Now it is stated.
  //
  // If this test ever fails, the question is not "fix the assertion" but "did the
  // ordering guarantee break", because every client and the server must agree on
  // who picks the round that decides the game.
  const tiedAtBottom = [
    { playerId: 'leader' },   // 30
    { playerId: 'early' },    // 10, joined first
    { playerId: 'late' },     // 10, joined second
  ];
  assert.equal(deciderPickerFor(tiedAtBottom), 'late');

  // The degenerate case: everyone level, so the whole board is one tie.
  assert.equal(deciderPickerFor([{ playerId: 'a' }, { playerId: 'b' }, { playerId: 'c' }]), 'c');
});

test('isDeciderPick: the shortest real draft still has one', () => {
  // Solo, one pick: opener + the seat's pick + the Decider.
  const total = roundCountFor(1, 1) * 5;
  assert.equal(total, 15);
  assert.equal(isDeciderPick(4, total), false);
  assert.equal(isDeciderPick(9, total), true);
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
