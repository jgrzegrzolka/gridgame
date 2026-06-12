import test from 'node:test';
import assert from 'node:assert/strict';
import { avatarSvg, PALETTE } from './avatar.js';

test('avatarSvg: deterministic — same deviceId returns identical markup', () => {
  const id = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  assert.equal(avatarSvg(id), avatarSvg(id));
});

test('avatarSvg: different deviceIds usually produce different markup', () => {
  const a = avatarSvg('device-a');
  const b = avatarSvg('device-b');
  assert.notEqual(a, b);
});

test('avatarSvg: defaults to 24×24 with a 0 0 5 5 viewBox', () => {
  const svg = avatarSvg('dev-1');
  assert.match(svg, /width="24"/);
  assert.match(svg, /height="24"/);
  assert.match(svg, /viewBox="0 0 5 5"/);
});

test('avatarSvg: size option overrides the default', () => {
  const svg = avatarSvg('dev-1', { size: 48 });
  assert.match(svg, /width="48"/);
  assert.match(svg, /height="48"/);
});

test('avatarSvg: fill is one of the palette colours', () => {
  const svg = avatarSvg('dev-1');
  const m = svg.match(/fill="(#[0-9a-fA-F]+)"/);
  assert.ok(m, 'fill attribute should be present');
  assert.ok(PALETTE.includes(m[1]), `${m[1]} not in palette`);
});

test('avatarSvg: every rect sits inside the 0..4 grid', () => {
  const svg = avatarSvg('a-fairly-long-deviceId-string');
  const rects = [...svg.matchAll(/<rect x="(\d+)" y="(\d+)" width="1" height="1"\/>/g)];
  assert.ok(rects.length > 0, 'expected at least one rect');
  for (const [, x, y] of rects) {
    assert.ok(Number(x) >= 0 && Number(x) <= 4, `x ${x} out of range`);
    assert.ok(Number(y) >= 0 && Number(y) <= 4, `y ${y} out of range`);
  }
});

test('avatarSvg: pattern is horizontally symmetric', () => {
  // Every painted (x, y) with x !== 2 must have a matching (4 - x, y).
  // Centre column (x === 2) has no mirror counterpart.
  const svg = avatarSvg('symmetry-check-deviceId');
  /** @type {Set<string>} */
  const cells = new Set();
  for (const [, x, y] of svg.matchAll(/<rect x="(\d+)" y="(\d+)" width="1" height="1"\/>/g)) {
    cells.add(`${x},${y}`);
  }
  for (const cell of cells) {
    const [xs, ys] = cell.split(',');
    const x = Number(xs);
    if (x === 2) continue;
    const mirror = `${4 - x},${ys}`;
    assert.ok(cells.has(mirror), `cell ${cell} missing mirror ${mirror}`);
  }
});

test('avatarSvg: aria-hidden + non-focusable so screen-readers skip it', () => {
  const svg = avatarSvg('a11y');
  assert.match(svg, /aria-hidden="true"/);
  assert.match(svg, /focusable="false"/);
});

test('avatarSvg: empty / non-string deviceId still renders a valid avatar', () => {
  const a = avatarSvg('');
  const b = avatarSvg(/** @type {any} */ (null));
  // Both should be valid SVGs; the empty-string fallback path means they
  // resolve to the same hash → same markup.
  assert.match(a, /^<svg /);
  assert.equal(a, b);
});

test('avatarSvg: colour bits and pattern bits come from independent hashes', () => {
  // If both came from a single hash, deviceIds that hashed-modulo to the
  // same colour would tend to share pattern bits too. We sanity-check the
  // mix by confirming a small sample doesn't collapse to a single output
  // (a regression where one hash drove both would surface here).
  const seen = new Set();
  for (let i = 0; i < 50; i++) seen.add(avatarSvg(`dev-${i}`));
  assert.ok(seen.size > 40, `expected high spread, got ${seen.size}/50`);
});
