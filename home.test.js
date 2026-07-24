import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(HERE, 'index.html'), 'utf-8');
const pageJs = readFileSync(join(HERE, 'page.js'), 'utf-8');

/** The hero's flag row, markup only. */
function stampRow() {
  const m = html.match(/<div class="hero-stamps"[^>]*>([\s\S]*?)<\/div>/);
  assert.ok(m, 'index.html must carry a .hero-stamps row');
  return m[1];
}

// ---- the row is static markup, which is the whole point ----

test('hero: the flag row ships in the HTML, not painted by JS after boot', () => {
  // This is a PERFORMANCE contract, not a style preference. The row used to be
  // built in `mountHeroFlags()` inside `bootI18n().then(...)`, so 2.7KB of
  // constant decorative SVG waited on a 91KB translation fetch it never reads —
  // the headline and CTA beside it painted instantly, and the flags popped in
  // visibly late. Static markup paints with everything else.
  //
  // If a later change needs these drawn dynamically (e.g. random from a larger
  // pool), that is a deliberate trade against first paint: delete this test on
  // purpose rather than working around it.
  assert.ok(!/hero-stamps/.test(pageJs), 'page.js must not touch the hero stamp row');
  assert.ok(!/FAKE_FLAGS|fakeFlags/.test(pageJs), 'the fake flags must not be imported at runtime');
});

test('hero: three fake flags and one empty "to find" box', () => {
  const row = stampRow();
  const fakes = row.match(/class="hero-stamp fake"/g) || [];
  const todos = row.match(/class="hero-stamp todo"/g) || [];
  assert.equal(fakes.length, 3, 'three fabricated flags');
  assert.equal(todos.length, 1, 'one empty box, a hint that there are flags to find');
});

test('hero: the row is decorative and announced to nobody', () => {
  // Invented flags carry no meaning for a screen reader, and the criteria line
  // above them is aria-hidden for the same reason.
  assert.match(html, /<div class="hero-stamps"[^>]*aria-hidden="true"/);
});

// ---- the artwork itself (moved here from flags/fakeFlags.test.js) ----

test('hero: each fake flag is a 3:2 inline SVG, matching the real stamp boxes', () => {
  const svgs = stampRow().match(/<svg[\s\S]*?<\/svg>/g) || [];
  assert.equal(svgs.length, 3);
  for (const svg of svgs) {
    assert.match(svg, /viewBox="0 0 36 24"/, '3:2 native, so it fills the stamp box without letterboxing');
  }
});

test('hero: no external references — the row must not cost a request', () => {
  // The reason the flags are inline SVG rather than <img src>. An external ref
  // here would reintroduce exactly the late-paint this arrangement removes.
  const svgs = stampRow().match(/<svg[\s\S]*?<\/svg>/g) || [];
  assert.equal(svgs.length, 3);
  for (const svg of svgs) {
    assert.ok(!/<image\b/.test(svg), 'no <image>');
    assert.ok(!/<use\b/.test(svg), 'no <use>');
    assert.ok(!/\burl\(/.test(svg), 'no url() reference');
    assert.ok(!/\bhref=/.test(svg), 'no href');
  }
});

test('hero: the fake flags stay obviously invented, so they cannot spoil a real puzzle', () => {
  // Being fake is the point — the Jolly Roger winks that these are not answers.
  // Pinned by artwork rather than by comment: a well-meaning swap to three real
  // flags would turn the landing page into a spoiler for whoever recognises them.
  const row = stampRow();
  assert.match(row, /#2a9d8f/, 'the invented Nordic cross (teal field)');
  assert.match(row, /#c65f9a/, 'the invented saltire (magenta field)');
  assert.match(row, /#241f22/, 'the Jolly Roger');
});
