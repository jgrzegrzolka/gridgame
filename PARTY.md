# Flag Party — the live multiplayer show

Working document for the party-game mode. This is a **program feature** with its own
tracker (Now / phases / Done, same conventions as `FEATURE.md`), kept separate so it
doesn't bloat `FEATURE.md`. A fresh agent picking this up should read `CLAUDE.md`, then
this file, then continue the first uncompleted step under `## Now`.

**Branching:** each phase = one branch off `main` + one PR. `git checkout main && git pull`
before `git checkout -b`. Don't auto-merge — Jan merges each PR himself.

---

## The idea

It's **not three games — it's one party show with swappable rounds.** Jackbox/Kahoot,
but for flags. The mini-games (flag-pick, map, superlative, find-the-match) are *rounds*;
the real product is the **shared scoreboard** that runs across them.

This reframing is load-bearing:

- **"One game or three?"** → one show, rounds are plug-ins. Ship one round first; add
  rounds over time without touching the show engine.
- **"Solo or multiplayer?"** → don't fork the code. **Solo is a 1-seat game.** Every round
  scores on its own (correctness + your own speed + closeness). Multiplayer is the same
  rounds with N seats plus a *first-place speed bonus*. Solo = the show with one seat and
  the race bonus off. This is why the superlative round works alone *and* against friends
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
4. Each round: **both phones show** the prompt + 4 flags. Both tap. The server orders the
   buzzes and reveals the answer + points on both. On reveal each player sees **everyone's
   pick** (the "oh, we both said France" moment) plus the updated scoreboard.
5. After 5 rounds: final board on both. Play again.

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
| Flag-pick question generator (lookalike-aware distractors) | `flags/quiz.js` `pickQuestion(pool, 4)` | The flag-pick round, server-side |
| Find-a-flag-matching-a-rule engine | `flags/findFlag.js` | The find-the-match round |
| Country contour rendering | `flagQuiz/flagMap.js` + `worldMap.svg` | The map round |
| Country data (colors, motifs, continent, statehood) | `flags/countries.json` (269 entries) | Round generation |
| Nickname (default + stored) | `flags/nickname.js`, `gridgame.nickname` | Player name — **no name-entry step** |

**What we genuinely don't have:** quantitative country data (population, area, world-cup
wins, coffee output, border lengths). The **superlative round** ("pick the biggest of these
16") is gated on populating this — the single biggest new-work item in the vision. Tracked
as a data effort when that round comes up (see roadmap); it's independently useful for daily
/ TTT, so it pays off beyond the show.

## Architecture

- **A dedicated PartyKit party.** Register a new party in `partykit.json`
  (`parties: { ..., party: "party/partyGameServer.js" }`) so show rooms live in their own
  namespace, fully separate from TTT. Server file is thin (mirrors `party/server.js`).
- **Pure room logic in `flags/`, tested.** `flags/partyRoom.js` owns create / join (N seats,
  host seat) / start-round / record-buzz / reveal / tally / next-round / final — same
  "pure module + `*.test.js`" split as `onlineRoom.js`. The server file is a shell.
- **Round contract (the plug-in point):**
  ```
  {
    id: 'flagPick',
    generate(pool, rng) -> { prompt, options[], answer },  // answer stays server-side
    isCorrect(question, buzz) -> boolean,
  }
  ```
  `generate` produces what the players need; the **answer is never sent to clients** — the
  server holds it and only reveals after the round. `options` render in a fixed order so
  every player's flag N is the same flag. Adding a round = adding one module that satisfies
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

Two independent axes: **rounds** (content) and **surfaces** (how people connect). Ship
along both incrementally.

### Rounds (each reuses an engine except superlative, which needs data first)

| # | Round | Reuses | New data? | Solo-scorable |
|---|---|---|---|---|
| **1** | **Flag pick** (which flag is X? — 1 of 4, race) | `quiz.js` | no | ✅ |
| 2 | **Find-the-match** (buzz a flag matching a rule; obscure-pick bonus) | `findFlag.js` | no | ✅ |
| 3 | **Map: name the contour** | `flagMap.js` | no | ✅ |
| 4 | **Superlative** (biggest / most-coffee of 16; closeness score) | new UI | **yes — blocker** | ✅ |
| — | **Neighbours** (who borders X?) | — | borders list | ✅ |

Order rationale: rounds 1–3 need **no new data** and each reuses an engine. The superlative
round is the soul of the idea but gated on data population, so it lands after the show engine
is proven and the free rounds are in.

### Surfaces

- **Own-screen full players** — *iteration 1.* Solo, 2 phones, N phones. No TV.
- **TV / shared-screen display (next option).** Add a **Display** role: open `/flagParty/`
  on a TV/PC and it renders the room's question + live scoreboard without playing, so a
  roomful of people can look up at one screen while their phones become trimmed **Buzzers**
  (buttons only). Cheap to add because the server already broadcasts the full question to
  every connection — it's a new client role, not a protocol change. This is the Jackbox
  layer, added on top once own-screen play works.

## Now

**Iterations 8 (blocks, #950) and 9 (the draft, #951) are SHIPPED on `main`**, along with the
final-block polish (#952) and the pick-screen polish (#953). The **block title card** (the deferred
"full next-block card") is **BUILT on `feat/party-block-title-card`**, verified end-to-end in-browser
(both the drafted and the custom paths), pending a PR + Jan's merge — see its entry below.

Shipped and on `main`: the show engine, three round types (flag-pick, map, superlative), the clock,
tricky mode + its configurable reveal timing, the host game-setup panel, the grouped setup, the
blocks + standings break (#950), the draft (#951), the double-points/always-tricky final block (#952),
and the pick-screen polish (#953).

Still open:

- **TV / Display + Buzzer surface**, the Jackbox layer (see Surfaces above).
- Loose ends under **Open decisions** (QR in the lobby, max-seat cap).

Reading the history below: it's a time-ordered journal, so the current design of anything is
the **newest** entry that mentions it. Earlier numbers (e.g. Iteration 2's `DEFAULT_PLAN`
shape) are superseded by later ones.

## Iteration 1 — the show skeleton with one round (flag-pick), own-screen — SHIPPED (branch `feat/flag-party-iter1`)

Goal: a genuinely playable flag round on two phones (and solo), exercising the **entire**
engine so rounds 2–4 and the TV surface are pure additions afterward.

- [x] **Home tile, ship-dark.** 5th `.game-tile` in `index.html` → `flagParty/`, `hidden`
      by default; `bootHome()` reveals it when `?test` is present. `tile.party` i18n key.
      (Launched 2026-07-10: took the findFlag tile slot; `?test` guard removed.)
- [x] **PartyKit party + pure room module.** Registered `party` in `partykit.json`;
      `party/partyGameServer.js` (thin) + `flags/partyRoom.js` (pure: seats, host, start,
      buzz-order, reveal-with-all-picks, tally, next, final, play-again→lobby) + tests.
- [x] **Round contract + flag-pick round.** `flags/partyRounds/flagPick.js` (`generate` via
      `pickQuestion` + `isCorrect`), tested. `flags/partyScore.js` (decaying speed bonus,
      off in solo), tested. `flags/partyClient.js` (client reducer), tested.
- [x] **Shared lobby helpers promoted** to `flags/roomNet.js` (code + WS URL), re-exported
      from `ticTacToe/onlineClient.js`; tests moved to `flags/roomNet.test.js`.
- [x] **Player page** (`flagParty/index.html` + `page.js` + `index.css`) — one page for
      create + join: Create → lobby (code + invite link + roster) or Join via `?room=CODE`
      → Start → per-round (prompt + 4 flags, tap, locked-in) → reveal (correct flag +
      everyone's pick + points + scoreboard) → final board → Play again. Nickname from
      `gridgame.nickname`. en + pl i18n (`party.*`).
- [x] `npm run validate` green + end-to-end verified in-browser (solo run through 5 rounds).

**Bugs the end-to-end verify caught** (unit tests alone missed both): (1) *Play again* left the
client stuck on the final board — the server only broadcast `roster`, which carries no phase;
fixed with a dedicated `lobby` message the client acts on. (2) All phase sections stacked on
screen at once — `.party section { display: flex }` outweighed the UA `[hidden]` rule; fixed
with `.party section[hidden] { display: none }`. Both now pinned (unit test + the CSS rule's
own comment).

**Deferred from iteration 1** (deviations from the mockup, deliberately): the **QR code** in
the lobby — v1 ships the room code + an invite-link/share button (a 5-letter code is fine to
read aloud in the same room); QR is a fast follow. Also: rounds 2–4, the TV/Display surface,
quantitative data, persisted scores / leaderboards (the show is ephemeral), more than one
round *type*, spectators.

**Confirmed UI decisions (2026-07-09, from the mockup):** A — flags on the phone in a 2×2
grid; B — correct = secondary (pink) ring + check, wrong = dimmed, no green/red (on the seven
palette colours); C — reveal shows everyone's pick (avatar on the chosen flag); D — first
correct tagged "⚡ Fastest", full scoreboard only on reveal/final. Name: **Flag Party**
(folder `flagParty/`; pl tile "Flagowa impreza").

## Iteration 2 — sovereign + non-sovereign segments — SHIPPED (branch `feat/party-nonsovereign-mode`)

One game is now **10 rounds: 5 sovereign flag-pick, then 5 non-sovereign flag-pick**, same
mechanic, pool swaps at round 6. Settings page (host picks modes + rounds-per-mode) is still
future; this hardcodes the default plan.

- `flags/partyPlan.js` — the game plan as **data**: `DEFAULT_PLAN = [{sovereign,5},{nonSovereign,5}]`
  + `totalRounds` + `poolIdForRound`. This is the seed of the settings page — it will just
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
- Server maps `poolId → pool` and generates each round from the right one.

Verified end-to-end: round 1 = a sovereign flag, round 6 = "which flag is Norfolk Island?"
with all-non-sovereign distinct options. `npm run validate` green.

## Iteration 3 — the clock: countdown + hands-free transitions — SHIPPED (branch `feat/party-round-clock`)

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
- **The "Next round" button is gone.** After a reveal lingers `REVEAL_SECONDS` the next
  round starts by itself; the bar shows "next round in N" (`party.nextIn`, replaced the now
  dead `party.nextRound`). The last round's reveal auto-advances to the final board the same
  way.
- **The room reducer did not change** — timing lives on the page by design; the room stays
  time-free and only knows "reveal now" / "next now" (`applyForceReveal` / `applyNext`,
  already present). No wire-protocol change either: clients import the durations directly.

**Known limitation (documented, not yet fixed):** the pace depends on the **host's tab
staying awake**. If the host disconnects mid-round the room can stall at a reveal (a
non-host has no authority to send `next`). Two future fixes, both out of scope here:
server-side PartyKit **alarms** driving the transitions (robust, survives any tab), or
**host migration** on disconnect. Also cosmetic: a player who *reconnects* mid-question
starts a fresh full-length bar rather than the real remaining time — the host's
authoritative reveal still corrects them on schedule.

## Iteration 4 — Round 2: the Map round (own-screen) — SHIPPED (branch `feat/party-map-round`)

Goal: the **second round type** ("which outline is X?"), which is what turns this from "a
flag quiz with a scoreboard" into the swappable-round *show* the vision describes. The server
stops hardwiring flag-pick and starts **picking round modules from the plan**. It's the
**mirror of flag-pick**: identical data shape, same 2×2 grid, same buzz-order + scoring — only
the tiles render country **contours** instead of flags.

**The plan (the default game becomes 11 rounds):** 3 sovereign flag-pick → 3 non-sovereign
flag-pick → 5 map (sovereign pool). Nice arc: familiar flags, harder flags, then a mode switch
to shapes for the finale. A future host-picks-modes settings page will edit this; for now it's
the hardcoded default in `flags/partyPlan.js`.

**Decisions (2026-07-10):**

- **One module per round type.** Round modules live in `flags/partyRounds/<id>.js` (the existing
  `flagPick.js` pattern), each satisfying the `{ generate, isCorrect }` contract, wired through a
  small `ROUNDS` registry in the server. Adding a mode = one new file + one registry line, nothing
  else touched. Chosen deliberately because the mode set will keep growing (superlative, neighbours,
  find-the-match, …).
- **Contours are pre-generated assets, not runtime-rendered.** Each country gets a normalized,
  tile-ready silhouette at `flags/contours/<code>.svg`, so the map round renders
  `<img src="flags/contours/xx.svg">` — the literal mirror of flag-pick's
  `<img src="flags/svg/xx.svg">`. The client difference between the two rounds collapses to
  **"swap the folder"**: same grid, same lazy-load, same CDN cache/warm story, and zero runtime
  path-extraction or per-tile bbox math (the cheapest render, scales to N players × 4 tiles for
  free). Pre-generation is also the **curation gate** — we only generate recognizable geometry, so
  the map pool becomes exactly "the set we generated"; microstates (unreadable dots at tile size)
  get no file and never appear.
- **The asset source is decoupled from the client.** Because the client only ever sees
  `contours/xx.svg`, the generator's *input* can change without touching a line of round code.
  Start from `flagQuiz/worldMap.svg` — its detail is already proven, since flagQuiz's map game
  recognizes countries by that same geometry — and if tile-size detail disappoints, regenerate from
  Natural Earth 1:50m with the client unchanged. **Gate: sample ~6 contours (easy / medium /
  small) at tile size and eyeball them before mass-generating.**
- **Per-round hint.** A small label above the grid — "Which flag is X?" vs "Which outline is X?"
  — so players know which they're tapping. New `party.*` i18n (en + pl).

**Build steps:**

- [x] **Sample + lock the source.** Sampled contours (easy / medium / small) from `worldMap.svg`
      at tile size — detail is plenty, **worldMap wins**, no Natural Earth needed.
- [x] **Contour asset set + generator.** `scripts/generate-contours.mjs` emits `flags/contours/<code>.svg`
      (mainland-clustered, square padded viewBox) for every sovereign code with usable geometry.
      **157 contours** define the map pool (`flags/contourPool.js`); ru / fj / sb hand-excluded,
      microstates size-gated. Assets + generator + `contourPool.test.js` checked in.
- [x] **Round registry + plan generalization.** `flags/partyPlan.js`: segments gained `roundId` +
      `roundIdForRound`; `DEFAULT_PLAN` → the 3 / 3 / 5 split. `party/partyGameServer.js`: a
      `ROUNDS` registry keyed by each module's `id`, picked via `roundIdForRound`; the broadcast
      question carries `roundId` (stamped server-side). `flags/partyClient.js` threads it through. Tested.
- [x] **`flags/partyRounds/mapPick.js`** (+ test) — `generate(pool, exclude, rng)` / `isCorrect`,
      same shape as flag-pick; narrows any pool to `CONTOUR_CODE_SET`, MVP distractors = 4 random
      distinct codes, injectable RNG for deterministic tests.
- [x] **Page rendering.** `flagParty/page.js` branches on `question.roundId`: map renders `.contour`
      `<img>` tiles from `flags/contours/` (the literal "swap the folder" mirror). Locked-in ring,
      reveal pulse, pick-avatars, scoring unchanged. Per-round hint label added (`party.hintFlag` /
      `party.hintMap`, en + pl).
- [x] `npm run validate` green (2180 tests) + **end-to-end verified in-browser** — solo run reached
      round 7 ("Which outline? Panama"), tapped a contour, saw the mirror-of-flag-pick reveal
      (Panama green-pulse, wrong pick pink + avatar, others dimmed).

**Deferred (not this iteration):** shape-similar ("hard") distractors; non-sovereign contours; the
host settings page (still just edits `DEFAULT_PLAN` when it lands); the higher-detail Natural Earth
source (only if the worldMap sampling forces it).

**Perf: contour set halved (done, same PR).** The raw worldMap geometry carried full source
precision (2+ decimals of a viewBox unit) that's sub-pixel at the ~150 px the tiles render —
coastline-heavy outlines were the worst (Canada 147 KB, US 68 KB). The generator now runs every
contour through SVGO's `convertPathData` at 1-decimal precision (a *proper* relative-path
simplification — a naive regex round would drift over a 20k-point path). Set went **874 KB → 382 KB
(avg 5.5 KB → 2.4 KB)**, Canada 147 → 57 KB, US 68 → 26 KB, with no visible change at tile size
(heavy tiles re-eyeballed). Build-time only — `svgo` + `playwright-core` are devDeps of the
generator; the runtime/client never changed, and the code set (`contourPool.js`) is byte-identical.

## Iteration 5 — Round 3: Superlative (population) — SHIPPED (#774)

Goal: the **third round type**, and the first that turns a world *metric* into a question.
"Which of these four flags is the **most** (or **least**) **populous**?" It cashes in what
Feature DD's `flags/metrics/` namespace was built for: the same 2x2 grid, buzz-order, and scoring
as flag-pick, but the answer is decided by population rather than flag identity. Ship it for
population, and every future metric (area, GDP, coffee) reuses the exact same round for free.

**The shape: a third mirror of flag-pick.** Same `{ prompt, options, answer }` contract, same
tap-one-of-four grid, same `isCorrect(q, choice) => choice === q.answer`. Tiles render **flags**
(`flags/svg/<code>.svg`), exactly like flag-pick. That was Jan's call: recognizing the flag is
part of the round, and the reveal names the country so nobody is left guessing. The only genuinely
new code is *how `generate` picks the four* plus a most/least hint.

**Decisions (2026-07-10):**

- **Flags on the tiles, no names until reveal.** On brand (this is a flag game), and it reuses
  flag-pick's tile path verbatim. Draw from the **sovereign pool** only: territories and
  microstates are too obscure to keep this a fair *population* question rather than a
  *do-you-know-this-flag* question.
- **`prompt` carries the direction, not a country.** For flag and map rounds `prompt` is the
  target country's code; superlative has no single target, so `prompt` is `'most'` or `'least'`,
  and the client (already branching on `roundId`) reads it to choose the hint. This keeps the
  three-field contract intact with no wire-protocol change. Alternative considered: a fourth
  `direction` field, rejected as contract growth for no gain since the client switches on
  `roundId` anyway.
- **Correctness is guaranteed; spread is the quality knob.** Population values are distinct, so
  there is always a strict max and min, and `answer` is never ambiguous. The real work is avoiding
  *coin-flip* quartets (China 1.41B next to India 1.43B) and *giveaway* quartets (one giant, three
  tiny). `generate` picks four with a guarded gap: the extreme must clear the runner-up by a
  margin, resampling a bounded number of times, then accepting. Pure, with an injectable RNG,
  pinned by a test that every generated question has a strictly correct answer and a runner-up gap
  above threshold.
- **The metric lives inside the round module, server-side.** `superlative.js` builds its own
  `createMetric(population, countries)` at load from JSON imports, the self-contained pattern
  `mapPick.js` uses for `CONTOUR_CODE_SET`. This runs **only on the server** (PartyKit), so the
  browser "fetch JSON, never import" rule does not apply here (that is a client constraint); the
  server already imports `countries.json` with an import attribute. The `ROUNDS` registry in
  `partyGameServer.js` just gains `superlative` in the `[flagPick, mapPick]` array.
- **Most vs least per round.** A coin-flip on the injectable RNG. Hint label `party.hintMost` /
  `party.hintLeast` (en + pl), matching the existing `party.hintFlag` / `party.hintMap` pattern.
- **Plan slot.** New `PARTY_MODES` entry `{ id: 'superlative-pop', roundId: 'superlative', poolId:
  'sovereign' }`, which makes it selectable in the host setup for free. `DEFAULT_PLAN` gains a
  short superlative finale. Proposed: **3 sovereign flag, 3 non-sovereign flag, 3 map, 2
  superlative, 11 rounds total** (arc: familiar flags, harder flags, shapes, then "now, who is
  bigger?"). Exact counts are a one-line tweak Jan can adjust.

**Build steps:**

- [x] **`flags/partyRounds/superlative.js`** (+ test). `generate(pool, exclude, rng = Math.random)`
      returns `{ prompt: 'most' | 'least', options: code[], answer: code }`: narrows the pool to
      codes that have a population value, picks four with the runner-up-gap guard (`GAP_RATIO = 1.25`),
      flips most/least on the rng. `isCorrect(q, choice) => choice === q.answer`. Builds its own metric
      from `flags/metrics/population.json` via `createMetric(population, [])` (world-scope value
      lookups need no country list). Tests pin: the answer is always the strict, unambiguous extreme
      in the chosen direction, both directions occur, only valued codes appear, output is
      deterministic under a seeded rng, and `exclude` is respected.
- [x] **Registry + plan.** Added `superlative` to `ROUNDS` in `party/partyGameServer.js`; added the
      `superlative-pop` `PARTY_MODES` entry and a 2-round `DEFAULT_PLAN` finale (now 3 flag / 3
      territory / 3 map / 2 superlative = 11) in `flags/partyPlan.js`. `flags/partyPlan.test.js`
      updated.
- [x] **Page rendering.** `flagParty/page.js` branches on `roundId === 'superlative'`: the hint line
      carries the whole question (`party.hintMost` / `party.hintLeast`), the country name stays blank
      during the question and fills with the winner on reveal (so it can't leak the answer), tiles
      render as flags. Locked-in ring, reveal pulse, wrong-pick name strip + avatars, and scoring are
      the unchanged flag-pick path.
- [x] **i18n.** `party.mode.superlativePop`, `party.modeShort.superlativePop`, `party.hintMost`,
      `party.hintLeast` in `en.json` + `pl.json`. No em dashes in the copy.
- [x] `npm run validate` green (2232 tests) + **end-to-end verified in-browser** (all-population game
      via the host setup): saw both a "least" and a "most" round; on a "least" round picked a wrong
      flag (Cameroon) and the reveal was the exact mirror of flag-pick — the correct flag (Montenegro,
      genuinely the least populous of the four) pulsed, the wrong pick showed its pink ring + name
      strip + avatar, the header filled in "Montenegro", and the toast scored +0. Play-again works.

**Follow-up shipped on the same branch: population numbers on reveal.** On a superlative reveal
every tile now shows a bottom band with its country + population (e.g. "South Sudan 11.5M"), so the
four values read as a ranking — the round's learning payoff. The page fetches
`flags/metrics/population.json` alongside `countries.json` (best-effort: a failed fetch just omits
the band) and formats with the shared `formatValue` from `flags/metricLens.js` (compact: 1.4B /
337M / 552K), so the numbers match flagsdata's metric lens. The band reuses the
`rgba(0,0,0,.7)`-over-SVG idiom of the wrong-pick name strip, but on all four tiles and carrying a
name + value (superlative-only), so the wrong-pick `::after` is suppressed when it's present to
avoid a double band. **Scoring stays binary and untouched** — the numbers give players the
"how close was I" feedback without diverging `partyScore.js` from the other rounds. Graded /
closeness scoring remains parked for the future 16-tile closeness round, where it fits cleanly.
Verified in-browser: a "least populous" reveal showed South Sudan 11.5M / Australia 26.7M / UK
68.5M / Germany 83.3M with the correct tile pulsing and +10 scored on a correct pick.

**Deferred (not this iteration):**
- Non-sovereign and continent-scoped superlatives ("most populous in Africa").
- The 16-tile closeness-score version from the long-term vision: a different mechanic that breaks
  the single-pick grid, so it earns its place as its own future round type rather than folding
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

**The shape: a pure client render treatment.** No scoring, answer, or round-contract
change. The whole feature is one boolean (`tricky`) that rides the `start` message,
is stored on the room, broadcast back on every `question` / `welcome`, and drives a
per-tile veil the page animates off the question clock. Decisions:

- **One global toggle, not per-mode.** A single "Tricky mode" switch in the host lobby
  setup (reusing the shared `.scope-toggle-switch`, persisted to `gridgame.party.tricky`).
  Grey is a no-op on the monochrome map contour anyway, so a per-mode matrix wasn't worth
  the UI. Applies to every round; the clear timing differs by tile type (below).
- **Clear timing is per round type, in `flags/partyTiming.js` as data.** `veilProgress`
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

Goal: let the host tune how hard tricky mode is, per round category, instead of the fixed
70 / 40 that shipped in Iteration 6. Jan's call: **each of Flags / Map / Metrics picks its
own reveal point from {20, 40, 60, 80}%**, defaulting to **80 / 40 / 20** (flags carry the
most give-away detail so they stay veiled longest; metric rounds barely need hiding since
the question is the number, not the flag).

**The shape: config as data, resolved server-side per question.** The three fractions ride
the `start` message next to `tricky` and `plan`, are validated + stored on the room, and the
server stamps the right `clearFrac` on each question from its category. The client just reads
`question.clearFrac` — it never needs to know the category mapping. Decisions:

- **Three categories, not four modes.** The veil only cares flags-vs-outlines-vs-numbers, so
  the two flag modes (all / territories) share one `flag` fraction. `revealCategoryFor(roundId)`
  (`flags/partyTiming.js`) maps `mapPick → map`, `superlative → metric`, else `flag`.
- **A discrete option set, snapped defensively.** `REVEAL_OPTIONS = [0.2, 0.4, 0.6, 0.8]`,
  `DEFAULT_REVEAL = { flag: 0.8, map: 0.4, metric: 0.2 }`. `validateReveal` snaps every wire
  value to the nearest option and fills gaps with the default, so a malformed config can't
  reach the room (mirrors `validatePlan`).
- **Server stamps `clearFrac` per question.** `generateQuestion` resolves the category and
  attaches `clearFrac`; `publicQuestion` passes it through; the veil loop uses it in place of
  the old `veilClearFraction(isOutline)`. Stored `reveal` on the room means rounds generated
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
family collapses to **one "Guess the extreme" control** with a shared round count
spread across the facts the host enables via **colour chips**. Adding a metric is
now one chip, not one row. Jan's direction across three mockup rounds (see the
artifacts linked below): presets later, **Option E custom now**, one shared count,
neutral picture icons, colour on the fact chips.

**The shape: a client-only change — no server or room touch.** This is the
load-bearing decision. The server already generates each round from the plan via
`roundIdForRound` and `validatePlan` already accepts any mix of metric segments,
so grouping lives entirely in **how the client turns its setup into a plan**. At
Start the shared world-facts count is dealt into one-round metric segments
(`buildPartyPlan` → `distributeWorldFacts`), producing an ordinary `Segment[]`
the server validates like any other. Nothing in `party/` or `flags/partyRoom.js`
changed.

**Decisions:**

- **`group` on `PARTY_MODES`.** Each mode is tagged `'picture'` or `'metric'`;
  `PICTURE_MODES` / `METRIC_MODES` derive from it. The metric modes stay in the
  catalog (so `validatePlan` still accepts their segments) but the UI renders
  them as one group. Adding a metric = one `group: 'metric'` entry + its round
  module + i18n; the setup grows by one chip.
- **One shared count, dealt at Start (Jan's call over per-metric counts).**
  `distributeWorldFacts(n, enabledIds, rng)` balances the deal (round-robin so
  each fact gets a near-equal share) then shuffles, so 6 rounds / 3 facts is
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
  the same silhouette the round renders); the world-facts lead shows a **stat-bar
  chart**. Flag artwork carries its own colours by nature (like every
  `flags/svg/*.svg`); the chart is monochrome. `SETUP_ICONS` holds either an
  `<img>` or inline `<svg>`, sized by class in `index.css`.
- **Naming (Jan's).** "Flags: countries" / "Flags: others" / "Map: outlines";
  the world-facts lead is "Guess the stat" (a metric / statistics framing over
  the earlier "Guess the extreme"). Short labels: Flags / Others / Maps.
- **Default: everything on, ~2 per mode.** A fresh game is 2 flags + 2 others +
  2 map + a 6-round world-facts group (all metrics on, ~2 per metric) = 12 rounds.
  `defaultSetup()` sets the facts count to `2 × METRIC_MODES.length` (clamped) so
  "2 of each" holds as metrics are added. This replaces deriving the default from
  `DEFAULT_PLAN` (still the server's malformed-plan fallback, now decoupled).
- **Migration, not a reset.** A returning host's old per-mode plan (`PLAN_KEY`)
  folds once into the new `gridgame.party.setup` shape: picture modes carry over
  1:1, the metric modes' counts sum into the shared count.
- **Guard generalised.** "A game needs rounds" now spans both groups: any
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
      the per-metric `--mc` hues (the documented exception block).
- [x] `i18n/en.json` + `pl.json` — new `party.groupPictures`, `party.groupFacts`,
      `party.factsLead` ("Guess the stat"), `party.factsHint`; renamed
      `party.mode.flagsAll` → "Flags: countries", `flagsTerritories` → "Flags:
      others" (short "Others"), en + pl. Chips reuse `party.modeShort.*`. No em dashes.
- [x] `npm run validate` green (2416 tests) + typecheck clean.
- [x] **End-to-end verified in-browser** (fresh-port static serve to beat the SWA
      CLI cache): sections + picture icons render, chips colour-code and toggle,
      the shared count holds while metrics are added, the group toggle drops the
      total, the "needs rounds" guard snaps the last mode back on, `buildPartyPlan`
      deals a 2/1/1 split across three facts, the tricky reveal category reads
      "World facts", and the setup persists + re-translates to PL.

**Mockup history (artifacts, for reference):**
- Round 1 (four monochrome layouts): https://claude.ai/code/artifact/577817c4-642f-4132-a4e8-ec1ba15bd949
- Round 2 (five more, colour + illustration): https://claude.ai/code/artifact/3591873b-25e8-4d6b-b320-ad0d41d1b2bf
- Round 3 (the chosen direction: presets + Option E custom): https://claude.ai/code/artifact/ad2cae63-e333-4527-90b9-45d3cf9bce1f

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
  into the Iteration 7 dial view for the hosts who do want control. See Round 3's
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
  packs are the default with Custom as a disclosure below them (Round 3 drew the
  latter). Decide when building; both fit the same `setupState` plumbing.

## Iteration 8 — Blocks of five + the break — PLANNED (2026-07-17)

Goal: give the show an **act structure**. A mode stops being a dial from 1 to N and becomes a
**block of 5 rounds**; after every block the game stops on a standings screen. Jan's idea:
"maybe adding a mode is adding 5 flags always, and after 5 played rounds you would have a score
revealed."

**Why it earns its place.** A mode's identity is currently invisible *during play*. Rounds 1 to 3
are flags, 4 to 6 are territories, 7 to 9 are outlines, and nobody perceives a mode switch: they
perceive twelve questions. A titled block plus a standings break turns the switch into an
**announced event** and gives the show a rhythm instead of a flat run at a final board. It also
kills the stepper: Iteration 7 was fighting "the panel grows a row per metric", and a mode that is
simply on or off ends that fight for good.

**The shape: client-only. No server, room, or wire-protocol touch.** Same load-bearing property
Iteration 7 had, and the reason to build this one first.

- `buildPartyPlan` already turns setup state into `Segment[]`; blocks only change the arithmetic
  (every enabled mode contributes `rounds: 5`). The server generates from the plan exactly as now.
- **The break needs no model at all.** A block boundary is `roundIndex % BLOCK_ROUNDS === BLOCK_ROUNDS - 1`,
  derivable on the client from data every client already has.
- **The break is a longer reveal, not a new phase.** Timing lives on the page by design
  (Iteration 3): the host's timer is what sends `next`. At a block end the host simply waits
  `BLOCK_BREAK_SECONDS` instead of the reveal duration, and every client renders the break instead
  of the reveal. The room stays in `reveal` throughout and never learns blocks exist.

**Decisions:**

- **`BLOCK_ROUNDS = 5`** (Jan's number, and the arithmetic backs it). `QUESTION_SECONDS` is 20, but
  a round auto-reveals once every present seat has buzzed, so a block runs **~50 s** (everyone
  answering fast) to **~115 s** (clock expiring every round). Roughly a minute and a half typical,
  which is the right act length.
- **Steppers are gone.** A mode is on or off; on means 5 rounds. No per-row "1 block" label either
  (redundant when a mode is always one block — Jan's call). Length granularity goes from 1 to 5,
  which is the accepted price.
- **Each statistic is its own block (revised 2026-07-17, Jan's call).** The world-facts family is no
  longer one mixed block: every chosen statistic is a 5-round block of that one metric ("five coffee
  questions"). So the mixed deal (`distributeWorldFacts`) is gone, and block count = enabled picture
  modes + enabled statistics. This also lines Setlist up with Iteration 9's draft (both deal
  per-metric blocks) and gives "I pick Coffee" its coherent little quiz. The chips became block
  toggles (no master switch).
- **Default is 3 blocks on, not everything on.** Flags: countries + Map: outlines + one statistic
  (Population). Since each statistic is now its own block, everything-on would be dozens of blocks,
  so the default deliberately picks a single stat to keep the length sane.
- **The break shows:** block MVP ("Best of the block", a second thing to win so a player losing
  overall still has something to hold), standings with **rank deltas versus the previous break** and
  the row movement animated, and the **gap to the leader** on your own row. No timer: the break is a
  beat, not a countdown (same reasoning that removed the reveal's bar under Done).
- **Block 1 has no deltas** (there is no previous break). Accepted, not a bug.
- **Title card between blocks:** block number, the mode's icon, the name, "5 rounds". Icons come
  from `flags/deckIcons.js` (`deckIconHtml`) and `flags/metricVisuals.js` (`METRIC_ICONS`,
  `METRIC_HUES`, `METRIC_SHORT`), both already shared modules since #942, so this costs nothing.
- **Known cosmetic gap, accepted:** a player reconnecting *during* a break gets `welcome` with
  `phase: 'reveal'` and paints the reveal, not the break. Same class as Iteration 3's documented
  "reconnect mid-question starts a fresh bar", and it self-corrects on the host's next transition.

**Build steps (BUILT on `feat/party-blocks`, pending PR + Jan's merge):**

- [x] `flags/partyPlan.js` — `BLOCK_ROUNDS`; `buildPartyPlan` emits a 5-round block per enabled
      picture mode **and per enabled statistic** (the mixed `distributeWorldFacts` deal removed);
      `blockCount` / `blockIndexForRound` / `isBlockEnd` + the client-callable core
      `isBlockBoundary(index, total)` (pure + tested).
- [x] `flags/partyTiming.js` — `BLOCK_BREAK_SECONDS = 6` (+ test).
- [x] `flags/partyBreak.js` (new, pure + tested) — `blockBreak(prevBoard, currBoard)` computes the
      break view (block gain, rank delta, gap-to-leader, MVP) from two scoreboard snapshots. Chosen
      over threading it through the `partyClient` reducer: it's a view calc, not a state transition.
- [x] `flagParty/page.js` — the break (`#pt-break`: MVP banner + standings + rank deltas + gap),
      the during-play **block indicator** in the round pill, the setup panel losing its steppers
      (on/off), the host holding `BLOCK_BREAK_SECONDS` before `next`. `prevBreakBoard` staged and
      committed on the next block's first question so a re-render can't zero the deltas.
- [x] `flagParty/index.css` — break + MVP + `.scoreline.you` / `.delta` / `.gap`, on the palette vars.
- [x] `i18n/en.json` + `pl.json` — `roundBlock` / `afterBlock` / `blockMvp` / `standings` / `behind`
      / `blocksLabel` / `oneBlock`, en + pl, no em dashes. Retired `roundsLabel` / `fewer` / `more`.
- [x] **Migration**, not a reset: `sanitizeSetup` / `migrateModeState` fold the stored per-mode
      counts (`gridgame.party.setup`) to on/off (a positive count = on).
- [x] `npm run validate` green (2850 tests) + **end-to-end verified in-browser** (solo, dev stack):
      setup shows 3 blocks with on/off toggles and "1 block" tags, a stale saved setup migrated to
      1 block, the pill reads "Block 1/3 · Round 1/15", the break fired after round 5 with the MVP
      banner + "you"-ring standings, and it auto-advanced into the block-2 map round. 0 console errors.

**Deferred to Iteration 9 (deliberately, decided at build time):**
- **The full title card** ("Next: Coffee" with the mode icon). It needs the *upcoming* block's mode,
  which the client can't know without the plan (the next segment isn't dealt at break time), and
  adding the plan to the wire is the server touch this iteration set out to avoid. Iteration 9's
  draft gives the client that info naturally (the pick names the next block), so the card lands there.
  Iteration 8 conveys block identity with the during-play pill indicator instead.
- **The boundary reveal shows the standings break in place of the round's answer tiles** (every 5th
  round's answer isn't shown). Accepted for now as the smallest correct cut and because the standings
  moment is the point of the beat; the alternative (a short answer beat, then the break, as two
  sub-phases of one reveal window) is the obvious refinement if it reads wrong in real play. **Flag
  for Jan's reaction.**

## Iteration 9 — The draft: players pick the blocks — PLANNED (2026-07-17)

Goal: **the host stops configuring the show and the players choose it as they go.** Jan's idea:
"maybe each player is deciding what mode we are playing next?" Today the host picks everything up
front and every other seat is a passenger, which is the actual complaint behind "the host is picking
a game mode and you just see who wins at the end".

**Iterations 8 and 9 are one idea in two halves.** The block structure creates a break; the break
needs a purpose; the pick is the purpose. Without the pick, the break is a pause. With it, the
standings stop being a readout you skim and become **the thing that decides who chooses next**.

**The shape: the first room-reducer change since Iteration 5.** This is the honest cost, and the
line between the two iterations. A break is a *render*, so Iteration 8 keeps it client-side. A pick
is an *input*, so it needs a room phase: the plan can no longer be fixed at `start`, it grows one
segment per pick, and the room has to learn what a block is in order to know when to enter
`picking` instead of dealing the next question. `roundIdForRound(plan, i)` already works fine on a
partial plan, so a pick is an append.

**Decisions:**

- **Two doors at start.** **Draft** (default) and **Custom setup** (Iteration 8's panel, behind a
  link). Draft's real win is that it is a **zero-setup game**: today the setup panel is a wall the
  host climbs before anyone plays, and Jackbox's actual trick is that you press one button and you
  are in. This very likely **supersedes the preset-packs design** parked under Iteration 7: packs
  exist to answer "give me a good geography game in one tap", and Draft answers it better. Don't
  build both without re-deciding.
- **Block 1 is always Flags: countries.** This closes Draft's cold-start hole (no scores means no
  last place means no picker) and is the right on-ramp anyway: establish the loop before asking
  anyone to choose.
- **Blocks = `min(players + 1, 5)`**, host can override. The `+1` is the fixed opener. This makes
  **"everyone picks exactly once" true for 2 to 4 players** (the stated design center: "2-player is
  the main case") without anyone being told a rule, and caps a 20-seat room (`MAX_SEATS`) at 5
  blocks instead of 20. At ~2 min a block cycle that is about 10 minutes, against Jackbox's 15 to 20.
  Tying block count to player count *directly* is the trap: the two are independent quantities that
  only coincide for 2 to 4 players.
- **Picker = the lowest-ranked player who hasn't picked yet.** Not merely "last place": with two
  players, pure loser's-pick can hand *both* picks to the same person, and then one of the two never
  chose anything. Note the formula makes the clause free: picks = blocks − 1 = `min(players, 4)`,
  never more than the player count, so the eligible set cannot empty (unless the host overrides above
  `players + 1`, where everyone simply becomes eligible again).
- **Why loser's pick over a vote or a seat rotation.** A vote is mushy (the fun of choosing is
  diluted, and ties need a rule); leader-picks snowballs. Loser's pick does three jobs with one rule:
  it is a comeback mechanic, it hands the spotlight to exactly the player who is disengaging, and it
  makes the break load-bearing. It is a **soft rubber-band** that only bends *what you play*, never
  the points, so it never feels unfair the way a handout does. **The live objection, accepted with
  eyes open:** being bad early buys you a pick. The mock's worked example (Zosia last by 16, picks
  Coffee, goes 5/5, takes the lead) exists to make that judgeable rather than arguable.
- **A hand of 5 cards, not a menu of 30.** Drawn from the unused modes: the picture modes plus a
  random draw of the enabled metrics. A list of 30-odd registry metrics is a form, not a party beat.
- **Draft deals per-metric blocks** (one 5-round segment), where Setlist deals mixed. "I pick Coffee"
  is a moment; "I pick World facts" is a menu. Both shapes are valid `Segment[]`, so this needs no
  model, no fork, and no server knowledge.
- **No mode twice in a game.** Keeps coverage honest and makes the last pick nearly forced.
- **10 s to pick, random on timeout.**
- **The watcher screen matters as much as the picker's.** With 4 players, 3 of them are watching.
  "Zosia is choosing", with her avatar. It is a spotlight, which is why it is short.
- **The final block is double points and always tricky.** Loser's pick chooses the terrain for the
  block that decides the game. Tricky as an *act* also finally gives the veil a home: it is a global
  switch today, so most hosts never flip it, so two iterations of work mostly never run.
- **Scoring is untouched** (Jan: "your scoring is fine"). See the speed-bonus note under Open
  decisions for why time-decay was considered and parked.

**Build steps (BUILT on `feat/party-draft`, pending PR + Jan's merge):**

- [x] `flags/partyDraft.js` (new, pure + tested) — `blockCountFor(playerCount)`,
      `pickerFor(scoreboard, alreadyPicked)`, `handFor(usedModeIds, rng)`, `isValidPick`, seeded rng.
- [x] `flags/partyRoom.js` — `picking` phase; `pendingPickAfterReveal`, `applyEnterPicking`,
      `applyPick` (appends a block to the growing plan, only the designated picker, stamps
      `draftPick` attribution); draft state serialized; `resetToLobby` clears it (+ 8 tests).
- [x] `party/partyGameServer.js` — draft `start` (opening Flags block, `targetBlocks` from the seat
      count); `next` routes to a pick at block boundaries; the `pick` + `forcePick` messages;
      `usedModes` tracked + rebuilt after an eviction; validates the picked mode.
- [x] `flags/partyClient.js` — the `picking` phase, picker vs watcher, `lastPick` attribution (+ 6 tests).
- [x] `flagParty/page.js` — the two doors (draft default, persisted), the pick screen (both points of
      view), the host's 10 s pick clock firing `forcePick`, attribution on the block's first round.
- [x] `flagParty/index.css` — doors + pick cards + pick timer, palette vars; metric hues confined to
      the draft cards, same sanctioned exception as the setup chips.
- [x] `i18n/en.json` + `pl.json` — doors / pick / attribution strings, en + pl, no em dashes.
- [x] `npm run validate` green (2872 tests) + **end-to-end in-browser verified** (solo, fresh-port
      serve to beat the SWA-CLI module cache): doors render with Draft default, draft start deals a
      Flags block, the pick screen shows a 5-card hand (unused picture modes + random stats, metric
      hues on the icons), a manual pick deals the right block (picked Map → contour tiles) with the
      "X's pick" attribution, and the 10 s `forcePick` timeout auto-picks a random card. 0 party-code
      console errors.

**Mock (the design both iterations were settled against):**
https://claude.ai/code/artifact/f2a1acb4-12cb-40c0-831b-075f921afdad

**Reviewed (adversarial correctness pass, 2026-07-17).** No reachable bug: the pick-vs-final
boundary is exact, state resets cleanly between games, and draft fields serialize for reconnect
mid-pick. Fixed one latent gap it found: a null picker at a boundary now falls through to the
ordinary advance instead of freezing the room (defensive — the block-count formula already
guarantees a picker). Two findings accepted, not fixed:
- **A disconnected seat can be handed the pick** (`pickerFor` is lowest-*ranked*, not lowest-*present*,
  per spec). Not a stall: the host's `forcePick` clock resolves it with a random card after 10 s.
- **`usedCodes` isn't rebuilt after a durable-object eviction** (only `usedModes` is) — a general,
  pre-existing server gap (affects setlist too, and the plan doesn't record which countries were
  used), so left alone here. Cosmetic sibling: the "X's pick" attribution card doesn't survive a
  reconnect mid-drafted-block (the block / scores / question all do).

### Final-block polish — double points + always tricky — BUILT on `feat/party-final-block` (pending PR)

The block that decides the game now **scores double and is always played tricky**, so a trailing
player who chose its terrain (draft) or just gets hot at the end can still swing it, and the veil
finally runs by default (draft never shows the tricky toggle). Applies to any **2+-block** game
(draft or setlist); a single-block game has no "final block" (nothing to contrast), so it's exempt.

- `flags/partyPlan.js` — `isFinalBlock(index, total)` (false for a single-block game) (+ tested).
- `flags/partyScore.js` — `scoreRound`'s `multiplier` (`FINAL_BLOCK_MULTIPLIER = 2`) scales base +
  speed bonus; wrong stays 0; defaults to 1 (+ tested).
- `flags/partyRoom.js` — `toReveal` doubles on the final block and rides `doubled` on the reveal (+ tested).
- `flagParty/page.js` — the veil runs on the final block regardless of the host's tricky setting
  (`veilActive()`), and the pill shows a pink "Double points" badge.
- `flagParty/index.css` + i18n — `.pill-double` badge, `party.doublePoints` (en + pl).
- Verified in-browser (solo draft, fresh-port serve): block 2/2 shows the "Double points" badge and
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
- **Statistics rounds are never veiled.** The veil is a flag / outline recognition challenge; on a
  "which grows the most coffee?" round the flag is incidental, so hiding it tested the wrong skill
  (and a latent bug meant non-population stats got the *heavy* flag veil timing). `veilActive()` now
  returns false for metric rounds, so tricky mode and the always-tricky final block both skip stat
  blocks. Double points still applies to a stat finale — that was never the problem. Stat rounds keep
  their own name-reveal for the flag-identity issue.
- **No pick countdown.** Choosing a category isn't a race, so the visible pick timer is gone.
  `PICK_SECONDS` (10 s, visible) became `PICK_TIMEOUT_SECONDS` (45 s, invisible) — a long safety net
  that force-picks *only* a truly absent picker so the room can't hang; a present player picks long
  before it, with no clock on screen.

Still deferred (unchanged): the TV / Display surface; preset packs (probably dead — Draft supersedes,
see Iteration 7's note); per-player hint tokens and double-down, parked with scoring.

### The block title card — SHIPPED (#954), block-1 follow-up on `feat/party-block1-card2`

The deferred "full next-block title card" (a big card, not just the round pill's "X's pick"). A short
**intro beat** (2 s) that plays before the first round of **every block** (Draft and Custom both),
announcing the block: "Block 2 of 3", the mode's icon, its full name, "5 rounds", who picked it (Draft
only), and a "Double points" badge on the final block.

**Follow-up (block 1 too, `feat/party-block1-card2`):** #954 shipped the card on blocks 2..N only; the
opener went straight into round 1. Jan flagged a fairness gap — the host clicks Start and is already
looking at the game while the other seats are mid-transition from the lobby, so the host meets round 1's
first flag a beat sooner. The card on **block 1** doubles as the synchronized "get ready" beat: every
seat (host included) holds the same 2 s card, and the round clock starts only after it, so the first
question reveals to everyone at once. `isBlockStart` now returns true at round 0 (`index >= 0`), firing
once per block instead of `blockCount - 1`; the render + `renderBlockCard` already handled the opener
(no pick attribution, generic "Flags" label, not the final block). Verified in-browser: a fresh game
opens on a "Block 1 of 2 · Flags · 5 rounds" card before round 1.

**The shape: pure presentation, no server / room / wire touch.** The client already learns the block's
mode from what it holds — `lastPick.modeId` on a drafted block (precise: the exact stat, the exact flag
pool) or the question's `roundId` on a custom block. The one gap is the two flag pools sharing
`roundId: 'flagPick'`, so an *un-picked* flag block is announced generically ("Flags"); every other case
is precise. The beat is a **client-side hold**: the question is already dealt, but the card shows first
and the round + clock + veil start only when the beat ends, so it costs no answer time. Because every
client (host included) holds the same beat, it introduces no clock drift (the host's authoritative
reveal clock simply starts after the card, like everyone else's).

- `flags/partyPlan.js` — `isBlockStart(index, total)` (first round of every block, opener included;
  sibling of `isBlockBoundary`) (+ tested).
- `flags/partyTiming.js` — `BLOCK_INTRO_SECONDS = 2` (the beat).
- `flagParty/page.js` — exported `blockModeId(lastPick, roundId)` (which mode to announce; pinned in
  `modeLabels.test.js`); the `#pt-blockcard` render + the `armBlockIntro` hold that gates the round
  behind the beat, re-armed once per block-start.
- `flagParty/index.html` + `index.css` — the `#pt-blockcard` section + card styles (palette vars;
  metric hue on the icon is the same confined-to-setup exception the draft cards use), a fade+rise
  entrance gated on `prefers-reduced-motion`.
- `i18n/en.json` + `pl.json` — `party.blockCardCount`, `party.blockCardRounds` (en + pl, no em dashes;
  reuses `party.blockPick` / `party.doublePoints`).
- `npm run validate` green (2895 tests) + **end-to-end verified in-browser** (fresh-port serve): a solo
  draft game showed the card at block 2 with the picked mode (metric label + its hue on the icon; then
  the contour icon on a Map pick), the picker attribution, and the "Double points" badge (block 2/2 is
  final); a 3-block Custom game showed the card at block 2 with the roundId-derived mode, **no** picker
  attribution, and **no** double badge (block 2/3 isn't final). 0 party-code console errors.

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
  an engineered overtake: player B swept block 2 to pass A). Captured the live mid-slide computed
  transforms — climber at `translateY(+58px)` rising, dropper at `translateY(-58px)` falling — and the
  settled break showing B risen to #1 (75) and A dropped to #2 (45, "30 behind"), no arrows. 0
  party-code console errors.

## Open decisions (settle as they come up, not now)

- **Settings page — SHIPPED (#765).** The host game-setup panel in the lobby picks which modes
  play and how many rounds each (see the Done entry); `flags/partyPlan.js` is the plan-as-data
  surface it edits. Kept here only as a pointer — no longer an open question.
- **QR in the lobby.** Deferred from iteration 1 (see above) — add a self-contained QR
  generator, or accept code + link.
- **Question count — superseded by Iteration 8.** The per-mode round counts are replaced by
  **blocks of 5**, and the game length becomes `min(players + 1, 5)` blocks (Iteration 9). Kept here
  only as a pointer.
- **Timing per round.** Per-question countdown landed in iteration 3 (`flags/partyTiming.js`,
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

## Out of scope (don't sweep in)

- Persistent competitive leaderboards for the show (it's a live party, not a ranked ladder).
- Accounts / auth beyond the existing deviceId + nickname.
- Non-flag domains (movies/books) — the round contract is domain-shaped, but that's the
  long-term-vision hub, not this feature.

## Done

- **Reveal pace — correctness-keyed, no reveal timer.** The reveal used to freeze the bar full
  and count "Next round in Ns" (weird for a sub-2s beat; in solo the digit never even
  decremented). Now the reveal length is keyed on the round, not the room: `isCleanReveal`
  (`flags/partyClient.js`) is true when every *present* player picked the answer, and
  `revealSecondsFor(clean)` returns `CLEAN_REVEAL_SECONDS = 0.9` vs `MISS_REVEAL_SECONDS = 2.5`
  (`flags/partyTiming.js`) — flagQuiz's correct-fast / wrong-slow feel. The reveal shows **no
  timer at all** (a first pass tried a draining bar; a sub-second drain read as a flicker, so it
  was cut — only the question phase has a bar). On a wrong pick, the flag/outline you chose gets
  a country-name strip so you learn what you clicked — the shared `.opt.wrong[data-name]::after`
  rule promoted to `common.css` from flagQuiz. Single-player mode was also removed this round of
  work — Flag Party is one online path, start with 1+ (see PR #768).
- **Host game setup (#765).** The lobby has a host-only, collapsed-by-default panel to choose
  which modes play and how many rounds each (`flagParty` `.game-setup`), reusing the site's
  shared toggle switch + stepper rather than any new styling. `flags/partyPlan.js` is the
  plan-as-data surface (`PARTY_MODES`, `DEFAULT_PLAN` = 3 flag / 3 territory / 5 map = 11 rounds,
  `planFromModeCounts`, `validatePlan`); the plan rides along on the `start` message and the
  server validates it, falling back to `DEFAULT_PLAN` on anything malformed. This closed the
  long-standing "settings page" open decision.
- **Iteration 4 — the Map round.** Second round type ("Which outline is X?"), the mirror of
  flag-pick: same grid / buzz-order / scoring, tiles render pre-generated country contours
  (`flags/contours/`) instead of flags. Server now picks round modules from the plan via a
  `ROUNDS` registry (`flagPick` + `mapPick`), not hardwired flag-pick. Default game is 11 rounds
  (3 sovereign flag / 3 non-sovereign flag / 5 sovereign map). `flags/partyPlan.js` is the config
  surface the settings page edits (shipped shortly after — see the host-game-setup entry above).
