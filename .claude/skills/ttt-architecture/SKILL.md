---
name: ttt-architecture
description: Map of the tic-tac-toe feature — which boards exist, which reducer and stylesheet each uses, who deals the puzzle (the server, online), how a burger setting reaches puzzle generation, and which TTT surfaces are persisted and therefore resist deletion. Use when changing any `ticTacToe/` page, adding a TTT setting or mode, touching `party/ticTacToeServer.js`, or working out the blast radius of a TTT change. For how categories are picked and rejected, use the ttt-puzzle-generator skill instead.
---

# Tic-tac-toe architecture

`ttt-puzzle-generator` covers *what goes on the board* (pool composition, rejection rules, retry budgets). This skill covers *everything around it*: the pages, the reducers, who owns game state, and what breaks when you change one board.

The single most expensive thing to learn late: **online puzzles are dealt by the server, not the client.** See "Puzzle authority" below before any change that affects generation.

## The boards

Three pages, all 3×3. (A 9×9 "ultimate" variant existed until 2026-07-16; Feature U removed it. If you find a stray `9x9` / `ultimate` reference, it's a leftover, not a feature.)

| Page | Path | Players | Game state owned by |
|---|---|---|---|
| online | `ticTacToe/` | two, over the network | **PartyKit server** |
| offline | `ticTacToe/offline/` | two, same device | the page |
| solo | `ticTacToe/solo/` | one, fill the board | the page |

Each page is markup-only HTML plus a sibling `page.js` exporting a `bootX()` that a tiny inline `<script type="module">` calls. Standard repo pattern.

**Reachability:** `offline/` and `solo/` are linked *only* from `ticTacToe/index.html`, and none of the three has a `.back` chrome button — that button was deliberately removed site-wide and replaced by the inline "Home" link in each page's `.actions-row`, which is pinned by `chrome.test.js`. So **the site has no "up one level" nav on purpose**, and every board exits to the site root via Home.

Solo's burger used to carry a lone `ttt.playOnline` → `../` link; it was removed 2026-07-16 because offline never had one, and a single cross-page nav link in one of two sibling burgers is the inconsistency, not the feature. Both burgers now read nickname → "Advanced mode" → coffee. Don't reintroduce an up-level link to one board without the other — and prefer neither, per the `.back` decision above.

### Shared assets

- **`ticTacToe/index.css` styles all three boards**, including the picker sheet (from `.picker[hidden]` onward). There is no per-page stylesheet, so a "just the offline grid" CSS change is a change to every board.
- **`ticTacToe/lobby.css`** is the online lobby only.
- **There is no shared burger component.** Every `index.html` inlines its own burger markup with an inline `onclick` toggling `aria-expanded` and the panel's `hidden` (see `ticTacToe/index.html:36-58`). Runtime items (nickname, privacy, sync) are mounted by `common.js`. If you add a menu item, you add it per page.

## Puzzle authority: the server deals online

```js
// party/ticTacToeServer.js — every deal funnels through one method, so a new
// deal site can't quietly ignore the room's mode.
dealPuzzle(advanced) { /* forcedPuzzle for tests, else the pool the mode calls for */ }
this.room = createRoom(this.dealPuzzle(advanced), { advanced });               // fresh room (?advanced=1)
applyStartRematch(this.room, playerId, this.dealPuzzle(this.room.advanced));   // rematch keeps the mode
applySetAdvanced(this.room, playerId, advanced, this.dealPuzzle(advanced));    // host re-deals mid-room
```

The server loads its own countries and metrics at module scope (`party/server.js`) and persists the puzzle in the durable object, so both players and any reconnect see one identical board. `partykit.json` maps the party names to entry points — if you add or remove a server file, that mapping must move with it or the deploy breaks (nothing tests it).

**The online client never generates.** `ticTacToe/page.js` fetches countries only so the picker can render and so `metricDataGap` can show "no data"; the comment at `:42-46` says so explicitly. Offline and solo *do* generate client-side (`ticTacToe/solo/page.js:38`).

**Consequences for anything generation-affecting:**

1. A localStorage setting read in the browser **cannot reach an online board by itself**. The server already dealt it and never sees the flag. It has to travel: a create-time WS param, room state, and a message to change it later.
2. Two players, one board, one preference — so it's a **room setting, not a device setting**, and the room's answer must beat the local one in the UI. Otherwise the creator imposes a mode on the opponent with nothing saying so.
3. **"Advanced mode" is the worked example** — copy it rather than re-deriving. `?advanced=1` at create (`party/ticTacToeServer.js`), `Room.advanced` persisted in the durable object, `set-advanced` to change it, `applySetAdvanced` to authorize, `advanced` + `isHost` on `welcome` so the joiner's control can report the room. See "Adding a setting" below.
4. Client→server messages are `claim`, `give-up`, `rematch`, `set-advanced`. Adding a fifth means a handler in `onMessage` **and** a reducer in `onlineRoom.js` that owns the rules — the handler must not decide anything the reducer doesn't.
5. **`applyStartRematch` requires `isGameOver`.** Anything that re-deals a *live* board needs its own transition; you cannot lean on the rematch path.
6. **Never re-deal a board with progress on it.** Online those moves are partly the opponent's, so a settings change that re-deals must be gated on `boardIsUntouched` in the reducer, not only in the UI.

**What is safe:** puzzles serialize by **category id** and rehydrate via `categoryFromId` (`engine.js:2686`). That decode path is total over the pool, so drawing from a narrowed pool needs no wire-format change.

**Version skew is real here, and rooms outlive it.** The page and the PartyKit server deploy from different workflows, so a new client meets an old server and vice versa — and a durable object holds a room until eviction, so today's build loads snapshots written by older ones. A missing field must resolve to *what that room was actually dealt*, not to whatever is convenient: `deserializeRoom` reads `advanced`, then falls back to `easy` (#931's near-opposite flag), then to "pre-#931, so full pool". The client treats a missing `isHost` as false, which only locks a control. Guessing wrong here relabels a live room's chip and hands its rematch the other pool.

## Reducers

Pure, tested, no DOM. Pages are renderers over these.

- **`flags/ticTacToe.js`** — the two-player reducer (`newGame`, `attemptClaim`, `findWinner`, `applyGiveUp`, `isGameOver`, `newlyWinningCells`, `shouldFireTicTacToeConfetti`) **and** the solo variant (`newSoloGame`, `attemptSoloClaim`, `isSoloOver`, `applySoloGiveUp`).
- **`flags/onlineRoom.js`** — room state machine (roles, hello, claim, rematch, disconnect, set-advanced), shared by client and server. Every rule about who may do what lives here, not in the server's message handler.
- **`ticTacToe/onlineClient.js`** — the client-side WS message reducer.

Note the import asymmetry, which tells you the authority model at a glance: `offline/page.js` and `solo/page.js` import the *game* reducers, while the online `page.js` imports only `shouldFireTicTacToeConfetti` and `newlyWinningCells`. Online game logic lives server-side.

## Adding a setting (the toggle recipe)

There are **two burger switches in the repo**: `findFlag`'s "include territories" (the original) and TTT's own "Advanced mode" (see below — it's the closer model for a TTT setting). Match one of them rather than inventing a third pattern.

Markup (`findFlag/index.html:55-63`) is a `.scope-toggle` label wrapping the text and a `.scope-toggle-switch` containing the checkbox plus `.scope-toggle-track` / `.scope-toggle-thumb`.

Storage (`flags/findFlag.js:19-34`) wraps the shared helpers:

```js
const FIND_INCLUDE_ALL_KEY = 'gridgame.flagfind.includeAll';
export function isFindIncludeAll(store) { return readBoolSetting(store ?? localStorage, FIND_INCLUDE_ALL_KEY); }
export function setFindIncludeAll(store, value) { writeBoolSetting(store, FIND_INCLUDE_ALL_KEY, value); }
```

`readBoolSetting` / `writeBoolSetting` (`flags/group.js:798-811`) are **default-off by construction** (`getItem(key) === 'true'`, and `false` removes the key). For a default-*on* setting they're the wrong helper; use the `getItem(K) !== 'false'` idiom from `flagsdata/page.js:37-41` instead.

**Key naming:** `gridgame.<surface>.<setting>`. The `ttt` namespace is already claimed (`gridgame.ttt.hostRoom`, `flags/tttHostMemory.js:24`, which is **sessionStorage**, not localStorage). Existing keys: `gridgame.flagfind.includeAll`, `gridgame.flagquiz.includeAll` / `.lastVariant` / `.showMap`, `gridgame.flagsdata.showMap` / `.wide`, `gridgame.party.setup` / `.plan` / `.tricky` / `.reveal`.

**One setting reaches puzzle generation: "Advanced mode"** (`gridgame.ttt.advanced`), mounted on **all three** boards, **twice each** (burger + "How to play"). It's the worked example of everything above, so copy it rather than the findFlag original if you're adding a second one.

**Read the polarity before you touch it.** Advanced is **off by default**, so the *default* board is `buildFlagCategoryPool()` (flag + continent, 25 categories) and `buildRandomCategoryPool()` (everything, 142) is the opt-in branch. `generateRandomPuzzle`'s own default is still the full pool — the engine stays a general library, and the product decision lives in the three TTT call sites that read the setting. This flipped in Feature U Phase 5; anything you find framed as "easy mode" or `gridgame.ttt.easy` is pre-flip and gone.

**Naming is load-bearing here, twice over.** The label was "No statistics" for one day and it failed for reasons worth not repeating: it read as "hide my score" next to the board's live head-to-head record, and a *removal* framing in a burger reads as a display preference. Naming the **opt-in pole** instead collapses the vocabulary to one word — the default board needs no name, so the switch, the room chip, and the how-to-play note all say "Advanced". If you add a mode, name the thing you opt into.

Shared by all three:

- `flags/tttSettings.js` — `isTttAdvanced` / `setTttAdvanced` over the shared bool helpers. A tiny dedicated module (same shape as `tttHostMemory.js`) rather than a new import in `flags/ticTacToe.js`, which stays a pure reducer.
- The same `.scope-toggle` burger markup and the same storage key, so a player has **one** preference, not three.

Offline + solo (the board is dealt at boot, by the page):

- `ticTacToe/advancedToggle.js` — `wireAdvancedToggle({ inputEls, isBoardUntouched, redeal })`, shared by both pages because the same mechanism must be the same code. It takes a **list** because each board mounts two switches for one setting; every write paints all of them, since the off-screen copy (closed burger, closed dialog) is exactly the one that goes stale and is then believed the moment it opens. Injectable storage / defer, so it's unit-tested despite being DOM glue.
- Each page reads the setting **once at boot** (`generateRandomPuzzle(countries, isTttAdvanced() ? {} : { pool: buildFlagCategoryPool() })`).
- Flipping it **re-deals only an untouched board** — via `window.location.reload()`, which is exactly what the pages' own "Play again" does, gated on `boardIsUntouched(state)` and deferred 350 ms so the thumb's slide is visible. With moves down it applies to the next board instead.

Online (the board is dealt by the server, for two people):

- Same control, same place, but it is a **room** setting. `decideAdvancedToggleState({ inRoom, isHost, boardUntouched, roomAdvanced, prefAdvanced })` in `advancedToggle.js` owns the whole rule; `page.js`'s `renderAdvancedToggles` is the DOM half and runs on **every** server message.
- In the lobby it is your preference and seeds the room you create (`?advanced=1`). In a room it reports *that room's* mode, so a joiner who prefers the flag board sees "on" if the room is advanced.
- **The room chip** (`#room-mode`, `lobby.css`) is the actual disclosure, not the switch: a joiner never opens the burger. Shown only when advanced, so an ordinary room stays quiet. Online-only and structurally so — offline / solo have no `.room-line`, and there the mode was your own choice seconds ago.
- Live only for the host, only while the board is untouched; otherwise `.scope-toggle.is-disabled` (muted label + faded switch, matching `.actions-row button:disabled`). Locking it once play starts is what keeps the switch describing the board actually in front of you.
- The change handler is **optimistic** — it does not snap back. The server's `advanced-changed` broadcast repaints from room truth, and a refusal is healed by whatever message beat it. In a room it must **not** re-derive from `state` on click: `state.advanced` still holds the old value until the server answers, so re-deriving snaps the switch back under the player's finger. Mirror the click onto the sibling switch and wait.
- The `is-disabled` styling lives in `common.css` with the rest of `.scope-toggle`, because two consumers reach it.

`advancedToggle.test.js` pins that all three boards mount **both** switches and explain the mode where they mount them, that the chip is online-only, plus that `.scope-toggle`'s CSS stays in `common.css`. That first assertion has flipped twice (#928 pinned the toggle *off* the online board; #931 inverted it) — the rule underneath never moved: **the switch must never claim something it cannot deliver.**

Whatever you add next: **online is not automatically unaffected any more.** A new pool-affecting setting has to answer "whose setting wins, and how does the other player find out?" before it has a design.

**Burger borders are load-bearing.** The offline and online menus are currently nickname → coffee-divider with nothing between. `common.css`'s `.menu li.menu-nickname + li.menu-divider` suppresses the divider's `border-top` in exactly that shape, because otherwise the nickname's `border-bottom` and the divider's `border-top` stack into a double grey line (the bug in #926). Add a nav row between them and the rule stops matching, restoring the divider — correct and self-healing, but **look at the menu** after changing it.

## Surfaces that resist deletion

TTT state escapes the browser. Before removing a mode or renaming a counter:

- **Achievements are computed on read, never stored.** `api/src/lib/tttCompute.js` derives a snapshot from the player's `tttPairs` rows on every `/api/v1/daily/me` request, and `flags/achievements.js` runs predicates over it. There is no award record. Two consequences: deleting a rule removes the badge from every profile with **no data migration**, and deleting *data* silently re-evaluates every badge that reads it. `tttGamesPlayed` / `hasWonTtt` / `hasLostTtt` all aggregate over the rows, so a row edit can revoke a badge that looks unrelated. The stable-id rule still forbids **reusing** a retired id.
- **Cosmos head-to-head docs** (`api/src/lib/tttPairDoc.js`) are one row per (deviceId, opponentId), computed by `tttCompute.js`, merged by `syncMerge.js`, read by `getTttResult.js` and `dailyMe.js`, reconciled by `authoring/reconcileTttPairs.mjs`. Change the doc shape in one place and you must chase all six.
- **`api/src/lib/validate.js`** carries `TTT_MODES`, which still accepts the retired `'9x9'` so an in-flight POST from a stale tab doesn't 400. `mergePairResult` ignores such a result rather than counting it. That pattern (accept, ignore, don't miscount) is the template for retiring anything else on this wire.
- `flags/engagementCounters.js` — `bumpShare(…, 'ttt')`.

## Test coverage map

- Reducers: `flags/ticTacToe.test.js`, `flags/onlineRoom.test.js`.
- WS client reducer: `ticTacToe/onlineClient.test.js`.
- Server: `party/ticTacToeServer.test.js`.
- UI mechanics: `ticTacToe/shakeFeedback.test.js` (shake-on-miss, winning-cell shake), `ticTacToe/matchStrip.test.js`.
- Settings: `ticTacToe/advancedToggle.test.js` — the "Advanced mode" switch: `decideAdvancedToggleState`'s rules (room beats preference, host-only, locks on first move), the two-switch sync, plus the contracts that live outside JS: that `.scope-toggle`'s CSS stays in `common.css` where every consumer reaches it, that all three boards mount both switches and explain the mode, and that the room chip is online-only.
- Generation against real data: `flags/countries.test.js` (the load-bearing one).

The pages themselves are DOM and fetch glue and aren't unit-tested. Per `CLAUDE.md`, "I can't test this" means the logic is in the wrong file: push it into a sibling module or `flags/`.

## Related skills

- **`ttt-puzzle-generator`** — pool composition, the rejection ladder, retry-budget debugging. Read it for any change to *which* categories can appear.
- **`add-world-metric`** — a new metric reaches the TTT threshold mode as one of six surfaces.
- **`add-achievement`** — the stable-id rule that governs TTT badges.
- **`ui-consistency`** — "same mechanism = same code" applies hard here: give-up reveal, wrong-answer shake, and winning highlight are shared with other games.
