import test from 'node:test';
import assert from 'node:assert/strict';
import { capPickers, pickSlots, PICK_AVATAR_CAP } from './pickAvatars.js';

/** @param {number} n */
const ids = (n) => Array.from({ length: n }, (_, i) => 'p' + String(i));

test('capPickers: a table that fits is drawn whole, with no marker', () => {
  for (const n of [0, 1, 3, PICK_AVATAR_CAP]) {
    const r = capPickers(ids(n));
    assert.deepEqual(r.shown, ids(n), `${n} pickers all shown`);
    assert.equal(r.overflow, 0, `${n} pickers need no marker`);
  }
});

test('capPickers: past the cap it shows the first five and counts the rest', () => {
  const r = capPickers(ids(16));
  assert.deepEqual(r.shown, ['p0', 'p1', 'p2', 'p3', 'p4']);
  assert.equal(r.overflow, 11);
  // The order is the caller's: the reveal builds pickers in buzz order, so the
  // five faces are the five who got there first.
  assert.deepEqual(capPickers(['z', 'y', 'x', 'w', 'v', 'u']).shown, ['z', 'y', 'x', 'w', 'v']);
});

test('capPickers: one over the cap trades a face for a +1', () => {
  // Stated as a test because it is the case someone will call a bug: at six
  // pickers the sixth avatar would have cost about what "+1" costs. A cap that is
  // sometimes not the cap is harder to reason about — and to lay the rail out
  // from — than one that always is.
  const r = capPickers(ids(PICK_AVATAR_CAP + 1));
  assert.equal(r.shown.length, PICK_AVATAR_CAP);
  assert.equal(r.overflow, 1);
});

test('capPickers: the shown list is a copy, never the caller’s array', () => {
  const src = ids(3);
  const r = capPickers(src);
  r.shown.push('gatecrasher');
  assert.equal(src.length, 3, 'the reveal’s own list is untouched');
});

test('capPickers: a garbage list or cap falls back rather than throwing', () => {
  assert.deepEqual(capPickers(/** @type {any} */ (null)), { shown: [], overflow: 0 });
  assert.deepEqual(capPickers(/** @type {any} */ (undefined)), { shown: [], overflow: 0 });
  // A nonsense cap uses the default instead of showing nobody (or everybody).
  assert.equal(capPickers(ids(9), 0).shown.length, PICK_AVATAR_CAP);
  assert.equal(capPickers(ids(9), -3).shown.length, PICK_AVATAR_CAP);
  assert.equal(capPickers(ids(9), /** @type {any} */ ('lots')).shown.length, PICK_AVATAR_CAP);
  // A fractional cap floors rather than drawing half an avatar.
  assert.equal(capPickers(ids(9), 3.7).shown.length, 3);
});

test('capPickers: an explicit cap overrides the default in both directions', () => {
  assert.deepEqual(capPickers(ids(4), 2), { shown: ['p0', 'p1'], overflow: 2 });
  assert.deepEqual(capPickers(ids(8), 8), { shown: ids(8), overflow: 0 });
});

test('pickSlots agrees with capPickers on every table size', () => {
  // The two halves are used by different callers — the chart measures a row it is
  // not drawing — so they have to stay in step or the rail is sized for a row that
  // renders differently.
  for (let n = 0; n <= 20; n += 1) {
    const drawn = capPickers(ids(n));
    const measured = pickSlots(n);
    assert.equal(measured.faces, drawn.shown.length, `${n}: same face count`);
    assert.equal(measured.marker, drawn.overflow > 0, `${n}: same marker verdict`);
  }
});

test('pickSlots: nobody picked is no faces and no marker', () => {
  assert.deepEqual(pickSlots(0), { faces: 0, marker: false });
  assert.deepEqual(pickSlots(/** @type {any} */ (undefined)), { faces: 0, marker: false });
  assert.deepEqual(pickSlots(-2), { faces: 0, marker: false });
});

test('the cap is small enough to fit a phone tile and big enough to be a crowd', () => {
  // A guard on the number itself: the tile row is 20px avatars on a 3px gap in
  // roughly 163px of tile, and the marker takes a slot too. Five faces + a marker
  // is the most that clears it.
  assert.ok(PICK_AVATAR_CAP >= 3, 'fewer than three faces is a counter, not a crowd');
  const rowPx = PICK_AVATAR_CAP * 20 + PICK_AVATAR_CAP * 3 + 26;
  assert.ok(rowPx <= 163, `a full row is ${rowPx}px, inside the narrowest tile`);
});
