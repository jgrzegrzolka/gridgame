import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
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
  assert.match(deckIconHtml('flags'), /src="\.\.\/flags\/glyphFlag\.svg"/);
  assert.match(deckIconHtml('flags', { base: '../../' }), /src="\.\.\/\.\.\/flags\/glyphFlag\.svg"/);
  assert.match(deckIconHtml('outlines', { base: '' }), /src="flags\/contours\/it\.svg"/);
});

test('flags is the invented generic flag, not a real country', () => {
  // Same reasoning the `weird` pin below records, applied to the deck that most
  // invites the shortcut: any real flag here reads as "the France round" rather
  // than "the flags round", because players recognise the country before they
  // read the label. It was fr.svg until #1086.
  assert.doesNotMatch(deckIconHtml('flags'), /flags\/svg\//, 'must not point at a country flag asset');
});

test('the deck icon and the criteria glyph are the same invented flag', () => {
  // The mark means "a flag" on both surfaces, so it must LOOK the same on both.
  // They are two files because they are framed differently — filterChips draws it
  // square (padded inside a 24x24 viewBox) to sit beside the square motif icons in
  // a text row, while the asset is edge-to-edge to fill an icon slot that crops.
  // Nothing but this test stops one hue being retouched and the other drifting.
  const asset = readFileSync(join(HERE, 'glyphFlag.svg'), 'utf8');
  const chips = readFileSync(join(HERE, 'filterChips.js'), 'utf8');
  const glyph = chips.match(/const FLAG_GLYPH =\s*\n?\s*'([^']*)'/);
  assert.ok(glyph, 'FLAG_GLYPH not found in filterChips.js — did it move?');
  for (const hue of ['#2a9d8f', '#f4efe6']) {
    assert.ok(asset.includes(hue), `glyphFlag.svg lost ${hue}`);
    assert.ok(glyph[1].includes(hue), `FLAG_GLYPH lost ${hue}`);
  }
  // Three shapes each: the field, the vertical bar, the horizontal bar. A cross
  // that lost an arm on one surface and kept it on the other is the failure mode
  // the hue check alone would miss.
  assert.equal((asset.match(/<rect/g) || []).length, 3);
  assert.equal((glyph[1].match(/<rect/g) || []).length, 3);
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
