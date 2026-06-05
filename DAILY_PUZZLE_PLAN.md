# Daily-puzzle feature — plan & context

> **Status: phase 1 shipped, mid-review of the first 20 puzzles. Next up: `primaryColors` / `emblemColors` split.** Read this before doing any work on `/daily/` or anything that touches `flags/countries.json`'s difficulty model.

---

## Where we are (2026-06-05)

- `nameScore` (1–7) merged into `flags/countries.json` for all 269 entries.
- `/daily/` MVP shipped: tile on the home page, today's puzzle, deep-link `?n=N`, and an archive grid of small numbered squares (one per released puzzle).
- "Today's puzzle" is the last entry in `daily/daily_puzzles.json` — **no date math anywhere**.
- 50 puzzles staged total: live catalog has #1–20 (under review), `daily/daily_backlog.json` holds #21–50.
- The first 20 are being reviewed with Jan. One swap made so far (`#1` is now `Europe · cross`).

## Open thread we're working on

Jan reviewed the first 20 puzzles and flagged three concerns:

1. **"Europe · green" includes flags where green is only in the coat of arms** (Portugal, San Marino, Moldova, Montenegro …). Players can't see the green from across the room. The fix is the `primaryColors` / `emblemColors` split that was already deferred to "phase 7" — promoted to be the next thing.
2. **Sane country sets per puzzle** — the mechanical lever to add is an *anti-overlap cap* in the picker: "no country appears in more than K of the first 20 puzzles." Right now Portugal/San Marino/Moldova/Montenegro show up in 5–6 of the first 11 puzzles, so consecutive plays feel like déjà vu. Other "is this a good puzzle" judgments stay human.
3. **Redundant constraints inside a single filter** (e.g. `a,b,c` resolves to the same set as `a,b` — `c` adds nothing). The generator already dedupes by answer set and prefers the simpler filter, so this can't happen via the generator. To prevent a hand-edit from sneaking one through, add a test that drops each token of every catalog filter and asserts the answer set changes.

## Key design decisions (don't re-litigate)

### Puzzles are numbered, manually released
- URL form: `/daily/?n=47` — **not** `?date=2026-06-04`.
- Removes timezone ambiguity ("I solved #47" is unambiguous regardless of local midnight).
- Decouples puzzle identity from the calendar (we can skip a day, do bonus puzzles, etc. without renumbering).
- **No date math at all.** "Today's puzzle" = the last entry in `daily/daily_puzzles.json`. Releasing puzzle N+1 means appending its entry to the live catalog (typically by moving the next staged entry from `daily/daily_backlog.json`). The UI auto-picks the new last entry on next load.
- The earlier `n = floor((now_UTC − launchDate) / 1 day) + 1` formula was tried and dropped — the moment we miss a day or want to postpone, the calendar and the displayed history fall out of sync.

### Catalog is a static, append-only JSON, with a planning backlog
- Source of truth: `daily/daily_puzzles.json` — only contains *released* puzzles. Runtime is dead-simple array lookup: puzzle #N = `puzzles[N − 1]`.
- Staging: `daily/daily_backlog.json` — same shape, holds puzzles already designed but not yet released. To release the next puzzle, move `backlog[0]` to the end of the live catalog. Both files stay sequential without renumbering anything.
- **Critical invariant:** once shipped, puzzle #47 must stay frozen. Adding new flag attributes or fixing country data later must **not** retroactively change historical puzzles. Stored shape is `{ n, filter, answers }` — the filter is the spec (used to display the label and as a drift detector in tests), the answers are the source of truth at game time.

### Onboarding ramp, then random
- First ~30 puzzles hand-picked, easy on purpose (small answer sets, mostly famous countries).
- Concrete bucket rules in use:
  - Puzzles #1–10: every answer has `nameScore ≤ 3`, size 3–25, no 1-flag puzzles.
  - Puzzles #11–50: every answer has `nameScore ≤ 4`, size 1–25.
- After onboarding: random from the catalog, deterministic by N.
- Rejected: a "difficulty ramps linearly forever" model — doesn't survive puzzle #500.

### Two-axis difficulty model
The Spain example shows why these have to be separate dimensions:
1. **`nameScore` per country (1–6)** — "would a player think to type *Spain* when prompted for European countries?" Wiktoria's ratings drive this. Merged into `countries.json`.
2. **`primaryColors` per flag (manual tag, not built yet — next up)** — Spain is red/yellow as primary colors; white/blue/green/gold are only in the coat of arms. By **default**, color/motif puzzles should match `primaryColors` only — otherwise the puzzle "European flags with green" includes Portugal/San Marino/Moldova/Montenegro and players feel cheated. `colors` keeps its existing meaning (everything visible, used by findFlag's "browse" UI). Strict-mode puzzles (hand-curated only) can opt in to the broader `colors` field.

### Sovereign-only scope (for now)
- 195 sovereign = 193 UN members + Vatican + Palestine.
- The other 74 entries (territories, organizations, disputed states) default to `nameScore: 7` in export. Communicate "Sovereign countries only" in the daily-puzzle UI so players don't try typing Puerto Rico.
- Extending scope to territories is a later decision; if we do, the scale extends past 6.

### Sequence / ordered puzzles ("top 10 most populated") = separate game mode
- Different mechanic (order matters, partial credit different). Don't try to cram into find-all.
- Build it later as its own game mode (e.g. `sequenceFlags/`). Once it exists, daily can occasionally surface a sequence puzzle.

### Score sharing = clipboard, no backend
- Wordle-style emoji grid or a simple text line, copied to clipboard. No accounts, no leaderboard. Decide the exact format once we have a few real puzzles to test with.

## Implementation phases (each independently shippable)

1. **MVP: daily tile + today's puzzle + archive** ✅ shipped
   - Daily tile (first position) on home (`index.html`).
   - `/daily/?n=N` route reuses the findFlag engine with a filter set loaded from JSON.
   - Seed `daily_puzzles.json` + `daily_backlog.json`.
   - "Today's puzzle" = last entry in the live catalog (no date math).
   - Burger menu in `/daily/` has an Archive link.
   - Archive is a grid of small numbered squares, last (= today) highlighted.
2. **Catalog quality — primaryColors split + anti-overlap + redundant-filter test.** *Next up.*
   - Add `primaryColors: string[]` field to each country in `countries.json`. For most flags `primaryColors === colors`; the ~15–20 flags with detailed coats of arms (Portugal, Spain, San Marino, Vatican, Croatia, Serbia, Slovakia, Slovenia, Moldova, Montenegro, Andorra, Belarus, Hungary, Sri Lanka, Saudi Arabia, Mexico, Ecuador, Brazil, etc.) get a trimmed `primaryColors` that drops the COA-only colors.
   - Make `matchesFilters` field-aware: take an optional `{ colorField: 'colors' | 'primaryColors' }` so daily uses `primaryColors` while findFlag stays on `colors`.
   - Generator gains an *anti-overlap cap*: no country appears in more than K (≈ 4) of any 20-puzzle window.
   - Redundant-filter test in `flags/daily.test.js`: for every catalog entry, removing any one token from the filter must change the answer set.
   - Regenerate the 50-puzzle catalog with the new rules, re-do the human review with Jan.
3. **Authoring tool for catalog growth (formalised).** Today the build script is one-off and deleted after use. Phase 3 keeps it as `scripts/build_daily_catalog.mjs`, with the scoring + dedup + anti-overlap logic exposed for "add the next batch" runs.
4. **Hand-curated overrides.** A `daily_overrides.json` keyed by N lets us slot in specially-designed puzzles. Generator checks overrides first.
5. **Score-sharing string.** Decide format after some real play.
6. **(Later)** New game modes (sequence/ordered). Daily can pull from any mode once they exist.

## Open questions for Jan

- Score-share string: text vs emoji-grid? (Defer until we've played a few real puzzles.)
- Do you want a global leaderboard eventually? (If yes, that changes the architecture in later phases.)
- Should `/rate/` extend its scale to also cover the 74 non-sovereign entries (currently flat 7)?
- When we do `primaryColors`, should `colors` get renamed to something less ambiguous (`allColors`?) or stay as it is?

## File map (for orientation)

- `flags/countries.json` — country data; has `nameScore`. Will get `primaryColors` next.
- `flags/group.js` — `Country` typedef.
- `flags/engine.js` — filter primitives that puzzles compose.
- `flags/findFlag.js` — find-all game logic + filter serialization. Daily reuses it.
- `flags/daily.js` — daily catalog helpers (`todayN`, `getPuzzle`, `dailyNFromUrl`). Pure logic, no date math.
- `flags/flagsFilter.js` — `matchesFilters` resolver. Will gain a `colorField` option in phase 2.
- `flags/daily.test.js` — covers daily.js + the live and backlog catalogs (drift detector, sequential n, all answer codes resolve to sovereigns).
- `daily/` — UI: `index.html` (today's puzzle), `archive.html` (grid of past puzzles), `page.js`, `archive.js`, `index.css`, `archive.css`, `daily_puzzles.json` (released), `daily_backlog.json` (staged).
- `findFlag/` — find-all UI; daily's play page borrows its game styles via the shared `../findFlag/index.css`.
- `common.css` — chrome (`body::before`, `body { padding: var(--page-top) 24px 24px }`), shared button styles.
- `i18n.js` + `i18n/{en,pl}.json` — translation system. Daily strings live under the `daily.*` keys.
- `CLAUDE.md` — repo conventions (folder structure, tests, UI consistency); read first.

## Things to avoid (lessons from this conversation)

- **Don't conflate "country famous" with "flag colors memorable".** They're orthogonal. Spain is famously known but its coat-of-arms colors are not.
- **Don't store puzzles by date.** Use numbers, manually released.
- **Don't rely on a calendar/clock to decide "today's puzzle".** Miss a day and the displayed history falls out of sync with the puzzle numbers. The file IS the state.
- **Don't try to design a 1000-puzzle difficulty curve.** It doesn't survive contact with reality.
- **Don't auto-generate puzzles at request time** — the catalog must be frozen, otherwise puzzle history changes when data changes.
- **Don't build a backend before you need one.** Everything in phases 1–5 works as a static site.
- **Don't put body padding in every page stylesheet.** It belongs in `common.css` (already there). Per-page CSS overrides only what genuinely differs (e.g. ticTacToe's narrower horizontal padding for the 9×9 grid).
