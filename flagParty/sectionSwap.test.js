import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createSectionSwapper,
  SWAP_OUT_MS,
  SWAP_IN_MS,
  LEAVING_CLASS,
  ENTERING_CLASS,
} from './sectionSwap.js';

/**
 * A fake clock + DOM recorder, so the swap's sequencing is testable without a
 * browser. `log` is the ordered script of everything the swapper asked the page
 * to do — asserting on it is how "the outgoing screen leaves BEFORE the incoming
 * one arrives" becomes a test rather than an eyeball judgement.
 *
 * @param {{ reduced?: boolean, onShown?: (which: string | null) => void }} [opts]
 */
function harness(opts = {}) {
  /** @type {string[]} */
  const log = [];
  /** @type {Array<{ id: number, fn: () => void, at: number } | null>} */
  const timers = [];
  let now = 0;
  let nextId = 0;
  let reduced = opts.reduced === true;

  const io = {
    show: (/** @type {string | null} */ which) => { log.push(`show:${which}`); },
    mark: (/** @type {string} */ name, /** @type {string} */ cls, /** @type {boolean} */ on) => {
      log.push(`${on ? '+' : '-'}${cls}:${name}`);
    },
    schedule: (/** @type {() => void} */ fn, /** @type {number} */ ms) => {
      const id = nextId++;
      timers[id] = { id, fn, at: now + ms };
      return id;
    },
    cancel: (/** @type {number} */ id) => { log.push(`cancel:${id}`); timers[id] = null; },
    reduced: () => reduced,
    onShown: opts.onShown,
  };

  return {
    swapper: createSectionSwapper(io),
    log,
    /** Advance the fake clock, firing anything due. @param {number} ms */
    tick(ms) {
      now += ms;
      for (const t of timers.slice()) {
        if (t && t.at <= now) { timers[t.id] = null; t.fn(); }
      }
    },
    /** @param {boolean} v */
    setReduced(v) { reduced = v; },
    /** Everything the swapper did since the last drain. */
    drain() { const out = log.slice(); log.length = 0; return out; },
  };
}

test('the first screen lands immediately — there is nothing to leave', () => {
  const h = harness();
  assert.equal(h.swapper.to('start'), true);
  // No out phase: `show` is the very first thing that happens.
  assert.deepEqual(h.drain(), ['show:start', `+${ENTERING_CLASS}:start`]);
  assert.equal(h.swapper.shown, 'start');
  h.tick(SWAP_IN_MS);
  assert.deepEqual(h.drain(), [`-${ENTERING_CLASS}:start`]);
  assert.equal(h.swapper.busy, false);
});

test('a real change plays out, THEN in — the old screen never leaves after the new one arrives', () => {
  const h = harness();
  h.swapper.to('question');
  h.tick(SWAP_IN_MS);
  h.drain();

  h.swapper.to('break');
  // Out phase: the old screen is marked and is still the one on screen.
  assert.deepEqual(h.drain(), [`+${LEAVING_CLASS}:question`]);
  assert.equal(h.swapper.shown, 'question', 'the outgoing screen is still up while it falls away');
  assert.equal(h.swapper.target, 'break');

  h.tick(SWAP_OUT_MS);
  assert.deepEqual(h.drain(), [
    `-${LEAVING_CLASS}:question`,
    'show:break',
    `+${ENTERING_CLASS}:break`,
  ]);
  assert.equal(h.swapper.shown, 'break');

  h.tick(SWAP_IN_MS);
  assert.deepEqual(h.drain(), [`-${ENTERING_CLASS}:break`]);
  assert.equal(h.swapper.busy, false);
});

// This is the case that governs the whole design. `render()` runs on every state
// change AND every clock tick, so it asks for the screen it is already on far
// more often than for a new one. If that re-ran the animation, every screen would
// flicker continuously for as long as it was up.
test('asking for the screen we are already on does nothing at all', () => {
  const h = harness();
  h.swapper.to('question');
  h.tick(SWAP_IN_MS);
  h.drain();

  for (let i = 0; i < 20; i++) assert.equal(h.swapper.to('question'), false, `tick ${i}`);
  assert.deepEqual(h.drain(), [], 'twenty re-renders, zero DOM work');
});

test('asking again for the screen we are already heading to does not restart the swap', () => {
  const h = harness();
  h.swapper.to('question');
  h.tick(SWAP_IN_MS);
  h.drain();

  h.swapper.to('break');
  h.drain();
  // Mid-out-phase re-render: `shown` is still `question`, so a naive "is this
  // different from what's visible?" check would restart the swap every tick and
  // the screen would never actually change.
  assert.equal(h.swapper.to('break'), false);
  assert.deepEqual(h.drain(), []);
  h.tick(SWAP_OUT_MS);
  assert.equal(h.swapper.shown, 'break', 'the original swap completed undisturbed');
});

test('a swap interrupted mid-out redirects, and leaves no screen wearing an animation class', () => {
  // The show's beats are shorter than they look — a clean reveal is 0.9 s — so a
  // new screen arriving mid-swap is normal. The abandoned screen must not be left
  // marked, or it sits there faded out.
  const h = harness();
  h.swapper.to('question');
  h.tick(SWAP_IN_MS);
  h.drain();

  h.swapper.to('break');
  h.drain();
  h.swapper.to('pick');
  const script = h.drain();
  assert.ok(script.some((s) => s.startsWith('cancel:')), 'the in-flight timer was cancelled');
  assert.ok(script.includes(`-${LEAVING_CLASS}:question`), 'and the abandoned screen was unmarked');
  assert.ok(script.includes(`+${LEAVING_CLASS}:question`), 'before starting a fresh out phase');

  h.tick(SWAP_OUT_MS);
  assert.equal(h.swapper.shown, 'pick', 'we land on the latest request, not the abandoned one');
  h.tick(SWAP_IN_MS);
  assert.equal(h.swapper.busy, false);
  // The abandoned target was never shown at all.
  assert.ok(!h.log.includes('show:break'));
});

test('a swap interrupted mid-in unmarks the arriving screen before moving on', () => {
  const h = harness();
  h.swapper.to('question');
  h.tick(SWAP_IN_MS);
  h.drain();
  h.swapper.to('break');
  h.tick(SWAP_OUT_MS);   // break is now shown and entering
  h.drain();

  h.swapper.to('roundcard');
  const script = h.drain();
  assert.ok(script.includes(`-${ENTERING_CLASS}:break`), 'the arriving screen stopped arriving');
  assert.ok(script.includes(`+${LEAVING_CLASS}:break`), 'and started leaving instead');
  h.tick(SWAP_OUT_MS);
  assert.equal(h.swapper.shown, 'roundcard');
});

test('reduced motion: the change is instant, with no classes and no delay', () => {
  const h = harness({ reduced: true });
  h.swapper.to('question');
  assert.deepEqual(h.drain(), ['show:question'], 'no entering class on the first screen');

  h.swapper.to('break');
  // The whole point: no out phase to sit through. A player who asked for less
  // motion should not also be made to wait 120 ms per screen change.
  assert.deepEqual(h.drain(), ['show:break']);
  assert.equal(h.swapper.shown, 'break', 'the new screen is up immediately');
  assert.equal(h.swapper.busy, false, 'and nothing is pending');
});

test('reduced motion honoured per swap, not captured once', () => {
  // The media query can flip while the tab is open (OS setting changed
  // mid-game), and the page passes a live predicate rather than a snapshot.
  const h = harness();
  h.swapper.to('question');
  h.tick(SWAP_IN_MS);
  h.drain();
  h.setReduced(true);
  h.swapper.to('break');
  assert.deepEqual(h.drain(), ['show:break'], 'the new preference took effect at once');
});

test('a full round of screen changes ends settled on the right screen', () => {
  // question -> break -> pick -> roundcard -> question, the real shape of a
  // drafted round, played at the swap's own pace.
  const h = harness();
  const order = ['question', 'break', 'pick', 'roundcard', 'question'];
  h.swapper.to(order[0]);
  h.tick(SWAP_IN_MS);
  for (const next of order.slice(1)) {
    h.swapper.to(next);
    h.tick(SWAP_OUT_MS);
    assert.equal(h.swapper.shown, next);
    h.tick(SWAP_IN_MS);
    assert.equal(h.swapper.busy, false);
  }
  assert.equal(h.swapper.shown, 'question');
  assert.equal(h.swapper.target, 'question');
});

test('hiding everything is a legal destination and never marks a null screen', () => {
  const h = harness();
  h.swapper.to('question');
  h.tick(SWAP_IN_MS);
  h.drain();
  h.swapper.to(null);
  h.tick(SWAP_OUT_MS);
  const script = h.drain();
  assert.ok(script.includes('show:null'));
  assert.ok(!script.some((s) => s.includes(':null') && s !== 'show:null'), 'no class toggled on null');
  assert.equal(h.swapper.shown, null);
});

// ---- onShown: the seam a self-choreographing screen starts from ----

test('onShown fires when the section is displayed, not when it was requested', () => {
  // The finish board is BUILT during the out phase and must not start its reveal
  // until anyone can see it. Firing on the request instead would put the sequence
  // a whole out phase ahead of the screen — the bug this hook exists to close.
  /** @type {Array<string | null>} */
  const shown = [];
  const h = harness({ onShown: (which) => shown.push(which) });
  h.swapper.to('question');
  assert.deepEqual(shown, ['question'], 'the first screen has no out phase to wait for');

  h.swapper.to('final');
  assert.deepEqual(shown, ['question'], 'still nothing: the old screen is falling away');
  h.tick(SWAP_OUT_MS);
  assert.deepEqual(shown, ['question', 'final'], 'fires as the incoming screen lands');
});

test('onShown fires immediately under reduced motion, which skips the out phase', () => {
  /** @type {Array<string | null>} */
  const shown = [];
  const h = harness({ reduced: true, onShown: (which) => shown.push(which) });
  h.swapper.to('question');
  h.swapper.to('final');
  assert.deepEqual(shown, ['question', 'final']);
});

test('a repeated request for the screen already shown does not re-fire onShown', () => {
  // render() asks for the screen it is already on far more often than for a new
  // one; re-firing would restart the finish reveal on every clock tick.
  /** @type {Array<string | null>} */
  const shown = [];
  const h = harness({ onShown: (which) => shown.push(which) });
  h.swapper.to('final');
  h.swapper.to('final');
  h.swapper.to('final');
  assert.deepEqual(shown, ['final']);
});

test('a swapper with no onShown still swaps normally', () => {
  const h = harness();
  h.swapper.to('question');
  h.swapper.to('final');
  h.tick(SWAP_OUT_MS);
  assert.equal(h.swapper.shown, 'final');
});
