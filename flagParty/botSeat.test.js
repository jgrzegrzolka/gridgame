import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { showBotSeat } from './botSeat.js';
import { MAX_SEATS } from '../flags/partyRoom.js';
import { BOT_SKILL_ORDER } from '../flags/partyBot.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(HERE, 'index.html'), 'utf-8');
const pageJs = readFileSync(join(HERE, 'page.js'), 'utf-8');

/** The empty seat's markup, which is where the whole control lives. */
function seatHtml() {
  const m = html.match(/<div class="chip bot-seat"[\s\S]*?<\/div>\s*<\/div>/);
  assert.ok(m, 'index.html must carry the bot seat');
  return m[0];
}

test('the host sees the empty seat in the lobby', () => {
  assert.equal(showBotSeat({ isHost: true, inLobby: true, seatCount: 1 }), true);
});

test('a guest never sees it — adding a seat is the host call', () => {
  assert.equal(showBotSeat({ isHost: false, inLobby: true, seatCount: 1 }), false);
});

test('it is gone once the game is running', () => {
  assert.equal(showBotSeat({ isHost: true, inLobby: false, seatCount: 1 }), false);
});

test('a full room hides the seat rather than offering a dead one', () => {
  assert.equal(showBotSeat({ isHost: true, inLobby: true, seatCount: MAX_SEATS - 1 }), true);
  assert.equal(showBotSeat({ isHost: true, inLobby: true, seatCount: MAX_SEATS }), false);
  // Over the cap can only happen if the server's limit moves under a stale
  // client; the seat stays hidden rather than offering a seat that would bounce.
  assert.equal(showBotSeat({ isHost: true, inLobby: true, seatCount: MAX_SEATS + 3 }), false);
});

// ---- the seat's markup: one tap per level, no words ----

test('seat: one button per difficulty, in BOT_SKILL_ORDER', () => {
  // Easiest first. The order is not cosmetic — the dots encode a rank, so a row
  // that ran hardest-first would draw three, two, one and read backwards.
  const skills = [...seatHtml().matchAll(/class="bot-lv" data-skill="([a-z]+)"/g)].map((m) => m[1]);
  assert.deepEqual(skills, [...BOT_SKILL_ORDER]);
});

test('seat: every level shows the whole three-step scale, filled to its own rank', () => {
  // The defining property of this design over "one dot, two dots, three dots":
  // each button always draws three slots, so "two of three" reads on its own
  // without comparing it to the buttons either side.
  const buttons = seatHtml().match(/<button[\s\S]*?<\/button>/g) || [];
  assert.equal(buttons.length, 3);
  buttons.forEach((btn, i) => {
    const total = (btn.match(/class="bot-dot(?: on)?"/g) || []).length;
    const filled = (btn.match(/class="bot-dot on"/g) || []).length;
    assert.equal(total, 3, `${BOT_SKILL_ORDER[i]} draws three slots`);
    assert.equal(filled, i + 1, `${BOT_SKILL_ORDER[i]} fills ${i + 1}`);
  });
});

test('seat: the level words survive as accessible names, since the row shows none', () => {
  // Dropping Easy/Medium/Hard from the row is what makes it fit every language.
  // The words have to live somewhere, or the buttons are unnameable to a screen
  // reader and unlabelled on hover.
  const seat = seatHtml();
  for (const key of ['party.botEasy', 'party.botMedium', 'party.botHard']) {
    assert.match(seat, new RegExp(`aria-label:${key.replace('.', '\\.')},title:${key.replace('.', '\\.')}`));
  }
});

test('seat: no dropdown, and no separate Add button', () => {
  // The two-step control this replaced. A <select> here means the OS picker is
  // back, which was the original complaint.
  const seat = seatHtml();
  assert.ok(!/<select/.test(seat), 'no native picker on the seat');
  assert.ok(!/id="add-bot"/.test(seat), 'no separate Add button — a level tap IS the add');
});

test('seat: the difficulty preference is gone, not merely unused', () => {
  // With one button per level there is nothing to pre-fill, so a remembered
  // choice could only mark a button that isn't a selection. Dropped deliberately
  // (Jan, 2026-07-24: "does not make sense anymore") — this fails if it creeps
  // back in as a highlight. Matches the identifiers rather than the key string,
  // so the comment explaining the removal doesn't trip it.
  assert.ok(!/BOT_SKILL_KEY|loadBotSkill|saveBotSkill/.test(pageJs), 'no stored bot skill');
});
