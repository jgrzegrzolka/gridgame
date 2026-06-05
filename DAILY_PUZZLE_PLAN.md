# Daily-puzzle feature — plan & context

> **Status: phases 1 + 2 shipped to `main` (PR #181, merged `c3a0100`). 20 puzzles live, 30 staged in backlog. Single-user soft launch.** Read this before doing any work on `/daily/` or anything that touches `flags/countries.json`'s difficulty model.

---

## Where we are

- `nameScore` (1–7) merged into `flags/countries.json` for all 269 entries.
- `/daily/` MVP shipped: tile on the home page, today's puzzle, deep-link `?n=N`, and an archive grid of small numbered squares (one per released puzzle).
- "Today's puzzle" is the last entry in `daily/daily_puzzles.json` — **no date math anywhere**.
- `primaryColors` field added to 21 flags with complex emblems (Portugal, Spain, San Marino, Vatican, Croatia, Serbia, Slovenia, Moldova, Montenegro, Ecuador, Bolivia, Paraguay, Belize, Dominican Republic, Mozambique, Eswatini, Namibia, Equatorial Guinea, Fiji, Egypt, Turkmenistan, Malta — the ones whose `colors` field includes COA-only colours). **It's data, not the resolver** — daily matches against `colors` (the default). See "Color-match resolution" below.
- `matchesFilters` takes an optional `{ colorField: 'colors' | 'primaryColors' }` option (default `'colors'`). Daily uses the default; findFlag / flagsdata use the default. The option exists for any future opt-in strict-mode puzzle.
- Generator's anti-overlap cap (`OVERLAP_CAP = 5`) prevents any one country from appearing in more than 5 puzzles across the catalog. Hard-blocked in onboarding; softly penalised in the tail.
- Redundant-filter test in `flags/daily.test.js`: dropping any token from any catalog filter must change the answer set. Pins the invariant against future hand-edits.
- 50 puzzles staged: live catalog has #1–20, `daily/daily_backlog.json` holds #21–50. The 20 are an intentional soft launch (single user). When wider audience exists we'll trim live back to 1 and pace releases — tracked as phase 4.
- One-off build scripts (`_build_daily_v2.mjs`, `_build_daily_v3.mjs`, `_build_daily_v4.mjs`, `_apply_primary_colors.mjs`) were deleted after their seed JSON committed. Catalog edits since then have been by-hand JSON tweaks, guarded by the drift detector + redundant-filter test in `flags/daily.test.js`.

## Current live catalog (#1–20)

Hand-tuned after Jan's review. If you regenerate, do not silently overwrite this lineup — diff against it and ask before changing positions. #1 (Europe · cross) is Jan's pinned opener.

| # | Filter | Notes |
|---|---|---|
| 1 | `continent:Europe,motif:cross` | Pinned opener — Nordics + Switzerland + UK + Greece + Malta + Iceland |
| 2 | `continent:South America,color:blue,color:yellow` | |
| 3 | `continent:Asia,color:orange` | |
| 4 | `color:white,color:green,color:orange` | Ireland palette (worldwide) |
| 5 | `continent:Africa,motif:weapon,color:yellow` | Replaces an earlier redundant `Africa · weapon · black`; soft bucket3 violation (Eswatini=4) |
| 6 | `continent:Europe,motif:coat-of-arms` | |
| 7 | `continent:Asia,motif:animal` | |
| 8 | `continent:South America,motif:animal` | |
| 9 | `continent:Europe,color:red,color:yellow` | |
| 10 | `continent:South America,color:white,color:blue,color:yellow` | |
| 11 | `continent:North America,motif:cross` | |
| 12 | `continent:Africa,motif:weapon` | |
| 13 | `color:yellow,color:orange` | Worldwide |
| 14 | `continent:North America,motif:animal,color:red` | |
| 15 | `continent:Asia,motif:weapon` | |
| 16 | `motif:cross,color:black` | Worldwide |
| 17 | `continent:Africa,color:white,color:orange` | |
| 18 | `continent:North America,motif:animal,color:black` | 1-flag (Dominica) |
| 19 | `continent:Asia,motif:cross` | 1-flag (Georgia) |
| 20 | `continent:Europe,color:blue` | 26 flags — tipped over the 25 soft cap when re-resolved under `colors` |

`Europe · color:green` lives at **#35** in the backlog by Jan's call ("much later than first 20" because the COA-green flags read as a surprise — not a wrong-flash but worth easing in).

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
2. **`primaryColors` per flag (data quality signal, not the resolver)** — Spain is red/yellow as primary colors; white/blue/green/gold are only in the coat of arms. Tagged on the ~20 flags where this matters. **Currently NOT used as the daily matching rule** — see "Color-match resolution" below for the decision history. Kept as a quality signal for the picker (prefer puzzles where most answers match by primary) and for any future strict-mode puzzle that explicitly opts in.

### Color-match resolution: use `colors`, not `primaryColors`
First pass had daily resolve color filters against `primaryColors` so e.g. "Europe · green" wouldn't include Portugal-style flags where green is only in the coat of arms. Jan reversed that: a player typing Spain in "Europe · blue" and getting a wrong-flash is worse UX than finishing 8/11 on "Europe · green" and seeing the surprise flags in the missed list. The game telling someone "Spain isn't blue" when they can see the blue in its COA is actively wrong-feeling. So daily reverted to matching against `colors` (the default), accepting that some puzzles have a few "surprise" emblem-colour answers. The `primaryColors` data stays — it'll feed picker quality scoring later (so we don't generate puzzles where most matches are emblem-only).

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
2. **Catalog quality — primaryColors data + anti-overlap + redundant-filter test.** ✅ shipped (with the colors-vs-primaryColors u-turn described above)
   - `primaryColors` tagged on 21 flags. **Not the resolver** — kept as a quality signal for the picker and as a knob the future strict-mode puzzle can opt into.
   - `matchesFilters` takes `{ colorField }` (default `'colors'`); daily uses the default.
   - Generator has the anti-overlap cap baked in (`OVERLAP_CAP = 5`).
   - Redundant-filter test added to `flags/daily.test.js`.
   - 50-puzzle catalog generated, then re-resolved under `colors`, then hand-tuned per review.
3. **Authoring tool for catalog growth (formalised).** Today the build script is one-off and deleted after use. Phase 3 keeps it as `scripts/build_daily_catalog.mjs`, with the scoring + dedup + anti-overlap + primary-share-quality logic exposed for "add the next batch" runs.
4. **Hide future puzzles from the audience (release pacing).** Right now the live catalog publishes the full backlog of 20 because there's only one user. When friends start playing, we'll need a release pacing mechanism — either manual append (move backlog[0] over once a day by hand) or restore a lightweight clock. Defer until "release pacing actually matters." The 20-live state is intentional, not a bug to fix.
5. **Hand-curated overrides.** A `daily_overrides.json` keyed by N lets us slot in specially-designed puzzles. Generator checks overrides first.
6. **Score-sharing string.** Decide format after some real play.
7. **(Later)** New game modes (sequence/ordered). Daily can pull from any mode once they exist.

## Suggested next step

Per the conversation that shipped phase 2, the natural next thread is **phase 3 (authoring tool)**: move the one-off build logic into `scripts/build_daily_catalog.mjs` with the scoring exposed, so "add the next batch of N puzzles" doesn't mean rewriting the generator from scratch each time. Bake in:
- Primary-share quality score (prefer filters where ≥70% of answers match by primary, so we don't pump out puzzles where every answer is a COA-only surprise).
- The pin/blocklist hooks used during the soft launch (e.g. "#1 stays Europe · cross", "Europe · green not in first 20").
- Output verification: run the same checks `flags/daily.test.js` runs (drift detector, sequential n, redundant filter) before writing.

Alternative threads if Jan wants to skip ahead: phase 4 (release pacing) is what actually matters once a second player joins; phase 6 (score-sharing string) is the next thing to make daily *fun to talk about*.

## Open questions for Jan

- Score-share string: text vs emoji-grid? (Defer until we've played a few real puzzles.)
- Do you want a global leaderboard eventually? (If yes, that changes the architecture in later phases.)
- Should `/rate/` extend its scale to also cover the 74 non-sovereign entries (currently flat 7)?

## File map (for orientation)

- `flags/countries.json` — country data. Has `nameScore` on every entry; `primaryColors` on 21 entries (the ones where `colors ≠ primaryColors`).
- `flags/group.js` — `Country` typedef (optional `nameScore`, `primaryColors` declared, runtime tests pin them).
- `flags/engine.js` — filter primitives that puzzles compose.
- `flags/findFlag.js` — find-all game logic + filter serialization. Daily reuses it.
- `flags/daily.js` — daily catalog helpers: `todayN`, `getPuzzle`, `dailyNFromUrl`, `resolveDailyPuzzle` (the discriminated-union resolver that page.js consumes). Pure logic, no date math.
- `flags/flagsFilter.js` — `matchesFilters` resolver. Takes optional `{ colorField: 'colors' | 'primaryColors' }`; default `'colors'`. Daily uses the default. The option exists for future opt-in strict-mode puzzles.
- `flags/daily.test.js` — covers daily.js + the live and backlog catalogs (drift detector under `colors`, sequential n live + backlog, redundant-filter, every answer code resolves to a sovereign, resolveDailyPuzzle's four reason branches).
- `daily/` — UI: `index.html` (today's puzzle), `archive.html` (grid of past puzzles), `page.js`, `archive.js`, `index.css`, `archive.css`, `daily_puzzles.json` (released), `daily_backlog.json` (staged).
- `findFlag/` — find-all UI; daily's play page borrows its game styles via the shared `../findFlag/index.css`.
- `common.css` — chrome (`body::before`, `body { padding: var(--page-top) 24px 24px }`), shared button styles. ticTacToe overrides only the horizontal padding for the 9×9 grid.
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
