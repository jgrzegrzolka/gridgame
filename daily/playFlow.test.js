import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeLangRefreshPayload } from './playFlow.js';
import { createCountry } from '../flags/group.js';
import { emptyFilters } from '../flags/flagsFilter.js';
import { _seedCacheForTests, _resetCacheForTests } from '../i18n.js';

// computeLangRefreshPayload is the pure half of the soft-language-switch
// handler. The rest of playFlow.js is DOM glue. Tests pin the two
// invariants the call sites depend on:
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
