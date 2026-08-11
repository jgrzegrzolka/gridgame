/**
 * Timing for the Flag Party live show. The room reducer (`flags/partyRoom.js`)
 * is deliberately time-free — it only knows "reveal now" / "next now". The pace
 * is driven by the host's page, which counts these durations down and fires the
 * `reveal` / `next` messages when they elapse. Every client also renders its own
 * copy of the countdown so the whole room feels the clock ticking, but only the
 * host's timer is authoritative for the transition (matching how the room already
 * treats the host as the only seat that can start / advance).
 *
 * Pure helpers, so the page stays thin and the arithmetic (clamping, ceil) is
 * unit-tested rather than eyeballed in DOM glue.
 */

/** Seconds a question stays open before it auto-reveals. A slow player gets
 *  the full window, but the room never waits it out when everyone has already
 *  answered — the server auto-reveals the moment the last seat buzzes. */
export const QUESTION_SECONDS = 20;

/**
 * How long a pause has to last before the popup explaining it appears.
 *
 * The freeze itself is instant — the clock stops the moment the server says a
 * seat dropped. Only the modal waits. A phone that backgrounds for a second, a
 * tunnel, a tab that reloads: all of those resolve inside this window, and
 * flashing a full-screen card up and away again for each one would be worse than
 * the stall it is explaining. Past that, the room deserves to be told why the
 * clock stopped.
 *
 * Deliberately NOT a grace period before resuming — nothing here decides
 * anything. The room stays paused until the player returns or the host says
 * otherwise; this only governs when the explanation surfaces.
 */
export const PAUSE_POPUP_DELAY_MS = 2000;

/**
 * Screens a **break** may start in — a pause any seat asks for, as opposed to
 * the drop-pause above that the room is forced into.
 *
 * Never during a question: the 20 s window is a shared race, and freezing
 * mid-question lets one seat stall the room to think — the exact thing a fixed
 * window protects against. So a press during a question is not refused, it is
 * *queued* and honoured at the next reveal; greying the control out at the one
 * moment a player reaches for it reads as broken.
 *
 * These are the client's SCREEN names, which are finer-grained than the room's
 * phases: `break` and `roundcard` are beats the client paints inside the room's
 * `reveal` / `question` phases. The room applies the coarser guard it can
 * actually see (`flags/partyRoom.js` {@link module:partyRoom.applyRequestBreak});
 * this is what decides, on the pressing device, between "freeze now" and "queue
 * it for the reveal".
 */
export const BREAK_PHASES = ['reveal', 'break', 'picking', 'roundcard'];

/**
 * Whether a break started right now would freeze immediately, rather than being
 * queued for the next reveal.
 * @param {string | null | undefined} phase  a client screen name
 * @returns {boolean}
 */
export function breakAllowedIn(phase) {
  return typeof phase === 'string' && BREAK_PHASES.includes(phase);
}

/** Seconds a clean reveal lingers — every present player got it right, so
 *  there's nothing to study and the question snaps on. Mirrors flagQuiz's pace
 *  (a correct pick advances almost immediately). */
export const CLEAN_REVEAL_SECONDS = 0.9;

/** Seconds a reveal lingers when someone missed (a wrong pick or a timeout), so
 *  players get a beat to see the correct flag they didn't land — and read the
 *  name strip on the flag they wrongly picked. Same reason flagQuiz holds longer
 *  on a wrong answer than a right one. */
export const MISS_REVEAL_SECONDS = 2.5;

/** Seconds a world-facts reveal lingers. Two things have to fit: the motion
 *  (four rows cascading 110 ms apart plus a 700 ms bar grow, ~1.0 s in total)
 *  and then enough STILLNESS to actually read four countries, four numbers and
 *  a scoreboard. The motion finishing is not the same as the chart having been
 *  read, which is what 3.2 s got wrong in play: it looked finished while nobody
 *  had taken it in yet. Same reasoning as ROUND_BREAK_SECONDS -- if it ever
 *  feels rushed, raise this rather than compressing the animation, because
 *  reading time is the scarce thing. Pinned by a test.
 *
 *  Applies to chart questions ONLY: flag-pick and map-pick have nothing to
 *  chart and keep their snappy pace. */
export const CHART_REVEAL_SECONDS = 5.5;

/**
 * Hold-to-read: freezing the chart reveal's clock while someone studies it.
 *
 * A chart reveal is the one screen in the show with something to actually read,
 * and {@link CHART_REVEAL_SECONDS} is a guess that is sometimes wrong. Rather
 * than raise it for everyone -- which slows every question to serve the slowest
 * reading of one -- any player presses and holds to freeze the clock and lets go
 * when they are done. You take what you need and the room resumes the instant
 * you release, so the average cost is lower than any fixed extension long enough
 * to be worth having.
 *
 * **Held time is deliberately unbounded.** An earlier version clamped it, which
 * made the arithmetic self-healing but meant the button quietly stopped meaning
 * what it said: hold as long as you want, until a hidden allowance ran out
 * mid-sentence. A hold now ends only when the holder lets go, hides the tab, or
 * leaves -- so the ways a hold could get stuck are closed at their source
 * instead of being papered over by a timer:
 *
 * - **let go** -- pointerup / pointercancel / pointerleave / keyup on the page;
 * - **tab hidden, phone locked, laptop closed** -- `visibilitychange` and
 *   `pagehide` release locally (`flagParty/page.js`);
 * - **network drop, tab closed, crash** -- the server releases the seat on
 *   disconnect (`party/partyGameServer.js` `onClose`), which is the case a
 *   client-side release can never cover;
 * - **phase moved on** -- the client clears holders on any phase change.
 *
 * What is left is a player deliberately holding a button on a visible screen,
 * which is a person the room can see ("Zosia is reading...") and speak to, not a
 * failure mode to engineer against.
 *
 * @typedef {{ heldMs: number, sinceMs: number | null }} HoldState
 *   `heldMs` is time already banked from finished holds; `sinceMs` is the epoch
 *   ms the current hold started, or null when nobody is holding.
 */

/** A fresh reveal's hold accounting: nothing held, nobody holding.
 *  @returns {HoldState} */
export function initialHold() {
  return { heldMs: 0, sinceMs: null };
}

/**
 * Someone started holding. A no-op while a hold is already running, so the
 * second player to press does not restart the stretch the first one is holding
 * -- the room freezes while *anyone* holds, and the page tracks holders as a set.
 *
 * @param {HoldState} hold
 * @param {number} nowMs
 * @returns {HoldState}
 */
export function beginHold(hold, nowMs) {
  if (hold.sinceMs != null) return hold;
  return { heldMs: hold.heldMs, sinceMs: nowMs };
}

/**
 * The last holder let go. Banks the live stretch so a reveal held, released and
 * held again keeps the time it already bought.
 *
 * @param {HoldState} hold
 * @param {number} nowMs
 * @returns {HoldState}
 */
export function endHold(hold, nowMs) {
  if (hold.sinceMs == null) return hold;
  return { heldMs: heldMsAt(hold, nowMs), sinceMs: null };
}

/**
 * Total held ms as of `nowMs` -- banked plus live.
 *
 * Callers add this to the reveal's deadline rather than pausing a counter, so
 * the freeze is always derived from wall time and survives a tick the browser
 * skips (a backgrounded tab, a stalled frame) instead of drifting.
 *
 * @param {HoldState} hold
 * @param {number} nowMs
 * @returns {number}
 */
export function heldMsAt(hold, nowMs) {
  const live = hold.sinceMs == null ? 0 : Math.max(0, nowMs - hold.sinceMs);
  return hold.heldMs + live;
}

/**
 * How long the reveal lingers, keyed on whether the question was a clean sweep
 * and whether it draws a chart. A chart reveal ({@link CHART_REVEAL_SECONDS})
 * always gets its full beat -- the ranking is the payoff of the question, not a
 * consolation for getting it wrong, so a clean sweep must not skip it. Otherwise
 * a clean question ({@link CLEAN_REVEAL_SECONDS}) moves fast and a missed one
 * ({@link MISS_REVEAL_SECONDS}) holds so the answer can be read.
 *
 * @param {boolean} clean  every present player picked the correct answer
 * @param {boolean} [chart] the reveal draws the ranked chart (world facts)
 * @returns {number}
 */
export function revealSecondsFor(clean, chart = false) {
  if (chart) return CHART_REVEAL_SECONDS;
  return clean ? CLEAN_REVEAL_SECONDS : MISS_REVEAL_SECONDS;
}

/**
 * Whether the countdown bar paints in this phase — the one rule for a bar that
 * means two different things.
 *
 * During the **question** it is "time left to answer". During a **chart reveal**
 * it is "time until the next question", and that second job is not decoration:
 * hold-to-read asks the player to decide whether 5.5 s is enough for them, and
 * until now they had nothing to decide with. A draining bar is what makes the
 * choice informed, and a bar that visibly *stalls* (the held deadline pushes it
 * out) is the only on-screen proof that a press actually froze the room — the
 * button label alone claims a freeze it never shows.
 *
 * Everything else stays bar-less, for the reasons that made the reveal bar-less
 * in the first place: a clean/miss reveal is short enough that a bar would just
 * flicker, and the pick is deliberately untimed
 * ({@link PICK_TIMEOUT_SECONDS} is an invisible anti-stall fallback, not a race).
 *
 * @param {'question' | 'reveal' | 'picking'} mode
 * @param {boolean} [chart] the reveal draws the ranked chart (world facts)
 * @returns {boolean}
 */
export function barPaints(mode, chart = false) {
  if (mode === 'question') return true;
  return mode === 'reveal' && chart;
}

/** Seconds before a draft **pick** auto-resolves. There is **no visible pick
 *  countdown** — choosing a category shouldn't feel rushed — so this is a long,
 *  invisible safety net: the host (authoritative for timing, like the reveal)
 *  fires a `forcePick` only if the picker is truly absent, so an AFK / dropped
 *  seat can't stall the show. A present player picks long before it. */
export const PICK_TIMEOUT_SECONDS = 45;

/** Seconds a between-rounds **break** lingers before the host advances to the
 *  next round. The break shows the round's MVP and the standings (with rank
 *  movement) — a beat to read where everyone landed, so it holds longer than a
 *  reveal. Host-authoritative like the reveal: the host's page counts this down
 *  and fires `next` when it elapses; other clients just render the break. Keyed
 *  to reading a scoreboard, not to a question, so it's a flat duration rather than
 *  the reveal's clean/miss split.
 *
 *  **Raised 8 → 12 when the board became two-staged** (the round is built from
 *  zero, held, and only then merged into the carried total — see
 *  {@link LEDGER_MERGE_HOLD_MS}). That reorder appends a hold, a second count-up
 *  and a re-rank to a sequence that already ran ~7.1 s at eight seats, which put
 *  the merge *past* the moment the host sent `next`: the new stage would have
 *  been invisible at exactly the table sizes it matters most for. 12 s keeps the
 *  ≥2 s of stillness the schedule tests pin. The cost is a longer break for a
 *  small room whose round earned one bucket, where the motion ends early and the
 *  extra seconds are all stillness — the same trade this file has taken before
 *  (reading time is the scarce thing), and a flat number stays something a host
 *  can predict. */
export const ROUND_BREAK_SECONDS = 12;

/** The break's standings play as a **ledger**: the board arrives showing where
 *  everyone stood *before* the round, holds a beat, counts every score up to its
 *  new total, and only then slides the rows into their new order. Told in that
 *  order, an overtake is something you watch happen rather than a final ranking
 *  you're handed — the board's whole job is to say what the round just did.
 *
 *  These are milliseconds (the animation's unit) where the constants above are
 *  seconds (the host clock's unit). The four phases run back to back and must fit
 *  inside ROUND_BREAK_SECONDS with room left to actually read the result:
 *  500 + 700 + 180 + 800 = 2180 ms of motion, leaving ~3.8 s of stillness. If the
 *  break ever starts feeling rushed, raise ROUND_BREAK_SECONDS rather than
 *  compressing these — the reading time is what's scarce, not the animation. */
export const LEDGER_HOLD_MS = 500;
/** How long every row's score takes to count from `prevScore` up to `score`. */
export const LEDGER_COUNT_MS = 700;
/** A breath between the counting finishing and the rows starting to move, so the
 *  two motions read as cause and effect instead of one blur. */
export const LEDGER_SETTLE_MS = 180;
/** The row-movement slide. Matches the transition duration in
 *  `animateStandingsMovement` — change both together. */
export const LEDGER_SLIDE_MS = 800;

/** How long a single break row takes to fade in, and the gap between one row
 *  starting and the next. The break board cascades in bottom-to-top like the final
 *  board — but fading only, never sliding: the rows are already held at their
 *  *previous* ranks by the ledger's FLIP (an inline transform), and a CSS animation
 *  overrides inline styles, so an entrance that animated `transform` would throw
 *  every row to its final slot and destroy the movement the break exists to show. */
export const LEDGER_ENTER_MS = 400;
export const LEDGER_ENTER_STAGGER_MS = 90;

/**
 * When each ledger beat fires, as milliseconds from the moment the break appears.
 *
 * This exists because the beats are **nested timers** in `playLedger`, and nesting
 * makes an offset easy to measure from the wrong instant: the rows' slide was
 * scheduled `LEDGER_SETTLE_MS` after the count *started* rather than after it
 * *finished*, so the board slid while the numbers were still climbing — the two
 * motions blurring into one, which is the exact thing the settle beat exists to
 * prevent. Summing the four constants (the old test) could never catch that, since
 * the total was right and only the order was wrong. Expressing the schedule as
 * absolute offsets makes the ordering itself the thing under test.
 *
 * `rowCount` sets how long the entrance cascade takes, so the hold begins only once
 * the last row has arrived — the beat is "everyone is on screen, now look at them",
 * which a fixed allowance would get wrong at both two seats and eight.
 *
 * Stage one here is the round counted up in ONE go rather than bucket by bucket;
 * `chipsOffAt` is where it settles, and stage two ({@link mergeBeats}) hangs off
 * that exactly as it does off the pass path's `settleAt`.
 *
 * @param {number} rowCount  how many standings rows the break is showing
 * @returns {{ enterMs: number, countAt: number, slideAt: number, chipsOffAt: number, settleAt: number, mergeAt: number, mergeDur: number, rankAt: number, totalMs: number }}
 */
export function ledgerSchedule(rowCount = 0) {
  const rows = Math.max(0, rowCount);
  const enterMs = rows > 0 ? (rows - 1) * LEDGER_ENTER_STAGGER_MS + LEDGER_ENTER_MS : 0;
  const countAt = enterMs + LEDGER_HOLD_MS;
  // The breath is between the counting FINISHING and the rows starting to move.
  const slideAt = countAt + LEDGER_COUNT_MS + LEDGER_SETTLE_MS;
  const chipsOffAt = slideAt + LEDGER_SLIDE_MS;
  const merge = mergeBeats(chipsOffAt);
  return { enterMs, countAt, slideAt, chipsOffAt, settleAt: chipsOffAt, ...merge };
}

// ---- the break, told bucket by bucket (the "category passes") ----
// The default break no longer counts every score up at once. Instead the board
// climbs one SCORING BUCKET at a time — a "Correct" pass banks everyone's base,
// then a "Speed" pass, then "Only one" / "Close" — re-ranking after each. An
// overtake driven by speed then happens ON the speed pass, in front of you,
// which is the whole point: the board narrates *why* it moved, and the four
// buckets (base / speed / solo / closeness) each get their own labelled beat so
// a player can read what earned the points. `ledgerSchedule` above is kept for
// the fallback: a reconnect / mid-round join whose per-bucket split doesn't
// reconcile still counts up in one go rather than faking a breakdown.

/** Hold after the rows have arrived, before the first bucket pass — a beat to
 *  read where everyone stood before the round. */
export const LEDGER_PASS_HOLD_MS = 450;
/** How long one bucket's beat runs: a gain chip pops just left of the total, holds,
 *  then merges into the score as it counts. Longer than a bare count-up because the
 *  chip has to appear and be read before it flies in (see `playLedger`'s `flyGain`). */
export const LEDGER_PASS_COUNT_MS = 760;
/** The breath between a pass's count FINISHING and the re-rank slide starting,
 *  so the number change and the row movement read as cause and effect. */
export const LEDGER_PASS_SETTLE_MS = 100;
/** The per-pass re-rank slide. Matches the inline transition duration in
 *  `playLedger`'s pass path — change both together. */
export const LEDGER_PASS_SLIDE_MS = 460;
/** The gap after one pass has fully settled before the next pass's banner. */
export const LEDGER_PASS_GAP_MS = 120;

// ---- stage two: the round's number, then the carried total on top ----
// The board used to open at each player's carried total and count the round into
// it, so the round was only ever legible as a DIFFERENCE — "who won that round"
// was a question the screen could not answer, and the pass chips were its only
// trace. The standings still have to be on screen (hiding them makes the last
// round pointless to play and the ending arbitrary), so the beat is reordered
// rather than replaced: stage one builds THIS round from zero and is held long
// enough to read, then stage two lands the carried total on top and re-ranks.
//
// These three offsets are what stage two costs, and they are the reason
// ROUND_BREAK_SECONDS moved to 12.

/** How long the settled ROUND result holds before the carried total lands on it.
 *  The whole point of the reorder: a number that is never still is a number
 *  nobody reads, and this is the only window in which the board says what the
 *  round did. */
export const LEDGER_MERGE_HOLD_MS = 1300;
/** The merge count-up — the carried total climbing onto the round's number.
 *  Longer than a pass count (760 ms) because it usually moves a much bigger
 *  distance, and it eases out (`countUp`'s cubic) so the number decelerates into
 *  its final value rather than stopping dead. */
export const LEDGER_MERGE_COUNT_MS = 900;
/** The gap from the merge STARTING to the rows re-ranking. Deliberately shorter
 *  than the count (620 < 900) but past the point the numbers have visibly
 *  stopped moving: re-ranking on the first frame of the merge would slide the
 *  rows while every total on them is still climbing, which is the same "two
 *  motions read as one blur" failure {@link LEDGER_PASS_SETTLE_MS} exists to
 *  prevent, one stage up. */
export const LEDGER_MERGE_RANK_MS = 620;

/**
 * Stage two's beats, given when stage one settles. Shared by both ledger paths
 * (the bucket passes and the count-up-in-one-go fallback) so the two cannot
 * drift into telling the merge differently.
 *
 * `totalMs` is when the LAST motion finishes — the re-rank slide, not the count
 * — because that, not the arithmetic, is what the break has to fit around.
 *
 * @param {number} settleAt  ms from the break appearing to stage one settling
 * @returns {{ mergeAt: number, mergeDur: number, rankAt: number, totalMs: number }}
 */
export function mergeBeats(settleAt) {
  const mergeAt = settleAt + LEDGER_MERGE_HOLD_MS;
  const rankAt = mergeAt + LEDGER_MERGE_RANK_MS;
  return {
    mergeAt,
    mergeDur: LEDGER_MERGE_COUNT_MS,
    rankAt,
    totalMs: rankAt + LEDGER_PASS_SLIDE_MS,
  };
}

/**
 * When each bucket pass fires, as milliseconds from the moment the break appears.
 * Each pass is a count (`countAt`) then, after the count finishes and a settle
 * beat, a re-rank slide (`slideAt`). Passes never overlap: one fully settles
 * before the next begins. `settleAt` is when the last slide completes — the beat
 * the pass banner clears and the round's MVP line fades in.
 *
 * Expressed as absolute offsets (like {@link ledgerSchedule}) so the ORDERING is
 * the thing under test, not just the sum. `passCount` is how many buckets any
 * player actually earned this round (1–4); a round nobody scored passes 0 and the
 * sequence is just the hold.
 *
 * `settleAt` ends STAGE ONE — the round's own number, settled and ranked by the
 * round alone. Stage two ({@link mergeBeats}) hangs off it: the hold, the carried
 * total counting on top, and the re-rank into the standings.
 *
 * @param {number} rowCount   standings rows on screen (sets the entrance cascade)
 * @param {number} passCount  buckets earned this round, in [0, 4]
 * @returns {{ enterMs: number, steps: Array<{ countAt: number, slideAt: number }>, settleAt: number, mergeAt: number, mergeDur: number, rankAt: number, totalMs: number }}
 */
export function passLedgerSchedule(rowCount = 0, passCount = 0) {
  const rows = Math.max(0, rowCount);
  const passes = Math.max(0, passCount);
  const enterMs = rows > 0 ? (rows - 1) * LEDGER_ENTER_STAGGER_MS + LEDGER_ENTER_MS : 0;
  /** @type {Array<{ countAt: number, slideAt: number }>} */
  const steps = [];
  let t = enterMs + LEDGER_PASS_HOLD_MS;
  for (let p = 0; p < passes; p += 1) {
    const countAt = t;
    const slideAt = countAt + LEDGER_PASS_COUNT_MS + LEDGER_PASS_SETTLE_MS;
    steps.push({ countAt, slideAt });
    t = slideAt + LEDGER_PASS_SLIDE_MS + LEDGER_PASS_GAP_MS;
  }
  // The MVP reveal lands when the last slide finishes — the trailing gap is only
  // spacing before a *next* pass that doesn't exist, so it isn't part of the run.
  const settleAt = passes > 0 ? t - LEDGER_PASS_GAP_MS : enterMs + LEDGER_PASS_HOLD_MS;
  return { enterMs, steps, settleAt, ...mergeBeats(settleAt) };
}

/** Delay from the winner's beat starting to the confetti / fireworks burst.
 *  Slightly into their screen, so the burst lands ON the winner's arrival rather
 *  than over it — and on the WINNER'S beat, not on the board, because a burst
 *  over rows still landing punctuates nothing.
 *
 *  This is the sole survivor of the old bottom-up final cascade
 *  (`finalBoardSchedule` and its five row constants), which the ceremony
 *  replaced: the board no longer walks up from last place, holds the winner
 *  back, or counts any row up — every one of those jobs moved into a beat of its
 *  own in {@link honoursSchedule}. */
export const FINAL_CELEBRATION_OFFSET_MS = 220;

// ---- the finish, as a ceremony: honours, the winner, then the board ----
// Three beats run where the board used to be the whole ending: one screen per
// honour, then the winner's own screen, then the board with the winner's card
// continued as its header.
//
// The ORDER is the design, and it is deliberate. Once the result is known the
// room stops watching: people talk, reach for phones, argue about the last
// question. Anything after the result gets talked over, which is why award
// ceremonies run the minor categories first. While the result is unknown, every
// honour is live information about someone who might have won; after the board
// the same line is a rosette handed to a loser.

/** An honour screen deals in from the right, with a small overshoot. */
export const HONOUR_IN_MS = 220;
/** ...holds still, which is the reading time and the scarce thing here (the same
 *  call {@link CHART_REVEAL_SECONDS} makes)... */
export const HONOUR_HOLD_MS = 1600;
/** ...then leaves to the left, fading. Energy at the EDGES of the beat, never in
 *  the middle: a slow symmetric fade reads as a bad connection, not a ceremony. */
export const HONOUR_OUT_MS = 180;
/** The winner's own screen — the largest thing in the ending. Longer than an
 *  honour because the score counts up inside it and the ♛ pill lands late.
 *
 *  It has to out-last (and out-size) the honours or the ordering says the wrong
 *  thing: five full screens of mentions followed by nothing but a table row is
 *  what made the honours read as the bigger prize. */
export const WINNER_BEAT_MS = 2800;
/** How long the honours strip on the board holds one honour before crossfading
 *  to the next. Also what makes the ending "over": the board has said everything
 *  it has to say once the strip has shown its first honour out. */
export const HONOUR_STRIP_CYCLE_MS = 3000;
/** The winner's card landing as the board header, continued from its own screen
 *  (`scale(1.06)` → 1) rather than re-revealed. Read by {@link honoursSchedule}
 *  as the settle time of a ceremony with no honours to cycle. */
export const BOARD_HEADER_MS = 320;
/** The gap between one ranked row starting to fade in and the next. Top-down and
 *  uniform: no cascade and no count-up, because the score already counted on the
 *  winner's screen and the result is already known.
 *
 *  Only the STAGGER lives here, because only the stagger is arithmetic anyone
 *  computes — the page stamps it as a per-row `--enter-delay`. The fade's own
 *  duration, and the strip's crossfade, are CSS and nothing else needs to know
 *  them; exporting a constant no module imports would be a pairing that looks
 *  enforced and is not. */
export const BOARD_ROW_STAGGER_MS = 60;

/**
 * The ceremony, as absolute offsets from the moment the final phase begins.
 *
 * Absolute rather than nested for the same reason the ledger schedules are (see
 * {@link ledgerSchedule}): the ORDERING is what regresses, and summing durations
 * can be right while the order is wrong. `winnerAt` must land after the last
 * honour has left, and `boardAt` after the winner beat — neither is something a
 * total can assert.
 *
 * `honourCount` is however many honours have a real non-winner behind them, not
 * a fixed five: a duel has one (the only seat that can hold one is the player
 * who lost) and solo has none. The ceremony degrades to what it actually has
 * rather than padding.
 *
 * @param {number} [honourCount]  honours to cycle, 0..n
 * @returns {{ beats: Array<{ inAt: number, outAt: number }>, winnerAt: number, boardAt: number, totalMs: number }}
 */
export function honoursSchedule(honourCount = 0) {
  const n = Math.max(0, Math.floor(honourCount));
  /** @type {Array<{ inAt: number, outAt: number }>} */
  const beats = [];
  let t = 0;
  for (let i = 0; i < n; i += 1) {
    // A beat OWNS its screen from `inAt` until `outAt + HONOUR_OUT_MS`; the next
    // one starts only then, so two honours are never on screen together.
    const inAt = t;
    const outAt = inAt + HONOUR_IN_MS + HONOUR_HOLD_MS;
    beats.push({ inAt, outAt });
    t = outAt + HONOUR_OUT_MS;
  }
  const winnerAt = t;
  const boardAt = winnerAt + WINNER_BEAT_MS;
  return {
    beats,
    winnerAt,
    boardAt,
    // The ending is "over" when the board has settled and the strip has held its
    // first honour out — the board itself never finishes, it just sits there
    // being read, and the strip cycles for as long as anyone is looking. At three
    // honours that is ~11.8 s and at five ~15.8 s, against the ~1.5 s the ending
    // used to spend.
    totalMs: boardAt + (n > 0 ? HONOUR_STRIP_CYCLE_MS : BOARD_HEADER_MS),
  };
}

/** Seconds the **round title card** holds before the first question of a new round
 *  begins (round 2..N — the first round starts play straight away). A short
 *  beat announcing "Round 2 of 3 · Coffee · 5 questions" with who picked it; the
 *  question clock and veil start fresh *after* it, so it costs no answer time.
 *  Client-side and uniform — every client (host included) holds the same beat, so
 *  no clock drift is introduced (the host's authoritative reveal clock simply
 *  starts after the card, like everyone else's). */
export const ROUND_INTRO_SECONDS = 2;

/** Tricky mode is about flag *visibility*; the world-facts name reveal is about
 *  flag *identity* — a separate axis. On a world-facts question the answer is a fact
 *  ("which grows the most coffee?"), not flag recognition, so a player who knows
 *  the fact but can't pick the country's flag out of four is blocked on the wrong
 *  skill. Three seconds in, the country names fade onto the tiles, so an early
 *  flag-recognizer still buzzes first for the speed bonus while a fact-knower
 *  gets a fair shot once the labels land. Applies to metric questions only,
 *  independent of tricky mode.
 *
 *  **Fixed, not configurable.** This was a host-configurable fraction of the
 *  window (40/50/60/80%, or off) — four options and an off switch for a beat
 *  nobody had a reason to tune, which cost a picker in the lobby, a field on
 *  every question message, and a validator. A fixed 3 s reads the same in a
 *  20-second window as in any future one, and is a plain number rather than a
 *  fraction the host has to convert in their head. */
export const NAME_REVEAL_SECONDS = 3;

/** Default reveal fraction per question category. Flags stay obscured longest (they
 *  carry the most give-away detail); outlines clear earlier (a monochrome
 *  silhouette is already hard, and grey does nothing to it); metric questions clear
 *  earliest (the flags are incidental there — the question is the number — so the
 *  veil is just flavour).
 *
 *  **Fixed, not configurable** — same call as NAME_REVEAL_SECONDS above. These were
 *  host-editable per category (a 20/40/60/80% picker each) in the retired "Custom
 *  setup" panel, which cost three rows in the lobby, a persisted config, a wire
 *  field on `start` and a validator, to tune a beat no host had a reason to touch.
 *  Whether a round is veiled at all is still a live choice — the draft picker arms
 *  it per round (`segment.veil`); only the clear timing is settled here. */
export const DEFAULT_REVEAL = { flag: 0.8, map: 0.4, metric: 0.2 };

/**
 * Whether a question plays a world metric (population / area / GDP / coffee / …).
 * Every superlative instance shares the `superlative` id prefix (`superlative`
 * for population, `superlative-area`, `superlative-coffee`, …), so one prefix
 * test catches them all — unlike {@link revealCategoryFor}, which only maps the
 * literal `superlative` id to `metric`. Used to decide which questions get the
 * name-reveal strip.
 * @param {string} [questionId]
 * @returns {boolean}
 */
export function isMetricQuestion(questionId) {
  return typeof questionId === 'string' && questionId.startsWith('superlative');
}

/**
 * The reveal category for a question, from its `questionId`: the map question is `map`,
 * the population / superlative question is `metric`, and every flag-pick question
 * (sovereign or territory) is `flag`. Both flag modes share one category — the
 * distinction that matters to the veil is flags vs outlines vs numbers.
 * @param {string} [questionId]
 * @returns {'flag' | 'map' | 'metric'}
 */
export function revealCategoryFor(questionId) {
  if (questionId === 'mapPick') return 'map';
  if (questionId === 'superlative') return 'metric';
  return 'flag';
}

/**
 * Veil progress in [0, 1] for the tricky-mode reveal: 0 = fully hidden (grey,
 * blurred, panels covering the tile), 1 = fully clear. Reaches 1 at `clearFrac`
 * of the way through the question window and then holds clear. Clamped both ends
 * so a late tick or a reconnect that lands past the deadline never yields a
 * value outside [0, 1].
 *
 * @param {number} deadlineMs  epoch ms the question ends
 * @param {number} nowMs  current epoch ms
 * @param {number} totalMs  the question's full length in ms
 * @param {number} clearFrac  fraction of the window to reach full clarity by
 * @returns {number}
 */
export function veilProgress(deadlineMs, nowMs, totalMs, clearFrac) {
  if (totalMs <= 0 || clearFrac <= 0) return 1;
  const elapsed = totalMs - (deadlineMs - nowMs);
  return Math.min(1, Math.max(0, elapsed / (totalMs * clearFrac)));
}

/**
 * Whether a question's tiles are veiled (tricky mode's grey/blur/panel resolve).
 * Two rules, and deliberately no third:
 *
 * - the host's tricky setting decides it, and nothing else. The final round used
 *   to veil regardless — which made the veil something a host could neither
 *   predict nor turn off, and in draft, where the toggle is never offered, it
 *   appeared out of nowhere for the closing round. The finale reads as the finale
 *   through double points instead.
 * - **never on a statistics question.** The veil is a flag / outline recognition
 *   challenge; on a "which grows the most coffee?" question the flag is
 *   incidental, so hiding it tests the wrong skill. Statistics questions get the
 *   name reveal for their own flag-identity problem instead.
 *
 * Lives here rather than in the page so both rules are pinned by tests — they
 * have each been wrong in production once.
 *
 * @param {boolean} tricky  the host's tricky-mode setting
 * @param {string} [questionId]  the question being shown
 * @returns {boolean}
 */
export function veilActive(tricky, questionId) {
  // Statistics questions never veil: the flag is incidental there (the question
  // is the number), those rounds already run hard, and hiding the flag only
  // withholds a cue that wasn't the point. That exclusion stays.
  if (isMetricQuestion(questionId)) return false;
  // Spot-the-flag DOES veil now, by an explicit product call (2026-07-21). It
  // used to be excluded on the reasoning that the veil withholds the colours and
  // motifs the question asks you to read -- but spot-the-flag is the gentlest
  // recognition round in the show, and the veil clearing over the clock is
  // exactly the extra difficulty it wanted. It is opt-in either way (a picker
  // arms it per round, or the host arms round 1), never forced. Reversal noted
  // in PARTY.md; the metric exclusion above is a different case and is unchanged.
  return tricky === true;
}

/**
 * Whether the world-facts country names should be shown yet: true once
 * {@link NAME_REVEAL_SECONDS} have elapsed in the question window. Reads the same
 * clock as the veil and the countdown, so every client flips the names on at the
 * same instant. A window already past its deadline reads as revealed.
 *
 * The caller decides *whether* a question gets names at all (metric questions
 * only — see {@link isMetricQuestion}); this only answers *when*.
 *
 * @param {number} deadlineMs  epoch ms the question ends
 * @param {number} nowMs  current epoch ms
 * @param {number} totalMs  the question's full length in ms
 * @returns {boolean}
 */
export function namesRevealed(deadlineMs, nowMs, totalMs) {
  if (totalMs <= 0) return true;
  const elapsed = totalMs - (deadlineMs - nowMs);
  return elapsed >= NAME_REVEAL_SECONDS * 1000;
}

/**
 * Whole seconds left until `deadlineMs`, never negative. Ceil so a freshly-set
 * 15,000 ms deadline reads "15" and the display only reaches "0" at true expiry
 * (a floor would flash "0" for the whole final second).
 *
 * @param {number} deadlineMs  epoch ms when the phase ends
 * @param {number} nowMs  current epoch ms
 * @returns {number}
 */
export function secondsLeft(deadlineMs, nowMs) {
  return Math.max(0, Math.ceil((deadlineMs - nowMs) / 1000));
}

/**
 * Fraction of the phase still remaining, in [0, 1], for a shrinking bar: 1 at
 * the start, 0 at (or past) the deadline. Clamped both ends so a late tick or a
 * reconnect that arrives past the deadline never yields a negative or >1 width.
 *
 * @param {number} deadlineMs
 * @param {number} nowMs
 * @param {number} totalMs  the phase's full length in ms
 * @returns {number}
 */
export function remainingFraction(deadlineMs, nowMs, totalMs) {
  if (totalMs <= 0) return 0;
  const frac = (deadlineMs - nowMs) / totalMs;
  return Math.min(1, Math.max(0, frac));
}
