import { test } from 'node:test';
import assert from 'node:assert/strict';

import { PICTURE_MODES, METRIC_MODES } from '../flags/partyPlan.js';
import { METRIC_SHORT } from '../flags/metricVisuals.js';
import { modeShortLabel, modeFullLabel } from './page.js';

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
