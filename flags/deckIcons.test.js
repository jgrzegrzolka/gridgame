import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { DECK_ICON_IDS, deckIconHtml } from './deckIcons.js';

const HERE = dirname(fileURLToPath(import.meta.url));

test('every deck id produces markup', () => {
  for (const id of DECK_ICON_IDS) {
    assert.ok(deckIconHtml(id).length > 0, `${id} produced nothing`);
  }
});

test('an unknown deck renders nothing rather than a broken box', () => {
  assert.equal(deckIconHtml('nope'), '');
  assert.equal(deckIconHtml(/** @type {any} */ (undefined)), '');
  assert.equal(deckIconHtml(/** @type {any} */ (null)), '');
});

// The `<img>` icons point at real files. A typo here is invisible until the
// icon silently fails to load in a browser, which no unit test would catch.
test('asset-backed icons point at files that exist', () => {
  for (const id of DECK_ICON_IDS) {
    const html = deckIconHtml(id, { base: '' });
    const m = html.match(/src="([^"]+)"/);
    if (!m) continue;
    assert.ok(existsSync(join(HERE, '..', m[1])), `${id}: missing asset ${m[1]}`);
  }
});

test('base prefixes the asset URLs, defaulting to one level up', () => {
  assert.match(deckIconHtml('flags'), /src="\.\.\/flags\/svg\/fr\.svg"/);
  assert.match(deckIconHtml('flags', { base: '../../' }), /src="\.\.\/\.\.\/flags\/svg\/fr\.svg"/);
  assert.match(deckIconHtml('outlines', { base: '' }), /src="flags\/contours\/it\.svg"/);
});

// The whole reason sizing is NOT baked in: the two consumers need different
// boxes for the same artwork.
test('className lands on the root element of every icon kind', () => {
  for (const id of DECK_ICON_IDS) {
    const html = deckIconHtml(id, { className: 'probe-class' });
    assert.match(html, /^<(img|svg) class="probe-class"/, `${id}: class not on the root`);
  }
});

test('no className means no class attribute at all', () => {
  for (const id of DECK_ICON_IDS) {
    assert.doesNotMatch(deckIconHtml(id), /class=/, `${id}: leaked an empty class`);
  }
});

test('the inline icons are self-contained (no asset request)', () => {
  for (const id of ['weird', 'facts']) {
    const html = deckIconHtml(id);
    assert.match(html, /^<svg/, `${id} should be inline SVG`);
    assert.doesNotMatch(html, /src=/, `${id} should not fetch anything`);
  }
});

test('facts is monochrome so it inherits the surrounding colour', () => {
  // Flag artwork carries its own colours by nature; the chart must not, or it
  // can't sit in a muted text row and a primary-coloured list at once.
  assert.match(deckIconHtml('facts'), /fill="currentColor"/);
});

test('weird is the Jolly Roger, not a real country flag', () => {
  // Pins the reasoning, not just the bytes: it must be a symbol FOR the
  // non-sovereign pool, never a sample FROM it. A country flag here (e.g.
  // Nepal, the intuitive pick) would depict a flag in the OTHER deck.
  const html = deckIconHtml('weird');
  assert.doesNotMatch(html, /flags\/svg\//, 'weird must not point at a country flag asset');
  assert.match(html, /<ellipse/, 'expected the skull');
});
