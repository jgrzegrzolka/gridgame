import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSeatDock, HOST_ONLY_ITEMS } from './seatDock.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const commonJs = readFileSync(join(HERE, '..', 'common.js'), 'utf-8');

/**
 * A stand-in for the page's one dock. The important fidelity is what `mount`
 * does: `setDock` builds every item FRESH from the catalog, so a remount throws
 * away whatever `hidden` a previous seat check had written. A fake that kept the
 * flags across a mount could not fail the test below, which is the only test
 * here that matters.
 *
 * @param {string | null} [initialSpec]
 */
function fakeDock(initialSpec = null) {
  /** Catalog id -> the dom id it renders with (null = no id, like `home`). */
  const ID_BY_ITEM = /** @type {Record<string, string | null>} */ ({
    playAgainParty: 'play-again',
    backToSettings: 'question-to-settings',
    partyPause: 'party-pause',
    home: null,
  });
  const bar = { spec: initialSpec, mounts: 0, hidden: /** @type {Record<string, boolean>} */ ({}) };
  const io = {
    /** @param {string} spec */
    mount(spec) {
      bar.spec = spec;
      bar.mounts += 1;
      bar.hidden = {};
      for (const item of spec.split(/\s+/)) {
        const id = ID_BY_ITEM[item];
        if (id) bar.hidden[id] = false;
      }
    },
    /** @param {string} id @param {boolean} hidden */
    setHidden(id, hidden) {
      // Matches the page: an item this spec does not carry is simply not there.
      if (id in bar.hidden) bar.hidden[id] = hidden;
    },
  };
  return {
    bar,
    io,
    /** @param {string} id */
    carriesLive: (id) => bar.hidden[id] === false,
  };
}

const QUESTION = 'partyPause backToSettings home';
const FINISH = 'playAgainParty home';

test('a guest gets no live Play again when the finish rebuilds the bar', () => {
  // THE bug. The finish's screens are painted by the ceremony's own timers, so
  // the old code's "hide it for guests" ran a beat BEFORE the bar carrying the
  // button existed — a silent no-op on the question screen's bar — and the
  // honour beat then mounted a fresh, visible one. A guest got a live "Play
  // again" that `applyPlayAgain` drops on the floor (non-host, no reply, no
  // feedback). Pressing it did nothing, twice a game, for as long as it shipped.
  const d = fakeDock();
  const seat = createSeatDock(d.io);

  seat.sync(QUESTION, false);
  assert.equal(d.carriesLive('question-to-settings'), false,
    'a guest cannot abort the game back to settings');

  seat.sync(FINISH, false);
  assert.equal(d.bar.mounts, 2, 'sanity: the finish really did rebuild the bar');
  assert.equal(d.carriesLive('play-again'), false,
    'the rebuilt bar must not hand a guest a button the server ignores');
});

test('the host keeps every item the screen offers', () => {
  const d = fakeDock();
  const seat = createSeatDock(d.io);

  seat.sync(QUESTION, true);
  assert.equal(d.carriesLive('question-to-settings'), true);
  assert.equal(d.carriesLive('party-pause'), true, 'the break is everyone\'s, host or not');

  seat.sync(FINISH, true);
  assert.equal(d.carriesLive('play-again'), true);
});

test('the break control stays with the guest on both screens', () => {
  // Only the two host-gated actions are seat-dependent. A hide that caught the
  // break as well would take away the one control the whole room shares.
  const d = fakeDock();
  const seat = createSeatDock(d.io);
  seat.sync(QUESTION, false);
  assert.equal(d.carriesLive('party-pause'), true);
});

test('an unchanged spec does not rebuild the bar under a finger already on it', () => {
  // render() runs on every clock tick, so this is the common case by far. A
  // remount destroys and recreates the button mid-press.
  const d = fakeDock();
  const seat = createSeatDock(d.io);
  seat.sync(QUESTION, false);
  seat.sync(QUESTION, false);
  seat.sync(QUESTION, false);
  assert.equal(d.bar.mounts, 1);
});

test('a host handover mid-screen reveals the item without a remount', () => {
  // The host leaves during the ceremony and the room promotes somebody: their
  // bar must gain a working Play again, and it must not blink as it does — the
  // spec has not changed, only the seat.
  const d = fakeDock();
  const seat = createSeatDock(d.io);
  seat.sync(FINISH, false);
  assert.equal(d.carriesLive('play-again'), false);

  seat.sync(FINISH, true);
  assert.equal(d.carriesLive('play-again'), true);
  assert.equal(d.bar.mounts, 1, 'a seat change is not a screen change');
});

test('a dockless screen leaves the mounted spec alone', () => {
  // `showSection(null)` is a real call while the page decides what to show.
  const d = fakeDock();
  const seat = createSeatDock(d.io);
  seat.sync(QUESTION, false);
  seat.sync(null, false);
  assert.equal(d.bar.mounts, 1);
  assert.equal(seat.mounted, QUESTION);
});

test('the after-mount hook runs on a rebuild, and only on a rebuild', () => {
  // This is where the page re-applies the queued-break tint, which a fresh
  // catalog item would otherwise lose on every screen change.
  const d = fakeDock();
  let hooks = 0;
  const seat = createSeatDock({ ...d.io, afterMount: () => { hooks += 1; } });
  seat.sync(QUESTION, false);
  seat.sync(QUESTION, false);
  assert.equal(hooks, 1);
  seat.sync(FINISH, false);
  assert.equal(hooks, 2);
});

test('the after-mount hook runs AFTER the items exist', () => {
  // Ordering is the whole lesson of this module: a hook that fired first would
  // paint items the mount is about to replace.
  const d = fakeDock();
  /** @type {string[]} */
  const order = [];
  const seat = createSeatDock({
    mount: (/** @type {string} */ spec) => { order.push('mount'); d.io.mount(spec); },
    setHidden: d.io.setHidden,
    afterMount: () => { order.push('hook'); },
  });
  seat.sync(FINISH, false);
  assert.deepEqual(order, ['mount', 'hook']);
});

test('every host-only id is a real dock item id', () => {
  // A typo here fails silently — `setHidden` no-ops on an id the bar does not
  // carry, so the button would just quietly come back for guests.
  const domIds = [...commonJs.matchAll(/domId:\s*'([a-z-]+)'/g)].map((m) => m[1]);
  assert.ok(domIds.includes('play-again'), 'sanity: the catalog scrape found real ids');
  for (const id of HOST_ONLY_ITEMS) {
    assert.ok(domIds.includes(id), `"${id}" is not a dock item id in the catalog`);
  }
});
