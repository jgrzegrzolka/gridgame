import { test } from 'node:test';
import assert from 'node:assert/strict';

import { PICTURE_MODES, METRIC_MODES } from '../flags/partyPlan.js';
import { METRIC_SHORT } from '../flags/metricVisuals.js';
import { modeShortLabel, modeFullLabel, blockModeId } from './page.js';

// Every mode the lobby can render — the two fixed picture modes plus every
// metric superlative mode. `buildSetup` labels each of these, so each MUST
// resolve a real label.
const ALL_MODE_IDS = [...PICTURE_MODES, ...METRIC_MODES].map((m) => m.id);

/**
 * Regression guard for the crash that blanked the whole Flag Party lobby on
 * prod: population's mode id (`superlative-pop`) differs from its round id
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
  for (const id of ALL_MODE_IDS) {
    const { key, fallback } = modeFullLabel(id);
    assert.equal(typeof key, 'string', `mode "${id}" has no full-label key`);
    assert.ok(/** @type {string} */ (key).length > 0, `mode "${id}" full-label key is empty`);
    assert.equal(typeof fallback, 'string', `mode "${id}" has no full-label fallback`);
    assert.ok(/** @type {string} */ (fallback).length > 0, `mode "${id}" full-label fallback is empty`);
  }
});

test('population mode (id superlative-pop / roundId superlative) resolves the population metric short label — the exact case that crashed prod', () => {
  assert.deepEqual(modeShortLabel('superlative-pop'), {
    key: METRIC_SHORT.population.key,
    fallback: METRIC_SHORT.population.fallback,
  });
});

// The block title card (isBlockStart) resolves which mode to announce from what
// the client knows: a draft pick names the mode precisely, a custom block falls
// back to the round id, and the two flag pools (which share one round id) can
// only be announced generically without a pick.
test('blockModeId: a draft pick names the exact mode, over the round id', () => {
  // A picked stat block: the specific metric, not the generic superlative.
  assert.equal(blockModeId({ picker: 'p1', modeId: 'superlative-coffee' }, 'superlative-coffee'), 'superlative-coffee');
  // A picked flag block: the pool the pick chose, which the round id can't reveal.
  assert.equal(blockModeId({ picker: 'p1', modeId: 'flags-territories' }, 'flagPick'), 'flags-territories');
  assert.equal(blockModeId({ picker: 'p1', modeId: 'flags-all' }, 'flagPick'), 'flags-all');
});

test('blockModeId: a custom block derives the mode from the round id', () => {
  assert.equal(blockModeId(null, 'mapPick'), 'map-outlines');
  assert.equal(blockModeId(null, 'superlative-coffee'), 'superlative-coffee');
  // population's legacy round id (`superlative`) maps back to its mode id.
  assert.equal(blockModeId(null, 'superlative'), 'superlative-pop');
});

test('blockModeId: an unpicked flag block is generic (the two pools share one round id)', () => {
  assert.equal(blockModeId(null, 'flagPick'), null);
});

test('blockModeId: an unknown / missing round id is generic', () => {
  assert.equal(blockModeId(null, 'someFutureRound'), null);
  assert.equal(blockModeId(null, undefined), null);
  // a stale pick whose mode id isn't in the catalog falls through to the round id
  assert.equal(blockModeId({ picker: 'p1', modeId: 'gone' }, 'mapPick'), 'map-outlines');
});
