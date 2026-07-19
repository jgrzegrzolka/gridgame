---
name: ttt-puzzle-generator
description: Reference for the tic-tac-toe random puzzle generator in flags/engine.js — how it picks 6 categories, why it rejects some combinations, and what to check when it throws after exhausting its retry budget. Use when adding a new motif/colour/continent tag or population threshold, debugging a "Could not generate a puzzle after N attempts" failure, or evaluating whether a new rejection rule belongs in the generator vs at the data layer.
---

# Tic-tac-toe random puzzle generator

The tic-tac-toe board picks its categories from a pool built in `flags/engine.js`:

- `randomPuzzle(rng, pool)` — picks 6 distinct categories, first 3 become rows, last 3 become columns. `pool` defaults to the full 3×3 pool; pass a narrowed one to restrict what may be drawn.
- `generateRandomPuzzle(countries, options)` — wraps `randomPuzzle` in a retry loop, rejecting candidates that fail any of the rules below. Default `maxAttempts: 200`, `minPerCell: 2`, `pool` = the full 3×3 pool. Throws if no valid puzzle is found. The TTT boards pass `pool: buildFlagCategoryPool()` for the default (no world-metric thresholds) board and omit it only in Advanced mode (see "The flag pool" below). The default is hoisted here rather than left to `randomPuzzle`'s own default parameter, which would rebuild all 159 categories on every retry.

The pool is built from `buildRandomCategoryPool()`:

- `CONTINENTS_FOR_RANDOM` — 6 continents (Antarctica excluded).
- `COLORS_FOR_RANDOM` — 7 canonical colours (no violet — too narrow).
- `MOTIFS_FOR_RANDOM` — 6 motifs (`animal`, `coat-of-arms`, `weapon`, `star-or-moon`, `cross`, `eu-member`).
- `COLOR_COUNTS_FOR_RANDOM` — `[['=',2], ['=',3], ['=',4], ['>=',4]]`. Colour-count categories; share `exclusiveGroup: 'colorCount'` so any two of them can't pair (including `=4` × `>=4`, which overlap). `=1` has zero coverage and `>=5` has zero on Asia, so neither is in the pool. `<=N` isn't implemented; symmetric add when a use case lands.
- `STRIPES_ORIENTATIONS_FOR_RANDOM` — `['horizontal', 'vertical']`. The `hasStripesOnly` factory carries `incompatibleWith` listing every charge motif id (rule 4 below).
- `POPULATION_BREAKS_FOR_RANDOM` — 6 population-threshold breakpoints: `>=10M / >=50M / >=100M` (populous) and `<=20M / <=5M / <=1M` (small). The `population(op, n)` factory bakes `exclusiveGroup: 'population'` on all six, so no two population constraints ever meet across axes (rules out both the impossible band `>=100M × <=1M` and the redundant `>=10M × <=20M`).
- `AREA_BREAKS_FOR_RANDOM` is the km² twin, identical in shape: `>=100K / >=500K / >=1M` (large) and `<=100K / <=10K / <=1K` (small), `exclusiveGroup: 'area'`. Any future threshold metric is added the same way (see the **add-world-metric** skill).
- `DENSITY_BREAKS_FOR_RANDOM` is the people-per-km² twin, same shape: `>=100 / >=200 / >=500` (dense) and `<=100 / <=30 / <=10` (sparse), `exclusiveGroup: 'density'`.

**Metric-threshold categories (`population`, `area`, `density`, and every other world metric) are the ones whose predicate does NOT read a `countries.json` field.** They read `country.<key>`, denormalized from `flags/metrics/<key>.json` onto each Country at load by `attachMetrics` (in `group.js`), which walks the `METRIC_ATTACHERS` registry, so a new metric is one entry there and no per-metric call anywhere. Every TTT load site attaches **all of them**: the party server (`party/server.js`, static JSON import), and the offline / solo / online pages (`ticTacToe/page.js` and siblings, tolerant browser `fetch`). **If a load site forgets to attach, that metric's cells are silently always-empty** and the generator never picks them there (or burns retries). Population omits only non-place flags (the dense metrics give every real place a value); an absent value matches neither `>=` nor `<=`, and the picker's `metricDataGap` guard shows it as "no data". Rehydration from the wire/storage id needs no metric data because the predicate closes over the raw number in the id (`categoryFromId('density:>=100')`).

`ALL_MOTIFS` is a superset that adds `union-jack` for the findFlag / flagsdata UI — union-jack isn't in the random pool because it has no compelling puzzle hook and very narrow continent coverage.

## Rejection rules

The generator rejects a candidate puzzle if **any** of these fire. Each rule has a runtime check in the engine and a test that pins the behaviour against real data.

### 1. `axesConflict` — same exclusiveGroup OR explicit incompatibleWith on opposite axes

Two flavours, both checked in the same function:

**Same exclusiveGroup, different ids.** Categories with an `exclusiveGroup` (`continent`, `statehood`, `colorCount`, `stripesOnly`, `population`) can only contribute one value per country. Two continents on opposite axes (`Europe` row × `Asia` col) asks for "European AND Asian" — unsatisfiable by construction. Two stripesOnly cats (`horizontal` × `vertical`) likewise can't co-occur, and two population thresholds (`>=100M` × `<=1M`) never share a puzzle.

The check only fires across axes — multiple continents *on the same axis* are fine (that's just three continent rows, normal).

**Explicit incompatibleWith.** A category can declare cross-dimension pairs it must never appear with. `hasStripesOnly` lists every charge motif id (`hasMotif:cross`, `coat-of-arms`, `animal`, `bird`, `weapon`, `star-or-moon`, `union-jack`) because a pure-stripes flag has no overlay by definition — the cell would be structurally empty. Checked symmetrically so the declaration only lives on one side. Use this lever when "the math will reject it anyway" is true but burning retries on it would thin the puzzle space.

### 2. `axesImpliedPair` — one axis's matching set is a subset of another's

A cell `(A × B)` where `{countries matching A} ⊆ {countries matching B}` is degenerate: the B constraint adds nothing, the cell reduces to "A". The player sees the same constraint twice.

Today's live case: `motif:eu-member ⊂ continent:Europe`. Every EU member is European, so `(Europe × eu-member)` is just "EU member". The rule also covers any future Europe-only motif, Asia-only colour, etc. — it's pure set inclusion, not a hand-maintained list.

Empty match-sets are skipped — those are `isPuzzleGeneratable`'s failure mode, not this rule's.

### 3. `isPuzzleGeneratable` (3×3) — every cell has ≥ `minPerCell` countries AND `findPuzzleSolution` succeeds

Default `minPerCell = 2` so the player has a real choice in each cell. The backtracking solver then checks that 9 distinct countries can be assigned across the grid (no country reused).

### 4. `metricGroupRepeated` — one metric *family* per puzzle, across both axes

`SINGLE_USE_METRIC_GROUPS` (engine.js) bakes an `exclusiveGroup` per metric family, and this rule rejects a puzzle carrying the same family twice — including two tiers **on the same axis**, which `axesConflict` (cross-axis only) doesn't catch. So "over 10M people" and "under 1M people" can't both appear, and neither can two area tiers down the rows.

### 5. `lacksFlagVisualCategory` — every board needs ≥1 flag-reading rule

At least one of the six categories must read the flag's own visual design, not just a country fact. `FLAG_VISUAL_KINDS` is the set of id-prefixes that qualify: `hasColor`, `colorCount`, `hasMotif`, `stripesOnly`. Everything else — `continent` and every world-metric threshold (`population`, `area`, `gdp`, `temperature`, `happiness`, …) — is answerable without looking at the flag. `isFlagVisualCategory(cat)` classifies one category by that prefix; `lacksFlagVisualCategory(rows, cols)` is true iff none of the six qualify, and the generator retries.

Why this earns a rule (per the "when to add" bar below): the 40 metric families badly outnumber the 19 flag-visual categories in the 159-entry pool, so an unconstrained six-pick averages *under one* flag-visual rule — a concrete, recurring degeneracy (an all-stats board that plays as a geography quiz, not a flag game), not a curation preference. It reads ids only (no country data), so it runs **first** in the reject ladder — cheapest prune, and it thins the raw draws that carry zero flag-visual before the expensive cell checks. Pinned by the ≥1-flag-visual assertion in the 30-seed real-data sweep in `flags/countries.test.js`, plus unit tests in `engine.test.js`.

`FLAG_VISUAL_KINDS` / `isFlagVisualCategory` are also the lever the "No statistics" pool filter uses — they already partition the pool into flag-visual vs country-fact. See `buildFlagCategoryPool` below.

**The one exception to prefix-classification:** `MEMBERSHIP_MOTIF_IDS` (today just `hasMotif:eu-member`). EU membership rides in `country.motifs` so the findFlag / flagsdata filter bars can offer it, but it isn't readable off a flag — Ireland's tricolour looks the same in or out. `isFlagVisualCategory` answers false for it, which both keeps it out of the flag pool and stops a board whose only "flag rule" is `eu-member` from satisfying `lacksFlagVisualCategory`. `daily/difficulty.js` draws the same line independently (`MEMBERSHIP_MOTIFS`) for the same reason; if a second membership motif is ever tagged (NATO, Commonwealth), both sets want it.

## The flag pool (the default board)

`buildFlagCategoryPool()` = `buildRandomCategoryPool().filter(c => isFlagVisualCategory(c) || c.id.startsWith('continent:'))` — 25 categories (19 flag-visual + 6 continents) against the full pool's 159.

**This is what every tic-tac-toe board is dealt from by default.** `buildRandomCategoryPool()` (everything, metrics included) is reached only when the player opts into **Advanced mode** (`gridgame.ttt.advanced`, off by default). Note the polarity trap: `generateRandomPuzzle`'s *own* default is still the full pool, because the engine stays a general library — the product default lives in the three TTT call sites that read the setting. See the **ttt-architecture** skill for the wiring, the room-setting protocol, and the two switches per board.

*(Renamed from `buildEasyCategoryPool` in Feature U Phase 5, which also flipped the default and retired the "No statistics" / `gridgame.ttt.easy` framing. Anything you find using those names is pre-flip.)*

Two things to know before touching it:

- **It's derived, not annotated.** Membership is a function of the category id, so a new motif or colour joins automatically and metric family #41 stays out automatically. Nothing per-category to maintain — that was `ultimateEligible`'s sin (99 mentions across 32 factories for one boolean). Keep it that way. Since this is now the default board, a category that lands on the wrong side of `isFlagVisualCategory` is a bug every player sees, not a bug in an opt-in setting.
- **A smaller pool is not automatically an easier one**, so it gets its own canary. Measured over 500 real-data seeds: the flag pool generates 500/500 at a mean **5.7** attempts vs the full pool's **16.5** — dropping the metric thresholds also drops most of the exclusiveGroup collisions, so it *relaxes* the generator. In principle a narrowed pool could instead concentrate the narrow-coverage categories and starve the retry budget; the seeded sweep in `countries.test.js` is what tells us if that ever starts happening. That sweep now guards the default board, so a failure there is a broken game rather than a broken setting.

For scale on why the default moved: a full-pool board averages **1.5 of 6** flag-reading rules — barely above `lacksFlagVisualCategory`'s floor of 1, i.e. the typical random board really was a statistics quiz with one flag question wedged in, on a page that promises "every move is a country flag pick matching the row × column category". A flag-pool board averages **4.9 of 6**.

Note that `colorCount:>=4` wears the same `>=` token as a metric threshold and is very much a flag rule. Don't identify metrics by id shape — read `METRIC_KEYS`.

## When to add a new rejection rule

The rules above cover the failure modes we've seen so far. Don't add a new rule unless:

1. **You can name a concrete case the existing rules miss.** "It would be nice to also reject X" without a concrete X is premature — the cost of more rules is a tighter success window, which can exhaust the retry budget on perfectly fine pools.

2. **The case is genuinely degenerate, not just unfashionable.** "I don't like (red × Europe) puzzles" is a curation preference, not a generator bug. Curation belongs in the daily-puzzle catalogue (where humans pick), not in the random generator (where math picks).

3. **You can't fix it at the data layer.** If a motif tag is "too narrow" or "too political", consider removing it from `MOTIFS_FOR_RANDOM` (it can still live in `ALL_MOTIFS` for filters) rather than coding a new rule. The data-layer fix is more transparent and reversible.

If you do add a rule: model it after `axesConflict` / `axesImpliedPair` (a pure function on `(rows, cols, countries?)` returning a boolean), wire it into `generateRandomPuzzle`'s reject ladder, and add the matching seeds-based pin in `flags/countries.test.js`.

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
- **Refreshing `flags/metrics/population.json`** (yearly, via `authoring/build-population.mjs`) — moves countries across the fixed 10M/20M/50M/100M/1M/5M breakpoints, changing which population cells are fillable. The 30-seed sweep in `countries.test.js` attaches the real metric, so a refresh that starved a break would surface there. **Adding or changing a breakpoint** in `POPULATION_BREAKS_FOR_RANDOM` needs a matching i18n label under `population.atLeast.*` / `population.atMost.*` (keyed by the millions token, e.g. `10m`) in both `en.json` and `pl.json`, or the header renders the baked English fallback.

## Test coverage map

- **Helper unit tests**: `flags/engine.test.js` — `axesConflict` (3 tests), `axesImpliedPair` (5 tests).
- **Generator behaviour against synthetic data**: `flags/engine.test.js` — pinned across 10 seeds for both `axesConflict` and `axesImpliedPair`.
- **Generator behaviour against real data**: `flags/countries.test.js` — 30-seed sweep that runs the live pool (population attached, like production) through `generateRandomPuzzle`, asserting no implied pair leaks and the budget isn't exhausted; plus pins that population and stripesOnly categories actually surface in the pool.

When changing the generator, the real-data test is the load-bearing one — failure there means the live game is broken regardless of what synthetic tests say.
