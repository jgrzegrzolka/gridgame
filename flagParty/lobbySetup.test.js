import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setupSummaryParts, canStartGame } from './lobbySetup.js';
import { modeShortLabel } from './page.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(HERE, 'index.html'), 'utf-8');
const css = readFileSync(join(HERE, 'index.css'), 'utf-8');
const en = JSON.parse(readFileSync(join(HERE, '..', 'i18n', 'en.json'), 'utf-8'));
const pl = JSON.parse(readFileSync(join(HERE, '..', 'i18n', 'pl.json'), 'utf-8'));

/** Walk a dotted key into a bundle, so the test asserts against the real files. */
function lookup(bundle, key) {
  return key.split('.').reduce((o, k) => (o == null ? undefined : o[k]), bundle);
}

// ---- the collapsed card's summary line ----

test('summary: mode, size, rounds — in that order', () => {
  const parts = setupSummaryParts({
    mode: modeShortLabel('spot-flag'), length: 'short', picks: null, rounds: 5,
  });
  assert.deepEqual(parts.map((p) => p.key), [
    'party.modeShort.spotFlag', 'party.lengthShort', 'party.lengthRounds',
  ]);
  assert.deepEqual(parts[2].args, { r: 5 });
});

test('summary: even picks names the per-player count, not a length', () => {
  // The two sizing modes are different choices, so the line has to say which one
  // the host made. Printing "Medium" while the control below reads "2" is the
  // failure this pins — `length` is still whatever it was, and must be ignored.
  const parts = setupSummaryParts({
    mode: modeShortLabel('flags-all'), length: 'long', picks: 2, rounds: 6,
  });
  assert.equal(parts[1].key, 'party.everyonePicksN');
  assert.deepEqual(parts[1].args, { n: 2 });
  assert.deepEqual(parts[2].args, { r: 6 });
});

test('summary: only the rounds part is muted', () => {
  // The rounds count is derived from the other two, not a third setting. If it
  // ever reads at the same weight the line becomes three equal-looking choices.
  const parts = setupSummaryParts({
    mode: modeShortLabel('map-outlines'), length: 'medium', picks: null, rounds: 7,
  });
  assert.deepEqual(parts.map((p) => p.muted === true), [false, false, true]);
});

test('summary: every key it can emit ships in both languages', () => {
  // The line is the only setup a host who never opens the card sees, so a missing
  // key is a blank where the game description should be — in Polish only, which
  // is exactly the kind of gap that reaches production.
  const cases = [
    { mode: modeShortLabel('flags-all'), length: 'short', picks: null, rounds: 5 },
    { mode: modeShortLabel('flags-weird'), length: 'medium', picks: null, rounds: 7 },
    { mode: modeShortLabel('spot-flag'), length: 'long', picks: null, rounds: 9 },
    { mode: modeShortLabel('map-outlines'), length: 'short', picks: 3, rounds: 12 },
  ];
  for (const c of cases) {
    for (const part of setupSummaryParts(c)) {
      assert.equal(typeof lookup(en, part.key), 'string', `en is missing ${part.key}`);
      assert.equal(typeof lookup(pl, part.key), 'string', `pl is missing ${part.key}`);
    }
  }
});

// ---- the start gate ----

test('start: a room of one cannot play', () => {
  // The rule the pale button draws. Flag Party scores by comparison — speed,
  // only-one-right, closeness — so a solo game pays out against nobody.
  assert.equal(canStartGame({ seatCount: 1 }), false);
  assert.equal(canStartGame({ seatCount: 0 }), false);
});

test('start: one bot is enough — a bot is a seat that races', () => {
  assert.equal(canStartGame({ seatCount: 2 }), true);
  assert.equal(canStartGame({ seatCount: 9 }), true);
});

// ---- the collapsing card's markup / CSS contract ----

test('card: the header owns aria-expanded and names the panel it opens', () => {
  const m = html.match(/<button[^>]*class="setup-head"[\s\S]*?>/);
  assert.ok(m, 'index.html must carry the setup card header');
  assert.match(m[0], /aria-expanded="false"/, 'starts collapsed, and says so');
  assert.match(m[0], /aria-controls="setup-body"/);
  assert.match(html, /id="setup-body"/);
});

test('card: the collapsed panel is inert in the markup, not merely clipped', () => {
  // A `grid-template-rows: 0fr` panel is invisible but its buttons are still in
  // the tab order — a keyboard user would tab into a card they cannot see and
  // change the game length blind. `inert` is what actually removes them; page.js
  // clears it on open.
  assert.match(html, /<div class="setup-body" id="setup-body" inert>/);
});

test('card: the open state is a class on the card, and it is what rotates the chevron', () => {
  assert.match(css, /\.lobby-setup\.is-open \.setup-body\s*\{[^}]*grid-template-rows:\s*1fr/);
  assert.match(css, /\.lobby-setup\.is-open \.setup-chev\s*\{[^}]*rotate\(180deg\)/);
});

test('card: the settled panel stops clipping, so the switches keep their hover tips', () => {
  // Both field switches carry a `.hover-tip` bubble drawn OUTSIDE the panel —
  // above the label, and wider than the card. The collapse animation needs
  // `overflow: hidden` on the panel while it grows, and that clip ate them: the
  // "Covered start" tip entirely (top row, bubble sits above the panel's own
  // edge) and "Even picks" mid-sentence at the card's right edge. The card
  // itself must never clip, and the panel must stop clipping once settled.
  assert.match(css, /\.lobby-setup\.is-settled \.setup-body-clip\s*\{[^}]*overflow:\s*visible/);
  const card = css.match(/\n\.lobby-setup \{[^}]*\}/);
  assert.ok(card, 'index.css must carry the .lobby-setup rule');
  assert.ok(!/overflow:\s*hidden/.test(card[0]), '.lobby-setup must not clip — it eats the hover tips');
});

test('card: the settle delay is not shorter than the panel animation', () => {
  // Releasing the clip early is worse than not releasing it: the panel would
  // stop clipping while it is still growing and its contents would spill out of
  // the card. The JS constant has to cover the CSS transition.
  const pageJs = readFileSync(join(HERE, 'page.js'), 'utf-8');
  const settle = pageJs.match(/SETUP_SETTLE_MS = (\d+)/);
  assert.ok(settle, 'page.js must declare SETUP_SETTLE_MS');
  const anim = css.match(/\.setup-body \{ transition: grid-template-rows ([\d.]+)s/);
  assert.ok(anim, 'index.css must transition .setup-body grid-template-rows');
  assert.ok(Number(settle[1]) >= Number(anim[1]) * 1000,
    `settle ${settle[1]}ms must cover the ${Number(anim[1]) * 1000}ms open animation`);
});

test('card: the header uses the same 20px mode-icon slot as the radiogroup below it', () => {
  // Same mechanism = same code (CLAUDE.md). The summary icon is the first-round
  // artwork, so it must be the `.dl-ic` component and not a second copy of it.
  const m = html.match(/<button[^>]*class="setup-head"[\s\S]*?<\/button>/);
  assert.ok(m);
  assert.match(m[0], /class="dl-ic"[^>]*id="setup-sum-ic"/);
});
