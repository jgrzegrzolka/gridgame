import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderableRoundIds, roundRenderAction, canRenderQuestion } from './staleGuard.js';
import { SUPERLATIVE_METRICS } from '../flags/partyRounds/superlativeCatalog.js';

/** This build's known set, as page.js builds it. */
const KNOWN = renderableRoundIds(SUPERLATIVE_METRICS.map((m) => m.roundId));

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

// ---- canRenderQuestion: the direction dimension of the same skew ------------

// Knowing the roundId was never the whole question. The server can deal a
// DIRECTION this build has no copy for, on a roundId it knows perfectly well:
// flip a metric from `direction: 'most'` to `null` (a one-word catalog edit) and
// the PartyKit deploy starts dealing 'least' while a tab on the SWA build still
// has `hintLeast: null`. Round id unchanged, so the id check waves it through,
// and the page then renders the 'most' label over a 'least' question — every
// player picks the biggest flag and is scored wrong, silently. That is the one
// failure this guard exists to prevent, and it was blind to it.

test('canRenderQuestion: a normal question this build knows renders', () => {
  assert.equal(canRenderQuestion({ roundId: 'superlative', prompt: 'most' }, KNOWN), true);
  assert.equal(canRenderQuestion({ roundId: 'superlative', prompt: 'least' }, KNOWN), true);
});

test('canRenderQuestion: picture rounds render — their prompt is a country code, not a direction', () => {
  assert.equal(canRenderQuestion({ roundId: 'flagPick', prompt: 'fr' }, KNOWN), true);
  assert.equal(canRenderQuestion({ roundId: 'mapPick', prompt: 'it' }, KNOWN), true);
});

test('canRenderQuestion: an unknown round id is still unrenderable', () => {
  assert.equal(canRenderQuestion({ roundId: 'superlative-unobtainium', prompt: 'most' }, KNOWN), false);
});

test('canRenderQuestion: a direction this build has no label for is unrenderable', () => {
  // coffee is locked to 'most', so this build has no 'least' copy for it. A
  // server dealing 'least' coffee is newer than us — reload, never guess.
  assert.equal(canRenderQuestion({ roundId: 'superlative-coffee', prompt: 'most' }, KNOWN), true);
  assert.equal(canRenderQuestion({ roundId: 'superlative-coffee', prompt: 'least' }, KNOWN), false);
});

test('canRenderQuestion: a two-directional metric renders both ways', () => {
  // forest carries both labels, so neither direction is a skew signal.
  assert.equal(canRenderQuestion({ roundId: 'superlative-forest', prompt: 'most' }, KNOWN), true);
  assert.equal(canRenderQuestion({ roundId: 'superlative-forest', prompt: 'least' }, KNOWN), true);
});

test('canRenderQuestion: no question yet is renderable, not a skew signal', () => {
  assert.equal(canRenderQuestion(null, KNOWN), true);
  assert.equal(canRenderQuestion(undefined, KNOWN), true);
});

test('canRenderQuestion: a question with no roundId is unrenderable', () => {
  // `roundId` is optional on the wire type. The old call site was
  // `KNOWN_ROUND_IDS.has(q.roundId)`, and `Set.has(undefined)` is false, so this
  // already meant reload — pinned so the explicit check keeps that behaviour
  // rather than quietly flipping it to "render".
  assert.equal(canRenderQuestion({ prompt: 'most' }, KNOWN), false);
});

// The composition the page actually performs: an unlabelable direction must
// reach the same reload path a brand-new round id does.
test('a skewed direction routes to reload, then blocked — like any stale round', () => {
  const q = { roundId: 'superlative-coffee', prompt: 'least' };
  assert.equal(roundRenderAction(canRenderQuestion(q, KNOWN), false), 'reload');
  assert.equal(roundRenderAction(canRenderQuestion(q, KNOWN), true), 'blocked');
});
