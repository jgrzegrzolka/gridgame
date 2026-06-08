import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeLangRefreshPayload,
  bindTileCountry,
  refreshTileNames,
} from './langRefresh.js';
import { createCountry } from './flags/group.js';
import { emptyFilters } from './flags/flagsFilter.js';
import { _seedCacheForTests, _resetCacheForTests } from './i18n.js';

// computeLangRefreshPayload is the pure half of the soft-language-switch
// handler. Tests pin two invariants the call sites depend on:
//
//  1. the produced `all` carries the new language's name as an alias on
//     every translated country — that's what the suggestion matcher
//     reads. A regression here silently breaks Polish-name guesses
//     after a lang switch.
//  2. the produced `targets` are exactly the puzzle's targets resolved
//     in the new `all`, identified by `code` — anything else would let
//     a stale Country object slip through and the matcher would treat
//     the wrong flag as "the goal."

function sovereign(/** @type {string} */ code, /** @type {string} */ name) {
  return createCountry({
    code,
    name,
    category: 'country',
    continent: 'Europe',
    primaryColors: ['white', 'red'],
    additionalColors: [],
  });
}

test('computeLangRefreshPayload: re-aliases every translated country so the matcher accepts the new language', () => {
  _seedCacheForTests({ country: { pl: 'Polska', de: 'Niemcy' } });
  const raw = [sovereign('pl', 'Poland'), sovereign('de', 'Germany'), sovereign('us', 'United States')];
  const targetCodes = new Set(['pl']);

  const payload = computeLangRefreshPayload({
    raw,
    targetCodes,
    filter: emptyFilters(),
  });

  const byCode = new Map(payload.all.map((c) => [c.code, c]));
  assert.deepEqual(byCode.get('pl').aliases, ['Polska'],
    'Polish translation must appear on the pl Country as an alias');
  assert.deepEqual(byCode.get('de').aliases, ['Niemcy']);
  // No translation for 'us' → withLocalizedAliases passes it through
  // unchanged, so aliases stay undefined (the canonical "no aliases" shape).
  assert.equal(byCode.get('us').aliases, undefined);
  _resetCacheForTests();
});

test('computeLangRefreshPayload: targets are the rebuilt Country objects matched by code', () => {
  _seedCacheForTests({ country: { pl: 'Polska' } });
  const raw = [sovereign('pl', 'Poland'), sovereign('de', 'Germany'), sovereign('us', 'United States')];
  const targetCodes = new Set(['pl', 'de']);

  const payload = computeLangRefreshPayload({
    raw,
    targetCodes,
    filter: emptyFilters(),
  });

  // The targets must be from `all` (not the raw input) — they have to
  // carry the new aliases for the matcher to work.
  const targetIsFromAll = payload.targets.every((t) => payload.all.includes(t));
  assert.ok(targetIsFromAll, 'each target must be one of the freshly re-aliased Country objects');

  // And the right codes are in there, regardless of source-array order.
  assert.deepEqual(payload.targets.map((c) => c.code).sort(), ['de', 'pl']);
  _resetCacheForTests();
});

test('computeLangRefreshPayload: filters out non-sovereign entries before re-aliasing', () => {
  // flagsGamePool(raw, false) drops territories and "other" — the play
  // pool is sovereign-only. computeLangRefreshPayload runs that filter,
  // so a target whose code only exists in the non-sovereign tail won't
  // surface in `targets`. The caller relies on this to keep the
  // suggestion pool aligned with the puzzle's universe.
  _resetCacheForTests();
  const raw = [
    sovereign('pl', 'Poland'),
    createCountry({
      code: 'gi', name: 'Gibraltar', category: 'country', continent: 'Europe',
      statehood: 'territory',
      primaryColors: ['white', 'red'], additionalColors: [],
    }),
  ];
  const payload = computeLangRefreshPayload({
    raw,
    targetCodes: new Set(['pl', 'gi']),
    filter: emptyFilters(),
  });
  assert.deepEqual(payload.all.map((c) => c.code), ['pl'],
    'gi is a territory — flagsGamePool(_, false) must drop it');
  assert.deepEqual(payload.targets.map((c) => c.code), ['pl'],
    'a targetCode that no longer resolves in the sovereign pool is silently skipped');
});

test('computeLangRefreshPayload: label comes from filterToCategory(filter, t) so it re-translates on each call', () => {
  // Pillabel uses variant.<lowercase-with-dashes>; pinning that here
  // proves the t() lookup is being invoked at compute time, not baked
  // in at boot. The exact phrasing is filterToCategory's contract; what
  // we care about is that the *current* cache (not the boot-time cache)
  // is what feeds the label.
  _seedCacheForTests({ variant: { europe: 'Europa' } });
  const raw = [sovereign('pl', 'Poland')];
  const filter = emptyFilters();
  filter.continent.include.add('Europe');

  const payload = computeLangRefreshPayload({
    raw,
    targetCodes: new Set(['pl']),
    filter,
  });

  assert.ok(payload.label.includes('Europa'),
    `expected label to include the Polish "Europa"; got: ${payload.label}`);
  _resetCacheForTests();
});

// ---- bindTileCountry + refreshTileNames ----
//
// Tile name refresh is what keeps the CSS hover overlay
// (`.find-tile::after { content: attr(data-name) }`) and the screen-
// reader `<img>.alt` in the active language after a soft language
// switch. The contract is: every tile created via `bindTileCountry`
// re-translates its display name on `refreshTileNames(doc)`; tiles
// that weren't registered (e.g. result-screen placeholders) pass
// through untouched.

function fakeTileDoc(tilesSpec) {
  /** @type {any[]} */
  const allTiles = [];
  for (const spec of tilesSpec) {
    const img = {
      alt: spec.initialAlt ?? '',
    };
    const tile = {
      _attrs: { class: 'find-tile' },
      dataset: { name: spec.initialName ?? '' },
      querySelector: (/** @type {string} */ sel) => (sel === 'img' ? img : null),
      classList: { contains: (/** @type {string} */ k) => k === 'find-tile' },
    };
    allTiles.push({ tile, img, code: spec.code });
  }
  return {
    body: allTiles,
    img: (/** @type {string} */ code) => {
      const t = allTiles.find((x) => x.code === code);
      return t ? t.img : null;
    },
    tile: (/** @type {string} */ code) => {
      const t = allTiles.find((x) => x.code === code);
      return t ? t.tile : null;
    },
    querySelectorAll: (/** @type {string} */ sel) => {
      // refreshTileNames passes `.find-tile, .flag` so the walk covers
      // both daily/findFlag's tiles and flagsdata's browse tiles. The
      // fake matches either form.
      if (sel !== '.find-tile' && sel !== '.find-tile, .flag') return [];
      return allTiles.map((x) => x.tile);
    },
  };
}

test('refreshTileNames: re-applies countryName to every registered tile', () => {
  _seedCacheForTests({ country: { pl: 'Polska', de: 'Niemcy' } });
  const doc = fakeTileDoc([
    { code: 'pl', initialName: 'Poland', initialAlt: 'Poland' },
    { code: 'de', initialName: 'Germany', initialAlt: 'Germany' },
  ]);
  bindTileCountry(doc.tile('pl'), sovereign('pl', 'Poland'));
  bindTileCountry(doc.tile('de'), sovereign('de', 'Germany'));

  refreshTileNames(/** @type {any} */ (doc));

  assert.equal(doc.tile('pl').dataset.name, 'Polska');
  assert.equal(doc.img('pl').alt, 'Polska');
  assert.equal(doc.tile('de').dataset.name, 'Niemcy');
  assert.equal(doc.img('de').alt, 'Niemcy');
  _resetCacheForTests();
});

test('refreshTileNames: skips tiles that were never registered via bindTileCountry', () => {
  // Tiles outside of game scope (e.g. injected by a future feature)
  // pass through unchanged — the WeakMap lookup misses, so we leave
  // them alone instead of clobbering with countryName({undefined}).
  _seedCacheForTests({ country: { pl: 'Polska' } });
  const doc = fakeTileDoc([
    { code: 'unregistered', initialName: 'Custom Label', initialAlt: 'Custom Alt' },
  ]);
  refreshTileNames(/** @type {any} */ (doc));
  assert.equal(doc.tile('unregistered').dataset.name, 'Custom Label',
    'unregistered tile name must survive the refresh');
  assert.equal(doc.img('unregistered').alt, 'Custom Alt');
  _resetCacheForTests();
});

test('refreshTileNames: falls back to the country.name when the cache has no translation', () => {
  // Mid-boot or after a failed reloadI18n the cache may not have a
  // translation for every country. countryName falls back to c.name,
  // so the tile's existing English name re-asserts itself rather than
  // displaying a broken empty hover.
  _resetCacheForTests();
  const doc = fakeTileDoc([{ code: 'pl', initialName: 'stale', initialAlt: 'stale' }]);
  bindTileCountry(doc.tile('pl'), sovereign('pl', 'Poland'));
  refreshTileNames(/** @type {any} */ (doc));
  assert.equal(doc.tile('pl').dataset.name, 'Poland');
  assert.equal(doc.img('pl').alt, 'Poland');
});
