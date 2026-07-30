import test from 'node:test';
import assert from 'node:assert/strict';
import {
  pickExtraStats,
  hasAnyExtraStats,
  pickMarkerKind,
  pickDifficultyFacts,
  pickMistakeRail,
} from './extraStats.js';

const T = ['fr', 'de', 'es', 'it', 'pl', 'pt', 'be', 'nl', 'gr']; // 9 targets

function statsOf({ attempts, finds = {}, wrong = {} }) {
  return { totalAttempts: attempts, perCodeFinds: finds, perWrongCode: wrong };
}

test('all empty when totalAttempts is 0', () => {
  const r = pickExtraStats({
    stats: statsOf({ attempts: 0, finds: {}, wrong: {} }),
    targetCodes: T,
  });
  assert.deepEqual(r, { ranking: [], topMistake: [] });
});

test('null stats → all empty', () => {
  assert.deepEqual(
    pickExtraStats({ stats: null, targetCodes: T }),
    { ranking: [], topMistake: [] },
  );
});

test('ranking: includes every target code, sorted by find pct desc', () => {
  const finds = { fr: 10, de: 9, es: 8, it: 5, pl: 3, pt: 2, be: 2, nl: 1, gr: 0 };
  const r = pickExtraStats({
    stats: statsOf({ attempts: 10, finds }),
    targetCodes: T,
  });
  assert.equal(r.ranking.length, T.length);
  // First few descend by pct as expected.
  assert.deepEqual(r.ranking.slice(0, 4), [
    { code: 'fr', pct: 100 },
    { code: 'de', pct: 90 },
    { code: 'es', pct: 80 },
    { code: 'it', pct: 50 },
  ]);
  // Last few stay sorted too — gr at 0 is the floor.
  assert.deepEqual(r.ranking[r.ranking.length - 1], { code: 'gr', pct: 0 });
});

test('ranking: ties broken by code, ascending', () => {
  const finds = { fr: 8, de: 8, es: 8, it: 8, pl: 1, pt: 1, be: 1, nl: 1, gr: 1 };
  const r = pickExtraStats({
    stats: statsOf({ attempts: 10, finds }),
    targetCodes: T,
  });
  // 4 flags at 80% tie-break alphabetical → de, es, fr, it.
  assert.deepEqual(r.ranking.slice(0, 4).map((p) => p.code), ['de', 'es', 'fr', 'it']);
  // 5 flags at 10% tie-break alphabetical → be, gr, nl, pl, pt.
  assert.deepEqual(r.ranking.slice(4).map((p) => p.code), ['be', 'gr', 'nl', 'pl', 'pt']);
});

test('ranking: every flag at 100% → ranking still surfaces all flags', () => {
  const finds = Object.fromEntries(T.map((c) => [c, 10]));
  const r = pickExtraStats({
    stats: statsOf({ attempts: 10, finds }),
    targetCodes: T,
  });
  assert.equal(r.ranking.length, T.length);
  assert.ok(r.ranking.every((p) => p.pct === 100));
});

test('ranking: respects targetCodes order via stable sort tie-break', () => {
  // Codes not in perCodeFinds are treated as 0 finds — they all tie at
  // the bottom and surface alphabetically.
  const finds = { fr: 5, de: 5 }; // both 50%
  const r = pickExtraStats({
    stats: statsOf({ attempts: 10, finds }),
    targetCodes: ['fr', 'de', 'es'],
  });
  // fr (50) and de (50) tie → alphabetical de, fr. Then es at 0.
  assert.deepEqual(r.ranking.map((p) => p.code), ['de', 'fr', 'es']);
});

test('small-community puzzle (4 players, 9 flags): ranking + mistake both fire', () => {
  // 3 people got everything, 1 missed two flags.
  const finds = {
    fr: 4, de: 4, es: 4, it: 4, pl: 4, pt: 4, be: 4, // 100% each
    nl: 3, gr: 3,                                    // 75% each
  };
  const r = pickExtraStats({
    stats: statsOf({ attempts: 4, finds, wrong: { ch: 3 } }),
    targetCodes: T,
  });
  // All 9 surface, the two 75%s at the tail.
  assert.equal(r.ranking.length, 9);
  assert.equal(r.ranking[0].pct, 100);
  assert.equal(r.ranking[8].pct, 75);
  assert.deepEqual(r.topMistake, [{ code: 'ch', count: 3 }]);
});

test('small puzzle (<5 targets) is fine: ranking surfaces all of them', () => {
  const smallTargets = ['fr', 'de', 'es', 'it'];
  const r = pickExtraStats({
    stats: statsOf({
      attempts: 20,
      finds: { fr: 20, de: 18, es: 4, it: 1 },
      wrong: { ua: 6 },
    }),
    targetCodes: smallTargets,
  });
  assert.equal(r.ranking.length, 4);
  assert.deepEqual(r.ranking.map((p) => p.code), ['fr', 'de', 'es', 'it']);
  assert.deepEqual(r.topMistake, [{ code: 'ua', count: 6 }]);
});

test('top mistake: highest-count wrong-clicked flag leads the list', () => {
  const r = pickExtraStats({
    stats: statsOf({
      attempts: 10,
      finds: { fr: 10 },
      wrong: { ua: 4, ru: 7, by: 2 },
    }),
    targetCodes: T,
  });
  assert.deepEqual(r.topMistake, [
    { code: 'ru', count: 7 },
    { code: 'ua', count: 4 },
    { code: 'by', count: 2 },
  ]);
});

test('top mistake: surfaces even on single-click wrong guesses', () => {
  const r = pickExtraStats({
    stats: statsOf({
      attempts: 10,
      finds: { fr: 10 },
      wrong: { ua: 1, ru: 1 },
    }),
    targetCodes: T,
  });
  assert.deepEqual(r.topMistake, [
    { code: 'ru', count: 1 },
    { code: 'ua', count: 1 },
  ]);
});

test('top mistake: hidden when perWrongCode is missing entirely (old cached response)', () => {
  const stats = { totalAttempts: 10, perCodeFinds: { fr: 10 } }; // no perWrongCode
  const r = pickExtraStats({ stats, targetCodes: T });
  assert.deepEqual(r.topMistake, []);
});

test('top mistake: tied entries all surface, alphabetical within the tie', () => {
  const r = pickExtraStats({
    stats: statsOf({
      attempts: 10,
      finds: {},
      wrong: { ua: 5, ru: 5, by: 5 },
    }),
    targetCodes: T,
  });
  assert.deepEqual(r.topMistake, [
    { code: 'by', count: 5 },
    { code: 'ru', count: 5 },
    { code: 'ua', count: 5 },
  ]);
});

test('top mistake: 12 distinct counts, no ties → clean top 10', () => {
  const r = pickExtraStats({
    stats: statsOf({
      attempts: 20,
      finds: {},
      wrong: { aa: 20, bb: 19, cc: 18, dd: 17, ee: 16, ff: 15, gg: 14, hh: 13, ii: 12, jj: 11, kk: 10, ll: 9 },
    }),
    targetCodes: T,
  });
  assert.deepEqual(
    r.topMistake.map((e) => e.code),
    ['aa', 'bb', 'cc', 'dd', 'ee', 'ff', 'gg', 'hh', 'ii', 'jj'],
  );
});

test('top mistake: tie at the cutoff (positions 10 and 11 share count) → both included', () => {
  const r = pickExtraStats({
    stats: statsOf({
      attempts: 20,
      finds: {},
      wrong: { aa: 20, bb: 19, cc: 18, dd: 17, ee: 16, ff: 15, gg: 14, hh: 13, ii: 12, jj: 11, kk: 11, ll: 10 },
    }),
    targetCodes: T,
  });
  assert.deepEqual(
    r.topMistake.map((e) => e.code),
    ['aa', 'bb', 'cc', 'dd', 'ee', 'ff', 'gg', 'hh', 'ii', 'jj', 'kk'],
  );
});

test('top mistake: big tie at the cutoff → all tied entries surface (well under cap)', () => {
  const wrong = { aa: 10, bb: 9, cc: 8, dd: 7 };
  // 10 codes all tied at count 6 — codes e0..e9 chosen so they sort after dd.
  for (let i = 0; i < 10; i++) wrong[`e${i}`] = 6;
  const r = pickExtraStats({
    stats: statsOf({ attempts: 20, finds: {}, wrong }),
    targetCodes: T,
  });
  assert.equal(r.topMistake.length, 14);
  assert.deepEqual(r.topMistake.slice(0, 4).map((e) => e.code), ['aa', 'bb', 'cc', 'dd']);
  assert.ok(r.topMistake.slice(4).every((e) => e.count === 6));
});

test('top mistake: tie at cutoff would exceed cap → cap at 20, alphabetical wins inside the tie', () => {
  const wrong = { aa: 10 };
  // 30 codes all tied at count 5. Use t00..t29 — they sort after aa.
  for (let i = 0; i < 30; i++) wrong[`t${String(i).padStart(2, '0')}`] = 5;
  const r = pickExtraStats({
    stats: statsOf({ attempts: 35, finds: {}, wrong }),
    targetCodes: T,
  });
  assert.equal(r.topMistake.length, 20);
  assert.equal(r.topMistake[0].code, 'aa');
  // The 19 fives that survive are the alphabetically-first ones: t00..t18.
  const survivors = r.topMistake.slice(1).map((e) => e.code);
  const expected = Array.from({ length: 19 }, (_, i) => `t${String(i).padStart(2, '0')}`);
  assert.deepEqual(survivors, expected);
});

test('top mistake: everything tied (30 codes at count 1) → 20 alphabetical entries', () => {
  const wrong = {};
  for (let i = 0; i < 30; i++) wrong[`c${String(i).padStart(2, '0')}`] = 1;
  const r = pickExtraStats({
    stats: statsOf({ attempts: 30, finds: {}, wrong }),
    targetCodes: T,
  });
  assert.equal(r.topMistake.length, 20);
  assert.deepEqual(
    r.topMistake.map((e) => e.code),
    Array.from({ length: 20 }, (_, i) => `c${String(i).padStart(2, '0')}`),
  );
});

test('top mistake: ties above the cutoff don\'t extend the list — still strict top 10', () => {
  // Top three share count 20 (above the cutoff). No tie at positions 10/11.
  const r = pickExtraStats({
    stats: statsOf({
      attempts: 30,
      finds: {},
      wrong: { aa: 20, bb: 20, cc: 20, dd: 18, ee: 17, ff: 16, gg: 15, hh: 14, ii: 13, jj: 12, kk: 10, ll: 9 },
    }),
    targetCodes: T,
  });
  assert.deepEqual(
    r.topMistake.map((e) => e.code),
    ['aa', 'bb', 'cc', 'dd', 'ee', 'ff', 'gg', 'hh', 'ii', 'jj'],
  );
});

test('top mistake: count-0 entries are filtered out before counting', () => {
  const r = pickExtraStats({
    stats: statsOf({
      attempts: 10,
      finds: {},
      wrong: { aa: 0, bb: 3, cc: 0 },
    }),
    targetCodes: T,
  });
  assert.deepEqual(r.topMistake, [{ code: 'bb', count: 3 }]);
});

test('pickMarkerKind: user found the flag → green', () => {
  const r = pickMarkerKind({
    code: 'fr',
    targetCodes: new Set(['fr', 'de']),
    userFoundCodes: new Set(['fr']),
  });
  assert.equal(r, 'found');
});

test('pickMarkerKind: user missed a target flag → red', () => {
  const r = pickMarkerKind({
    code: 'de',
    targetCodes: new Set(['fr', 'de']),
    userFoundCodes: new Set(['fr']),
  });
  assert.equal(r, 'missed');
});

test('pickMarkerKind: flag not in puzzle (distractor) → no marker', () => {
  const r = pickMarkerKind({
    code: 'si',
    targetCodes: new Set(['fr', 'de']),
    userFoundCodes: new Set(['fr']),
  });
  assert.equal(r, null);
});

test('pickMarkerKind: distractor the player clicked wrong → wrong', () => {
  const r = pickMarkerKind({
    code: 'ge',
    targetCodes: new Set(['fr', 'de']),
    userFoundCodes: new Set(['fr']),
    userWrongCodes: new Set(['ge']),
  });
  assert.equal(r, 'wrong');
});

test('pickMarkerKind: distractor the player did NOT click → no marker', () => {
  const r = pickMarkerKind({
    code: 'si',
    targetCodes: new Set(['fr', 'de']),
    userFoundCodes: new Set(['fr']),
    userWrongCodes: new Set(['ge']),
  });
  assert.equal(r, null);
});

test('pickMarkerKind: found/missed win over wrong (rows are partitioned)', () => {
  // A target is never a wrong-click, but assert the precedence explicitly.
  assert.equal(
    pickMarkerKind({
      code: 'fr',
      targetCodes: new Set(['fr']),
      userFoundCodes: new Set(['fr']),
      userWrongCodes: new Set(['fr']),
    }),
    'found',
  );
  assert.equal(
    pickMarkerKind({
      code: 'de',
      targetCodes: new Set(['de']),
      userFoundCodes: new Set(),
      userWrongCodes: new Set(['de']),
    }),
    'missed',
  );
});

test('pickMarkerKind: empty userFoundCodes (no-attempt state) → missed for targets, null for non-targets', () => {
  assert.equal(
    pickMarkerKind({ code: 'fr', targetCodes: new Set(['fr']), userFoundCodes: new Set() }),
    'missed',
  );
  assert.equal(
    pickMarkerKind({ code: 'xx', targetCodes: new Set(['fr']), userFoundCodes: new Set() }),
    null,
  );
});

test('hasAnyExtraStats reflects union of sections', () => {
  assert.equal(hasAnyExtraStats({ ranking: [], topMistake: [] }), false);
  assert.equal(hasAnyExtraStats({ ranking: [{ code: 'fr', pct: 100 }], topMistake: [] }), true);
  assert.equal(hasAnyExtraStats({ ranking: [], topMistake: [{ code: 'ua', count: 3 }] }), true);
});

// ---- pickDifficultyFacts (community two-fact line) ----

test('difficulty facts: null when no stats / no attempts / no targets', () => {
  assert.equal(pickDifficultyFacts({ stats: null, targetCodes: T }), null);
  assert.equal(pickDifficultyFacts({ stats: statsOf({ attempts: 0 }), targetCodes: T }), null);
  assert.equal(pickDifficultyFacts({ stats: statsOf({ attempts: 5, finds: {} }), targetCodes: [] }), null);
});

test('difficulty facts: hardest = lowest pct, easiest = highest', () => {
  const finds = { us: 71, gd: 0, fr: 40 };
  const r = pickDifficultyFacts({
    stats: statsOf({ attempts: 100, finds }),
    targetCodes: ['us', 'gd', 'fr'],
  });
  assert.deepEqual(r, {
    hardest: { pct: 0, codes: ['gd'], extra: 0 },
    easiest: { pct: 71, codes: ['us'], extra: 0 },
  });
});

test('difficulty facts: missing perCodeFinds code counts as 0%', () => {
  const r = pickDifficultyFacts({
    stats: statsOf({ attempts: 10, finds: { fr: 5 } }),
    targetCodes: ['fr', 'zz'],
  });
  assert.deepEqual(r.hardest, { pct: 0, codes: ['zz'], extra: 0 });
  assert.deepEqual(r.easiest, { pct: 50, codes: ['fr'], extra: 0 });
});

test('difficulty facts: ties share a fact — up to 3 named, rest counted', () => {
  // 5 flags tie at the floor (0%), 1 at the top.
  const finds = { us: 8 }; // 80%
  const r = pickDifficultyFacts({
    stats: statsOf({ attempts: 10, finds }),
    targetCodes: ['us', 'ee', 'dd', 'cc', 'bb', 'aa'], // aa..ee all 0%
  });
  // hardest: 5 tied at 0 → alphabetical aa,bb,cc named, +2 extra
  assert.deepEqual(r.hardest, { pct: 0, codes: ['aa', 'bb', 'cc'], extra: 2 });
  assert.deepEqual(r.easiest, { pct: 80, codes: ['us'], extra: 0 });
});

test('difficulty facts: all equal (every flag same pct) → null (no hardest/easiest exists)', () => {
  // When every flag ties there is no hardest or easiest, so naming one of each
  // would be nonsense — return null and render no facts line. The per-tile %s
  // still carry each flag's number.
  const finds = Object.fromEntries(T.map((c) => [c, 10]));
  assert.equal(pickDifficultyFacts({ stats: statsOf({ attempts: 10, finds }), targetCodes: T }), null);
});

test('difficulty facts: all equal at a non-100 value too → null', () => {
  const finds = Object.fromEntries(T.map((c) => [c, 5])); // 50% each
  assert.equal(pickDifficultyFacts({ stats: statsOf({ attempts: 10, finds }), targetCodes: T }), null);
});

test('difficulty facts: even a hair of spread → facts show (not treated as tied)', () => {
  // 71% vs 70% is spread → line renders.
  const r = pickDifficultyFacts({
    stats: statsOf({ attempts: 100, finds: { us: 71, gd: 70 } }),
    targetCodes: ['us', 'gd'],
  });
  assert.deepEqual(r, {
    hardest: { pct: 70, codes: ['gd'], extra: 0 },
    easiest: { pct: 71, codes: ['us'], extra: 0 },
  });
});

// ---- pickMistakeRail (collapsed vs full) ----

test('mistake rail: empty when no perWrongCode', () => {
  const r = pickMistakeRail({ stats: { totalAttempts: 10, perCodeFinds: {} } });
  assert.deepEqual(r, { collapsed: [], all: [], total: 0, hidden: 0 });
});

test('mistake rail: collapsed keeps only count ≥ 2, capped at 6; tail is the rest', () => {
  const wrong = { pl: 3, by: 2, fi: 2, it: 2, ch: 1, gb: 1, kz: 1, pt: 1, ro: 1, tr: 1 };
  const r = pickMistakeRail({ stats: statsOf({ attempts: 20, wrong }) });
  // 4 entries at ≥2 → all shown (under the cap of 6).
  assert.deepEqual(r.collapsed.map((e) => e.code), ['pl', 'by', 'fi', 'it']);
  assert.equal(r.total, 10);       // full list length
  assert.equal(r.hidden, 6);       // 10 - 4 shown = 6 one-offs behind the toggle
  assert.equal(r.all.length, 10);
});

test('mistake rail: more than 6 shared mistakes → collapsed caps at 6', () => {
  const wrong = { aa: 9, bb: 8, cc: 7, dd: 6, ee: 5, ff: 4, gg: 3, hh: 2, ii: 1 };
  const r = pickMistakeRail({ stats: statsOf({ attempts: 20, wrong }) });
  assert.deepEqual(r.collapsed.map((e) => e.code), ['aa', 'bb', 'cc', 'dd', 'ee', 'ff']);
  assert.equal(r.hidden, 3); // gg, hh (≥2 but past cap) + ii (the single)
  assert.equal(r.total, 9);
});

test('mistake rail: all one-offs → nothing collapsed, all hidden', () => {
  const wrong = { aa: 1, bb: 1, cc: 1 };
  const r = pickMistakeRail({ stats: statsOf({ attempts: 5, wrong }) });
  assert.deepEqual(r.collapsed, []);
  assert.equal(r.hidden, 3);
  assert.equal(r.total, 3);
});

test('mistake rail: full list capped at MISTAKE_MAX (20)', () => {
  const wrong = {};
  for (let i = 0; i < 30; i++) wrong[`t${String(i).padStart(2, '0')}`] = 1;
  const r = pickMistakeRail({ stats: statsOf({ attempts: 30, wrong }) });
  assert.equal(r.all.length, 20);
  assert.equal(r.total, 20);
});
