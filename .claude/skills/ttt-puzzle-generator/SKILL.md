---
name: ttt-puzzle-generator
description: Reference for the tic-tac-toe random puzzle generator in flags/engine.js — how it picks 6 categories, why it rejects some combinations, and what to check when it throws after exhausting its retry budget. Use when adding a new motif/colour/continent tag, debugging a "Could not generate a puzzle after N attempts" failure, or evaluating whether a new rejection rule belongs in the generator vs at the data layer.
---

# Tic-tac-toe random puzzle generator

The 3×3 and 9×9 tic-tac-toe boards both pick their categories from the same pool. The generator lives in `flags/engine.js`:

- `randomPuzzle(rng)` — picks 6 distinct categories from the pool, first 3 become rows, last 3 become columns.
- `generateRandomPuzzle(countries, options)` — wraps `randomPuzzle` in a retry loop, rejecting candidates that fail any of the rules below. Default `maxAttempts: 200`, `minPerCell: 2`. Throws if no valid puzzle is found.
- `generateUltimateRandomPuzzle(countries, options)` — same loop, but the cell check is the stronger 9×9 Hall-marriage feasibility (`hasUltimatePuzzleSolution`). Default `maxAttempts: 500`.

The pool is built from `buildRandomCategoryPool()`:

- `CONTINENTS_FOR_RANDOM` — 6 continents (Antarctica excluded).
- `COLORS_FOR_RANDOM` — 7 canonical colours (no violet — too narrow).
- `MOTIFS_FOR_RANDOM` — 6 motifs (`animal`, `coat-of-arms`, `weapon`, `star-or-moon`, `cross`, `eu-member`).
- `COLOR_COUNTS_FOR_RANDOM` — `[2, 3]`. Exact-N colour-count categories; share `exclusiveGroup: 'colorCount'` so two different N values can't pair. N=1 has zero coverage; N≥5 has zero coverage on at least one continent. N=4 is plausible but blurs into "many colours" without a `>=4` neighbour — left out until a future PR adds `>=`.

`ALL_MOTIFS` is a superset that adds `union-jack` for the findFlag / flagsdata UI — union-jack isn't in the random pool because it has no compelling puzzle hook and very narrow continent coverage.

## Rejection rules

The generator rejects a candidate puzzle if **any** of these fire. Each rule has a runtime check in the engine and a test that pins the behaviour against real data.

### 1. `axesConflict` — same exclusiveGroup on opposite axes

Categories with an `exclusiveGroup` (`continent`, `statehood`) can only contribute one value per country. Two continents on opposite axes (`Europe` row × `Asia` col) creates a cell that asks for "European AND Asian" — unsatisfiable by construction.

The check only fires across axes — multiple continents *on the same axis* are fine (that's just three continent rows, normal).

### 2. `axesImpliedPair` — one axis's matching set is a subset of another's

A cell `(A × B)` where `{countries matching A} ⊆ {countries matching B}` is degenerate: the B constraint adds nothing, the cell reduces to "A". The player sees the same constraint twice.

Today's live case: `motif:eu-member ⊂ continent:Europe`. Every EU member is European, so `(Europe × eu-member)` is just "EU member". The rule also covers any future Europe-only motif, Asia-only colour, etc. — it's pure set inclusion, not a hand-maintained list.

Empty match-sets are skipped — those are `isPuzzleGeneratable`'s failure mode, not this rule's.

### 3. `isPuzzleGeneratable` (3×3) — every cell has ≥ `minPerCell` countries AND `findPuzzleSolution` succeeds

Default `minPerCell = 2` so the player has a real choice in each cell. The backtracking solver then checks that 9 distinct countries can be assigned across the grid (no country reused).

### 3b. `hasUltimatePuzzleSolution` (9×9) — Hall-marriage check

For the 9×9 board, each of the 9 cells needs `perCell = 9` distinct countries with no overlap. The check enumerates all 2^9 − 1 = 511 non-empty subsets of cells and verifies the union of their candidate countries is large enough (Hall's defect theorem). Cheap enough to run inside the loop.

## When to add a new rejection rule

The current three rules cover the failure modes we've seen so far. Don't add a new rule unless:

1. **You can name a concrete case the existing rules miss.** "It would be nice to also reject X" without a concrete X is premature — the cost of more rules is a tighter success window, which can exhaust the retry budget on perfectly fine pools.

2. **The case is genuinely degenerate, not just unfashionable.** "I don't like (red × Europe) puzzles" is a curation preference, not a generator bug. Curation belongs in the daily-puzzle catalogue (where humans pick), not in the random generator (where math picks).

3. **You can't fix it at the data layer.** If a motif tag is "too narrow" or "too political", consider removing it from `MOTIFS_FOR_RANDOM` (it can still live in `ALL_MOTIFS` for filters) rather than coding a new rule. The data-layer fix is more transparent and reversible.

If you do add a rule: model it after `axesConflict` / `axesImpliedPair` (a pure function on `(rows, cols, countries?)` returning a boolean), wire it into both `generateRandomPuzzle` and `generateUltimateRandomPuzzle`, and add the matching seeds-based pin in `flags/countries.test.js`.

## Why not a data-level exclusions file?

It's tempting to keep a hand-maintained list like `[{ a: "motif:eu-member", b: "continent:Europe", reason: "..." }]`. We considered it and chose the algorithmic guard instead because:

- The subset check is math, not opinion. `A ⊆ B` is well-defined.
- A hand-maintained list duplicates information the data already carries. Every new Europe-only tag would need a manual entry.
- An exclusion list misses cases nobody anticipated. A new colour that turns out to only appear on Asian flags would silently produce "Asia × that-colour" puzzles until someone audits the list.

Curated lists make sense for *opinions* (the daily-puzzle catalogue's "no subset puzzles in #1-100" — humans pick what's interesting). They don't make sense for *math*.

## Debugging: "Could not generate a random puzzle after N attempts"

The generator throws when the retry budget is exhausted. Walking the diagnostic ladder:

1. **Run the failing input through a debug script.** Count how many of the 200 attempts hit each rejection: `axesConflict`, `axesImpliedPair`, `isPuzzleGeneratable` (cells too sparse), unfilled. The breakdown points at which rule is over-firing.

2. **If `axesImpliedPair` rejects ~50%+ of attempts**, a recently-added motif is probably a near-universal tag (e.g. it ended up on every country). Check the data: a motif on every country makes every continent/colour axis a subset of it. The historic example was synthetic test data tagging every country with every motif — see the `syntheticTaggedCountries` comment in `flags/engine.test.js`.

3. **If `isPuzzleGeneratable` rejects most attempts**, the data is too sparse — a (continent × motif) cell has 0–1 candidates. Either the motif is in `MOTIFS_FOR_RANDOM` despite poor continent coverage (move it to `ALL_MOTIFS`-only), or a country was recently dropped that was carrying coverage for that cell.

4. **If the seed-success test in `countries.test.js` fails on real data**, that's the canary — the pool drifted past the retry budget for ≥1 seed in the 30-seed sweep. Don't bump the budget without first looking at *why* — usually the right fix is data or rule design, not more retries.

## When data changes

- **Adding a motif to `MOTIFS_FOR_RANDOM`** — verify by running `generateRandomPuzzle` under the 30-seed test in `flags/countries.test.js`. If it fails, the new motif's coverage is too narrow for the retry budget to absorb. Options: move it to `ALL_MOTIFS`-only (filter-only), or bump the pool-wide retry budget (last resort).
- **Adding a country** — usually safe; new coverage relaxes the search space.
- **Removing a country** — check the 30-seed test still passes. The country might have been the sole carrier of some (continent × motif) coverage.
- **Changing `primaryColors` on a country** — `axesImpliedPair` reads against the default `colors` field (primary + additional). Splitting a colour primary→additional doesn't move the country out of the motif's match-set, so the implication graph is stable.

## Test coverage map

- **Helper unit tests**: `flags/engine.test.js` — `axesConflict` (3 tests), `axesImpliedPair` (5 tests).
- **Generator behaviour against synthetic data**: `flags/engine.test.js` — pinned across 10 seeds for both `axesConflict` and `axesImpliedPair`.
- **Generator behaviour against real data**: `flags/countries.test.js` — 30-seed sweep that runs the live `MOTIFS_FOR_RANDOM` pool through `generateRandomPuzzle`, asserting no implied pair leaks and the budget isn't exhausted.

When changing the generator, the real-data test is the load-bearing one — failure there means the live game is broken regardless of what synthetic tests say.
