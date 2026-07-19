# Flag Party — the live multiplayer show

Working document for the party-game mode. This is a **program feature** with its own
tracker (Now / phases / Done, same conventions as `FEATURE.md`), kept separate so it
doesn't bloat `FEATURE.md`. A fresh agent picking this up should read `CLAUDE.md`, then
this file, then continue the first uncompleted step under `## Now`.

**Branching:** each phase = one branch off `main` + one PR. `git checkout main && git pull`
before `git checkout -b`. Don't auto-merge — Jan merges each PR himself.

## Vocabulary

- **Question** — one prompt: a flag to pick, an outline to name, a "which grows the most
  coffee?". The smallest unit of play.
- **Round** — five questions of a single mode. The unit a drafter picks, the unit the
  standings break follows, the unit that doubles at the end.
- **Game** — a sequence of rounds. Draft length is `players x picksPerPlayer + 1`, where the host
  chooses `picksPerPlayer` from a fixed 1 / 2 / 3 / 4 and the `+1` is the opening Flags round.

**Weird flags, not "others" (2026-07-18).** The non-sovereign picture mode is `flags-weird`
(`party.mode.flagsWeird`), labelled "Weird flags" / "Dziwne flagi" to match `variant.weird` and
`deck.weird` in the rest of the app. It was `flags-territories` / "Flags: others" — one feature's
private word for a thing the rest of the site already named. The party icon was already the weird
deck's, so the code half-believed it too.

**Renamed 2026-07-18.** These two used to be called *round* (one prompt) and *block* (five
of them), which put two different things under the word "round" and made the progress pill
("Block 1/2 · Round 3/10") unreadable. Everything moved down one: block → round, round →
question. **Entries below this line written before that date use the old words** — read
"block" as today's round and "round" as today's question. Stable string ids on the wire
(`flagPick`, `superlative-coffee`) were deliberately left alone.

---

## The idea

It's **not three games — it's one party show with swappable questions.** Jackbox/Kahoot,
but for flags. The mini-games (flag-pick, map, superlative, find-the-match) are *questions*;
the real product is the **shared scoreboard** that runs across them.

This reframing is load-bearing:

- **"One game or three?"** → one show, questions are plug-ins. Ship one question first; add
  questions over time without touching the show engine.
- **"Solo or multiplayer?"** → don't fork the code. **Solo is a 1-seat game.** Every question
  scores on its own (correctness + your own speed + closeness). Multiplayer is the same
  questions with N seats plus a *first-place speed bonus*. Solo = the show with one seat and
  the race bonus off. This is why the superlative question works alone *and* against friends
  from one codebase.

## Player model — own-screen players, TV optional later (decided 2026-07-09)

**Every device is a full player: it shows the question *and* takes the answer.** Two people
grab two phones and play — no TV, no second screen required. Solo is the same thing with one
device. This is the foundation.

The key realization: the server broadcasts the **same** question to every connection
(`{ prompt, options }`, answer withheld). "Two phones" vs "shared TV + buzzers" differ only
in **whether a device draws the flags or just draws buttons** — a client-side role, not a
different engine. So three roles fall out of one architecture, and we never have to marry a
model:

- **Full player** — shows the question and takes input (a phone on its own, or a PC). *This
  is the base, and all of iteration 1.*
- **Display** — shows the question, takes no input (the optional TV). *Next option, below.*
- **Buzzer** — shows buttons only, pairs with a Display (the Jackbox phone). *Ships with the
  Display option.*

**Flow (2 phones + solo):**

1. Phone 1 opens `/flagParty/`, taps **Create** → gets a room code + shareable link + QR,
   waits in the lobby.
2. Phone 2 opens the link (or enters the code) → joins the lobby. **No name-entry step** —
   the nickname is read from the existing profile (`gridgame.nickname` via
   `flags/nickname.js`, with the deterministic default when unset).
3. Either player starts (solo: start with one seat, first-place bonus off).
4. Each question: **both phones show** the prompt + 4 flags. Both tap. The server orders the
   buzzes and reveals the answer + points on both. On reveal each player sees **everyone's
   pick** (the "oh, we both said France" moment) plus the updated scoreboard.
5. After 5 questions: final board on both. Play again.

Why own-screen first, not Jackbox: no TV dependency, solo falls out for free, 2-player is
the main case, and it's **one player page** instead of a host page *plus* a controller page.

## Ship-dark behind `?test` (decided 2026-07-09, launched 2026-07-10)

The mode first shipped dark: a 5th tile was added to the home grid, rendered `hidden`, and
revealed by `bootHome()` only when the URL carried `?test`
(`new URLSearchParams(location.search).has('test')`). That let us dogfood on the real site
(real PartyKit, real phones) without exposing a half-built mode to visitors.

**Launched 2026-07-10.** Flag Party took the "Make a puzzle" (findFlag) slot in the home
grid, and "Make a puzzle" moved to a burger menu entry. The `?test` reveal guard is gone.

---

## What we reuse (already built)

| Piece | Source | Used for |
|---|---|---|
| Room scaffolding: codes, seats, presence, reconnect, broadcast, serialize-to-storage | `flags/onlineRoom.js` + PartyKit (pattern) | The show's room, generalised from 2 roles → N seats |
| Flag-pick question generator (lookalike-aware distractors) | `flags/quiz.js` `pickQuestion(pool, 4)` | The flag-pick question, server-side |
| Find-a-flag-matching-a-rule engine | `flags/findFlag.js` | The find-the-match question |
| Country contour rendering | `flagQuiz/flagMap.js` + `worldMap.svg` | The map question |
| Country data (colors, motifs, continent, statehood) | `flags/countries.json` (269 entries) | Question generation |
| Nickname (default + stored) | `flags/nickname.js`, `gridgame.nickname` | Player name — **no name-entry step** |

**What we genuinely don't have:** quantitative country data (population, area, world-cup
wins, coffee output, border lengths). The **superlative question** ("pick the biggest of these
16") is gated on populating this — the single biggest new-work item in the vision. Tracked
as a data effort when that question comes up (see roadmap); it's independently useful for daily
/ TTT, so it pays off beyond the show.

## Architecture

- **A dedicated PartyKit party.** Register a new party in `partykit.json`
  (`parties: { ..., party: "party/partyGameServer.js" }`) so show rooms live in their own
  namespace, fully separate from TTT. Server file is thin (mirrors `party/server.js`).
- **Pure room logic in `flags/`, tested.** `flags/partyRoom.js` owns create / join (N seats,
  host seat) / start-question / record-buzz / reveal / tally / next-question / final — same
  "pure module + `*.test.js`" split as `onlineRoom.js`. The server file is a shell.
- **Question contract (the plug-in point):**
  ```
  {
    id: 'flagPick',
    generate(pool, rng) -> { prompt, options[], answer },  // answer stays server-side
    isCorrect(question, buzz) -> boolean,
  }
  ```
  `generate` produces what the players need; the **answer is never sent to clients** — the
  server holds it and only reveals after the question. `options` render in a fixed order so
  every player's flag N is the same flag. Adding a question = adding one module that satisfies
  this contract. Rendering lives in the page layer.
- **Buzz-order is authoritative, for free.** PartyKit processes a room's messages serially
  in the Durable Object, so the order the server *receives* correct buzzes IS "who was
  first" — no client clocks, no timestamp trust (same property TTT uses for turns).
- **Reveal carries every player's pick.** The reveal broadcast includes what each seat
  chose, so clients can show "you / them" side by side, not just a private right/wrong.
- **Scoring in `flags/partyScore.js`, pure + tested.** v1: correct = +10; first correct
  = +5 decaying (2nd +3, 3rd +1, rest +0); wrong = 0. Solo: correctness only, no first-bonus.

---

## Roadmap

Two independent axes: **questions** (content) and **surfaces** (how people connect). Ship
along both incrementally.

### Questions (each reuses an engine except superlative, which needs data first)

| # | Question | Reuses | New data? | Solo-scorable |
|---|---|---|---|---|
| **1** | **Flag pick** (which flag is X? — 1 of 4, race) | `quiz.js` | no | ✅ |
| 2 | **Find-the-match** (buzz a flag matching a rule; obscure-pick bonus) | `findFlag.js` | no | ✅ |
| 3 | **Map: name the contour** | `flagMap.js` | no | ✅ |
| 4 | **Superlative** (biggest / most-coffee of 16; closeness score) | new UI | **yes — blocker** | ✅ |
| — | **Neighbours** (who borders X?) | — | borders list | ✅ |

Order rationale: questions 1–3 need **no new data** and each reuses an engine. The superlative
question is the soul of the idea but gated on data population, so it lands after the show engine
is proven and the free questions are in.

### Surfaces

- **Own-screen full players** — *iteration 1.* Solo, 2 phones, N phones. No TV.
- **TV / shared-screen display (next option).** Add a **Display** role: open `/flagParty/`
  on a TV/PC and it renders the room's question + live scoreboard without playing, so a
  roomful of people can look up at one screen while their phones become trimmed **Buzzers**
  (buttons only). Cheap to add because the server already broadcasts the full question to
  every connection — it's a new client role, not a protocol change. This is the Jackbox
  layer, added on top once own-screen play works.

## Now

**Iterations 8 (rounds, #950) and 9 (the draft, #951) are SHIPPED on `main`**, along with the
final-round polish (#952) and the pick-screen polish (#953). The **round title card** (the deferred
"full next-round card") is **BUILT on `feat/party-round-title-card`**, verified end-to-end in-browser
(both the drafted and the custom paths), pending a PR + Jan's merge — see its entry below.

Shipped and on `main`: the show engine, three question types (flag-pick, map, superlative), the clock,
the veil, the rounds + standings break (#950), the draft (#951), the double-points final round (#952),
and the pick-screen polish (#953). Since then (2026-07-18): draft length is set as rounds-per-player
(#961, #964), the final round no longer veils itself (#961, #962), the block/round/question vocabulary
was renamed (#963), the world-facts name reveal became a fixed 3 s instead of a host-configured
fraction (#965), the picker can veil their own round (#971), and **Custom setup was retired — the
draft is the only way a game starts** (Iteration 10 below).

**BUILT on `feat/party-break-polish`** (pending PR + Jan's merge): the between-rounds beat reads as
one continuous moment instead of three unrelated screens — the standings arrive as a **ledger** that
counts up from the previous round's totals, each row wears its **round gain**, and the board **stays
on screen under the draft pick** instead of a watcher getting a lone avatar for up to 45 s. See
Iteration 11 below.

Still open:

- **Iteration 12 — the playability + UX pass (IN PROGRESS, 2 of 6 phases shipped).** Written to be
  picked up by a fresh agent one phase at a time. It opened with a measured fairness bug: the
  double-points round that decides the game was chosen by whoever was *leading* 85% of the time,
  because loser's-pick pushes the leader to the back of the rotation. That is fixed — the closing
  round is now **the Decider**, a separate act outside the rotation picked by last place. Phase 3
  (one shared screen transition) is next. See the entry below.
- **TV / Display + Buzzer surface**, the Jackbox layer (see Surfaces above).
- Loose ends under **Open decisions** (QR in the lobby, max-seat cap).

Reading the history below: it's a time-ordered journal, so the current design of anything is
the **newest** entry that mentions it. Earlier numbers (e.g. Iteration 2's `DEFAULT_PLAN`
shape) are superseded by later ones.

## Iteration 1 — the show skeleton with one question (flag-pick), own-screen — SHIPPED (branch `feat/flag-party-iter1`)

Goal: a genuinely playable flag question on two phones (and solo), exercising the **entire**
engine so questions 2–4 and the TV surface are pure additions afterward.

- [x] **Home tile, ship-dark.** 5th `.game-tile` in `index.html` → `flagParty/`, `hidden`
      by default; `bootHome()` reveals it when `?test` is present. `tile.party` i18n key.
      (Launched 2026-07-10: took the findFlag tile slot; `?test` guard removed.)
- [x] **PartyKit party + pure room module.** Registered `party` in `partykit.json`;
      `party/partyGameServer.js` (thin) + `flags/partyRoom.js` (pure: seats, host, start,
      buzz-order, reveal-with-all-picks, tally, next, final, play-again→lobby) + tests.
- [x] **Question contract + flag-pick question.** `flags/partyQuestions/flagPick.js` (`generate` via
      `pickQuestion` + `isCorrect`), tested. `flags/partyScore.js` (decaying speed bonus,
      off in solo), tested. `flags/partyClient.js` (client reducer), tested.
- [x] **Shared lobby helpers promoted** to `flags/roomNet.js` (code + WS URL), re-exported
      from `ticTacToe/onlineClient.js`; tests moved to `flags/roomNet.test.js`.
- [x] **Player page** (`flagParty/index.html` + `page.js` + `index.css`) — one page for
      create + join: Create → lobby (code + invite link + roster) or Join via `?room=CODE`
      → Start → per-question (prompt + 4 flags, tap, locked-in) → reveal (correct flag +
      everyone's pick + points + scoreboard) → final board → Play again. Nickname from
      `gridgame.nickname`. en + pl i18n (`party.*`).
- [x] `npm run validate` green + end-to-end verified in-browser (solo run through 5 questions).

**Bugs the end-to-end verify caught** (unit tests alone missed both): (1) *Play again* left the
client stuck on the final board — the server only broadcast `roster`, which carries no phase;
fixed with a dedicated `lobby` message the client acts on. (2) All phase sections stacked on
screen at once — `.party section { display: flex }` outweighed the UA `[hidden]` rule; fixed
with `.party section[hidden] { display: none }`. Both now pinned (unit test + the CSS rule's
own comment).

**Deferred from iteration 1** (deviations from the mockup, deliberately): the **QR code** in
the lobby — v1 ships the room code + an invite-link/share button (a 5-letter code is fine to
read aloud in the same room); QR is a fast follow. Also: questions 2–4, the TV/Display surface,
quantitative data, persisted scores / leaderboards (the show is ephemeral), more than one
question *type*, spectators.

**Confirmed UI decisions (2026-07-09, from the mockup):** A — flags on the phone in a 2×2
grid; B — correct = secondary (pink) ring + check, wrong = dimmed, no green/red (on the seven
palette colours); C — reveal shows everyone's pick (avatar on the chosen flag); D — first
correct tagged "⚡ Fastest", full scoreboard only on reveal/final. Name: **Flag Party**
(folder `flagParty/`; pl tile "Flagowa impreza").

## Iteration 2 — sovereign + non-sovereign segments — SHIPPED (branch `feat/party-nonsovereign-mode`)

One game is now **10 questions: 5 sovereign flag-pick, then 5 non-sovereign flag-pick**, same
mechanic, pool swaps at question 6. Settings page (host picks modes + questions-per-mode) is still
future; this hardcodes the default plan.

- `flags/partyPlan.js` — the game plan as **data**: `DEFAULT_PLAN = [{sovereign,5},{nonSovereign,5}]`
  + `totalQuestions` + `poolIdAt`. This is the seed of the settings page — it will just
  edit this array. Tested.
- `flags/flagPools.js` — `sovereignPool` (195) and `nonSovereignPool` (54). The non-sovereign
  pool is territories + quasi-states + subnational regions (Jan's "everything non-sovereign",
  2026-07-09), with orgs dropped (`category === 'country'`) and **parent-flag duplicates**
  excluded via `SHARED_PARENT_FLAG` — the flags that read as their parent's (French tricolor
  territories, Svalbard/Bouvet = Norway, US Minor Outlying = US flag, Heard & McDonald =
  Australia's flag). Verified by eye against the SVGs, not just `quiz.js` LOOKALIKES (which
  omits Heard and US Minor Outlying). Pinned by a test so a broken "which flag is Mayotte →
  French tricolor" question can't slip in.
- `flagPick.generate(pool, exclude)` — takes a used-answer set so a game doesn't repeat a
  country; the server tracks `usedCodes`, reset on start / play-again.
- Server maps `poolId → pool` and generates each question from the right one.

Verified end-to-end: question 1 = a sovereign flag, question 6 = "which flag is Norfolk Island?"
with all-non-sovereign distinct options. `npm run validate` green.

## Iteration 3 — the clock: countdown + hands-free transitions — SHIPPED (branch `feat/party-question-clock`)

The core loop now *feels* like a race, and it advances on its own — **no host button to press.**

- `flags/partyTiming.js` (pure + tested) — the show's pace as data + arithmetic:
  `QUESTION_SECONDS = 15`, `REVEAL_SECONDS = 6`, plus `secondsLeft` (ceil + clamp, so it
  reads the full duration on a fresh deadline and only hits 0 at true expiry) and
  `remainingFraction` (clamped [0,1] for the shrinking bar).
- **Every client renders a countdown bar**; the **host's timer is authoritative** for the
  transition (matching how the room already treats the host as the only seat that can
  start / advance). When a question's clock runs out the host sends `reveal`; when a reveal
  has lingered the host sends `next`. Both messages are ignored by the reducer if the phase
  already moved on, so the existing all-present-buzzed auto-reveal races safely against the
  timer.
- **The "Next question" button is gone.** After a reveal lingers `REVEAL_SECONDS` the next
  question starts by itself; the bar shows "next question in N" (`party.nextIn`, replaced the now
  dead `party.nextRound`). The last question's reveal auto-advances to the final board the same
  way.
- **The room reducer did not change** — timing lives on the page by design; the room stays
  time-free and only knows "reveal now" / "next now" (`applyForceReveal` / `applyNext`,
  already present). No wire-protocol change either: clients import the durations directly.

**Known limitation (documented, not yet fixed):** the pace depends on the **host's tab
staying awake**. If the host disconnects mid-question the room can stall at a reveal (a
non-host has no authority to send `next`). Two future fixes, both out of scope here:
server-side PartyKit **alarms** driving the transitions (robust, survives any tab), or
**host migration** on disconnect. Also cosmetic: a player who *reconnects* mid-question
starts a fresh full-length bar rather than the real remaining time — the host's
authoritative reveal still corrects them on schedule.

## Iteration 4 — Question 2: the Map question (own-screen) — SHIPPED (branch `feat/party-map-question`)

Goal: the **second question type** ("which outline is X?"), which is what turns this from "a
flag quiz with a scoreboard" into the swappable-question *show* the vision describes. The server
stops hardwiring flag-pick and starts **picking question modules from the plan**. It's the
**mirror of flag-pick**: identical data shape, same 2×2 grid, same buzz-order + scoring — only
the tiles render country **contours** instead of flags.

**The plan (the default game becomes 11 questions):** 3 sovereign flag-pick → 3 non-sovereign
flag-pick → 5 map (sovereign pool). Nice arc: familiar flags, harder flags, then a mode switch
to shapes for the finale. A future host-picks-modes settings page will edit this; for now it's
the hardcoded default in `flags/partyPlan.js`.

**Decisions (2026-07-10):**

- **One module per question type.** Question modules live in `flags/partyQuestions/<id>.js` (the existing
  `flagPick.js` pattern), each satisfying the `{ generate, isCorrect }` contract, wired through a
  small `QUESTIONS` registry in the server. Adding a mode = one new file + one registry line, nothing
  else touched. Chosen deliberately because the mode set will keep growing (superlative, neighbours,
  find-the-match, …).
- **Contours are pre-generated assets, not runtime-rendered.** Each country gets a normalized,
  tile-ready silhouette at `flags/contours/<code>.svg`, so the map question renders
  `<img src="flags/contours/xx.svg">` — the literal mirror of flag-pick's
  `<img src="flags/svg/xx.svg">`. The client difference between the two questions collapses to
  **"swap the folder"**: same grid, same lazy-load, same CDN cache/warm story, and zero runtime
  path-extraction or per-tile bbox math (the cheapest render, scales to N players × 4 tiles for
  free). Pre-generation is also the **curation gate** — we only generate recognizable geometry, so
  the map pool becomes exactly "the set we generated"; microstates (unreadable dots at tile size)
  get no file and never appear.
- **The asset source is decoupled from the client.** Because the client only ever sees
  `contours/xx.svg`, the generator's *input* can change without touching a line of question code.
  Start from `flagQuiz/worldMap.svg` — its detail is already proven, since flagQuiz's map game
  recognizes countries by that same geometry — and if tile-size detail disappoints, regenerate from
  Natural Earth 1:50m with the client unchanged. **Gate: sample ~6 contours (easy / medium /
  small) at tile size and eyeball them before mass-generating.**
- **Per-question hint.** A small label above the grid — "Which flag is X?" vs "Which outline is X?"
  — so players know which they're tapping. New `party.*` i18n (en + pl).

**Build steps:**

- [x] **Sample + lock the source.** Sampled contours (easy / medium / small) from `worldMap.svg`
      at tile size — detail is plenty, **worldMap wins**, no Natural Earth needed.
- [x] **Contour asset set + generator.** `scripts/generate-contours.mjs` emits `flags/contours/<code>.svg`
      (mainland-clustered, square padded viewBox) for every sovereign code with usable geometry.
      **157 contours** define the map pool (`flags/contourPool.js`); ru / fj / sb hand-excluded,
      microstates size-gated. Assets + generator + `contourPool.test.js` checked in.
- [x] **Question registry + plan generalization.** `flags/partyPlan.js`: segments gained `questionId` +
      `questionIdAt`; `DEFAULT_PLAN` → the 3 / 3 / 5 split. `party/partyGameServer.js`: a
      `QUESTIONS` registry keyed by each module's `id`, picked via `questionIdAt`; the broadcast
      question carries `questionId` (stamped server-side). `flags/partyClient.js` threads it through. Tested.
- [x] **`flags/partyQuestions/mapPick.js`** (+ test) — `generate(pool, exclude, rng)` / `isCorrect`,
      same shape as flag-pick; narrows any pool to `CONTOUR_CODE_SET`, MVP distractors = 4 random
      distinct codes, injectable RNG for deterministic tests.
- [x] **Page rendering.** `flagParty/page.js` branches on `question.questionId`: map renders `.contour`
      `<img>` tiles from `flags/contours/` (the literal "swap the folder" mirror). Locked-in ring,
      reveal pulse, pick-avatars, scoring unchanged. Per-question hint label added (`party.hintFlag` /
      `party.hintMap`, en + pl).
- [x] `npm run validate` green (2180 tests) + **end-to-end verified in-browser** — solo run reached
      question 7 ("Which outline? Panama"), tapped a contour, saw the mirror-of-flag-pick reveal
      (Panama green-pulse, wrong pick pink + avatar, others dimmed).

**Deferred (not this iteration):** shape-similar ("hard") distractors; non-sovereign contours; the
host settings page (still just edits `DEFAULT_PLAN` when it lands); the higher-detail Natural Earth
source (only if the worldMap sampling forces it).

**Perf: contour set halved (done, same PR).** The raw worldMap geometry carried full source
precision (2+ decimals of a viewBox unit) that's sub-pixel at the ~150 px the tiles render —
coastline-heavy outlines were the worst (Canada 147 KB, US 68 KB). The generator now runs every
contour through SVGO's `convertPathData` at 1-decimal precision (a *proper* relative-path
simplification — a naive regex question would drift over a 20k-point path). Set went **874 KB → 382 KB
(avg 5.5 KB → 2.4 KB)**, Canada 147 → 57 KB, US 68 → 26 KB, with no visible change at tile size
(heavy tiles re-eyeballed). Build-time only — `svgo` + `playwright-core` are devDeps of the
generator; the runtime/client never changed, and the code set (`contourPool.js`) is byte-identical.

## Iteration 5 — Question 3: Superlative (population) — SHIPPED (#774)

Goal: the **third question type**, and the first that turns a world *metric* into a question.
"Which of these four flags is the **most** (or **least**) **populous**?" It cashes in what
Feature DD's `flags/metrics/` namespace was built for: the same 2x2 grid, buzz-order, and scoring
as flag-pick, but the answer is decided by population rather than flag identity. Ship it for
population, and every future metric (area, GDP, coffee) reuses the exact same question for free.

**The shape: a third mirror of flag-pick.** Same `{ prompt, options, answer }` contract, same
tap-one-of-four grid, same `isCorrect(q, choice) => choice === q.answer`. Tiles render **flags**
(`flags/svg/<code>.svg`), exactly like flag-pick. That was Jan's call: recognizing the flag is
part of the question, and the reveal names the country so nobody is left guessing. The only genuinely
new code is *how `generate` picks the four* plus a most/least hint.

**Decisions (2026-07-10):**

- **Flags on the tiles, no names until reveal.** On brand (this is a flag game), and it reuses
  flag-pick's tile path verbatim. Draw from the **sovereign pool** only: territories and
  microstates are too obscure to keep this a fair *population* question rather than a
  *do-you-know-this-flag* question.
- **`prompt` carries the direction, not a country.** For flag and map questions `prompt` is the
  target country's code; superlative has no single target, so `prompt` is `'most'` or `'least'`,
  and the client (already branching on `questionId`) reads it to choose the hint. This keeps the
  three-field contract intact with no wire-protocol change. Alternative considered: a fourth
  `direction` field, rejected as contract growth for no gain since the client switches on
  `questionId` anyway.
- **Correctness is guaranteed; spread is the quality knob.** Population values are distinct, so
  there is always a strict max and min, and `answer` is never ambiguous. The real work is avoiding
  *coin-flip* quartets (China 1.41B next to India 1.43B) and *giveaway* quartets (one giant, three
  tiny). `generate` picks four with a guarded gap: the extreme must clear the runner-up by a
  margin, resampling a bounded number of times, then accepting. Pure, with an injectable RNG,
  pinned by a test that every generated question has a strictly correct answer and a runner-up gap
  above threshold.
- **The metric lives inside the question module, server-side.** `superlative.js` builds its own
  `createMetric(population, countries)` at load from JSON imports, the self-contained pattern
  `mapPick.js` uses for `CONTOUR_CODE_SET`. This runs **only on the server** (PartyKit), so the
  browser "fetch JSON, never import" rule does not apply here (that is a client constraint); the
  server already imports `countries.json` with an import attribute. The `QUESTIONS` registry in
  `partyGameServer.js` just gains `superlative` in the `[flagPick, mapPick]` array.
- **Most vs least per question.** A coin-flip on the injectable RNG. Hint label `party.hintMost` /
  `party.hintLeast` (en + pl), matching the existing `party.hintFlag` / `party.hintMap` pattern.
- **Plan slot.** New `PARTY_MODES` entry `{ id: 'superlative-pop', questionId: 'superlative', poolId:
  'sovereign' }`, which makes it selectable in the host setup for free. `DEFAULT_PLAN` gains a
  short superlative finale. Proposed: **3 sovereign flag, 3 non-sovereign flag, 3 map, 2
  superlative, 11 questions total** (arc: familiar flags, harder flags, shapes, then "now, who is
  bigger?"). Exact counts are a one-line tweak Jan can adjust.

**Build steps:**

- [x] **`flags/partyQuestions/superlative.js`** (+ test). `generate(pool, exclude, rng = Math.random)`
      returns `{ prompt: 'most' | 'least', options: code[], answer: code }`: narrows the pool to
      codes that have a population value, picks four with the runner-up-gap guard (`GAP_RATIO = 1.25`),
      flips most/least on the rng. `isCorrect(q, choice) => choice === q.answer`. Builds its own metric
      from `flags/metrics/population.json` via `createMetric(population, [])` (world-scope value
      lookups need no country list). Tests pin: the answer is always the strict, unambiguous extreme
      in the chosen direction, both directions occur, only valued codes appear, output is
      deterministic under a seeded rng, and `exclude` is respected.
- [x] **Registry + plan.** Added `superlative` to `QUESTIONS` in `party/partyGameServer.js`; added the
      `superlative-pop` `PARTY_MODES` entry and a 2-question `DEFAULT_PLAN` finale (now 3 flag / 3
      territory / 3 map / 2 superlative = 11) in `flags/partyPlan.js`. `flags/partyPlan.test.js`
      updated.
- [x] **Page rendering.** `flagParty/page.js` branches on `questionId === 'superlative'`: the hint line
      carries the whole question (`party.hintMost` / `party.hintLeast`), the country name stays blank
      during the question and fills with the winner on reveal (so it can't leak the answer), tiles
      render as flags. Locked-in ring, reveal pulse, wrong-pick name strip + avatars, and scoring are
      the unchanged flag-pick path.
- [x] **i18n.** `party.mode.superlativePop`, `party.modeShort.superlativePop`, `party.hintMost`,
      `party.hintLeast` in `en.json` + `pl.json`. No em dashes in the copy.
- [x] `npm run validate` green (2232 tests) + **end-to-end verified in-browser** (all-population game
      via the host setup): saw both a "least" and a "most" question; on a "least" question picked a wrong
      flag (Cameroon) and the reveal was the exact mirror of flag-pick — the correct flag (Montenegro,
      genuinely the least populous of the four) pulsed, the wrong pick showed its pink ring + name
      strip + avatar, the header filled in "Montenegro", and the toast scored +0. Play-again works.

**Follow-up shipped on the same branch: population numbers on reveal.** On a superlative reveal
every tile now shows a bottom band with its country + population (e.g. "South Sudan 11.5M"), so the
four values read as a ranking — the question's learning payoff. The page fetches
`flags/metrics/population.json` alongside `countries.json` (best-effort: a failed fetch just omits
the band) and formats with the shared `formatValue` from `flags/metricLens.js` (compact: 1.4B /
337M / 552K), so the numbers match flagsdata's metric lens. The band reuses the
`rgba(0,0,0,.7)`-over-SVG idiom of the wrong-pick name strip, but on all four tiles and carrying a
name + value (superlative-only), so the wrong-pick `::after` is suppressed when it's present to
avoid a double band. **Scoring stays binary and untouched** — the numbers give players the
"how close was I" feedback without diverging `partyScore.js` from the other questions. Graded /
closeness scoring remains parked for the future 16-tile closeness question, where it fits cleanly.
Verified in-browser: a "least populous" reveal showed South Sudan 11.5M / Australia 26.7M / UK
68.5M / Germany 83.3M with the correct tile pulsing and +10 scored on a correct pick.

**Deferred (not this iteration):**
- Non-sovereign and continent-scoped superlatives ("most populous in Africa").
- The 16-tile closeness-score version from the long-term vision: a different mechanic that breaks
  the single-pick grid, so it earns its place as its own future question type rather than folding
  into this one.
- Other metrics (area, GDP, coffee): they drop into this same module the day their JSON lands
  under `flags/metrics/`.

## Iteration 6 — Tricky mode (progressive reveal) — SHIPPED (#798)

Goal: a host-chosen difficulty that turns the speed bonus into a real bet. With tricky
mode on, each question tile starts **hidden and clears over the countdown** — grey +
blurred, with six feathered panels covering it — so buzzing early means gambling on
partial detail for the speed points, while waiting for the flag to resolve is safer but
slower. Jan settled the exact look by iterating on an interactive mockup: **grey + blur +
a soft panel wipe**, stacked, with no visible grid between panels.

**The shape: a pure client render treatment.** No scoring, answer, or question-contract
change. The whole feature is one boolean (`tricky`) that rides the `start` message,
is stored on the room, broadcast back on every `question` / `welcome`, and drives a
per-tile veil the page animates off the question clock. Decisions:

- **One global toggle, not per-mode.** A single "Tricky mode" switch in the host lobby
  setup (reusing the shared `.scope-toggle-switch`, persisted to `gridgame.party.tricky`).
  Grey is a no-op on the monochrome map contour anyway, so a per-mode matrix wasn't worth
  the UI. Applies to every question; the clear timing differs by tile type (below).
- **Clear timing is per question type, in `flags/partyTiming.js` as data.** `veilProgress`
  (0 hidden → 1 clear, clamped, unit-tested) reaches full clarity at `veilClearFraction`
  of the question window, then holds clear so a late decider still gets a clean look.
  **Flags clear by 70%** (`FLAG_CLEAR_FRACTION`) — they carry give-away detail, so they
  stay tricky well past the midpoint; **outlines clear by 40%** (`OUTLINE_CLEAR_FRACTION`) —
  a silhouette is already hard and grey does nothing to it. Both Jan's chosen numbers.
- **Driven by `--veil-p` on the grid, via rAF.** The page sets one custom property on the
  (persistent) grid element each frame; CSS reads it for the grey/blur filter and the
  per-panel fade. Setting it on the grid (not the tiles) means a re-render mid-question —
  a late join, a buzz notification rebuilding the tiles — never resets the animation.
  Question phase only; the reveal always paints crisp full-colour tiles.
- **Animates for everyone, incl. reduced-motion (Jan's call).** The veil is gameplay, not
  decoration, and disabling it for a reduced-motion user would hand them a peek advantage
  in a same-room party game, so it is not gated on `prefers-reduced-motion`.
- **The panel look: six feathered patches, no grid.** A 3×2 cover of surface-colour cells
  fades out on a scattered order (`VEIL_ORDER`), and the cover overshoots the tile and is
  itself blurred so panel edges feather into each other — the flag materialises in soft
  patches, and the blur falls outside the tile clip so the border stays clean.

**Build steps:**

- [x] `flags/partyTiming.js` — `FLAG_CLEAR_FRACTION` / `OUTLINE_CLEAR_FRACTION`,
      `veilClearFraction(isOutline)`, `veilProgress(deadline, now, total, clearFrac)` (+ tests).
- [x] `flags/partyRoom.js` — room gains `tricky`; set at `applyStart` (6th arg, coerced),
      stored, serialized, and included in the `question` + `welcome` broadcasts (+ tests).
- [x] `party/partyGameServer.js` — reads `parsed.tricky === true` on `start`, passes it through.
- [x] `flags/partyClient.js` — client state gains `tricky`, adopted from `welcome`/`question` (+ tests).
- [x] `flagParty/page.js` — the host toggle (persisted), the veil markup on question tiles,
      the `--veil-p` rAF loop.
- [x] `flagParty/index.css` — veil styles (grey+blur on `.flag`/`.contour`, feathered panel
      cover), all on the seven palette vars.
- [x] `i18n/en.json` + `pl.json` — `party.tricky` + `party.trickyHint`, en + pl, no em dashes.
- [x] `npm run validate` green for the touched modules (66 tests) + typecheck clean.
- [ ] End-to-end in-browser verify (blocked on a shared Playwright browser during parallel work).

**Deferred (folded into Iteration 6b below):** making the clear fractions host-configurable.
Still deferred: a preset *dial* (Normal / Tricky / Brutal) and per-effect choices.

## Iteration 6b — Configurable reveal timing — SHIPPED (#801)

Goal: let the host tune how hard tricky mode is, per question category, instead of the fixed
70 / 40 that shipped in Iteration 6. Jan's call: **each of Flags / Map / Metrics picks its
own reveal point from {20, 40, 60, 80}%**, defaulting to **80 / 40 / 20** (flags carry the
most give-away detail so they stay veiled longest; metric questions barely need hiding since
the question is the number, not the flag).

**The shape: config as data, resolved server-side per question.** The three fractions ride
the `start` message next to `tricky` and `plan`, are validated + stored on the room, and the
server stamps the right `clearFrac` on each question from its category. The client just reads
`question.clearFrac` — it never needs to know the category mapping. Decisions:

- **Three categories, not four modes.** The veil only cares flags-vs-outlines-vs-numbers, so
  the two flag modes (all / territories) share one `flag` fraction. `revealCategoryFor(questionId)`
  (`flags/partyTiming.js`) maps `mapPick → map`, `superlative → metric`, else `flag`.
- **A discrete option set, snapped defensively.** `REVEAL_OPTIONS = [0.2, 0.4, 0.6, 0.8]`,
  `DEFAULT_REVEAL = { flag: 0.8, map: 0.4, metric: 0.2 }`. `validateReveal` snaps every wire
  value to the nearest option and fills gaps with the default, so a malformed config can't
  reach the room (mirrors `validatePlan`).
- **Server stamps `clearFrac` per question.** `generateQuestion` resolves the category and
  attaches `clearFrac`; `publicQuestion` passes it through; the veil loop uses it in place of
  the old `veilClearFraction(isOutline)`. Stored `reveal` on the room means questions generated
  after an eviction still stamp the right timing.
- **UI: a compact per-category picker under the toggle.** When Tricky is on, three `<select>`
  rows (Flags / Maps / Population, reusing the `modeShort` labels) appear in the lobby setup,
  each offering 20/40/60/80%. Persisted to `gridgame.party.reveal`. Hidden when tricky is off.

**Build steps:**

- [x] `flags/partyTiming.js` — `REVEAL_OPTIONS`, `DEFAULT_REVEAL`, `revealCategoryFor`,
      `clampReveal`, `validateReveal` (replacing the fixed `FLAG_/OUTLINE_CLEAR_FRACTION`) (+ tests).
- [x] `flags/partyRoom.js` — room gains `reveal`; `applyStart` 7th arg; `publicQuestion` passes
      `clearFrac`; serialized (+ tests).
- [x] `party/partyGameServer.js` — validates `parsed.reveal`, stamps `clearFrac` per question.
- [x] `flags/partyClient.js` — `clearFrac` threaded onto the question (+ test).
- [x] `flagParty/page.js` — the per-category pickers (persisted, shown only when tricky on),
      `reveal` on the start message, veil loop keyed on `question.clearFrac`.
- [x] `flagParty/index.css` — `.gs-reveal` picker styles, on the palette vars.
- [x] `i18n/en.json` + `pl.json` — `party.revealHint` (categories reuse `party.modeShort.*`).
- [x] Touched-module tests green (72) + typecheck clean.
- [ ] End-to-end in-browser verify.

## Iteration 7 — Grouped setup: picture icons + the world-facts family (Option E) — SHIPPED (#822)

Goal: stop the lobby setup growing one tall row per metric. The panel mixed two
different things in one flat list: a **fixed picture trio** (flags / territories /
map) and an **open-ended metric family** (population / area / density, with GDP,
coffee, coastline… coming). Iteration 7 splits them: the picture trio keeps its
per-mode stepper + toggle (now with a little picture icon each), and the metric
family collapses to **one "Guess the extreme" control** with a shared question count
spread across the facts the host enables via **colour chips**. Adding a metric is
now one chip, not one row. Jan's direction across three mockup questions (see the
artifacts linked below): presets later, **Option E custom now**, one shared count,
neutral picture icons, colour on the fact chips.

**The shape: a client-only change — no server or room touch.** This is the
load-bearing decision. The server already generates each question from the plan via
`questionIdAt` and `validatePlan` already accepts any mix of metric segments,
so grouping lives entirely in **how the client turns its setup into a plan**. At
Start the shared world-facts count is dealt into one-question metric segments
(`buildPartyPlan` → `distributeWorldFacts`), producing an ordinary `Segment[]`
the server validates like any other. Nothing in `party/` or `flags/partyRoom.js`
changed.

**Decisions:**

- **`group` on `PARTY_MODES`.** Each mode is tagged `'picture'` or `'metric'`;
  `PICTURE_MODES` / `METRIC_MODES` derive from it. The metric modes stay in the
  catalog (so `validatePlan` still accepts their segments) but the UI renders
  them as one group. Adding a metric = one `group: 'metric'` entry + its question
  module + i18n; the setup grows by one chip.
- **One shared count, dealt at Start (Jan's call over per-metric counts).**
  `distributeWorldFacts(n, enabledIds, rng)` balances the deal (question-robin so
  each fact gets a near-equal share) then shuffles, so 6 questions / 3 facts is
  always 2/2/2 in a random order, 7 is 3/2/2 with a random fact taking the extra.
  Pure + seeded-rng tested. Trade-off accepted: you pick *which* facts play, not
  *how many of each* (that was the price of the group staying one line forever).
- **Colour chips — a DELIBERATE, documented palette exception.** Each metric
  carries its own hue (Population teal `#2f8f9d`, Land area green `#3f8f5b`,
  Density purple `#7b5ea7`) on the chip's ring / label / icon, so a growing fact
  family stays scannable. Sanctioned like the per-tile flag strip: colour is
  **confined to the setup chips** and never reaches a gameplay tile or any other
  surface. New metric = one `[data-metric]` rule in `flagParty/index.css`.
- **Picture icons are real little pictures (Jan's final call).** "Flags:
  countries" shows a country flag thumbnail (France — a clean tricolour; nothing
  keys off which country, swap the code to re-pick); "Flags: others" shows the
  **Jolly Roger** (a flag with no country, on-theme for the non-sovereign pool);
  "Map: outlines" shows the **actual Italy contour asset** (`flags/contours/it.svg`,
  the same silhouette the question renders); the world-facts lead shows a **stat-bar
  chart**. Flag artwork carries its own colours by nature (like every
  `flags/svg/*.svg`); the chart is monochrome. `SETUP_ICONS` holds either an
  `<img>` or inline `<svg>`, sized by class in `index.css`.
- **Naming (Jan's).** "Flags: countries" / "Flags: others" / "Map: outlines";
  the world-facts lead is "Guess the stat" (a metric / statistics framing over
  the earlier "Guess the extreme"). Short labels: Flags / Others / Maps.
- **Default: everything on, ~2 per mode.** A fresh game is 2 flags + 2 others +
  2 map + a 6-question world-facts group (all metrics on, ~2 per metric) = 12 questions.
  `defaultSetup()` sets the facts count to `2 × METRIC_MODES.length` (clamped) so
  "2 of each" holds as metrics are added. This replaces deriving the default from
  `DEFAULT_PLAN` (still the server's malformed-plan fallback, now decoupled).
- **Migration, not a reset.** A returning host's old per-mode plan (`PLAN_KEY`)
  folds once into the new `gridgame.party.setup` shape: picture modes carry over
  1:1, the metric modes' counts sum into the shared count.
- **Guard generalised.** "A game needs questions" now spans both groups: any
  toggle-off that would zero the total (or leave the facts group on with no
  chip) snaps back.

**Build steps:**

- [x] `flags/partyPlan.js` — `group` on `PARTY_MODES`; `PICTURE_MODES` /
      `METRIC_MODES`; `distributeWorldFacts` + `buildPartyPlan` (pure, seeded-rng)
      (+ tests, 25 in the file).
- [x] `flagParty/page.js` — grouped setup UI (sectioned rows, picture icons,
      world-facts lead + colour chips), the new `setupState` shape with load /
      sanitize / migrate / save, `currentPlan()` → `buildPartyPlan`, repaint on
      language switch. `SETUP_ICONS` / `METRIC_ICONS` inline SVGs.
- [x] `flagParty/index.css` — `.gs-sec`, `.gs-ic`, `.gs-chips` / `.gs-chip` with
      the per-metric `--mc` hues (the documented exception round).
- [x] `i18n/en.json` + `pl.json` — new `party.groupPictures`, `party.groupFacts`,
      `party.factsLead` ("Guess the stat"), `party.factsHint`; renamed
      `party.mode.flagsAll` → "Flags: countries", `flagsTerritories` → "Flags:
      others" (short "Others"), en + pl. Chips reuse `party.modeShort.*`. No em dashes.
- [x] `npm run validate` green (2416 tests) + typecheck clean.
- [x] **End-to-end verified in-browser** (fresh-port static serve to beat the SWA
      CLI cache): sections + picture icons render, chips colour-code and toggle,
      the shared count holds while metrics are added, the group toggle drops the
      total, the "needs questions" guard snaps the last mode back on, `buildPartyPlan`
      deals a 2/1/1 split across three facts, the tricky reveal category reads
      "World facts", and the setup persists + re-translates to PL.

**Mockup history (artifacts, for reference):**
- Question 1 (four monochrome layouts): https://claude.ai/code/artifact/577817c4-642f-4132-a4e8-ec1ba15bd949
- Question 2 (five more, colour + illustration): https://claude.ai/code/artifact/3591873b-25e8-4d6b-b320-ad0d41d1b2bf
- Question 3 (the chosen direction: presets + Option E custom): https://claude.ai/code/artifact/ad2cae63-e333-4527-90b9-45d3cf9bce1f

### Future: preset packs (Easy / Default / Advanced) — designed, not built, PROBABLY SUPERSEDED

> **Read Iteration 9 before building this.** Packs exist to answer "give me a good geography game
> in one tap", and **Draft answers it better**: it needs no pack list at all, it starts in one tap,
> and it hands the choosing to the players instead of to a preset. The two overlap almost
> completely. Don't build both without re-deciding which one survives. The design below is kept
> because its reasoning is still good, not because it is queued.

Jan wants presets **on top of** the custom view, not instead of it: most hosts
don't want to tune dials, they want "give me a good geography game" in one tap.
This is parked as the next setup iteration; the design is settled so a future
agent can build it without re-deciding.

- **The entry screen is a short list of named packs**, each a radio-style card:
  **Easy** (flags only, gentle), **Default** (flags, the map, a few facts),
  **Advanced** (every mode, every world fact). A **"Custom setup…"** link drops
  into the Iteration 7 dial view for the hosts who do want control. See Question 3's
  artifact (link above) for the exact card layout.
- **A pack is just a named plan.** Selecting one writes into the same
  `setupState` the custom view edits (so Custom always shows what a pack picked,
  and tweaking from there is seamless). No new plan model — a pack is a preset of
  the shape `buildPartyPlan` already consumes.
- **Scales for free.** A new metric joins the relevant packs (Default / Advanced)
  by definition; no per-pack surgery, same as it joins the custom chips.
- **Colour is safe here.** It lives on the pack badge (an emoji / tinted tile),
  not on any gameplay surface, so it composes with the confined-to-setup rule.
- **Open sub-question for build time:** whether packs and Custom are two tabs, or
  packs are the default with Custom as a disclosure below them (Question 3 drew the
  latter). Decide when building; both fit the same `setupState` plumbing.

## Iteration 10 — Retire Custom setup: the draft is the game — SHIPPED (2026-07-18)

Iteration 9 put two doors in the lobby: **Draft** (default) and **Custom setup** (Iteration 8's
host-built panel). Draft won. Custom setup was the thing nobody was going to pick — it asked a host
to build a whole show before anyone could play, and its panel was most of the lobby's UI and roughly
a third of `flagParty/page.js`. Keeping a mode alive "just in case" is what made the lobby awkward:
two doors to explain, a panel to hide and show, and a second start path on the server.

So the door picker, the panel, and the setlist start path are gone. The lobby is now the room code,
the players, one **"Rounds each player picks"** row, and Start.

**What went**

- **The lobby**: both `.mode-door`s and the `.party-mode` wrapper, the `<details class="game-setup">`
  panel and every `.gs-*` control (mode toggles, metric chips, reveal rows) — ~125 lines of CSS,
  ~340 lines of JS (`buildSetup` / `updateSetup` / `sanitizeSetup` / `migrateModeState` / the
  setup persistence), and 12 i18n keys x 2 languages. The draft door's own copy went too: with one
  mode left there is no door to label.
- **The wire**: `start` no longer carries `plan`, `tricky`, or `reveal` — only `picks`. The server's
  setlist branch, `validatePlan`, `buildPartyPlan`, `validateReveal` / `clampReveal` /
  `REVEAL_OPTIONS`, and the `MAX_*_QUESTIONS` caps are all deleted. Nothing untrusted arrives as a
  plan any more: every segment is server-built (the opening round, then one per pick).
- **Five localStorage keys** (`gridgame.party.{setup,plan,tricky,reveal,mode}`), left unread rather
  than migrated — the draft flow has no use for what they held.

**What stayed, and why**

- **The veil.** It was never really a Custom-mode feature by the end: #971 made it a **per-round
  choice the picker arms** (`segment.veil` -> `room.tricky` for that round only). That is the live,
  in-game version of the idea, and it is untouched.
- **`DEFAULT_REVEAL` `{flag: 0.8, map: 0.4, metric: 0.2}`**, now **fixed rather than host-editable** —
  the same call already made for `NAME_REVEAL_SECONDS` (Iteration 6b's picker, retired in #965). It
  cost three lobby rows, a persisted config, a wire field and a validator to tune a beat no host had
  a reason to touch. *Whether* a round is veiled is still a real choice; only the clear timing is
  settled. This reverses **Iteration 6b** (#801) — that entry stays below as history.
- **`modeShortLabel` / `modeFullLabel` / the mode icons**, which the draft's hand cards and round
  cards use. The icon classes (`mode-thumb` / `mode-contour`) were renamed off the dead `gs-` prefix;
  their sizing comes from `.pick-card-ic img`.

**Verified** end-to-end in-browser: lobby renders with just the length row, a game starts with no plan
on the wire (4 rounds / 20 questions for 1 seat x 3 picks + the opening round), and a picker-veiled
Flags round clears on the fixed schedule (`--veil-p` reaching 1 at ~16 s = 0.8 x the 20 s window).
Net -976 / +81 lines across 11 files; full suite green (2908 tests).

## Iteration 8 — Rounds of five + the break — PLANNED (2026-07-17)

Goal: give the show an **act structure**. A mode stops being a dial from 1 to N and becomes a
**round of 5 questions**; after every round the game stops on a standings screen. Jan's idea:
"maybe adding a mode is adding 5 flags always, and after 5 played questions you would have a score
revealed."

**Why it earns its place.** A mode's identity is currently invisible *during play*. Questions 1 to 3
are flags, 4 to 6 are territories, 7 to 9 are outlines, and nobody perceives a mode switch: they
perceive twelve questions. A titled round plus a standings break turns the switch into an
**announced event** and gives the show a rhythm instead of a flat run at a final board. It also
kills the stepper: Iteration 7 was fighting "the panel grows a row per metric", and a mode that is
simply on or off ends that fight for good.

**The shape: client-only. No server, room, or wire-protocol touch.** Same load-bearing property
Iteration 7 had, and the reason to build this one first.

- `buildPartyPlan` already turns setup state into `Segment[]`; rounds only change the arithmetic
  (every enabled mode contributes `questions: 5`). The server generates from the plan exactly as now.
- **The break needs no model at all.** A round boundary is `questionIndex % ROUND_QUESTIONS === ROUND_QUESTIONS - 1`,
  derivable on the client from data every client already has.
- **The break is a longer reveal, not a new phase.** Timing lives on the page by design
  (Iteration 3): the host's timer is what sends `next`. At a round end the host simply waits
  `ROUND_BREAK_SECONDS` instead of the reveal duration, and every client renders the break instead
  of the reveal. The room stays in `reveal` throughout and never learns rounds exist.

**Decisions:**

- **`ROUND_QUESTIONS = 5`** (Jan's number, and the arithmetic backs it). `QUESTION_SECONDS` is 20, but
  a question auto-reveals once every present seat has buzzed, so a round runs **~50 s** (everyone
  answering fast) to **~115 s** (clock expiring every question). Roughly a minute and a half typical,
  which is the right act length.
- **Steppers are gone.** A mode is on or off; on means 5 questions. No per-row "1 round" label either
  (redundant when a mode is always one round — Jan's call). Length granularity goes from 1 to 5,
  which is the accepted price.
- **Each statistic is its own round (revised 2026-07-17, Jan's call).** The world-facts family is no
  longer one mixed round: every chosen statistic is a 5-question round of that one metric ("five coffee
  questions"). So the mixed deal (`distributeWorldFacts`) is gone, and round count = enabled picture
  modes + enabled statistics. This also lines Setlist up with Iteration 9's draft (both deal
  per-metric rounds) and gives "I pick Coffee" its coherent little quiz. The chips became round
  toggles (no master switch).
- **Default is 3 rounds on, not everything on.** Flags: countries + Map: outlines + one statistic
  (Population). Since each statistic is now its own round, everything-on would be dozens of rounds,
  so the default deliberately picks a single stat to keep the length sane.
- **The break shows:** round MVP ("Best of the round", a second thing to win so a player losing
  overall still has something to hold), standings with **rank deltas versus the previous break** and
  the row movement animated, and the **gap to the leader** on your own row. No timer: the break is a
  beat, not a countdown (same reasoning that removed the reveal's bar under Done).
- **Round 1 has no deltas** (there is no previous break). Accepted, not a bug.
- **Title card between rounds:** round number, the mode's icon, the name, "5 questions". Icons come
  from `flags/deckIcons.js` (`deckIconHtml`) and `flags/metricVisuals.js` (`METRIC_ICONS`,
  `METRIC_HUES`, `METRIC_SHORT`), both already shared modules since #942, so this costs nothing.
- **Known cosmetic gap, accepted:** a player reconnecting *during* a break gets `welcome` with
  `phase: 'reveal'` and paints the reveal, not the break. Same class as Iteration 3's documented
  "reconnect mid-question starts a fresh bar", and it self-corrects on the host's next transition.

**Build steps (BUILT on `feat/party-rounds`, pending PR + Jan's merge):**

- [x] `flags/partyPlan.js` — `ROUND_QUESTIONS`; `buildPartyPlan` emits a 5-question round per enabled
      picture mode **and per enabled statistic** (the mixed `distributeWorldFacts` deal removed);
      `roundCount` / `roundIndexAt` / `isRoundEnd` + the client-callable core
      `isRoundBoundary(index, total)` (pure + tested).
- [x] `flags/partyTiming.js` — `ROUND_BREAK_SECONDS = 6` (+ test).
- [x] `flags/partyBreak.js` (new, pure + tested) — `roundBreak(prevBoard, currBoard)` computes the
      break view (round gain, rank delta, gap-to-leader, MVP) from two scoreboard snapshots. Chosen
      over threading it through the `partyClient` reducer: it's a view calc, not a state transition.
- [x] `flagParty/page.js` — the break (`#pt-break`: MVP banner + standings + rank deltas + gap),
      the during-play **round indicator** in the question pill, the setup panel losing its steppers
      (on/off), the host holding `ROUND_BREAK_SECONDS` before `next`. `prevBreakBoard` staged and
      committed on the next round's first question so a re-render can't zero the deltas.
- [x] `flagParty/index.css` — break + MVP + `.scoreline.you` / `.delta` / `.gap`, on the palette vars.
- [x] `i18n/en.json` + `pl.json` — `roundQuestion` / `afterRound` / `roundMvp` / `standings` / `behind`
      / `roundsLabel` / `oneBlock`, en + pl, no em dashes. Retired `roundsLabel` / `fewer` / `more`.
- [x] **Migration**, not a reset: `sanitizeSetup` / `migrateModeState` fold the stored per-mode
      counts (`gridgame.party.setup`) to on/off (a positive count = on).
- [x] `npm run validate` green (2850 tests) + **end-to-end verified in-browser** (solo, dev stack):
      setup shows 3 rounds with on/off toggles and "1 round" tags, a stale saved setup migrated to
      1 round, the pill reads "Round 1/3 · Question 1/15", the break fired after question 5 with the MVP
      banner + "you"-ring standings, and it auto-advanced into the round-2 map question. 0 console errors.

**Deferred to Iteration 9 (deliberately, decided at build time):**
- **The full title card** ("Next: Coffee" with the mode icon). It needs the *upcoming* round's mode,
  which the client can't know without the plan (the next segment isn't dealt at break time), and
  adding the plan to the wire is the server touch this iteration set out to avoid. Iteration 9's
  draft gives the client that info naturally (the pick names the next round), so the card lands there.
  Iteration 8 conveys round identity with the during-play pill indicator instead.
- ~~**The boundary reveal shows the standings break in place of the question's answer tiles**~~
  **RESOLVED** (the refinement described here was built). A round-boundary reveal now plays the two
  sub-phases this entry proposed: the answer tiles for `revealSecondsFor(clean)`, then the standings
  break — `armRoundBreakAnswer` in `flagParty/page.js` owns the flip. The round's fifth question shows
  its answer like any other. Struck rather than deleted because the entry above is the reasoning that
  produced the fix.

## Iteration 9 — The draft: players pick the rounds — PLANNED (2026-07-17)

Goal: **the host stops configuring the show and the players choose it as they go.** Jan's idea:
"maybe each player is deciding what mode we are playing next?" Today the host picks everything up
front and every other seat is a passenger, which is the actual complaint behind "the host is picking
a game mode and you just see who wins at the end".

**Iterations 8 and 9 are one idea in two halves.** The round structure creates a break; the break
needs a purpose; the pick is the purpose. Without the pick, the break is a pause. With it, the
standings stop being a readout you skim and become **the thing that decides who chooses next**.

**The shape: the first room-reducer change since Iteration 5.** This is the honest cost, and the
line between the two iterations. A break is a *render*, so Iteration 8 keeps it client-side. A pick
is an *input*, so it needs a room phase: the plan can no longer be fixed at `start`, it grows one
segment per pick, and the room has to learn what a round is in order to know when to enter
`picking` instead of dealing the next question. `questionIdAt(plan, i)` already works fine on a
partial plan, so a pick is an append.

**Decisions:**

- **Two doors at start.** **Draft** (default) and **Custom setup** (Iteration 8's panel, behind a
  link). Draft's real win is that it is a **zero-setup game**: today the setup panel is a wall the
  host climbs before anyone plays, and Jackbox's actual trick is that you press one button and you
  are in. This very likely **supersedes the preset-packs design** parked under Iteration 7: packs
  exist to answer "give me a good geography game in one tap", and Draft answers it better. Don't
  build both without re-deciding.
- **Round 1 is always Flags: countries.** This closes Draft's cold-start hole (no scores means no
  last place means no picker) and is the right on-ramp anyway: establish the loop before asking
  anyone to choose.
- **Length = `players x picksPerPlayer + 1` rounds**, where the host picks `picksPerPlayer` from a
  fixed 1 / 2 / 3 / 4. The `+1` is the fixed opener. **Superseded `min(players + 1, 5)` with a host
  override (2026-07-18)** — that dial asked the host for a total, which is the wrong question: "5"
  tells you nothing about what you are in for, and the answer depends on a seat count that is still
  changing while people join. Asking "how many rounds does each of you pick?" is a question the host
  can actually answer, it keeps **"everyone picks exactly the same number of times"** true by
  construction at any seat count (not just 2 to 4), and the lobby shows the resulting total live
  ("4 rounds, 20 questions") so length stays visible without being the thing you dial.
  `MAX_DRAFT_ROUNDS` survives only as a backstop against an absurd room, not as a design cap.
- **Picker = the lowest-ranked player who hasn't picked yet in this rotation.** Not merely "last
  place": with two players, pure loser's-pick can hand *both* picks to the same person, and then one
  of the two never chose anything. The rotation wraps — once everyone has picked, a fresh rotation
  starts — which is now the normal case rather than an edge, since `picksPerPlayer > 1` means several
  rotations. Implemented as "fewest picks so far, lowest rank breaks the tie", **not** as a
  picked/not-picked set: a set wraps once and then feeds every remaining round to the same seat.
- **Why loser's pick over a vote or a seat rotation.** A vote is mushy (the fun of choosing is
  diluted, and ties need a rule); leader-picks snowballs. Loser's pick does three jobs with one rule:
  it is a comeback mechanic, it hands the spotlight to exactly the player who is disengaging, and it
  makes the break load-bearing. It is a **soft rubber-band** that only bends *what you play*, never
  the points, so it never feels unfair the way a handout does. **The live objection, accepted with
  eyes open:** being bad early buys you a pick. The mock's worked example (Zosia last by 16, picks
  Coffee, goes 5/5, takes the lead) exists to make that judgeable rather than arguable.
- **A hand of cards, not a menu of 30.** Drawn from the unused modes: the picture modes plus a
  random draw of the enabled metrics. A list of 30-odd registry metrics is a form, not a party beat.
  (Written as "a hand of 5"; the shipped `HAND_SIZE` is **10** — `flags/partyDraft.js` is the source
  of truth. The principle is "a hand you can read", not the specific number.)
- **Draft deals per-metric rounds** (one 5-question segment), where Setlist deals mixed. "I pick Coffee"
  is a moment; "I pick World facts" is a menu. Both shapes are valid `Segment[]`, so this needs no
  model, no fork, and no server knowledge.
- **No mode twice in a game — except Flags and Weird flags** (`REPEATABLE_MODE_IDS`). The rule keeps
  coverage honest, but applied to Flags it was actively wrong: Flags is the game everyone came to
  play *and* the fixed opener, so the rule retired it before anyone could choose it even once. Weird
  flags is the same game on a different pool. Everything else still plays once. A side effect worth
  keeping: the hand can no longer empty late in a long game, so the picker always has a real choice
  instead of one forced card. (2026-07-18)
- **10 s to pick, random on timeout.**
- **The watcher screen matters as much as the picker's.** With 4 players, 3 of them are watching.
  "Zosia is choosing", with her avatar. It is a spotlight, which is why it is short.
- **The final round is double points.** Loser's pick chooses the terrain for the round that decides
  the game. It *was* also always tricky, on the reasoning that the veil is a global switch most hosts
  never flip, so giving it a guaranteed home made two iterations of work actually run. **Reversed
  (2026-07-18).** Justifying a rule by "it makes our unused feature run" is backwards: the veil
  appeared for the closing round whether or not the host wanted it, and in draft — where the toggle
  is never shown — it arrived out of nowhere. Double points already marks the finale. `veilActive()`
  is now the host's tricky setting and nothing else.
- **Scoring is untouched** (Jan: "your scoring is fine"). See the speed-bonus note under Open
  decisions for why time-decay was considered and parked.

**Build steps (BUILT on `feat/party-draft`, pending PR + Jan's merge):**

- [x] `flags/partyDraft.js` (new, pure + tested) — `roundCountFor(playerCount)`,
      `pickerFor(scoreboard, alreadyPicked)`, `handFor(usedModeIds, rng)`, `isValidPick`, seeded rng.
- [x] `flags/partyRoom.js` — `picking` phase; `pendingPickAfterReveal`, `applyEnterPicking`,
      `applyPick` (appends a round to the growing plan, only the designated picker, stamps
      `draftPick` attribution); draft state serialized; `resetToLobby` clears it (+ 8 tests).
- [x] `party/partyGameServer.js` — draft `start` (opening Flags round, `targetRounds` from the seat
      count); `next` routes to a pick at round boundaries; the `pick` + `forcePick` messages;
      `usedModes` tracked + rebuilt after an eviction; validates the picked mode.
- [x] `flags/partyClient.js` — the `picking` phase, picker vs watcher, `lastPick` attribution (+ 6 tests).
- [x] `flagParty/page.js` — the two doors (draft default, persisted), the pick screen (both points of
      view), the host's 10 s pick clock firing `forcePick`, attribution on the round's first question.
- [x] `flagParty/index.css` — doors + pick cards + pick timer, palette vars; metric hues confined to
      the draft cards, same sanctioned exception as the setup chips.
- [x] `i18n/en.json` + `pl.json` — doors / pick / attribution strings, en + pl, no em dashes.
- [x] `npm run validate` green (2872 tests) + **end-to-end in-browser verified** (solo, fresh-port
      serve to beat the SWA-CLI module cache): doors render with Draft default, draft start deals a
      Flags round, the pick screen shows a 5-card hand (unused picture modes + random stats, metric
      hues on the icons), a manual pick deals the right round (picked Map → contour tiles) with the
      "X's pick" attribution, and the 10 s `forcePick` timeout auto-picks a random card. 0 party-code
      console errors.

**Mock (the design both iterations were settled against):**
https://claude.ai/code/artifact/f2a1acb4-12cb-40c0-831b-075f921afdad

**Reviewed (adversarial correctness pass, 2026-07-17).** No reachable bug: the pick-vs-final
boundary is exact, state resets cleanly between games, and draft fields serialize for reconnect
mid-pick. Fixed one latent gap it found: a null picker at a boundary now falls through to the
ordinary advance instead of freezing the room (defensive — the round-count formula already
guarantees a picker). Two findings accepted, not fixed:
- **A disconnected seat can be handed the pick** (`pickerFor` is lowest-*ranked*, not lowest-*present*,
  per spec). Not a stall: the host's `forcePick` clock resolves it with a random card after 10 s.
- **`usedCodes` isn't rebuilt after a durable-object eviction** (only `usedModes` is) — a general,
  pre-existing server gap (affects setlist too, and the plan doesn't record which countries were
  used), so left alone here. Cosmetic sibling: the "X's pick" attribution card doesn't survive a
  reconnect mid-drafted-round (the round / scores / question all do).

### Final-round polish — double points + always tricky — BUILT on `feat/party-final-round` (pending PR)

The round that decides the game now **scores double and is always played tricky**, so a trailing
player who chose its terrain (draft) or just gets hot at the end can still swing it, and the veil
finally runs by default (draft never shows the tricky toggle). Applies to any **2+-round** game
(draft or setlist); a single-round game has no "final round" (nothing to contrast), so it's exempt.

- `flags/partyPlan.js` — `isFinalRound(index, total)` (false for a single-round game) (+ tested).
- `flags/partyScore.js` — `scoreQuestion`'s `multiplier` (`FINAL_ROUND_MULTIPLIER = 2`) scales base +
  speed bonus; wrong stays 0; defaults to 1 (+ tested).
- `flags/partyRoom.js` — `toReveal` doubles on the final round and rides `doubled` on the reveal (+ tested).
- `flagParty/page.js` — the veil runs on the final round regardless of the host's tricky setting
  (`veilActive()`), and the pill shows a pink "Double points" badge.
- `flagParty/index.css` + i18n — `.pill-double` badge, `party.doublePoints` (en + pl).
- Verified in-browser (solo draft, fresh-port serve): round 2/2 shows the "Double points" badge and
  its tiles veil with tricky off; the doubled scoring is unit-pinned. 2886 tests green.

### Refinements (2026-07-17, Jan) — BUILT on `feat/party-pick-polish` (pending PR)

Three follow-ups on the shipped draft + finale, from Jan playing it:
- **Picker identity is now server-authoritative (bug fix).** Jan (3 players): the designated picker's
  own screen showed a *different* player choosing, while the other two correctly saw the picker. Root
  cause: the client decided "am I the picker" by comparing its own `state.you` to the broadcast
  picker id, which any identity hiccup breaks. Fix: `applyEnterPicking` sends **per-recipient** — the
  picker's connection gets `youPick: true` + the hand, everyone else `youPick: false` and no hand
  (also stops leaking the hand to watchers); `welcome` carries `youPick` for a reconnect mid-pick. The
  client reads `youPick` instead of re-deriving it (with an old-server fallback to the id compare,
  since client + PartyKit deploy independently). Verified end-to-end with two real clients on separate
  origins: the captured picking messages show `youPick:true`+hand to the picker only, `false`+no-hand
  to the watcher. (The clean 3-player + mid-game-reconnect flows were already correct in testing; this
  hardens the one fragile path that produced the symptom.)
- **Statistics questions are never veiled.** The veil is a flag / outline recognition challenge; on a
  "which grows the most coffee?" question the flag is incidental, so hiding it tested the wrong skill
  (and a latent bug meant non-population stats got the *heavy* flag veil timing). `veilActive()` now
  returns false for metric questions, so tricky mode and the always-tricky final round both skip stat
  rounds. Double points still applies to a stat finale — that was never the problem. Stat questions keep
  their own name-reveal for the flag-identity issue.
- **No pick countdown.** Choosing a category isn't a race, so the visible pick timer is gone.
  `PICK_SECONDS` (10 s, visible) became `PICK_TIMEOUT_SECONDS` (45 s, invisible) — a long safety net
  that force-picks *only* a truly absent picker so the room can't hang; a present player picks long
  before it, with no clock on screen.

Still deferred (unchanged): the TV / Display surface; preset packs (probably dead — Draft supersedes,
see Iteration 7's note); per-player hint tokens and double-down, parked with scoring.

### The round title card — SHIPPED (#954), round-1 follow-up on `feat/party-block1-card2`

The deferred "full next-round title card" (a big card, not just the question pill's "X's pick"). A short
**intro beat** (2 s) that plays before the first question of **every round** (Draft and Custom both),
announcing the round: "Round 2 of 3", the mode's icon, its full name, "5 questions", who picked it (Draft
only), and a "Double points" badge on the final round.

**Follow-up (round 1 too, `feat/party-block1-card2`):** #954 shipped the card on rounds 2..N only; the
opener went straight into question 1. Jan flagged a fairness gap — the host clicks Start and is already
looking at the game while the other seats are mid-transition from the lobby, so the host meets question 1's
first flag a beat sooner. The card on **round 1** doubles as the synchronized "get ready" beat: every
seat (host included) holds the same 2 s card, and the question clock starts only after it, so the first
question reveals to everyone at once. `isRoundStart` now returns true at question 0 (`index >= 0`), firing
once per round instead of `roundCount - 1`; the render + `renderRoundCard` already handled the opener
(no pick attribution, generic "Flags" label, not the final round). Verified in-browser: a fresh game
opens on a "Round 1 of 2 · Flags · 5 questions" card before question 1.

**The shape: pure presentation, no server / room / wire touch.** The client already learns the round's
mode from what it holds — `lastPick.modeId` on a drafted round (precise: the exact stat, the exact flag
pool) or the question's `questionId` on a custom round. The one gap is the two flag pools sharing
`questionId: 'flagPick'`, so an *un-picked* flag round is announced generically ("Flags"); every other case
is precise. The beat is a **client-side hold**: the question is already dealt, but the card shows first
and the question + clock + veil start only when the beat ends, so it costs no answer time. Because every
client (host included) holds the same beat, it introduces no clock drift (the host's authoritative
reveal clock simply starts after the card, like everyone else's).

- `flags/partyPlan.js` — `isRoundStart(index, total)` (first question of every round, opener included;
  sibling of `isRoundBoundary`) (+ tested).
- `flags/partyTiming.js` — `ROUND_INTRO_SECONDS = 2` (the beat).
- `flagParty/page.js` — exported `blockModeId(lastPick, questionId)` (which mode to announce; pinned in
  `modeLabels.test.js`); the `#pt-blockcard` render + the `armRoundIntro` hold that gates the question
  behind the beat, re-armed once per round-start.
- `flagParty/index.html` + `index.css` — the `#pt-blockcard` section + card styles (palette vars;
  metric hue on the icon is the same confined-to-setup exception the draft cards use), a fade+rise
  entrance gated on `prefers-reduced-motion`.
- `i18n/en.json` + `pl.json` — `party.roundCardCount`, `party.roundCardQuestions` (en + pl, no em dashes;
  reuses `party.roundPick` / `party.doublePoints`).
- `npm run validate` green (2895 tests) + **end-to-end verified in-browser** (fresh-port serve): a solo
  draft game showed the card at round 2 with the picked mode (metric label + its hue on the icon; then
  the contour icon on a Map pick), the picker attribution, and the "Double points" badge (round 2/2 is
  final); a 3-round Custom game showed the card at round 2 with the questionId-derived mode, **no** picker
  attribution, and **no** double badge (round 2/3 isn't final). 0 party-code console errors.

### Standings movement — the rows rise and fall — BUILT on `feat/party-standings-movement` (pending PR)

Iteration 8 planned "the row movement animated" but only ever shipped the ▲/▼ delta *arrows* — the
rows themselves just appeared in the new order. Jan's ask: when the standings show, **see** one player
climb and another drop, and **drop the arrows** — the motion is the indicator. Now the break board
plays a FLIP: each row starts at the slot it held at the previous break and slides to its new one, so a
climber rises past the players it overtook and the overtaken visibly falls, the two crossing. The
climber gets a lifted `z-index` so it reads as passing over. The ▲/▼ delta arrows are **gone** (a
second numeric cue is redundant once the row physically moves); the gap-to-leader on your own row
stays. Driven by `rankDelta` (places climbed since the last break, already computed + tested in
`flags/partyBreak.js`): rows are uniform height, so one measured stride converts a rank delta to a
pixel offset. Pure decoration, so it's skipped under `prefers-reduced-motion` (unlike the tricky veil,
it carries no gameplay advantage). Once per break (its own token guards render()'s re-runs).

- `flagParty/page.js` — `animateStandingsMovement(nodes, rows)` + the `breakAnimToken` guard; the ▲/▼
  delta-arrow render removed. No new pure logic (the offset is `rankDelta × stride`, and `rankDelta` is
  already unit-tested).
- `flagParty/index.css` — `.scoreline { position: relative }` so the climber's `z-index` lift applies;
  the dead `.scoreline .delta` rules removed with the arrows.
- `npm run validate` green (2895 tests) + **verified in-browser** (two real clients on separate origins,
  an engineered overtake: player B swept round 2 to pass A). Captured the live mid-slide computed
  transforms — climber at `translateY(+58px)` rising, dropper at `translateY(-58px)` falling — and the
  settled break showing B risen to #1 (75) and A dropped to #2 (45, "30 behind"), no arrows. 0
  party-code console errors.

### Fix: a watcher saw their old hand — BUILT on `fix/party-stale-pick-hand` (pending PR)

Jan (draft, 3+ rounds): a player who picked an earlier round kept **seeing that round's card hand**
while watching someone else pick the next round. Root cause was the exact `.party section[hidden]`
trap: `.pick-hand { display: flex }` outweighs the UA `[hidden] { display: none }`, so `renderPick`
setting `pickHand.hidden = true` on the watcher didn't actually hide it — and its cards aren't
cleared between picks, so the picker's own old hand stayed on screen under the "X is choosing" panel.
Fix mirrors the section precedent — a `[hidden] { display: none }` guard for the affected class.
Reproduced + fixed with two real clients: at the second pick the watcher's `#pick-hand` still holds 10
stale cards but now computes `display:none`, and only the watch panel shows.

**Swept the whole bug class, pinned by a test.** Rather than fix only `.pick-hand`, a new
`flagParty/hiddenGuards.test.js` derives the invariant from source: every flagParty element with a
bare-class flex display (index.css) that is toggled via `.hidden` (page.js) MUST have the guard. It
found **six** — `.pick-hand`, `.pick-watch`, `.break-mvp`, `.blockcard-pick` (the pick screen), plus
two genuine latent bugs it turned up: `.question-timer` (the countdown bar leaked into the reveal, which
is meant to show no timer) and `.party-mode` (a guest in the lobby would see the host-only Draft /
Custom doors). All six now guarded; the test fails if any future flex-and-hidden element misses its
guard, so this can't bite a third time (after `.game-tile` in prod and this). Client CSS + test only.

## Open decisions (settle as they come up, not now)

- **Settings page — SHIPPED (#765).** The host game-setup panel in the lobby picks which modes
  play and how many questions each (see the Done entry); `flags/partyPlan.js` is the plan-as-data
  surface it edits. Kept here only as a pointer — no longer an open question.
- **QR in the lobby.** Deferred from iteration 1 (see above) — add a self-contained QR
  generator, or accept code + link.
- **Question count — superseded by Iteration 8.** The per-mode question counts are replaced by
  **rounds of 5**, and the game length becomes `min(players + 1, 5)` rounds (Iteration 9). Kept here
  only as a pointer.
- **Timing per question.** Per-question countdown landed in iteration 3 (`flags/partyTiming.js`,
  host-driven, hands-free advance); question time is `QUESTION_SECONDS = 20`. **Reveal pace is
  decided and deliberately *not* configurable** (see the reveal-pace note under Done): it's keyed on
  correctness, not a dial. If pace ever becomes a setting it should be one overall fast/normal
  feel, not raw per-phase seconds.
- **Speed-bonus curve — settled 2026-07-17: it stays as it is.** Decaying by **rank** among the
  correct answers (+5/+3/+1) in `flags/partyScore.js`. **Time-decay was considered and parked.** The
  case for it was that solo has no clock incentive at all (`applySpeedBonus` is off at one seat, so
  a 1-second answer and a 19-second answer both score a flat 10, which makes the countdown bar
  decoration and leaves tricky mode's "gamble on partial detail" with no stake). That argument
  mostly evaporates now that solo is leaving (see below): with 2+ seats, rank *is* a real race.
  Don't reopen this without a reason that survives the solo point.
- **Solo is leaving Flag Party.** Single-player was already removed once (PR #768, one online path,
  start with 1+), and Jan's direction (2026-07-17) is that **solo geography play belongs to the 60 s
  quiz**, which now has its own decks (`flags/decks.js`, and the icons both features share via
  `flags/deckIcons.js`). Flag Party may disable the 1-seat game outright. Consequence for future
  design: **don't reintroduce solo-specific scoring or a solo-only surface here.** Party is a room.
- **Max seats — SHIPPED.** Hard cap of 20 (`MAX_SEATS` in `flags/partyRoom.js`).
  Not a platform limit (the Durable Object would take far more): a sane bound for
  the phone-only surface (scoreboard + per-tile pick avatars stay readable) plus a
  cheap guard against a scripted flood of connections bloating the serialized
  room. `applyHello` rejects a **new** seat past the cap with reason `room-full`
  (`party.reject.roomFull`, en + pl); **reconnects are always welcomed** (a known
  playerId already holds a seat). Raise it if the TV/Display surface lands.

## Iteration 11 — the between-rounds beat: ledger standings + the board under the pick — BUILT (2026-07-19)

Goal: make the gap between two rounds feel like **one continuous moment** instead of three unrelated
screens. Jan, after playing: "score table appear too quick... maybe when it appears there should be
point accumulating partially from last score? also when a person is picking the next game, others can
still see a dimmed version of the scoreboard? I just feel that gameplay is not smooth."

Both instincts landed on real defects, and two of them were things the code already computed and
threw away. Client-only again: no server, room, or wire-protocol touch.

**What was actually wrong (measured, not guessed):**

- **The board had no arrival.** `showSection('break')` flipped a `hidden` attribute and nothing else —
  rows at final position, scores at final value. The cascade animation Jan was asking for already
  existed (`.scoreline.enter`, 90 ms stagger) but only the **final** board used it.
- **Every player's round gain was computed and discarded.** `roundBreak` returned `roundGain` per row;
  only the MVP's was rendered. So the board could say where you stood but never what just happened.
- **The pick screen was the real dead spot, not the break.** `PICK_TIMEOUT_SECONDS = 45`, and for that
  whole stretch a non-picker saw an avatar and "X is choosing…" — the standings they had just been
  reading, gone. With four players three of them are watching. `state.scoreboard` is in client state
  throughout `picking`, so keeping it cost nothing on the wire.

**Decisions:**

- **The standings play as a ledger, in the order the round happened**: arrive showing the previous
  break's totals → hold → every score counts up at once with its `+N` chip → rows slide into the new
  order → chips retire. Chosen over "cascade in, already correct, counting as they land": that reads
  as decoration on a finished ranking, where the ledger makes an overtake something you *watch*, caused
  by the points rather than coincident with them. The slide is the FLIP that was already there; what's
  new is that the board waits between the two halves.
- **Timings live in `flags/partyTiming.js`** with the rest of the show's clock (`LEDGER_HOLD_MS` 500,
  `LEDGER_COUNT_MS` 700, `LEDGER_SETTLE_MS` 180, `LEDGER_SLIDE_MS` 800). 2180 ms of motion inside a
  6 s break leaves ~3.8 s of stillness, which a test pins. **`ROUND_BREAK_SECONDS` stays 6** — if the
  break ever feels rushed, raise it rather than compressing the animation; reading time is the scarce
  thing.
- **A `+0` chip is never shown.** It's noise on the row of someone who had a bad round, and they know.
- **The picker is spotlit, everyone else recedes** (`opacity: 0.34`). Rows are dimmed *individually*,
  never the container — a child cannot be more opaque than its parent, so a container fade makes
  "keep one row lit" impossible. **Open judgment call for Jan:** your own row dims too, so the
  spotlight is unambiguous but your own score gets quiet. Exempting `.you` is a one-line change.
- **The pick board hides below two players.** A solo game has no standings worth showing.
- **The picker doesn't get the board (Jan, 2026-07-19).** It was briefly shown to everyone. The screen
  exists to give the *waiting* players something to read; the picker already has a decision in front
  of them, and standings under it are one more thing to look past. The empty-screen problem this
  solves was never theirs.
- **`prevScore` is now on `BreakRow`** rather than the client re-deriving `score - roundGain` — those
  differ wherever the gain clamp bites, and the count-up needs the real prior total.
- **A break is identified by being *entered*, not by `state.questionIndex`.** The index changes
  underneath a live break (the `picking` message carries the next one), so an index-keyed guard let a
  second `playLedger` start on top of the first. Survivable when this was only a FLIP — replaying a
  finished slide looks like nothing — but the ledger rewinds scores, so a second run mid-flight made
  the board jump to the final total, snap back to zero, and slide before it finished counting. Now
  `breakBuilt` is cleared in `showSection` and `renderBreak` leaves the DOM alone once built.

**The bug worth remembering: two `function countUp` in one closure.** The ledger's first draft added
its own count-up helper beside the final board's existing one. Function declarations hoist and the
**last one wins**, so every call silently resolved to the other function with a different signature —
`to` received `prevScore`, `durationMs` received the score. Its `if (to <= 0)` guard is exactly why
the first break of a game pinned at `"0"` forever (`prevScore` is 0 at the first break). It presented
as "the animation just doesn't run", with no error anywhere. Unit tests could not have caught it and
neither could a screenshot; it took a DOM trace showing the helper was never entered. The fix is the
CLAUDE.md rule applied literally — same mechanism, same code: **one** generalised
`countUp(node, from, to, durationMs, delayMs, isStale)`, with the final board passing `from = 0`.

**Build steps (BUILT on `feat/party-break-polish`, pending PR + Jan's merge):**

- [x] `flags/partyBreak.js` — `prevScore` on `BreakRow` (+ 3 tests, including that it is *not*
      `score - roundGain` where the clamp bites).
- [x] `flags/partyTiming.js` — the four `LEDGER_*` constants (+ a test that the motion fits inside
      `ROUND_BREAK_SECONDS` with at least a third of the break left still).
- [x] `flagParty/page.js` — `playLedger` (the four beats, cancel-safe via a per-break sequence number);
      the duplicate `countUp` removed and the survivor generalised with `from` + `isStale`;
      `renderPickBoard`; `breakBuilt` replacing the index-keyed animation guard.
- [x] `flagParty/index.html` — `#pick-board`.
- [x] `flagParty/index.css` — `.scoreline .gain` / `.gain.on`, `.pick-board`, `.scoreline.dimmed`,
      `.scoreline.picking`; palette vars only, motion behind `prefers-reduced-motion: no-preference`.
- [x] **No new i18n**: the gain chip is a number (`+15`) and the pick board reuses existing strings.
- [x] `npm run validate` green (2912 tests) + **end-to-end verified in-browser** with **two real
      clients** (`localhost` + `127.0.0.1`, separate localStorage origins so they are genuinely two
      seats). Traced the break at 70 ms resolution: hold to 481 ms at the old totals, count 4 → 8 → 11
      → 13 → 14 → 15 from 553 ms, chips retiring at 1548 ms; the `+0` row correctly wore no chip. The
      watcher's pick screen showed both rows with the picker at `opacity: 1` + pink border and the
      other at `0.34`. 0 console errors.

**Reduced motion:** the whole ledger is skipped — final scores and positions are already correct in
the DOM before it runs — but the gain chips still render statically, because a round's gains are
information, not decoration.

**Deferred (deliberately):**
- **Spectators watching the hand being chosen.** The most exciting option in the mock, and the only
  one needing a server change: the hand is withheld from watchers on purpose in `applyEnterPicking`,
  and live hover state is a new message on a hot path. Revisit once the dimmed board has been played
  with — it may already have fixed the emptiness.
- **The chosen card morphing into the round title card.** Mocked and offered; Jan wasn't sure he
  liked it, so it wasn't built. The hard swap stays.

## Iteration 12 — playability + UX pass — IN PROGRESS (2026-07-19, phases 1-2 shipped)

Goal: the engine, the draft and the rounds all work; what's thin is everything *around* the
questions. A point means the same thing whoever earned it, the round that decides the game is handed
to whoever is already winning, and every screen change is a hard cut. This iteration is the next
layer: **drama, legibility, and fairness where it counts.**

**This is a multi-phase feature written to be picked up by a fresh agent.** Each phase below ships
alone, on its own branch and PR, in the listed order — nothing blocks on a later phase. Read
`CLAUDE.md`, then this entry, then start the first unchecked phase. **Do not bundle phases**; they
were separated because each is independently judgeable by Jan in a real game.

**Mock (all six sections, interactive):**
https://claude.ai/code/artifact/99107bcb-466d-46a5-b056-58723670f8cc

### The finding that drove this: the finale is rigged for the leader

`pickerFor` breaks ties toward the **lowest-ranked** player, which is right for a comeback mechanic
round by round. But it means the leader *loses that tie-break every round* and is pushed to the back
of the rotation — landing them on the last round, which is the double-points round that decides the
game. Simulated over 2000 four-player games, the player who chooses the decider is:

| standing when they pick | share |
|---|---|
| **1st** | **84.6%** |
| 2nd | 13.6% |
| 3rd | 1.8% |
| 4th | 0.1% |

So loser's-pick inverts itself at exactly the moment the stakes double. Jan spotted this from play
("our double round in general would be pick by first player") before it was measured. It is the only
item in this iteration a player could reasonably call *unfair*, which is why it outranks everything
else here even though it costs the most.

### Phase 1 — score breakdown chips (client only) — SHIPPED (#981)

Make the rules that already exist visible, before adding more of them.

- The break board's round gain splits into what earned it — `10×3` base, `⚡9` speed, `🔥5` streak —
  then collapses back to the plain total, reusing the gain-chip fade from Iteration 11.
- Needs `scoreQuestion` to return a **breakdown** (`{ base, speed, bonus }`) alongside the total, and
  the reveal to carry it, so the client isn't re-deriving scoring rules it doesn't own. Keep
  `scoreQuestion`'s current return shape working — the room and tests depend on it.
- Why first: it costs nothing server-side, and every later scoring idea is invisible without it.

### Phase 2 — The Decider (server + client) — SHIPPED (2026-07-19)

The double-points round stops being "the last slot in the rotation" and becomes a **separate closing
act, outside the rotation, picked by whoever is in last place when it starts.**

- Length becomes `players × picksPerPlayer + 2` — the fixed Flags opener and the Decider bookending
  the draft. The lobby's live "N rounds, M questions" must reflect the extra round.
- **Why not just flip the tie-break on the final round** (the one-line fix): it silently breaks the
  promise that *everyone picks the same number of times*, which is the rule that makes the rotation
  legible. Keeping the Decider outside the rotation preserves that promise by construction.
- **Why not let the house deal it** (a mixed "greatest hits" round): defensible, and it removes the
  advantage completely — but it also removes the best moment the rubber band can buy, which is the
  player who is losing choosing the ground the game ends on. Park it as the fallback if last-place's
  pick tests too strong.
- The Decider gets its own title card (`🏁 The Decider`, the picker's name, "double points") rather
  than reusing the round card's numbering, since it is explicitly not round N of N.
- `isFinalRound` / `FINAL_ROUND_MULTIPLIER` already exist; this changes *who picks it* and *where it
  sits in the plan*, not how it scores.

**What shipped:**
- [x] `roundCountFor` is `seats × picks + 2`. The lobby hint moves with it for free (it already
      called the same helper), so a solo one-pick game now reads "3 rounds, 15 questions".
- [x] **Two picker rules, not one.** `pickerFor` is untouched — it is right for the rotation.
      `deciderPickerFor` is a separate export that reads last place off the board and ignores pick
      history entirely, because the Decider spends no rotation slot.
- [x] **One definition of which round is the Decider.** `isDeciderPick(questionIndex, total)` is
      `isFinalRound(questionIndex + 1, total)` — the same rule that doubles the points, asked one
      question ahead. A test walks every question of 2/3/5/8-round games and pins the two to each
      other, so the screen that says "double points" can never name a round that pays single.
- [x] **The rotation promise is kept by construction.** `applyPick` skips `pickedBy` when
      `room.decider`, so choosing the closing act does not count as one of your picks. The server
      test plays a full duo game where one seat wins every round and asserts both halves: the
      rotation still hands out exactly one pick each, and the Decider still goes to last place.
- [x] `decider` rides the room (surviving an eviction mid-pick), both `picking` messages, and
      `welcome`. Unlike the hand it is **not** picker-only — the watcher screen names the closing act
      too. The round card doesn't consume it: once the round is playing it is simply the final round,
      which the client already derives from the question alone.
- [x] Copy: the pick pill becomes "The Decider · Double points" (composed from the existing
      `party.doublePoints` key rather than a near-duplicate string), the picker reads "Your pick, and
      it decides the game", watchers read "{name} chooses The Decider", and the title card's count
      line becomes `🏁 The Decider` instead of "Round N of N". en + pl.
- [x] `npm run validate` green (2948 tests) + **verified in-browser** on a real solo draft: the
      round-2 boundary opened an ordinary "Choosing round 2 of 3" pick, the last boundary opened
      "The Decider · Double points", and taking it dealt a title card reading `🏁 The Decider` /
      "Marek's pick" / "Double points". 0 console errors.

**Needs a PartyKit deploy** — unlike phase 1, this changes the wire (`decider` on `picking`) and the
server's picker selection. See `project_party_stale_client_skew`: a long-open tab predating this
build would still render the Decider pick as an ordinary one.

### Phase 3 — one shared screen transition (client only)

`showSection` flips a `hidden` attribute, so question → reveal → break → pick → round card → question
is six hard cuts a round. Replace with a single `swapSection()` primitive every screen change goes
through: ~120 ms out, ~180 ms in, 6 px lift.

**Do this as one helper, not per-screen tweaks.** The duplicate-`countUp` bug in Iteration 11 is the
cautionary tale: two implementations of one mechanism, and the wrong one silently won.

### Phase 4 — round-start countdown (client only)

After a break and a pick the table has scattered; the first question currently arrives with its clock
already running. The round card grows a **draining ring** over its existing `ROUND_INTRO_SECONDS`,
reusing the question clock's visual language ("ring empty = go") rather than adding a 3-2-1 screen.

A literal 3-2-1 countdown was mocked and rejected as the default: it is loud, and it costs 3 s of
every round. Revisit only if the ring tests too subtle in a noisy room.

### Phase 5 — deeper scoring (server + client)

Only once Phase 1 makes scoring legible, or these are invisible rules again.

- **Streak** — 3 correct in a row `+5`, 5 in a row `+10`. Gives a trailing player something to chase
  that isn't the leader's total.
- **Sole survivor** — the only player correct gets `+5`. Today, knowing the obscure flag alone is
  worth exactly as much as everyone guessing right together.
- **Nobody knew** — all wrong scores nothing, but gets a named beat on the reveal. Purely
  presentational, costs nothing, and a shared groan is a party moment.
- **Explicitly NOT time-decay speed scoring.** It is already parked under Open decisions and should
  stay parked: it punishes reading the question, makes a slow phone a scoring disadvantage, and
  can't be shown as a clean chip. Rank-based speed is legible; continuous decay isn't.

### Phase 6 — the finale as an ending (client + per-game stats)

- **Reveal from the bottom up, winner last**, with a beat between each row. The rows and the count-up
  already exist; this is sequencing, the same shape as Iteration 11's ledger.
- **Awards** after the board — fastest finger, best round, biggest climb — so everyone leaves with
  something, including whoever finished last.
- The awards need per-game stats nobody currently keeps (buzz ranks, per-round gains, rank history).
  Most are derivable from what the client already sees round by round, so it's a tracking job rather
  than a protocol change — but it is the one item here with real groundwork, hence last.

### Open questions for Jan (decide when the phase comes up, not now)

- Does last place picking the Decider feel like a comeback or like a handout? The mock's worked
  example exists to make that judgeable in play rather than arguable in advance.
- Should the Decider's pick be **hidden until the card flips**, so the table doesn't know the terrain
  until it starts? More theatre, but it removes the "oh no, not coffee" groan that is half the fun.
- Do streaks want to survive a round boundary, or reset with the round? Surviving is more dramatic;
  resetting keeps a round self-contained.

## Out of scope (don't sweep in)

- Persistent competitive leaderboards for the show (it's a live party, not a ranked ladder).
- Accounts / auth beyond the existing deviceId + nickname.
- Non-flag domains (movies/books) — the question contract is domain-shaped, but that's the
  long-term-vision hub, not this feature.

## Done

- **Reveal pace — correctness-keyed, no reveal timer.** The reveal used to freeze the bar full
  and count "Next question in Ns" (weird for a sub-2s beat; in solo the digit never even
  decremented). Now the reveal length is keyed on the question, not the room: `isCleanReveal`
  (`flags/partyClient.js`) is true when every *present* player picked the answer, and
  `revealSecondsFor(clean)` returns `CLEAN_REVEAL_SECONDS = 0.9` vs `MISS_REVEAL_SECONDS = 2.5`
  (`flags/partyTiming.js`) — flagQuiz's correct-fast / wrong-slow feel. The reveal shows **no
  timer at all** (a first pass tried a draining bar; a sub-second drain read as a flicker, so it
  was cut — only the question phase has a bar). On a wrong pick, the flag/outline you chose gets
  a country-name strip so you learn what you clicked — the shared `.opt.wrong[data-name]::after`
  rule promoted to `common.css` from flagQuiz. Single-player mode was also removed this question of
  work — Flag Party is one online path, start with 1+ (see PR #768).
- **Host game setup (#765).** The lobby has a host-only, collapsed-by-default panel to choose
  which modes play and how many questions each (`flagParty` `.game-setup`), reusing the site's
  shared toggle switch + stepper rather than any new styling. `flags/partyPlan.js` is the
  plan-as-data surface (`PARTY_MODES`, `DEFAULT_PLAN` = 3 flag / 3 territory / 5 map = 11 questions,
  `planFromModeCounts`, `validatePlan`); the plan rides along on the `start` message and the
  server validates it, falling back to `DEFAULT_PLAN` on anything malformed. This closed the
  long-standing "settings page" open decision.
- **Iteration 4 — the Map question.** Second question type ("Which outline is X?"), the mirror of
  flag-pick: same grid / buzz-order / scoring, tiles render pre-generated country contours
  (`flags/contours/`) instead of flags. Server now picks question modules from the plan via a
  `QUESTIONS` registry (`flagPick` + `mapPick`), not hardwired flag-pick. Default game is 11 questions
  (3 sovereign flag / 3 non-sovereign flag / 5 sovereign map). `flags/partyPlan.js` is the config
  surface the settings page edits (shipped shortly after — see the host-game-setup entry above).
