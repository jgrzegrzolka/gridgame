import test from 'node:test';
import assert from 'node:assert/strict';

import { withOwnResult } from './leaderboardOwnResult.js';

const ME = 'device-me';

/** @param {string} id @param {number} score @param {number} durationMs */
const row = (id, score, durationMs) => ({ deviceId: id, nickname: null, score, durationMs });

/**
 * Call it and assert we got a payload back — every test that uses this
 * passes inputs the function is meant to patch, so a null return is a
 * failure, not a case.
 *
 * @param {Parameters<typeof withOwnResult>[0]} args
 */
function patch(args) {
  const out = withOwnResult(args);
  assert.ok(out, 'expected a patched payload');
  return { top: out.top ?? [], you: out.you ?? null };
}

/**
 * The row for `id`, or a failed assertion. Keeps every test from repeating
 * a `find(...)` that the typechecker can only see as possibly-undefined.
 *
 * @param {{ top: { deviceId: string, score: number, durationMs: number }[] }} out
 * @param {string} id
 */
function rowOf(out, id) {
  const found = out.top.find((r) => r.deviceId === id);
  assert.ok(found, `no row for ${id}`);
  return found;
}

const board = () => ({
  top: [
    row('a', 60, 60000),
    row('b', 55, 60000),
    row(ME, 51, 60000),
    row('c', 40, 60000),
  ],
  you: null,
});

test('own row shows the score just played when it beats the stored one', () => {
  // The bug this exists for: the screen says "new record, 53" and the pink
  // row underneath it says 51.
  const out = patch({ data: board(), deviceId: ME, score: 53, durationMs: 60000 });
  assert.equal(rowOf(out, ME).score, 53);
});

test('a result that does not change the rank leaves the order untouched', () => {
  const out = patch({ data: board(), deviceId: ME, score: 53, durationMs: 60000 });
  assert.deepEqual(out.top.map((r) => r.deviceId), ['a', 'b', ME, 'c']);
});

test('a result that outranks the row above it moves up', () => {
  // Leaving it in place would print 57 below 55 and read as a broken board.
  const out = patch({ data: board(), deviceId: ME, score: 57, durationMs: 60000 });
  assert.deepEqual(out.top.map((r) => r.deviceId), ['a', ME, 'b', 'c']);
});

test('a weaker round never overwrites the best the server holds', () => {
  // A 7-day board shows your best in the window, not your latest.
  const out = patch({ data: board(), deviceId: ME, score: 12, durationMs: 60000 });
  assert.equal(rowOf(out, ME).score, 51);
  assert.deepEqual(out.top.map((r) => r.deviceId), ['a', 'b', ME, 'c']);
});

test('an equal score with a faster time counts as better', () => {
  const out = patch({ data: board(), deviceId: ME, score: 51, durationMs: 47312 });
  assert.equal(rowOf(out, ME).durationMs, 47312);
});

test('an equal score with a slower time does not', () => {
  const out = patch({ data: board(), deviceId: ME, score: 51, durationMs: 60001 });
  assert.equal(rowOf(out, ME).durationMs, 60000);
});

test('nobody else\'s row is ever touched', () => {
  const before = board();
  const out = patch({ data: before, deviceId: ME, score: 57, durationMs: 1000 });
  for (const id of ['a', 'b', 'c']) {
    assert.deepEqual(rowOf(out, id), before.top.find((r) => r.deviceId === id));
  }
});

test('the input payload is not mutated', () => {
  // leaderboardState is held for language re-paints; mutating it would make
  // the patch permanent and unrepeatable.
  const before = board();
  patch({ data: before, deviceId: ME, score: 57, durationMs: 1000 });
  const mine = before.top.find((r) => r.deviceId === ME);
  assert.equal(mine && mine.score, 51);
  assert.deepEqual(before.top.map((r) => r.deviceId), ['a', 'b', ME, 'c']);
});

test('endurance mode ranks the other way: fewer mistakes wins', () => {
  const data = {
    top: [row('a', 0, 90000), row(ME, 6, 90000), row('c', 9, 90000)],
    you: null,
  };
  const out = patch({ data, deviceId: ME, score: 2, durationMs: 90000, lowerWins: true });
  assert.equal(rowOf(out, ME).score, 2);
  assert.deepEqual(out.top.map((r) => r.deviceId), ['a', ME, 'c']);
  // And a higher wrong-count is a worse round there, so it must not land.
  const worse = patch({ data, deviceId: ME, score: 8, durationMs: 90000, lowerWins: true });
  assert.equal(rowOf(worse, ME).score, 6);
});

test('the out-of-top-ten self row gets the score but keeps its rank', () => {
  // We know the new number; we cannot know how many strangers it jumped.
  const data = { top: [row('a', 60, 60000)], you: { rank: 87, score: 12, durationMs: 60000 } };
  const out = patch({ data, deviceId: ME, score: 20, durationMs: 60000 });
  assert.deepEqual(out.you, { rank: 87, score: 20, durationMs: 60000 });
});

test('no own row on the board is left alone, not invented', () => {
  const data = { top: [row('a', 60, 60000), row('b', 55, 60000)], you: null };
  const out = patch({ data, deviceId: ME, score: 99, durationMs: 1000 });
  assert.deepEqual(out.top.map((r) => r.deviceId), ['a', 'b']);
  assert.equal(out.you, null);
});

test('missing or unusable inputs pass the payload straight through', () => {
  const data = board();
  assert.equal(withOwnResult({ data: null, deviceId: ME, score: 1, durationMs: 1 }), null);
  assert.equal(withOwnResult({ data, deviceId: null, score: 1, durationMs: 1 }), data);
  assert.equal(withOwnResult({ data, deviceId: ME, score: NaN, durationMs: 1 }), data);
  assert.equal(
    withOwnResult({ data, deviceId: ME, score: 1, durationMs: /** @type {any} */ (undefined) }),
    data,
  );
});

test('a loading payload with no rows survives the patch', () => {
  const out = patch({ data: {}, deviceId: ME, score: 10, durationMs: 1000 });
  assert.deepEqual(out.top, []);
  assert.equal(out.you, null);
});
