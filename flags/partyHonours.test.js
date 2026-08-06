import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeHonours, winnerIdsOf, THOUGHTFUL_ACCURACY_FLOOR } from './partyHonours.js';

/** A seat's records, with sensible defaults so each test states only what it
 *  is about. `mean` is the mean latency in ms; the store keeps a total.
 *  @param {{ buzzes?: number, mean?: number, correct?: number, timed?: number | null }} [opts]
 *  @returns {import('./partyHonours.js').SeatStat} */
function seat(opts = {}) {
  const { buzzes = 10, mean = 5000, correct = 5, timed = null } = opts;
  const t = timed === null ? buzzes : timed;
  return { buzzes, timed: t, latencyMs: mean * t, correct };
}

/** @param {Record<string, import('./partyHonours.js').SeatStat>} seats
 *  @param {Array<{ modeId: string | null, gains: Record<string, number> }>} [rounds]
 *  @returns {import('./partyHonours.js').HonourStats} */
function stats(seats, rounds = []) {
  return { seats, rounds };
}

/** @param {import('./partyHonours.js').Honour[]} h */
const ids = (h) => h.map((x) => x.id);
/** @param {import('./partyHonours.js').Honour[]} h @returns {Record<string, string>} */
const who = (h) => Object.fromEntries(h.map((x) => [x.id, x.playerId]));

test('honours go to seats that did not win', () => {
  // The winner's mark is the crown, awarded on its own screen. A winner who also
  // collected "fastest hand" would make the honours read as a restatement of the
  // leaderboard, which is the failure this whole assignment step exists to avoid.
  const s = stats({
    win: seat({ mean: 900, correct: 10 }),
    a: seat({ mean: 3000, correct: 8 }),
    b: seat({ mean: 9000, correct: 9 }),
  }, [{ modeId: 'flags-all', gains: { win: 40, a: 20, b: 30 } }]);
  const out = computeHonours(s, ['win'], ['win', 'a', 'b']);
  assert.ok(out.length > 0);
  for (const h of out) assert.notEqual(h.playerId, 'win', `${h.id} was given to the winner`);
});

test('no seat is honoured twice — the title falls through to the next candidate', () => {
  // One player who is fastest AND had the best round AND is accurate would sweep
  // all three by absolute value. Three mentions of one person is not a ceremony.
  const s = stats({
    win: seat({ mean: 8000, correct: 2 }),
    star: seat({ mean: 500, correct: 10 }),
    a: seat({ mean: 4000, correct: 7 }),
    b: seat({ mean: 12000, correct: 8 }),
  }, [{ modeId: 'flags-all', gains: { star: 60, a: 20, b: 25 } }]);
  const out = computeHonours(s, ['win'], ['win', 'star', 'a', 'b']);
  const holders = out.map((h) => h.playerId);
  assert.equal(new Set(holders).size, holders.length, `a seat was honoured twice: ${holders.join(',')}`);
});

test('fastest hand ignores correctness entirely', () => {
  // Nerve, not accuracy, and no floor: a player who mashes to win it pays for it
  // in last place, and that is the joke. An accuracy filter here would quietly
  // turn it into a second "best player" award.
  const s = stats({
    win: seat({ mean: 6000, correct: 10 }),
    masher: seat({ buzzes: 10, mean: 400, correct: 0 }),
    careful: seat({ buzzes: 10, mean: 7000, correct: 9 }),
  }, [{ modeId: 'flags-all', gains: { win: 50, careful: 30 } }]);
  const out = computeHonours(s, ['win'], ['win', 'masher', 'careful']);
  assert.equal(who(out).fastest, 'masher', 'the fastest hand is the fastest hand, right or wrong');
});

test('thoughtful answers needs the accuracy floor', () => {
  // "Last click, 2 of 10 right" reads as a consolation prize for being slow AND
  // wrong, which is worse than saying nothing. Slow and often-right is the claim.
  const slowAndWrong = stats({
    win: seat({ mean: 1000, correct: 10 }),
    fast: seat({ mean: 1200, correct: 6 }),
    slow: seat({ buzzes: 10, mean: 15000, correct: 2 }),
  }, [{ modeId: 'flags-all', gains: { win: 50, fast: 20, slow: 5 } }]);
  assert.ok(!ids(computeHonours(slowAndWrong, ['win'], ['win', 'fast', 'slow'])).includes('thoughtful'));

  const slowAndRight = stats({
    win: seat({ mean: 1000, correct: 10 }),
    fast: seat({ mean: 1200, correct: 6 }),
    slow: seat({ buzzes: 10, mean: 15000, correct: 8 }),
  }, [{ modeId: 'flags-all', gains: { win: 50, fast: 20, slow: 5 } }]);
  const out = computeHonours(slowAndRight, ['win'], ['win', 'fast', 'slow']);
  assert.equal(who(out).thoughtful, 'slow');
});

test('the accuracy floor is a share of a seat’s own answers, not a raw count', () => {
  // A seat that answered three questions and got two right is 67% and qualifies;
  // one that answered twenty and got nine is 45% and does not. A raw count would
  // reward volume, which the honour is not about.
  const few = stats({
    win: seat({ mean: 800, correct: 10 }),
    a: seat({ mean: 1000, correct: 3 }),
    slow: seat({ buzzes: 3, mean: 14000, correct: 2 }),
  }, [{ modeId: 'flags-all', gains: { win: 40, a: 10, slow: 5 } }]);
  const out = computeHonours(few, ['win'], ['win', 'a', 'slow']);
  assert.equal(who(out).thoughtful, 'slow');
  assert.ok(2 / 3 >= THOUGHTFUL_ACCURACY_FLOOR, 'sanity: the fixture really is above the floor');
});

test('best round names the round it was won in, and its mode', () => {
  // "Best in Flags" is what makes the title say something the leaderboard does
  // not. Without the mode it is just a second score.
  const s = stats({
    win: seat({ mean: 900, correct: 10 }),
    a: seat({ mean: 4000, correct: 6 }),
    b: seat({ mean: 1200, correct: 6 }),
    c: seat({ buzzes: 10, mean: 13000, correct: 9 }),
  }, [
    { modeId: 'flags-all', gains: { win: 20, a: 5, b: 6, c: 4 } },
    { modeId: 'superlative-area', gains: { win: 10, a: 33, b: 7, c: 5 } },
  ]);
  const out = computeHonours(s, ['win'], ['win', 'a', 'b', 'c']);
  const best = out.find((h) => h.id === 'bestRound');
  assert.ok(best, 'expected a best-round honour');
  assert.equal(best.playerId, 'a');
  assert.equal(best.value, 33, 'the seat’s single best ROUND, not their total');
  assert.equal(best.round, 1);
  assert.equal(best.modeId, 'superlative-area');
});

test('a duel cycles one honour and solo cycles none', () => {
  // The ceremony degrades to however many honours have a real non-winner behind
  // them. In a duel the only seat that can hold one is the player who lost.
  const duel = stats({
    win: seat({ mean: 900, correct: 9 }),
    loser: seat({ mean: 4000, correct: 6 }),
  }, [{ modeId: 'flags-all', gains: { win: 40, loser: 20 } }]);
  assert.equal(computeHonours(duel, ['win'], ['win', 'loser']).length, 1);

  const solo = stats({ me: seat({ mean: 1000, correct: 9 }) }, [{ modeId: 'flags-all', gains: { me: 40 } }]);
  assert.deepEqual(computeHonours(solo, ['me'], ['me']), []);
});

test('a tie at the top excludes every tied leader', () => {
  // None of them is the loser a title would be consoling, and honouring one of
  // two joint winners would look like the board picking a favourite.
  const s = stats({
    a: seat({ mean: 900, correct: 9 }),
    b: seat({ mean: 1100, correct: 9 }),
    c: seat({ mean: 6000, correct: 7 }),
  }, [{ modeId: 'flags-all', gains: { a: 40, b: 40, c: 20 } }]);
  const out = computeHonours(s, ['a', 'b'], ['a', 'b', 'c']);
  for (const h of out) assert.equal(h.playerId, 'c');
});

test('titles are assigned by distinctiveness, not by absolute value', () => {
  // `alsoQuick` is fastest in absolute terms by a hair, but `dominant` owns the
  // best-round category by a mile. Assigning fastest first by list order would
  // take `alsoQuick` out of the pool for no gain; assigning the clearest claim
  // first gives each title to the seat that actually owns it.
  const s = stats({
    win: seat({ mean: 700, correct: 10 }),
    alsoQuick: seat({ mean: 1000, correct: 5 }),
    dominant: seat({ mean: 1010, correct: 5 }),
    plodder: seat({ mean: 9000, correct: 8 }),
  }, [
    { modeId: 'flags-all', gains: { win: 50, alsoQuick: 10, dominant: 55, plodder: 12 } },
  ]);
  const out = computeHonours(s, ['win'], ['win', 'alsoQuick', 'dominant', 'plodder']);
  const m = who(out);
  assert.equal(m.bestRound, 'dominant', 'the runaway round win is the clearest claim');
  assert.equal(m.fastest, 'alsoQuick', 'and the fastest title still finds its owner');
});

test('a seat that never buzzed wins nothing', () => {
  // A title won by not playing is a bug. Reachable for real: someone who joins
  // and then leaves their phone on the table keeps a seat and a zero.
  const s = stats({
    win: seat({ mean: 900, correct: 9 }),
    ghost: { buzzes: 0, timed: 0, latencyMs: 0, correct: 0 },
  }, [{ modeId: 'flags-all', gains: { win: 40 } }]);
  assert.deepEqual(computeHonours(s, ['win'], ['win', 'ghost']), []);
});

test('a stats record for a seat that is no longer in the room wins nothing', () => {
  // The records outlive a seat (they are additive and never pruned), so the
  // seat list is the authority on who can be named at all.
  const s = stats({
    win: seat({ mean: 900, correct: 9 }),
    gone: seat({ mean: 300, correct: 9 }),
  }, [{ modeId: 'flags-all', gains: { win: 40, gone: 30 } }]);
  assert.deepEqual(computeHonours(s, ['win'], ['win']), []);
});

test('an untimed seat is left out of the average rather than counted as instant', () => {
  // A durable-object eviction loses a question's deal time. Counting those buzzes
  // as 0 ms would hand the fastest hand to whoever happened to be playing when
  // the room got evicted.
  const s = stats({
    win: seat({ mean: 900, correct: 9 }),
    quick: seat({ buzzes: 10, timed: 10, mean: 1500, correct: 5 }),
    unknown: { buzzes: 10, timed: 0, latencyMs: 0, correct: 5 },
  }, [{ modeId: 'flags-all', gains: { win: 40, quick: 20, unknown: 20 } }]);
  const out = computeHonours(s, ['win'], ['win', 'quick', 'unknown']);
  assert.equal(who(out).fastest, 'quick');
});

test('honours always come back in presentation order', () => {
  // Assignment order is "most distinctive first"; the SHOW always runs fastest →
  // best round → thoughtful, so replaying a game is the same ceremony.
  const s = stats({
    win: seat({ mean: 600, correct: 10 }),
    a: seat({ mean: 1000, correct: 5 }),
    b: seat({ mean: 4000, correct: 5 }),
    c: seat({ buzzes: 10, mean: 14000, correct: 9 }),
  }, [{ modeId: 'flags-all', gains: { win: 60, a: 10, b: 44, c: 12 } }]);
  const SHOW = ['fastest', 'bestRound', 'thoughtful'];
  const order = ids(computeHonours(s, ['win'], ['win', 'a', 'b', 'c']));
  assert.deepEqual(order, order.slice().sort(
    (/** @type {string} */ x, /** @type {string} */ y) => SHOW.indexOf(x) - SHOW.indexOf(y),
  ));
});

test('missing or empty records produce no honours rather than throwing', () => {
  // A game finished on a room restored from a snapshot written before the
  // ceremony existed has nothing recorded. It must still finish.
  assert.deepEqual(computeHonours(null, [], []), []);
  assert.deepEqual(computeHonours(undefined, ['a'], ['a']), []);
  assert.deepEqual(computeHonours({ seats: {}, rounds: [] }, [], ['a']), []);
});

// ---- winnerIdsOf ----

test('winnerIdsOf: the top scorer, or everyone tied at the top', () => {
  assert.deepEqual(winnerIdsOf([{ playerId: 'a', score: 9 }, { playerId: 'b', score: 4 }]), ['a']);
  assert.deepEqual(
    winnerIdsOf([{ playerId: 'a', score: 9 }, { playerId: 'b', score: 9 }, { playerId: 'c', score: 1 }]),
    ['a', 'b'],
  );
});

test('winnerIdsOf: a board nobody scored on has no winner', () => {
  // Crowning a 0 is worse than crowning nobody — and it would also empty the
  // honours pool of the one seat most likely to hold one.
  assert.deepEqual(winnerIdsOf([{ playerId: 'a', score: 0 }, { playerId: 'b', score: 0 }]), []);
  assert.deepEqual(winnerIdsOf([]), []);
  assert.deepEqual(winnerIdsOf(null), []);
});
