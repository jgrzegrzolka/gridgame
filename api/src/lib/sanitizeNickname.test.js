const test = require('node:test');
const assert = require('node:assert/strict');

const { sanitizeNickname } = require('./sanitizeNickname');

// Code-point helpers so the test sources stay portable across editors,
// git's autocrlf, etc. Literal control/bidi chars in source files have
// a bad track record of getting silently stripped by tooling.
const c = (cp) => String.fromCodePoint(cp);

test('sanitizeNickname: plain ASCII letters pass through', () => {
  assert.deepEqual(sanitizeNickname('Alice'), { ok: true, value: 'Alice' });
});

test('sanitizeNickname: unicode letters (accents, Polish, CJK) pass through', () => {
  assert.deepEqual(sanitizeNickname('Łukasz'), { ok: true, value: 'Łukasz' });
  assert.deepEqual(sanitizeNickname('José'), { ok: true, value: 'José' });
  assert.deepEqual(sanitizeNickname('日本'), { ok: true, value: '日本' });
});

test('sanitizeNickname: trims leading and trailing whitespace', () => {
  assert.deepEqual(sanitizeNickname('  Alice  '), { ok: true, value: 'Alice' });
});

test('sanitizeNickname: collapses internal whitespace runs to single spaces', () => {
  assert.deepEqual(sanitizeNickname('Alice   Braver'), { ok: true, value: 'Alice Braver' });
  assert.deepEqual(sanitizeNickname('Alice\tBraver'), { ok: true, value: 'Alice Braver' });
  assert.deepEqual(sanitizeNickname('Alice\nBraver'), { ok: true, value: 'Alice Braver' });
});

test('sanitizeNickname: rejects C0 control characters (U+0000-001F)', () => {
  assert.equal(sanitizeNickname(`Alice${c(0x00)}Bob`).ok, false, 'NUL');
  assert.equal(sanitizeNickname(`Alice${c(0x07)}Bob`).ok, false, 'BEL');
  assert.equal(sanitizeNickname(`Alice${c(0x1B)}Bob`).ok, false, 'ESC');
});

test('sanitizeNickname: rejects DEL + C1 controls (U+007F-009F)', () => {
  assert.equal(sanitizeNickname(`Alice${c(0x7F)}Bob`).ok, false, 'DEL');
  assert.equal(sanitizeNickname(`Alice${c(0x80)}Bob`).ok, false, 'C1');
  assert.equal(sanitizeNickname(`Alice${c(0x9F)}Bob`).ok, false, 'C1 end');
});

test('sanitizeNickname: rejects bidi overrides (U+202A-202E) — spoofing vector', () => {
  // U+202E RLO would render "OlleH" as "Hello". Same visual, different string.
  assert.equal(sanitizeNickname(`${c(0x202E)}OlleH`).ok, false);
  assert.equal(sanitizeNickname(`${c(0x202A)}LRE`).ok, false);
  assert.equal(sanitizeNickname(`${c(0x202D)}LRO`).ok, false);
});

test('sanitizeNickname: rejects bidi isolates (U+2066-2069)', () => {
  assert.equal(sanitizeNickname(`${c(0x2066)}LRI`).ok, false);
  assert.equal(sanitizeNickname(`${c(0x2069)}PDI`).ok, false);
});

test('sanitizeNickname: rejects zero-width characters (U+200B-200F)', () => {
  assert.equal(sanitizeNickname(`Alice${c(0x200B)}Bob`).ok, false, 'ZWSP');
  assert.equal(sanitizeNickname(`Alice${c(0x200C)}Bob`).ok, false, 'ZWNJ');
  assert.equal(sanitizeNickname(`Alice${c(0x200D)}Bob`).ok, false, 'ZWJ');
});

test('sanitizeNickname: rejects BOM (U+FEFF) and word joiner (U+2060)', () => {
  assert.equal(sanitizeNickname(`${c(0xFEFF)}Alice`).ok, false);
  assert.equal(sanitizeNickname(`Alice${c(0x2060)}Bob`).ok, false);
});

test('sanitizeNickname: rejects line + paragraph separators (U+2028-2029)', () => {
  assert.equal(sanitizeNickname(`Alice${c(0x2028)}Bob`).ok, false);
  assert.equal(sanitizeNickname(`Alice${c(0x2029)}Bob`).ok, false);
});

test('sanitizeNickname: rejects combining grapheme joiner (U+034F)', () => {
  // Could create two visually identical, string-distinct nicknames.
  assert.equal(sanitizeNickname(`Alic${c(0x034F)}e`).ok, false);
});

test('sanitizeNickname: emoji pass through (visually busy but not abusive)', () => {
  assert.deepEqual(sanitizeNickname('Alice 🎉'), { ok: true, value: 'Alice 🎉' });
});

test('sanitizeNickname: whitespace-only collapses to empty (caller catches length)', () => {
  assert.deepEqual(sanitizeNickname('   \t  '), { ok: true, value: '' });
});

test('sanitizeNickname: long input passes — length cap is the caller\'s job', () => {
  const longButValid = 'a'.repeat(40);
  assert.deepEqual(sanitizeNickname(longButValid), { ok: true, value: longButValid });
});
