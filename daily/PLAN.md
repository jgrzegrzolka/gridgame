# Daily-puzzle feature — plan & context

> **Status: phases 1 + 2 shipped to `main` (PR #181, merged `c3a0100`). 1 puzzle live, 9 staged in `daily_backlog.json`. Soft launch in release-pacing mode — when you're ready for puzzle #N+1, move `backlog[0]` to the end of `daily_puzzles.json`.** Read this before doing any work on `/daily/` or anything that touches `flags/countries.json`'s difficulty model.

---

## Where we are

- `nameScore` (1–7) merged into `flags/countries.json` for all 269 entries.
- `/daily/` MVP shipped: tile on the home page, today's puzzle, deep-link `?n=N`, and an archive grid of small numbered squares (one per released puzzle).
- "Today's puzzle" is the last entry in `daily/daily_puzzles.json` — **no date math anywhere**.
- `primaryColors` field added to 21 flags with complex emblems (Portugal, Spain, San Marino, Vatican, Croatia, Serbia, Slovenia, Moldova, Montenegro, Ecuador, Bolivia, Paraguay, Belize, Dominican Republic, Mozambique, Eswatini, Namibia, Equatorial Guinea, Fiji, Egypt, Turkmenistan, Malta — the ones whose `colors` field includes COA-only colours). **It's data, not the resolver** — daily matches against `colors` (the default). See "Color-match resolution" below.
- `matchesFilters` takes an optional `{ colorField: 'colors' | 'primaryColors' }` option (default `'colors'`). Daily uses the default; findFlag / flagsdata use the default. The option exists for any future opt-in strict-mode puzzle.
- Generator's anti-overlap cap (`OVERLAP_CAP = 5`) prevents any one country from appearing in more than 5 puzzles across the catalog. Hard-blocked in onboarding; softly penalised in the tail.
- Redundant-filter test in `flags/daily.test.js`: dropping any token from any catalog filter must change the answer set. Pins the invariant against future hand-edits.
- **Primary-clean test in `flags/daily.test.js` for puzzles #1–100**: every answer must also match under `primaryColors`, not just `colors`. Pins the "no emblem-only surprises in onboarding" rule below.
- 1 puzzle live, 9 staged in backlog. The full 10 were curated together; only `#1` is exposed to players via `daily_puzzles.json`. When ready to release the next one, move `backlog[0]` to the end of `daily_puzzles.json` — the n is already sequential, the archive picks it up, and the structural test verifies the seam. The lineup history: an initial 20 surfaced "emblem-only colours feel like the game is wrong", "compound-weapon puzzles are too small / forced", and "small-property compounds feel contrived in onboarding"; on 2026-06-06 the catalog was regenerated to 20 under primary-clean + weapon-solo rules, then re-trimmed to 10 under the broader "<15 sovereign = avoid compounding" guideline, then on 2026-06-07 split into 1 live + 9 staged to support release pacing.
- One-off build scripts (`_build_daily_v2.mjs`, `_build_daily_v3.mjs`, `_build_daily_v4.mjs`, `_apply_primary_colors.mjs`) were deleted after their seed JSON committed. Catalog edits since then have been by-hand JSON tweaks, guarded by the drift detector + redundant-filter + primary-clean tests in `flags/daily.test.js`.

## Current live catalog (#1–10)

Regenerated 2026-06-06 after playtest feedback. All primary-clean. All filters use only "large" properties (≥15 sovereign matches) — no small-property compounds. #1 (Europe · cross) is Jan's pinned opener. If you regenerate, do not silently overwrite — diff against this and ask before changing positions.

The first 5 cap `nameScore ≤ 3`; #6–10 cap at ≤ 4 (the rule allows ≤ 5 but the available primary-clean filters happen to stay ≤ 4).

| # | Filter | Size | Notes |
|---|---|---|---|
| 1 | `continent:Europe,motif:cross` | 9 | Pinned opener — Nordics + Switzerland + UK + Greece + Malta + Iceland |
| 2 | `continent:Europe,motif:coat-of-arms` | 11 | Romance + Balkan COA flags |
| 3 | `continent:Asia,motif:animal` | 3 | Bhutan dragon / Kazakhstan eagle / Sri Lanka lion — all primary-visible |
| 4 | `continent:Europe,motif:star-or-moon` | 3 | Balkans (Bosnia / Croatia / Slovenia) |
| 5 | `continent:Europe,color:yellow,color:black` | 3 | Belgium / Germany / Liechtenstein |
| 6 | `continent:Europe,color:blue,color:black` | 2 | Estonia + Liechtenstein |
| 7 | `continent:Asia,color:green,color:black` | 6 | Middle East (AE, IQ, JO, KW, PS, SY) |
| 8 | `continent:Africa,color:black,motif:coat-of-arms` | 2 | Egypt + Kenya, gentle Africa intro |
| 9 | `continent:North America,motif:cross` | 3 | Caribbean (Dominica / DomRep / Jamaica) |
| 10 | `continent:Asia,color:white,color:blue` | 12 | Bigger Asian set |

**Continent coverage in the first 10:** Europe 6, Asia 2, Africa 1, NA 1, SA 0.

**Deliberately not in the first 10** (reasons in "Things to avoid" + the rules below):
- Anything compounding `motif:weapon` (13 sovereign), `continent:South America` (12), `color:orange` (10), or `continent:Oceania` (14) with another property. Under the "<15 sovereign = avoid compounding" guideline, these are reserved for solo use only.
- `continent:South America,motif:animal` — even SA solo wouldn't help here; all three SA-animal answers (bo/ec/pe) are emblem-only fauna. Until we have a `primaryMotifs` concept (analogous to `primaryColors`), SA-animal puzzles read as "the game is wrong".
- `continent:Europe,color:red,color:yellow` — 5 emblem-only-yellow surprises (hr, pt, rs, si, sm). Same "feels wrong" failure mode as the previous live #2.
- `continent:Europe,color:green` — Portugal/Italy/etc carry green only in the COA; reads as a surprise. Defer past #50.

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
- First ~30 puzzles hand-picked, easy on purpose (small answer sets, mostly famous countries, mostly Europe).
- Concrete bucket rules in use:
  - Puzzles #1–5: every answer has `nameScore ≤ 3`, size 2–25.
  - Puzzles #6–10: every answer has `nameScore ≤ 5`, size 2–25.
  - Puzzles #11–50: every answer has `nameScore ≤ 5`, size 1–25.
  - 1-flag puzzles allowed only past #50.
- After onboarding: random from the catalog, deterministic by N.
- Rejected: a "difficulty ramps linearly forever" model — doesn't survive puzzle #500.

### Primary-clean colours in puzzles #1–100 (hard rule, test-enforced)
- Every colour filter in puzzles #1–100 must resolve to the same answer set under `primaryColors` as under `colors`. No "surprise" emblem-only matches in the onboarding tail.
- Why: when a player sees Bolivia or Paraguay listed as a "blue + yellow" South American flag because the blue / yellow lives only in the coat of arms, it reads as "the game is wrong" — even though the data is technically correct. The first 100 puzzles are where players build trust in the resolver; surprises here are uniquely expensive.
- Enforced by `flags/daily.test.js` ("first 100 puzzles are primary-clean").
- Past #100: still preferred, but not enforced.

### Small properties go solo: "<15 sovereign = avoid compounding" (soft rule)
- A property whose sovereign count is below 15 should appear solo, not compounded with another filter. Soft rule — not test-enforced; we hand-check at puzzle-creation time and the authoring tool (phase 3) will surface it.
- Current "small" properties (counts under `primaryColors`):
  - `motif:weapon` — 13 sovereigns (ao, bb, bo, ec, gt, ht, ke, lk, mt, mz, om, sa, sz)
  - `continent:South America` — 12 sovereigns
  - `continent:Oceania` — 14 sovereigns
  - `color:orange` — 10 sovereigns
- Why: compounding a small property with another constraint gives answer sets of 1–3 flags with a contrived feel ("Africa, weapon, yellow" = "the African weapon flags that happen to also be yellow"). The category isn't one a player would recognise.
- "Solo" means: just `motif:weapon` worldwide, just `continent:South America` worldwide, etc. — never combined with continent / colour / other motif.
- These solo puzzles tend to need higher `nameScore` caps (e.g. SA solo includes Guyana / Suriname at nm=5), so they live in the late part of the onboarding bucket or past #10.

### Motifs we don't have a primary-quality signal for yet
- `primaryColors` distinguishes "visible from across a room" colours from "only in the COA"; `motifs` has no equivalent. Peru's `animal` (a vicuña inside its tiny COA) gets weighted the same as Sri Lanka's `animal` (the entire flag is a lion).
- Concrete fallout: `South America · animal` resolves to bo, ec, pe — all three are emblem-only fauna. Until we add `primaryMotifs`, SA-animal puzzles can't run in the first 100.
- Same applies to most `Europe · animal` answers (Albania is the one truly primary case; everyone else carries the fauna in the COA only).
- Open: do we add `primaryMotifs`, or hand-tag the few "primary-visible animal" countries? Deferred; revisit if motif-emblem surprises start showing up in player feedback past #100.

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

## Puzzle-creation checklist

The 13 rules for authoring or vetting a puzzle live in the project skill **`.claude/skills/daily-puzzle-author/SKILL.md`** — that file is the canonical source. When `daily/PLAN.md` is eventually retired the skill stays.

In short: 5 hard rules (drift detector / no-redundant-tokens / sovereign / sequential / primary-clean) are pinned by `flags/daily.test.js`. 8 soft rules (`nameScore` cap, size cap, no small-property compounds, no motif-emblem traps, reuse cap, #1 pinned, continent variety, no subset puzzles) need human judgment. Run `npm run validate` after any edit to either JSON file.

If you need to update a rule — first edit the skill, then update the test (for hard rules) in the same change.

## Implementation phases (each independently shippable)

1. **MVP: daily tile + today's puzzle + archive** ✅ shipped
   - Daily tile (first position) on home (`index.html`).
   - `/daily/?n=N` route reuses the findFlag engine with a filter set loaded from JSON.
   - Seed `daily_puzzles.json` + `daily_backlog.json`.
   - "Today's puzzle" = last entry in the live catalog (no date math).
   - Burger menu in `/daily/` has an Archive link.
   - Archive is a grid of small numbered squares, last (= today) highlighted.
2. **Catalog quality — primaryColors data + anti-overlap + redundant-filter test + primary-clean onboarding.** ✅ shipped + re-shipped 2026-06-06
   - `primaryColors` tagged on 21 flags. **Not the resolver** — kept as a quality signal for the picker, the strict-mode hook, and the onboarding gate.
   - `matchesFilters` takes `{ colorField }` (default `'colors'`); daily uses the default at game time, but the catalog test asserts the first 100 also resolve clean under `'primaryColors'`.
   - Generator has the anti-overlap cap baked in (`OVERLAP_CAP = 5`).
   - Redundant-filter test added to `flags/daily.test.js`.
   - Primary-clean test added to `flags/daily.test.js` (puzzles #1–100).
   - Live catalog regenerated 2026-06-06 to comply with: primary-clean onboarding, weapon-solo-only, no SA-animal (motif-emblem). Backlog reset to empty in the same pass.
3. **Authoring tool for catalog growth (formalised).** Today the build script is one-off and deleted after use. Phase 3 keeps it as `scripts/build_daily_catalog.mjs`, with the scoring + dedup + anti-overlap + primary-share-quality logic exposed for "add the next batch" runs.
4. **Hide future puzzles from the audience (release pacing).** Right now the live catalog publishes the full backlog of 20 because there's only one user. When friends start playing, we'll need a release pacing mechanism — either manual append (move backlog[0] over once a day by hand) or restore a lightweight clock. Defer until "release pacing actually matters." The 20-live state is intentional, not a bug to fix.
5. **Hand-curated overrides.** A `daily_overrides.json` keyed by N lets us slot in specially-designed puzzles. Generator checks overrides first.
6. **Score-sharing string.** Decide format after some real play.
7. **(Later)** New game modes (sequence/ordered). Daily can pull from any mode once they exist.

## Suggested next step

The natural next thread is **phase 3 (authoring tool)**: move the one-off build logic into `scripts/build_daily_catalog.mjs` with the scoring exposed, so "add the next batch of N puzzles" doesn't mean rewriting the generator from scratch each time. Bake in:
- **Primary-clean gate** (hard requirement for puzzles #1–100): only emit filters where every answer matches under `primaryColors`. This is what the new live catalog rests on, and what the test now pins.
- **Small-property penalty** (soft, for puzzles #1–100): downrank or reject filters that compound a property whose sovereign count is below 15 (currently `motif:weapon`, `continent:South America`, `continent:Oceania`, `color:orange`). These properties should appear solo, not combined.
- **SA-animal blocklist** (until `primaryMotifs` exists): reject `continent:South America,motif:animal` and its colour-compound variants for puzzles #1–100.
- The pin/blocklist hooks used during the soft launch (e.g. "#1 stays Europe · cross").
- Output verification: run the same checks `flags/daily.test.js` runs (drift detector, sequential n, redundant filter, primary-clean for #1–100) before writing.
- Refilling the backlog is a natural first job for this tool — current backlog is empty after the 2026-06-06 reset.

Alternative threads if Jan wants to skip ahead: phase 4 (release pacing) is what actually matters once a second player joins; phase 6 (score-sharing string) is the next thing to make daily *fun to talk about*.

## Open questions for Jan

- Score-share string: text vs emoji-grid? (Defer until we've played a few real puzzles.)
- Do you want a global leaderboard eventually? (If yes, that changes the architecture in later phases.)
- Should the `nameScore` scale extend past 6 to cover the 74 non-sovereign entries (currently flat 7)? The `/rate/` tool that produced the original ratings is gone now — any future re-rate would be a fresh effort.

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
- **Don't ship emblem-only colour matches in the first 100.** "Bolivia is blue" or "Paraguay is yellow" is technically true because both are visible in the COA, but in onboarding it reads as "the game is wrong". Use the primary-clean gate (test pins this).
- **Don't compound small properties.** Anything below 15 sovereign matches (`motif:weapon`, `continent:South America`, `continent:Oceania`, `color:orange`) belongs solo. Compounding produces tiny, contrived answer sets that don't match a category the player would recognise.
- **Don't put `continent:South America,motif:animal` in the first 100.** All three answers (bo, ec, pe) are COA-only fauna; until `primaryMotifs` exists, the puzzle reads as a surprise on every answer. Same caution applies to most `Europe · animal` puzzles.
- **Don't store puzzles by date.** Use numbers, manually released.
- **Don't rely on a calendar/clock to decide "today's puzzle".** Miss a day and the displayed history falls out of sync with the puzzle numbers. The file IS the state.
- **Don't try to design a 1000-puzzle difficulty curve.** It doesn't survive contact with reality.
- **Don't auto-generate puzzles at request time** — the catalog must be frozen, otherwise puzzle history changes when data changes.
- **Don't build a backend before you need one.** Everything in phases 1–5 works as a static site.
- **Don't put body padding in every page stylesheet.** It belongs in `common.css` (already there). Per-page CSS overrides only what genuinely differs (e.g. ticTacToe's narrower horizontal padding for the 9×9 grid).
