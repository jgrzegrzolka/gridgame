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

/**
 * Per-character advance of `.rank-val`, in em. **Measured, not guessed**: the
 * widest real value ("202,080", 7 chars) renders at 52px in a 15px `.rank-val`
 * in Chromium, giving 52 / (7 x 15) = 0.495. Rounded up to 0.5.
 *
 * It has to be a constant rather than a live measurement because there is no
 * layout engine here, and it has to be honest because the column width is
 * checked against it: an estimate tuned until the shipped value passed would
 * make this test a restatement of that value rather than a check on it.
 */
const CHAR_ADVANCE_EM = 0.5;

/** Headroom the column must have beyond the widest value it can be asked to
 *  hold. Without a margin the assertion passes at exactly the boundary, which
 *  is indistinguishable from having been derived from it — and leaves nothing
 *  for a font that renders a hair wider than Chromium's. */
const MARGIN_PX = 4;

test('the value column fits the widest value any metric can produce', () => {
  const widest = widestValueChars();
  const valueTrack = rankRowTracks()[3];
  const px = Number((valueTrack.match(/^(\d+)px$/) || [])[1]);
  assert.ok(px, `expected a fixed px value track, got "${valueTrack}"`);
  const needed = Math.ceil(widest.length * 15 * CHAR_ADVANCE_EM) + MARGIN_PX;
  assert.ok(px >= needed,
    `.rank-row's value column is ${px}px but "${widest}" (${widest.length} chars) needs ${needed}px ` +
    `(including ${MARGIN_PX}px headroom); it will overflow left onto the bar`);
});

test('the value column is not so wide it starves the name and bar', () => {
  // The other direction: the flexible 1fr track carries the country name AND the
  // bar, so an over-generous fixed column squeezes the thing the chart is for.
  // The bound is the widest value plus half again — enough that a genuinely
  // wider metric can grow the column, but not enough to let it creep.
  const px = Number((rankRowTracks()[3].match(/^(\d+)px$/) || [])[1]);
  const ceiling = Math.ceil(widestValueChars().length * 15 * CHAR_ADVANCE_EM * 1.5);
  assert.ok(px <= ceiling,
    `a ${px}px value column exceeds the ${ceiling}px ceiling and leaves too little for the name and bar`);
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
