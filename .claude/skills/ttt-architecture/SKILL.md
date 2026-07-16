---
name: ttt-architecture
description: Map of the tic-tac-toe feature — which boards exist, which reducer and stylesheet each uses, who deals the puzzle (the server, online), how a burger setting reaches puzzle generation, and which TTT surfaces are persisted and therefore resist deletion. Use when changing any `ticTacToe/` page, adding a TTT setting or mode, touching `party/ticTacToeServer.js`, or working out the blast radius of a TTT change. For how categories are picked and rejected, use the ttt-puzzle-generator skill instead.
---

# Tic-tac-toe architecture

`ttt-puzzle-generator` covers *what goes on the board* (pool composition, rejection rules, retry budgets). This skill covers *everything around it*: the pages, the reducers, who owns game state, and what breaks when you change one board.

The single most expensive thing to learn late: **online puzzles are dealt by the server, not the client.** See "Puzzle authority" below before any change that affects generation.

## The boards

Five pages, four of them 3×3. Mode is carried by **URL path**, not a query param.

| Page | Path | Players | Game state owned by |
|---|---|---|---|
| 3×3 online | `ticTacToe/` | two, over the network | **PartyKit server** |
| 3×3 offline | `ticTacToe/offline/` | two, same device | the page |
| 3×3 solo | `ticTacToe/solo/` | one, fill the board | the page |
| 9×9 online | `ticTacToe/9x9/` | two, over the network | **PartyKit server** |
| 9×9 offline | `ticTacToe/9x9/offline/` | two, same device | the page |

> **9×9 is being removed** (FEATURE.md, Feature U Phase 2). Don't build on it, and don't extend a new feature to cover it.

Each page is markup-only HTML plus a sibling `page.js` exporting a `bootX()` that a tiny inline `<script type="module">` calls. Standard repo pattern.

### Shared assets, and the trap in them

- **`ticTacToe/index.css` styles all five boards.** The 9×9 pages just link `../index.css`; there is no 9×9 stylesheet. From `:332` to EOF is the `/* ---- 9x9 variant ---- */` block, roughly two thirds of the file. A "3×3 CSS change" can be a 9×9 change if you edit above that line carelessly.
- **`ticTacToe/lobby.css`** is shared by both online pages.
- **There is no shared burger component.** Every `index.html` inlines its own burger markup with an inline `onclick` toggling `aria-expanded` and the panel's `hidden` (see `ticTacToe/index.html:36-60`). Runtime items (nickname, privacy, sync) are mounted by `common.js`. If you add a menu item, you add it per page.

## Puzzle authority: the server deals online

```js
// party/ticTacToeServer.js
import { generateRandomPuzzle } from '../flags/engine.js';   // :11
const puzzle = this.forcedPuzzle ?? generateRandomPuzzle(this.countries);     // :96  fresh room
const newPuzzle = this.forcedPuzzle ?? generateRandomPuzzle(this.countries);  // :166 rematch
```

The server loads its own countries and metrics at module scope (`party/server.js`) and persists the puzzle in the durable object, so both players and any reconnect see one identical board.

**The online client never generates.** `ticTacToe/page.js` fetches countries only so the picker can render and so `metricDataGap` can show "no data"; the comment at `:42-46` says so explicitly. Offline and solo *do* generate client-side (`ticTacToe/solo/page.js:38`).

**Consequences for anything generation-affecting:**

1. A localStorage setting read in the browser **silently does nothing online**. The server already dealt the board and never sees the flag.
2. If you did wire it naively, the room creator would impose their setting on the opponent with no UI saying so. Two players, one board, one preference: that's a room setting, not a device setting.
3. Making it work online means a protocol change: a param on the WS URL at create time (today it accepts only `?pid=` and `?intent=create|join`, `party/ticTacToeServer.js:83-84`), durable-object state to remember it, honouring it on **rematch** too (`:166`), and lobby UI so the joiner knows what they're joining.
4. Client→server messages are only `claim`, `give-up`, `rematch` (`:146-172`). There is no options channel.

**What is safe:** puzzles serialize by **category id** and rehydrate via `categoryFromId` (`engine.js:2686`). That decode path is total over the pool, so drawing from a narrowed pool needs no wire-format change.

## Reducers

Pure, tested, no DOM. Pages are renderers over these.

- **`flags/ticTacToe.js`** — the 3×3 two-player reducer (`newGame`, `attemptClaim`, `findWinner`, `applyGiveUp`, `isGameOver`, `newlyWinningCells`, `shouldFireTicTacToeConfetti`) **and** the solo variant (`newSoloGame`, `attemptSoloClaim`, `isSoloOver`, `applySoloGiveUp`).
- **`flags/onlineRoom.js`** — room state machine (roles, hello, claim, rematch, disconnect), shared by client and server. `flags/ultimateOnlineRoom.js` is the 9×9 twin.
- **`ticTacToe/onlineClient.js`** — the client-side WS message reducer. `ticTacToe/9x9/onlineClient.js` is its twin.
- **`flags/ultimateTicTacToe.js`** — the 9×9 reducer.

Note the import asymmetry, which tells you the authority model at a glance: `offline/page.js` and `solo/page.js` import the *game* reducers, while the online `page.js` imports only `shouldFireTicTacToeConfetti` and `newlyWinningCells`. Online game logic lives server-side.

`exhausted` is a **9×9-only** concept (typedef `flags/ticTacToe.js:14-17`, set only in `ultimateTicTacToe.js`). Both 3×3 pages toggle a `.exhausted` class anyway, where it is a permanent no-op. Inherited from the 9×9 render shape; Feature U Phase 2 removes it.

## Adding a setting (the toggle recipe)

There is exactly **one burger switch in the repo**: `findFlag`'s "include territories". Match it rather than inventing a second pattern.

Markup (`findFlag/index.html:55-63`) is a `.scope-toggle` label wrapping the text and a `.scope-toggle-switch` containing the checkbox plus `.scope-toggle-track` / `.scope-toggle-thumb`.

Storage (`flags/findFlag.js:19-34`) wraps the shared helpers:

```js
const FIND_INCLUDE_ALL_KEY = 'gridgame.flagfind.includeAll';
export function isFindIncludeAll(store) { return readBoolSetting(store ?? localStorage, FIND_INCLUDE_ALL_KEY); }
export function setFindIncludeAll(store, value) { writeBoolSetting(store, FIND_INCLUDE_ALL_KEY, value); }
```

`readBoolSetting` / `writeBoolSetting` (`flags/group.js:798-811`) are **default-off by construction** (`getItem(key) === 'true'`, and `false` removes the key). For a default-*on* setting they're the wrong helper; use the `getItem(K) !== 'false'` idiom from `flagsdata/page.js:37-41` instead.

**Key naming:** `gridgame.<surface>.<setting>`. The `ttt` namespace is already claimed (`gridgame.ttt.hostRoom`, `flags/tttHostMemory.js:24`, which is **sessionStorage**, not localStorage). Existing keys: `gridgame.flagfind.includeAll`, `gridgame.flagquiz.includeAll` / `.lastVariant` / `.showMap`, `gridgame.flagsdata.showMap` / `.wide`, `gridgame.party.setup` / `.plan` / `.tricky` / `.reveal`.

**No setting reaches puzzle generation today.** Offline and solo call `generateRandomPuzzle(countries)` bare. The nearest analogue is findFlag, which reads its key at boot and narrows the *country* pool. To narrow the *category* pool, note `randomPuzzle(rng, pool)` already takes one (`engine.js:2938`) but `generateRandomPuzzle` does not thread it through (`:3162-3165` hardcodes the default). And remember: whatever you do here, **online is unaffected** unless you change the protocol.

## Surfaces that resist deletion

TTT state escapes the browser. Before removing a mode or renaming a counter:

- **Achievements** (`flags/achievements.js`) read snapshot fields like `tttGamesPlayed9x9` / `hasWon9x9`. Badges are **already awarded to real players**; the `add-achievement` skill's stable-id rule means you stop awarding, keep displaying, and never reuse an id.
- **Cosmos head-to-head docs** (`api/src/lib/tttPairDoc.js`) are shaped `{ m3x3, m9x9 }`, computed by `tttCompute.js`, merged by `syncMerge.js`, read by `getTttResult.js` and `dailyMe.js`, reconciled by `authoring/reconcileTttPairs.mjs`. Stopping a write is cheap; changing the doc shape is a migration.
- **`api/src/lib/validate.js`** carries `TTT_MODES`. Keep accepting a retired mode so old clients and replayed rows don't 400.
- `flags/tttResultSubmit.js` / `tttPairFetch.js` / `tttPairOutcome.js` carry `mode: '3x3' | '9x9'` on the wire.
- `flags/engagementCounters.js` — `bumpShare(…, 'ttt')`.

## Test coverage map

- Reducers: `flags/ticTacToe.test.js`, `flags/ultimateTicTacToe.test.js`, `flags/onlineRoom.test.js`, `flags/ultimateOnlineRoom.test.js`.
- WS client reducers: `ticTacToe/onlineClient.test.js`, `ticTacToe/9x9/onlineClient.test.js`.
- Server: `party/ticTacToeServer.test.js`, `party/ultimateTicTacToeServer.test.js`.
- UI mechanics: `ticTacToe/shakeFeedback.test.js` (shake-on-miss, winning-cell shake), `ticTacToe/matchStrip.test.js`.
- Generation against real data: `flags/countries.test.js` (the load-bearing one).

The pages themselves are DOM and fetch glue and aren't unit-tested. Per `CLAUDE.md`, "I can't test this" means the logic is in the wrong file: push it into a sibling module or `flags/`.

## Related skills

- **`ttt-puzzle-generator`** — pool composition, the rejection ladder, retry-budget debugging. Read it for any change to *which* categories can appear.
- **`add-world-metric`** — a new metric reaches the TTT threshold mode as one of six surfaces.
- **`add-achievement`** — the stable-id rule that governs TTT badges.
- **`ui-consistency`** — "same mechanism = same code" applies hard here: give-up reveal, wrong-answer shake, and winning highlight are shared with other games.
