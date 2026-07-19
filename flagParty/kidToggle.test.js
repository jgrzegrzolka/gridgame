import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(HERE, 'index.css'), 'utf-8');
const pageJs = readFileSync(join(HERE, 'page.js'), 'utf-8');
const commonCss = readFileSync(join(HERE, '..', 'common.css'), 'utf-8');
const commonJs = readFileSync(join(HERE, '..', 'common.js'), 'utf-8');

/**
 * The kid toggle is the site's ONE on/off switch, not a Flag Party lookalike.
 *
 * CLAUDE.md's rule: same mechanism = same code. Before this feature the switch
 * existed twice already (the burger menus via `buildToggleLi`, and
 * `profile/sync/page.js` hand-assembling the same four elements), so a third
 * hand-rolled copy in the lobby is exactly the drift the rule exists to stop.
 * These tests fail if someone re-implements the track / thumb here instead of
 * calling the shared builder.
 */

test('the lobby builds its switch with the shared builder', () => {
  assert.match(pageJs, /buildToggleSwitch/, 'page.js calls the shared builder');
  assert.match(
    pageJs,
    /import \{[^}]*buildToggleSwitch[^}]*\} from '\.\.\/common\.js'/,
    'and imports it from common.js rather than defining a local one',
  );
});

test('the switch builder is shared, not private to the burger menu', () => {
  assert.match(commonJs, /export function buildToggleSwitch/, 'common.js exports it');
  assert.match(
    commonJs,
    /export function buildToggleLi[\s\S]{0,900}buildToggleSwitch\(/,
    'and buildToggleLi consumes it, so the menu and the lobby cannot drift apart',
  );
});

test('flagParty defines no switch chrome of its own', () => {
  // The visual rules live in common.css where every consumer reaches them.
  // A copy here would be byte-identical today and wrong in six months.
  for (const cls of ['.scope-toggle-track', '.scope-toggle-thumb', '.scope-toggle-text']) {
    assert.equal(css.includes(cls), false, `${cls} must not be redefined in flagParty/index.css`);
    assert.equal(commonCss.includes(cls), true, `${cls} lives in common.css`);
  }
});

test('the chip stays a div, so the switch is the only hit target on the row', () => {
  // A checkbox nested in a <button> is invalid HTML and gives the row two
  // competing tap targets — the reason the tap-the-whole-chip design was dropped.
  assert.equal(css.includes('button.chip'), false, 'no button-chip styling survives');
  assert.match(pageJs, /el\('div', 'chip'/, 'the chip is built as a div');
});

test('only the host gets a control; everyone else gets a read-only badge', () => {
  assert.match(css, /\.chip-kid-label\b/, 'the host row has a caption for the switch');
  assert.match(css, /\.chip-kid\b/, 'and non-hosts have a badge');
  assert.match(
    pageJs,
    /if \(hostSetup\) \{[\s\S]{0,700}buildToggleSwitch[\s\S]{0,400}\} else if \(r\.kid\)/,
    'the switch is host-only and the badge is the fallback',
  );
});
