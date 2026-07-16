import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Regression guard for the invisible wrong-answer feedback bug.
//
// The TTT picker calls `pulseShake(el)` (flags/engine.js) on a rejected pick,
// which toggles the `.shake` class and removes it again on `animationend`.
// If no CSS rule *animates* `.shake` for that element, three things break at
// once: nothing moves (no visible feedback), and `animationend` never fires so
// the class sticks forever. That's exactly what happened when solo + the
// "no data for this metric" rejection shook `.picker-input`, which had no
// `.picker-input.shake` animation — the rejection was completely invisible.
//
// pulseShake is applied to two element classes across the TTT pages:
//   - `.cell`         (wrong-category guess in offline / online / solo)
//   - `.picker-input` (no-data rejection everywhere; every miss in solo)
// Both must resolve to a `.shake` rule that runs a defined @keyframes.

const here = dirname(fileURLToPath(import.meta.url));
const commonCss = readFileSync(join(here, '..', 'common.css'), 'utf8');
const tttCss = readFileSync(join(here, 'index.css'), 'utf8');
// The keyframes live in common.css; the selectors may live in either file, so
// the existence checks run against the combined stylesheet the pages load.
const css = stripComments(commonCss + '\n' + tttCss);

/** Strip /* ... *​/ comments so they can't hide or fake a rule. */
function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '');
}

/** Names of every @keyframes defined in the combined CSS. */
function keyframeNames(text) {
  const names = new Set();
  const re = /@keyframes\s+([A-Za-z_][\w-]*)/g;
  let m;
  while ((m = re.exec(text))) names.add(m[1]);
  return names;
}

/**
 * The body ({ ... }) of the rule whose selector list contains `selector` as an
 * exact comma-separated entry, or null if there is no such rule. Exact-entry
 * matching keeps `.cell.shake` from matching `.cell.shake::before` or
 * `.cell.shake-win`.
 */
function ruleBody(text, selector) {
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(text))) {
    const selectors = m[1].split(',').map((s) => s.trim());
    if (selectors.includes(selector)) return m[2];
  }
  return null;
}

/**
 * Assert `selector` has a rule that runs a defined animation. Reads the
 * `animation` / `animation-name` declaration and confirms it references a
 * keyframe that actually exists (so `animation: none` or a typo'd name fails).
 */
function assertAnimated(selector) {
  const defined = keyframeNames(css);
  const body = ruleBody(css, selector);
  assert.ok(body, `expected a \`${selector}\` rule in the TTT stylesheets`);
  const decl = body.match(/animation(?:-name)?\s*:\s*([^;]+)/);
  assert.ok(decl, `\`${selector}\` must declare an animation, else .shake is invisible`);
  const tokens = decl[1].trim().split(/\s+/);
  const referenced = tokens.filter((tok) => defined.has(tok));
  assert.ok(
    referenced.length > 0,
    `\`${selector}\` animation must reference a defined @keyframes (got: ${decl[1].trim()})`,
  );
}

test('.picker-input.shake runs a real animation (invisible-rejection guard)', () => {
  assertAnimated('.picker-input.shake');
});

test('.cell.shake runs a real animation on the cell itself', () => {
  assertAnimated('.cell.shake');
});

// Regression guard for the "shake hidden by hover" bug.
//
// The grey hover wash is painted by `.cell:hover::after` (background:
// --hover-color). The wrong-answer shake paints its red overlay on
// `.cell.shake::before`. Because `::after` paints AFTER `::before`, the opaque
// grey wash stacks on top of the red overlay and hides it. The cursor is always
// sitting on the cell you just clicked (you clicked it to open the picker), so
// in practice the shake was invisible for every real mouse user — while any
// scripted test that never hovered saw it fine. A shaking cell must drop the
// wash, exactly as owned / game-over cells already do.
test('.cell.shake drops the hover wash so the red overlay is not covered', () => {
  const body = ruleBody(css, '.cell.shake:hover::after');
  assert.ok(
    body,
    'expected a `.cell.shake:hover::after` rule so the grey hover wash cannot cover the red shake',
  );
  assert.match(
    body,
    /background\s*:\s*transparent/,
    '`.cell.shake:hover::after` must set `background: transparent` so the shake shows through hover',
  );
});
