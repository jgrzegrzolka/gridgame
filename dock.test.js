import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDockItems } from './common.js';

// buildDockItems is the pure core of the bottom dock: it turns a
// `data-dock` spec into concrete item descriptors (tag / domId / href /
// i18n key / icon). The DOM rendering (mountDock/setDock) is a thin shell
// over it; everything worth pinning lives here.

test('dock: resolves a space-separated spec into ordered descriptors', () => {
  const items = buildDockItems('giveUp archive home', '../');
  assert.equal(items.length, 3);
  assert.deepEqual(items.map((i) => i.i18nKey), ['game.giveUp', 'daily.archive', 'menu.home']);
});

test('dock: accepts an array spec identically to a string spec', () => {
  const fromStr = buildDockItems('playAgain home', '../');
  const fromArr = buildDockItems(['playAgain', 'home'], '../');
  assert.deepEqual(fromArr, fromStr);
});

test('dock: give-up renders as a <button> carrying the stable id existing handlers use', () => {
  const [giveUp] = buildDockItems('giveUp', '../');
  assert.equal(giveUp.tag, 'button');
  assert.equal(giveUp.domId, 'give-up');
  assert.equal(giveUp.icon, 'flag');
  assert.equal(giveUp.href, null, 'buttons carry no href');
});

test('dock: play-again is a <a href="#"> with the stable play-again id', () => {
  const [pa] = buildDockItems('playAgain', '../');
  assert.equal(pa.tag, 'a');
  assert.equal(pa.domId, 'play-again');
  assert.equal(pa.href, '#');
  assert.equal(pa.icon, 'rotate-cw');
});

test('dock: playAgainInline is the same action as playAgain but a distinct id', () => {
  const [inline] = buildDockItems('playAgainInline', '../');
  const [main] = buildDockItems('playAgain', '../');
  assert.equal(inline.domId, 'play-again-inline');
  assert.notEqual(inline.domId, main.domId);
  assert.equal(inline.i18nKey, main.i18nKey);
  assert.equal(inline.icon, main.icon);
});

test('dock: home href comes from the page-relative data-home, at any depth', () => {
  assert.equal(buildDockItems('home', '../')[0].href, '../');
  assert.equal(buildDockItems('home', '../../')[0].href, '../../');
});

test('dock: archive keeps its sibling-relative href and history icon, with no id to collide', () => {
  const [arch] = buildDockItems('archive', '../');
  assert.equal(arch.href, 'archive.html');
  // No domId: archive can appear in both the playing and finished docks.
  assert.equal(arch.domId, null);
  assert.equal(arch.icon, 'history');
});

test('dock: back-to-settings maps to the existing question-to-settings id', () => {
  const [bts] = buildDockItems('backToSettings');
  assert.equal(bts.tag, 'button');
  assert.equal(bts.domId, 'question-to-settings');
  assert.equal(bts.i18nKey, 'party.backToSettings');
  assert.equal(bts.icon, 'settings-2');
});

test('dock: findFlag random keeps its two distinct ids for its two handlers', () => {
  assert.equal(buildDockItems('random')[0].domId, 'game-random');
  assert.equal(buildDockItems('randomResult')[0].domId, 'play-random');
  assert.equal(buildDockItems('random')[0].icon, 'shuffle');
});

test('dock: utility items (makeAnother / sync / back) resolve with their nav hrefs', () => {
  assert.equal(buildDockItems('makeAnother')[0].href, './');
  assert.equal(buildDockItems('sync')[0].href, './sync/');
  const [back] = buildDockItems('back');
  assert.equal(back.href, '../'); // one up; Home on that page is two up
  assert.equal(back.icon, 'arrow-left');
});

test('dock: WS-rematch play-again variants render as <button> with the right label key', () => {
  const btn = buildDockItems('playAgainBtn')[0];
  assert.equal(btn.tag, 'button');
  assert.equal(btn.domId, 'play-again');
  assert.equal(btn.i18nKey, 'game.playAgain');
  // flagParty keeps its own "Zagraj ponownie" wording
  const party = buildDockItems('playAgainParty')[0];
  assert.equal(party.tag, 'button');
  assert.equal(party.domId, 'play-again');
  assert.equal(party.i18nKey, 'party.playAgain');
});

test('dock: an unknown item id is a hard error, not a silent skip', () => {
  assert.throws(() => buildDockItems('giveUp bogus home', '../'), /Unknown dock item "bogus"/);
});

test('dock: a home item without a data-home href is a hard error', () => {
  assert.throws(() => buildDockItems('home'), /needs a data-home href/);
});
