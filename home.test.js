import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(HERE, 'index.html'), 'utf-8');
const css = readFileSync(join(HERE, 'index.css'), 'utf-8');
const pageJs = readFileSync(join(HERE, 'page.js'), 'utf-8');

/** The hero's flag row, markup only (no nested <div>, so the first </div> closes it). */
function stampRow() {
  const m = html.match(/<div class="hero-stamps"[^>]*>([\s\S]*?)<\/div>/);
  assert.ok(m, 'index.html must carry a .hero-stamps row');
  return m[1];
}

// ---- the row is static markup, which is the whole point ----

test('hero: the flag row ships in the HTML, not painted by JS after boot', () => {
  // This is a PERFORMANCE contract, not a style preference. The row used to be
  // built in `mountHeroFlags()` inside `bootI18n().then(...)`, so decorative
  // markup waited on a 91KB translation fetch it never reads — the headline and
  // CTA beside it painted instantly, and the flags popped in visibly late.
  // Static markup paints with everything else.
  //
  // If a later change needs these drawn dynamically (e.g. random from a larger
  // pool), that is a deliberate trade against first paint: delete this test on
  // purpose rather than working around it.
  assert.ok(!/hero-stamps/.test(pageJs), 'page.js must not touch the hero stamp row');
  assert.ok(!/FAKE_FLAGS|fakeFlags/.test(pageJs), 'the fake flags must not be imported at runtime');
});

test('hero: four invented flag stamps, each cross-fading through layered designs', () => {
  const row = stampRow();
  const stamps = row.match(/class="hero-stamp(?:\s[^"]*)?"/g) || [];
  assert.equal(stamps.length, 4, 'four stamps — fills the phone row (the 4th is hidden on desktop)');
  // Each stamp holds more than one layer so it can cross-fade between designs.
  const layers = row.match(/<i\b/g) || [];
  assert.ok(layers.length >= stamps.length * 2, 'each stamp carries multiple <i> flag layers');
});

test('hero: the row is decorative and announced to nobody', () => {
  // Invented flags carry no meaning for a screen reader.
  assert.match(html, /<div class="hero-stamps"[^>]*aria-hidden="true"/);
});

test('hero: no external references — the row must not cost a request', () => {
  // The reason the flags are inline CSS gradients rather than <img src>. An
  // external ref here would reintroduce exactly the late-paint this arrangement
  // removes.
  const row = stampRow();
  assert.ok(!/<img\b/.test(row), 'no <img>');
  assert.ok(!/<image\b/.test(row), 'no <image>');
  assert.ok(!/<use\b/.test(row), 'no <use>');
  assert.ok(!/\burl\(/.test(row), 'no url() reference');
  assert.ok(!/\bhref=/.test(row), 'no href');
});

test('hero: the invented flags stay obviously invented, so they cannot spoil a real puzzle', () => {
  // Being fake is the point — abstract flags in the site's invented palette,
  // never a real country flag. Pinned by artwork rather than by comment: a
  // well-meaning swap to real flags would turn the landing page into a spoiler
  // for whoever recognises them.
  const row = stampRow();
  assert.match(row, /#2a9d8f/, 'the invented teal field');
  assert.match(row, /#c65f9a/, 'the invented magenta field');
  assert.match(row, /#241f22/, 'the invented near-black field');
});

// ---- motion is opt-out ----

test('hero: the stamp animation respects prefers-reduced-motion', () => {
  // The cross-fade is decorative; a reduced-motion visitor must get a still
  // page. index.css disables the layer animation under the media query.
  assert.match(
    css,
    /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.hero-stamp > i\s*\{\s*animation:\s*none/,
    'reduced-motion must stop the stamp cross-fade',
  );
});
