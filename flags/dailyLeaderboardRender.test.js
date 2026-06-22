import { test } from 'node:test';
import assert from 'node:assert/strict';

import { renderLeaderboard } from './dailyLeaderboardRender.js';

const ME = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const OTHER = 'bbbbbbbb-cccc-dddd-eeee-ffffffffffff';

/** Stub `Document` that records the tree we built. */
function makeDoc() {
  /** @type {any} */
  const doc = {};
  doc.createElement = (/** @type {string} */ tag) => {
    /** @type {any} */
    const el = {
      tag,
      className: '',
      textContent: '',
      start: undefined,
      attributes: /** @type {Record<string, string>} */ ({}),
      children: [],
      appendChild(/** @type {any} */ c) { this.children.push(c); return c; },
      setAttribute(/** @type {string} */ name, /** @type {string} */ value) {
        this.attributes[name] = value;
      },
    };
    return el;
  };
  return doc;
}

/** Identity translator — returns the fallback so tests don't depend on i18n state. */
const t = (/** @type {string} */ _key, /** @type {string} */ fallback) => fallback;

/** Walk the children tree to flat-collect all elements with a className matching `cls`. */
function findAllByClass(/** @type {any} */ el, /** @type {string} */ cls) {
  /** @type {any[]} */
  const out = [];
  /** @param {any} node */
  function walk(node) {
    if (!node || typeof node !== 'object') return;
    if (typeof node.className === 'string' && node.className.split(' ').includes(cls)) {
      out.push(node);
    }
    if (Array.isArray(node.children)) node.children.forEach(walk);
  }
  walk(el);
  return out;
}

test('renderLeaderboard: loading state shows status text only', () => {
  const doc = makeDoc();
  const root = renderLeaderboard({ state: 'loading', t, doc });
  const statuses = findAllByClass(root, 'leaderboard-status');
  assert.equal(statuses.length, 1);
  assert.match(statuses[0].textContent, /Loading/);
});

test('renderLeaderboard: failed state shows the failed message', () => {
  const doc = makeDoc();
  const root = renderLeaderboard({ state: 'failed', t, doc });
  const failed = findAllByClass(root, 'leaderboard-status-failed');
  assert.equal(failed.length, 1);
  assert.match(failed[0].textContent, /Couldn't load/);
});

test('renderLeaderboard: ready + empty top → empty-state copy', () => {
  const doc = makeDoc();
  const root = renderLeaderboard({
    state: 'ready', data: { top: [], you: null }, t, doc,
  });
  const empty = findAllByClass(root, 'leaderboard-status-empty');
  assert.equal(empty.length, 1);
  assert.match(empty[0].textContent, /Be the first/);
});

test('renderLeaderboard: ranks rows 1..N and shows nickname/score/time per row', () => {
  const doc = makeDoc();
  const top = [
    { deviceId: 'd1', nickname: 'Alice', score: 20, durationMs: 32_400 },
    { deviceId: 'd2', nickname: 'Bob',   score: 18, durationMs: 41_000 },
    { deviceId: 'd3', nickname: null,    score: 17, durationMs: 50_000 },
  ];
  const root = renderLeaderboard({ state: 'ready', data: { top, you: null }, t, doc });
  const rows = findAllByClass(root, 'leaderboard-row');
  assert.equal(rows.length, 3);

  const ranks = rows.map((r) => findAllByClass(r, 'leaderboard-rank')[0].textContent);
  assert.deepEqual(ranks, ['1.', '2.', '3.']);

  const names = rows.map((r) => findAllByClass(r, 'leaderboard-name')[0].textContent);
  assert.equal(names[0], 'Alice');
  assert.equal(names[1], 'Bob');
  // null nickname → default derived from deviceId (FNV-1a name); not empty
  assert.notEqual(names[2], '');

  const scores = rows.map((r) => findAllByClass(r, 'leaderboard-score')[0].textContent);
  assert.deepEqual(scores, ['20', '18', '17']);
});

test('renderLeaderboard: own row gets is-self marker class', () => {
  const doc = makeDoc();
  const top = [
    { deviceId: 'd1',  nickname: 'Alice', score: 20, durationMs: 32_400 },
    { deviceId: ME,    nickname: 'Me',    score: 18, durationMs: 41_000 },
  ];
  const root = renderLeaderboard({
    state: 'ready', data: { top, you: { rank: 2, score: 18, durationMs: 41_000 } },
    ownDeviceId: ME, t, doc,
  });
  const rows = findAllByClass(root, 'leaderboard-row');
  assert.equal(rows[0].className.includes('is-self'), false);
  assert.equal(rows[1].className.includes('is-self'), true);
});

test('renderLeaderboard: when caller is outside top — append "…" + you-row at the bottom', () => {
  const doc = makeDoc();
  const top = Array.from({ length: 10 }, (_, i) => ({
    deviceId: `d${i + 1}`, nickname: `P${i + 1}`,
    score: 100 - i, durationMs: 30_000 + i * 1000,
  }));
  const root = renderLeaderboard({
    state: 'ready',
    data: { top, you: { rank: 87, score: 12, durationMs: 55_000 } },
    ownDeviceId: ME, t, doc,
  });

  const seps = findAllByClass(root, 'leaderboard-sep');
  assert.equal(seps.length, 1);
  assert.equal(seps[0].textContent, '…');

  const youList = findAllByClass(root, 'leaderboard-list-you');
  assert.equal(youList.length, 1);
  assert.equal(youList[0].start, 87);

  const youRow = findAllByClass(youList[0], 'leaderboard-row');
  assert.equal(youRow.length, 1);
  assert.ok(youRow[0].className.includes('is-self'));
  assert.equal(findAllByClass(youRow[0], 'leaderboard-name')[0].textContent, 'You');
});

test('renderLeaderboard: when caller IS in top — no duplicate "…You" row', () => {
  const doc = makeDoc();
  const top = [
    { deviceId: ME, nickname: 'Me', score: 20, durationMs: 32_000 },
    { deviceId: OTHER, nickname: 'Bob', score: 18, durationMs: 41_000 },
  ];
  const root = renderLeaderboard({
    state: 'ready',
    data: { top, you: { rank: 1, score: 20, durationMs: 32_000 } },
    ownDeviceId: ME, t, doc,
  });
  assert.equal(findAllByClass(root, 'leaderboard-sep').length, 0);
  assert.equal(findAllByClass(root, 'leaderboard-list-you').length, 0);
});

test('renderLeaderboard: when ownDeviceId not supplied — never highlight, never append you-row', () => {
  const doc = makeDoc();
  const top = [
    { deviceId: ME, nickname: 'Me', score: 20, durationMs: 32_000 },
  ];
  const root = renderLeaderboard({
    state: 'ready',
    data: { top, you: { rank: 87, score: 12, durationMs: 55_000 } },
    t, doc,
  });
  const rows = findAllByClass(root, 'leaderboard-row');
  assert.equal(rows[0].className.includes('is-self'), false);
  assert.equal(findAllByClass(root, 'leaderboard-list-you').length, 0);
});

test('renderLeaderboard: caller-in-top + you=null still highlights the self row', () => {
  // Caller's row is in top; the `you` block returning null is allowed
  // (e.g. the rank query failed silently). Highlight must still happen
  // off the top match alone — `you` shouldn't be load-bearing for that.
  const doc = makeDoc();
  const top = [
    { deviceId: 'd1', nickname: 'Alice', score: 20, durationMs: 30_000 },
    { deviceId: ME,   nickname: 'Me',    score: 18, durationMs: 41_000 },
  ];
  const root = renderLeaderboard({
    state: 'ready', data: { top, you: null }, ownDeviceId: ME, t, doc,
  });
  const rows = findAllByClass(root, 'leaderboard-row');
  assert.equal(rows[1].className.includes('is-self'), true);
});

test('renderLeaderboard: you.rank ≤ TOP_N but caller NOT in top (cache/server mismatch) — render top, no you-row appended', () => {
  // Documents the chosen behaviour for a data-inconsistency edge case so
  // anyone touching the renderer notices it. We don't fake a you-row when
  // we can't anchor it to a real top entry; better to show top only than
  // to invent a position.
  const doc = makeDoc();
  const top = [
    { deviceId: 'd1', nickname: 'Alice', score: 20, durationMs: 30_000 },
    { deviceId: 'd2', nickname: 'Bob',   score: 18, durationMs: 41_000 },
  ];
  const root = renderLeaderboard({
    state: 'ready',
    data: { top, you: { rank: 5, score: 14, durationMs: 60_000 } },
    ownDeviceId: ME, t, doc,
  });
  assert.equal(findAllByClass(root, 'leaderboard-row').length, 2);
  assert.equal(findAllByClass(root, 'leaderboard-list-you').length, 0);
  assert.equal(findAllByClass(root, 'leaderboard-sep').length, 0);
});

test('renderLeaderboard: malicious nickname is set via textContent, not innerHTML', () => {
  const doc = makeDoc();
  const top = [
    { deviceId: 'd1', nickname: '<script>alert(1)</script>', score: 20, durationMs: 32_000 },
  ];
  const root = renderLeaderboard({ state: 'ready', data: { top, you: null }, t, doc });
  const name = findAllByClass(root, 'leaderboard-name')[0];
  // It lands as literal text — not parsed as a DOM tree — because we use textContent.
  assert.equal(name.textContent, '<script>alert(1)</script>');
  assert.equal(name.children.length, 0);
});

// ---------------------------------------------------------------------------
// Auto-name signal (Feature S Phase 1b) — entries with `nicknameAuto: true`
// get a 🎲 marker so viewers can tell "this player goes by their auto-
// generated default" without joining back to profiles.
// ---------------------------------------------------------------------------

test('renderLeaderboard: nicknameAuto:true entry gets a 🎲 marker with accessibility label', () => {
  const doc = makeDoc();
  const top = [
    { deviceId: 'd1', nickname: null, nicknameAuto: true, score: 20, durationMs: 32_000 },
  ];
  const root = renderLeaderboard({ state: 'ready', data: { top, you: null }, t, doc });
  const autos = findAllByClass(root, 'leaderboard-name-auto');
  assert.equal(autos.length, 1);
  assert.equal(autos[0].textContent, '🎲');
  // Emoji alone reads as "game die" on screen readers — aria-label conveys
  // the actual meaning ("this nickname is auto-generated").
  assert.equal(autos[0].attributes['aria-label'], 'auto-generated name');
});

test('renderLeaderboard: nicknameAuto:false (customised) — no marker', () => {
  const doc = makeDoc();
  const top = [
    { deviceId: 'd1', nickname: 'Alice', nicknameAuto: false, score: 20, durationMs: 32_000 },
  ];
  const root = renderLeaderboard({ state: 'ready', data: { top, you: null }, t, doc });
  assert.equal(findAllByClass(root, 'leaderboard-name-auto').length, 0);
});

test('renderLeaderboard: nicknameAuto missing (legacy row) — no marker', () => {
  // Backwards-compat: leaderboard rows written before Feature S Phase 1b
  // won't have the field. They render exactly as they did pre-1b — no
  // visual change for legacy data.
  const doc = makeDoc();
  const top = [
    { deviceId: 'd1', nickname: 'Alice', score: 20, durationMs: 32_000 },
    { deviceId: 'd2', nickname: null,    score: 18, durationMs: 41_000 },
  ];
  const root = renderLeaderboard({ state: 'ready', data: { top, you: null }, t, doc });
  assert.equal(findAllByClass(root, 'leaderboard-name-auto').length, 0);
});

test('renderLeaderboard: bottom "You" row never gets the auto marker (it shows the literal "You")', () => {
  // The selfLabelOverride path renders "You", not a nickname. Decorating
  // "You" with 🎲 would be nonsensical — the marker only attaches to
  // actual displayed names. The top-list self row (which shows the real
  // nickname) still gets the marker — see the next test.
  const doc = makeDoc();
  const top = Array.from({ length: 10 }, (_, i) => ({
    deviceId: `d${i + 1}`, nickname: `P${i + 1}`,
    score: 100 - i, durationMs: 30_000 + i * 1000,
  }));
  const root = renderLeaderboard({
    state: 'ready',
    data: { top, you: { rank: 87, score: 12, durationMs: 55_000 } },
    ownDeviceId: ME, t, doc,
  });
  const youList = findAllByClass(root, 'leaderboard-list-you');
  assert.equal(findAllByClass(youList[0], 'leaderboard-name-auto').length, 0);
});

test('renderLeaderboard: own row IN top with nicknameAuto:true — marker still renders', () => {
  // Top-list self rows render the real nickname (not "You"), so they
  // should get the marker just like other entries. The viewer sees
  // themself with the same signal others see them by.
  const doc = makeDoc();
  const top = [
    { deviceId: ME, nickname: null, nicknameAuto: true, score: 20, durationMs: 32_000 },
  ];
  const root = renderLeaderboard({
    state: 'ready', data: { top, you: { rank: 1, score: 20, durationMs: 32_000 } },
    ownDeviceId: ME, t, doc,
  });
  assert.equal(findAllByClass(root, 'leaderboard-name-auto').length, 1);
});

test('renderLeaderboard: formatScore transforms the score column (endurance mode displays correct count, not wrong count)', () => {
  // Endurance ('all') stores score = wrongCount. The page passes a
  // formatter that maps wrongCount → correctCount via `target - n`.
  // Without the transform the panel reads "Alice 0" which the player
  // parses as "Alice got 0 correct" instead of "Alice got 0 wrong".
  const doc = makeDoc();
  const top = [
    { deviceId: 'd1', nickname: 'Alice', score: 0, durationMs: 60_000 },  // perfect run
    { deviceId: 'd2', nickname: 'Bob',   score: 3, durationMs: 50_000 },  // 3 wrong
  ];
  const target = 195;
  const root = renderLeaderboard({
    state: 'ready',
    data: { top, you: null },
    t, doc,
    formatScore: (n) => String(target - n),
  });
  const scores = findAllByClass(root, 'leaderboard-score');
  assert.equal(scores[0].textContent, '195');
  assert.equal(scores[1].textContent, '192');
});

test('renderLeaderboard: formatScore also applies to the bottom "you" row when rank > TOP_N', () => {
  const doc = makeDoc();
  const top = Array.from({ length: 10 }, (_, i) => ({
    deviceId: `d${i}`, nickname: `P${i}`, score: i, durationMs: 60_000,
  }));
  const target = 50;
  const root = renderLeaderboard({
    state: 'ready',
    data: { top, you: { rank: 14, score: 8, durationMs: 90_000 } },
    ownDeviceId: ME, t, doc,
    formatScore: (n) => String(target - n),
  });
  const youList = findAllByClass(root, 'leaderboard-list-you')[0];
  const youScore = findAllByClass(youList, 'leaderboard-score')[0];
  // 50 target - 8 wrong = 42 correct
  assert.equal(youScore.textContent, '42');
});

test('renderLeaderboard: omitting formatScore preserves the original score string (60s timed mode)', () => {
  // 60s mode stores score = correctCount already — no transform desired.
  // Pin the default-behaviour path so a future refactor can't break it.
  const doc = makeDoc();
  const top = [{ deviceId: 'd1', nickname: 'Alice', score: 22, durationMs: 60_000 }];
  const root = renderLeaderboard({ state: 'ready', data: { top, you: null }, t, doc });
  const score = findAllByClass(root, 'leaderboard-score')[0];
  assert.equal(score.textContent, '22');
});
