import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { SUPERLATIVE_METRICS, superlativeMetricByQuestionId, superlativeMetricByKey, hintFor, canLabelDirection } from './superlativeCatalog.js';
import { METRIC_FILES } from '../metrics/index.js';
import { METRIC_MODES } from '../partyPlan.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const I18N = join(HERE, '..', '..', 'i18n');

/** @param {string} lang */
const loadLang = (lang) => JSON.parse(readFileSync(join(I18N, `${lang}.json`), 'utf8'));

/**
 * Resolve a dotted i18n key ('party.hintMostForest') against a loaded bundle.
 * @param {any} bundle
 * @param {string} key
 * @returns {string | undefined}
 */
function lookup(bundle, key) {
  return key.split('.').reduce((node, part) => (node == null ? undefined : node[part]), bundle);
}

// THE drift test, and the reason the catalog names rather than imports. A metric
// added to flags/metrics/index.js but forgotten here would simply never be asked
// about; one added here but not there names a values file that doesn't exist, so
// the question resolves no data and deals nothing. Neither fails loudly on its own.
test('every registered metric has exactly one catalog entry, and vice versa', () => {
  const registered = METRIC_FILES.map((m) => m.key).sort();
  const cataloged = SUPERLATIVE_METRICS.map((m) => m.key).sort();
  assert.deepEqual(cataloged, registered);
});

// The other half of the same drift: `questionId` is what the server deals and what
// flagParty looks a question up by. A mismatch here means a dealt question whose
// prompt has no label.
test('every metric party mode has exactly one catalog entry, and vice versa', () => {
  const modeQuestionIds = METRIC_MODES.map((m) => m.questionId).sort();
  const cataloged = SUPERLATIVE_METRICS.map((m) => m.questionId).sort();
  assert.deepEqual(cataloged, modeQuestionIds);
});

test('keys and question ids are unique', () => {
  const keys = SUPERLATIVE_METRICS.map((m) => m.key);
  assert.equal(new Set(keys).size, keys.length, 'duplicate metric key');
  const ids = SUPERLATIVE_METRICS.map((m) => m.questionId);
  assert.equal(new Set(ids).size, ids.length, 'duplicate questionId');
});

// The invariant `hintFor` leans on: a locked metric never needs a 'least' label,
// and an unlocked one always does. Stated here so the table can't half-express a
// direction change (lock the direction, leave the label, or the reverse).
test('hintLeast is present exactly when the direction is not locked', () => {
  for (const m of SUPERLATIVE_METRICS) {
    if (m.direction === null) {
      assert.ok(m.hintLeast, `${m.key}: two-directional but has no hintLeast`);
    } else {
      assert.equal(m.direction, 'most', `${m.key}: the only lock we deal is 'most'`);
      assert.equal(m.hintLeast, null, `${m.key}: locked to 'most' but carries a hintLeast`);
    }
  }
});

test('every hint resolves in both languages', () => {
  const bundles = { en: loadLang('en'), pl: loadLang('pl') };
  for (const m of SUPERLATIVE_METRICS) {
    for (const hint of [m.hintMost, m.hintLeast]) {
      if (!hint) continue;
      for (const [lang, bundle] of Object.entries(bundles)) {
        const got = lookup(bundle, hint.key);
        assert.equal(typeof got, 'string', `${m.key}: ${hint.key} missing from ${lang}.json`);
        assert.ok(/** @type {string} */ (got).length > 0, `${m.key}: ${hint.key} is empty in ${lang}.json`);
      }
    }
  }
});

test('the English fallback matches en.json, so a hint reads the same either way', () => {
  const en = loadLang('en');
  for (const m of SUPERLATIVE_METRICS) {
    for (const hint of [m.hintMost, m.hintLeast]) {
      if (!hint) continue;
      assert.equal(lookup(en, hint.key), hint.fallback, `${hint.key}: fallback drifted from en.json`);
    }
  }
});

test('hintFor picks the label for the direction', () => {
  const forest = superlativeMetricByKey('forest');
  assert.ok(forest);
  assert.equal(hintFor(forest, 'most').fallback, 'Most forested');
  assert.equal(hintFor(forest, 'least').fallback, 'Least forested');
});

test('hintFor falls back to hintMost rather than crashing on a locked metric', () => {
  // Belt-and-braces only. An earlier version of this comment called the case
  // "unreachable in practice" — wrong: server and page are separate deploys of
  // this file, so a direction flip makes it reachable. The real defence is
  // `canLabelDirection` + `staleGuard.canRenderQuestion`, which reload the tab
  // before a question with no label for its direction ever renders. This fallback
  // just means a caller that skips that guard gets a wrong label instead of a
  // dead screen — better, never right.
  const coffee = superlativeMetricByKey('coffee');
  assert.ok(coffee);
  assert.equal(coffee.hintLeast, null);
  assert.equal(hintFor(coffee, 'least').fallback, 'Largest coffee production');
});

// The predicate the skew guard is built on. Tested here, at its definition, as
// well as through `canRenderQuestion` in staleGuard.test.js — this is the rule,
// that is the composition.
test('canLabelDirection: a two-directional metric can be labelled either way', () => {
  const forest = superlativeMetricByKey('forest');
  assert.ok(forest);
  assert.equal(canLabelDirection(forest, 'most'), true);
  assert.equal(canLabelDirection(forest, 'least'), true);
});

test('canLabelDirection: a locked metric cannot label the direction it never deals', () => {
  const coffee = superlativeMetricByKey('coffee');
  assert.ok(coffee);
  assert.equal(canLabelDirection(coffee, 'most'), true);
  assert.equal(canLabelDirection(coffee, 'least'), false, 'no hintLeast means no copy for it');
});

// The two must never disagree: canLabelDirection is what decides whether hintFor
// is allowed to be asked, so "can label" must mean exactly "hintFor returns the
// label for that direction rather than the other one".
test('canLabelDirection agrees with hintFor for every metric and direction', () => {
  for (const m of SUPERLATIVE_METRICS) {
    for (const dir of /** @type {const} */ (['most', 'least'])) {
      const wanted = dir === 'least' ? m.hintLeast : m.hintMost;
      if (canLabelDirection(m, dir)) {
        assert.equal(hintFor(m, dir), wanted,
          `${m.key}: says it can label '${dir}' but hintFor returns something else`);
      } else {
        assert.equal(wanted, null, `${m.key}: says it cannot label '${dir}' but a hint exists`);
        assert.equal(hintFor(m, dir), m.hintMost, `${m.key}: fallback should be hintMost`);
      }
    }
  }
});

test('lookups resolve, and an unknown id is null rather than a throw', () => {
  // A still-open tab can be dealt a question id by a newer server; that must read
  // as "I don't know this" and reach the stale-client guard, not explode.
  const pop = superlativeMetricByQuestionId('superlative');
  const forest = superlativeMetricByQuestionId('superlative-forest');
  assert.ok(pop && forest);
  assert.equal(pop.key, 'population');
  assert.equal(forest.key, 'forest');
  assert.equal(superlativeMetricByQuestionId('superlative-unobtainium'), null);
  assert.equal(superlativeMetricByKey('nope'), null);
});

// The population question predates the metric suffix, and its id is on the wire in
// every live room. Pinned because a "tidy-up" rename is a plausible future edit
// and would break every game mid-question.
test('the population question keeps its legacy unsuffixed id', () => {
  const pop = superlativeMetricByKey('population');
  assert.ok(pop);
  assert.equal(pop.questionId, 'superlative');
});
