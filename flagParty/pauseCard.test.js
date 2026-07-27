import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pauseCardStep } from './pauseCard.js';

/** A running game with nobody missing and no card anywhere. */
function view(over = {}) {
  return { inRoom: true, pausedFor: null, isOpen: false, timerPending: false, ...over };
}

// ---- the regression this module exists for ----

test('leaving the room takes the card with you, even while the room still says paused', () => {
  // The shipped bug: the card was closed only when the ROOM said the pause had
  // ended. Press Back during a pause and the client leaves, but its last known
  // `pausedFor` stays set forever — nobody is going to send it a resume for a
  // game it walked out of. The modal stayed up over the start screen, Esc was
  // suppressed by design, and a guest had no button on it at all.
  assert.equal(pauseCardStep(view({ inRoom: false, pausedFor: 'bob', isOpen: true })), 'close');
});

test('leaving also drops a wait that had not surfaced yet', () => {
  // The same exit a second earlier, before the delay elapsed. Nothing is on
  // screen to close, but the pending timer would otherwise fire onto the start
  // screen and open a card about a game that is no longer this client's.
  assert.equal(pauseCardStep(view({ inRoom: false, pausedFor: 'bob', timerPending: true })), 'close');
});

test('leaving with nothing showing is not busywork', () => {
  assert.equal(pauseCardStep(view({ inRoom: false, pausedFor: 'bob' })), 'none');
  assert.equal(pauseCardStep(view({ inRoom: false, pausedFor: null })), 'none');
});

// ---- the ordinary pause lifecycle ----

test('a pause starts a wait rather than opening straight away', () => {
  // The freeze is instant; only the card waits, so a backgrounded phone or a
  // tab reload resolves without ever flashing a modal.
  assert.equal(pauseCardStep(view({ pausedFor: 'bob' })), 'schedule');
});

test('a wait already running is left alone', () => {
  // Roster and paused messages both land here; restarting the delay on each one
  // would keep pushing the card further away.
  assert.equal(pauseCardStep(view({ pausedFor: 'bob', timerPending: true })), 'none');
});

test('the delay firing is what opens it', () => {
  assert.equal(pauseCardStep(view({ pausedFor: 'bob', delayElapsed: true })), 'open');
});

test('a pause that ends inside the delay never shows a card at all', () => {
  assert.equal(pauseCardStep(view({ pausedFor: null, timerPending: true })), 'close');
});

test('the player coming back closes it', () => {
  assert.equal(pauseCardStep(view({ pausedFor: null, isOpen: true })), 'close');
});

test('a pause moving to a second absentee repaints instead of reopening', () => {
  // The card names who the room is waiting for, and `applyResume` can hand the
  // pause from one absentee to another without the room ever running. Closing
  // and reopening would flash the same modal at everyone for no reason.
  assert.equal(pauseCardStep(view({ pausedFor: 'carol', isOpen: true })), 'repaint');
});

test('an open card is never asked to open twice', () => {
  // The delay can fire against a card some other path already opened.
  assert.equal(pauseCardStep(view({ pausedFor: 'bob', isOpen: true, delayElapsed: true })), 'repaint');
});

test('nothing paused and nothing showing does nothing', () => {
  assert.equal(pauseCardStep(view()), 'none');
});
