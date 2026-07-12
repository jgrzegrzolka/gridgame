import { test } from 'node:test';
import assert from 'node:assert/strict';

import { formatValue, computeLensView } from './metricLens.js';
import { createMetric } from './metrics.js';

test('formatValue: compact magnitudes', () => {
  assert.equal(formatValue(27811517000000, 'compact'), '27.81T'); // GDP reaches trillions
  assert.equal(formatValue(1438069596, 'compact'), '1.44B');
  assert.equal(formatValue(336755052, 'compact'), '336.8M');
  assert.equal(formatValue(552747, 'compact'), '552.7K');
  assert.equal(formatValue(800, 'compact'), '800');
  assert.equal(formatValue(50, 'compact'), '50');
});

test('formatValue: decimal1 for per-capita rates', () => {
  assert.equal(formatValue(6.53, 'decimal1'), '6.5');
  assert.equal(formatValue(0.1, 'decimal1'), '0.1');
});

test('formatValue: plain keeps exact metres with thousands separators', () => {
  // Elevation: compact would collapse these three peaks to an identical "8.6K"–
  // "8.8K"; plain preserves the precise metre that the metric exists to show.
  assert.equal(formatValue(8849, 'plain'), '8,849'); // Everest
  assert.equal(formatValue(8611, 'plain'), '8,611'); // K2
  assert.equal(formatValue(978, 'plain'), '978'); // Scafell Pike, no separator
  assert.equal(formatValue(2, 'plain'), '2'); // Maldives, the lowest highpoint
});

test('formatValue: defaults to compact when no hint', () => {
  assert.equal(formatValue(2500000), '2.5M');
});

// A tiny metric over 4 countries; 'dd' has no value (sparse).
const COUNTRIES = [
  { code: 'aa', continent: 'Europe', statehood: 'un_member' },
  { code: 'bb', continent: 'Europe', statehood: 'un_member' },
  { code: 'cc', continent: 'Asia', statehood: 'un_member' },
  { code: 'dd', continent: 'Asia', statehood: 'un_member' },
];
const metric = createMetric(
  { key: 'm', label: 'M', unit: 'u', format: 'compact', source: 't', year: 2000,
    values: { aa: 300, bb: 100, cc: 5000 } },
  COUNTRIES,
);

test('computeLensView: null metric leaves order untouched, all no-data', () => {
  const { order, cells } = computeLensView(null, COUNTRIES);
  assert.deepEqual(order, [0, 1, 2, 3]);
  assert.equal(cells.every((c) => !c.hasData), true);
});

test('computeLensView: default sort keeps original order but fills cells', () => {
  const { order, cells } = computeLensView(metric, COUNTRIES, { sort: 'default' });
  assert.deepEqual(order, [0, 1, 2, 3]);
  assert.deepEqual(cells.map((c) => c.hasData), [true, true, true, false]);
  assert.equal(cells[0].display, '300');
  assert.equal(cells[2].rank, 1); // cc=5000 is world rank 1
  assert.equal(cells[3].display, ''); // dd no data
});

test('computeLensView: desc sorts by value, no-data sinks last', () => {
  const { order } = computeLensView(metric, COUNTRIES, { sort: 'desc' });
  // cc(5000) aa(300) bb(100) then dd(no data)
  assert.deepEqual(order, [2, 0, 1, 3]);
});

test('computeLensView: asc sorts ascending, no-data still last', () => {
  const { order } = computeLensView(metric, COUNTRIES, { sort: 'asc' });
  // bb(100) aa(300) cc(5000) then dd(no data)
  assert.deepEqual(order, [1, 0, 2, 3]);
});

test('computeLensView: rank uses sovereign scope', () => {
  const { cells } = computeLensView(metric, COUNTRIES, { sort: 'default' });
  assert.equal(cells[0].rank, 2); // aa=300 → rank 2
  assert.equal(cells[1].rank, 3); // bb=100 → rank 3
});

test('computeLensView: non-sovereign places show a value but get no rank', () => {
  const countries = [
    { code: 'aa', continent: 'Europe', statehood: 'un_member' },
    { code: 'hk', continent: 'Asia', statehood: 'territory' }, // biggest value, not sovereign
    { code: 'bb', continent: 'Europe', statehood: 'un_member' },
  ];
  const m = createMetric(
    { key: 'm', label: 'M', unit: 'u', format: 'compact', source: 't', year: 2000,
      values: { aa: 300, hk: 5000, bb: 100 } },
    countries,
  );
  const { cells, order } = computeLensView(m, countries, { sort: 'desc' });
  // hk has data and the largest value, but sits outside the sovereign ranking.
  assert.equal(cells[1].hasData, true);
  assert.equal(cells[1].rank, null);
  assert.equal(cells[1].display, '5.0K');
  // The two sovereign states are numbered among themselves.
  assert.equal(cells[0].rank, 1); // aa=300 → sovereign rank 1
  assert.equal(cells[2].rank, 2); // bb=100 → sovereign rank 2
  // hk still interleaves by value (it has data, so it doesn't sink).
  assert.deepEqual(order, [1, 0, 2]);
});
