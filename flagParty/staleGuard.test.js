import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderableRoundIds, roundRenderAction } from './staleGuard.js';

test('renderableRoundIds: always includes the two fixed picture rounds', () => {
  const ids = renderableRoundIds([]);
  assert.ok(ids.has('flagPick'));
  assert.ok(ids.has('mapPick'));
});

test('renderableRoundIds: includes every superlative round key passed in', () => {
  const ids = renderableRoundIds(['superlative', 'superlative-area', 'superlative-gdp', 'superlative-gdppc']);
  assert.ok(ids.has('superlative'));
  assert.ok(ids.has('superlative-area'));
  assert.ok(ids.has('superlative-gdp'));
  assert.ok(ids.has('superlative-gdppc'));
});

test('renderableRoundIds: a round the build does not know is NOT in the set', () => {
  // An older build (before GDP shipped) has no gdp keys → server dealing one is
  // outside the set, which is what trips the reload.
  const oldBuild = renderableRoundIds(['superlative', 'superlative-area', 'superlative-density']);
  assert.ok(!oldBuild.has('superlative-gdp'));
  assert.ok(!oldBuild.has('superlative-gdppc'));
  assert.ok(!oldBuild.has('superlative-future-metric'));
});

test('roundRenderAction: a renderable round always plays, regardless of the guard', () => {
  assert.equal(roundRenderAction(true, false), 'render');
  assert.equal(roundRenderAction(true, true), 'render');
});

test('roundRenderAction: an unrenderable round reloads once when the guard is clear', () => {
  assert.equal(roundRenderAction(false, false), 'reload');
});

test('roundRenderAction: an unrenderable round is blocked once we have already reloaded', () => {
  assert.equal(roundRenderAction(false, true), 'blocked');
});
