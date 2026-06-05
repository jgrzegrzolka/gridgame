# Daily-puzzle feature — plan & context

> **Status: paused, waiting on input data.** Don't start implementing yet — see "Resuming" below.

This note hands off the design context for a daily-puzzle feature that's been planned but not yet implemented. Read this before doing any work on `/daily/` or anything that touches `flags/countries.json`'s difficulty model.

---

## Where we are

The `/rate/` tool was built (PRs #179 + #180, merged into `main`) so a human can score every sovereign country 1–6 on how well-known it is. The tool exports a JSON map of `{ code: score }` covering all 269 country codes — 195 sovereign rated by hand, 74 non-sovereign provisionally defaulted to `7`.

**We're waiting for Jan (and friends helping on phones) to actually finish rating.** Until that JSON exists and is merged into `countries.json`, the puzzle generator has no difficulty signal to work with.

## Resuming — what to do when the ratings arrive

1. **Merge ratings into `flags/countries.json`.** Add a `nameScore` field (number, 1–7) to every entry from the exported `country-ratings-YYYY-MM-DD.json`. Bump the `Country` typedef in `flags/group.js`. Add tests in `flags/countries.test.js` covering the new field's presence and range.
2. **Confirm with Jan which implementation phase to start with** (see "Implementation phases" below) — most likely Phase 1 (the smallest viable daily-puzzle MVP), but he may want to skip ahead.
3. **Do not** start phase 2+ until phase 1 is shipped and used. Each phase is independently valuable.

## The feature in one paragraph

A daily flag puzzle that everyone sees the same on the same day, accessible from a tile on the home page. Like Wordle, but using the existing find-all-flags mechanic. Past days are browsable in an archive. Designed for friends to compare scores. Some puzzles will be auto-generated from filter combinations (continent / color / motif); others will be hand-curated specials that are too weird for the regular `findFlag/` UI ("flags with a triangle on the hoist pointing to the center").

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
- After onboarding: random from the catalog, deterministic by N.
- Rejected: a "difficulty ramps linearly forever" model — doesn't survive puzzle #500.

### Two-axis difficulty model
The Spain example shows why these have to be separate dimensions:
1. **`nameScore` per country (1–6)** — "would a player think to type *Spain* when prompted for European countries?" Wiktoria's ratings drive this.
2. **`primaryColors` vs `emblemColors` per flag (manual tag, not built yet)** — Spain is red/yellow as primary colors; white/blue/green/gold are only in the coat of arms. By **default**, color/motif puzzles should match `primaryColors` only — otherwise the puzzle "European flags with white" includes Spain and players feel cheated. Strict-mode puzzles (hand-curated only) can match either.

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
   - Seed `daily_puzzles.json` starts with puzzle #1; `daily_backlog.json` holds 49 staged puzzles ready to release.
   - "Today's puzzle" = last entry in the live catalog (no date math).
   - Burger menu in `/daily/` has an Archive link.
   - Archive shows every released puzzle, last entry highlighted as today.
2. **Authoring tool for catalog growth.** Enumerates filter combos, dedups by answer-set hash, trims redundant filters (don't include a continent filter that doesn't narrow the result), scores difficulty. Output gets human-reviewed and appended to `daily_puzzles.json`.
3. **Per-country difficulty integrated.** Use `nameScore` (after merge in step 0) in the catalog dedup and difficulty scoring.
4. **Onboarding + difficulty-aware selection.** Hand-pick the first ~30 easy ones, then random from the catalog within a sensible band.
5. **Hand-curated overrides.** A `daily_overrides.json` keyed by N lets us slot in specially-designed puzzles. Generator checks overrides first.
6. **Score-sharing string.** Decide format after some real play.
7. **(Later)** Add `primaryColors` / `emblemColors` per flag — manual tag pass on ~15–20 flags with complex emblems (Spain, Portugal, Mexico, Ecuador, Brazil, Croatia, Serbia, Slovakia, Sri Lanka, Saudi Arabia, Iran, Belarus, Turkmenistan, Kyrgyzstan, etc.). Default color/motif puzzles to `primaryColors`.
8. **(Later)** New game modes (sequence/ordered). Daily can pull from any mode once they exist.

## Open questions for Jan when resuming

- Which phase do you want first? (Default recommendation: phase 1.)
- Pick a launch date for puzzle #1.
- Score-share string: text vs emoji-grid? (Defer to phase 6.)
- Do you want a global leaderboard eventually? (If yes, that changes the architecture in phase 5+.)
- Should `/rate/` extend its scale to also cover the 74 non-sovereign entries (currently flat 7)?

## File map (for orientation)

- `rate/` — the rating tool (merged; the source of the ratings JSON we're waiting on)
- `flags/countries.json` — country data; needs `nameScore` added when ratings arrive
- `flags/group.js` — `Country` typedef (will need updating)
- `flags/engine.js` — filter primitives (`continent` / `hasColor` / `hasMotif` / `statehood`) that puzzles compose
- `flags/findFlag.js` — find-all game logic, fully tested; daily reuses this
- `findFlag/` — find-all UI; daily's UI borrows the same engine and most of the same look
- `CLAUDE.md` — repo conventions (folder structure, tests, UI consistency); read first
- `i18n.js` + `i18n/{en,pl}.json` — translation system; daily puzzle UI should localize visible strings

## Things to avoid (lessons from this conversation)

- **Don't conflate "country famous" with "flag colors memorable".** They're orthogonal. Spain is famously known but its coat-of-arms colors are not.
- **Don't store puzzles by date.** Use numbers.
- **Don't try to design a 1000-puzzle difficulty curve.** It doesn't survive contact with reality.
- **Don't auto-generate puzzles at request time** — the catalog must be frozen, otherwise puzzle history changes when data changes.
- **Don't build a backend before you need one.** Everything in phases 1–6 works as a static site.
