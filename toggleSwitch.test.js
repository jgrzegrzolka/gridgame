import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const commonCss = readFileSync(join(HERE, 'common.css'), 'utf-8');

/**
 * Cross-FILE invariants about the shared toggle switch (`buildToggleSwitch` in
 * common.js, `.scope-toggle-*` in common.css): its chrome lives in one place,
 * and every consumer builds it with the shared helper instead of hand-assembling
 * the same four elements.
 *
 * These can't be expressed as ordinary unit tests — they assert which *file* a
 * rule is written in, which is exactly the drift CLAUDE.md's "same mechanism =
 * same code" rule exists to prevent.
 */

/** Every per-feature stylesheet, so a copy can't hide in one nobody thought of. */
function featureStylesheets() {
  return readdirSync(HERE, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules')
    .map((e) => join(HERE, e.name, 'index.css'))
    .filter((p) => {
      try { readFileSync(p); return true; } catch { return false; }
    });
}

test('the switch chrome lives in common.css, not duplicated per feature', () => {
  const classes = ['.scope-toggle-track', '.scope-toggle-thumb', '.scope-toggle-text'];
  for (const cls of classes) {
    assert.equal(commonCss.includes(cls), true, `${cls} lives in common.css`);
  }
  // Every feature stylesheet, not one named folder: the previous version checked
  // a single page, so a copy pasted into any other one would have sailed through.
  const sheets = featureStylesheets();
  assert.ok(sheets.length > 0, 'expected to find some feature stylesheets to scan');
  for (const sheet of sheets) {
    const css = readFileSync(sheet, 'utf-8');
    for (const cls of classes) {
      assert.equal(css.includes(cls), false, `${cls} must not be redefined in ${sheet}`);
    }
  }
});

test('every page that needs a switch uses the shared builder', () => {
  // The extraction is only worth anything if the copies actually go away.
  // profile/sync hand-assembled the same four elements before this landed.
  for (const rel of [['profile', 'sync', 'page.js']]) {
    const src = readFileSync(join(HERE, ...rel), 'utf-8');
    assert.match(src, /buildToggleSwitch/, `${rel.join('/')} builds its switch with the shared helper`);
    assert.equal(
      /className\s*=\s*['"]scope-toggle-track['"]/.test(src),
      false,
      `${rel.join('/')} must not hand-assemble the track`,
    );
  }
});
