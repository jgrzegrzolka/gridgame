# Tasks

Working document for in-progress work that spans multiple sessions. A fresh agent picking this up should:

1. Read `CLAUDE.md` (project rules).
2. Read this file.
3. Find the active task below, locate its **next step**, and continue.
4. Update this file as each step completes (check off boxes, move finished phases to `## Done`).

---

## Active

### i18n in-place re-render (no page reload on language switch)

**Problem:** `wireLangToggle` in `i18n.js` does `window.location.reload()` on language change. Any partial progress on the page (typed guesses, in-flight input, scroll position) is lost. Most painful on the daily quiz.

**Approach:** replace the reload with an in-place i18n re-pass + a `langchanged` event that per-page renderers subscribe to. Phased so each phase is independently shippable; pages not yet migrated keep the old reload behaviour.

**Scope (from grep on `\bt\(['"`]`):**
- daily quiz: ~7 sites across 6 files
- findFlag: 6 sites
- flagQuiz: 21 sites
- ticTacToe: 42 sites across 4 pages
- flagsdata + archive + ideas + backlog: ~6 sites

Plus `withLocalizedAliases(countries)` in `i18n.js` must be re-run on lang change wherever a country-name picker is in scope (daily, findFlag, flagQuiz, ttt) — the suggestion matcher's Polish aliases are otherwise stale.

#### Phase 0 — i18n re-render infrastructure  [in PR #263]
Foundation for every later phase.
- [x] Add `reloadI18n(lang, options)` to `i18n.js`: re-fetch `i18n/{lang}.json`, swap `cachedStrings`, re-run `applyStringsToDocument`, dispatch a `langchanged` `CustomEvent` on `document` (detail: `{ lang }`). `fetchImpl` + `doc` are injectable so tests don't need to mock globals.
- [x] Add `softReload` + `base` + `doc` + `reload` options to `wireLangToggle` (all default to the legacy behaviour). Soft mode also registers a `langchanged` listener that keeps `data-current` in sync so a second click flips back correctly.
- [x] Tests in `i18n.test.js`: cache swap, `<html lang>` update, event dispatch with `{ detail: { lang } }`, non-ok fetch is a silent no-op, base-prefix honoured, soft-mode listener registration, soft-mode click delegates to injected reload + persists language.

#### Phase 1 — daily quiz  [in PR #263]  ← *user-stated priority*
- [x] Flip `daily/index.html`, `daily/backlog/play.html`, `daily/ideas/play.html` to `wireLangToggle(lang, undefined, { softReload: true, base })`. Browse-only daily pages (archive, backlog/ideas index) intentionally stay on hard reload — no game state to preserve there.
- [x] `playFlow.js` returns a `{ refreshI18n({ all, targets, label }) }` handle. Tile display names are kept fresh via a module-level `WeakMap<HTMLElement, Country>` + a `refreshTileNames` walk that hits both in-game found and result-screen found/missed lists.
- [x] Extract `attachLangRefresh(game, deps)` + `showReason(reason)` into `playFlow.js` so the three play pages (and six error branches) call shared helpers instead of copying listener boilerplate.
- [x] Extract `computeLangRefreshPayload({ raw, targetCodes, filter })` as the pure half, with unit tests in `daily/playFlow.test.js` pinning the matcher-gets-new-aliases + targets-resolve-by-code + label-re-translates contracts.
- [ ] Manual smoke: open `/daily/`, type 3 guesses, switch language → picks + input text + scroll survive, hover labels in new language, suggestion matcher accepts both languages.

**Deferred (noted explicitly so we don't lose them):**
- Tests for `refreshTileNames` (DOM walk + WeakMap lookup). Low-risk function but pinning the data-name/img.alt contract would be nice. Worth adding when Phase 2 needs to lift the helper out of `playFlow.js`.
- Tests for the soft-mode fetch-failure → `window.location.reload()` fallback in `wireLangToggle`. Edge case (network drop mid-toggle); the code path is one line.
- Lift `attachLangRefresh` + `computeLangRefreshPayload` out of `daily/playFlow.js` once Phase 2 needs them. Per CLAUDE.md "promote when the second consumer arrives."

#### Phase 2 — findFlag  [in progress]
- [x] Lift `computeLangRefreshPayload` + the tile-name refresh (`bindTileCountry` / `refreshTileNames` over a module-private `WeakMap<HTMLElement, Country>`) out of `daily/playFlow.js` into the new shared `langRefresh.js`. Tests moved to `langRefresh.test.js` and gained coverage for `bindTileCountry` / `refreshTileNames` (registered tile renames, unregistered tile passthrough, missing-translation fallback).
- [x] `findFlag/page.js`: `flagTile` now calls `bindTileCountry`. `renderChooser` and `startGame` both return `{ refreshI18n(newAll) }` handles. The chooser tracks section h2s (key + fallback), pill label spans (with group + value), and the "no other colours" label span so each can be re-translated in place without rebuilding the chooser DOM (preserves the user's pill selections). The game re-derives targets + category label from the stored filter on each lang flip.
- [x] `findFlag/index.html`: `wireLangToggle(lang, undefined, { softReload: true, base: '../' })`.
- [x] A single boot-level `langchanged` listener swaps `all`, calls `refreshTileNames`, and forwards to whichever surface (chooser or game) is active.
- [ ] Manual smoke: open `/findFlag/`, pick 2 pills, switch language → pill labels re-translate, selections intact; start a game, type 2 guesses, switch language → input + tiles + suggestion matcher all carry over to the new language.

**Deferred:**
- `colorCountPicker` aria-labels stay in the boot-time language (only screen-reader audible; visible chip symbols `= ≥ ≤ × 2..5` don't need translation). Add a `refreshI18n` exit on `createColorCountPicker` when this becomes a real complaint.
- Tests for the chooser's `refreshI18n` (DOM-heavy walk; would need a substantial fake document).

#### Phase 3 — flagQuiz  [in progress]
- [x] `flagQuiz/index.html` + `flagQuiz/stats/index.html`: `wireLangToggle(lang, undefined, { softReload: true, base })`.
- [x] `flagQuiz/page.js`: `startGame` returns `{ refreshI18n() }`. Mid-round refresh re-translates the play-mode label, the mode-toggle links, and the current country prompt. Post-round refresh re-paints the result strings (Final score, Time, Your best score, "new record!") from a captured `resultLabelData` so we don't re-run `recordResult` or re-fire the celebration.
- [x] Burger menu and first-visit picker rebuild via clear-and-reappend (`buildQuizMenu` / `buildVariantPicker`) so variant labels, "Your stats", "Buy me a coffee", and the include-territories toggle text all re-translate. Same pattern in the stats page's inline script.
- [x] 60s mode: timer keeps running through the lang swap (intended — the budget shouldn't pause).
- [ ] Manual smoke: start a 60s round, answer a few, switch language → mode toggle + current prompt re-translate, timer keeps counting; finish the round, switch language on result → "Final score / Your best score / Time / new record!" all re-translate.

**Deferred:**
- Mid-flash feedback text (the wrong-answer country name in `feedbackEl`) stays in the boot-time language for the ~1s window before the next render clears it. Tiny edge.

#### Phase 4 — ticTacToe  [in progress]
- [x] All four ttt HTMLs opt into `softReload`: `ticTacToe/index.html`, `ticTacToe/9x9/index.html`, `ticTacToe/offline/index.html`, `ticTacToe/9x9/offline/index.html`.
- [x] Each `page.js` registers a `refreshI18nForGame()` listener that re-translates the column + row headers from the puzzle's categories, re-runs `renderGrid` (refreshes cell `<img>.alt` via `countryName`) + `renderStatus`/`renderTurn`, re-translates the picker's "row × col" line when the picker is open, and re-paints the final-score text from a side-effect-free `paintFinalScore()` so a langchanged event never re-fires confetti.
- [x] Online pages introduce `setStatusKey(key, fallback, params)` for transient status (connecting / connection-error / disconnected-reconnecting) plus a `repaintStatusForLang` closure tracker so renderStatus (state-derived) re-installs itself while transient paints replay their stored key + template params.

**Deferred (in TASKS.md so not lost):**
- `state.statusOverride` rejection strings are translated at reducer time and stored already-translated, so a lang flip after a rejection leaves the lobby error stale. Fix would require returning `{ key, fallback }` from the reducer and translating at paint time — touches `ticTacToe/onlineClient.js` + `ticTacToe/9x9/onlineClient.js`.
- `showError(t('ttt.codeMustBe5'))` on the join form leaves the validation message stale across a lang flip while the user is still on the lobby. Small edge.
- The four page.js files duplicate near-identical `paintFinalScore` + `refreshI18nForGame` + `setStatusKey` + `repaintStatusForLang` shapes. The 3×3 / 9×9 split predates this work; a future refactor could lift the shared bits into a `ticTacToe/sharedClient.js`.

#### Phase 5 — flagsdata + archive/ideas/backlog  [pending]
Mop-up. ~6 sites total.

---

## Done

(empty)
