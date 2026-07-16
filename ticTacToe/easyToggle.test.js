import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { wireEasyToggle, decideEasyToggleState } from './easyToggle.js';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Minimal stand-in for the checkbox: the three things wireEasyToggle touches
 * (`checked`, `addEventListener`, and the change event firing) plus a `flip`
 * helper that does what a real click does — move the checkbox, then dispatch.
 */
function fakeInput({ checked = false } = {}) {
  /** @type {Array<() => void>} */
  const listeners = [];
  return {
    checked,
    /** @param {string} type @param {() => void} fn */
    addEventListener(type, fn) {
      if (type === 'change') listeners.push(fn);
    },
    /** @param {boolean} to */
    flip(to) {
      this.checked = to;
      for (const fn of listeners) fn();
    },
  };
}

function fakeStorage(initial = {}) {
  /** @type {Record<string, string>} */
  const data = { ...initial };
  return {
    data,
    /** @param {string} k */
    getItem(k) { return k in data ? data[k] : null; },
    /** @param {string} k @param {string} v */
    setItem(k, v) { data[k] = v; },
    /** @param {string} k */
    removeItem(k) { delete data[k]; },
  };
}

/** Collects deferred callbacks so the test drives the clock, not setTimeout. */
function fakeDefer() {
  /** @type {Array<{ fn: () => void, ms: number }>} */
  const calls = [];
  /** @param {() => void} fn @param {number} ms */
  const defer = (fn, ms) => { calls.push({ fn, ms }); };
  return { calls, defer, run: () => calls.forEach((c) => c.fn()) };
}

test('wireEasyToggle: reflects the stored setting at boot', () => {
  const on = fakeInput();
  wireEasyToggle({
    inputEl: /** @type {any} */ (on),
    storage: fakeStorage({ 'gridgame.ttt.easy': 'true' }),
    isBoardUntouched: () => true,
    redeal: () => {},
    defer: () => {},
  });
  assert.equal(on.checked, true);

  const off = fakeInput({ checked: true });
  wireEasyToggle({
    inputEl: /** @type {any} */ (off),
    storage: fakeStorage(),
    isBoardUntouched: () => true,
    redeal: () => {},
    defer: () => {},
  });
  assert.equal(off.checked, false, 'an unset key is off, not "leave the markup alone"');
});

test('wireEasyToggle: writes the setting on change, and clears the key when switched off', () => {
  const input = fakeInput();
  const storage = fakeStorage();
  wireEasyToggle({
    inputEl: /** @type {any} */ (input),
    storage,
    isBoardUntouched: () => true,
    redeal: () => {},
    defer: () => {},
  });

  input.flip(true);
  assert.equal(storage.data['gridgame.ttt.easy'], 'true');

  input.flip(false);
  // writeBoolSetting removes rather than storing 'false' — default-off by
  // construction, so an absent key and an explicit off are the same state.
  assert.equal('gridgame.ttt.easy' in storage.data, false);
});

test('wireEasyToggle: re-deals an untouched board, after letting the thumb animate', () => {
  const input = fakeInput();
  const deferred = fakeDefer();
  let redeals = 0;
  wireEasyToggle({
    inputEl: /** @type {any} */ (input),
    storage: fakeStorage(),
    isBoardUntouched: () => true,
    redeal: () => { redeals++; },
    defer: deferred.defer,
  });

  input.flip(true);
  assert.equal(redeals, 0, 'the re-deal is deferred, not immediate — the thumb slide must be visible');
  assert.equal(deferred.calls.length, 1);
  assert.equal(deferred.calls[0].ms, 350, 'same beat findFlag gives its toggle');
  deferred.run();
  assert.equal(redeals, 1);
});

test('wireEasyToggle: does NOT re-deal a board with progress on it', () => {
  const input = fakeInput();
  const deferred = fakeDefer();
  let redeals = 0;
  const storage = fakeStorage();
  wireEasyToggle({
    inputEl: /** @type {any} */ (input),
    storage,
    isBoardUntouched: () => false,
    redeal: () => { redeals++; },
    defer: deferred.defer,
  });

  input.flip(true);
  // The setting still lands — it applies to the next board.
  assert.equal(storage.data['gridgame.ttt.easy'], 'true');
  // But nothing is scheduled, so the player's moves survive.
  assert.equal(deferred.calls.length, 0, 'a reload here would silently destroy the in-progress game');
  assert.equal(redeals, 0);
});

test('wireEasyToggle: no-ops without throwing when the input is absent', () => {
  // The online board mounts no toggle by design (the server deals its puzzle),
  // so a shared boot path finding nothing must be harmless rather than fatal.
  assert.doesNotThrow(() => wireEasyToggle({
    inputEl: null,
    isBoardUntouched: () => true,
    redeal: () => { throw new Error('must not re-deal'); },
  }));
});

test('the .scope-toggle styles live in common.css, where both consumers can reach them', () => {
  // TTT is now the second consumer of the switch findFlag introduced. The rules
  // must stay shared: TTT's pages link common.css + ticTacToe/index.css and
  // never findFlag/index.css, so a well-meaning "move these rules next to the
  // page that uses them" refactor would leave the TTT toggle rendering as a
  // bare checkbox — visibly broken, but only on a page nobody was editing.
  const commonCss = readFileSync(join(here, '..', 'common.css'), 'utf8');
  for (const rule of [
    '.scope-toggle',
    '.scope-toggle-switch',
    '.scope-toggle-track',
    '.scope-toggle-thumb',
  ]) {
    assert.ok(commonCss.includes(rule), `${rule} is not in common.css — the TTT burger toggle needs it`);
  }
});

test('the toggle is mounted on all three boards', () => {
  // This assertion used to be the opposite: it pinned the toggle OFF the online
  // board, because a localStorage switch cannot reach a server-dealt puzzle, so
  // rendering it there would have been a lie. That premise is gone — the mode is
  // now a room setting the server owns (`?easy=1` at create, `set-easy` to
  // change, `applySetEasy` to authorize), so the control there is honoured.
  // The rule it protected survives as the two tests below: the switch must never
  // *claim* something it cannot deliver.
  const offline = readFileSync(join(here, 'offline', 'index.html'), 'utf8');
  const solo = readFileSync(join(here, 'solo', 'index.html'), 'utf8');
  const online = readFileSync(join(here, 'index.html'), 'utf8');

  assert.ok(offline.includes('id="easy-toggle-input"'), 'offline board is missing the toggle');
  assert.ok(solo.includes('id="easy-toggle-input"'), 'solo board is missing the toggle');
  assert.ok(online.includes('id="easy-toggle-input"'), 'online board is missing the toggle');
});

// ---- decideEasyToggleState (the online board's switch) ----

test('decideEasyToggleState: in the lobby it is your own preference, and it is live', () => {
  for (const prefEasy of [true, false]) {
    assert.deepEqual(
      decideEasyToggleState({ inRoom: false, isHost: false, boardUntouched: true, roomEasy: null, prefEasy }),
      { checked: prefEasy, disabled: false },
      'the lobby switch seeds the next room you create, so it is always yours to set',
    );
  }
});

test('decideEasyToggleState: in a room it reports the ROOM, not your preference', () => {
  // The disclosure rule. A joiner who prefers metrics, in a no-statistics room,
  // must see "on" — the switch describes the board in front of them.
  const s = decideEasyToggleState({
    inRoom: true, isHost: false, boardUntouched: true, roomEasy: true, prefEasy: false,
  });
  assert.equal(s.checked, true, 'the room mode wins over the local preference');
  assert.equal(s.disabled, true, 'and the joiner cannot change it');
});

test('decideEasyToggleState: the host may flip it while the board is untouched', () => {
  const s = decideEasyToggleState({
    inRoom: true, isHost: true, boardUntouched: true, roomEasy: false, prefEasy: false,
  });
  assert.equal(s.disabled, false);
});

test('decideEasyToggleState: it locks for the host once a move lands', () => {
  // Re-dealing here would throw away the opponent's moves to apply a
  // preference, which is the one thing a settings switch must never do.
  const s = decideEasyToggleState({
    inRoom: true, isHost: true, boardUntouched: false, roomEasy: true, prefEasy: true,
  });
  assert.equal(s.disabled, true);
});

test('decideEasyToggleState: the joiner never gets it, untouched board or not', () => {
  for (const boardUntouched of [true, false]) {
    assert.equal(
      decideEasyToggleState({ inRoom: true, isHost: false, boardUntouched, roomEasy: false, prefEasy: true }).disabled,
      true,
    );
  }
});

test('decideEasyToggleState: falls back to the preference before welcome lands', () => {
  // Between "connecting" and the server's welcome we do not yet know the room's
  // mode. Showing the local preference beats flickering through "off".
  const s = decideEasyToggleState({
    inRoom: true, isHost: true, boardUntouched: true, roomEasy: null, prefEasy: true,
  });
  assert.equal(s.checked, true);
});
