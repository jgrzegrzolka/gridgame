import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { flowDistance, CROWN_FADE_PX, FLOW_MIN_OVERFLOW_PX } from './crownFlow.js';

const HERE = dirname(fileURLToPath(import.meta.url));

test('a line that fits does not flow at all', () => {
  assert.equal(flowDistance(200, 300), null, 'room to spare');
  assert.equal(flowDistance(300, 300), null, 'exactly fits');
});

test('a line that overflows travels the overflow PLUS the fade band', () => {
  // The reference case from the design note: overflow 48 -> --flow: -64px.
  assert.equal(flowDistance(320, 272), -64);
});

// The bug this module exists for, stated as its own test so a "simplification"
// back to -(scrollWidth - clientWidth) fails here rather than shipping a line
// whose last characters sit under the fade exactly while it holds still to be
// read. A test asserting only "negative" or "roughly the overflow" would pass
// against the broken version.
test('the fade band is counted, not just the overflow', () => {
  const overflow = 48;
  const distance = flowDistance(320, 320 - overflow);
  assert.notEqual(distance, -overflow, 'stopping at the overflow parks text under the mask');
  assert.equal(distance, -(overflow + CROWN_FADE_PX));
  assert.ok(Math.abs(/** @type {number} */ (distance)) > overflow, 'travels further than it overflows');
});

// Measured on the real card: 390 px overflows by 2 and 320 px by 60. Flowing for
// the 2 would slide 18 px to reveal two, forever, while the board is on screen —
// so the effect is reserved for the case that actually loses words.
test('a hair of overflow is left to the ellipsis, a sentence of it flows', () => {
  assert.equal(flowDistance(302, 300), null, 'the measured 390 px case: 2 px, not worth moving');
  assert.equal(flowDistance(300 + FLOW_MIN_OVERFLOW_PX - 1, 300), null, 'just under the floor');
  assert.equal(flowDistance(300 + FLOW_MIN_OVERFLOW_PX, 300), -(FLOW_MIN_OVERFLOW_PX + CROWN_FADE_PX),
    'the floor itself flows');
  assert.equal(flowDistance(360, 300), -76, 'the measured 320 px case: 60 px of missing sentence');
  assert.ok(FLOW_MIN_OVERFLOW_PX > 0 && FLOW_MIN_OVERFLOW_PX < CROWN_FADE_PX,
    'a floor above the fade band would mean every flow that runs is shorter than its own mask');
});

test('an unmeasured card reads as "nothing to do" rather than a NaN transform', () => {
  // Before layout — hidden card, unmounted node — both dimensions are 0. That is
  // not "it fits", it is "measure again after layout", but null is the right
  // answer either way: no animation until there is something to measure.
  assert.equal(flowDistance(0, 0), null);
  assert.equal(flowDistance(NaN, 300), null);
  assert.equal(flowDistance(300, NaN), null);
});

test('the fade band is one number shared with the stylesheet', () => {
  // CROWN_FADE_PX and the mask's stop are two halves of the same measurement: if
  // the CSS band grows and this constant does not, the slide stops short again
  // and the symptom is subtle (slightly faded tail), not obvious. Pinned so the
  // pair has to move together.
  const css = readFileSync(join(HERE, 'index.css'), 'utf8');
  const rule = css.match(/\.fw-crown\.flowing\s*\{[^}]*\}/);
  assert.ok(rule, '.fw-crown.flowing rule not found in index.css');
  assert.ok(
    rule[0].includes(`calc(100% - ${CROWN_FADE_PX}px)`),
    `the mask stop must be calc(100% - ${CROWN_FADE_PX}px) to match CROWN_FADE_PX`,
  );
});
