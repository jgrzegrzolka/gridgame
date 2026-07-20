import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderableQuestionIds, questionRenderAction, canRenderQuestion, canRenderHand } from './staleGuard.js';
import { SUPERLATIVE_METRICS } from '../flags/partyQuestions/superlativeCatalog.js';

/** This build's known set, as page.js builds it. */
const KNOWN = renderableQuestionIds(SUPERLATIVE_METRICS.map((m) => m.questionId));

test('renderableQuestionIds: always includes the two fixed picture questions', () => {
  const ids = renderableQuestionIds([]);
  assert.ok(ids.has('flagPick'));
  assert.ok(ids.has('mapPick'));
});

test('renderableQuestionIds: includes every superlative question key passed in', () => {
  const ids = renderableQuestionIds(['superlative', 'superlative-area', 'superlative-gdp', 'superlative-gdppc']);
  assert.ok(ids.has('superlative'));
  assert.ok(ids.has('superlative-area'));
  assert.ok(ids.has('superlative-gdp'));
  assert.ok(ids.has('superlative-gdppc'));
});

test('renderableQuestionIds: a question the build does not know is NOT in the set', () => {
  // An older build (before GDP shipped) has no gdp keys → server dealing one is
  // outside the set, which is what trips the reload.
  const oldBuild = renderableQuestionIds(['superlative', 'superlative-area', 'superlative-density']);
  assert.ok(!oldBuild.has('superlative-gdp'));
  assert.ok(!oldBuild.has('superlative-gdppc'));
  assert.ok(!oldBuild.has('superlative-future-metric'));
});

test('questionRenderAction: a renderable question always plays, regardless of the guard', () => {
  assert.equal(questionRenderAction(true, false), 'render');
  assert.equal(questionRenderAction(true, true), 'render');
});

test('questionRenderAction: an unrenderable question reloads once when the guard is clear', () => {
  assert.equal(questionRenderAction(false, false), 'reload');
});

test('questionRenderAction: an unrenderable question is blocked once we have already reloaded', () => {
  assert.equal(questionRenderAction(false, true), 'blocked');
});

// ---- canRenderQuestion: the direction dimension of the same skew ------------

// Knowing the questionId was never the whole question. The server can deal a
// DIRECTION this build has no copy for, on a questionId it knows perfectly well:
// flip a metric from `direction: 'most'` to `null` (a one-word catalog edit) and
// the PartyKit deploy starts dealing 'least' while a tab on the SWA build still
// has `hintLeast: null`. Question id unchanged, so the id check waves it through,
// and the page then renders the 'most' label over a 'least' question — every
// player picks the biggest flag and is scored wrong, silently. That is the one
// failure this guard exists to prevent, and it was blind to it.

test('canRenderQuestion: a normal question this build knows renders', () => {
  assert.equal(canRenderQuestion({ questionId: 'superlative', prompt: 'most' }, KNOWN), true);
  assert.equal(canRenderQuestion({ questionId: 'superlative', prompt: 'least' }, KNOWN), true);
});

test('canRenderQuestion: picture questions render — their prompt is a country code, not a direction', () => {
  assert.equal(canRenderQuestion({ questionId: 'flagPick', prompt: 'fr' }, KNOWN), true);
  assert.equal(canRenderQuestion({ questionId: 'mapPick', prompt: 'it' }, KNOWN), true);
});

test('canRenderQuestion: an unknown question id is still unrenderable', () => {
  assert.equal(canRenderQuestion({ questionId: 'superlative-unobtainium', prompt: 'most' }, KNOWN), false);
});

test('canRenderQuestion: a direction this build has no label for is unrenderable', () => {
  // coffee is locked to 'most', so this build has no 'least' copy for it. A
  // server dealing 'least' coffee is newer than us — reload, never guess.
  assert.equal(canRenderQuestion({ questionId: 'superlative-coffee', prompt: 'most' }, KNOWN), true);
  assert.equal(canRenderQuestion({ questionId: 'superlative-coffee', prompt: 'least' }, KNOWN), false);
});

test('canRenderQuestion: a two-directional metric renders both ways', () => {
  // forest carries both labels, so neither direction is a skew signal.
  assert.equal(canRenderQuestion({ questionId: 'superlative-forest', prompt: 'most' }, KNOWN), true);
  assert.equal(canRenderQuestion({ questionId: 'superlative-forest', prompt: 'least' }, KNOWN), true);
});

test('canRenderQuestion: no question yet is renderable, not a skew signal', () => {
  assert.equal(canRenderQuestion(null, KNOWN), true);
  assert.equal(canRenderQuestion(undefined, KNOWN), true);
});

test('canRenderQuestion: a question with no questionId is unrenderable', () => {
  // `questionId` is optional on the wire type. The old call site was
  // `KNOWN_QUESTION_IDS.has(q.questionId)`, and `Set.has(undefined)` is false, so this
  // already meant reload — pinned so the explicit check keeps that behaviour
  // rather than quietly flipping it to "render".
  assert.equal(canRenderQuestion({ prompt: 'most' }, KNOWN), false);
});

// The composition the page actually performs: an unlabelable direction must
// reach the same reload path a brand-new question id does.
test('a skewed direction routes to reload, then blocked — like any stale question', () => {
  const q = { questionId: 'superlative-coffee', prompt: 'least' };
  assert.equal(questionRenderAction(canRenderQuestion(q, KNOWN), false), 'reload');
  assert.equal(questionRenderAction(canRenderQuestion(q, KNOWN), true), 'blocked');
});

// ---- canRenderHand ----
//
// The draft hand is the second surface a newer server reaches an old tab
// through, and it bypasses the question guard entirely: a metric family deals its
// members' own question ids, which an old build already knows, so every question
// renders fine and only the pick screen breaks.

test('canRenderHand: a hand of known cards renders', () => {
  const known = new Set(['flags-all', 'superlative-coffee', 'economy']);
  assert.equal(canRenderHand(['flags-all', 'economy'], known), true);
});

test('canRenderHand: one unknown card id is enough to be stale', () => {
  // The whole hand is refused on a single unknown id rather than the card being
  // skipped: a picker choosing from a silently shortened hand doesn't know what
  // they weren't offered, and the round they pick shapes the game.
  const known = new Set(['flags-all', 'superlative-coffee']);
  assert.equal(canRenderHand(['flags-all', 'economy'], known), false);
});

test('canRenderHand: no hand is not a skew signal', () => {
  // Every non-picking phase, and every player who isn't the picker.
  const known = new Set(['flags-all']);
  assert.equal(canRenderHand(null, known), true);
  assert.equal(canRenderHand(undefined, known), true);
  assert.equal(canRenderHand([], known), true);
});

test('canRenderHand routes an unknown card to the same one-shot reload as a question', () => {
  // The composition the page actually performs. First encounter reloads onto the
  // new build; if that comes back still stale (cached HTML, offline), the notice
  // replaces a reload loop.
  const known = new Set(['flags-all']);
  assert.equal(questionRenderAction(canRenderHand(['economy'], known), false), 'reload');
  assert.equal(questionRenderAction(canRenderHand(['economy'], known), true), 'blocked');
  assert.equal(questionRenderAction(canRenderHand(['flags-all'], known), false), 'render');
});

// ---- spot-the-flag: the skew surface is the VOCABULARY, not the question id ----

test('renderableQuestionIds: includes spotFlag', () => {
  // Drop it and every spot round routes a compatible client through reload and
  // then the update notice — the mode would look broken on a build that has it.
  assert.ok(renderableQuestionIds([]).has('spotFlag'));
});

test('canRenderQuestion: a spot spec this build can label renders', () => {
  const q = { questionId: 'spotFlag', prompt: 'color:red,color:!green,motif:star-or-moon' };
  assert.equal(canRenderQuestion(q, KNOWN), true);
});

test('canRenderQuestion: a spot spec naming an unknown clause is a skew signal', () => {
  // The failure this guard exists for, in its second form. Spot-the-flag carries
  // its criteria IN the prompt, so a newer server that adds a colour or motif to
  // the vocabulary deals a spec an older tab can only render with a clause
  // MISSING — and a two-clause rendering of a three-clause question shows the room
  // tiles that look like they satisfy it. The "wrong" answers look right, everyone
  // picks one, and everyone is scored wrong with nothing on screen suggesting why.
  // Silent mis-scoring, exactly like the superlative direction case above.
  const unknownMotif = { questionId: 'spotFlag', prompt: 'color:red,color:!green,motif:coat-of-arms' };
  assert.equal(canRenderQuestion(unknownMotif, KNOWN), false, 'a motif outside the mode');
  const unknownColor = { questionId: 'spotFlag', prompt: 'color:violet,color:!green,motif:cross' };
  assert.equal(canRenderQuestion(unknownColor, KNOWN), false, 'a colour outside the mode');
});

test('canRenderQuestion: a spot spec with the wrong clause count is a skew signal', () => {
  // A future build changing SPOT_CLAUSES (three clauses, four tiles) reaches an old
  // tab as a spec it would render short. Same silent-mis-scoring shape.
  const twoClause = { questionId: 'spotFlag', prompt: 'color:red,motif:cross' };
  assert.equal(canRenderQuestion(twoClause, KNOWN), false);
});

test('canRenderQuestion: a malformed spot prompt does not throw', () => {
  // The prompt is off the wire, so it is untrusted. It must resolve to "reload",
  // never to an exception that takes the whole render down.
  for (const prompt of ['', 'garbage', ';;;', 'color:', 'not-a-group:red', '{}']) {
    assert.equal(canRenderQuestion({ questionId: 'spotFlag', prompt }, KNOWN), false, `prompt ${prompt}`);
  }
});
