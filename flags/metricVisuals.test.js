import { test } from 'node:test';
import assert from 'node:assert/strict';

import { METRIC_ICONS, METRIC_HUES, METRIC_SHORT } from './metricVisuals.js';
import { METRIC_FILES } from './metrics/index.js';

// The contract: every registered metric has a complete visual identity, and
// the visuals module carries no stale entries for metrics that no longer
// exist. This is what makes "add a metric" fail loudly here instead of
// rendering a blank chip on flagsdata / findFlag / Flag Party.

const KEYS = METRIC_FILES.map((m) => m.key);

test('every registered metric has an icon, a hue, and a short label', () => {
  /** @type {string[]} */
  const missing = [];
  for (const key of KEYS) {
    if (!METRIC_ICONS[key]) missing.push(`icon:${key}`);
    if (!METRIC_HUES[key]) missing.push(`hue:${key}`);
    if (!METRIC_SHORT[key]) missing.push(`short:${key}`);
  }
  assert.deepEqual(missing, []);
});

test('no visual entry points at an unregistered metric key', () => {
  const known = new Set(KEYS);
  /** @type {string[]} */
  const stale = [];
  for (const key of Object.keys(METRIC_ICONS)) if (!known.has(key)) stale.push(`icon:${key}`);
  for (const key of Object.keys(METRIC_HUES)) if (!known.has(key)) stale.push(`hue:${key}`);
  for (const key of Object.keys(METRIC_SHORT)) if (!known.has(key)) stale.push(`short:${key}`);
  assert.deepEqual(stale, []);
});

test('icons are tintable inline svgs in the shared line style', () => {
  for (const [key, svg] of Object.entries(METRIC_ICONS)) {
    assert.match(svg, /^<svg viewBox="0 0 24 24"/, `${key} icon must use the 24-box`);
    assert.match(svg, /<\/svg>$/, `${key} icon must be a closed <svg>`);
    assert.match(svg, /currentColor/, `${key} icon must tint via currentColor`);
  }
});

test('hues are 6-digit hex colours', () => {
  for (const [key, hue] of Object.entries(METRIC_HUES)) {
    assert.match(hue, /^#[0-9a-f]{6}$/, `${key} hue must be a lowercase #rrggbb`);
  }
});

test('short labels carry an i18n key and a non-empty fallback', () => {
  for (const [key, s] of Object.entries(METRIC_SHORT)) {
    assert.ok(s.key.length > 0, `${key} short label needs an i18n key`);
    assert.ok(s.fallback.length > 0, `${key} short label needs a fallback`);
  }
});
