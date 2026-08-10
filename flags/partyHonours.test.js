import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeHonours,
  honourPlan,
  isPartyTitle,
  soleWinnerId,
  titlelessModes,
  PARTY_TITLES,
  TITLES,
  THINKER_ACCURACY_FLOOR,
  SLEEPER_MIN_UNANSWERED,
} from './partyHonours.js';

/** A seat's records, with defaults so each test states only what it is about.
 *  `mean` is the mean latency in ms; the store keeps a total.
 *  @param {{ buzzes?: number, mean?: number, correct?: number, timed?: number | null, unanswered?: number }} [opts]
 *  @returns {import('./partyHonours.js').SeatStat} */
function seat(opts = {}) {
  const { buzzes = 10, mean = 5000, correct = 8, timed = null, unanswered = 0 } = opts;
  const t = timed === null ? buzzes : timed;
  return { buzzes, timed: t, latencyMs: mean * t, correct, unanswered };
}

/** @param {Record<string, import('./partyHonours.js').SeatStat>} seats
 *  @param {Record<string, import('./partyHonours.js').ModeStat>} [modes]
 *  @returns {import('./partyHonours.js').HonourStats} */
function stats(seats, modes = {}) {
  return { seats, modes };
}

/** A mode's records. @param {Record<string, number>} gains
 *  @param {{ asked?: number, correct?: Record<string, number> }} [opts]
 *  @returns {import('./partyHonours.js').ModeStat} */
function mode(gains, opts = {}) {
  return { asked: opts.asked ?? 5, gains, correct: opts.correct ?? {} };
}

/** A scoreboard, score-descending. @param {Array<[string, number]>} rows */
function board(rows) {
  return rows.map(([playerId, score]) => ({ playerId, nickname: playerId, score }));
}

const ids = (/** @type {any[]} */ h) => h.map((x) => x.id);
const holders = (/** @type {any[]} */ h) => h.map((x) => x.playerId);

// ---- how many, and where ----

test('honourPlan: titles and screens are two different numbers', () => {
  // The split is the whole point: it lets a full room hand out seven trophies
  // without a seven-screen ceremony nobody sits through.
  assert.deepEqual(honourPlan(2), { titles: 3, screens: 2 });
  assert.deepEqual(honourPlan(3), { titles: 4, screens: 3 });
  assert.deepEqual(honourPlan(4), { titles: 5, screens: 3 });
  assert.deepEqual(honourPlan(6), { titles: 5, screens: 3 });
  assert.deepEqual(honourPlan(7), { titles: 7, screens: 3 });
  assert.deepEqual(honourPlan(20), { titles: 7, screens: 3 });
});

test('honourPlan: never more than three screens, at any roster', () => {
  // Each screen is a 2 s beat the whole room waits through. Past three the
  // ceremony stops being a ceremony.
  for (const n of [2, 3, 4, 5, 6, 7, 12, 20]) {
    assert.ok(honourPlan(n).screens <= 3, `${n} seats asked for ${honourPlan(n).screens} screens`);
  }
});

test('honourPlan: seven is the ceiling because the strip cycles at 3 s', () => {
  // Seven titles is 21 s for one full pass, already longer than anyone looks at
  // a board. A cap that grows with the roster would make the strip unreadable
  // exactly when it matters most.
  for (const n of [7, 8, 12, 20]) assert.equal(honourPlan(n).titles, 7);
});

test('honourPlan: a solo game has no ceremony to hold', () => {
  assert.deepEqual(honourPlan(1), { titles: 0, screens: 0 });
  assert.deepEqual(honourPlan(0), { titles: 0, screens: 0 });
});

// ---- the catalog ----

test('every mode the game can deal has a title', () => {
  // A mode with no title is a round that is played and that nobody can be
  // honoured for — legal, but silent. Adding a mode without adding its title
  // should fail here rather than quietly making that round unhonourable.
  assert.deepEqual(titlelessModes(), []);
});

test('every title carries a glyph', () => {
  // The glyph is part of the title: it is what makes one recognisable from
  // across a table before the label has been read.
  for (const [id, t] of Object.entries(TITLES)) {
    assert.ok(t.glyph && t.glyph.length > 0, `${id} has no glyph`);
  }
});

// ---- the caps ----

test('the winner may hold one title, never two', () => {
  // Not excluded — capped. Winning everything was the problem; winning
  // something never was.
  const s = stats({
    win: seat({ mean: 400, correct: 10 }),
    a: seat({ mean: 5000, correct: 8 }),
    b: seat({ mean: 9000, correct: 9 }),
  }, {
    'flags-all': mode({ win: 40, a: 5, b: 4 }),
    'map-outlines': mode({ win: 38, a: 6, b: 3 }),
    'superlative-gdp': mode({ win: 30, a: 2, b: 1 }, { correct: { win: 5 } }),
  });
  const out = computeHonours(s, board([['win', 90], ['a', 20], ['b', 10]]));
  assert.equal(holders(out).filter((p) => p === 'win').length, 1,
    `the winner took ${holders(out).filter((p) => p === 'win').length} titles`);
});

test('nobody takes a second title until every seat holds one', () => {
  // A room's trophies spread before they stack. Otherwise two strong players
  // take everything and the rest watch a ceremony about other people.
  const s = stats({
    a: seat({ mean: 400, correct: 10 }),
    b: seat({ mean: 4000, correct: 9 }),
    c: seat({ mean: 9000, correct: 9 }),
  }, {
    'flags-all': mode({ a: 40, b: 20, c: 5 }),
    'map-outlines': mode({ a: 35, b: 18, c: 4 }),
    'spot-flag': mode({ a: 33, b: 16, c: 3 }),
  });
  const out = computeHonours(s, board([['a', 60], ['b', 40], ['c', 20]]));
  const counts = new Map();
  for (const p of holders(out)) counts.set(p, (counts.get(p) ?? 0) + 1);
  const min = Math.min(...[...counts.values()]);
  const max = Math.max(...[...counts.values()]);
  assert.ok(max - min <= 1, `trophies stacked before they spread: ${JSON.stringify([...counts])}`);
});

test('no title is awarded twice', () => {
  const s = stats({
    a: seat({ mean: 400 }), b: seat({ mean: 4000 }), c: seat({ mean: 9000 }), d: seat({ mean: 6000 }),
  }, {
    'flags-all': mode({ a: 40, b: 20 }),
    'map-outlines': mode({ b: 35, c: 18 }),
    'spot-flag': mode({ c: 33, d: 16 }),
  });
  const out = computeHonours(s, board([['a', 60], ['b', 50], ['c', 40], ['d', 30]]));
  assert.equal(new Set(ids(out)).size, out.length, `a title repeated: ${ids(out).join(', ')}`);
});

// ---- the floors ----

test('fastest finger counts every answer, wrong ones included', () => {
  // Nerve, not accuracy. A player who mashes to win it pays for it in last
  // place, and that is the joke — an accuracy filter would quietly turn it into
  // a second "best player" award.
  const s = stats({
    win: seat({ mean: 6000, correct: 10 }),
    masher: seat({ buzzes: 10, mean: 400, correct: 0 }),
    careful: seat({ buzzes: 10, mean: 7000, correct: 9 }),
  }, { 'flags-all': mode({ win: 50, careful: 30 }) });
  const out = computeHonours(s, board([['win', 50], ['careful', 30], ['masher', 0]]));
  const fastest = out.find((h) => h.id === 'fastestFinger');
  assert.ok(fastest, 'expected a fastest-finger title');
  assert.equal(fastest.playerId, 'masher', 'the fastest finger is the fastest finger, right or wrong');
});

test('the thinker floor is 60%, not a coin flip', () => {
  // The title makes a claim about the QUALITY of the answers, so awarding it to
  // someone slow and wrong reads as sarcasm aimed at a player who just lost.
  const belowFloor = stats({
    a: seat({ mean: 1000, correct: 9 }),
    slow: seat({ buzzes: 10, mean: 15000, correct: 5 }),
  }, { 'flags-all': mode({ a: 40, slow: 10 }) });
  assert.ok(!ids(computeHonours(belowFloor, board([['a', 40], ['slow', 10]]))).includes('thinker'),
    '5 of 10 is a coin flip, not thought');

  const clearsFloor = stats({
    a: seat({ mean: 1000, correct: 9 }),
    slow: seat({ buzzes: 10, mean: 15000, correct: 6 }),
  }, { 'flags-all': mode({ a: 40, slow: 10 }) });
  const out = computeHonours(clearsFloor, board([['a', 40], ['slow', 10]]));
  const thinker = out.find((h) => h.id === 'thinker');
  assert.ok(thinker, '6 of 10 clears the floor');
  assert.equal(thinker.playerId, 'slow');
  assert.equal(0.6, THINKER_ACCURACY_FLOOR, 'sanity: the fixtures straddle the real floor');
});

test('the sleeper is one question let go by, not a spell of them', () => {
  // One is the floor: a question that went by with nobody's finger on it is a
  // true thing to say about a seat, and it is the rung that keeps the party
  // titles where they belong — under everything the game can actually evidence.
  assert.equal(SLEEPER_MIN_UNANSWERED, 1, 'sanity: the floor this test is about');
  const one = stats({
    a: seat({ mean: 900 }),
    dozy: seat({ buzzes: 9, mean: 4000, correct: 1, unanswered: 1 }),
  }, { 'flags-all': mode({ a: 40 }) });
  const out = computeHonours(one, board([['a', 40], ['dozy', 5]]));
  const sleeper = out.find((h) => h.id === 'sleeper');
  assert.ok(sleeper, `expected the sleeper title, got ${ids(out).join(', ')}`);
  assert.equal(sleeper.playerId, 'dozy');
  assert.equal(sleeper.unanswered, 1);
});

test('a seat that answered every question is no sleeper', () => {
  const s = stats({
    a: seat({ mean: 900 }),
    keen: seat({ buzzes: 10, mean: 4000, correct: 1, unanswered: 0 }),
  }, { 'flags-all': mode({ a: 40 }) });
  assert.ok(!ids(computeHonours(s, board([['a', 40], ['keen', 5]]))).includes('sleeper'));
});

// ---- what each title reports ----

test('a picture-mode title reports points; a statistics title reports answers', () => {
  // A picture round is scored as a block, so "+29 in the Flags round" is the
  // fact. A statistics category is a handful of questions you either knew or
  // did not, so "4 of 4 GDP questions" is.
  // Three seats, and the two mode titles belong to two DIFFERENT non-winners —
  // otherwise the winner's one-title cap correctly withholds the second, which
  // is a rule of its own and not what this test is about.
  const s = stats({
    win: seat({ mean: 900 }), b: seat({ mean: 4000 }), c: seat({ mean: 5000 }),
  }, {
    'flags-all': mode({ b: 29, win: 4, c: 2 }),
    'superlative-gdp': mode({ c: 20, win: 1, b: 0 }, { asked: 4, correct: { c: 4 } }),
  });
  const out = computeHonours(s, board([['win', 60], ['b', 40], ['c', 30]]));
  const flags = out.find((h) => h.id === 'flagSommelier');
  const gdp = out.find((h) => h.id === 'economist');
  assert.ok(flags && gdp, `expected both mode titles, got ${ids(out).join(', ')}`);
  assert.equal(flags.gain, 29);
  assert.equal(flags.correct, undefined, 'a picture round reports points, not answers');
  assert.equal(gdp.correct, 4);
  assert.equal(gdp.total, 4);
  assert.equal(gdp.gain, undefined, 'a statistics category reports answers, not points');
});

test('a mode nobody scored in produces no title', () => {
  // There is no "best at this" to be, so inventing one would be padding.
  const s = stats({ a: seat({ mean: 900 }), b: seat({ mean: 4000 }) },
    { 'flags-all': mode({}) });
  assert.ok(!ids(computeHonours(s, board([['a', 0], ['b', 0]]))).includes('flagSommelier'));
});

test('a mode the game never played produces no title', () => {
  const s = stats({ a: seat({ mean: 900 }), b: seat({ mean: 4000 }) },
    { 'flags-all': mode({ a: 20 }) });
  const out = computeHonours(s, board([['a', 20], ['b', 5]]));
  assert.ok(!ids(out).includes('cartographer'), 'no maps round was played');
});

// ---- the small-room guarantee ----

test('at three seats, no non-winner leaves empty-handed', () => {
  // Two strong players would otherwise take every honour and the third watches a
  // ceremony about other people — the exact failure the honours exist to prevent.
  const s = stats({
    win: seat({ mean: 400, correct: 10 }),
    good: seat({ mean: 1000, correct: 9 }),
    quiet: seat({ buzzes: 6, mean: 5000, correct: 2, unanswered: 4 }),
  }, {
    'flags-all': mode({ win: 40, good: 20, quiet: 2 }),
    'map-outlines': mode({ good: 30, win: 10, quiet: 1 }),
  });
  const out = computeHonours(s, board([['win', 60], ['good', 55], ['quiet', 5]]));
  assert.ok(holders(out).includes('quiet'),
    `the third seat left with nothing: ${out.map((h) => h.id + '->' + h.playerId).join(', ')}`);
});

test('above three non-winners the guarantee lapses', () => {
  // Twelve titles means twelve meaningless ones, and the strip cannot cycle more
  // than a few before the room stops reading it.
  /** @type {Record<string, import('./partyHonours.js').SeatStat>} */
  const seats = {};
  /** @type {Array<[string, number]>} */
  const rows = [];
  for (let i = 0; i < 9; i += 1) {
    seats['p' + i] = seat({ mean: 1000 + i * 100, correct: 8, buzzes: 10 });
    rows.push(['p' + i, 90 - i * 10]);
  }
  const out = computeHonours(stats(seats, { 'flags-all': mode({ p0: 40, p1: 20 }) }), board(rows));
  assert.ok(out.length <= honourPlan(9).titles);
  assert.ok(new Set(holders(out)).size < 9, 'not every seat is honoured at nine players');
});

// ---- the party titles: the bottom of the tail ----

/** A game whose third seat has nothing the game can evidence: never the fastest,
 *  too wrong to be the thinker, best at no round, and awake through all of it.
 *  `nudgeMs` moves the second seat's pace, which is a different GAME on the same
 *  shape — the draw reads the room's own record, so nudging it re-draws.
 *  @param {number} [nudgeMs] */
function nothingTrueGame(nudgeMs = 0) {
  return stats({
    win: seat({ mean: 400, correct: 10 }),
    good: seat({ mean: 1000 + nudgeMs, correct: 9 }),
    also: seat({ buzzes: 10, mean: 3000, correct: 2, unanswered: 0 }),
  }, {
    'flags-all': mode({ win: 40, good: 20, also: 2 }),
    'map-outlines': mode({ good: 30, win: 10, also: 1 }),
  });
}
const NOTHING_TRUE = board([['win', 60], ['good', 55], ['also', 20]]);

test('the party titles are drawn, never earned', () => {
  assert.ok(PARTY_TITLES.length >= 2, 'a draw needs something to draw from');
  for (const id of PARTY_TITLES) {
    assert.ok(isPartyTitle(id), `${id} is in the list but not marked`);
    assert.equal(TITLES[id].mode, undefined, `${id} must not be earnable by playing a mode`);
  }
  assert.ok(!isPartyTitle('sleeper'), 'the sleeper is a true thing, and the rung above');
  assert.ok(!isPartyTitle('fastestFinger'));
  assert.ok(!isPartyTitle('bartender'), 'the alcohol round title is earned, not drawn');
});

test('when the game has nothing to say about a seat, it draws a party title', () => {
  // Praktykant told a player, on a screen, in front of the room, that they were
  // the best at nothing — the one thing that reads as a pity prize. A party title
  // is a joke about the room instead, and makes no claim about their play at all.
  const out = computeHonours(nothingTrueGame(), NOTHING_TRUE);
  const mine = out.filter((h) => h.playerId === 'also');
  assert.equal(mine.length, 1, `expected one title for the third seat, got ${ids(mine).join(', ')}`);
  assert.ok(PARTY_TITLES.includes(mine[0].id), `expected a party title, got ${mine[0].id}`);
  assert.ok(!ids(out).includes('intern'), 'Praktykant is gone');
});

test('the sleeper outranks the draw: a seat that slept is named for what it did', () => {
  // The draw is the LAST resort. Anything true, however small, is better than a
  // joke — so one unanswered question is enough to keep the quiz title.
  const slept = stats({
    win: seat({ mean: 400, correct: 10 }),
    good: seat({ mean: 1000, correct: 9 }),
    also: seat({ buzzes: 9, mean: 3000, correct: 2, unanswered: 1 }),
  }, {
    'flags-all': mode({ win: 40, good: 20, also: 2 }),
    'map-outlines': mode({ good: 30, win: 10, also: 1 }),
  });
  const mine = computeHonours(slept, NOTHING_TRUE).filter((h) => h.playerId === 'also');
  assert.deepEqual(ids(mine), ['sleeper'], 'a sleeper must not be handed a drawn title');
});

test('the draw happens once per game, not once per render', () => {
  // The finish is computed more than once for the same game: the `final`
  // broadcast, and again for every seat that reconnects onto the board
  // (`honoursFor` in flags/partyRoom.js). A title that moved between those two
  // would be a different joke on two phones in the same room.
  const s = nothingTrueGame();
  const first = computeHonours(s, NOTHING_TRUE).find((h) => h.playerId === 'also');
  const again = computeHonours(s, NOTHING_TRUE).find((h) => h.playerId === 'also');
  assert.ok(first && again);
  assert.equal(first.id, again.id);
  assert.equal(first.glyph, again.glyph);
});

test('the draw is not the same title in every game', () => {
  // Fixed per game — but a title fixed across ALL games is not a draw at all, and
  // the room would watch the same joke every night.
  const seen = new Set();
  for (let i = 0; i < 24; i += 1) {
    const out = computeHonours(nothingTrueGame(i * 37), NOTHING_TRUE);
    const mine = out.find((h) => h.playerId === 'also');
    if (mine) seen.add(mine.id);
  }
  assert.ok(seen.size > 1, `the draw never moved: ${[...seen].join(', ')}`);
});

test('a party title never reaches a room the guarantee has lapsed in', () => {
  // They are a floor under a small room, not titles to compete for. At nine seats
  // there is no guarantee, so there is no route to one.
  /** @type {Record<string, import('./partyHonours.js').SeatStat>} */
  const seats = {};
  /** @type {Array<[string, number]>} */
  const rows = [];
  for (let i = 0; i < 9; i += 1) {
    seats['p' + i] = seat({ mean: 1000 + i * 100, correct: 8, buzzes: 10 });
    rows.push(['p' + i, 90 - i * 10]);
  }
  const out = computeHonours(stats(seats, { 'flags-all': mode({ p0: 40, p1: 20 }) }), board(rows));
  assert.deepEqual(ids(out).filter((id) => PARTY_TITLES.includes(id)), []);
});

test('a drawn title carries no evidence to report', () => {
  // Nothing was measured, so there is no number to put next to it. Inventing one
  // would turn the joke back into the verdict the draw exists to avoid.
  const mine = computeHonours(nothingTrueGame(), NOTHING_TRUE).find((h) => h.playerId === 'also');
  assert.ok(mine);
  const reported = /** @type {const} */ (['meanMs', 'correct', 'total', 'unanswered', 'gain', 'modeId']);
  for (const field of reported) {
    assert.equal(mine[field], undefined, `a party title must not report ${field}`);
  }
});

// ---- screens ----

test('only the planned number of titles gets a screen, and they build weakest-first', () => {
  // The ceremony must build toward the winner rather than peak on its first beat.
  const s = stats({
    a: seat({ mean: 400 }), b: seat({ mean: 3000 }), c: seat({ mean: 9000, correct: 9 }), d: seat({ mean: 6000 }),
  }, {
    'flags-all': mode({ a: 40, b: 2 }),
    'map-outlines': mode({ b: 35, c: 2 }),
    'spot-flag': mode({ d: 33, a: 2 }),
    'superlative-gdp': mode({ c: 30 }, { correct: { c: 4 } }),
  });
  const out = computeHonours(s, board([['a', 60], ['b', 50], ['c', 40], ['d', 30]]));
  const screened = out.filter((h) => h.screened);
  assert.equal(screened.length, honourPlan(4).screens);
  // Screened titles lead the returned list, so the page can take the first N.
  assert.deepEqual(out.slice(0, screened.length).map((h) => h.screened), screened.map(() => true));
});

test('everything awarded is returned, screened or not — nothing is lost', () => {
  // A title that did not earn a screen still gets named in front of everyone, in
  // the strip. That is what makes handing out more titles than screens honest.
  const s = stats({
    a: seat({ mean: 400 }), b: seat({ mean: 3000 }), c: seat({ mean: 9000, correct: 9 }), d: seat({ mean: 6000 }),
  }, {
    'flags-all': mode({ a: 40 }), 'map-outlines': mode({ b: 35 }),
    'spot-flag': mode({ d: 33 }), 'superlative-gdp': mode({ c: 30 }, { correct: { c: 4 } }),
  });
  const out = computeHonours(s, board([['a', 60], ['b', 50], ['c', 40], ['d', 30]]));
  assert.ok(out.length > out.filter((h) => h.screened).length, 'some titles are strip-only');
  assert.ok(out.length <= honourPlan(4).titles);
});

// ---- degenerate boards ----

test('a duel and a solo game', () => {
  const duel = stats({ a: seat({ mean: 900 }), b: seat({ mean: 4000 }) },
    { 'flags-all': mode({ a: 40, b: 20 }) });
  assert.ok(computeHonours(duel, board([['a', 40], ['b', 20]])).length <= honourPlan(2).titles);

  const solo = stats({ me: seat({ mean: 900 }) }, { 'flags-all': mode({ me: 40 }) });
  assert.deepEqual(computeHonours(solo, board([['me', 40]])), [], 'a solo game has no ceremony');
});

test('missing or empty records produce no honours rather than throwing', () => {
  // A game finished on a room restored from a snapshot written before the
  // ceremony existed has nothing recorded. It must still finish.
  assert.deepEqual(computeHonours(null, board([['a', 1], ['b', 0]])), []);
  assert.deepEqual(computeHonours(undefined, board([['a', 1]])), []);
  assert.deepEqual(computeHonours(stats({}), board([['a', 1], ['b', 0]])), []);
  assert.deepEqual(computeHonours(stats({ a: seat() }), []), []);
});

// ---- soleWinnerId ----

test('soleWinnerId: the top scorer, or nobody', () => {
  assert.equal(soleWinnerId(board([['a', 9], ['b', 4]])), 'a');
  assert.equal(soleWinnerId(board([['a', 9], ['b', 9]])), null, 'a tie crowns nobody');
  assert.equal(soleWinnerId(board([['a', 0], ['b', 0]])), null, 'crowning a 0 is worse than crowning nobody');
  assert.equal(soleWinnerId([]), null);
  assert.equal(soleWinnerId(null), null);
});

test('the cap follows the crown: an uncrowned top seat is not capped', () => {
  // On a tie there is no winner, so nobody carries the winner's one-title limit
  // — which is right: the cap exists to stop a runaway winner sweeping the
  // ceremony, and a tie has no runaway winner.
  const s = stats({
    a: seat({ mean: 400, correct: 10 }), b: seat({ mean: 900, correct: 10 }), c: seat({ mean: 9000, correct: 2 }),
  }, {
    'flags-all': mode({ a: 40, b: 39 }), 'map-outlines': mode({ a: 38, b: 2 }), 'spot-flag': mode({ a: 30, b: 1 }),
  });
  const out = computeHonours(s, board([['a', 50], ['b', 50], ['c', 5]]));
  assert.ok(out.length > 0);
});
