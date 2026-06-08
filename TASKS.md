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

#### Phase 0 — i18n re-render infrastructure  [pending]
Foundation for every later phase. Standalone PR.
- [ ] Add `reloadI18n(lang)` to `i18n.js`: re-fetch `i18n/{lang}.json`, swap `cachedStrings`, re-run `applyStringsToDocument`, dispatch a `langchanged` `CustomEvent` on `document` (detail: `{ lang }`).
- [ ] Add an opt-in flag to `wireLangToggle` (e.g. `{ softReload: true }`), default false. Unmigrated pages stay on the current `window.location.reload()` path.
- [ ] Tests in `i18n.test.js` covering: cache swap, event dispatch, `<html lang>` update, opt-in flag routing.

#### Phase 1 — daily quiz  [pending]  ← *user-stated priority*
- [ ] Flip daily's `wireLangToggle` call to `{ softReload: true }`.
- [ ] Wrap every `t()` site outside `data-i18n` markup in a `langchanged` listener so it re-runs: description, result strings, suggestion items, status messages. Files: `daily/page.js`, `daily/playFlow.js`, `daily/backlog/page.js`, `daily/backlog/play.js`, `daily/ideas/page.js`, `daily/ideas/play.js`.
- [ ] Re-run `withLocalizedAliases(rawCountries)` on `langchanged` so the suggestion matcher accepts the new language.
- [ ] Manual check: type 3 guesses, switch language → picks + input + scroll all survive; suggestion matcher accepts both languages immediately after switch.

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
