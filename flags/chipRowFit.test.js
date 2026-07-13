import { test } from 'node:test';
import assert from 'node:assert/strict';

import { computeFitCount, computeFitVisible, fitChipRow } from './chipRowFit.js';

// widths 100 each, gap 10, more-button 80 throughout unless stated.
const W = (/** @type {number} */ n) => Array(n).fill(100);

test('everything fits: all items shown, no room needed for the button', () => {
  // 3 items = 100 + 110 + 110 = 320.
  assert.equal(computeFitCount({ avail: 320, widths: W(3), moreWidth: 80, gap: 10 }), 3);
});

test('overflow: accepting an item always leaves room for the button', () => {
  // 5 items in 400: items alone would take 3 (320), but the third must
  // co-exist with "+ N more" (320 + 90 = 410 > 400), so only 2 show.
  assert.equal(computeFitCount({ avail: 400, widths: W(5), moreWidth: 80, gap: 10 }), 2);
});

test('the last item never reserves button room (nothing follows it)', () => {
  // 3 items in 330: first two use 210; the third brings 320 <= 330 and is
  // last, so no reservation, all three fit without a button.
  assert.equal(computeFitCount({ avail: 330, widths: W(3), moreWidth: 80, gap: 10 }), 3);
});

test('alwaysMore reserves button room even for the last item', () => {
  // Same 330 as above, but the button always renders (teaser row): the
  // third item would need 320 + 90 = 410, so it drops.
  assert.equal(computeFitCount({ avail: 330, widths: W(3), moreWidth: 80, gap: 10, alwaysMore: true }), 2);
});

test('exact boundary is inclusive', () => {
  // 2 of 3 shown: 100 + 110 + reserve 90 = 300 exactly.
  assert.equal(computeFitCount({ avail: 300, widths: W(3), moreWidth: 80, gap: 10 }), 2);
});

test('at least one item shows even when nothing truly fits', () => {
  assert.equal(computeFitCount({ avail: 50, widths: W(4), moreWidth: 80, gap: 10 }), 1);
});

test('empty input shows nothing', () => {
  assert.equal(computeFitCount({ avail: 500, widths: [], moreWidth: 80, gap: 10 }), 0);
});

test('mixed widths: a long later chip drops without blocking earlier ones', () => {
  const widths = [60, 200, 40, 300];
  // 60 + 210 + 50 = 320, +reserve 90 = 410 <= 420 for the third; the fourth
  // (300) would need 320 + 310 = 630 > 420.
  assert.equal(computeFitCount({ avail: 420, widths, moreWidth: 80, gap: 10 }), 3);
});

test('a pinned item stays visible however deep in the order it sits', () => {
  // Two unpinned leaders (100 + 110) + the pinned tail (110) + button (90)
  // = 410, so 420 holds them: [T, T, F, F, T].
  assert.deepEqual(
    computeFitVisible({ avail: 420, widths: W(5), moreWidth: 80, gap: 10, pinned: [false, false, false, false, true] }),
    [true, true, false, false, true],
  );
});

test('unpinned acceptance reserves room for pinned items still ahead', () => {
  // Without pinning, 400 holds 2 unpinned (see above). Pinning the last
  // claims its 110, so only 1 unpinned leader fits alongside it.
  const visible = computeFitVisible({
    avail: 340, widths: W(4), moreWidth: 80, gap: 10, pinned: [false, false, false, true],
  });
  assert.deepEqual(visible, [true, false, false, true]);
});

test('after the first unpinned rejection, later unpinned items stay hidden', () => {
  // A short tail chip must not sneak back in past "+ N more".
  const visible = computeFitVisible({ avail: 300, widths: [100, 100, 100, 10], moreWidth: 80, gap: 10 });
  assert.deepEqual(visible, [true, true, false, false]);
});

test('fitChipRow hides the overflow, shows the button, and reports the count', () => {
  const items = W(5).map((w) => ({ hidden: true, w }));
  const moreBtn = { hidden: true, w: 80 };
  const shown = fitChipRow({
    items,
    moreBtn,
    avail: 400,
    gap: 10,
    measure: (el) => el.w,
  });
  assert.equal(shown, 2);
  assert.deepEqual(items.map((i) => i.hidden), [false, false, true, true, true]);
  assert.equal(moreBtn.hidden, false);
});

test('fitChipRow hides the button when everything fits (unless alwaysMore)', () => {
  const items = W(2).map((w) => ({ hidden: true, w }));
  const moreBtn = { hidden: false, w: 80 };
  fitChipRow({ items, moreBtn, avail: 500, gap: 10, measure: (el) => el.w });
  assert.equal(moreBtn.hidden, true);
  fitChipRow({ items, moreBtn, avail: 500, gap: 10, measure: (el) => el.w, alwaysMore: true });
  assert.equal(moreBtn.hidden, false);
});
