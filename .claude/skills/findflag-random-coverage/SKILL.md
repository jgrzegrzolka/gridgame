---
name: findflag-random-coverage
description: Reference for the findFlag chooser's "Random" button — what tags/modifiers it can pick, where the pool is assembled, and the contract that every visible chooser option must be reachable AND every result must match ≥1 flag. Use when adding a motif/colour/continent/status filter or modifier toggle (the new option must be added to the random pool too), debugging "Random landed on a 0-flag mix", or tuning the modifier probabilities.
---

# findFlag random-mix coverage

The chooser's **Random** button (and the result page's "Random next" link) calls `pickRandomMix` in `flags/findFlag.js`. The contract has two halves:

1. **Coverage** — every category surfaced in the chooser UI must be reachable by Random. If you add a new motif, colour, continent, or modifier toggle to the chooser, the Random pool must learn about it too, or the new option becomes "click-only" — invisible to a player who plays random rounds.
2. **Liveness** — every result must match at least one flag. `pickRandomMix` retries up to `maxAttempts` (default 20) until `minIntersection` (default 1) is hit; if it never is, it returns the last attempt and `startGame` bounces back to the chooser. Don't lower `minIntersection` below 1 unless you're testing the fallback path itself.

## What's in the pool today

Built in `findFlag/page.js#renderChooser` from three `engine.js` constants:

- **Continents** — `CONTINENTS` filtered to those with ≥1 country.
- **Colours** — `ALL_FLAG_COLORS` filtered to those with ≥1 country.
- **Motifs** — `ALL_MOTIFS` filtered to those with ≥1 country.
- **Stripes** — `STRIPES_ORIENTATIONS_FOR_RANDOM` (`horizontal`, `vertical`) filtered to those with ≥1 country. Scalar group — `SCALAR_GROUPS` enforces at most one stripesOnly pill per mix. When a stripesOnly pill lands in a mix, the colorCount modifier paths are **skipped** — pure stripes already carry a tight palette, layering colorCount on top either restates the palette or collapses the answer set to a single flag.

Each pill becomes a `{ group, value }` entry in the `allPills` array. The Random click strips the DOM-bound `btn` and passes the rest as `pillPool` to `pickRandomMix`.

**Modifiers** (live in the chooser but *not* in `allPills` — `pickRandomMix` handles them via separate code paths):

- **"no other colours" toggle** — sets `filter.colorCount = { op: '=', n: <count of include colours> }`. In Random: gated on `onlyColorsProbability` and only fires when the pill loop already produced ≥1 include colour.
- **colorCount picker** (`=`/`>=`/`<=` × N ∈ `[2, 3, 4, 5]`) — sets `filter.colorCount` directly. In Random: gated on `colorCountProbability`, fires independently of whether colours are picked, picks op/N uniformly from `COLOR_COUNT_OPS` × `COLOR_COUNT_NS` (both exported from `flags/flagsFilter.js`).

**Deliberately out of the chooser today** (and therefore out of Random):

- **Status filter** (UN member / observer / territory) — per the renderChooser comment, "keeping the chooser's tag inventory the same as before the refactor." Status pills *would* round-trip through `pickRandomMix` if the page added them to `allPills`; the helper already treats `status` as a scalar group.
- **"Other continent"** — same reason.

## When you add a new option

Walk this checklist before merging:

### 1. New pill (motif / colour / continent / status value)

The pill enters the chooser via `ALL_MOTIFS` / `ALL_FLAG_COLORS` / `CONTINENTS`. As long as the new value has ≥1 country, `renderChooser` will surface it and `allPills` will carry it into Random. **Verify with the empirical coverage test** in `flags/findFlag.test.js` ("empirical coverage — every visible pill AND the colorCount modifier appear over many runs") — it runs the random generator 8000 times against live data and asserts every pill in the assembled pool appears at least once. If a new pill has very narrow coverage (one or two countries), it'll come out under-represented but still appear; the test catches a hard 0.

### 2. New modifier (a new colour-count op, a new constraint kind)

Modifiers ride the parallel paths in `pickRandomMix`, not the pill pool. Two specific things:

- If you add a new colour-count **op** (e.g. `>5`) or **N value** (e.g. `6`), update `COLOR_COUNT_OPS` / `COLOR_COUNT_NS` in `flags/flagsFilter.js`. Both the picker UI and the random generator import from there, so a single edit covers both surfaces. The test "colorCountProbability=1 attaches a picker-shaped colorCount" asserts ops stay in `{=, >=, <=}` and N stays in `{2, 3, 4, 5}` — update the assertion's valid sets when widening the surface.
- If you add an entirely new constraint kind (e.g. a `region` filter parallel to `continent`), it's a new code path in `pickRandomMix`. Mirror the existing two-arg gate: skip the `rng()` call when the probability is 0 so existing seeded tests stay deterministic.

### 3. New status pill in the chooser

If the chooser starts surfacing status pills, add them to `allPills`. `pickRandomMix` already treats `status` as scalar (max one status pill per mix, like continent).

### 4. New scalar-group dimension (parallel to stripesOnly)

If you add a new scalar dimension to `countries.json` (something where each country has exactly one value or null), three coordinated edits:

- Add it to `SCALAR_GROUPS` in `flags/findFlag.js` so two-value AND is impossible per mix.
- Decide whether it should be mutually exclusive with `colorCount` (like stripesOnly is) and gate the modifier accordingly inside `maybeAttachColorCount`. Rule of thumb: skip the modifier if the dimension already implies a tight palette.
- Update the empirical coverage test if the new pool entries are very narrow (a single country or two), or accept that the assertion remains "≥1 over 8000 runs" — narrow tags are still reachable, just under-represented.

## Liveness — "Random must land on ≥1 flag"

`pickRandomMix` retries up to `maxAttempts` times and accepts the first attempt where the filter matches ≥`minIntersection` countries. The 20-attempt budget is generous enough that even tight modifier combos (e.g. "Europe × cross × no other colours") usually find a hit; if a future addition is so narrow that the retry loop routinely fails, the symptom is:

- The Random button starts producing 0-flag mixes (visible in the result page's "0 flags" state) more often.
- The empirical coverage test starts taking notably longer (more attempts per call).

When that happens, options in order of preference:

1. **Remove the narrow tag from the chooser entirely** — if it has so few matches that random can't reach a valid mix, it's not a fun puzzle category anyway.
2. **Reduce the modifier probabilities in `findFlag/page.js#RANDOM_MIX_OPTIONS`** — lower `onlyColorsProbability` / `colorCountProbability` so the tight-constraint paths fire less often. The pill-only path will always find a hit (it picks from the visible pills which by definition each have ≥1 country).
3. **Increase `maxAttempts`** — last resort. The default 20 is plenty for a healthy pool; raising it papers over the symptom without fixing the cause.

Don't disable `minIntersection`. A 0-flag Random click is the worst UX — the player sees an empty result page and has no obvious way to know whether they clicked something wrong or the generator failed.

## Probabilities — current values and why

In `findFlag/page.js`:

```js
const RANDOM_MIX_OPTIONS = {
  onlyColorsProbability: 0.25,
  colorCountProbability: 0.10,
};
```

- `0.25` for "no other colours" — it's a very recognizable puzzle shape ("flags whose colours are exactly red + white"), so quarter-of-the-time keeps it discoverable without making it feel mandatory.
- `0.10` for independent colorCount — less natural framing on its own, so rarer.

These are tunable knobs in one place. The `pickRandomMix` helper itself defaults both to 0 so non-page callers (and existing tests) get pure pill-only behaviour.

## Test coverage map

- `flags/findFlag.test.js`:
  - Pill-selection contract (existing): "always emits 2-4 pills", "at most one pill per scalar group", `excludeProbability` boundaries.
  - Modifier contract: `onlyColorsProbability=1` locks colorCount to the include-colour count; never fires without an include colour; `colorCountProbability=1` attaches a picker-shaped constraint; both at 0 means colorCount stays null AND no rng bytes are spent (so the existing seeded tests stay deterministic).
  - **Empirical coverage test**: 8000 runs against live data; pins that every pill in the assembled pool appears at least once and the modifier fires at least once. This is the load-bearing test for the "every chooser option is reachable" contract — if it fails after a chooser change, that change is the bug.
