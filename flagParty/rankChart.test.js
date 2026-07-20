import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { formatValue } from '../flags/metricLens.js';

/**
 * The reveal chart's value column is a FIXED width, because that is what makes
 * the four rows share one vertical grid and the numbers line up. Fixed widths
 * only stay right if something checks them against the widest real content, and
 * nothing did: the column shipped at 44px, fitted to the 3-5 character values
 * ("10.7M", "0.14") that came up in a browser pass, and the 7-character ones
 * overflowed left across the gap and onto the bar.
 *
 * So this measures the actual widest string `formatValue` can produce over every
 * metric file and checks the column can hold it. It is a real check, not a
 * restatement of the constant: adding a metric with bigger numbers, or changing
 * how values are formatted, fails here instead of on someone's screen.
 */

const CSS = readFileSync(new URL('./index.css', import.meta.url), 'utf8');

/** The widest value any metric can render, in characters. */
function widestValueChars() {
  let widest = '';
  for (const file of readdirSync(new URL('../flags/metrics/', import.meta.url))) {
    if (!file.endsWith('.json') || file === 'index.json') continue;
    const metric = JSON.parse(readFileSync(new URL('../flags/metrics/' + file, import.meta.url), 'utf8'));
    if (!metric.values) continue;
    for (const raw of Object.values(metric.values)) {
      if (typeof raw !== 'number') continue;
      const shown = formatValue(raw, metric.format || 'compact');
      if (shown.length > widest.length) widest = shown;
    }
  }
  return widest;
}

/** `grid-template-columns` on `.rank-row`, as an array of track strings. */
function rankRowTracks() {
  const rule = CSS.match(/\.rank-row\s*\{([^}]*)\}/);
  assert.ok(rule, 'expected a .rank-row rule in flagParty/index.css');
  const tracks = rule[1].match(/grid-template-columns:\s*([^;]+);/);
  assert.ok(tracks, 'expected .rank-row to declare grid-template-columns');
  return tracks[1].trim().split(/\s+(?![^(]*\))/);
}

test('the value column fits the widest value any metric can produce', () => {
  const widest = widestValueChars();
  const valueTrack = rankRowTracks()[3];
  const px = Number((valueTrack.match(/^(\d+)px$/) || [])[1]);
  assert.ok(px, `expected a fixed px value track, got "${valueTrack}"`);
  // 15px tabular digits run about 0.55em per character (they are all one
  // advance, by definition of tabular-nums). Comma and period are narrower, so
  // this over-estimates slightly, which is the direction we want.
  const needed = Math.ceil(widest.length * 15 * 0.55);
  assert.ok(px >= needed,
    `.rank-row's value column is ${px}px but "${widest}" (${widest.length} chars) needs about ${needed}px; ` +
    'it will overflow left onto the bar');
});

test('the value column is not so wide it starves the name and bar', () => {
  // The other direction: the flexible 1fr track carries the country name AND the
  // bar, so an over-generous fixed column squeezes the thing the chart is for.
  const px = Number((rankRowTracks()[3].match(/^(\d+)px$/) || [])[1]);
  assert.ok(px <= 80, `a ${px}px value column leaves too little for the name and bar`);
});

test('every fixed track on a chart row really is fixed', () => {
  // The bug this file exists for: `auto` tracks let each row size its own
  // columns, so one avatar on your row shoved its value and points inward and
  // the numbers went ragged. Only the name/bar column may flex, and only
  // `--rail-w` may vary -- and that is stamped per chart, not per row.
  const tracks = rankRowTracks();
  assert.equal(tracks.length, 6, 'rank, flag, name+bar, value, avatars, points');
  assert.equal(tracks[2], '1fr', 'the name + bar column is the flexible one');
  for (const [i, track] of tracks.entries()) {
    if (i === 2) continue;
    assert.ok(!/\bauto\b|\bmin-content\b|\bmax-content\b/.test(track),
      `track ${i} is "${track}"; a content-sized track makes each row its own grid again`);
  }
});
