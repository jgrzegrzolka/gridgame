import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  DECKS,
  deckOf,
  variantsForDeck,
  defaultVariantForDeck,
  deckHasScopes,
  allDeckVariants,
  decksCoverVariants,
} from './decks.js';
import { VARIANTS } from './quiz.js';
import { DECK_ICON_IDS } from './deckIcons.js';

// THE drift test. A variant no deck claims is still playable via `?v=` but is
// unreachable from the burger and shows no indicator — exactly the silent gap
// that let the `weird` deck ship with no map. A new variant now fails CI until
// someone decides which deck it belongs to.
test('every variant belongs to exactly one deck', () => {
  const claimed = allDeckVariants();
  const orphans = Object.keys(VARIANTS).filter((k) => !claimed.includes(k));
  assert.deepEqual(orphans, [], `variants no deck claims (unreachable from the UI): ${orphans.join(', ')}`);

  const dupes = claimed.filter((k, i) => claimed.indexOf(k) !== i);
  assert.deepEqual(dupes, [], `variants claimed by more than one deck: ${dupes.join(', ')}`);

  const ghosts = claimed.filter((k) => !VARIANTS[k]);
  assert.deepEqual(ghosts, [], `decks listing variants that don't exist: ${ghosts.join(', ')}`);

  assert.equal(decksCoverVariants(), true);
});

test('every deck has an icon, and every icon has a deck or is a future phase', () => {
  for (const d of DECKS) {
    assert.ok(/** @type {readonly string[]} */ (DECK_ICON_IDS).includes(d.id), `deck "${d.id}" has no icon`);
  }
  // outlines + facts have icons already (they ship in flagParty) but no deck
  // until Phases 3/4. That's expected, not drift.
  const pending = DECK_ICON_IDS.filter((id) => !DECKS.some((d) => d.id === id));
  assert.deepEqual([...pending], ['outlines', 'facts'], 'unexpected icon/deck mismatch');
});

test('deckOf maps each variant to its deck', () => {
  assert.equal(deckOf('countries'), 'flags');
  assert.equal(deckOf('europe'), 'flags');
  assert.equal(deckOf('oceania'), 'flags');
  assert.equal(deckOf('weird'), 'weird');
});

test('deckOf falls back to flags for an unknown variant', () => {
  // A stale ?v= or a lastVariant saved by a future build must still leave the
  // play screen with an indicator rather than nothing.
  assert.equal(deckOf('mars'), 'flags');
  assert.equal(deckOf(''), 'flags');
});

test('variantsForDeck returns display order, and a copy', () => {
  assert.deepEqual(variantsForDeck('flags'), [
    'countries', 'europe', 'asia', 'africa', 'north-america', 'south-america', 'oceania',
  ]);
  assert.deepEqual(variantsForDeck('weird'), ['weird']);
  assert.deepEqual(variantsForDeck('nope'), []);
  // Mutating the result must not corrupt the table for the next caller.
  variantsForDeck('flags').push('hacked');
  assert.equal(variantsForDeck('flags').length, 7);
});

// The rule the burger's reactive scope list is built on. Derived from the
// deck's own shape, so Phases 3/4 (world-only, one variant each) get the right
// behaviour without anyone remembering to add them to a list.
test('deckHasScopes is true only where there is a choice to make', () => {
  assert.equal(deckHasScopes('flags'), true, 'seven variants — offer the list');
  assert.equal(deckHasScopes('weird'), false, 'one variant — nothing to pick');
  assert.equal(deckHasScopes('nope'), false);
});

test('defaultVariantForDeck is the deck first variant', () => {
  assert.equal(defaultVariantForDeck('flags'), 'countries');
  assert.equal(defaultVariantForDeck('weird'), 'weird');
  assert.equal(defaultVariantForDeck('nope'), null);
});

test('tapping a deck always lands on a real, playable variant', () => {
  for (const d of DECKS) {
    const v = defaultVariantForDeck(d.id);
    assert.ok(v, `${d.id}: no default variant`);
    assert.ok(VARIANTS[v], `${d.id}: default variant "${v}" is not a real variant`);
    assert.equal(deckOf(v), d.id, `${d.id}: its default variant round-trips to another deck`);
  }
});

test('deck ids are unique and non-empty', () => {
  const ids = DECKS.map((d) => d.id);
  assert.deepEqual([...new Set(ids)], ids, 'duplicate deck id');
  for (const id of ids) assert.ok(id.length > 0);
});
