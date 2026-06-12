const test = require('node:test');
const assert = require('node:assert/strict');

const { isOffensiveNickname } = require('./blockedNicknames');

test('isOffensiveNickname: clean ASCII names pass', () => {
  assert.equal(isOffensiveNickname('Alice'), false);
  assert.equal(isOffensiveNickname('Brave Otter'), false);
  assert.equal(isOffensiveNickname('Sleepy Lynx'), false);
});

test('isOffensiveNickname: clean Polish names pass', () => {
  assert.equal(isOffensiveNickname('Łukasz'), false);
  assert.equal(isOffensiveNickname('Małgorzata'), false);
});

test('isOffensiveNickname: catches plain English slurs', () => {
  assert.equal(isOffensiveNickname('fuck'), true);
  assert.equal(isOffensiveNickname('shit'), true);
  assert.equal(isOffensiveNickname('bitch'), true);
});

test('isOffensiveNickname: catches plain Polish slurs (accent-folded)', () => {
  assert.equal(isOffensiveNickname('kurwa'), true);
  assert.equal(isOffensiveNickname('chuj'), true);
  assert.equal(isOffensiveNickname('pierdol'), true);
});

test('isOffensiveNickname: case-insensitive', () => {
  assert.equal(isOffensiveNickname('FUCK'), true);
  assert.equal(isOffensiveNickname('FuCk'), true);
  assert.equal(isOffensiveNickname('Kurwa'), true);
});

test('isOffensiveNickname: substring matches inside compound names', () => {
  // The whole point — catch "fuckface" by hitting "fuck".
  assert.equal(isOffensiveNickname('Fuckface'), true);
  assert.equal(isOffensiveNickname('shitlord'), true);
  assert.equal(isOffensiveNickname('Kurwa Mac'), true);
});

test('isOffensiveNickname: punctuation-as-separator evasion folds through', () => {
  // Letters separated by ASCII punctuation get caught: strip
  // non-alphanumeric then match.
  assert.equal(isOffensiveNickname('f.u.c.k'), true);
  assert.equal(isOffensiveNickname('s-h-i-t'), true);
  assert.equal(isOffensiveNickname('f u c k'), true);
});

test('isOffensiveNickname: character-substitution evasion slips through (documented)', () => {
  // We do NOT map "!" → "i", "0" → "o", "3" → "e", etc. That's
  // leetspeak-arms-race territory; the substring filter stops casual
  // asshats, not determined ones.
  assert.equal(isOffensiveNickname('sh!t'), false);   // "sht" after strip
  assert.equal(isOffensiveNickname('f0ck'), false);   // "fck" after strip-but-keep-digits
});

test('isOffensiveNickname: accent-fold catches Polish variants without diacritics', () => {
  // We store the deaccented form, so input with diacritics still hits
  // after NFKD + combining-marks strip.
  assert.equal(isOffensiveNickname('kurwa'), true);
});

test('isOffensiveNickname: blocks impersonation of admin/mod roles', () => {
  assert.equal(isOffensiveNickname('Admin'), true);
  assert.equal(isOffensiveNickname('Moderator'), true);
  assert.equal(isOffensiveNickname('Mod'), true);
  // Substring catch: also blocks "Admin Bob" — accepted trade-off.
  assert.equal(isOffensiveNickname('Admin Bob'), true);
});

test('isOffensiveNickname: determined leetspeak evaders still slip through (documented)', () => {
  // This documents the limit so a future "why didn't this catch it?"
  // bug report has the answer pre-written. Not a bug, a trade-off.
  assert.equal(isOffensiveNickname('5h1t'), false);
  assert.equal(isOffensiveNickname('phuck'), false);
});

test('isOffensiveNickname: empty / whitespace input returns false', () => {
  assert.equal(isOffensiveNickname(''), false);
  assert.equal(isOffensiveNickname('   '), false);
});

test('isOffensiveNickname: scunthorpe-style false positives accepted (documented)', () => {
  // The classic moderation-rule trade-off: a pure substring match will
  // sometimes hit innocent English words/names. Documenting the known
  // cases so a future "why was my name rejected?" thread has the answer
  // pre-written. If someone genuinely named "Cockburn" hits this they
  // can submit a variation; for a hobby site we accept the false-positive
  // rate rather than write a real tokenising filter.
  assert.equal(isOffensiveNickname('Cockburn'), true);
  assert.equal(isOffensiveNickname('Scunthorpe'), true); // s-c-u-n-t-h-... contains 'cunt'
});
