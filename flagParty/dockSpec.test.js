import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOCK_BY_SECTION, dockSpecFor } from './dockSpec.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(HERE, 'index.html'), 'utf-8');
const pageJs = readFileSync(join(HERE, 'page.js'), 'utf-8');
const commonJs = readFileSync(join(HERE, '..', 'common.js'), 'utf-8');

test('the page has exactly one dock, and it is not inside a section', () => {
  // THE fix. A dock inside a `<section>` is inside the screen-swap transform,
  // and a transformed ancestor becomes the containing block for position:fixed —
  // which made the bar render ~400px up the phone screen for the length of the
  // swap before snapping to the bottom. Structural, so it is pinned structurally.
  const docks = html.match(/<nav[^>]*class="dock"[^>]*>/g) ?? [];
  assert.equal(docks.length, 1, 'exactly one dock on the page');
  // Everything from the dock tag to the end of the document must not close a
  // section — if it did, the dock would be sitting inside one.
  const after = html.slice(html.indexOf(docks[0]));
  assert.ok(!/<\/section>/.test(after.slice(0, after.indexOf('</main>'))),
    'the dock must be a sibling of the sections, not a child of one');
});

test('every screen the swapper can show has a dock decision', () => {
  // `showSection`'s union is the source of truth for which screens exist. A new
  // screen that forgets an entry here would silently keep the previous screen's
  // dock — e.g. the draft pick inheriting the question's "Back to settings".
  const union = pageJs.match(/function showSection\(\/\*\* @type \{([^}]*)\}/);
  assert.ok(union, 'page.js must declare showSection with a typed screen union');
  const screens = [...union[1].matchAll(/'([a-z]+)'/g)].map((m) => m[1]);
  assert.ok(screens.length >= 7, `expected the full screen union, got ${screens.join(',')}`);
  for (const s of screens) {
    assert.ok(Object.prototype.hasOwnProperty.call(DOCK_BY_SECTION, s),
      `screen "${s}" has no entry in DOCK_BY_SECTION`);
  }
});

test('every spec it can emit uses real catalog items', () => {
  // A typo'd id makes mountDock throw ("Unknown dock item"), which would take out
  // the screen swap rather than just the bar.
  const catalog = [...commonJs.matchAll(/^\s{2}([a-zA-Z]+):\s*\{/gm)].map((m) => m[1]);
  assert.ok(catalog.includes('home'), 'sanity: the catalog scrape found real ids');
  for (const [section, spec] of Object.entries(DOCK_BY_SECTION)) {
    if (spec === null) continue;
    for (const id of spec.split(/\s+/)) {
      assert.ok(catalog.includes(id), `${section} wants unknown dock item "${id}"`);
    }
  }
});

test('every screen that shows a dock offers Home', () => {
  // The site has no "up one level" affordance by design (CLAUDE.md) — Home is
  // the only way out of a page. A screen that shows a dock without it would be
  // a dead end wearing a navigation bar.
  for (const [section, spec] of Object.entries(DOCK_BY_SECTION)) {
    if (spec === null) continue;
    assert.ok(spec.split(/\s+/).includes('home'), `${section} shows a dock with no Home`);
  }
});

test('the mid-show beats stay dockless, exactly as before the dock moved', () => {
  // Not an oversight being preserved: these three are timed, self-advancing
  // beats the show drives. This asserts the move did not quietly add navigation
  // to screens that never had it.
  for (const s of ['roundcard', 'pick', 'break']) {
    assert.equal(dockSpecFor(s), null, `${s} must show no dock`);
  }
});

test('a null or unknown screen resolves to no dock rather than throwing', () => {
  // showSection(null) is a real call while the page decides what to show.
  assert.equal(dockSpecFor(null), null);
  assert.equal(dockSpecFor('nope'), null);
});

test('dock items are looked up live, never cached across a remount', () => {
  // mountDock() replaces the dock's children, so the Play again / Back to
  // settings buttons are DIFFERENT elements after every phase change. A module
  // -level `$('play-again')` would hold the first one forever: its click
  // listener would be dead and `hidden` would be set on a detached node.
  assert.ok(!/const playAgainBtn = /.test(pageJs),
    'play-again must not be cached at boot — re-query it after each mount');
  assert.ok(!/const questionToSettingsBtn = /.test(pageJs),
    'question-to-settings must not be cached at boot — re-query it after each mount');
});
