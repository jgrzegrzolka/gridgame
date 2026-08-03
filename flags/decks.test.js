import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  DECKS,
  deckOf,
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

test('every deck has an icon', () => {
  for (const d of DECKS) {
    assert.ok(/** @type {readonly string[]} */ (DECK_ICON_IDS).includes(d.id), `deck "${d.id}" has no icon`);
  }
});

// The converse is NOT pinned, and that is the point. `DECK_ICON_IDS` is a
// shared artwork catalog: flagQuiz draws two of them (its decks), Flag Party
// draws four (its round types). It briefly matched DECKS exactly, back when
// flagQuiz had a deck per icon, and asserting that again would mean deleting a
// Flag Party icon the next time a flagQuiz deck is removed — which is exactly
// the wrong pressure. Each consumer pins what IT needs.
test('the icons flagQuiz does not use belong to Flag Party, not to nothing', () => {
  const unused = DECK_ICON_IDS.filter((id) => !DECKS.some((d) => d.id === id));
  assert.deepEqual([...unused], ['outlines', 'spot'], 'an icon with no consumer at all is dead artwork');
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

test('every listed variant is real, and round-trips back to its own deck', () => {
  // Was two tests over `defaultVariantForDeck`, which went with the burger's
  // deck-tap. The invariant it protected is worth more than the accessor was,
  // so it now runs over every variant rather than just each deck's first: a
  // pool chip in the settings tray is built from these ids, and one that isn't
  // a real VARIANTS key renders a chip that throws when tapped.
  for (const d of DECKS) {
    assert.ok(d.variants.length > 0, `${d.id}: no variants`);
    for (const v of d.variants) {
      assert.ok(VARIANTS[v], `${d.id}: "${v}" is not a real variant`);
      assert.equal(deckOf(v), d.id, `${d.id}: "${v}" round-trips to another deck`);
    }
  }
});

test('deck ids are unique and non-empty', () => {
  const ids = DECKS.map((d) => d.id);
  assert.deepEqual([...new Set(ids)], ids, 'duplicate deck id');
  for (const id of ids) assert.ok(id.length > 0);
});
