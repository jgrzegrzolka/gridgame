import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(HERE, 'index.css'), 'utf-8');
const commonCss = readFileSync(join(HERE, '..', 'common.css'), 'utf-8');

/**
 * What is left here is only what genuinely cannot be expressed as a unit test:
 * a cross-FILE invariant about where the switch's styling lives.
 *
 * The behaviour that used to be "tested" by running regexes over `page.js`
 * source now lives in `kidChipRole` and is tested on its contract in
 * `flags/partyClient.test.js`. Those regexes pinned the shape of the code
 * rather than what it did, and would have broken on a rename while still
 * passing over a real behaviour change.
 */

test('the switch chrome lives in common.css, not duplicated per feature', () => {
  for (const cls of ['.scope-toggle-track', '.scope-toggle-thumb', '.scope-toggle-text']) {
    assert.equal(css.includes(cls), false, `${cls} must not be redefined in flagParty/index.css`);
    assert.equal(commonCss.includes(cls), true, `${cls} lives in common.css`);
  }
});

test('every page that needs a switch uses the shared builder', () => {
  // The extraction is only worth anything if the copies actually go away.
  // profile/sync hand-assembled the same four elements before this landed.
  for (const rel of [['flagParty', 'page.js'], ['profile', 'sync', 'page.js']]) {
    const src = readFileSync(join(HERE, '..', ...rel), 'utf-8');
    assert.match(src, /buildToggleSwitch/, `${rel.join('/')} builds its switch with the shared helper`);
    assert.equal(
      /className\s*=\s*['"]scope-toggle-track['"]/.test(src),
      false,
      `${rel.join('/')} must not hand-assemble the track`,
    );
  }
});
