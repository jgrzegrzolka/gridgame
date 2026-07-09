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

## Ship-dark behind `?test` (decided 2026-07-09)

The mode ships to prod immediately but stays invisible: a 5th tile is added to the home
grid, rendered `hidden`, and revealed by `bootHome()` only when the URL carries `?test`
(`new URLSearchParams(location.search).has('test')`). Lets us dogfood on the real site
(real PartyKit, real phones) without exposing a half-built mode to visitors. Flip to
always-visible by deleting the guard when a round set is ready.

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

## Iteration 1 — the show skeleton with one round (flag-pick), own-screen

Goal: a genuinely playable flag round on two phones (and solo), exercising the **entire**
engine so rounds 2–4 and the TV surface are pure additions afterward.

- [ ] **Home tile, ship-dark.** 5th `.game-tile` in `index.html` → `flagParty/`, `hidden`
      by default; `bootHome()` reveals it when `?test` is present. i18n label key.
- [ ] **PartyKit party + pure room module.** Register the new party in `partykit.json`;
      `party/partyGameServer.js` (thin) + `flags/partyRoom.js` (pure: seats, host, start,
      buzz-order, reveal-with-all-picks, tally, next, final) + `flags/partyRoom.test.js`.
- [ ] **Round contract + flag-pick round.** `flags/partyRounds/flagPick.js` implementing
      `generate` (via `pickQuestion`) + `isCorrect`, with tests. `flags/partyScore.js`
      (+ test) for the decaying speed bonus + solo scoring.
- [ ] **Player page** (`flagParty/index.html` + `page.js`) — one page, both create and join:
      Create → lobby (code + share link + QR + joined players) or Join via `?c=CODE` →
      Start → per-round (prompt + 4 flags, tap to answer, locked-in) → reveal (correct flag
      + everyone's pick + points + scoreboard) → final board after 5 rounds → Play again.
      Nickname auto-read from `gridgame.nickname`.
- [ ] `npm run validate` green (tests + typecheck).

**Explicitly NOT in iteration 1** (so it stays shippable): rounds 2–4, the TV/Display
surface, quantitative data, persisted scores / leaderboards (the show is ephemeral — a room,
a session, done), more than one round *type*, spectators.

## Open decisions (settle as they come up, not now)

- **Name.** "Flag Party" / "Flag Rush" / "Flag Show"? Folder is `flagParty/` for now
  (can't be `party/` — that's the PartyKit server dir).
- **Question count / timing per round.** 5 questions, per-question countdown length.
- **Speed-bonus curve.** Decaying (+5/+3/+1) vs flat first-only vs continuous by rank.
- **Max seats.** 2 to start is fine; the room module should not hard-cap low.

## Out of scope (don't sweep in)

- Persistent competitive leaderboards for the show (it's a live party, not a ranked ladder).
- Accounts / auth beyond the existing deviceId + nickname.
- Non-flag domains (movies/books) — the round contract is domain-shaped, but that's the
  long-term-vision hub, not this feature.

## Done

_(nothing yet)_
