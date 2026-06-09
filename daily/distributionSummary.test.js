import { test } from 'node:test';
import assert from 'node:assert/strict';

import { formatStatsLines } from './distributionSummary.js';

const templates = {
  headline: 'Average today: {average}/{total}',
  plays: '{n} plays',
  hardest: 'Hardest: {name} ({pct}% found)',
};

const targets = [
  { code: 'ch', name: 'Switzerland' },
  { code: 'dk', name: 'Denmark' },
  { code: 'gb', name: 'United Kingdom' },
];
const getCountryName = (c) => c.name;

test('null stats → null', () => {
  assert.equal(
    formatStatsLines({ stats: null, totalCount: 9, targets, getCountryName, templates }),
    null,
  );
});

test('undefined stats → null', () => {
  assert.equal(
    formatStatsLines({ stats: undefined, totalCount: 9, targets, getCountryName, templates }),
    null,
  );
});

test('totalAttempts === 0 → null (no honest comparison yet)', () => {
  const stats = { totalAttempts: 0, median: 0, perCodeFinds: {} };
  assert.equal(
    formatStatsLines({ stats, totalCount: 9, targets, getCountryName, templates }),
    null,
  );
});

test('builds headline + detail with hardest flag when data is available', () => {
  const stats = {
    totalAttempts: 10,
    median: 3,
    perCodeFinds: { ch: 8, dk: 5, gb: 1 },
  };
  const out = formatStatsLines({ stats, totalCount: 3, targets, getCountryName, templates });
  assert.deepEqual(out, {
    headline: 'Average today: 3/3',
    detail: '10 plays · Hardest: United Kingdom (10% found)',
  });
});

test('hardest is the lowest-% flag (not just lowest count)', () => {
  // With totalAttempts=10, ch=1 is 10%, dk=5 is 50%, gb=2 is 20%. ch is hardest.
  const stats = {
    totalAttempts: 10, median: 1,
    perCodeFinds: { ch: 1, dk: 5, gb: 2 },
  };
  const out = formatStatsLines({ stats, totalCount: 3, targets, getCountryName, templates });
  assert.equal(out.detail, '10 plays · Hardest: Switzerland (10% found)');
});

test('ties for hardest break by country code alphabetically (deterministic order)', () => {
  // All three at 0% (all missing from perCodeFinds means 0)... wait that triggers the
  // empty-perCodeFinds short-circuit. So provide one find to keep the function active,
  // then tie-test on two others at 0%.
  const stats = {
    totalAttempts: 10, median: 0,
    perCodeFinds: { gb: 5 }, // ch and dk both at 0%, gb at 50%
  };
  const out = formatStatsLines({ stats, totalCount: 3, targets, getCountryName, templates });
  // ch comes before dk alphabetically → ch is the hardest
  assert.equal(out.detail, '10 plays · Hardest: Switzerland (0% found)');
});

test('empty perCodeFinds drops the hardest piece (no meaningful "hardest" when nobody found anything)', () => {
  const stats = { totalAttempts: 1, median: 0, perCodeFinds: {} };
  const out = formatStatsLines({ stats, totalCount: 3, targets, getCountryName, templates });
  assert.deepEqual(out, {
    headline: 'Average today: 0/3',
    detail: '1 plays',
  });
});

test('custom separator is honored', () => {
  const stats = { totalAttempts: 5, median: 2, perCodeFinds: { ch: 3 } };
  const out = formatStatsLines({
    stats, totalCount: 3, targets, getCountryName,
    templates: { ...templates, separator: ' — ' },
  });
  assert.equal(out.detail, '5 plays — Hardest: Denmark (0% found)');
});

test('non-integer median (e.g. 2.5) renders verbatim — keeps median honest for even-count populations', () => {
  const stats = { totalAttempts: 4, median: 2.5, perCodeFinds: { ch: 2 } };
  const out = formatStatsLines({ stats, totalCount: 6, targets, getCountryName, templates });
  assert.equal(out.headline, 'Average today: 2.5/6');
});

test('uses the injected getCountryName for localized names', () => {
  // ch at 10%, dk and gb at 0%. Hardest = dk (0%, alphabetical tie-break).
  const stats = { totalAttempts: 10, median: 1, perCodeFinds: { ch: 1 } };
  const out = formatStatsLines({
    stats, totalCount: 3, targets,
    getCountryName: (c) => `LOC-${c.code}`,
    templates,
  });
  assert.equal(out.detail, '10 plays · Hardest: LOC-dk (0% found)');
});

test('unknown {placeholder} in template is left intact (typo visibility)', () => {
  const stats = { totalAttempts: 5, median: 2, perCodeFinds: { ch: 3 } };
  const out = formatStatsLines({
    stats, totalCount: 3, targets, getCountryName,
    templates: { ...templates, headline: 'wat {nope}/{average}' },
  });
  assert.equal(out.headline, 'wat {nope}/2');
});

test('respects Polish-shaped templates', () => {
  const stats = { totalAttempts: 3, median: 2, perCodeFinds: { dk: 2, ch: 1 } };
  const out = formatStatsLines({
    stats, totalCount: 3, targets, getCountryName,
    templates: {
      headline: 'Średnio dziś: {average}/{total}',
      plays: '{n} prób',
      hardest: 'Najtrudniejsza: {name} ({pct}% znalazło)',
    },
  });
  // ch=1/3 = 33%, dk=2/3 = 67%, gb=0%. Hardest = gb at 0%.
  assert.equal(out.headline, 'Średnio dziś: 2/3');
  assert.equal(out.detail, '3 prób · Najtrudniejsza: United Kingdom (0% znalazło)');
});
