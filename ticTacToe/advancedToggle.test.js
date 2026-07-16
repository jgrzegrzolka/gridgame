import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { wireAdvancedToggle, decideAdvancedToggleState } from './advancedToggle.js';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Minimal stand-in for the checkbox: the three things wireAdvancedToggle touches
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

test('wireAdvancedToggle: reflects the stored setting at boot', () => {
  const on = fakeInput();
  wireAdvancedToggle({
    inputEls: [/** @type {any} */ (on)],
    storage: fakeStorage({ 'gridgame.ttt.advanced': 'true' }),
    isBoardUntouched: () => true,
    redeal: () => {},
    defer: () => {},
  });
  assert.equal(on.checked, true);

  const off = fakeInput({ checked: true });
  wireAdvancedToggle({
    inputEls: [/** @type {any} */ (off)],
    storage: fakeStorage(),
    isBoardUntouched: () => true,
    redeal: () => {},
    defer: () => {},
  });
  assert.equal(off.checked, false, 'an unset key is off, not "leave the markup alone"');
});

test('wireAdvancedToggle: writes the setting on change, and clears the key when switched off', () => {
  const input = fakeInput();
  const storage = fakeStorage();
  wireAdvancedToggle({
    inputEls: [/** @type {any} */ (input)],
    storage,
    isBoardUntouched: () => true,
    redeal: () => {},
    defer: () => {},
  });

  input.flip(true);
  assert.equal(storage.data['gridgame.ttt.advanced'], 'true');

  input.flip(false);
  // writeBoolSetting removes rather than storing 'false' — default-off by
  // construction, so an absent key and an explicit off are the same state.
  assert.equal('gridgame.ttt.advanced' in storage.data, false);
});

test('wireAdvancedToggle: re-deals an untouched board, after letting the thumb animate', () => {
  const input = fakeInput();
  const deferred = fakeDefer();
  let redeals = 0;
  wireAdvancedToggle({
    inputEls: [/** @type {any} */ (input)],
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

test('wireAdvancedToggle: does NOT re-deal a board with progress on it', () => {
  const input = fakeInput();
  const deferred = fakeDefer();
  let redeals = 0;
  const storage = fakeStorage();
  wireAdvancedToggle({
    inputEls: [/** @type {any} */ (input)],
    storage,
    isBoardUntouched: () => false,
    redeal: () => { redeals++; },
    defer: deferred.defer,
  });

  input.flip(true);
  // The setting still lands — it applies to the next board.
  assert.equal(storage.data['gridgame.ttt.advanced'], 'true');
  // But nothing is scheduled, so the player's moves survive.
  assert.equal(deferred.calls.length, 0, 'a reload here would silently destroy the in-progress game');
  assert.equal(redeals, 0);
});

test('wireAdvancedToggle: no-ops without throwing when no switch is on the page', () => {
  // A shared boot path finding nothing must be harmless rather than fatal, and
  // a board that mounts only one of the two switches must still wire that one.
  assert.doesNotThrow(() => wireAdvancedToggle({
    inputEls: [null, null],
    isBoardUntouched: () => true,
    redeal: () => { throw new Error('must not re-deal'); },
  }));
  assert.doesNotThrow(() => wireAdvancedToggle({
    inputEls: [],
    isBoardUntouched: () => true,
    redeal: () => { throw new Error('must not re-deal'); },
  }));
});

test('wireAdvancedToggle: both switches show the stored setting, and a flip on either syncs the other', () => {
  // Two controls, one setting: the burger's and the "How to play" dialog's. The
  // other copy is almost always off-screen when you click one, which is exactly
  // why it silently goes stale and is then believed the moment it opens.
  const burger = fakeInput();
  const rules = fakeInput();
  const storage = fakeStorage({ 'gridgame.ttt.advanced': 'true' });
  wireAdvancedToggle({
    inputEls: [/** @type {any} */ (burger), /** @type {any} */ (rules)],
    storage,
    isBoardUntouched: () => false,
    redeal: () => {},
    defer: () => {},
  });
  assert.equal(burger.checked, true);
  assert.equal(rules.checked, true, 'both copies start from the same stored value');

  rules.flip(false);
  assert.equal(storage.data['gridgame.ttt.advanced'], undefined, 'the dialog switch writes the setting');
  assert.equal(burger.checked, false, "the burger's copy must not keep claiming the old value");

  burger.flip(true);
  assert.equal(storage.data['gridgame.ttt.advanced'], 'true');
  assert.equal(rules.checked, true, 'and the sync works in the other direction too');
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

test('every board mounts both switches, and explains the mode where it mounts them', () => {
  // This assertion has flipped twice, which is worth knowing before flipping it
  // again. #928 pinned the toggle OFF the online board (a localStorage switch
  // cannot reach a server-dealt puzzle, so the control would have been a lie).
  // #931 made the mode a room setting the server owns, so it became honest and
  // the assertion inverted. The rule underneath never moved: the switch must
  // never claim something it cannot deliver.
  for (const board of ['index.html', join('offline', 'index.html'), join('solo', 'index.html')]) {
    const html = readFileSync(join(here, board), 'utf8');
    assert.ok(html.includes('id="advanced-toggle-input"'), `${board}: no burger switch`);
    assert.ok(html.includes('id="rules-advanced-toggle-input"'), `${board}: no switch in How to play`);
    // The switch is two words; the dialog is where the mode is actually
    // explained, and for solo / offline it is the ONLY place it can be (the
    // room chip is online-only).
    assert.ok(html.includes('ttt.advancedModeNote'), `${board}: mounts the switch but never says what it does`);
    assert.equal(html.includes('ttt.noStatistics'), false, `${board}: still carries the retired label`);
  }
});

test('the room chip is online-only, because it is the only board you did not choose', () => {
  // Offline and solo have no `.room-line` to hang it on, and there you set the
  // mode yourself seconds ago. Online is the one board where the person looking
  // at it did not pick the mode — and a joiner never opens the burger, so
  // without this chip nothing on screen says the board was a choice.
  const online = readFileSync(join(here, 'index.html'), 'utf8');
  assert.ok(online.includes('id="room-mode"'), 'online board is missing the room chip');
  for (const board of [join('offline', 'index.html'), join('solo', 'index.html')]) {
    const html = readFileSync(join(here, board), 'utf8');
    assert.equal(html.includes('id="room-mode"'), false, `${board}: has no room to belong to`);
  }
});

// ---- decideAdvancedToggleState (the online board's switches) ----

test('decideAdvancedToggleState: in the lobby it is your own preference, and it is live', () => {
  for (const prefAdvanced of [true, false]) {
    assert.deepEqual(
      decideAdvancedToggleState({ inRoom: false, isHost: false, boardUntouched: true, roomAdvanced: null, prefAdvanced }),
      { checked: prefAdvanced, disabled: false },
      'the lobby switch seeds the next room you create, so it is always yours to set',
    );
  }
});

test('decideAdvancedToggleState: in a room it reports the ROOM, not your preference', () => {
  // The disclosure rule. A joiner who prefers metrics, in a no-statistics room,
  // must see "on" — the switch describes the board in front of them.
  const s = decideAdvancedToggleState({
    inRoom: true, isHost: false, boardUntouched: true, roomAdvanced: true, prefAdvanced: false,
  });
  assert.equal(s.checked, true, 'the room mode wins over the local preference');
  assert.equal(s.disabled, true, 'and the joiner cannot change it');
});

test('decideAdvancedToggleState: the host may flip it while the board is untouched', () => {
  const s = decideAdvancedToggleState({
    inRoom: true, isHost: true, boardUntouched: true, roomAdvanced: false, prefAdvanced: false,
  });
  assert.equal(s.disabled, false);
});

test('decideAdvancedToggleState: it locks for the host once a move lands', () => {
  // Re-dealing here would throw away the opponent's moves to apply a
  // preference, which is the one thing a settings switch must never do.
  const s = decideAdvancedToggleState({
    inRoom: true, isHost: true, boardUntouched: false, roomAdvanced: true, prefAdvanced: true,
  });
  assert.equal(s.disabled, true);
});

test('decideAdvancedToggleState: the joiner never gets it, untouched board or not', () => {
  for (const boardUntouched of [true, false]) {
    assert.equal(
      decideAdvancedToggleState({ inRoom: true, isHost: false, boardUntouched, roomAdvanced: false, prefAdvanced: true }).disabled,
      true,
    );
  }
});

test('decideAdvancedToggleState: falls back to the preference before welcome lands', () => {
  // Between "connecting" and the server's welcome we do not yet know the room's
  // mode. Showing the local preference beats flickering through "off".
  const s = decideAdvancedToggleState({
    inRoom: true, isHost: true, boardUntouched: true, roomAdvanced: null, prefAdvanced: true,
  });
  assert.equal(s.checked, true);
});
