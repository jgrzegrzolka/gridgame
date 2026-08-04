import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { scheduleEntranceFocus, readEntranceEnv, ENTRANCE_FOCUS_DELAY_MS } from './entrance.js';
import { paintLives } from './playFlow.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const commonCss = readFileSync(join(HERE, '..', 'common.css'), 'utf-8');
const html = readFileSync(join(HERE, 'index.html'), 'utf-8');

/** The `<section id="game">` block — the playing screen, entrance and all. */
function gameSection() {
  const m = html.match(/<section id="game"[\s\S]*?<\/section>/);
  assert.ok(m, 'daily/index.html must carry a #game section');
  return m[0];
}

/** The `<section id="result">` block — the finish board. */
function resultSection() {
  const m = html.match(/<section id="result"[\s\S]*?<\/section>/);
  assert.ok(m, 'daily/index.html must carry a #result section');
  return m[0];
}

// ---- the mechanism is shared, and its timing is global ----

test('entrance: the mechanism lives in common.css, not in a feature sheet', () => {
  // Same-mechanism-same-code (CLAUDE.md): every page that stages its entrance
  // reads these tokens, so a page can only choose the ORDER, never its own
  // timing. A copy in daily/index.css would be the start of the drift.
  assert.match(commonCss, /--enter-duration:\s*300ms/);
  assert.match(commonCss, /--enter-stagger:\s*60ms/);
  assert.match(commonCss, /@keyframes page-enter/);
  assert.match(commonCss, /@keyframes page-wash/);
  const dailyCss = readFileSync(join(HERE, 'index.css'), 'utf-8');
  assert.ok(!/@keyframes page-enter/.test(dailyCss), 'the daily sheet must not redefine the entrance');
});

test('entrance: the caret lands exactly when the input has finished arriving', () => {
  // The delay is not a taste call — it is the input's own beat
  // (--enter-i: 2), i.e. duration + 2 x stagger. Read both tokens out of
  // common.css so retuning the entrance can never silently leave the focus
  // firing mid-animation (too early) or after a pause (too late).
  const duration = Number(commonCss.match(/--enter-duration:\s*(\d+)ms/)[1]);
  const stagger = Number(commonCss.match(/--enter-stagger:\s*(\d+)ms/)[1]);
  assert.equal(ENTRANCE_FOCUS_DELAY_MS, duration + 2 * stagger);
});

test('entrance: reduced motion drops it entirely', () => {
  assert.match(
    commonCss,
    /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.enter,\s*\.enter-wash,\s*\.daily-lives \.enter-heart\s*\{\s*animation:\s*none/,
    'all three entrance animations must stop under reduced motion',
  );
});

// ---- the daily playing screen sets the order ----

test('entrance: the daily play screen arrives in reading order', () => {
  const game = gameSection();
  assert.match(game, /<section id="game" class="enter-wash"/, 'the column washes in');
  const beats = [...game.matchAll(/class="([^"]*\benter\b[^"]*)"[^>]*style="--enter-i: (\d)"/g)]
    .map((m) => [m[1], Number(m[2])]);
  const order = beats.map(([, i]) => i);
  assert.deepEqual(order, [0, 2, 3, 4], 'header, input, note, dock — beat 1 is the hearts row');
  assert.match(beats[0][0], /daily-header/);
  assert.match(beats[1][0], /find-input-wrap/);
  assert.match(beats[2][0], /daily-desc/);
  assert.match(beats[3][0], /dock/);
});

// Note: `.enter` leaves every element it touches a permanent stacking context
// (its transform keyframe fills forever). What that breaks, and the two rules
// that hold it, are pinned in daily/stacking.test.js.

test('entrance: the found-tiles grid keeps its own per-tile drop', () => {
  const game = gameSection();
  const found = game.match(/<ul class="([^"]*)" id="find-found"/);
  assert.ok(found, '#find-found must still be in the game section');
  assert.ok(!/\benter\b/.test(found[1]), 'found tiles animate per tile (.tile-drop), not as one block');
});

test('entrance: the finish board is exempt — it owns its own choreography', () => {
  const result = resultSection();
  assert.ok(!/\benter\b/.test(result), '#result must not opt into the shared entrance');
});

// ---- the hearts are dealt out once, not on every repaint ----

/** Minimal element/document stubs — paintLives only builds nodes. */
function makeDoc() {
  const make = (tag) => {
    const el = {
      tag,
      className: '',
      children: [],
      style: /** @type {Record<string, string>} */ ({}),
      attrs: /** @type {Record<string, string>} */ ({}),
      classList: {
        add(c) { el.className = el.className ? `${el.className} ${c}` : c; },
        toggle() {},
      },
      setAttribute(k, v) { el.attrs[k] = v; },
      appendChild(c) { el.children.push(c); return c; },
      set innerHTML(_v) { el.children.length = 0; },
    };
    el.style.setProperty = (k, v) => { el.style[k] = v; };
    return el;
  };
  return {
    createElement: make,
    createElementNS: (_ns, tag) => make(tag),
  };
}

function makeRow() {
  const row = makeDoc().createElement('ul');
  return row;
}

test('lives: the first paint deals the hearts out, one beat each', () => {
  globalThis.document = makeDoc();
  const row = makeRow();
  paintLives(/** @type {any} */ (row), 3, 3, { enter: true });
  assert.equal(row.children.length, 3);
  row.children.forEach((li, i) => {
    assert.match(li.className, /\benter-heart\b/);
    assert.equal(li.style['--enter-i'], String(i), 'index is 0-based and in DOM order');
  });
});

test('lives: a repaint mid-game does not replay the entrance', () => {
  // paintLives rebuilds the whole row on every wrong guess. Without the
  // opt-in, spending a heart would re-deal all of them — an entrance that
  // fires five times a round is a tic, not an entrance.
  globalThis.document = makeDoc();
  const row = makeRow();
  paintLives(/** @type {any} */ (row), 3, 2);
  for (const li of row.children) {
    assert.ok(!/enter-heart/.test(li.className), 'no entrance class on a mid-game repaint');
    assert.equal(li.style['--enter-i'], undefined);
  }
});

// ---- the entrance ends with the caret in the input ----

test('focus: lands in the input after the entrance, not before', () => {
  let focused = 0;
  const input = { value: '', focus: () => { focused += 1; } };
  /** @type {{ fn: () => void, ms: number } | null} */
  let scheduled = null;
  const handle = scheduleEntranceFocus(input, {
    schedule: (fn, ms) => { scheduled = { fn, ms }; return 7; },
  });
  assert.equal(handle, 7);
  assert.equal(focused, 0, 'nothing focuses on the first frame');
  assert.equal(scheduled.ms, ENTRANCE_FOCUS_DELAY_MS);
  scheduled.fn();
  assert.equal(focused, 1);
});

test('focus: never steals the caret from someone who started typing', () => {
  // The input is live throughout the entrance on purpose. A fast typer who
  // got two letters in must not have the caret yanked back.
  let focused = 0;
  const input = { value: 'po', focus: () => { focused += 1; } };
  /** @type {any} */
  let scheduled = null;
  scheduleEntranceFocus(input, { schedule: (fn) => { scheduled = fn; return 1; } });
  scheduled();
  assert.equal(focused, 0);
});

test('focus: immediate under reduced motion — there is no entrance to wait for', () => {
  let focused = 0;
  const input = { value: '', focus: () => { focused += 1; } };
  let scheduledCalls = 0;
  const handle = scheduleEntranceFocus(input, {
    reducedMotion: true,
    schedule: () => { scheduledCalls += 1; return 1; },
  });
  assert.equal(focused, 1);
  assert.equal(scheduledCalls, 0, 'no timer at all');
  assert.equal(handle, null);
});

test('focus: touch devices are left alone', () => {
  // Pre-existing behaviour, kept: focusing here throws the on-screen
  // keyboard over the board before the puzzle has been read.
  let focused = 0;
  let scheduledCalls = 0;
  const input = { value: '', focus: () => { focused += 1; } };
  scheduleEntranceFocus(input, { touch: true, schedule: () => { scheduledCalls += 1; return 1; } });
  assert.equal(focused, 0);
  assert.equal(scheduledCalls, 0);
});

test('focus: the environment probe reads touch and reduced motion off the window', () => {
  const desktop = { matchMedia: (q) => ({ matches: q.includes('reduce') }) };
  assert.deepEqual(readEntranceEnv(desktop), { touch: false, reducedMotion: true });
  const phone = { ontouchstart: null, matchMedia: () => ({ matches: false }) };
  assert.deepEqual(readEntranceEnv(phone), { touch: true, reducedMotion: false });
  // A view without matchMedia (older embedded browsers) must not throw.
  assert.deepEqual(readEntranceEnv({}), { touch: false, reducedMotion: false });
});
