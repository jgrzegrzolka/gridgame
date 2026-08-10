import { PARTY_MODES } from './partyPlan.js';

/**
 * The Flag Party finish's **honours**: job titles handed out at the end of a
 * game, read out a few at a time before the result is known and then cycled in
 * full on the board.
 *
 * Every number here comes from data the game already computes and then throws
 * away — buzz order, correctness, who never answered, and the per-round gains
 * the between-rounds break already tallies. Nothing new is measured; the room
 * just stops discarding it (`flags/partyRoom.js`'s `honourStats`).
 *
 * **The titles are job titles, given straight.** The app never winks, which is
 * what makes them funny and what keeps them readable out loud to the room. One
 * title per game may mock rather than promote (Sardynka); more than one and the
 * whole set becomes a bit. They are a fixed table, never generated at runtime:
 * a title that changes between games is a joke nobody can repeat.
 *
 * Pure, so `flagParty/page.js` stays DOM glue and every rule below — the floors,
 * the caps, what happens at three seats — is a unit test rather than something
 * you can only see by playing a game out.
 *
 * @typedef {Object} SeatStat
 * @property {number} buzzes  questions this seat answered at all
 * @property {number} timed  of those, how many had a measurable latency. Lower
 *   than `buzzes` when the question was frozen or a durable-object eviction lost
 *   its deal time (see `party/partyGameServer.js`) — the mean is taken over
 *   `timed`, so an unusable sample drops out instead of counting as zero.
 * @property {number} latencyMs  summed ms from the question appearing to the buzz
 * @property {number} correct  of `buzzes`, how many were right
 * @property {number} unanswered  questions that went by with no answer at all
 *
 * @typedef {Object} ModeStat
 * @property {number} asked  questions this mode ran
 * @property {Record<string, number>} gains  playerId -> points earned in it
 * @property {Record<string, number>} correct  playerId -> right answers in it
 *
 * @typedef {Object} HonourStats
 * @property {Record<string, SeatStat>} seats
 * @property {Record<string, ModeStat>} modes  keyed by mode id (`flags-all`,
 *   `superlative-gdp`, …). A mode the game never played simply has no entry.
 *
 * @typedef {Object} Honour
 * @property {string} id  a key of {@link TITLES}
 * @property {string} playerId
 * @property {string} glyph
 * @property {boolean} screened  whether this title earned a ceremony screen
 * @property {number} [meanMs]  fastestFinger
 * @property {number} [correct]  thinker / statistics titles
 * @property {number} [total]  thinker / statistics titles
 * @property {number} [unanswered]  sleeper
 * @property {number} [gain]  picture-mode titles
 * @property {string} [modeId]  mode titles, so the client can name the round
 */

/**
 * The catalog. `glyph` is part of the title — each is recognisable from across a
 * table before its label has been read — and `mode` ties a title to the one mode
 * that can earn it.
 *
 * **Every mode in `PARTY_MODES` should eventually appear here.** A mode with no
 * title simply produces no candidate, which is a legal outcome ("fewer real
 * candidates: award fewer, never pad") but a quiet one — the round is played and
 * nobody can be honoured for it. `titlelessModes()` below names the gap so a
 * test can hold the line rather than letting it widen unnoticed.
 *
 * @type {Record<string, { glyph: string, mode?: string, tail?: boolean, party?: boolean }>}
 */
export const TITLES = {
  // ---- speed and pace: available in every game, whatever it played ----
  fastestFinger: { glyph: '⚡' },
  thinker: { glyph: '⏳' },
  // ---- the consolation tail: only reached by the small-room guarantee ----
  sleeper: { glyph: '☾', tail: true },
  // The bottom of the tail: **party** titles, drawn rather than earned. Every
  // other title in this table is a claim about how someone played; these are
  // jokes about the room, which is exactly why they are the ones handed to a seat
  // the game has nothing true to say about. See {@link tailCandidates}.
  // No barman here on purpose: `bartender` above is an EARNED title (the alcohol
  // round), and in Polish both are "Barman" — one game could hand out two rows
  // reading the same word, one for knowing the drinking statistics and one for
  // knowing nothing at all.
  partyDancer: { glyph: '♪', tail: true, party: true },
  partyCrisps: { glyph: '◔', tail: true, party: true },
  partyPlaylist: { glyph: '▤', tail: true, party: true },
  partySoul: { glyph: '♥', tail: true, party: true },
  partyPhotographer: { glyph: '⊡', tail: true, party: true },

  // ---- one per picture mode ----
  flagSommelier: { glyph: '✓', mode: 'flags-all' },
  oddityCollector: { glyph: '❖', mode: 'flags-weird' },
  hawkEye: { glyph: '◉', mode: 'spot-flag' },
  cartographer: { glyph: '△', mode: 'map-outlines' },

  // ---- one per statistics mode ----
  // Each `superlative*` id is its own category, so each earns its own title: a
  // seat who owns the coffee questions did something different from one who owns
  // the GDP questions, and one shared "statistician" would flatten that.
  demographer: { glyph: '◍', mode: 'superlative-pop' },
  surveyor: { glyph: '⊿', mode: 'superlative-area' },
  sardine: { glyph: '▨', mode: 'superlative-density' },
  economist: { glyph: '$', mode: 'superlative-gdp' },
  accountant: { glyph: '¢', mode: 'superlative-gdppc' },
  barista: { glyph: '☕', mode: 'superlative-coffee' },
  sommelier: { glyph: '⚱', mode: 'superlative-wine' },
  chocolatier: { glyph: '❂', mode: 'superlative-cocoa' },
  greengrocer: { glyph: '☾', mode: 'superlative-banana' },
  orchardist: { glyph: '♣', mode: 'superlative-apple' },
  alpinist: { glyph: '▲', mode: 'superlative-elevation' },
  lighthouseKeeper: { glyph: '≈', mode: 'superlative-coastline' },
  forester: { glyph: '♠', mode: 'superlative-forest' },
  driller: { glyph: '▮', mode: 'superlative-oil' },
  riceFarmer: { glyph: '☴', mode: 'superlative-rice' },
  collier: { glyph: '◼', mode: 'superlative-coal' },
  shepherd: { glyph: '☁', mode: 'superlative-sheep' },
  rancher: { glyph: '☰', mode: 'superlative-cattle' },
  brewmaster: { glyph: '🍺', mode: 'superlative-beer' },
  teaMaster: { glyph: '☘', mode: 'superlative-tea' },
  sugarBaron: { glyph: '❈', mode: 'superlative-sugarcane' },
  assayer: { glyph: '◆', mode: 'superlative-gold' },
  bartender: { glyph: '♨', mode: 'superlative-alcohol' },
  butcher: { glyph: '✂', mode: 'superlative-meat' },
  borderGuard: { glyph: '⌗', mode: 'superlative-borders' },
  oliveGrower: { glyph: '◕', mode: 'superlative-olive-oil' },
  beekeeper: { glyph: '⬡', mode: 'superlative-honey' },
  meteorologist: { glyph: '☀', mode: 'superlative-temperature' },
  therapist: { glyph: '☺', mode: 'superlative-happiness' },
  prosecutor: { glyph: '§', mode: 'superlative-corruption' },
  tourGuide: { glyph: '➤', mode: 'superlative-tourism' },
  electrician: { glyph: '⌁', mode: 'superlative-electricity' },
  franchisee: { glyph: '▼', mode: 'superlative-mcdonalds' },
  laureate: { glyph: '✹', mode: 'superlative-nobel' },
  academy: { glyph: '✸', mode: 'superlative-nobel-pc' },
  sportsPundit: { glyph: '◈', mode: 'superlative-summer-medals' },
  smallNationPundit: { glyph: '◇', mode: 'superlative-summer-medals-pc' },
  winterPundit: { glyph: '❄', mode: 'superlative-winter-medals' },
  smallNationWinterPundit: { glyph: '❅', mode: 'superlative-winter-medals-pc' },
};

/**
 * The party titles, in catalog order — what the draw draws from. Derived, so the
 * table above stays the single place a title is declared.
 * @type {string[]}
 */
export const PARTY_TITLES = Object.keys(TITLES).filter((id) => TITLES[id].party);

/**
 * Whether a title is a party title, and therefore says nothing about how its
 * holder played. The client asks so it can leave the evidence line off: every
 * other title reports the number it was won on, and a drawn one has none.
 * @param {string} id
 * @returns {boolean}
 */
export function isPartyTitle(id) {
  return !!(TITLES[id] && TITLES[id].party);
}

/** mode id -> title id, derived so the catalog stays the single source. */
const TITLE_BY_MODE = Object.fromEntries(
  Object.entries(TITLES).filter(([, t]) => t.mode).map(([id, t]) => [/** @type {string} */ (t.mode), id]),
);

/**
 * Modes the game can deal that no title covers. Empty today; a test asserts it
 * stays empty, so adding a mode without adding its title fails loudly instead of
 * quietly making that round unhonourable.
 * @returns {string[]}
 */
export function titlelessModes() {
  return PARTY_MODES.map((m) => m.id).filter((id) => !TITLE_BY_MODE[id]);
}

/** Whether a mode's title reports POINTS ("+29 in the Flags round") rather than
 *  right answers ("4 of 4 GDP questions"). Picture rounds are scored as a block;
 *  a statistics category is a handful of questions you either knew or didn't. */
const MODE_GROUP = Object.fromEntries(PARTY_MODES.map((m) => [m.id, m.group]));

/**
 * Minimum share of a seat's own answers that must be **right** before it can be
 * called a thinker.
 *
 * The other titles describe what a player did; this one makes a claim about the
 * quality of it, so awarding it to someone slow AND wrong reads as sarcasm aimed
 * at a player who just lost. 60 rather than 50 because at 50% over ten questions
 * the ceremony is calling a coin-flip thoughtful.
 */
export const THINKER_ACCURACY_FLOOR = 0.6;

/**
 * Minimum questions a seat must have let go by to be called a sleeper.
 *
 * One, because the sleeper is the rung directly above the party titles and its
 * whole job is to be reachable: a question that went by with nobody's finger on
 * it is a **true** thing to say about a seat, and anything true beats a drawn
 * joke. A higher floor did not make the title more deserved, it just pushed more
 * seats past the truth and into the draw.
 */
export const SLEEPER_MIN_UNANSWERED = 1;

/**
 * How many titles a room hands out, and how many of them get a ceremony screen.
 *
 * **These are two different numbers**, and the split is what lets a big room hand
 * out seven trophies without a seven-screen ceremony. Everything not screened is
 * still awarded, on the board, in the strip that reads every title in turn —
 * nothing is lost by not having had a screen, it is just read somewhere the room
 * is already talking.
 *
 * **The screens are the valuable half**, which is why there are five of them. A
 * screen is the only moment a title is the single thing on the phone, and it
 * happens while the result is still unknown, so it lands on a room that is still
 * watching. Five 2 s beats is ~10 s before the winner's screen: a long ending, on
 * purpose. Past five, holding the result back costs the room more than the next
 * title gives it.
 *
 * Seven titles is the cap for a different reason: the strip cycles at 3 s, so
 * seven is a 21 s pass, already longer than anyone looks at a board.
 *
 * Small rooms hand out nearly as many as big ones (four at two seats, five at
 * three) because the ending is per seat, not per room — the failure being avoided
 * is a player watching an ending about other people. The caps in {@link
 * computeHonours} still bind, and at two seats they allow at most three (one for
 * the winner, two for the loser), so the fourth is a ceiling that game cannot
 * reach. That is "never pad" working, not a number to chase.
 *
 * @param {number} seatCount
 * @returns {{ titles: number, screens: number }}
 */
export function honourPlan(seatCount) {
  const n = Math.max(0, Math.floor(seatCount));
  if (n <= 1) return { titles: 0, screens: 0 };
  if (n === 2) return { titles: 4, screens: 4 };
  if (n === 3) return { titles: 5, screens: 5 };
  if (n === 4) return { titles: 5, screens: 5 };
  if (n === 5) return { titles: 6, screens: 5 };
  return { titles: 7, screens: 5 };
}

/** A seat with nothing recorded at all — never buzzed, never sat out a question.
 *  @param {SeatStat | undefined} s */
function played(s) {
  return !!s && (s.buzzes > 0 || s.unanswered > 0);
}

/** @param {SeatStat} s */
function meanLatency(s) {
  return s.timed > 0 ? s.latencyMs / s.timed : null;
}

/**
 * How far the leading value stands out from the rest of the field, in [0, 1].
 *
 * This is what stops the honours from restating the leaderboard. Ranked by
 * absolute value a strong player collects every title and the ceremony says the
 * same thing three times; ranked by distinctiveness each title goes to whoever
 * OWNS that category by the widest margin, so different people are named. "Best
 * in Flags by 12 points" outranks "best in GDP by 1".
 *
 * @param {number[]} values  every candidate's value in this category, any order
 * @param {number} top  the leading value
 * @returns {number}
 */
function distinctiveness(values, top) {
  if (values.length <= 1) return 1;
  const sorted = values.slice().sort((a, b) => b - a);
  const spread = sorted[0] - sorted[sorted.length - 1];
  if (spread <= 0) return 0;
  return (top - sorted[1]) / spread;
}

/**
 * Every (seat, title) pair this game can evidence, scored by distinctiveness. A
 * category the game never played produces nothing.
 *
 * @param {HonourStats} stats
 * @param {string[]} seats
 * @returns {Array<Honour & { score: number }>}
 */
function buildCandidates(stats, seats) {
  /** @type {Array<Honour & { score: number }>} */
  const out = [];
  const live = seats.filter((pid) => played(stats.seats[pid]));

  // ---- fastest finger: counts EVERY answer, wrong ones included ----
  // Nerve, not accuracy, and deliberately no floor: being fast and wrong already
  // punishes itself in the standings, and a player who mashes to win this pays
  // for it in last place. That is the joke.
  const timed = live
    .map((pid) => ({ pid, mean: meanLatency(/** @type {SeatStat} */ (stats.seats[pid])) }))
    .filter((x) => x.mean !== null);
  if (timed.length > 0) {
    const means = timed.map((x) => /** @type {number} */ (x.mean));
    const best = Math.min(...means);
    const winnerOf = timed.find((x) => x.mean === best);
    if (winnerOf) {
      out.push({
        id: 'fastestFinger', playerId: winnerOf.pid, glyph: TITLES.fastestFinger.glyph, screened: false,
        meanMs: Math.round(best),
        // Negated so "higher is better" holds for the shared spread maths.
        score: distinctiveness(means.map((m) => -m), -best),
      });
    }
  }

  // ---- thinker: the slowest buzzer, if they were mostly right ----
  if (timed.length > 0) {
    const slowest = timed.reduce((a, b) => (/** @type {number} */ (b.mean) > /** @type {number} */ (a.mean) ? b : a));
    const s = /** @type {SeatStat} */ (stats.seats[slowest.pid]);
    if (s.buzzes > 0 && s.correct / s.buzzes >= THINKER_ACCURACY_FLOOR) {
      out.push({
        id: 'thinker', playerId: slowest.pid, glyph: TITLES.thinker.glyph, screened: false,
        correct: s.correct, total: s.buzzes,
        score: distinctiveness(timed.map((x) => /** @type {number} */ (x.mean)), /** @type {number} */ (slowest.mean)),
      });
    }
  }

  // ---- one per mode the game actually played ----
  for (const [modeId, mode] of Object.entries(stats.modes || {})) {
    const titleId = TITLE_BY_MODE[modeId];
    if (!titleId) continue;
    const gains = live.map((pid) => ({ pid, gain: (mode.gains && mode.gains[pid]) || 0 }));
    const values = gains.map((g) => g.gain);
    const top = Math.max(...values, 0);
    // Nobody scored in it: there is no "best" at this to be, so no candidate.
    if (top <= 0) continue;
    const owner = gains.find((g) => g.gain === top);
    if (!owner) continue;
    out.push({
      id: titleId, playerId: owner.pid, glyph: TITLES[titleId].glyph, screened: false,
      modeId,
      ...(MODE_GROUP[modeId] === 'metric'
        ? { correct: (mode.correct && mode.correct[owner.pid]) || 0, total: mode.asked }
        : { gain: top }),
      score: distinctiveness(values, top),
    });
  }

  return out;
}

/**
 * The consolation tail, built separately because it is only ever reached by the
 * small-room guarantee — these are not titles the assignment competes over.
 *
 * @param {HonourStats} stats
 * @param {string[]} seats
 * @returns {Array<Honour>}
 */
function tailCandidates(stats, seats) {
  /** @type {Array<Honour>} */
  const out = [];
  // Sleeper: affectionate, and the only honour that may land on the last-placed
  // seat — the player it names already knows. Listed first, so a seat that slept
  // is named for the thing it actually did rather than falling through to a draw.
  const sleepy = seats
    .map((pid) => ({ pid, n: (stats.seats[pid] || {}).unanswered || 0 }))
    .filter((x) => x.n >= SLEEPER_MIN_UNANSWERED)
    .sort((a, b) => b.n - a.n);
  for (const s of sleepy) {
    out.push({ id: 'sleeper', playerId: s.pid, glyph: TITLES.sleeper.glyph, screened: false, unanswered: s.n });
  }
  // The bottom rung: a party title, drawn rather than earned.
  //
  // This is where the tail used to hand out **Praktykant** — "answered
  // everything, was the best at none of it" — which told a player, on a screen, in
  // front of the room, that the game had nothing to say about them. When there is
  // nothing true to a seat's name, giving them a quiz title anyway is the one
  // thing that reads as a pity prize. A party title is a joke about the room, not
  // a verdict on their play, so anyone can wear it.
  //
  // Drawn once per game, which here means DERIVED rather than randomised: the
  // finish is computed more than once for the same game — the `final` broadcast,
  // and again for every seat that reconnects onto the board (`honoursFor` in
  // `flags/partyRoom.js`) — so a `Math.random()` here would hand a rejoining
  // player a different joke from the one the room just watched. {@link
  // partyDrawSeed} reads the game's own record instead: frozen by the time the
  // finish is computed, and different in every game.
  //
  // A seat with nothing recorded at all is skipped, same as everywhere else: a
  // room restored from a snapshot written before the ceremony existed knows
  // nothing about who played, and must still finish handing out nothing.
  const start = partyDrawSeed(stats, seats) % PARTY_TITLES.length;
  seats.forEach((pid, i) => {
    if (!played(stats.seats[pid])) return;
    // Offset by seat, so two seats that both reach the draw wear two different
    // titles rather than queueing for one.
    const id = PARTY_TITLES[(start + i) % PARTY_TITLES.length];
    out.push({ id, playerId: pid, glyph: TITLES[id].glyph, screened: false });
  });
  return out;
}

/**
 * Where the party draw starts, as a non-negative integer.
 *
 * A hash of the game's own record — the seat ids and their buzz counts, summed
 * latencies, right answers and misses. Same finish, same title however many times
 * it is computed (see {@link tailCandidates}); different game, different title,
 * because no two games have the same numbers.
 *
 * @param {HonourStats} stats
 * @param {string[]} seats
 * @returns {number}
 */
function partyDrawSeed(stats, seats) {
  let h = 2166136261;
  const mix = (/** @type {number} */ n) => { h = (Math.imul(h, 16777619) ^ (n | 0)) | 0; };
  for (const pid of seats) {
    for (let i = 0; i < pid.length; i += 1) mix(pid.charCodeAt(i));
    const s = stats.seats[pid] || { buzzes: 0, timed: 0, latencyMs: 0, correct: 0, unanswered: 0 };
    mix(s.buzzes);
    mix(s.latencyMs);
    mix(s.correct);
    mix(s.unanswered);
  }
  return Math.abs(h);
}

/**
 * Award the game's honours.
 *
 * The rules, all pinned by tests:
 *
 * - **The winner is not excluded, they are capped** at one title besides
 *   ♛ Zwycięzca. Winning everything was the problem; winning something never was.
 *   The cap holds for as long as any other seat can take the next title; when none
 *   can, the winner takes it rather than leaving a true title unawarded, up to the
 *   ordinary per-seat cap. See "the winner's spare titles" below.
 * - **Nobody takes a second title until every seat holds one.** The assignment
 *   runs in passes, one title per seat per pass, so a room's trophies spread
 *   before they stack.
 * - Never the same title twice, and never the same seat twice in one pass.
 * - **At three or fewer non-winners, none of them leaves empty-handed**: the
 *   consolation tail is fallen through until each holds something — the sleeper
 *   first, and a drawn party title under it when even that is not true of them.
 *   Two strong players would otherwise take everything and the third watches a
 *   ceremony about other people, which is the exact failure the honours exist to
 *   prevent. Above that the guarantee lapses, and with it the only route to a
 *   party title — twelve titles means twelve meaningless ones.
 * - **Never pad.** Fewer real candidates than the table asks for is fine.
 *
 * @param {HonourStats | null | undefined} stats
 * @param {Array<{ playerId: string, nickname: string, score: number }>} board
 *   the final scoreboard, score-descending as the server sends it
 * @returns {Honour[]}  every awarded title; `screened` marks the ceremony ones.
 *   Screened titles come first, weakest-first, then the rest.
 */
export function computeHonours(stats, board) {
  if (!stats || !stats.seats) return [];
  const rows = Array.isArray(board) ? board : [];
  const seats = rows.map((r) => r.playerId);
  if (seats.length < 2) return [];
  const plan = honourPlan(seats.length);
  if (plan.titles === 0) return [];

  const winnerId = soleWinnerId(rows);
  /** Lower is better; used to break score ties toward whoever has less else to
   *  celebrate. */
  const placing = new Map(seats.map((pid, i) => [pid, i]));
  const perSeatCap = Math.max(1, Math.ceil(plan.titles / seats.length));
  /** The winner holds one title besides ♛ for as long as any other seat can take
   *  the next one; see the spare pass below for the case where none can. */
  const capFor = (/** @type {string} */ pid) => (pid === winnerId ? 1 : perSeatCap);

  const candidates = buildCandidates(/** @type {HonourStats} */ (stats), seats);
  /** @type {Honour[]} */
  const awarded = [];
  const usedTitles = new Set();
  /** @type {Map<string, number>} */
  const held = new Map(seats.map((pid) => [pid, 0]));

  for (let pass = 0; pass < perSeatCap && awarded.length < plan.titles; pass += 1) {
    const pool = candidates
      .filter((c) => !usedTitles.has(c.id))
      // One title per seat per pass, and nobody starts pass N+1 before everyone
      // who can has finished pass N.
      .filter((c) => (held.get(c.playerId) ?? 0) === pass && pass < capFor(c.playerId))
      .sort((a, b) => b.score - a.score
        || (placing.get(b.playerId) ?? 0) - (placing.get(a.playerId) ?? 0));
    let awardedThisPass = 0;
    const takenThisPass = new Set();
    for (const c of pool) {
      if (awarded.length >= plan.titles) break;
      if (usedTitles.has(c.id) || takenThisPass.has(c.playerId)) continue;
      const { score, ...honour } = c;
      awarded.push(honour);
      usedTitles.add(c.id);
      takenThisPass.add(c.playerId);
      held.set(c.playerId, (held.get(c.playerId) ?? 0) + 1);
      awardedThisPass += 1;
    }
    if (awardedThisPass === 0) break;
  }

  // ---- the winner's spare titles ----
  // The cap above hands the SPARE title — the one a room with more titles than
  // seats has left over — to somebody the room has not heard about yet, because
  // the winner already holds the crown, their own screen, and the board's header.
  // It was never meant to leave a **true** title unsaid. Once no other seat can
  // take the next one, the choice is no longer "the winner or someone else" but
  // "the winner or nobody", and a ceremony that stays quiet there is not being
  // fair to anyone, it is just saying less than it knows.
  //
  // Bounded by `perSeatCap`, which is what keeps it from becoming the sweep the cap
  // exists to prevent: at worst the winner ends level with the seats that took two,
  // and at seven-plus seats `perSeatCap` is 1 so nothing is relaxed at all.
  //
  // A duel is the roster where this fires every time (its plan asks for four and
  // the other seat can only ever hold two), which is why it needs no special case
  // of its own.
  while (winnerId && awarded.length < plan.titles && (held.get(winnerId) ?? 0) < perSeatCap) {
    // The invariant, stated rather than assumed: the passes above are exhaustive
    // for the non-winners (each runs until every seat that can hold another has),
    // so this is false by the time we get here. It is cheap, and it means the rule
    // reads as its own sentence instead of a consequence of the loop above.
    const someoneElseCanTake = candidates.some((c) => c.playerId !== winnerId
      && !usedTitles.has(c.id) && (held.get(c.playerId) ?? 0) < perSeatCap);
    if (someoneElseCanTake) break;
    const next = candidates
      .filter((c) => c.playerId === winnerId && !usedTitles.has(c.id))
      .sort((a, b) => b.score - a.score)[0];
    if (!next) break;
    const { score, ...honour } = next;
    awarded.push(honour);
    usedTitles.add(next.id);
    held.set(winnerId, (held.get(winnerId) ?? 0) + 1);
  }

  // ---- the small-room guarantee ----
  const nonWinners = seats.filter((pid) => pid !== winnerId);
  if (nonWinners.length > 0 && nonWinners.length <= 3) {
    const tail = tailCandidates(/** @type {HonourStats} */ (stats), seats);
    for (const pid of nonWinners) {
      if ((held.get(pid) ?? 0) > 0) continue;
      const t = tail.find((c) => c.playerId === pid && !usedTitles.has(c.id));
      if (!t) continue;
      awarded.push(t);
      usedTitles.add(t.id);
      held.set(pid, 1);
    }
  }

  // ---- which of them get a screen ----
  // The highest-scoring titles earn the screens; the ceremony then runs them
  // weakest-first so it builds toward the winner rather than peaking first.
  const byScore = candidates.filter((c) => awarded.some((a) => a.id === c.id && a.playerId === c.playerId));
  const screened = new Set(
    byScore.slice().sort((a, b) => b.score - a.score).slice(0, plan.screens).map((c) => c.id),
  );
  for (const a of awarded) a.screened = screened.has(a.id);

  const scoreOf = (/** @type {Honour} */ a) => {
    const c = byScore.find((x) => x.id === a.id);
    return c ? c.score : -1;
  };
  const screens = awarded.filter((a) => a.screened).sort((a, b) => scoreOf(a) - scoreOf(b));
  const rest = awarded.filter((a) => !a.screened);
  return [...screens, ...rest];
}

/**
 * The one seat that won, or null when nobody did.
 *
 * A tie at the top has no single winner to crown, and a board nobody scored on
 * has none either — an ending that crowned a 0 would be worse than one that
 * crowns nobody. Used for the CAP (the winner may hold one title) and for the
 * crown itself, which is the same question here: unlike the previous design,
 * nobody is excluded from the pool, so there is no second answer to keep.
 *
 * @param {Array<{ playerId: string, score: number }> | null | undefined} board
 * @returns {string | null}
 */
export function soleWinnerId(board) {
  const rows = Array.isArray(board) ? board : [];
  const top = rows[0];
  if (!top || !(top.score > 0)) return null;
  if (rows.length > 1 && rows[1].score === top.score) return null;
  return top.playerId;
}
