import test from 'node:test';
import assert from 'node:assert/strict';

import {
  poolOptions,
  modeOptions,
  roundPillModel,
  roundQuery,
  resolveRoundConfig,
} from './roundSettings.js';
import { VARIANTS, MODES, defaultModeFor } from '../flags/quiz.js';
import { allDeckVariants } from '../flags/decks.js';

/** Identity `t` — returns the fallback, so the tests read the English labels. */
const t = (_key, fallback) => fallback;

// ---- poolOptions ----

test('poolOptions offers every variant the decks claim, in deck order', () => {
  // The tray is the ONLY way to change pool now that the burger's deck
  // pills and continent list are gone. A variant missing here is a pool
  // the player can no longer reach at all — so pin the full list, not
  // just its length.
  assert.deepEqual(
    poolOptions('countries').map((o) => o.key),
    allDeckVariants(),
  );
});

test('poolOptions covers every known VARIANTS key', () => {
  // Guards the same unreachability from the other side: a variant added
  // to VARIANTS but not to a deck would silently never appear in the tray.
  const offered = new Set(poolOptions('countries').map((o) => o.key));
  for (const key of Object.keys(VARIANTS)) {
    assert.ok(offered.has(key), `variant "${key}" is not reachable from the tray`);
  }
});

test('poolOptions marks exactly one option active', () => {
  const active = poolOptions('oceania').filter((o) => o.active);
  assert.deepEqual(active.map((o) => o.key), ['oceania']);
});

test('poolOptions marks nothing active for an unknown variant', () => {
  // A stale `?v=` shouldn't light up an unrelated chip.
  assert.equal(poolOptions('atlantis').some((o) => o.active), false);
});

test('poolOptions carries the deck each pool belongs to', () => {
  const byKey = new Map(poolOptions('countries').map((o) => [o.key, o.deck]));
  assert.equal(byKey.get('countries'), 'flags');
  assert.equal(byKey.get('europe'), 'flags');
  // The flattening keeps the deck alongside each pool rather than dropping
  // it — the pill's icon is derived from it.
  assert.equal(byKey.get('weird'), 'weird');
});

test('poolOptions marks only the pools that are a different kind of question', () => {
  // Seven chips wearing the same flag glyph decorate the tray and say
  // nothing — the world and the continents ARE the ordinary deck. The mark
  // is for where the kind of question changes.
  const marked = poolOptions('countries').filter((o) => o.marked).map((o) => o.key);
  assert.deepEqual(marked, ['weird']);
});

// ---- modeOptions ----

test('modeOptions offers every mode, time-attack first', () => {
  assert.deepEqual(modeOptions('60s').map((o) => o.key), Object.keys(MODES));
  assert.equal(modeOptions('60s')[0].key, defaultModeFor());
});

test('modeOptions marks exactly one option active', () => {
  const active = modeOptions('all').filter((o) => o.active);
  assert.deepEqual(active.map((o) => o.key), ['all']);
});

// ---- roundPillModel ----

test('roundPillModel reads back both answers, pool first', () => {
  assert.deepEqual(roundPillModel({ variantKey: 'countries', modeKey: '60s', t }), {
    deck: 'flags',
    label: 'All countries · 60s',
  });
});

test('roundPillModel wears the deck icon of the pool it names', () => {
  // Flags and Weird flags render identically once the round starts — four
  // flag tiles either way — so the icon is the only thing on screen saying
  // which pool you are in. That job moved from the retired deck indicator
  // onto the pill.
  assert.equal(roundPillModel({ variantKey: 'weird', modeKey: '60s', t }).deck, 'weird');
  assert.equal(roundPillModel({ variantKey: 'asia', modeKey: 'all', t }).deck, 'flags');
});

test('roundPillModel falls back to the raw key for an unknown variant', () => {
  // A stale `?v=` must still produce a readable pill rather than throwing
  // on VARIANTS[key].label.
  assert.equal(
    roundPillModel({ variantKey: 'atlantis', modeKey: '60s', t }).label,
    'atlantis · 60s',
  );
});

test('roundPillModel takes its words from t, not from the English labels', () => {
  const pl = (key) => (key === 'variant.europe' ? 'Europa' : 'bez zegara');
  assert.equal(
    roundPillModel({ variantKey: 'europe', modeKey: 'all', t: pl }).label,
    'Europa · bez zegara',
  );
});

// ---- roundQuery ----

test('roundQuery describes the configuration the player is actually in', () => {
  assert.equal(roundQuery('north-america', 'all'), '?v=north-america&n=all');
});

test('roundQuery round-trips back through resolveRoundConfig', () => {
  // The address bar is what the share button copies. If a shared link
  // didn't reproduce the round, the share would be a lie — so pin the
  // loop rather than the string alone.
  const query = roundQuery('weird', 'all');
  const params = new URLSearchParams(query);
  assert.deepEqual(
    resolveRoundConfig({
      urlVariant: params.get('v'),
      urlMode: params.get('n'),
      savedVariant: 'countries',
      savedMode: '60s',
      defaultVariant: 'countries',
      defaultMode: '60s',
    }),
    { variantKey: 'weird', modeKey: 'all' },
  );
});

// ---- resolveRoundConfig ----

test('resolveRoundConfig prefers the URL over the saved pick', () => {
  assert.deepEqual(
    resolveRoundConfig({
      urlVariant: 'asia', urlMode: 'all',
      savedVariant: 'europe', savedMode: '60s',
      defaultVariant: 'countries', defaultMode: '60s',
    }),
    { variantKey: 'asia', modeKey: 'all' },
  );
});

test('resolveRoundConfig resolves the two axes independently', () => {
  // A shared continent link (`?v=europe`, no `?n=`) used to reset the mode
  // to 60s because both axes were read off the same URL. Now the pool comes
  // from the link and the clock stays where the player left it.
  assert.deepEqual(
    resolveRoundConfig({
      urlVariant: 'europe', urlMode: null,
      savedVariant: 'countries', savedMode: 'all',
      defaultVariant: 'countries', defaultMode: '60s',
    }),
    { variantKey: 'europe', modeKey: 'all' },
  );
});

test('resolveRoundConfig falls back to the saved pick, then the default', () => {
  assert.deepEqual(
    resolveRoundConfig({
      urlVariant: null, urlMode: null,
      savedVariant: 'africa', savedMode: 'all',
      defaultVariant: 'countries', defaultMode: '60s',
    }),
    { variantKey: 'africa', modeKey: 'all' },
  );
  assert.deepEqual(
    resolveRoundConfig({
      urlVariant: null, urlMode: null,
      savedVariant: null, savedMode: null,
      defaultVariant: 'countries', defaultMode: '60s',
    }),
    { variantKey: 'countries', modeKey: '60s' },
  );
});

test('resolveRoundConfig ignores unknown keys from either source', () => {
  // `10q` was a real mode until the Statistics deck went, and a cached
  // client can still send it. An unknown value must fall through to the
  // next source rather than reaching targetFor, which throws on it.
  assert.deepEqual(
    resolveRoundConfig({
      urlVariant: 'atlantis', urlMode: '10q',
      savedVariant: 'europe', savedMode: 'all',
      defaultVariant: 'countries', defaultMode: '60s',
    }),
    { variantKey: 'europe', modeKey: 'all' },
  );
  assert.deepEqual(
    resolveRoundConfig({
      urlVariant: null, urlMode: null,
      savedVariant: 'atlantis', savedMode: '10q',
      defaultVariant: 'countries', defaultMode: '60s',
    }),
    { variantKey: 'countries', modeKey: '60s' },
  );
});
