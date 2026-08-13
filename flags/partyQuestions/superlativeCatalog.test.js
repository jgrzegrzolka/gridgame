import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { SUPERLATIVE_METRICS, superlativeMetricByQuestionId, superlativeMetricByKey, hintFor, canLabelDirection, FAMILIARITY_F, FAMILIARITY_TIERS, PER_CAPITA_BASE, familiarityForQuestion } from './superlativeCatalog.js';
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

// --- familiarity tiers ------------------------------------------------------

// The drift test for the bot's tier table, and the reason it is grouped rather
// than a field on each entry: a metric added to the catalog with no tier would
// otherwise fall through to "no adjustment" and silently inherit the gap bias the
// tiers exist to correct (see FAMILIARITY_TIERS' doc), which nothing else fails on.
test('every catalog metric sits in exactly one familiarity tier', () => {
  const tiered = Object.values(FAMILIARITY_TIERS).flat();
  assert.equal(new Set(tiered).size, tiered.length, 'a metric is listed in two tiers');
  assert.deepEqual(tiered.slice().sort(), SUPERLATIVE_METRICS.map((m) => m.key).sort());
});

test('every tier name has an f value, and they run household high to obscure low', () => {
  assert.deepEqual(Object.keys(FAMILIARITY_TIERS).sort(), Object.keys(FAMILIARITY_F).sort());
  const order = /** @type {(keyof typeof FAMILIARITY_F)[]} */ (['household', 'known', 'niche', 'obscure']);
  const fs = order.map((t) => FAMILIARITY_F[t]);
  for (let i = 1; i < fs.length; i++) {
    assert.ok(fs[i] < fs[i - 1], `${order[i]} must sit below ${order[i - 1]}`);
  }
  for (const f of fs) assert.ok(f >= -1 && f <= 1, `${f} outside [-1, 1]`);
});

// The guideline the PER_CAPITA_BASE table exists to state: nobody who can rank
// four countries by total Olympic medals can also do it per head. Enforced rather
// than derived, because only 4 of the 12 per-capita metrics have a base here.
test('no per-capita metric is better known than the metric it normalises', () => {
  /** @type {Record<string, number>} */
  const rank = { household: 3, known: 2, niche: 1, obscure: 0 };
  /** @param {string} key @returns {string | undefined} */
  const tierOf = (key) => Object.keys(FAMILIARITY_TIERS)
    .find((t) => FAMILIARITY_TIERS[/** @type {keyof typeof FAMILIARITY_TIERS} */ (t)].includes(key));
  for (const [perCapita, base] of Object.entries(PER_CAPITA_BASE)) {
    const pcTier = tierOf(perCapita);
    const baseTier = tierOf(base);
    assert.ok(pcTier && baseTier, `${perCapita} / ${base} must both be tiered`);
    assert.ok(rank[pcTier] <= rank[baseTier],
      `${perCapita} (${pcTier}) ranks above its base ${base} (${baseTier})`);
  }
});

test('PER_CAPITA_BASE names real catalog metrics on both sides', () => {
  for (const [perCapita, base] of Object.entries(PER_CAPITA_BASE)) {
    assert.ok(superlativeMetricByKey(perCapita), `${perCapita} is not a catalog metric`);
    assert.ok(superlativeMetricByKey(base), `${base} is not a catalog metric`);
  }
});

test('familiarityForQuestion resolves by question id, legacy population id included', () => {
  assert.equal(familiarityForQuestion('superlative'), FAMILIARITY_F.household);
  assert.equal(familiarityForQuestion('superlative-cocoa'), FAMILIARITY_F.obscure);
  assert.equal(familiarityForQuestion('superlative-coffee'), FAMILIARITY_F.known);
  // Not a statistic, and a question id from a newer server: both read as "no
  // adjustment" rather than throwing or guessing a tier.
  assert.equal(familiarityForQuestion('flagPick'), null);
  assert.equal(familiarityForQuestion('superlative-unobtainium'), null);
  assert.equal(familiarityForQuestion(undefined), null);
});
