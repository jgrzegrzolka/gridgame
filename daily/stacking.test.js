import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const commonCss = readFileSync(join(HERE, '..', 'common.css'), 'utf-8');
const findCss = readFileSync(join(HERE, '..', 'findFlag', 'index.css'), 'utf-8');
const dailyCss = readFileSync(join(HERE, 'index.css'), 'utf-8');

/** The declaration block of a single-selector rule, or null. */
function rule(css, selector) {
  const m = css.match(new RegExp(`(?:^|\\n)${selector.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}\\s*\\{([^}]*)\\}`));
  return m ? m[1] : null;
}

/* The open suggestion dropdown must be the topmost thing on the play screen.
 *
 * It sits INSIDE `.find-input-wrap`, and everything it has to cover — the
 * puzzle note, the found-tiles grid, the dock — is a LATER SIBLING of that
 * wrap. So `.find-suggestions`'s own z-index is not enough on its own: it
 * only ever settles a fight among the wrap's own children. Two separate
 * things have to hold, and each one broke on its own in prod:
 *
 *   1. the wrap must outrank its later siblings          (#1152)
 *   2. no descendant of a sibling may escape past it     (this file)
 *
 * Both are z-index leaks in the same direction, so they live together. */

test('stacking: the input wrap outranks the siblings the dropdown covers', () => {
  // `.enter` (common.css) animates transform and fills its last keyframe
  // forever (animation-fill-mode: both) — and a FILLED `transform: none`
  // computes to the identity matrix rather than the keyword, so the wrap is
  // a permanent stacking context. Read straight off prod:
  //
  //   transform: "matrix(1, 0, 0, 1, 0, 0)"   playState: "finished"
  //
  // That traps `.find-suggestions`'s z-index inside the wrap, where it can
  // only outrank the input. The note and the tiles then won on DOM order.
  const wrap = rule(findCss, '.find-input-wrap');
  assert.ok(wrap, 'findFlag/index.css must style .find-input-wrap');
  assert.match(
    wrap,
    /z-index:\s*[1-9]/,
    'the wrap needs a level of its own, not just a containing context',
  );
  // The mechanism the comment above rests on. If the fill ever goes away,
  // revisit this pin rather than deleting it.
  assert.match(commonCss, /animation:\s*page-enter[^;]*\bboth\b/);
});

test('stacking: a result tile contains its own corner pills', () => {
  // `.find-tile` is `position: relative` with NO z-index, and its tile-drop
  // animation carries no fill — so once the drop finishes it is not a
  // stacking context at all:
  //
  //   position: "relative"  zIndex: "auto"  transform: "none"
  //
  // Its corner pills are `position: absolute; z-index: 2`, which therefore
  // resolve against the ROOT stacking context, not the tile. They outranked
  // the input wrap and floated over the open dropdown while the flag image
  // underneath them was correctly hidden — the pills alone, mid-list.
  //
  // The tile already clips to its own box (overflow: hidden), so containing
  // the pills cannot hide anything that was visible before.
  const tile = rule(findCss, '.find-tile');
  assert.ok(tile, 'findFlag/index.css must style .find-tile');
  assert.match(tile, /overflow:\s*hidden/, 'the premise: nothing escapes the tile box visually');
  assert.match(
    tile,
    /isolation:\s*isolate|z-index:\s*\d/,
    'the tile must be a stacking context so its pills resolve against it',
  );
});

test('stacking: every tile decoration is positioned, so containment reaches it', () => {
  // The containment above only binds absolutely-positioned descendants. If a
  // decoration ever went `position: fixed` it would escape the tile again —
  // fixed elements ignore an ancestor stacking context unless that ancestor
  // has a transform, which the tile only has mid-drop.
  for (const sel of ['.find-tile-rank', '.find-tile-metric', '.find-stats-pct']) {
    assert.ok(!new RegExp(`${sel}[^{]*\\{[^}]*position:\\s*fixed`).test(dailyCss), `${sel} must not be fixed`);
  }
});
