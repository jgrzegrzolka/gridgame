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

**Iteration 5, Round 3: Superlative (population)** is BUILT on `feat/party-superlative-round`
and verified end-to-end (see the iteration entry below); it awaits a PR + Jan's merge. The show
engine, two rounds (flag-pick + map), the host game-setup panel, single online path (start with
1+), and the reveal polish are all shipped and on `main`.

After iteration 5, the remaining pieces:

- **TV / Display + Buzzer surface**, the Jackbox layer (see Surfaces above).
- Loose ends under **Open decisions** (QR in the lobby, speed-bonus curve, max-seat cap).

Reading the history below: it's a time-ordered journal, so the current design of anything is
the **newest** entry that mentions it — earlier numbers (e.g. Iteration 2's `DEFAULT_PLAN`
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

## Iteration 5: Round 3, Superlative (population), BUILT on branch `feat/party-superlative-round` (pending PR)

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

## Iteration 6b — Configurable reveal timing, BUILT on branch `feat/party-reveal-config` (pending PR)

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

## Open decisions (settle as they come up, not now)

- **Settings page — SHIPPED (#765).** The host game-setup panel in the lobby picks which modes
  play and how many rounds each (see the Done entry); `flags/partyPlan.js` is the plan-as-data
  surface it edits. Kept here only as a pointer — no longer an open question.
- **QR in the lobby.** Deferred from iteration 1 (see above) — add a self-contained QR
  generator, or accept code + link.
- **Question count / timing per round.** 16 rounds (4 flag / 4 territory / 4 map / 4 superlative,
  per `DEFAULT_PLAN`; the host can retune each in the lobby setup).
  Per-question countdown landed in iteration 3 (`flags/partyTiming.js`, host-driven,
  hands-free advance); question time is `QUESTION_SECONDS = 20`. **Reveal pace is decided
  and deliberately *not* configurable** (see the reveal-pace note under Done): it's keyed on
  correctness, not a dial. If pace ever becomes a setting it should be one overall fast/normal
  feel, not raw per-phase seconds.
- **Speed-bonus curve.** Currently decaying (+5/+3/+1) in `flags/partyScore.js`.
- **Max seats.** No hard cap in the room module; 2 is the tested case.

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
