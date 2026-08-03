import test from 'node:test';
import assert from 'node:assert/strict';

import { remainingDelayMs, fadeUpAt } from './finishCascade.js';

/** The two surfaces `fadeUpAt` touches, and a log of what it added. */
function stubEl() {
  /** @type {string[]} */
  const classes = [];
  /** @param {string} n */
  const add = (n) => { classes.push(n); };
  return { style: { animationDelay: '' }, classes, classList: { add } };
}

test('remainingDelayMs measures from the finish, not from the element', () => {
  // The leaderboard rows are due 1.3s after the finish. Arriving 0.8s in,
  // they wait 0.5s — not the full 1.3s a CSS delay would have given them.
  assert.equal(remainingDelayMs(1300, 800), 500);
  assert.equal(remainingDelayMs(1300, 0), 1300);
});

test('remainingDelayMs never returns a negative wait', () => {
  // A slow fetch lands after its slot: show it now rather than never.
  assert.equal(remainingDelayMs(1300, 4000), 0);
});

test('remainingDelayMs keeps the cascade order across arrival orders', () => {
  // Caption (1200) then rows (1300): whatever order they turn up in, the
  // caption's absolute moment stays earlier than the rows'.
  const captionAt = 900 + remainingDelayMs(1200, 900);
  const rowsAt = 200 + remainingDelayMs(1300, 200);
  assert.ok(captionAt < rowsAt, `${captionAt} should precede ${rowsAt}`);
});

test('remainingDelayMs treats junk as "no wait"', () => {
  assert.equal(remainingDelayMs(0, 0), 0);
  assert.equal(remainingDelayMs(-100, 0), 0);
  assert.equal(remainingDelayMs(NaN, 100), 0);
  assert.equal(remainingDelayMs(500, NaN), 500);
});

test('fadeUpAt writes the delay inline and adds the shared fade class', () => {
  const el = stubEl();
  fadeUpAt(el, { targetMs: 1200, elapsedMs: 200 });
  assert.equal(el.style.animationDelay, '1000ms');
  assert.deepEqual(el.classes, ['fade-up-in']);
});

test('fadeUpAt on a missing element is a no-op, not a throw', () => {
  // The map section doesn't exist on every variant, so callers pass what
  // `getElementById` gave them without checking.
  assert.doesNotThrow(() => fadeUpAt(/** @type {any} */ (null), { targetMs: 100, elapsedMs: 0 }));
});
