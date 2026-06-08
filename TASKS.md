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

#### Phase 2 — findFlag  [pending]
Same shape as daily, smaller surface (6 sites). Mostly a copy of phase 1's pattern.

#### Phase 3 — flagQuiz  [pending]
21 sites. 60s mode: clock keeps running through the lang swap — that's the intended behaviour in soft mode, not a bug.

#### Phase 4 — ticTacToe  [pending]
Largest single area: 42 sites across `ticTacToe/{page,offline}.js` × `{3x3,9x9}`. Server-pushed strings (status lines on the online client) stay server-driven; only the locally-rendered strings need re-running on `langchanged`.

#### Phase 5 — flagsdata + archive/ideas/backlog  [pending]
Mop-up. ~6 sites total.

---

## Done

(empty)
