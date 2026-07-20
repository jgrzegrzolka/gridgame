import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { PICTURE_MODES, METRIC_MODES } from '../flags/partyPlan.js';
import { METRIC_FAMILIES } from '../flags/partyDraft.js';
import { METRIC_SHORT } from '../flags/metricVisuals.js';
import { deckIconHtml } from '../flags/deckIcons.js';
import { GAME_LENGTHS } from '../flags/partyDraft.js';
import {
  modeShortLabel,
  modeFullLabel,
  modeSubLabel,
  roundModeId,
  modeIconHtml,
  modeHue,
  roundCardIconHtml,
  lengthIconHtml,
  roundPipStates,
} from './page.js';

// Every id that can reach a label lookup: the picture modes, every metric mode
// (the round title names the RESOLVED mode, so members still need labels), and
// every metric FAMILY (the pick card names the family). Each MUST resolve a real
// label — an undefined key is what crashed the lobby, and for a family card it
// would also send the picker into the stale-client reload path for no reason.
const ALL_MODE_IDS = [...PICTURE_MODES, ...METRIC_MODES].map((m) => m.id);

/** Everything a HAND can contain: picture modes plus metric families. Families
 *  are cards, not modes, so they need a full label (the card) but never a short
 *  one — the round title card names the mode the family RESOLVED to, which is
 *  always an ordinary catalog mode. */
const ALL_CARD_IDS = [...PICTURE_MODES.map((m) => m.id), ...METRIC_FAMILIES.map((f) => f.id)];

/**
 * Regression guard for the crash that blanked the whole Flag Party lobby on
 * prod: population's mode id (`superlative-pop`) differs from its question id
 * (`superlative`), and the short-label resolver keyed off the wrong one, so it
 * returned an `undefined` key. That undefined key reached `t()` →
 * `lookupString(undefined)` → `undefined.split` and killed the boot render.
 *
 * The invariant that can never regress unnoticed again: EVERY party mode must
 * resolve a defined, non-empty label key + fallback. Before the fix this failed
 * on `superlative-pop`; adding a metric mode whose METRIC_SHORT entry is missing
 * (or a picture mode with no `shortKey`) would fail it too.
 */
test('every party mode resolves a defined SHORT label (key + fallback)', () => {
  for (const id of ALL_MODE_IDS) {
    const { key, fallback } = modeShortLabel(id);
    assert.equal(typeof key, 'string', `mode "${id}" has no short-label key`);
    assert.ok(/** @type {string} */ (key).length > 0, `mode "${id}" short-label key is empty`);
    assert.equal(typeof fallback, 'string', `mode "${id}" has no short-label fallback`);
    assert.ok(/** @type {string} */ (fallback).length > 0, `mode "${id}" short-label fallback is empty`);
  }
});

test('every party mode resolves a defined FULL label (key + fallback)', () => {
  for (const id of [...ALL_MODE_IDS, ...ALL_CARD_IDS]) {
    const { key, fallback } = modeFullLabel(id);
    assert.equal(typeof key, 'string', `mode "${id}" has no full-label key`);
    assert.ok(/** @type {string} */ (key).length > 0, `mode "${id}" full-label key is empty`);
    assert.equal(typeof fallback, 'string', `mode "${id}" has no full-label fallback`);
    assert.ok(/** @type {string} */ (fallback).length > 0, `mode "${id}" full-label fallback is empty`);
  }
});

test('population mode (id superlative-pop / questionId superlative) resolves the population metric short label — the exact case that crashed prod', () => {
  assert.deepEqual(modeShortLabel('superlative-pop'), {
    key: METRIC_SHORT.population.key,
    fallback: METRIC_SHORT.population.fallback,
  });
});

// The round title card (isRoundStart) resolves which mode to announce from what
// the client knows: a draft pick names the mode precisely, a custom round falls
// back to the question id, and the two flag pools (which share one question id) can
// only be announced generically without a pick.
test('roundModeId: a draft pick names the exact mode, over the question id', () => {
  // A picked stat round: the specific metric, not the generic superlative.
  assert.equal(roundModeId({ picker: 'p1', modeId: 'superlative-coffee' }, 'superlative-coffee'), 'superlative-coffee');
  // A picked flag round: the pool the pick chose, which the question id can't reveal.
  assert.equal(roundModeId({ picker: 'p1', modeId: 'flags-weird' }, 'flagPick'), 'flags-weird');
  assert.equal(roundModeId({ picker: 'p1', modeId: 'flags-all' }, 'flagPick'), 'flags-all');
});

test('roundModeId: a custom round derives the mode from the question id', () => {
  assert.equal(roundModeId(null, 'mapPick'), 'map-outlines');
  assert.equal(roundModeId(null, 'superlative-coffee'), 'superlative-coffee');
  // population's legacy question id (`superlative`) maps back to its mode id.
  assert.equal(roundModeId(null, 'superlative'), 'superlative-pop');
});

test('roundModeId: an unpicked flag round is generic (the two pools share one question id)', () => {
  assert.equal(roundModeId(null, 'flagPick'), null);
});

test('roundModeId: an unknown / missing question id is generic', () => {
  assert.equal(roundModeId(null, 'someFutureQuestion'), null);
  assert.equal(roundModeId(null, undefined), null);
  // a stale pick whose mode id isn't in the catalog falls through to the question id
  assert.equal(roundModeId({ picker: 'p1', modeId: 'gone' }, 'mapPick'), 'map-outlines');
});

/**
 * The pick card names the SUBJECT, never the direction.
 *
 * The direction a superlative is dealt in ('most' / 'least') is chosen by the
 * server when the round starts, and the player is told which via the round title
 * and the in-question criterion label (`hintFor`). Repeating it on the pick card
 * is noise at best — "Olive oil production: most", "Happiness score: happiest &
 * least happy" — and on the two-directional metrics it is not even information,
 * since "most & least" describes every one of them.
 *
 * These guards exist because the suffix is easy to reintroduce: the natural
 * instinct when adding a metric is to copy a neighbouring label, and every
 * neighbour carried the suffix until this change. The check runs over the
 * English fallbacks in MODE_LABELS AND over both shipped locales, because the
 * label a player actually reads comes from i18n — the fallback only shows up if
 * a key is missing, so pinning it alone would let pl.json drift back silently
 * (and pl is where this was first spotted, on a real screen).
 */
const DIRECTION_WORDS = {
  en: ['most', 'least', 'largest', 'smallest', 'highest', 'lowest', 'longest',
    'shortest', 'hottest', 'coldest', 'happiest', 'corrupt', 'forested'],
  // Polish inflects, so match on stems: "najwięcej" / "największe" / "najwyższy"
  // all start "naj-", which is the superlative prefix and the only marker needed.
  pl: ['naj', 'skorumpowane'],
};

/** Metric mode ids only: the picture trio's labels ("Flags: countries", "Map:
 *  outlines") name a POOL, not a direction, and are deliberately left alone. */
const METRIC_MODE_IDS = METRIC_MODES.map((m) => m.id);

test('no metric mode fallback label states a direction', () => {
  for (const id of METRIC_MODE_IDS) {
    const { fallback } = modeFullLabel(id);
    const label = /** @type {string} */ (fallback);
    for (const word of DIRECTION_WORDS.en) {
      assert.ok(
        !new RegExp(`\\b${word}`, 'i').test(label),
        `mode "${id}" label "${label}" states a direction ("${word}") — the pick card names the subject only`,
      );
    }
  }
});

for (const lang of /** @type {const} */ (['en', 'pl'])) {
  test(`no metric mode label in ${lang}.json states a direction`, async () => {
    const strings = JSON.parse(await readFile(new URL(`../i18n/${lang}.json`, import.meta.url), 'utf8'));
    for (const id of METRIC_MODE_IDS) {
      const { key } = modeFullLabel(id);
      // 'party.mode.superlativeCoffee' → strings.party.mode.superlativeCoffee
      const label = /** @type {string} */ (key).split('.').reduce((o, k) => (o == null ? o : o[k]), strings);
      assert.equal(typeof label, 'string', `mode "${id}" has no ${lang}.json entry at ${key}`);
      for (const word of DIRECTION_WORDS[lang]) {
        assert.ok(
          !label.toLowerCase().includes(word),
          `mode "${id}" ${lang} label "${label}" states a direction ("${word}") — the pick card names the subject only`,
        );
      }
    }
  });
}

// ---- metric family cards ----

test('every hand card this build can be dealt has a label — the stale-guard contract', () => {
  // `canRenderHand` refuses a hand containing an id MODE_LABELS doesn't cover and
  // reloads the tab. Within ONE build that must never fire: a family added to the
  // catalog and forgotten here would send every picker into a reload, then into
  // the "update needed" notice, in a game where nothing is actually stale.
  for (const id of ALL_CARD_IDS) {
    const { key, fallback } = modeFullLabel(id);
    assert.equal(typeof key, 'string', `card "${id}" has no label key`);
    assert.equal(typeof fallback, 'string', `card "${id}" has no label fallback`);
  }
});

test('a family card carries a sub-label, an ordinary mode does not', () => {
  // The sub-label is the honesty line: it states the range a family can resolve
  // to, so the round reads as a reveal rather than a substitution. A card that can
  // only be one thing has nothing to disclose and must not grow a second line.
  const economy = modeSubLabel('economy');
  assert.ok(economy, 'the economy family has no sub-label');
  assert.equal(typeof economy.key, 'string');
  assert.ok(economy.fallback.length > 0);

  for (const id of ALL_MODE_IDS) {
    assert.equal(modeSubLabel(id), null, `mode "${id}" grew a sub-label`);
  }
});

test('every multi-member family discloses its range', () => {
  // Derived from the catalog rather than naming `economy`, so the next family
  // cannot ship without its disclosure line.
  for (const f of METRIC_FAMILIES) {
    if (f.memberIds.length === 1) continue;
    assert.ok(modeSubLabel(f.id), `family "${f.id}" groups ${f.memberIds.length} metrics but discloses nothing`);
  }
});

// ---- card visuals: icon + hue ------------------------------------------
// The JSDoc on `metricKeyForQuestion` records that this already broke once:
// population prompts rendered with no icon and no hue. Families made the
// failure easier to reach, because a hand card can now be an id (`economy`,
// `olympicMedals`, `population`) that is not a catalog mode at all, so every
// resolver has to route through the family's representative first.

test('every card the draft can deal resolves an icon', () => {
  // ALL_CARD_IDS is what handFor deals: picture modes plus metric FAMILIES.
  for (const id of ALL_CARD_IDS) {
    const html = modeIconHtml(id);
    assert.equal(typeof html, 'string');
    assert.ok(html.length > 0, `card "${id}" would render with no icon`);
  }
});

test('every metric family card resolves a hue', () => {
  // The picture modes carry no metric hue by design (they use their thumbnail),
  // so the claim is scoped to the metric families.
  for (const f of METRIC_FAMILIES) {
    const hue = modeHue(f.id);
    assert.ok(hue, `family "${f.id}" would render with no accent hue`);
    assert.match(hue, /^#[0-9a-f]{6}$/i, `family "${f.id}" hue is not a hex colour: ${hue}`);
  }
});

test('a family wears its representative’s icon and hue, not a blank', () => {
  // The specific regression families introduced: resolving the family id as if
  // it were a mode id yields undefined, which used to fall through to ''.
  for (const f of METRIC_FAMILIES) {
    if (f.memberIds.length < 2) continue;
    assert.equal(modeIconHtml(f.id), modeIconHtml(f.representativeId), f.id);
    assert.equal(modeHue(f.id), modeHue(f.representativeId), f.id);
  }
});

test('every concrete mode a family resolves to has its own icon and hue', () => {
  // A family card is picked once, then deals ONE member. The round that follows
  // wears that member's visuals, so every member needs them too, not just the
  // representative the card showed.
  for (const f of METRIC_FAMILIES) {
    for (const memberId of f.memberIds) {
      assert.ok(modeIconHtml(memberId).length > 0, `mode "${memberId}" has no icon`);
      assert.ok(modeHue(memberId), `mode "${memberId}" has no hue`);
    }
  }
});

test('every round title card resolves artwork', () => {
  // roundCardIconHtml takes the RESOLVED mode id (the round actually being
  // played), never a family id, so it is pinned against the mode catalog.
  for (const m of [...PICTURE_MODES, ...METRIC_MODES]) {
    assert.ok(roundCardIconHtml(m.id).length > 0, `round card "${m.id}" would render blank`);
  }
});

test('the round card crops its inline-svg artwork to the circle', () => {
  // `.roundcard-thumb` crops to a circle with `object-fit: cover`, which only
  // applies to replaced elements. The weird deck's artwork is an inline <svg>,
  // so it needs `preserveAspectRatio="slice"` to cover instead — without it the
  // 32x24 viewBox letterboxes and the circle shows transparent wedges top and
  // bottom. Nothing about that failure throws, so only this pin catches it.
  assert.match(roundCardIconHtml('flags-weird'), /preserveAspectRatio="xMidYMid slice"/);
  // The rectangle is still correct everywhere the icon is identified rather than
  // used as the card's hero, so the shared helper must NOT have been changed.
  assert.doesNotMatch(deckIconHtml('weird'), /preserveAspectRatio/);
});

test('every game length draws its own number of strokes', () => {
  // The stroke count IS the length, so the control reads as "longer" before the
  // label does. One / two / three, and never the same picture twice.
  const counts = GAME_LENGTHS.map((l) => (lengthIconHtml(l).match(/<path/g) || []).length);
  assert.deepEqual(counts, [1, 2, 3], 'short/medium/long draw 1/2/3 strokes');
  // currentColor throughout, so the stylesheet owns the accent and the
  // step-back on the two that are not chosen.
  for (const l of GAME_LENGTHS) assert.match(lengthIconHtml(l), /currentColor/);
});

test('round pips: one per round, marking played / current / to come', () => {
  assert.deepEqual(roundPipStates(1, 6), ['now', '', '', '', '', '']);
  assert.deepEqual(roundPipStates(3, 6), ['done', 'done', 'now', '', '', '']);
  assert.deepEqual(roundPipStates(6, 6), ['done', 'done', 'done', 'done', 'done', 'now']);
});

test('round pips: exactly one is current, and the count matches the game', () => {
  // The row is the whole "where are we" signal now that the card no longer says
  // "Round 3 of 6" in words, so both properties are load-bearing.
  for (const total of [4, 6, 10, 20]) {
    for (let r = 1; r <= total; r++) {
      const pips = roundPipStates(r, total);
      assert.equal(pips.length, total, `${r}/${total} length`);
      assert.equal(pips.filter((p) => p === 'now').length, 1, `${r}/${total} one current`);
      assert.equal(pips.filter((p) => p === 'done').length, r - 1, `${r}/${total} played`);
    }
  }
});

test('round pips: a junk round number never paints a current dot', () => {
  // Unreachable in play; this is the guard. Nothing should throw or mark two.
  for (const bad of [0, -3, NaN, 99]) {
    const pips = roundPipStates(/** @type {any} */ (bad), 6);
    assert.equal(pips.length, 6);
    assert.ok(pips.filter((p) => p === 'now').length <= 1, String(bad));
  }
});

test('an unknown length degrades to empty rather than a broken box', () => {
  for (const bad of ['huge', '', 'Short', undefined]) {
    assert.equal(lengthIconHtml(/** @type {any} */ (bad)), '', String(bad));
  }
});

test('an unknown card id degrades to empty rather than throwing', () => {
  // A stale client can hold an id this build never heard of; staleGuard reloads
  // it, but the resolvers must not throw on the way there.
  assert.equal(modeIconHtml('not-a-mode'), '');
  assert.equal(modeHue('not-a-mode'), null);
  assert.equal(roundCardIconHtml('not-a-mode'), '');
});
