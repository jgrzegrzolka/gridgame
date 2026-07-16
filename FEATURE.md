# Tasks

Working document for in-progress work that spans multiple sessions. A fresh agent picking this up should:

1. Read `CLAUDE.md` (project rules).
2. Read this file.
3. Find the **first uncompleted feature** under `## Now`, locate its **next step**, and continue.
4. **`## Backlog` is off-limits to agents** — items there are deferred-but-not-forgotten, not next-up. Jan promotes a backlog item to `## Now` when he decides to ship it.
5. Update this file as each step completes (check off boxes, move finished features to `## Done`).

**Branching:** each phase = one branch off `main` + one PR. Run `git checkout main && git pull` *before* `git checkout -b ...`. Don't auto-merge — Jan merges each PR himself.

**Shared decisions (apply to all features below):**

- **Backend stack:** Azure Static Web Apps (Free SKU) + bundled Azure Functions (Node) + Azure Cosmos DB NoSQL with **Free Tier toggle ON**. Reason: Jan is a C# Azure dev — personal-project portfolio + learning value. Stays $0/month on always-free quotas indefinitely. (Cloudflare Workers + D1 was equally valid technically; Jan opted into Azure on 2026-06-09.)
- **Naming convention:** code, pages, repo stay `gridgame` (historical). Azure resources use `yetanotherquiz` (matches subscription, current product framing). Don't mix.
- **Subscription:** `yetanotherquiz` / `6da299d6-bdfe-4277-a544-ae8ef68f99a0`. Resource group is in West Europe and most resources live there (Cosmos, RG metadata); the SWA itself is `swa-yetanotherquiz-v3` in **West US 2** after the 2026-06-10 WE failover — see Done / Feature D for the why and the recovery playbook.
- **Cost protection in place:** €5/month budget on the subscription, email alerts at 50% / 80% / 100% to `jangrzegrzolka@gmail.com`. Don't re-add. Created via `az rest` on `Microsoft.Consumption/budgets/monthly-5eur`.

---

## Now

### Feature U: Simplify tic-tac-toe — remove 9×9, make the flag board the default

**Status:** Phase 1 shipped (#924). Phase 2 shipped (#925 code removal, #926 follow-up + the Cosmos strip, which has been **run and verified**). **Phase 3 shipped (#928)** — the "No statistics" toggle on the offline + solo boards. **Phase 4 shipped (#931)** — the toggle went online as a room setting. **Phase 5 (this PR) flips the default**: the flag board is what everyone now gets, and country data became opt-in "Advanced mode". Jan's framing: nobody plays 9×9, it's hard and slow, and it taxes every metric we add; the 3×3 board is too hard for some players because the category pool is 86% country-statistics.

*The feature's title used to say "add a flag-only easy mode". Phase 5 retired that framing along with the label: naming the opt-in pole turned out to be the thing that made the whole feature legible, so there is no "easy mode" here any more.*

**Why both halves are one feature.** They're the same lever pulled twice: *what may enter the category pool*. 9×9 is a pool filter (`ultimateEligible`) that costs a line plus a JSDoc paragraph in all 32 metric factories. Easy mode is a pool filter that costs nothing per-metric because it derives from the category id. Removing the first and adding the second in one feature keeps the reasoning in one place, and Phase 2 must not delete the `pool` plumbing that Phase 3 reuses (`randomPuzzle(rng, pool)`, engine.js:2938).

**Measured baseline (2026-07-16, `flags/engine.js`):** full 3×3 pool = 142 categories, of which 19 are flag-visual (13%) and 6 are continents. The remaining 116 are world-metric thresholds across 32 metric families. Easy pool (flag-visual + continent) = 25 categories. Both pools generate 500/500 seeds; easy averages 5.7 attempts vs full's 16.5, so easy mode *relaxes* the generator rather than straining it. `statehood` is a factory but is **not** in the random pool, so it isn't a consideration here. *(Phase 1 counted 20 flag-visual / 26 easy; Phase 3 reclassified `hasMotif:eu-member` as a country fact, moving one category out of both.)*

#### Phase 1 — write down the plan + start a TTT skill *(this phase)*

- [x] Feature U entry in `FEATURE.md` (this).
- [x] New `.claude/skills/ttt-architecture/SKILL.md`: board topology, puzzle authority (server deals online), reducer map, the settings/toggle recipe, the persisted surfaces that resist deletion.
- [x] Merged as PR #924.

**Why a second TTT skill rather than growing `ttt-puzzle-generator`.** They answer different questions. `ttt-puzzle-generator` is "I'm changing how categories get picked"; `ttt-architecture` is "I'm changing a TTT page and need to know what else moves". The generator skill has no idea there are five boards, one shared stylesheet, or a server that deals the puzzle, and that gap is what makes generation-affecting changes dangerous.

**Known drift in `ttt-puzzle-generator/SKILL.md`, fix in Phase 2** (it has to be edited there anyway, so don't do it now):
- It documents 5 rejection rules; the live ladder runs **6** (`metricGroupRepeated`, engine.js:3168, is undocumented despite being in `SINGLE_USE_METRIC_GROUPS` at engine.js:2809-2836).
- Counts are stale: says "~30 metric families / ~19 flag-visual", live is 32 / 20 of a 142 pool.

#### Phase 2 — remove 9×9

**Optional first step (Jan's call):** confirm the "nobody plays it" premise from prod rather than assuming. The `m9x9` counters are already in Cosmos (`api/src/lib/tttPairDoc.js:12`), so one read-only query answers it. Cheap; either confirms the plan or surprises us.

**Deletes cleanly:**
- [x] `ticTacToe/9x9/` (whole tree: `index.html`, `page.js`, `onlineClient.js` + test, `offline/`).
- [x] `flags/ultimateTicTacToe.js` + test, `flags/ultimateOnlineRoom.js` + test.
- [x] `party/ultimateTicTacToeServer.js` + test, `party/ultimateServer.js`.

**The actual prize (engine.js), do this carefully:**
- [x] `buildUltimateCategoryPool` (:2743), `generateUltimateRandomPuzzle` (:3239), `hasUltimatePuzzleSolution` (:3197), `findUltimateAssignment` (:3058).
- [x] The `ultimateEligible` field on `Category` (:30) and its assignment in **every** metric factory (:1075, :1103, :1133, :1206, :1235, :1266, :1297, :1328, …).
- [x] The `ultimate?: boolean` flag on every `*_BREAKS_FOR_RANDOM` array and the `{ ultimateEligible: ultimate === true }` mapping in `buildRandomCategoryPool`, plus the per-metric JSDoc arguing 9×9 eligibility. **Result: `engine.js` 3404 → 3020 lines, 99 `ultimateEligible` mentions → 0.**
- [x] `hasStripesOnly`'s `ultimateEligible: false` (:165).
- [x] **Keep** `randomPuzzle`'s `pool` parameter (:2938). Phase 3 needs it.

**Leaks 9×9 into 3×3 today, clean up while here:**
- [ ] `exhausted` is 9×9-only (`flags/ticTacToe.js:14-17` typedef, set only in `ultimateTicTacToe.js:374`), yet both 3×3 pages run `td.classList.toggle('exhausted', …)` as a permanent no-op (`ticTacToe/page.js:632`, `ticTacToe/offline/page.js:389`). Remove the toggles, the typedef, and `.cell.exhausted` from `ticTacToe/index.css:325-330`. **Note:** `CLAUDE.md:67` cites `.cell.exhausted` by name as the sanctioned exception to the no-duplicate-CSS rule; that line must be updated in the same PR or it becomes a dangling reference.
- [ ] `ticTacToe/index.css:332`→EOF is the `/* ---- 9x9 variant ---- */` block, roughly two thirds of the 21 KB file. 9×9 pages link `../index.css`; there is no separate 9×9 stylesheet.

**Persisted surfaces — Jan's call, 2026-07-16: delete them, data loss accepted.**

The Phase 1 plan said "stop writing, keep reading" for both. Jan overrode: *"do we keep anything in cosmos that tell you that its 9x9? if yes i wan to delete that. i dont care about data loss."* Superseded, recorded here so nobody re-derives the cautious version from the git history.

- **Achievements** `first-ttt-9x9-game` / `first-ttt-9x9-win` (`flags/achievements.js:918-933`) — **delete the rules**. This is a *pure code change*: achievements are **computed on read**, not stored. `tttCompute.js` derives the snapshot from `tttPairs` rows on every `/api/v1/daily/me` request and `achievements.js` runs predicates over it. There is no award record anywhere, so deleting the two rules removes the badges from every profile with no data work. The stable-id rule still forbids **reusing** the ids for something else.
- **Cosmos `m9x9`** — **strip the field** from every `tttPairs` doc. It is the **only** 9×9 artifact in Cosmos; of the four containers (`dailyResults`, `profiles`, `quizRecords`, `tttPairs`) only `tttPairs` encodes a mode at all. Everything else in a `9x9` grep of `api/` is code reading the field.
- `validate.js:304`'s `TTT_MODES` keeps `'9x9'` so an old client's in-flight POST doesn't 400. Cheap; drop it a release later.

**Known collateral of stripping `m9x9` (accepted).** `tttCompute.js:89-96` sums `tttGamesPlayed` / `hasWonTtt` / `hasLostTtt` across **both** modes. Removing `m9x9` shrinks those totals, so a player whose 10th game or only win was a 9×9 game silently loses **Ten Games** / **First Win** / **First Loss**. Jan's read is that he's the only one with 9×9 rows, which would make the collateral his alone. **The dry run must confirm that before `--apply`.**

**Ordering matters:** ship the code removal first (stops new `m9x9` writes), deploy, *then* run the strip. Stripping while 9×9 is still live lets a game re-add the field.

- [x] `scripts/strip-m9x9.mjs` written, modelled on `authoring/reconcileTttPairs.mjs`: **dry run by default**, `--apply` to write, `COSMOS_CONN` pulled from SWA app settings via `az` and never written to disk. Dry run prints per-device badge deltas so the collateral is visible before it happens.
- [x] **Dry run** done 2026-07-16, after the `64e7da9` deploy succeeded.
- [x] **`--apply`** run 2026-07-16: 24/24 rows rewritten. Re-ran the dry run to confirm: **24 rows, 0 carrying `m9x9`.** Cosmos holds zero trace of 9×9.

**What the dry run actually found (the reason it was worth insisting on).** 9×9 was played **twice ever** (4 row-writes = 2 games × 2 perspectives), which confirms the "nobody plays it" premise. But of the 24 rows carrying `m9x9`, only 4 held a real game, and stripping them was **not** badge-neutral: `b7f0f806…` lost **First Win** and `4dc0f0b4…` lost **First Loss**, because each player's only win/loss happened to be in a 9×9 game. Jan chose to strip all 24 with that known (2026-07-16). Self-consistent: if 9×9 never happened, those wins never happened. Recorded here because the counters can never explain this themselves.

**Blocked reads, both correct.** (1) A read-only `tttPairs` probe was denied before Jan named the deletion. (2) A follow-up joining `profiles` to check whether those 4 devices were all Jan's was denied as PII access beyond the task's need — the badge-impact table already answered the operational question without identities. Neither was worked around.

**Baseline for any future TTT badge work:** the 4 remaining TTT rules are `first-ttt-win`, `first-ttt-loss`, `ten-ttt-games`, `hundred-ttt-games` (48 rules site-wide). Verified in-browser post-change, including that a stale snapshot still carrying `tttGamesPlayed9x9` / `hasWon9x9` earns nothing.

**Also touches:** `i18n/{en,pl}.json` (`ttt.variant3x3` / `ttt.variant9x9` — the 3×3 label exists only to pair with the 9×9 one in the burger, so both go; plus the `ttt9x9.*` block at en.json:534-537), the two burger `<li>`s (`ticTacToe/index.html:56-57`), `ticTacToe/index.html:6`'s meta description ("9×9 ultimate variant"), `sitemap.xml:29`, `.github/workflows/deploy.yml:254-255,344-345` (warm + smoke URLs), `tsconfig.json:22-23`, `authoring/reconcileTttPairs.mjs:119-188`, `daily/streakClient.js:51-117`, and 9×9 assertions inside `flags/engine.test.js` / `flags/countries.test.js` (the "only `>=10M` reaches 9×9" pins) / `flags/achievements.test.js` / `langRefresh.test.js`.

**Mode lives in the URL path, not a query param** (`/ticTacToe/` vs `/ticTacToe/9x9/`), so there's no param to clean up, but the deleted paths need a redirect decision (see open calls).

#### Phase 3 — flag-only easy mode (offline + solo only)

**Scope decision (Jan, 2026-07-16): start offline/solo only.** The PartyKit server deals online puzzles (`party/ticTacToeServer.js`, both the fresh-room and rematch calls), so a localStorage toggle would silently do nothing in an online room, and naively wiring it would let the room creator impose difficulty on the opponent with no UI saying so. Online easy mode is a room setting (WS URL param at create + durable-object state + lobby display) and is deferred until we see whether anyone uses the offline toggle. **Read the `ttt-architecture` skill before touching this** — it carries the puzzle-authority rule and the toggle recipe.

*Line numbers below are post-#926 (verified 2026-07-16). `engine.js` shrank 3404 → ~3020 in Phase 2, so anything cited from the Phase 1 plan has moved.*

- [x] Add a `pool` option to `generateRandomPuzzle`. `randomPuzzle` already accepted one — Phase 2 deliberately kept that parameter for this. Side benefit: hoisting the default into `generateRandomPuzzle` means the pool is built **once per generate instead of once per attempt** (the old `randomPuzzle(rng)` re-evaluated its default parameter, rebuilding all 142 categories on every retry, up to 200×).
- [x] `buildEasyCategoryPool()` next to `buildRandomCategoryPool`: `buildRandomCategoryPool().filter(c => isFlagVisualCategory(c) || c.id.startsWith('continent:'))`. No per-category annotation to maintain (that was `ultimateEligible`'s sin).
- [x] Threaded through both client generate sites (`ticTacToe/solo/page.js`, `ticTacToe/offline/page.js`), read once at boot because the board is dealt once.
- [x] Burger toggle on `ticTacToe/offline/` + `ticTacToe/solo/`, keyed `gridgame.ttt.easy`, reusing findFlag's `.scope-toggle` markup and `readBoolSetting` / `writeBoolSetting`.
- [x] Toggle does not appear on `ticTacToe/index.html` (online). Pinned by a test that reads all three HTML files, so it can't drift back in.
- [x] Tests: seeded 50-seed real-data sweep in `flags/countries.test.js` (generates + no metric leak + flag-visual ratio), unit tests in `engine.test.js`, `flags/ticTacToe.test.js` (`boardIsUntouched`), and `ticTacToe/easyToggle.test.js`.

**Measured 2026-07-16 post-implementation (500 seeds, real data):**

| | full pool | easy pool |
|---|---|---|
| categories | 142 | **25** (19 flag-visual + 6 continent) |
| seeds generating | 500/500 | 500/500 |
| mean attempts | 16.5 | **5.7** |
| mean flag rules per board | **1.5 / 6** | **4.9 / 6** |

Easy mode *relaxes* the generator (fewer exclusiveGroup collisions once the metric thresholds are gone). The 1.5/6 figure is the complaint stated numerically: the full pool sits barely above `lacksFlagVisualCategory`'s floor of 1, so the typical board really is a statistics quiz with one flag question wedged in. A live solo board sampled after Phase 2 came out 5-of-6 statistics — right on the mean, not bad luck.

**Open calls — settled by Jan, 2026-07-16:**
- **`hasMotif:eu-member`** → **reclassified**, not excluded from the easy pool. `MEMBERSHIP_MOTIF_IDS` in `engine.js` makes `isFlagVisualCategory` answer false for it. The cascade worry didn't materialise: `isFlagVisualCategory` has only two call sites (`lacksFlagVisualCategory` + tests). This fixes the latent false positive **and** drops eu-member from the easy pool for free, with no eu-member special-case in the pool code. It also shrank the plan's projected 26-category pool to 25 and the full pool's flag-visual count from 20 to 19. Precedent: `daily/difficulty.js:81` already draws this exact line (`MEMBERSHIP_MOTIFS`, "recall a discrete known list rather than search by visual property") — same distinction, same motif, different consumer. If a second membership motif is ever tagged (NATO, Commonwealth), both sets want it.
- **Naming** → **"No statistics"** (`ttt.noStatistics`; pl "Bez statystyk"), not "flags only". The plan leaned "flags only", but the pool is flag-visual **+ continent**, and continent is a country fact — so every "flags only" framing overclaims. Naming the removal is the only label that's literally true. Secondary reason: findFlag's burger switch is "Include territories & other flags", which is about *which flags are in scope*; a sibling burger saying "Flags only" reads as the same axis. Continents stay in the pool deliberately — they're what makes a flag question findable ("red × Europe" gives you somewhere to look; "red × 3 colours" is a search of the whole world).
- **Re-deal** → **only when the board is untouched.** Flipping the toggle on an empty board re-deals immediately; with any move down, it applies to the next board instead. Re-dealing is `window.location.reload()`, the exact mechanism the pages' own "Play again" already uses, gated on `boardIsUntouched(state)` and deferred 350 ms so the thumb's slide is visible first (same beat findFlag uses, same reason). `boardIsUntouched` reads `cell.country`, not `cell.owner`, so a give-up reveal counts as touched.

**Correction to the Phase 3 plan, found by looking:** the "nickname → coffee-divider with nothing between" trap applies to **offline only**. `mountNicknameMenuItem` inserts the nickname as the menu's *first* child, so solo was already nickname → "Play online" → divider and never matched `.menu li.menu-nickname + li.menu-divider`. Offline was the bare case; inserting the toggle there restores the divider's own `border-top`, which is correct and self-healing exactly as `common.css:405-408` says. Verified in-browser on both menus, not assumed.

#### Phase 4 — online easy mode *(this PR)*

**Jan's call, 2026-07-16, overriding Phase 3's deferral: keep the toggle exactly where it is — in the burger, on all three boards.** The host's setting wins, the joiner sees it and cannot change it. His argument was consistency ("this way we have same UI for all modes"), and it beats the lobby-placement alternative that was mocked first: that one justified itself with "the choice is frozen at create time", and the moment the host can change it in-room, that rationale evaporates. Keeping it in the burger also means **no new UI element at all** — the switch is its own disclosure, so the "room mode" chip the mock proposed was dropped.

**Who decides was never really open.** The server deals the puzzle at room creation, before a joiner exists, so there is nobody else to ask. Phase 3's objection was never about authority; it was that the creator would impose a mode "with no UI saying so". The joiner's read-only switch is that UI.

**The one refinement on top of what Jan described.** He said flipping it re-deals the game and that this is fine. Offline it is — it's your own board. Online, a mid-game re-deal throws away moves the *opponent* made, and #928 already wrote that rule for the single-player case ("a reload would destroy the player's progress to apply a preference, which is the one thing a settings switch must not do"). So the switch is live only until the first move lands, then locks for both. That leaves the host a create-to-first-move window, which in practice is the wait for someone to join. It also keeps the switch honest: it always describes the board in front of you. The rejected alternative (mid-game flips applying to the next board, as offline does) would have the joiner's switch reading "on" while they stare at a metrics board.

**Shape:**
- `?easy=1` on the create WS URL only. A joiner appending it is inert — the board already exists.
- `Room.easy`, persisted in the durable object, so the mode survives an eviction and a **rematch** (agreeing to a no-statistics board and then getting metrics on "Play again" would be a bait).
- New `set-easy` client message. `applyStartRematch` could not be reused: it hard-requires `isGameOver` (`onlineRoom.js:210`), and this fires on a live untouched board.
- `applySetEasy` authorizes host + untouched + actually-changing. The third guard stops a host rerolling a disliked board by toggling twice — that's a different feature nobody asked for.
- `welcome` carries `easy` + `isHost`. Carried explicitly, not inferred from the board's categories: the easy-pool predicate has already been re-cut once (eu-member, #928), and an inferred badge would have silently re-labelled every live room that day.
- `decideEasyToggleState` (pure, in `ticTacToe/easyToggle.js`) holds the whole rule; `page.js` is the DOM half. Disabling is a courtesy — the server re-checks everything, since anyone can send a frame.

**`easyToggle.test.js`'s "never on the online board" assertion is inverted, deliberately.** It pinned a *consequence* of the mode being unreachable from the client, and this PR makes it reachable. The rule it protected (the switch must never claim something it cannot deliver) survives as the `decideEasyToggleState` tests.

**Known follow-up, deliberately not bundled:** `welcome.isHost` is now server-authoritative, which makes `flags/tttHostMemory.js`'s sessionStorage guess redundant — and the guess is *wrong* for a host who reopens the room in a fresh tab (it reads false, so they'd also skip the Feature G result POST). This PR uses the server's answer for the toggle and leaves the POST path alone; collapsing the two is a small, separately reviewable change to a write path that has bitten before.

**Verified in two real browsers against local PartyKit** (separate contexts, so separate deviceIds): an easy room deals 6-of-6 flag rules and zero metrics; a joiner with **no** saved preference sees the switch read on + greyed, proving room-beats-preference; the host flipping it off re-deals both boards to a metrics board in lockstep; a give-up locks the switch for both. The online burger's borders come out byte-identical to offline's (nickname `border-bottom: 1px`, divider `border-top: 1px`, no double line).

#### Phase 5 — flip the default, and name the opt-in pole *(this PR)*

**Jan, 2026-07-16: "no statistics is a misleading name… maybe we should name other one advanced mode?"** Both halves of that were right, and the second one turned out to be a product decision wearing a naming decision's clothes.

**Why "No statistics" had to go.** It read as *"hide my score"*. The online board renders a live head-to-head record a few pixels from the burger, and the site has achievements and community stats — so the label collided with real UI on the same screen. Underneath that: it was a *removal* framing, and in a burger those read as display preferences (findFlag's sibling switch is "Include territories & other flags", a scope statement). It also named the pole you *don't* have, leaving the state you're actually in with no name at all.

**Why naming the other pole forced the default to move.** If Advanced is what everyone gets by default, then Advanced *is* normal, and calling normal "advanced" contradicts itself. The word only earns its name as something you opt into. So Jan's rename only works if the flag board becomes the default — which is the logical endpoint of Feature U's own premise. The page promises "tic-tac-toe where every move is a country flag pick matching the row × column category"; a board averaging **1.5 of 6** flag rules was not that game. A toggle only ever helped players who opened a burger and decoded the label; flipping the default helps everyone who never touches a menu.

**The cost, accepted by Jan:** everyone who never touched the setting now gets a different board, and anyone who liked the mix must find Advanced mode. 116 of the 142 categories become opt-in **on this surface**. Metrics are not buried: `generateRandomPuzzle` is TTT-only (7 non-test files, all TTT), so the flagsdata lens, both "Make a puzzle" filter sets, the Flag Party round, and the daily superlatives are untouched. TTT stops being metric-dominated by default; metrics keep their home.

**The payoff that confirmed the framing.** Naming the opt-in pole collapses the vocabulary to **one word**. The default state needs no name (it's just the board), so the switch, the room chip, and the how-to-play copy all say "Advanced". The earlier design needed a name for each pole; this one doesn't.

**Shape:**
- New key `gridgame.ttt.advanced`, default off — which now matches `readBoolSetting`'s default-off construction instead of fighting it. Deliberately **not** a rename of `gridgame.ttt.easy`: the two are near-opposites, so reusing it would have dropped every "No statistics" player into Advanced mode, the exact board they asked to get away from. With a new key they fall to the new default, which *is* what they wanted, so **there is no migration**. The dead `.easy` key is left where it lies.
- `buildEasyCategoryPool` → `buildFlagCategoryPool`, and it is now the *default* pool. The polarity lives in the TTT code that reads the setting (`isTttAdvanced() ? {} : { pool: buildFlagCategoryPool() }`), not in the engine, which stays a general library whose default is "every category".
- Wire renamed (`?advanced=1`, `set-advanced`, `advanced-changed`, `Room.advanced`). `deserializeRoom` reads all **three** snapshot vintages, because rooms outlive deploys: `advanced` (this build) → `easy` (#931, the near-opposite flag) → neither (pre-#931, always full-pool). Getting it wrong would relabel a live room's chip and hand its rematch the other pool.
- **Room chip** (`#room-mode`, `lobby.css`) beside the room code, only when advanced. This closes the hole in #931: the burger switch was the "disclosure", but *a joiner never opens the burger*. Online-only, which is also structural — offline and solo have no `.room-line`, and there you set the mode yourself seconds ago.
- **Mode block in "How to play"** (all three boards): the switch plus a muted note saying what it does. It is the only discovery path for solo / offline, and the only surface with room for the sentence the burger row can't hold. So each board mounts **two** switches for one setting; `wireAdvancedToggle` takes a list and paints all of them, because the off-screen copy is exactly the one that goes stale and is then believed when it opens.

**Two bugs the mock caught before they were code:** `.rules-help p` (0,1,1) out-specifies a bare `.rules-mode-note` (0,1,0), so the note rendered dark and cramped; and `common.css`'s "the p above is the last in-flow element" note became false once a block followed it — updated rather than silently broken.

**One bug caught while writing it:** re-deriving the switch from `state` right after a click snaps it back, because `state.advanced` still holds the room's old value until the server answers. In a room the click now mirrors onto the sibling switch only, and the broadcast paints the truth.

**Verified in real browsers against local PartyKit:** a brand-new player (empty localStorage) is dealt **zero metrics** on solo and offline; flipping Advanced inside "How to play" writes the key, syncs the burger's copy, and re-deals to a metrics board; a default online room shows no chip; the host opting in re-deals both boards and raises the chip; a joiner with no saved preference sees the chip plus a checked-and-greyed switch; and a player carrying the old `gridgame.ttt.easy=true` lands on the flag board with Advanced off, exactly where they wanted, with no migration run.

**Out of scope for Feature U:**
- Any change to the daily-puzzle catalogue. Advanced mode is player-selected curation of the *random* pool; the daily catalogue is human-curated already.
- Difficulty tiers beyond the one binary toggle. Jan asked for a toggle, not a difficulty system.
- Letting either player change the mode mid-game, or negotiating it between two players. One board, one owner, and a create-to-first-move window is enough.
- Chips on the offline / solo boards. They have no header to hang one on, and there the mode was your own choice moments ago.

---

## Backlog

Items here are not blocking current work but deserve durable memory — the next-time-this-comes-up question, the deferred fix that would otherwise vanish into PR archeology. Agents reading FEATURE.md to find their next task should **not** pick from this section; Jan promotes a backlog item to `## Now` when he decides to actually ship it.

### Feature Q: Observability for the player-facing site (Application Insights)

**Status:** parked 2026-06-16, updated 2026-06-17 after Feature R demolition. Jan plans to revisit ~next session. Gap surfaced during the Feature P cleanup audit; **widened** by Feature R Phase 3 which deleted the only AI instance in the resource group along with the Function App that owned it.

**Problem.** As of 2026-06-17 there is **no App Insights instance** in `rg-yetanotherquiz` at all (`ai-yetanotherquiz-release` was deleted with the rest of the scheduler stack). **The player-facing site has no telemetry at all.** Specifically:

- The SWA-managed Function App (which runs `api/dailyResult`, `api/dailyStats`, `api/engagementEvent`, etc.) has `APPLICATIONINSIGHTS_CONNECTION_STRING = null`. Exceptions thrown inside any of those handlers go to /dev/null. When a player's submission fails, Jan doesn't know.
- The frontend ships no App Insights JS SDK. Page views, JS exceptions, network errors, slow page loads — all invisible.
- The only signal that prod is broken today is "Jan or someone tells me" or "Cosmos rows look wrong."

Cloudflare Web Analytics (Feature M Part A, shipped 2026-06-14) covers some of the pageview gap but not application errors.

**Likely shape when this comes off the parking brake:**

1. **App Insights on the SWA-managed Function App.** Create a fresh `ai-yetanotherquiz` (or `ai-yetanotherquiz-api`) + Log Analytics workspace via Bicep. One `az staticwebapp appsettings set` call to wire the connection string. Captures every `api/*` exception, dependency call, and latency distribution. ~15 min of work, no code change in `api/`.
2. **App Insights JS SDK on the frontend.** One inline script in the shared HTML chrome, plus an `Application Insights Connection String` config. Captures page views, JS errors, performance timings, and (optionally) custom events for user funnels. ~5 min of work; adds ~30 KB to the page bundle (deferred load — no first-paint cost).

Both stages land within the 5 GB/month free tier at our traffic.

**Open design calls (settle when work starts, not now):**
- **Single AI instance or split?** Function App vs SWA Function App vs frontend — three workload types. A single shared instance is cheaper to manage and cross-correlates traces; splitting is cleaner per-workload reporting. Probably one instance with `cloud_RoleName` tagging per source.
- **Sampling.** Free tier is 5 GB/month — likely fine at current scale, but if traffic grows the JS SDK's default sampling (100%) becomes the first thing to tune.
- **Alerts.** Wire failure-rate or `requests | where success == false` alert to Jan's email (`jangrzegrzolka@gmail.com`)? The €5/mo budget already alerts at 50/80/100% — observability alerts would complement that.

**Out of scope even for Feature Q:**
- Full APM with distributed tracing across PartyKit + Cosmos + SWA hops (overkill for traffic).
- Custom dashboards / workbooks (start with the default Failures + Performance blades).
- Sensitive data filtering — none of our paths log PII today, but worth a one-time grep before turning on `enableAutoRouteTracking` in the JS SDK.

### Feature I: Per-puzzle stats snapshots for long-term retention

**Status:** parked until ~2027-05. **Hard deadline: must ship before 2027-06-09** — that's when the oldest `dailyResults` row (a puzzleId=1 submission from 2026-06-09 20:33 UTC) reaches its 1-year TTL set in Feature F phase 2. After that date, the row auto-purges from Cosmos, and from then on every puzzle's data ages off one day at a time. Missing the deadline means losing per-flag find-rate aggregates for those puzzles forever, with no way to reconstruct them.

**Goal:** survive the 1-year `defaultTtl` on `dailyResults` (Feature F2) without losing historical per-puzzle community stats. Once raw submission rows age off, the daily-stats endpoint should fall back to a frozen snapshot of "what the aggregate looked like when this puzzle was retired" instead of returning empty.

**Why this is a separate feature, not part of F:** F2 set the TTL because storage discipline is the right policy for a Free Tier hobby site, but it traded raw-row analyzability for storage cleanliness. Feature I restores the analytic value at a fraction of the storage cost (~1 KB per puzzle instead of 5 MB of raw rows at 10K plays). Decoupled from F because (a) the deadline is ~6 months out, no rush, (b) the trigger/read-path design needs more thought than F's near-term phases, and (c) F can finish and move to `## Done` without waiting on this.

**Likely shape when this comes off the parking brake:**

- New Cosmos container `puzzleSnapshots`, partition key `/puzzleId`, one row per puzzle (~1 KB).
- Row contents mirror the aggregator's return shape: `{ id: puzzleId, puzzleId, snapshotAt, totalAttempts, perCodeFinds, perWrongCode, mean, topPct, v: 1 }`.
- `dailyStats.js` checks the snapshot first; if present, returns it. Falls through to scanning raw rows only when no snapshot exists. (Net effect: a puzzle has live stats from raw rows for its first year, then frozen stats from the snapshot forever after.)

**Open design calls (settle when work starts, not now):**

- **Trigger.** Three options: (a) snapshot every puzzle when the *next* one is released — `release-daily.yml` writes the previous puzzle's snapshot alongside the promotion commit; (b) snapshot lazily on the first `dailyStats` request after rows start aging out; (c) a periodic background job (Logic App?) walks puzzles ageing out within N days. Option (a) is simplest and aligns with the puzzle-release cadence we already have via Feature E's Logic App.
- **Re-snapshot policy.** Freeze at first snapshot, or re-take as more submissions arrive before rows fully expire? "Freeze early" is simpler; "re-snapshot until rows expire" is more accurate. Probably "snapshot once when puzzle ages out, after that the snapshot is final."
- **Local-dev rows.** Snapshot should exclude `local: true` rows, same as the live aggregator does today (see `daily/extraStats.js`). Same exclusion logic, just frozen in time.

**Storage cost at long horizons:** ~1 KB × 365 puzzles/year × 10 years = ~3.6 MB total. Rounding noise vs. the 25 GB Free Tier ceiling. The deadline is the constraint, not storage.

**Out of scope even for Feature I:**

- **Snapshot of per-row data.** Would defeat F2's TTL policy — the whole point is to keep aggregates without keeping raw rows.
- **Cross-puzzle aggregates** (lifetime per-flag rates across every puzzle ever). Could be added later as a different snapshot type, but not load-bearing for the 2027-06-09 deadline.
- **Re-snapshot on every new submission.** The point is to capture a final aggregate when the raw data is about to age out, not maintain a live materialised view.

### Cleanup: delete `scripts/strip-m9x9.mjs` and the `9x9` mode compat

**Status:** parked, no deadline. The script **has been run** (2026-07-16, 24/24 rows); it is spent and now a no-op. Kept only so the run is auditable next to Feature U, same lifecycle as `scripts/backfill-puzzle1-add-li.cjs`.

**What to remove when this comes off the parking brake:**
1. `scripts/strip-m9x9.mjs`.
2. `'9x9'` from `TTT_MODES` in `api/src/lib/validate.js`, plus the `mode === '3x3'` guard in `tttPairDoc.mergePairResult` that exists only to ignore it, plus the two tests pinning that behaviour.

**Why parked:** the compat exists so a tab opened before the 9×9 removal doesn't 400 on its final POST. That window is measured in "how long does someone leave a tab open", so a month is plenty. Neither piece costs anything to keep meanwhile.

### Cleanup: rename `PASSKEY_HMAC_SECRET` → `SYNC_HMAC_SECRET`

**Status:** parked, no deadline. Cosmetic — the secret is load-bearing for QR-claim sync token signing, but it's misnamed after the **passkey** approach that was replaced by QR-claim in Feature C (shipped 2026-06-16). `api/src/functions/syncClaimToken.js:41-44` already carries an apologetic comment about the legacy name.

**What to do when this comes off the parking brake:**
1. Add new SWA app setting `SYNC_HMAC_SECRET` with the same value as `PASSKEY_HMAC_SECRET` (zero-downtime overlap).
2. Update the 4 api/ readers to fall through `process.env.SYNC_HMAC_SECRET ?? process.env.PASSKEY_HMAC_SECRET`. Deploy.
3. Confirm signing/verification still works end-to-end (one round-trip suffices).
4. Remove the fallback line + the `PASSKEY_HMAC_SECRET` app setting. Deploy.

**Why parked:** the secret is functionally correct under either name; the rename is pure hygiene. Real cost is one careful SWA deploy + a brief overlap window; real benefit is "future-me reading `syncClaimToken.js` doesn't have to think 'what's passkey doing here?'". Not urgent.

### Cleanup: remove the puzzle #1 → Liechtenstein migration

**Status:** parked until ~2026-07-11. **Trigger to act:** ~30 days after 2026-06-11, once every active player has loaded the daily page at least once and had their `daily.scores` patched by `migrateScores()`.

**What to remove:**
- `applyScoreMigrations` + `migrateScores` in `daily/scores.js` (and the calls from `daily/page.js` + `daily/archive.js`).
- The associated tests in `daily/scores.test.js`.
- `scripts/backfill-puzzle1-add-li.cjs` + its test (one-shot Cosmos script that should already have been run with `--apply` by the time this cleanup happens).

**What stays:** the puzzle data itself — `daily/daily_puzzles.json` #1 (10 answers including `li`), the `cross` motif on the 8 European COA-cross flags in `flags/countries.json`, and the `motif:!coat-of-arms` token on the #1 filter. Those are the durable change; the migration is just scaffolding for the trust transition.

**Why parked:** a player who hasn't visited in a month is unlikely to come back and notice their score regress from "9/9" to "9/10". The migration is cheap to keep around but adds boot-time overhead and a test surface we don't need forever. Removing in a month gives long-tail returners a window without leaving the code permanently fatter.

### Feature J: Platform decision — keep SWA Free, upgrade SWA, or migrate to CF Pages

**Status:** decision pending. Worker proxy (`infra/edge-proxy/`) keeps SWA Free usable in the meantime — this isn't blocking, but the question keeps re-surfacing every time SWA misbehaves.

**Why this question exists.** SWA Free SKU has burned us twice in 36 hours: the 2026-06-10 West Europe content-distribution outage (forced V3 failover, see Done / Feature D) and the 2026-06-11 custom-domain-edge flap that needed the Worker workaround (see PR #353 and `infra/operations.md` "Known issues"). The Worker insulates users from the specific 404-flap symptom but doesn't insulate from the next SWA Free issue, whatever it is.

**Three options on the table:**

1. **Stay on SWA Free + Worker proxy.** Status quo as of #353. $0/month. Vulnerable to whatever Azure-side issue hits next. Worker only covers the custom-domain-edge symptom; the WE-outage-class problem still requires hand-cranked failover per Feature D's playbook.
2. **Upgrade to SWA Standard SKU.** ~$9/month. Real SLA (99.95%), Microsoft support tickets, possibly different edge infrastructure. *Uncertain* whether the custom-domain edge issue is fixed by tier upgrade or shared with Free — would need to test by upgrading and temporarily removing the Worker.
3. **Migrate to Cloudflare Pages + Workers.** Free for our traffic. Already deep in CF ecosystem (DNS, Turnstile, PartyKit, edge proxy). The Cosmos client is plain-HTTPS (see CLAUDE.md "API / Azure Functions") so it ports to Workers without the `@azure/cosmos` SDK headache that bit B2b. Loses "Azure as portfolio/learning" reason from the original 2026-06-09 stack decision (see Shared decisions at top of this file). Migration: ~1–3 focused sessions.

**Decision criteria worth deciding on cold:**

- How much does "Azure as portfolio/learning" still matter? (Original reason for the stack — Shared decisions at top.)
- How much does the next SWA Free flap cost in Jan's time vs $9/month?
- Is migrating to CF Pages also re-opening the original stack decision, or separable from it?

**Out of scope here:** the second-region (WE sibling) plan in Feature D. That helps if we stay on SWA Standard, but is unnecessary on CF Pages. Decide platform first.

### Feature O: Profile-page achievements (replaces the "stats dashboard" direction)

**Status:** parked. Pivot decided 2026-06-15 — the profile page becomes a collection of earned achievements ("Cartographer", "First daily", "Perfect week", "All-Europe", "Revenge win") instead of a raw-numbers dashboard. Streak + best-streak from Feature N stay; everything else on the profile page becomes achievement-driven.

**Why this exists, not "win rate" / extended stats:** the win-rate concept settled in Feature N ("win = completion, any score") collapsed under the 2026-06-15 audit — a 1/4 finish and a 4/4 finish both count as 100%, which doesn't match any natural reading of "win rate" on a quiz site. Score-weighted "average accuracy" would be conceptually cleaner but still adds up to a single number that's hard to make playful. Achievements turn the same underlying data into something with a story — "you've cleaned-swept 5 different Europe puzzles" reads better than "your average score is 73%."

**Achievement inventory (audited 2026-06-15) — what's already in the data vs what needs Feature M Part B first:**

| Achievement | Data status | Source when promoted |
|---|---|---|
| 2 / 10 / N day streaks | ✓ ready | `dailyResults` → `computeStreak.maxStreak` |
| Daily clean sweep (4/4, 9/9, etc.) | ✓ ready | `dailyResults.foundCodes.length === totalCount` |
| Daily zero-score finish | ✓ ready | `dailyResults.foundCodes.length === 0` |
| Play quiz N times (total / per mode) | ✓ ready | `quizRecords.records[configKey].attempts` (Feature F5) |
| Play quiz Europe / All / Africa / etc. | ✓ ready | Same — `configKey` encodes the mode |
| Play TTT (count of games) | ✓ ready | Sum of `m3x3.{w,l,d} + m9x9.{w,l,d}` across `tttPairs` rows |
| Win / Lose / Draw TTT | ✓ ready | Same, broken out per counter |
| Share daily score N times | ✗ needs Feature M Part B `engagementEvents` `share` | One container with `kind` discriminator, instrumented at `shareText()` resolve |
| Share a custom findFlag puzzle (the `?f=…` deep-link case) | ✗ needs Feature M Part B `engagementEvents` `share` | Same container, `kind:'share'`, `payload.surface:'findflag'`, `payload.contextHint = filter` |
| Share a flagQuiz result (e.g. `/flagQuiz/?n=60s`) | ✗ needs Feature M Part B `engagementEvents` `share` | Same container, `kind:'share'`, `payload.surface:'flagquiz'`, `payload.contextHint = configKey` |
| TTT revenge win (lost before, won now) | ✗ needs Feature M Part B `tttPairs.lastOutcome` | Single field on the existing pair row — separate from `engagementEvents` |
| Play a custom findFlag puzzle (make-a-puzzle) | ✗ needs Feature M Part B `engagementEvents` `findflag_play` | Same container, `kind:'findflag_play'`, instrumented on the Play button click |
| Try N distinct findFlag filters | ✗ needs `engagementEvents` `findflag_play` | Same container, distinct-`payload.filter` count per `deviceId` |

**Why the inventory matters:** seven achievement categories ship data-ready today; six more unlock when Feature M Part B lands. Lets a Feature O v1 ship without waiting on M Part B, and v2 add the share / revenge / custom-puzzle achievements once the events are flowing. Also makes the cost-benefit case for each M Part B addition concrete — every line item in the table maps to ≥ 1 achievement consumer.

**Likely shape when this comes off the parking brake:**

- Pure achievement-rule library (`flags/achievements.js` or `api/src/lib/achievements.js` depending on where the compute lives) — each rule is a `{ id, predicate(snapshot) => boolean, tier? }`. Snapshot is the union of streak / daily / quiz / TTT data the page already fetches.
- Profile page renders the earned set as a grid of badges + a locked set as silhouettes. Hidden until the player has at least one earned achievement (same "no signal, no clutter" rule the finish screen uses).
- Compute path: client-side derivation from already-fetched data for v1 (zero new endpoint), OR server-side denormalised `userAchievements:{deviceId}` doc updated on each submission (point-read pattern from Feature G). v1 client-side is the cheaper start; promote to server-side denorm if the achievement set grows past ~30 rules or the client compute starts visibly delaying paint.

**Open design calls (settle when work starts, not now):**

- **Achievement *naming* and the storytelling layer.** "Cartographer" vs "Continental Master"? Each achievement needs a name, description, icon. Bigger writing task than the implementation. EN + PL.
- **Tiered vs binary.** "Played 10 daily puzzles" / "100" / "1000" as one tiered achievement with bronze/silver/gold, or three separate achievements? Tiered is denser; flat is simpler to design and easier to read.
- **Locked-state visibility.** Show silhouettes with hints ("Win a TTT match against someone you previously lost to") or hide entirely until earned (pure-surprise model)? Hints encourage replay; surprise feels rewarding.
- **Retroactivity.** Existing `dailyResults` / `quizRecords` / `tttPairs` rows mean v1 ships with many players already qualifying for streak / play-count achievements. Award them silently on first profile-page visit after Feature O launches, or run a one-time backfill notification? Silent is cheaper and matches the "calm" Feature N tone.
- **Animation on earn.** When an achievement is earned mid-session (player finishes a daily that crosses the 10-streak threshold), show a small celebration inline? Or only surface it the next time the player opens `/profile/`? Inline celebration is more delightful but adds wiring everywhere achievements can be earned.

**Out of scope even for Feature O:** point/XP system, achievement leaderboards (Feature K territory), social sharing of individual achievements (achievement-specific share grids), hidden / "secret" achievements ("play at 3am"), time-limited / seasonal achievements (Christmas badges etc.), missing-data backfill for events that aren't being tracked today (e.g. there's no way to retroactively award "shared 10 daily scores" for shares that happened before `shareEvents` started recording — that's the irretrievable-data argument for promoting Feature M Part B sooner rather than later).

---

## Done

### Feature T: Map interaction feel (Google-style bounds) — *shipped 2026-07-09*

**Problem.** The world map's pan / zoom felt far from Google Maps: you could zoom out into a void and drag the map off into empty page, and the drag wasn't fluent. Shared root cause is architectural (a single CPU-rasterised SVG, ~2224 paths, re-rastered per `viewBox` change) — see `.claude/skills/map-interaction` for the full journey.

**What shipped (Phase 1 — bounds + feel, PRs #745 → #748).** Google-style bounded feel, all pure `mapZoom.js` clamp logic threaded through per-mount `containZoomOut` / `freePan` options:
- **Free 1:1 drag** (absolute grab-offset, no clamp during the gesture) that **springs home** on release via a real damped-spring integration (`springStep`, tension 8 / damping 0.8, flick-velocity seeded).
- **Asymmetric vertical bounds:** the bottom is a hard wall (Antarctica pinned flush, no drag/zoom below it); the top is soft (drag up into ocean and it rests, `CONTAIN_TOP_REST_FRACTION = 0.15`).
- **Zoom-out** stops at a contain floor with a 25% ocean margin (`CONTAIN_ZOOM_OUT_MARGIN = 1.25`), bottom-aligned so Antarctica stays flush. Applies to every variant including Europe.
- Pale 1px hairline map border.

**Consciously NOT done (and why it's fine to close):**
- **Phase 2 (fluency via LOD / bitmap-pan)** — the render-cost lever was never pulled. After the free-drag + spring landed, the fluency complaints stopped, so it's "good enough." The option ladder lives in the `map-interaction` skill + `PERF.md`; reopen only if the map feels slow on a weak device.
- **Phase 3 (continuous L/R wrap)** — parked from the start ("maybe not even important"); needs a canvas basemap to be cheap. Documented in the skill.

### Feature S: Cost-minimal Cosmos architecture for 50k users — *shipped 2026-06-23*

**Status:** opened 2026-06-22. Triggered by the June bill (€4.31 MTD) — turned out four containers were on manual-400 throughput floors, totalling 2,400 RU/s provisioned against a 1,000 RU/s free-tier allowance, costing ~€5/mo from day one regardless of user count. Same-day fix migrated all containers to autoscale 100–1000 (idle floor now 600 RU/s under free tier → €0 going forward). This feature is the **strategic follow-up**: redesign so the site stays €0 even at 50k DAU spikes by removing the highest-write container and consolidating roaming user state.

**Problem.** Today's container set carries write-heavy data that doesn't need to be server-side:
- `engagementEvents` — 3-5 writes per active user per day (`daily_start`, `findflag_play`, `share`, `quiz_play`, `coffee_click`). At 50k DAU ≈ 150-250k writes/day, dominant Cosmos write source. Most kinds are pure analytics; the rest drive achievements that could live in localStorage.
- `quizRecords` — writes on every quiz finish (PB or not, per the `quizRecord.js:87-88` comment). ~50-100k writes/day at 50k DAU. Only PB writes need to reach the leaderboard; attempts/lastPlayedAt are private signals.

At 50k DAU on current architecture, sustained writes would push hourly RU bursts past 1,000 RU/s and start billing. Goal: design so the **provisioned floor + worst-case hourly burst** stays under 1,000 RU/s permanently, with manual throttling (429s) as the failure mode rather than a bill.

**End-state architecture:**
- `dailyResults` — unchanged (cross-user truth, leaderboard, community %)
- `dailyLeaderboards` — unchanged (derived from `dailyResults`)
- `profiles` — **expanded**: `{ deviceId, nickname, nicknameAuto, attempts: { quiz60s, quizAll, ... }, syncBlob: {...}, ... }`. Auto-created on first non-trivial action. Sync blob carries all roaming client state (achievement counters, share count, coffee clicks, 60s-streak day log) so cross-device sync still works.
- `quizRecords` — kept, **PB-only writes** (no more attempts/lastPlayedAt bumps — those move to `profiles.attempts`, synced every 100 increments)
- `tttPairs` — unchanged (low write volume, fine on autoscale 100 floor)
- ~~`engagementEvents`~~ — **deleted** at end of phased migration

Trade-offs accepted:
- `profiles.attempts` is bumpy (multiples of 100, not real-time). Live count shown to user from localStorage; server value is the persisted floor. Negligible UX impact.
- Engagement-derived achievement signals (share count, coffee count, 60s streak) move to localStorage. Cross-device roaming preserved via sync blob. A user who clears their browser between syncs loses up to one sync-window of progress — acceptable.
- Manual throttling under extreme spike: site degrades to 429s instead of billing. Hobby-site appropriate.

**Foundation that already exists (do not rebuild):**
- `flags/nickname.js` — `defaultNickname(deviceId)` already produces deterministic two-word names (FNV-1a hash → 50 adjectives × 50 nouns). Every viewer derives the same default for any deviceId without a server roundtrip. Phase 1 just *persists* this default into Cosmos + adds the `nicknameAuto` flag; the generator stays.
- `flags/identity.js` — `getOrCreateDeviceId` is the source of truth for the deviceId. Reuse as-is.
- Existing sync code (`syncHydrate`, `syncLink`, `syncClaim`, `syncMerge`) — Phase 2 swaps its transport to the new `profiles.syncBlob` field; the public sync-code UX stays identical.

**Phased plan (5 PRs remaining, each = one branch off `main`, tests included per PR):**

1. **Phase 1 — Auto-profile foundation.** *(Shipped 2026-06-22, PR #567.)* Triggered profile creation on first non-trivial action (daily submit, quiz finish, TTT match, share click, coffee click — not the home page). Added `flags/autoProfile.js` helper + `/api/v1/profile/ensure` endpoint that creates the row with `nickname=null, nicknameAuto:true`. When the user customises via `/profile/` page the server flips `nicknameAuto:false`. **No Cosmos cost change** — set up the foundation every later phase depends on.

   *Note:* a "Phase 1b" was planned to propagate `nicknameAuto` through the leaderboard write path and render a 🎲 marker next to auto-named entries. Drafted in PR #568, closed unmerged 2026-06-22 — not load-bearing for the cost goal, and the visual signal had unclear user value. The `nicknameAuto` field remains on `profiles` for future use (e.g., a "you haven't picked a name yet" nudge on the profile page) but does not flow through the leaderboard.
2. **Phase 2 — Sync blob field on profiles.** *(Shipped 2026-06-23, PR #569.)* Add `syncBlob: { ... }` field to the profile doc. `syncHydrate` returns the blob; client unpacks to localStorage. `syncLink` writes the blob from current localStorage. Roundtrip-tested. **No cost change** — keeps cross-device sync alive for the phases that move data client-side.
3. **Phase 3 — Stop writing `engagementEvents` + race-safe migration of existing data.** *(Shipped 2026-06-23, PR #570.)* Stopped all client-side `submitEngagementEvent` calls in `common.js`, `daily/page.js`, `flagQuiz/page.js`, `findFlag/page.js`, `ticTacToe/page.js`, `ticTacToe/9x9/page.js`. Deleted `api/src/functions/engagementEvent.js`, `api/src/lib/engagementDoc.js`, `flags/eventSubmit.js` (+ tests). Replaced achievement-driving emits (`share`, `coffee_click`, `quiz_play` 60s) with `localStorage.gridgame.engagementState` counter bumps via new `flags/engagementCounters.js`; pure-analytic emits (`daily_start`, `findflag_play`, `quiz_play` 'all') dropped entirely (no consumer). Each bump mirrors to `syncBlob` fire-and-forget. One-time pull-first migration via new `flags/engagementMigration.js` runs from `common.js` boot — sentinel-guarded, race-safe per the "Migration design" block below. Server-side `dailyMe` still reads `engagementEvents` (Phase 4 strips that) so achievement evaluation has continuity during the Phase 3 → Phase 4 window — the snapshot just freezes at deploy time. Pre-Phase-3 coffee click count collapses to 0/1 (server only knew boolean); pre-Phase-3 60s day log is lost (server didn't expose it) — both per "let's not worry about lost writes between phases" (Jan, 2026-06-23). **No Cosmos cost change yet** — container still alive until Phase 6.
4. **Phase 4 — Drop `engagementEvents` reads from `dailyMe`.** *(Shipped 2026-06-23, PR #573.)* Stripped the cross-partition `engagementEvents` query from `dailyMe.js`. The handler still computes the same snapshot fields (`dailySharesCount`, `quizSharesCount`, `findflagSharesCount`, `coffeeClicked`, `quiz60sCurrent/Max/DistinctDays`) — they now derive from `profile.syncBlob.engagement` instead. Same profile point-read that already covered nickname + linkedAt now also returns the syncBlob, so no extra query. `engagementCompute.js` rewritten to consume the blob shape; `streakCompute.js` swapped `quizPlayEventsToStreakRows` for `dayLogToStreakRows` (input is the sorted day-number array the client maintains in `flags/engagementCounters.js`). Client achievement evaluator unchanged — same dailyMe response shape, same predicates. Users who haven't completed Phase 3 migration by deploy time see zeroed engagement signals until their next counter bump re-populates the blob — acceptable per "let's not worry about lost writes between phases" (Jan, 2026-06-23). `engagementEvents` container now has **zero readers** — Phase 6 can drop it whenever traffic confirms the migration sentinel is universal.
5. **Phase 4.5 — Achievements read engagement from localStorage; throttle the syncBlob push.** *(Shipped 2026-06-23.)* Phase 4's `dailyMe` returned engagement signals from `profile.syncBlob.engagement` — which meant the achievement-on-action celebration was coupled to the syncBlob push cadence. Any throttle on the push would have blocked "Daily Sharer"-type unlocks until the next sync. Phase 4.5 inverts the source: new `flags/engagementSnapshot.js#mergeEngagementOverlay` reads the local `engagementCounters` state, derives the engagement snapshot fields (and 60s streak via a ported `flags/streakCompute.js`), and overlays them onto `dailyMe`'s response before predicates run. Local state is canonical for the device's own counters; the server is canonical for cross-device sync (which happens via `engagementMigration` on first boot and `syncMerge` on QR-link). With evaluation decoupled from push, `pushEngagementBlob` is now hard-capped at **one push per 30 minutes per device** — caps profile-row writes at ~48/day per active user, keeping the site within free-tier headroom even at 50k DAU spikes. Server still returns the engagement fields on `dailyMe` for backward compatibility (the overlay replaces them client-side); a future cleanup can drop them server-side.
6. **Phase 5 — Client-side throttle for `quizRecords` writes.** *(Shipped 2026-06-23.)* Original plan was to move attempts/lastPlayedAt off `quizRecords` and onto `profile.syncBlob.attempts` with a Phase-3-style migration. Jan re-scoped during implementation: the data is already in the right place — the actual problem is write **frequency**, not write **location**. So Phase 5 became a much smaller change: new `flags/quizRecordThrottle.js` with a pure `shouldPushQuizRecord` decision (PB beats fire immediately; give-up non-PBs skip the POST entirely since nothing consumes the bump; everything else is throttled to one push per 30 minutes per device). Wired at both finish sites in `flagQuiz/page.js` via a thin `maybeSubmitQuizRecord` wrapper. **No server change, no schema change, no migration** — the existing `quizRecord` endpoint just receives fewer writes. Server's `attempts` counter lags actual plays by up to one throttle window; `dailyMe`'s achievement counts derived from it are correspondingly delayed (acceptable — "Played 100 rounds" eventually fires). **Cost win:** ~80-95% reduction in `quizRecords` write volume at any traffic level.
7. **Phase 6 — Decommission `engagementEvents` container.** *(Shipped 2026-06-23.)* Ran ahead of the originally-planned 1-week grace because a one-off server-side backfill script (PR #574) rescued the pre-Phase-3 engagement signals for the 14 of 22 active profiles whose own client-side migration hadn't run in the Phase-3 → Phase-4 deploy window (8 had migrated cleanly, 2 had no engagement history). Deleted the container via `az cosmosdb sql container delete --account-name cosmos-yetanotherquiz-jg --database-name yetanotherquiz --resource-group rg-yetanotherquiz --name engagementEvents --yes`. Confirmed `az cosmosdb sql container list` shows 5 containers. **Cost win:** provisioned floor drops 600 → 500 RU/s (still under the 1,000 free-tier ceiling — bill stays €0); container count 6 → 5.

**Migration design (Phase 3 + Phase 5 share this shape):**

The naïve "read engagementEvents → write to localStorage → set sentinel" approach has a multi-device data-loss bug. Concretely: Phone A migrates first, earns one more share, pushes `shareCount=6` to syncBlob. Laptop B (same deviceId via QR-link) opens later, its localStorage sentinel is unset, it re-reads the original `engagementEvents` (still shows 5), and overwrites syncBlob back to 5. The post-earned share is gone.

**Pull-first ordering** fixes this: the blob is the canonical post-migration state. A device that finds a populated blob inflates from it and never touches the historical Cosmos rows. Only the FIRST device of a multi-device user actually reads `engagementEvents` (or `quizRecords` in Phase 5); every subsequent device hydrates from the blob the first one wrote.

The `engagementEvents`/`quizRecords` data is **read-only during the grace period** — neither phase rewrites or repopulates those containers. Phase 6 deletes `engagementEvents` outright; Phase 5 leaves `quizRecords` alive (PBs still write there) but no longer relies on the attempts/lastPlayedAt fields.

**`syncBlob` schema (settled now so Phase 3 migration code has a target shape):**

```json
{
  "v": 1,
  "engagement": {
    "shareCount": 12,
    "coffeeClickCount": 3,
    "quiz60sDayLog": [19000, 19001, 19003],
    "lastMigratedAt": 1750000000000
  },
  "attempts": {
    "quiz60s": 1500,
    "quizAll": 200,
    "lastMigratedAt": 1750000000000
  }
}
```

Top-level `v: 1` for future schema bumps. Per-section `lastMigratedAt` lets a Phase-3-only device (no `attempts` section yet) detect "blob exists but my section is missing, run partial migration" when Phase 5 ships later. The server stores the blob opaquely (Phase 2 plumbing); the schema is a client-side convention.

**Acceptable losses (call them out so we don't quietly regret them):**
- Users whose `engagementEvents` rows TTL'd before they returned (>1 year old) lose those signals. The TTL has always been 1 year; this was lossy before too.
- Users who never return during the 1-week Phase-3-to-Phase-6 grace get a fresh slate. Acceptable for a hobby site; the lost data was achievement counters, not gameplay state.
- A user who migrates on Device A while Device B is offline, then earns a share on B before B comes online, will have B's local-only counter blow away when B's migration finally pulls A's blob. **Mitigation:** B's migration only runs if its sentinel is unset; the moment B successfully runs migration its sentinel latches, so this is a single-event risk window. Acceptable.

**Open design calls (settle when each phase starts, not now):**
- **Phase 5: attempts counter granularity per mode.** Currently each mode (60s/all/per-variant) tracks attempts separately. Should the sync trigger be per-mode (each mode flushes at its own 100) or global (total attempts hits 100)? Per-mode is simpler.

**Out of scope (don't sweep in):**
- Folding `quizRecords` into `profiles` — keep separate, different access patterns (profiles is hot on every leaderboard render; quizRecords is cold).
- Server-side aggregate analytics dashboards — Feature Q (App Insights) will cover the analytics gap when it comes off the parking brake.
- Cosmos Free Tier replacement / serverless migration — current setup with autoscale + free tier handles the cost goals without account recreation.

### Feature R: Eliminate the daily-release scheduler — *shipped 2026-06-17*

**Problem.** The daily-release path failed three nights in a row (2026-06-15, 2026-06-16, 2026-06-17 — see `infra/release-incidents.md` for the journal). Three different scheduler attempts had bitten us across one week: GH Actions cron (drifted past Warsaw midnight by 75–135 min), Azure Logic App (worked briefly), Function App (host wedged after a Bicep redeploy, App Insights silent, would not register the `releaseDaily` function). The unit of failure was **the existence of a scheduler** — anything that has to "do a thing at a specific time" is a separate process whose health is a separate concern, and every variant we tried failed differently. With a 3-day trip coming up Jan needed structural change, not another debugging round.

**Goal that shipped.** Time becomes data, not a trigger. Every entry in `puzzles.json` carries its own `date`; the daily page filters `entries.filter(p => p.date <= warsawToday())` on every load. No scheduler, no Function App, no cron, no DST math at the trigger level. The whole class of "the autoreleaser failed" incidents is now impossible.

**Architecture that shipped:**

- **Storage:** `styetanotherquiz` blob storage (kept from Feature P — that part of the architecture works). One container `catalog/` with four blobs: **`puzzles.json`** (single source of truth, every entry past/present/future with its own `date`), `ideas.json`, `parked.json`, `policy.json`. Anonymous public-read, `Cache-Control: max-age=60`, blob versioning ON.
- **Reader:** `daily/page.js` fetches `puzzles.json`, computes `warsawToday()` via `Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Warsaw' })`, filters entries via `flags/puzzleFilter.js` `visiblePuzzles()` + `latestPuzzle()`. `daily/archive.js` uses the same filter. `daily/backlog/page.js` shows only future-dated entries (`date > warsawToday()`).
- **Validator** (`flags/dailyValidate.js`): `validateCatalog({ puzzles })` instead of `{ live, backlog }`. New rule 4b: every entry has `date: "YYYY-MM-DD"`, dates are unique, dates are contiguous (no gaps). Per-entry rules 1, 2, 3, 5, 6, 7, 14, 15 unchanged.
- **Server-side defence** (`api/src/functions/dailyResult.js`): the dated catalog is public-read, so a client could `POST` for a future `puzzleId` and pollute its aggregate. New `isReleased(puzzleId, warsawToday())` check rejects with 400 `not_released`. Implemented as pure `api/src/lib/puzzleDate.js` + `api/src/lib/warsawTime.js` (CJS twins of the page-side helpers, since `api/` is CommonJS).
- **Authoring:** `authoring/push.mjs` pushes `puzzles.json`; `authoring/pull.mjs` pulls 4 blobs; generator + ambiguity audit read `puzzles.json`. Append-with-date workflow: `n = prev.n + 1`, `date = prev.date + 1 day`. No promote step.

**Three phases, three PRs, all 2026-06-17:**

1. **R.1 (#483) — dated catalog + page filter + server-side `puzzleId` rejection.** One-shot migration script `scripts/migrate-to-dated-catalog.mjs` reads `.catalog/{live,backlog}.json` and writes `puzzles.json` with `date = anchor (N=12 → 2026-06-17) ± days`. Page + archive + backlog preview switch to the new shape; `live.json` + `backlog.json` blobs left in place as Phase-1 safety net. 32 new unit tests (warsawTime, puzzleFilter, puzzleDate, migrate-to-dated-catalog).
2. **R.2 (#484) — single-blob authoring + validator rewrite + skill rewrite.** Validator collapses to `{puzzles}` with date rules. Authoring tools (`push.mjs`, `pull.mjs`, generator, audit) drive off the single FILES list `[puzzles, ideas, parked, policy]`. Daily-puzzle-author skill rewritten: "promote" step disappears, replaced by "append with next free date." Decorative cleanup: dead `'live'`/`'backlog'` entries from `daily/catalogSource.js`, stale Logic-App/Function-App comments from `flags/daily.js` header.
3. **R.3 (#?) — demolition.** Deleted Azure resources `func-yetanotherquiz-release`, `plan-yetanotherquiz-release`, `ai-yetanotherquiz-release`, `log-yetanotherquiz-release`, `stfuncyetanotherquiz`, plus the auto-created `Application Insights Smart Detection` action group. Deleted code: `infra/release-fn/` (whole tree), `infra/funcapp-release-daily.bicep`, `scripts/build-release-fn.mjs`. Docs updated: `infra/operations.md` (drop Resources rows + Bicep-redeploy runbook), `infra/README.md` (drop Function App sections), `daily/README.md` (no more midnight Function diagram), `CLAUDE.md` "API / Azure Functions" (no second Function App). `infra/release-incidents.md` marked resolved by Feature R demolition, history preserved.

**Standing artifacts** (the load-bearing outputs future work inherits):

- `flags/warsawTime.js` `warsawClock` + `warsawToday` (and CJS twin at `api/src/lib/warsawTime.js`) — Warsaw-date helpers, DST-safe via `Intl.DateTimeFormat`. Reusable for any feature that needs "what Warsaw calendar day is it now?".
- `flags/puzzleFilter.js` `visiblePuzzles` + `latestPuzzle` — pure date-based catalog filters. The pattern (filter by date locally rather than schedule a job) is the load-bearing idea, not the helper.
- `api/src/lib/puzzleDate.js` `puzzleDateIso` + `isReleased` — server-side puzzle-id → date mapping. Couples to the "contiguous 1-per-day" invariant the validator enforces; if that invariant ever loosens, this switches to a blob lookup.
- `flags/dailyValidate.js` with the date-contiguity rule — every new puzzle is checked against the rule at push time. Gaps and duplicates fail before publish.
- `puzzles.json` blob shape itself — `{ n, date, filter | kind:'manual'+title, answers, description }`. Future schedulers (if we ever bring back time-of-day flexibility, holiday skips, etc.) extend this rather than adding a separate trigger.

**Key decisions, preserved for future "why don't we just …" questions:**

- **Why client-side filter, not API-side.** Every daily page load would route through a Function App, taking on cold starts (Free SKU = 1–2 s after idle) and a new boot-failure surface. The daily page is now static-page + public-blob = the most reliable surface on the site. Client filter keeps it that way.
- **Why one blob, not per-date blobs.** Per-date would mean N fetches for the N-day archive page. One blob is ~28 KB at 72 entries — rounding noise.
- **Why public-read despite the "anyone can curl tomorrow" trade-off.** Knowing "Europe + cross + blue" doesn't solve any puzzle for you — the player still has to recognise flags. Security-through-obscurity wasn't load-bearing. If it ever becomes load-bearing: encrypt entries with a date-derived key on the page (~10 lines), don't add a server.
- **Why `n` preserved across the migration.** Every `dailyResults` Cosmos row references `puzzleId === n`; same for leaderboard partition keys and share links. Switching the identity scheme would have required a Cosmos migration on top of everything else. Just stamping `date` onto the existing `n` was free.
- **Why "dates contiguous (no gaps)" was the validator rule rather than "monotonically increasing."** Strict contiguity catches the "tonight's puzzle is missing" bug at test time before it ships. The cost (can't deliberately skip a day) is small and reversible — switch to a "fill with a placeholder entry" pattern if needed.

**Notable journey, preserved for posterity:**

- The original instinct on the morning of 2026-06-17 was to debug the wedged Function App. Diagnostic commands were drafted in `infra/release-incidents.md`, then deleted in Phase 3. Time spent debugging the scheduler would have been time not building the alternative; the right call was to write down what would have been the next session's plan, then delete it.
- The first migration cut (R.1) hardcoded five fields when copying entries to the new shape and dropped #72's `kind: 'manual'` + `title` fields silently. Caught by tests in R.2. Fixed by spread-then-stamp-date pattern. Lesson pinned: when migrating between shapes, prefer field-preserving spread + explicit overrides over field-listing object construction.
- Feature R inherited Feature P's blob storage + authoring CLI surface, then deleted Feature P's Function App. Feature P was the first move ("get release off the SWA deploy"); Feature R was the second ("get release off any scheduler"). Both shipped within 48 hours of each other — the second was triggered by the first failing on the same night the second night of the new architecture.

**Out of scope, intentionally deferred** (captured here so they don't drift back in): encrypted future entries on the blob (one-line escape hatch tracked above); a new admin UI for catalog management (the agent skill is the UI); per-puzzle release-date *time* (puzzles release at midnight Warsaw implicit in the `date` field — bring it back if needed by adding a `time` field); migrating `dailyResults` Cosmos rows (they reference `puzzleId === n` which is preserved — no data migration); rename `daily/backlog/` URL (kept for stability; "future schedule preview" semantics).

**Key PRs.** #482 (Feature R spec drafted), #483 (R.1 — dated catalog + page filter), #484 (R.2 — single-blob authoring + validator + skill), Phase 3 PR (R.3 — demolition).

### Feature P: Decouple daily-puzzle release from the SWA deploy — *shipped 2026-06-15, superseded by Feature R 2026-06-17*

**Status.** Feature P shipped its three phases on 2026-06-15/16 — Phase 1 (blob exists, page reads, workflow uploads) and Phase 3 (repo files out, CLI tools in) survived intact and are still load-bearing. Phase 2 (timer-triggered Function App as the midnight runner) was the part that failed under real-world conditions, and Feature R demolished it on 2026-06-17.

**What Feature P solved that's still live:** the daily page reads its catalog from a public-read Azure blob (`styetanotherquiz/catalog/`) instead of bundled JSON files, so an SWA deploy flake (Docker pull throttle, content-distribution flap, regional outage) no longer blocks the puzzle from updating. The authoring CLI (`authoring/pull.mjs` + `push.mjs`) replaced the commit-and-deploy authoring loop. `.gitignore` adds `.catalog/`. Validation extracted to `flags/dailyValidate.js`.

**What Feature P got wrong:** Phase 2 traded "shared GH Actions runner / Logic App" for "standalone Function App" — same fundamental architecture (a runner that must fire at a specific time), different failure modes. The Function App wedged after a Bicep redeploy on 2026-06-16 (host returned 503 below the admin surface, App Insights silent), the GH Actions fallback Jan re-introduced also failed, and the manual `push.mjs` was the only working path. Feature R's "delete the scheduler entirely" was the structural response.

**Key PRs from the Feature P era.** #463 (spec), #464 (Phase 1 — page reads blob), #465 (Phase 2 — Function App provisioned), #466 (Phase 2 cleanup — DST-resilient schedule + delete dormant code), #467 (Phase 3 — blob is sole source of truth), #468–#472 (audit passes, dead-script cleanup). Phase 2-related code (`infra/funcapp-release-daily.bicep`, `infra/release-fn/`, `scripts/build-release-fn.mjs`) deleted by Feature R Phase 3.

### Feature C: Cross-device link via QR-claim — *shipped 2026-06-16*

**Goal.** A user playing on phone + laptop links the two browsers in one round-trip so daily streaks, archive PBs, quiz records, and nickname follow them across both. No accounts, no passwords, no email. Existing rows from the "joining" device migrate into the "host" device's namespace so history is real, not just forward-looking.

**Design that shipped (QR-claim, *not* passkey — see "Notable journey" below):**

- **No new Cosmos container.** Original plan added `passkeys`; the QR pivot deleted it. The merge writes into existing rows (`dailyResults`, `quizRecords`, `tttPairs`, `engagementEvents`, `profiles`) by rewriting their `deviceId` to the target's.
- **Two new HMAC-signed-token endpoints (stateless, no transient container):**
  - `POST /api/v1/sync/claim/token` — Device A mints a 5-min claim token + claim URL + inlineable SVG QR. Token wraps `{ deviceId, expiresAt }` under `PASSKEY_HMAC_SECRET` (name preserved across the pivot — the secret's job, HMAC over short-lived tokens, didn't change).
  - `POST /api/v1/sync/claim/redeem` — Device B posts the token. Server validates HMAC + expiry and returns Device A's `deviceId`.
- **Merge pipeline (four endpoints — `syncMerge` + `syncPreview` survived the pivot; `syncLink` + `syncHydrate` added in #458):** `sync/preview` (server-side conflict diff: nickname mismatch + overlapping daily puzzles), `sync/merge` (atomic per-row deviceId rewrite), `sync/link` (target's self-discovery: GET checks `profiles[deviceId].linkedAt`), `sync/hydrate` (post-merge pull of `dailyResults` + `quizRecords` + `nickname`).
- **Flow.**
  1. Device A: `/profile/` → "Sync across devices" → `/profile/sync/` → auto-mints QR on boot.
  2. Device B: scans QR (or opens the fallback link) → `/profile/sync/?claim=<token>` → server redeems → server-side preview.
  3. If conflicts: two-question wizard (nickname source, daily-overlap source) with iOS-toggle UI; if no conflicts: silent merge.
  4. Server rewrites Device B's rows into Device A's `deviceId`, stamps `linkedAt` on the target profile row, both clients now share one deviceId.
  5. Client hydrates: overwrites `localStorage.daily.scores` + `flagquiz.best.*` + `gridgame.nickname` from server.
- **Ambient background sync.** `trySyncDevices()` fires on the boots of `daily/page.js`, `daily/archive.js`, `flagQuiz/page.js`. Two gates: (1) no `localStorage.gridgame.identityId` → immediate return, zero network — **the 99% of unlinked players pay one localStorage read per page load**; (2) 1h staleness gate, stamped before the await so concurrent tabs don't double-fire. Worst case for linked players: 24 hydrates/day.
- **Burger-menu integration.** Static "Sync across devices" item mounted by `common.js` `mountSyncMenuItem` + `paintSyncState` — single source of truth across daily / archive / flagQuiz / findFlag / profile. No "✓ Synced" toggle (was misleading — the link still goes somewhere actionable).

**What shipped (seven PRs, no clean phase numbering because the design pivoted mid-feature):**

1. **C.1 — passkey backend (#452).** `passkeys` container provisioned. `@simplewebauthn/server` integrated. Four endpoints (register/auth × begin/verify). HMAC-signed stateless challenges via `PASSKEY_HMAC_SECRET`. Pure libs (`passkeyDoc.js`, `passkeyVerify.js`) + tests. **All ripped out in #456.**
2. **C.2 — passkey UI behind `?test` (#453).** `flags/passkeyClient.js` + `/profile/`-mounted "Save across devices" / "Claim from another device" buttons. `syncMerge.js` engine + 26 tests landed here and survived the pivot. Gated behind `?test` for real-device validation. (#455 patched a first-link auth-cancel fallthrough.)
3. **The pivot — QR-claim (#456).** Real-device validation surfaced cross-ecosystem friction: rpID scoping (`yetanotherquiz.com` vs. `www.yetanotherquiz.com`), TPM-bound credentials that wouldn't sync, hybrid-QR chicken-and-egg on iOS↔Android. Replaced WebAuthn entirely with a QR-displaying-a-signed-token. **Net diff: −1500 lines.** Deleted: 4 passkey endpoints, 5 passkey libs, `flags/passkeyClient.js`, `@simplewebauthn/server` + 23 transitive deps, the `passkeys` Cosmos container (via `az`). Added: `syncToken.js` (HMAC), `syncClaimToken` + `syncClaimRedeem` endpoints, `syncClaimClient.js`, `qrcode-svg` in `api/package.json`. The merge engine + wizard + `?test` gate carried over unchanged.
4. **Gate removal + wizard iteration (#457).** Dropped `?test` — sync went GA. Wizard radios → iOS-style two-label toggle; compacter copy; auto-mint QR on `/profile/sync/` boot (dropped intro paragraph, "Show QR" button, help dialog). Kept `?wizard-preview` URL helper for future iteration.
5. **Four-bug triage + ambient background sync (#458).** (a) Burger menu no longer flips to "✓ Synced" after link. (b) Target device now self-discovers linked state via the new `linkedAt` field on its profile row + boot poll. (c) QR stays visible after linking (was gated behind "not yet linked"). (d) Archive / quiz PBs hydrate post-merge via new `sync/hydrate` endpoint. Plus `trySyncDevices()` ambient hook on daily / archive / flagQuiz boots. Shared `.loading-dots` graduated to `common.css`.
6. **Nickname hydration + linked-state polish (#460).** Hydrate endpoint extended with `nickname`; client writes to `localStorage.gridgame.nickname`; `profile/page.js` self-heals on first visit after link (bypasses staleness gate). Loading states for profile-stats + sync-mint reuse `.loading-dots`. QR fallback URL collapsed into `<details>`. "Device is linked." pane pulses 3× via the shared `cell-shake` keyframes (per CLAUDE.md "same mechanism = same code") on the unlinked→linked transition only.
7. **Profile cleanup + wizard rewrite + menu colour (#461).** Streak block dropped from `/profile/` (concept moved to Feature O achievements per the 2026-06-15 pivot). "Buy me a coffee" reverted to primary near-black (was overridden to pink). Wizard buttons restyled to text-link idiom matching `/profile/` actions-row; question labels collapsed to two short lines; `?wizard-preview` now switches between all three real shapes (`=both` / `=profile` / `=daily`).

**Standing artifacts** (the load-bearing outputs future work inherits):

- `api/src/lib/syncToken.js` — generic HMAC-signed short-lived token wrap/unwrap (5-min default). Any future "device A hands a one-time capability to device B" reuses this verbatim — same pattern would work for, e.g., transferring a custom puzzle without going through the share-link surface.
- `api/src/lib/syncMerge.js` — pure merge engine: nickname/daily/quiz/tttPairs row-rewriting under a single `targetDeviceId`. 26 tests pin the merge semantics. Survived the pivot intact.
- `api/src/functions/syncHydrate.js` + `flags/syncHydrate.js` — server contract + client hydrator. The server-side "pull every row this device owns into one payload" shape is the canonical mechanism for "linked device just opened a stale browser" recovery.
- `flags/syncHydrate.js` `trySyncDevices()` — the ambient background-sync substrate. Identity-gated (free for unlinked) + staleness-gated (1h default) + concurrent-tab-safe. Any future per-device cross-tab freshness check uses this pattern.
- `linkedAt` field on profile rows — target's self-discovery hook. Pattern: write a field on the target when the source mutates state, target polls cheaply on boot, client back-fills `identityId` locally to short-circuit subsequent loads.
- `mountSyncMenuItem` + `paintSyncState` in `common.js` — single source of truth for the menu's sync entry across every page. New pages with chrome pick it up by calling these.
- Shared `.loading-dots` in `common.css` — pulsing-dots loading idiom, originated on daily-stats, now consumed by sync-mint + profile-stats + post-scan progress.

**Notable journey, preserved for posterity** (so the next "why don't we just use passkeys?" comes with built-in context):

- Original plan (2026-06-15 promotion, PR #451) was identityId-propagation: every write-path endpoint gains an optional `identityId`, all existing rows get cross-partition-backfilled on first passkey registration. The C.3 mega-diff (25 files) was rolled back mid-flight — too much surface area, too many partition-key implications, too much retroactive write amplification on top of an unsettled identity model.
- Pivoted to **adopt-deviceId + auto-merge**: the joining device adopts the host's deviceId on first link, all subsequent writes naturally land in the right partition with zero per-write identityId plumbing. Shipped as #453 (UI behind `?test`).
- Real-device validation immediately surfaced WebAuthn cross-ecosystem friction (see #456 description). The signed-token-in-a-QR replacement was both simpler and trivially cross-ecosystem — the QR is just bytes; any browser camera resolves it. Passkey deletion was net-zero infra impact and −1500 lines.
- **Takeaway pinned for future feature design:** when a cross-platform UX touchpoint is the load-bearing path, prototype on the *actual* second platform before locking in the protocol. WebAuthn's spec looks clean on paper; the rpID scoping, TPM-bound-credentials, and hybrid-QR realities only show up under real-device validation.

**Out of scope, intentionally** (captured so they don't drift back in): unlink / revocation UI ("remove this device's link" — V1 deferral, possibly never if the rare-case feedback is "just clear my localStorage"); recovery if both linked devices are lost simultaneously (passkey ecosystem-sync was supposed to be the recovery story; with QR-claim the answer is "nothing automatic — re-bootstrap from server-side rows tagged with the lost deviceId" which today means contacting Jan); >2 devices in a link chain (today: any third device that scans the QR adopts the same deviceId, which works but isn't a designed UX); cross-link transfer ("merge two existing pairs into one identity"); usernames / emails / login forms; `dailyResults` partition-key change (Feature C-era plan that became moot once the model dropped identityId-propagation).

**Key PRs.** #451 (promotion — passkey-era plan, now historical), #452 (C.1 passkey backend, ripped out), #453 (C.2 passkey UI behind `?test`, partially ripped out — `syncMerge.js` + wizard survived), #455 (auth-cancel fallthrough, removed with #456), #456 (the pivot — passkey → QR-claim, −1500 LOC), #457 (`?test` gate removal + wizard iteration), #458 (four-bug triage + ambient background sync), #460 (nickname hydration + linked-state polish), #461 (profile streak drop + wizard rewrite + menu colour).

### Feature M Part B: Engagement-event substrate — *shipped 2026-06-15*

**Goal.** Capture engagement signals (shares, custom-puzzle plays, daily starts, TTT outcome ordering) that are cheap to write but irretrievable if not captured — the rule Jan settled on 2026-06-15. Two consumers, same writes: Feature O reads to award achievements; Jan reads for DAU / completion-rate / D1 / D7 retention.

**Design that shipped (one container + one field):**

- **Container:** `engagementEvents` — partition `/deviceId`, autoscale 100–1000 RU/s, TTL 31_536_000 (1 year). Provisioned 2026-06-15 (M.B.1).
- **Doc shape:** `{ id, deviceId, kind, dayId, occurredAt, payload, local?, v: 1 }` — `kind` discriminates `'daily_start' | 'findflag_play' | 'share'`; `payload` is a tagged union validated server-side per kind. `dayId` is `warsawDayNumber` (integer) — matches `streakCompute`'s axis.
- **Per-kind id schemes:** `daily_start:{dayId}:{puzzleId}` (deterministic — 409 is the natural "already started" dedup); `findflag_play:{uuid}` and `share:{uuid}` (non-deterministic — every play / share is a distinct row).
- **Per-kind payload:** `daily_start: { puzzleId }`; `findflag_play: { filter, mode: 'random' | 'custom' }`; `share: { surface: 'daily' | 'findflag' | 'flagquiz' | 'ttt', contextHint? }`.
- **Endpoint:** `POST /api/v1/event` — anonymous, 60/min/IP rate-limited, server-stamps `dayId`, `occurredAt`, `local` (from request-host check).
- **Lib:** `api/src/lib/engagementDoc.js` `buildEngagementDoc(...)` — pure, per-kind payload validation, defensive payload stripping.
- **Client:** `flags/eventSubmit.js` `submitEngagementEvent(deviceId, event)` — single fire-and-forget helper used by every call site. Never throws; treats 201 + 409 as success.
- **`tttPairs.lastOutcome` field:** lives on the existing pair row (not in `engagementEvents`) because it's per-pair *state* (helps detect revenge), not an event-stream item. `mergePairResult` sets it on every upsert. Zero migration: pre-existing rows treat missing field as "no prior history."

**What shipped (four phases):**

1. **M.B.1 — substrate + `share` wiring.** Container provisioned via `az`; lib (23 tests) + endpoint + client helper (8 tests) added. Share events wire from `common.js` `shareText()` / `shareUrl()` on `'shared'` or `'copied'` (not `'dismissed'` / `'failed'`) — fires across daily, flagQuiz, findFlag, TTT 3x3, TTT 9x9 share buttons.
2. **M.B.2 — `findflag_play` wiring.** Fires on findFlag page-mount when `?f=…` resolves to a playable puzzle. Mode hint flows through a one-shot `sessionStorage['findFlag.mode']` flag the Random buttons set before navigating (Play button + externally-shared links default to `'custom'`).
3. **M.B.3 — `daily_start` wiring.** Fires once per round on first focus of the country-search input — the clearest "intent to play" signal on the text-input flow (no cell-click grid). One-shot via `{ once: true }`. Author-only sister pages (`daily/ideas/`, `daily/backlog/`) don't pass the callback so previews stay event-free.
4. **M.B.4 — `tttPairs.lastOutcome` field.** Single field add; `mergePairResult` sets it on every upsert. Unlocks the future "revenge win" achievement (Feature O) — detect `existing.lastOutcome === 'loss' && new outcome === 'win'` at write time without a per-game container.

**Standing artifacts** (the load-bearing outputs future work inherits):

- `api/src/lib/engagementDoc.js` `buildEngagementDoc` + tests — every future kind composes a payload validator and an id scheme through this same dispatcher.
- `api/src/functions/engagementEvent.js` — single `POST /api/v1/event` endpoint. New kinds extend the lib's validator, no new endpoint or container needed.
- `flags/eventSubmit.js` — fire-and-forget contract. Any future client surface uses this verbatim.

**Open design calls settled in flight (preserved for forward reference):**

- **`dayId` semantics.** `warsawDayNumber` integer — Warsaw because that's the daily-puzzle clock (Logic App at 00:05 Warsaw per Feature E).
- **Fire-trigger for `daily_start`.** First focus of the search input. Page-mount over-counted (bots, preview-renderers, curious-bouncers); first cell click doesn't map to a text-input flow.
- **`share` tracks success-only.** After the share/copy resolves. `'dismissed'` and `'failed'` don't fire — count reflects shares that actually happened.
- **Cosmos write volume.** Worst case ~1 daily_start + a few findflag_plays + 0–1 share per device per day. At Free Tier 1000 RU/s this is rounding noise.
- **Admin gate for DAU/D1/D7 reads.** Out of scope — pure-SQL via Cosmos Data Explorer covers the first six months. Real `/admin/metrics` page deferred until SQL-pasting friction is felt.

**Storage cost.** ~200 bytes × (~5 events) × ~50 DAU × 365 days ≈ ~18 MB/year. Rounding noise vs the 25 GB Free Tier ceiling.

**Key PRs.** #446 (M.B.1 — substrate + share + container provisioning), #447 (M.B.2 — findflag_play + operations.md follow-up), #448 (M.B.3 — daily_start), #449 (M.B.4 — tttPairs.lastOutcome).

**Out of scope, intentionally deferred** (captured so they don't drift back in): per-cell heat-map of where players drop, partial-completion analytics (started 10 cells, finished 3), per-game TTT history rows (`lastOutcome` field handles ordering), A/B testing infra, public stats page, GA4 / Plausible / self-hosted Umami (CF Analytics covers visit counts), findFlag *result* events (no fixed round end — Play-start is the only meaningful trigger), flagQuiz *play-start* events (every flagQuiz play writes `quizRecords` with `attempts+1` per F5, so start is already captured downstream — only share is new data here), make-a-puzzle as a *separate* event kind (findFlag custom-play IS make-a-puzzle — same wire).

### Feature M Part A: Cloudflare Web Analytics — *shipped 2026-06-14*

Zero code; CF auto-injects the beacon at the edge for proxied zones. First setup pass left the EU-exclude default on, which silently dropped all Polish (and other EU) traffic — the dashboard showed only US/Canada visits despite Jan's known PL user base. Flipped to "Enable" (no EU exclusion); CF Web Analytics is cookieless and hashes IPs, so the GDPR posture is acceptable for the hobby-site use case. Privacy page disclosure shipped in PR #421. Dashboard now shows DAU + visit count + Top Pages + per-country geographic breakdown, bot-filtered server-side. Defends the "are we even seeing humans" question that prompted the whole L/M/N framing. **Part B** (engagement-event substrate for achievements + analytics) is now in `## Now` — promoted 2026-06-15 with a globally-designed single-container shape (`engagementEvents`) instead of the originally-spec'd three-container split.

### Feature N: Daily streaks — finish screen + profile page — *shipped 2026-06-15*

**Goal.** Surface a returning-player number on the daily finish screen that makes coming back tomorrow feel like it matters, and a dashboard view of the same numbers on `/profile/` for the "I want my stats" surface. Derived server-side from existing `dailyResults` rows — no new container, no migration.

**Shape that shipped.** Finish screen splits "your stats" from "community stats" by position: personal block inline in the headline (only when `currentStreak ≥ 2` — no signal, no clutter), community block below. Profile page reads the same endpoint and renders Current streak + Best streak (hidden until `totalPlayed ≥ 1`). Win-rate row deliberately omitted on the profile page — by construction every `dailyResults` row is a completion, so even with the M Part B start-event denominator the resulting "submitted ÷ started" ratio doesn't measure what a player would intuit from "win rate" (a 1/4 finish and a 4/4 finish both count as 100%). Profile direction pivots from "stats dashboard" to "achievements" — see Feature O. The endpoint still returns `winPercent` in case a future surface wants it, but no user-facing UI plans to render it.

**What shipped (four phases):**

1. **N1 — pure compute + tests.** `api/src/lib/streakCompute.js` exports `computeStreak({rows, latestId?})` (rows are `{id, completed}` keyed on any consecutivity axis — for daily streaks the caller passes Warsaw day-numbers) and `submissionsToStreakRows(docs, dayFn)` (the dedupe layer; multiple submissions on the same calendar day collapse to one entry). 22 unit tests. *(Originally landed at `flags/streakCompute.js` in PR #438; relocated to `api/src/lib/` during N2. N1 spec originally said "consecutive puzzleIds" — corrected during N3 to "consecutive Warsaw days" after Jan caught that doing archive puzzles #1, #2, #3 in one sitting would incorrectly show streak = 3.)*
2. **N2 — read endpoint.** `GET /api/v1/daily/me?deviceId=…` in `api/src/functions/dailyMe.js`. Cross-partition `SELECT c.submittedAt FROM c WHERE c.deviceId = @did` against `dailyResults`, maps to Warsaw day-numbers via `warsawDayNumber`, dedupes, calls `computeStreak` with `latestId = today` (server computes "today" itself so a player who skipped today gets `currentStreak: 0`). 60s in-Function cache keyed by `deviceId`, `?fresh=1` bypass, 60/min/IP rate limit, `local:true` rows included.
3. **N3 — finish screen wiring.** New `daily/streakClient.js` (`fetchDailyMe`, never-throws, defensive shape normalisation, 11 tests). `daily/page.js` fires the fetch after both natural-finish and revisit paint, but **only when `n === todayN(catalog)`** — an archive finish doesn't extend the streak counter, so surfacing the line there would falsely suggest the archive play bumped it. `paintStatsPanel` composes the streak inline ("Twój wynik: 2/27 · Średni wynik: 20.6/27 · Seria dni: 2 · ⌬") only when `currentStreak ≥ 2`. i18n strings under `daily.streak.line`. **N3 also corrected the puzzleId → Warsaw-day semantics from N1/N2:** added `api/src/lib/warsawDay.js` (DST-safe via `Intl.DateTimeFormat`, 8 tests) and renamed the StreakRow field `puzzleId` → `id`.
4. **N4 — profile page wiring + adjacent palette cleanups.** `/profile/` imports `fetchDailyMe` and renders Current streak + Best streak; form re-orders so Save · Home stays anchored at the bottom whether stats are shown or not. Title key renamed `nickname.editTitle` → `profile.title` (page is no longer nickname-only). Folded into the same PR per the "UI polish iterates on one branch" rule: `findFlag/index.css` `.find-input.wrong` red border + red wash → pink border via `var(--secondary-color)`, no wash (fixes both findFlag and daily since daily includes findFlag/index.css); `flagQuiz/index.css` `@keyframes penalty-flash` red `#c5302d` → `#666` swapped to `var(--secondary-color)` → `var(--muted-color)` so the timer's penalty pulse uses brand pink and lands back on the same muted colour `.play-timer` declares at rest.

**Open design calls settled in flight (preserved for forward reference):**

- **Win = completion** (any score). Score-threshold definition creates a "what counts as a win" debate every time a puzzle gets harder.
- **Streak break = missed day OR played-but-didn't-finish.** Otherwise half-trying every day keeps the streak alive, which dilutes the badge. (Today no source produces a `completed:false` row — `submissionsToStreakRows` always emits `completed:true`. The shape stays open for Feature M Part B's start-event signal.)
- **Identity scope: per-deviceId today.** After Feature C lands, dedupe by identityId where present, deviceId otherwise.
- **Why not localStorage caching:** the explicit reason for server-side compute was "streaks survive browser cache clears." LocalStorage caching reintroduces the staleness / cross-device-drift problem we're avoiding. The 60s in-Function cache covers the same RU concern without that downside.

**When to materialize a per-device aggregate doc** (deferred until felt): ship a new container `dailyStreaks` partitioned by `/deviceId`, doc shape `{ id: deviceId, currentStreak, maxStreak, totalPlayed, totalCompleted, daysSet, lastUpdatedAt, v }`, upserted from `dailyResult.js` on every finish. `dailyMe.js` becomes a point-read (~1 RU). Same pattern Feature G uses for `tttPairs`. **Trigger any one of:**

- Cosmos account total RU/s consumption sits sustained above **800 RU/s** (80% of Free Tier 1000) — visible in `cosmos-yetanotherquiz-jg` portal metrics.
- `/api/v1/daily/me` p95 latency creeps above **500ms** (today ~50-100ms warm, ~1-2s cold) — Application Insights `dependencies` panel filtered to `dailyMe`.
- Puzzle count crosses **~300** (~10 months of daily releases from 2026-06-15) — at that fan-out, ~10-15 RU per uncached fetch starts being felt.

Don't ship before any of these fire — the write amplification (every `dailyResult` insert gains a second Cosmos round-trip) buys nothing until the read path actually hurts.

**Standing artifacts** (the load-bearing outputs future work inherits):

- `api/src/lib/streakCompute.js` `computeStreak` + `submissionsToStreakRows` — pure, generic, keyed on any consecutivity axis. Any future "streak counter on X" reuses these.
- `api/src/lib/warsawDay.js` `warsawDayNumber` — DST-safe Warsaw-day mapping via `Intl.DateTimeFormat`. Reusable for any feature that needs "did these two events fall on the same Warsaw calendar day?".
- `daily/streakClient.js` `fetchDailyMe` — the contract for reading `/api/v1/daily/me`. Both the finish screen and the profile page compose this; future surfaces (archive grid badge, etc.) do the same.

**Key PRs.** #438 (N1), #439 (N2), #440 (N3), #441 (N3 follow-up: live offensive-nickname check + pink moderation colours), #442 (N4 + red→pink palette fixes).

**Out of scope, intentionally deferred** (captured so they don't drift back in): streak freezes / makeup days, weekly streaks, public streak leaderboards (Feature K territory — already shipped for *daily* leaderboards), retroactive push notification, in-grid "your streak" badge on the archive page, per-mode streaks if the daily ever forks, the win-rate row on the profile page (concept dropped permanently — see the Shape note above; profile direction moves to Feature O achievements).

### Feature L: Wordle-style shareable result grid + touch-only share alignment — *shipped 2026-06-14*

**Goal.** After finishing the daily puzzle, the player taps a small share icon inline at the end of the stats headline ("Your score: 2/4 · Average score: 3.4/4 · ⌬") to copy a Wordle-style teaser to their clipboard or fire the OS share sheet. Payload: title line + emoji grid (🟩 found / ⬛ missed, canonical answer-set order, 5 cells per row) + the daily URL. No country names, no flag emojis — the grid is a structural teaser, share-safe.

**What shipped (one PR, six-commit branch, 2026-06-14):**

1. **Pure renderer** `flags/shareGrid.js` `buildShareText()` + 8 unit tests covering all-found / all-missed / ragged-tail / canonical-order / off-set inputs.
2. **`shareText()`** added to `common.js` as a sibling of `shareUrl()` with the same three-tier fallback (`navigator.share` → `navigator.clipboard.writeText` → legacy textarea + `execCommand('copy')`). 4 tests pin the payload-shape difference vs `shareUrl`.
3. **Daily wiring** in `daily/page.js` — `setShareCtx` + `createShareButton` pair. `paintStatsPanel` appends the button inline at the end of `.daily-stats-headline` on every repaint (loading → score-only → score-with-stats). Module-ref state so the panel-paint code stays oblivious to puzzle details.
4. **i18n** EN + PL: `daily.share.aria` (button label) + `daily.share.title` template `"Yet Another Quiz — Daily #{n} — {score}/{total}"`.
5. **Touch-only share-icon rule, site-wide.** Daily, findFlag (`#game-share` + `#result-share`), and TTT's `#share-link` are all gated behind `matchMedia('(pointer: coarse)')`. The findFlag side was previously always-on; brought into line in the same PR (briefly its own PR #423, folded in during consolidation). Single rule across the whole site now: share-icons are touch-only.

**Why touch-only.** On desktop, `navigator.share()` opens the OS share sheet (Windows Share dialog with Teams / Outlook / Copilot tiles, macOS share menu) which is visually heavy for what is conceptually "copy this string somewhere." A silent clipboard-only path was the alternative but proved too quiet to be discoverable. Hiding the icon on desktop where the share-loop audience isn't anyway is cleaner than introducing a bespoke desktop feedback affordance.

**Mid-flight finds captured in commits (real lessons, not nits):**

- First wiring wrapped `#final-score-line` in a new `.final-score-row` div to host the button. That broke `#result > .final-score { display: none }` (selector no longer matched the now-grand-child) and the historically-hidden "You found 2 / 4" line came back big and ugly above the panel. Revert the wrapper; move the icon into the stats headline.
- Vertical alignment was off because the headline `<p>` was inline + `vertical-align: middle` on the share-link. Switch the headline to `display: flex; align-items: center` — same pattern findFlag's `.final-score-row` and TTT's `.room-line` already use.
- Separator spacing was asymmetric (text-internal `·` vs flex-gap `·`). Fold the trailing " · " into the text span so the rhythm matches `"score: 7/9 · Average"`.
- Icon colour clashed (brand red link colour vs `#333` headline). `color: inherit` inside the headline.

**Standing artifacts** (the load-bearing outputs future work inherits):

- `flags/shareGrid.js` + tests — the contract for "render an emoji grid from a found/answer set". Future game modes that want a similar share grid compose the same module.
- `common.js` `shareText()` — the three-tier fallback for any future multi-line share payload (sibling to the existing `shareUrl()` for bare URLs).
- The "share-icons are touch-only across the site" rule — pinned in TTT, findFlag, and daily via the same `matchMedia('(pointer: coarse)')` check. Apply the same gate when adding share affordances to any future surface.

**Key PR.** #422 (six commits; folded in the touch-only alignment work that was briefly #423 before consolidation).

**Out of scope, intentionally deferred** (captured here so they don't drift back in): **Open Graph / Twitter Card meta** on `daily/index.html` so the chat-app link-preview card shows something puzzle-specific instead of the generic site favicon (~10-line follow-up; consider as a quick win to amplify the share loop). **Canvas-to-PNG image rendering** for visually-rich shares. **`?d=YYYY-MM-DD` deep-link routing** so a recipient sees the same puzzle on click-through (currently `daily/` always serves today's). **Share-count tracking** — would need a Cosmos write per share; wait for Feature M Part B's event-counter infrastructure.

### Feature K: Daily leaderboard on flag-quiz finish screen — *shipped 2026-06-12*

**Goal.** After a flag-quiz round (Europe 60s, All endurance, etc.) the result screen shows the player's own score *and* the top-10 leaderboard for that exact configKey, with the caller's row highlighted when visible and a "…N. You" suffix when their rank is past the top 10. Per-configKey (one for `europe:60s:sov`, one for `africa:all:sov`, etc.) — reuses the existing quiz-record key, no new taxonomy.

**Window has grown since ship.** Originally a single-UTC-day board (48 h TTL, "today's top-10", nightly reset). It's now a **rolling 7-day window** (`ROLLING_WINDOW_MS = 168h`, `WINDOW_DAYS = 8` partitions fanned out per read, container `defaultTtl = 691200` / 192 h to keep a one-day buffer over the read window). The finish-screen label reads "Top 10: 7 days". No per-date bucket in the cache key anymore — the rolling cutoff (`c.submittedAt > now - 168h`) does the windowing. Earlier intermediate step was 72 h / 96 h TTL / "Top 10: 3 days".

**What shipped (two phases, both 2026-06-12):**

1. **K1 — backend.** New Cosmos container `dailyLeaderboards` partitioned by `/pk = "<configKey>|<UTC-date>"`, autoscale 100–1000 RU/s, `defaultTtl: 172_800` (48 h — yesterday's rows auto-purge), composite indexes on `(score, durationMs)` both directions for higher-wins (timed) and lower-wins (endurance) modes. Indexing policy frozen in `infra/dailyLeaderboards-index-policy.json` and provisioned via `az`. Extended `api/src/functions/quizRecord.js` to fire a best-effort today-PB write after the existing upsert — parallel point-reads of `profiles` (nickname denorm) + today's leaderboard row, upsert only on PB, `local: true` stamp in dev so the public read excludes them. New endpoint `api/src/functions/quizLeaderboard.js` at `GET /api/v1/quiz/leaderboard/{configKey}?deviceId=…` — 60 s TTL cache on top-10 per partition (cache key includes order so a future direction flip can't serve a wrong-direction list), per-request rank query, `?fresh=1` bypass.
2. **K2 — frontend + i18n + audit fixes + UX polish.** `flags/dailyLeaderboardFetch.js` (defensive shape-normalising GET helper, never throws), `flags/dailyLeaderboardRender.js` (pure `createElement`-only renderer, XSS-safe), `flags/leaderboardLifecycle.js` (pure submit-then-fetch lifecycle, lifted out of `page.js` for testability), wiring in `flagQuiz/page.js`'s `showResult` (paints loading state immediately, then chains the fresh fetch onto `submitQuizRecord`). i18n strings under `quiz.leaderboard.*` in `en.json` + `pl.json`. CSS keeps the result-screen aesthetic; a 56 px / 20 px / 1 px-hairline section break separates the player's own block from the community list.

**Notable mid-flight finds (real audit catches, not nits):**

- **Security fix during K2 review:** the K1 leaderboard writer trusted the client-supplied `body.lowerWins`, letting a caller post a worse score with `lowerWins:true` and overwrite the today-PB row. K2 fixed it by deriving `lowerWins` server-side from the configKey via `lowerWinsFromConfigKey`; unknown mode skips the write rather than guessing direction. The personal-record write still trusts the body (unchanged trade-off — only that one device's row is affected). Updated the stale "no leaderboard reads this yet" comment in `validate.js`.
- **Handler-extraction precedent.** Two new pure libs (`api/src/lib/leaderboardRank.js` for the cmp/find/compute logic and `flags/leaderboardLifecycle.js` for the submit-then-fetch wiring) demonstrate the pattern for lifting non-trivial logic out of handlers/`page.js` glue so it can be unit-tested. Apply the same pattern when future features grow their own untested handler tails.

**Standing artifacts** (the load-bearing outputs future work inherits):

- `api/src/lib/leaderboardRank.js` + tests — pure `rankCmpClause` + `findMineInTop` + `computeYou`. Any future ranking surface should compose these; cmp-flip on `lowerWins` is pinned to a regression test so a refactor that conflates the two branches gets caught.
- `flags/leaderboardLifecycle.js` + tests — pure `runLeaderboardCycle` for "paint loading → submit → fetch → paint result". Locks the ordering invariant (fetch lands after submit) and the resolve/reject/contract-drift paths.
- `infra/dailyLeaderboards-index-policy.json` — the composite indexing spec is now a tracked file, not a one-shot `az` argument, so future container migrations have the source of truth.

**Key PRs.** #385 (K1 backend + container provisioning), #386 (K2 frontend + audit fixes + UX polish + spacing iterations, squashed).

**Out of scope, intentionally deferred** (captured here so they don't drift back in): lifetime / weekly / all-time leaderboards (each is a different aggregation surface — pick when felt). Per-country leaderboards. "Friends only" / linked-account filtering (Feature C territory). Pre-submission live leaderboard while mid-round. Pagination past 10 (the "…N. You" suffix is the only escape from top-N). UTC vs Europe/Warsaw cutoff (UTC for now; pure server-side derivation, easy to flip if players grumble). **Score-cap per configKey variant** (audit M1) — the leaderboard validates `score ≤ 1000` regardless of variant, so a determined caller could post `score: 1000` on `europe:60s:sov` (real cap ~50) and own #1. Acceptable griefing surface at current scale; revisit if it actually shows up in the wild.

### Feature H: Identity unification + device profiles — *shipped 2026-06-11*

**Goal.** Collapse the two device-identity keys (`gridgame.player.id` for TTT online, `gridgame.deviceId` for daily) into one canonical deviceId, then layer an optional server-stored nickname on top so the daily community stats and the TTT online room can surface "Alice" instead of an anonymous device. This is Layer 1 (device profile) in the three-layer identity model — Layer 0 is the anonymous deviceId we already had, Layer 2 (account-level cross-device linking via passkey) stays parked as Feature C. Each layer is additive: users can stay anonymous, opt up to a nickname, opt up further to a linked account — none of it forced.

**What shipped (four phases, all 2026-06-11):**

1. **H1 — client-side key unification.** One-time migration on first load: if `gridgame.player.id` exists alongside `gridgame.deviceId`, drop player.id; if only player.id exists, copy its value into deviceId and drop player.id. PartyKit took no change — it already accepts the id via `?pid=` and doesn't care what the value represents. Unblocked Feature G's per-device aggregation.
2. **H2 — `profiles` container + nickname UI.** New Cosmos container partitioned by `/deviceId`, doc shape `{ id: deviceId, deviceId, nickname, createdAt, updatedAt, v: 1 }`. New `PUT /api/v1/profile` endpoint (anonymous, rate-limited, Turnstile-gated like daily — currently soft-disabled in prod, same as the other endpoints). Burger-panel "set nickname" affordance.
3. **H2.5 — `/profile/` page + deterministic default nicknames.** Promoted nickname editing from a burger control to a dedicated `/profile/` page. Devices that haven't customised their nickname render a deterministic default derived from the deviceId, so unedited opponents still see a legible name instead of a UUID.
4. **H3 (TTT side) — inline opponent name in the online room.** New `GET /api/v1/profile?id=…` returns one device's nickname (or null). TTT online room renders `vs <Opponent>` inline next to the role badge once `peerId` is known, via `flags/profileFetch.js` (injectable fetch, defensive shape normalisation, never throws). Built with `createElement`, not `innerHTML`, so a malicious nickname like `<script>` can't escape into the page.

**Standing artifacts.**

- `flags/profileFetch.js` + tests — the contract for the read side of the profile container; reused by anything that wants to display "this device's chosen name".
- `flags/tttPairFetch.js` + tests + `GET /api/v1/ttt/result` — head-to-head **score** UI is deliberately not rendered yet (design on hold), but the read-path backend and client helper shipped as scaffolding so re-enabling it is a single page.js change. Data is already accumulating in Cosmos via Feature G.
- Deterministic-default-nickname helper — every "what name does this deviceId display as?" answer flows through one function.

**Key PRs.** #359 (H1), #360 (H2 — soft-disabled Turnstile), #361 (H2.5), #363 (H3 TTT side).

**Out of scope, intentionally deferred** (captured here so they don't drift back in): H3 daily-side surfacing ("Alice scored 67%") — no per-player surface exists in the daily UI today; needs a new leaderboard or row-list element, pick up when the demand is felt. Head-to-head score display in the TTT room — backend ready, UI on hold pending design sign-off. UA / browser / locale fingerprint storage — privacy hygiene; don't collect what no feature reads. Nickname uniqueness / moderation — display-only and collisions allowed; revisit if profanity or impersonation become real problems. Cross-device linking — Feature C's job, fundamentally a different layer.

### Feature G: TTT online — head-to-head score per device pair — *shipped 2026-06-11*

**Goal.** Persist online TTT outcomes so per-device matchup stats become possible. Before this, the PartyKit Durable Object held the room state and evicted it once the game ended — no head-to-head history existed at all. **Design pivot during build:** abandoned the original "one row per game, two perspectives" shape in favour of a much leaner **one row per (deviceA, deviceB) pair** holding both modes' rolling counters. Justification: the only planned read surface is "Alice vs Bob: 3-2 in 3×3, 1-1 in 9×9"; storing every game would bloat Cosmos for analytics nobody will run. Trade-offs accepted (and explicit so they're not re-litigated): no replay, no `movesCount`/`durationMs`, give-up squashed into win/loss client-side, refresh-after-finish can double-count once (no gameId minting).

**What shipped (one phase, 2026-06-11):**

- **`tttPairs` Cosmos container.** Partition key `/deviceId`, 400 RU/s manual, no TTL. Doc shape: `{ id: "<deviceId>:<opponentId>", deviceId, opponentId, m3x3: { wins, losses, draws }, m9x9: { wins, losses, draws }, lastPlayedAt, v: 1 }`. One row per (this device, that opponent) holding both modes — storage grows with distinct opponents, not games played.
- **`POST /api/v1/ttt/result`.** Anonymous, 10/min/IP rate limit, Turnstile-scaffolded (soft-disabled in prod alongside the other endpoints). Read-then-upsert via `api/src/lib/tttPairDoc.js`'s pure `mergePairResult({ existing, deviceId, opponentId, mode, outcome, now })` — tolerant of partial/garbage existing rows (missing or malformed counter buckets normalise to 0). Validation enforces `deviceId !== opponentId`, mode ∈ {"3x3","9x9"}, outcome ∈ {"win","loss","draw"}.
- **Client wiring.** Both TTT clients fire-and-forget `submitTttResult` after the `finished` effect arrives in `onlineClient.js`. Failures don't block the UI. The deviceId unification from H1 was a hard prerequisite — pre-H1, the TTT side used `gridgame.player.id` and the daily side used `gridgame.deviceId`, so the same browser would have shown up as two different identities to the `tttPairs` writer.

**Standing artifacts.**

- `api/src/lib/tttPairDoc.js` `mergePairResult` (pure) + tests — every future per-pair counter mutation routes through this; the defensive normalisation of partial existing rows is the load-bearing piece.
- `flags/tttResultSubmit.js` — the fire-and-forget submit contract; matches the daily-submit shape.

**Server-side trust note.** Both clients independently report the same outcome (Alice's "win" and Bob's "loss"). Mismatches are detectable but not currently blocked — store both, log if cheating becomes visible later. The escalation path is a PartyKit-signed `finished` payload the SWA endpoint validates against PartyKit's public key.

**Key PR.** #362.

**Out of scope, intentionally deferred:** gameId minting + server-side dedupe of refresh-after-finish double-counts (revisit if it shows in data), per-game rows with `movesCount`/`startedAt`/`finishedAt` (the only read surface is the aggregate — game-level data would be bytes with no consumer), `gave_up`/`opponent_gave_up` distinction (squashed into win/loss at the client; revisit when the read surface wants it), spectator/observer roles, anti-cheat hardening beyond rate limit.

### Feature F: Cosmos data discipline + analytics readiness — *shipped 2026-06-11*

**Goal.** Tighten the Cosmos data hygiene we'd accumulated over Features A/B/E, capture a handful of analytic signals we'd otherwise lose forever, and lock in a standing migration playbook for every future shape change — without adding new containers or breaking the "storage scales with users, not engagement" property. Sets the precedent every future Cosmos-touching feature (G/H/Feature I) inherits.

**What shipped (five phases, all 2026-06-11):**

1. **F1 — `dailyResults` throughput 400 → 1000 RU/s.** Free Tier covers it via the account-wide 1000 RU/s quota. Headroom for the read-RU concern flagged in `infra/operations.md`.
2. **F2 — `dailyResults` `defaultTtl: 31_536_000` (1 year).** Rows auto-purge from `_ts + 1y`. Earliest auto-deletion lands **2027-06-09**; Feature I (parked) must ship before then to preserve per-puzzle aggregates past the TTL.
3. **F3 — `v: 1` on the daily writer + migration playbook in `infra/operations.md`.** Every native write now self-describes its schema version. The standing migration playbook documents: every future shape change ships a backfill that (a) fills missing analytical fields with sensible defaults, (b) sets `backfilled: true` ONLY when an analytical field was defaulted (not on metadata-only patches), (c) bumps `v`.
4. **F4 — first exercise of the policy: 20 pre-v:1 `dailyResults` rows backfilled.** 1 row pre-PR-#317 (missing `wrongCodes`) got group-A treatment (`wrongCodes: [], backfilled: true, v: 1`); 19 rows had `wrongCodes` natively → group B (added `v: 1` only, no `backfilled` marker). F4 surfaced the "metadata-only patches don't get `backfilled`" nuance that the policy now captures explicitly.
5. **F5 — `attempts` + `lastPlayedAt` per `records[configKey]` in `quizRecords`; write-on-every-finish.** Server-side `mergeQuizRecord` no longer short-circuits on non-PB; the `flagQuiz/page.js` client lost its mirroring `if (isNew)` gate (caught during local verification, not by tests — see "honest gaps" in #356). 5 docs / 10 sub-entries backfilled with `attempts: 1, lastPlayedAt: submittedAt`, doc-level `backfilled: true, v: 1`.

**Standing artifacts** (these are the load-bearing outputs future work inherits):

- `infra/operations.md` "Cosmos data migration policy" — the contract every future migration follows.
- `scripts/backfill-daily-v1.cjs` and `scripts/backfill-quiz-v1.cjs` — the template shape for future backfills: pure `planRow()` exported for testability, idempotent dry-run by default, system fields stripped before upsert.

**Key PRs.** #350 (F1+F2 prod config), #351 (F3 writer + policy doc), #352 (parked **Feature I** — per-puzzle snapshots, hard deadline 2027-06-09 to outlive F2's TTL), #355 (F4 backfill + policy nuance), #356 (F5 writer + handler + client + backfill).

**Out of scope, intentionally deferred** (captured here so they don't drift back in): pre-aggregated `stats:{puzzleId}` for read performance (cache covers it; the retention-driven version is Feature I, different motivation), per-pick timestamps on daily, `openedFlagsdataDuringPlay` honesty signal (BroadcastChannel-based; partial coverage gives illusion of detection), lifetime totals on `quizRecords` (derivable from `sum(records[*].attempts)`), per-finish quiz event-log container (would break the "1 row per device" property).

### Feature E: Reliable daily-puzzle auto-release via Azure Logic App — *shipped 2026-06-10*

**Problem.** GitHub Actions `schedule:` cron on `release-daily.yml` was firing very late — observed firings on the night of 2026-06-09→10 (run IDs `27242130968`, `27244311244`, both `event=schedule` per GitHub's own record) landed at ~01:19 and ~02:15 Warsaw, i.e. 75–135 min after the 00:00 nominal target. The manual morning dispatch always won the race, so from a user's POV the puzzle never auto-released; the 14-firings-per-night defensive burst was masking lateness, not curing it.

**Fix.** Moved the *trigger* to an Azure Logic App (Consumption tier) with a Recurrence trigger at 00:05 Warsaw. The Logic App POSTs `workflow_dispatch` to the existing `release-daily.yml`; everything downstream is unchanged — the workflow still promotes `daily/daily_backlog.json[0]` → `daily/daily_puzzles.json`, commits, kicks `deploy.yml`, and the static site ships the new puzzle as part of the normal deploy path.

**Architecture.** Single `Microsoft.Logic/workflows` resource (`logic-yetanotherquiz-release-daily`) in `rg-yetanotherquiz`, West Europe. Recurrence trigger uses Windows TZ identifier `Central European Standard Time` (auto-follows DST). HTTP action authenticates with a fine-grained GitHub PAT stored as a `securestring` WDL parameter — never baked into the deployed workflow JSON, masked in portal + run history. No managed identity, no storage account, no Function App — Logic App Consumption is a single resource. Cost: $0 (free grant covers ~31 executions/month vs the ~30 we use). Defined in `infra/logicapp-release-daily.bicep` as single source of truth — round-trip every change through the template and `az deployment group create`, no portal click-edits.

**The "fires on registration" quirk.** When `az deployment group create` *creates* the Logic App, the Recurrence trigger fires once immediately as part of registration, then settles into its schedule for subsequent runs. Documented Logic Apps behaviour, not a bug. In practice the first deploy doubles as a free end-to-end smoke test, and future redeploys (e.g. for PAT rotation) fire one extra `workflow_dispatch` that `release-daily.yml`'s "already released today" guard catches cleanly. Pure update deploys that don't recreate the resource (e.g. tag changes) do NOT trigger this. Captured in `infra/README.md`.

**Verification.** All hops verified live during deploy day before the schedule-cutover commit:
1. Deploy-time auto-fire 16:16:29Z 2026-06-10 → Logic App run `08584204986959706003361452862CU13` Succeeded → workflow run `27289674634` (`event: workflow_dispatch`, 14s, guard hit cleanly).
2. One-off scheduled fire at 19:10 Warsaw — schedule swapped to `hours:[19] minutes:[10]` for a 15-min test window, then reverted same hour. Logic App run `08584204954564865890913776253CU32` fired at 19:10:28 Warsaw → workflow run `27292799473` (13s, guard hit cleanly). Log line: `Already released today (2026-06-10 Warsaw, last commit was 2026-06-09T22:40:38Z) — skipping.`
3. Reverted-schedule deploy → trigger metadata `nextExecutionTime: 2026-06-10T22:05:28Z` = 00:05 Warsaw 2026-06-11.
4. First natural 00:05 Warsaw fire on 2026-06-11 → `daily: release #6 — auto-promoted from backlog` commit on `main`.

Soak window skipped — Logic Apps don't have GitHub cron's "sometimes fires" failure mode that justified multi-night observation.

**PAT lifecycle.** Fine-grained GitHub PAT, repo-scoped to `jgrzegrzolka/gridgame`, permission `Actions: write` only (auto-grants `Metadata: Read-only` as a forced dependency). Initial mint 2026-06-10 with 90-day expiry; future rotations will use GitHub's 1-year max. Rotation = mint new PAT + `az deployment group create` with the new value. GitHub emails 7 days before expiry — that's the reminder.

**Future considerations** (captured so the question doesn't need re-deriving):
- **Option: GitHub App + OIDC federation.** Replace the PAT with Logic App managed identity → OIDC ID token → GitHub App installation token. Zero secrets stored, zero rotation ever. Cost: a few hours of plumbing (create GitHub App, install on repo, configure federated credential on the Logic App identity, swap HTTP action auth). Re-examine if rotation becomes friction or extended absence (>1 year) is planned.
- **Option (ruled out): Move backlog to Cosmos + new `/api/daily/today` endpoint.** Kills GitHub from the runtime path entirely — no PAT, no daily release commit. Loses two values explicitly preserved in this project: "the file is the released state" (git as source of truth, `git log` as audit trail) and the per-puzzle authoring workflow (edit JSON + commit + PR is more locality than tool-mediated Cosmos writes). Authoring happens ~weekly, PAT rotation ~annually — bad swap as long as authoring is done by hand.

**Rollback playbook.**
- *Logic App firing wrong / spamming runs*: portal → `logic-yetanotherquiz-release-daily` → **Disable**. Stops all future runs instantly. Re-enable when fixed.
- *PAT compromised or leaked*: revoke at GitHub Settings → Developer settings → PATs. Logic App's HTTP action will start returning 401 (visible in Logic App run history). Mint new PAT, redeploy Bicep with new value.
- *Logic App entirely broken*: temporarily restore the `schedule:` block to `.github/workflows/release-daily.yml` (GH cron is flaky but better than nothing) and disable the Logic App.

Key PRs: #341 (Bicep template scaffolded, no deploy), #342 (`schedule:` removal + FEATURE.md promotion + docs cleanup — this PR).

### Feature D: Emergency SWA failover migration — *shipped 2026-06-10*

**What happened.** Around 10:21 UTC the Azure Static Web Apps deploy-promotion pipeline broke for `swa-yetanotherquiz` (West Europe, Free SKU). Every deploy after the 09:02 success uploaded its artifact to Azure in ~3 seconds, then sat in `Polling on deployment` for 10 minutes until the GitHub action gave up with `Upload Timed Out`. Azure's `/builds` endpoint showed `status: Uploading` indefinitely, then eventually flipped to `Failed` with no error message. 4 retries and a local `swa deploy` CLI attempt all failed the same way. Portal's **Diagnose and solve problems → Content Deployment** was itself broken with `Sorry, an error occurred`. No public Azure incident acknowledged.

**Why it mattered.** PR #336 (Turnstile soft-disable) was unshipped, meaning legitimate users hitting Cloudflare Turnstile 401s (e.g. Firefox with strict tracking protection) were having their daily-puzzle submissions silently dropped — and every hour of delay locked more bias into community stats.

**Diagnosis path.**
1. Created `swa-yetanotherquiz-v2` (West Europe, fresh) — same failure → ruled out instance-specific corruption.
2. Created `swa-yetanotherquiz-v3` (West US 2, fresh) — **deployed cleanly in 32 seconds**, confirmed the issue was West Europe regional, not service-wide.
3. Filed a public issue at https://github.com/Azure/static-web-apps/issues so Microsoft sees it.

**Cutover.** Removed `www.yetanotherquiz.com` from V1, added to V3 with DNS-TXT validation, flipped the Cloudflare CNAME from `black-dune-...` → `wonderful-ground-01bf3091e.7.azurestaticapps.net`. V1 was accidentally deleted mid-cutover (a queued `az staticwebapp delete` finally executed during the WE control-plane chaos) — not a problem since V1 was unusable anyway.

**Resulting topology.**
- **Active prod:** `swa-yetanotherquiz-v3` (West US 2), serving `www.yetanotherquiz.com`.
- **Deleted:** `swa-yetanotherquiz` (V1, WE), `swa-yetanotherquiz-v2` (V2, WE).
- **Workflow:** single `.github/workflows/deploy.yml` using GH secret `AZURE_STATIC_WEB_APPS_API_TOKEN_V3`.
- **Latency cost:** Functions in WUS2 + Cosmos in WE = ~300 ms cross-region per API call. Acceptable for low-volume endpoints.

**Recovery playbook — for when Azure WE recovers** (or when we want lower API latency):
1. Verify WE is healthy: create a throwaway SWA in WE via `az staticwebapp create`, trigger one deploy. If it completes in seconds (not 10 minutes), WE is back.
2. Create `swa-yetanotherquiz-we` (or reuse the `swa-yetanotherquiz` name) in West Europe. Copy `COSMOS_CONN` + `TURNSTILE_SECRET` app settings. Add its deploy token as GH secret `AZURE_STATIC_WEB_APPS_API_TOKEN_WE`.
3. Add a sibling `.github/workflows/deploy-we.yml` (copy of the current `deploy.yml`, swap the secret). Two independent workflows = both fire on push, neither blocks the other if the other fails.
4. Add `www.yetanotherquiz.com` as a custom domain on the new WE SWA via TXT validation while V3 is still serving (Azure requires the source SWA to release first — same conflict we hit today; remove from V3 before adding to WE).
5. Flip Cloudflare CNAME back to the WE hostname. Validate. Done — V3 stays as hot-standby for next time.

**2026-06-11 follow-up — redirect rule hardening + Cloudflare cleanup.** The CF apex→www redirect "Redirect from root to WWW [Template]" was firing intermittently. Its wildcard `https://yetanotherquiz.com/*` only matched HTTPS with a trailing path — plain-HTTP requests and edge cases fell through to the 4 stale GH Pages A records (`185.199.108-111.153`), surfacing as unstyled stale content or Azure 404s on apex. The "functionally irrelevant" rationale in the original cleanup list was wrong: those records were one rule-misfire away from being the actual origin. Rewrote the rule to match by host header instead — Match: `(http.host eq "yetanotherquiz.com")`, Target (Dynamic): `concat("https://www.yetanotherquiz.com", http.request.uri.path)`, 301, preserve query string. Then deleted all 4 GH Pages A records and replaced with a single placeholder A record (`192.0.2.1`, TEST-NET-1, proxied) so apex stays resolvable for the rule to fire on, but any future rule misfire falls through to an unroutable IP rather than a real stale server. Also removed the stale apex TXT `_9n7yl364eeo06i0bnmr5hyuxtpcpff2` (the original SWA's hostname validation token, no longer used). All Feature D Cloudflare-side cleanup is now closed.

Key PRs from the day: #336 (Turnstile soft-disable, the fix that needed to ship), #337 (deploy-v2.yml diagnostic, deleted in #339), #338 (deploy-v3.yml diagnostic, repurposed into the new `deploy.yml` in #339), #339 (this cleanup).

Current-state reference for what's deployed and the runbook for these symptoms: [`infra/operations.md`](infra/operations.md).

### Feature B: Daily challenge — global stats — *shipped 2026-06-10*

Per-flag find rates aggregated across everyone who attempted the same daily puzzle, plus an "Average today: X/Y" headline below the result. Live in production.

**Architecture in one paragraph:** Cosmos doc `id = "{puzzleId}:{deviceId}"` enforces single-submission-per-device. `POST /api/v1/daily/result` (5/min/IP rate-limited; was originally Turnstile-verified but **soft-disabled 2026-06-10** after CF started 401-blocking legitimate users — see CLAUDE.md "Local development" for the rationale) inserts a row; 409 on duplicate. `GET /api/v1/daily/stats/{puzzleId}` aggregates to `{totalAttempts, perCodeFinds, mean, topPct}`, in-Function cached 60s, with `?fresh=1` bypass for the player who just submitted. Permanent infra/API plumbing facts (Functions v4 layout, CommonJS pin, Cosmos REST instead of `@azure/cosmos`, etc.) moved to `CLAUDE.md` "API / Azure Functions" section.

**Closed unbuilt:**
- **B6 — archive integration** — delivered indirectly by B4. Clicking an archive square already routes through the daily revisit branch, which fetches the same stats. Inline aggregate hints on the archive grid itself weren't worth doing at current per-puzzle N.
- **B7 — player-percentile headline ("you're in the top X% today")** — the existing "Average today" line covers the job at current traffic. Adding a server distribution endpoint (`SELECT COUNT(*) GROUP BY ...`) + client aggregation isn't a felt need yet. Re-open when traffic justifies.

Key PR milestones: #284 (api skeleton), #293 (validate-only POST), #296 (Cosmos REST insert), #304 (identity + submitted tracking), #315 (local dev scaffolding), #322 (median → mean).

### Local development setup — *shipped 2026-06-10*

Full local stack runs via `npm run dev:swa` (static site + Functions API + Cosmos round-trips against real prod Cosmos + Azurite for the Storage health check). Permanent setup/run docs live in `README.md` (setup + run sections) and `CLAUDE.md` "Local development" (Azurite trade-offs, deeper notes). Dev reset toolbar mounts localhost-only on the daily + archive pages for one-click localStorage + Cosmos-local-rows cleanup. Key PR milestones: #315 (scaffolding), #335 (Azurite + dev reset toolbar + `/api/v1/dev/clear-local-rows`).

### Feature A: Migrate site hosting to Azure SWA — *shipped 2026-06-09*

GitHub Pages → Azure Static Web Apps (Free SKU). Public URL `https://www.yetanotherquiz.com` (apex 301-redirects to www via Cloudflare). Resources: `rg-yetanotherquiz`, `swa-yetanotherquiz` (the original WE instance — replaced by `swa-yetanotherquiz-v3` in West US 2 during Feature D's failover the next day). Permanent hosting facts moved to `CLAUDE.md` "Hosting" section; PR #281 + #282 + the wrap-up PR have the implementation history.
