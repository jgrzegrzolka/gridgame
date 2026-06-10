import test from 'node:test';
import assert from 'node:assert/strict';
import {
  pickSmartStats,
  hasAnySmartStats,
} from './smartStats.js';

const T = ['fr', 'de', 'es', 'it', 'pl', 'pt', 'be', 'nl', 'gr']; // 9 targets

function statsOf({ attempts, finds = {}, wrong = {} }) {
  return { totalAttempts: attempts, perCodeFinds: finds, perWrongCode: wrong };
}

test('all empty when totalAttempts is 0', () => {
  // The only global gate left — no submissions means no signal at all.
  // Single submissions are allowed through; the per-section rules
  // (top picks at 100%, bottom picks ≥80%, mistake count ≥2) handle
  // the small-sample edge cases on their own.
  const r = pickSmartStats({
    stats: statsOf({ attempts: 0, finds: {}, wrong: {} }),
    targetCodes: T,
  });
  assert.deepEqual(r, { bestKnown: [], mostMissed: [], topMistake: [] });
});

test('null stats → all empty', () => {
  assert.deepEqual(
    pickSmartStats({ stats: null, targetCodes: T }),
    { bestKnown: [], mostMissed: [], topMistake: [] },
  );
});

test('single-submission small community: sections still surface', () => {
  // With 4 submissions: 3 people got everything, 1 missed two flags.
  // (Matches the screenshot case that motivated dropping the global floor.)
  const finds = {
    fr: 4, de: 4, es: 4, it: 4, pl: 4, pt: 4, be: 4, // 100% each
    nl: 3, gr: 3,                                    // 75% each
  };
  const r = pickSmartStats({
    stats: statsOf({ attempts: 4, finds, wrong: { ch: 3 } }),
    targetCodes: T,
  });
  // Best known: every top-3 pick is 100% → still hidden by that rule.
  assert.deepEqual(r.bestKnown, []);
  // Most missed: bottom-3 is [gr:75, nl:75, plus one 100%] → 75 < 80, shows.
  assert.equal(r.mostMissed.length, 3);
  assert.equal(r.mostMissed[0].pct, 75);
  // Top mistake: ch with 3 clicks ≥ MIN_MISTAKE_COUNT=2 → surfaces.
  assert.deepEqual(r.topMistake, [{ code: 'ch', count: 3 }]);
});

test('best known: top 3 by find rate, descending', () => {
  const finds = { fr: 10, de: 9, es: 8, it: 5, pl: 3, pt: 2, be: 2, nl: 1, gr: 0 };
  const r = pickSmartStats({
    stats: statsOf({ attempts: 10, finds }),
    targetCodes: T,
  });
  assert.deepEqual(r.bestKnown, [
    { code: 'fr', pct: 100 },
    { code: 'de', pct: 90 },
    { code: 'es', pct: 80 },
  ]);
});

test('best known: ties broken by code, ascending', () => {
  const finds = { fr: 8, de: 8, es: 8, it: 8, pl: 1, pt: 1, be: 1, nl: 1, gr: 1 };
  const r = pickSmartStats({
    stats: statsOf({ attempts: 10, finds }),
    targetCodes: T,
  });
  // All top picks at 80%, alphabetical: de, es, fr
  assert.deepEqual(r.bestKnown, [
    { code: 'de', pct: 80 },
    { code: 'es', pct: 80 },
    { code: 'fr', pct: 80 },
  ]);
});

test('best known: hidden when every top pick is at 100%', () => {
  const finds = Object.fromEntries(T.map((c) => [c, 10])); // everyone found everything
  const r = pickSmartStats({
    stats: statsOf({ attempts: 10, finds }),
    targetCodes: T,
  });
  assert.deepEqual(r.bestKnown, []);
});

test('best known: shown when at least one top pick is below 100%', () => {
  const finds = { fr: 10, de: 10, es: 9, it: 5, pl: 5, pt: 5, be: 5, nl: 5, gr: 5 };
  const r = pickSmartStats({
    stats: statsOf({ attempts: 10, finds }),
    targetCodes: T,
  });
  // 90% is < 100, so the rail still surfaces
  assert.equal(r.bestKnown.length, 3);
  assert.equal(r.bestKnown[2].pct, 90);
});

test('most missed: bottom 3 by find rate, ascending', () => {
  const finds = { fr: 10, de: 9, es: 8, it: 5, pl: 3, pt: 2, be: 2, nl: 1, gr: 0 };
  const r = pickSmartStats({
    stats: statsOf({ attempts: 10, finds }),
    targetCodes: T,
  });
  assert.deepEqual(r.mostMissed, [
    { code: 'gr', pct: 0 },
    { code: 'nl', pct: 10 },
    { code: 'be', pct: 20 },
  ]);
});

test('most missed: hidden when bottom-3 are all ≥ 80%', () => {
  const finds = Object.fromEntries(T.map((c) => [c, 9])); // every flag at 90%
  const r = pickSmartStats({
    stats: statsOf({ attempts: 10, finds }),
    targetCodes: T,
  });
  assert.deepEqual(r.mostMissed, []);
});

test('most missed: shown as soon as any bottom pick drops below 80%', () => {
  const finds = { fr: 10, de: 10, es: 10, it: 10, pl: 10, pt: 10, be: 10, nl: 10, gr: 7 };
  const r = pickSmartStats({
    stats: statsOf({ attempts: 10, finds }),
    targetCodes: T,
  });
  // 70% < 80% threshold triggers visibility
  assert.equal(r.mostMissed.length, 3);
  assert.equal(r.mostMissed[0].code, 'gr');
  assert.equal(r.mostMissed[0].pct, 70);
});

test('find sections hidden for small puzzles (< 5 targets)', () => {
  const smallTargets = ['fr', 'de', 'es', 'it'];
  const r = pickSmartStats({
    stats: statsOf({
      attempts: 20,
      finds: { fr: 20, de: 18, es: 4, it: 1 },
      wrong: { ua: 6 },
    }),
    targetCodes: smallTargets,
  });
  assert.deepEqual(r.bestKnown, []);
  assert.deepEqual(r.mostMissed, []);
  // Mistakes still surface — they don't overlap with find sections
  assert.deepEqual(r.topMistake, [{ code: 'ua', count: 6 }]);
});

test('top mistake: highest-count wrong-clicked flag', () => {
  const r = pickSmartStats({
    stats: statsOf({
      attempts: 10,
      finds: { fr: 10 },
      wrong: { ua: 4, ru: 7, by: 2 },
    }),
    targetCodes: T,
  });
  assert.deepEqual(r.topMistake, [{ code: 'ru', count: 7 }]);
});

test('top mistake: hidden when top count < 2 (one-off click is not a trap)', () => {
  const r = pickSmartStats({
    stats: statsOf({
      attempts: 10,
      finds: { fr: 10 },
      wrong: { ua: 1, ru: 1 },
    }),
    targetCodes: T,
  });
  assert.deepEqual(r.topMistake, []);
});

test('top mistake: hidden when perWrongCode is missing entirely (old cached response)', () => {
  const stats = { totalAttempts: 10, perCodeFinds: { fr: 10 } }; // no perWrongCode
  const r = pickSmartStats({ stats, targetCodes: T });
  assert.deepEqual(r.topMistake, []);
});

test('top mistake: ties broken by code, ascending', () => {
  const r = pickSmartStats({
    stats: statsOf({
      attempts: 10,
      finds: {},
      wrong: { ua: 5, ru: 5, by: 5 },
    }),
    targetCodes: T,
  });
  assert.deepEqual(r.topMistake, [{ code: 'by', count: 5 }]);
});

test('hasAnySmartStats reflects union of three sections', () => {
  assert.equal(hasAnySmartStats({ bestKnown: [], mostMissed: [], topMistake: [] }), false);
  assert.equal(hasAnySmartStats({ bestKnown: [{ code: 'fr', pct: 100 }], mostMissed: [], topMistake: [] }), true);
  assert.equal(hasAnySmartStats({ bestKnown: [], mostMissed: [], topMistake: [{ code: 'ua', count: 3 }] }), true);
});
