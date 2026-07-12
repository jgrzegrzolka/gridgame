---
name: add-world-metric
description: End-to-end recipe for adding a new world metric (area, GDP, coffee production, ...) to gridgame, or wiring an existing metric into one more surface. Covers all six surfaces a metric can reach (the data file, the flagsdata lens, the flagsdata + findFlag "Make a puzzle" filters, the TTT threshold mode with no-data handling, the Flag Party round, and daily superlative puzzles), which are free vs which need code, the cross-surface data contract (every real place has a value; "no data" means only non-places), and a paste-able checklist to track done/deferred per metric. Use when Jan asks to add a metric, extend one to another surface, or plan/track that work. Per-metric progress lives in a DATA_FEATURE.md Feature entry, not here; this is the reusable recipe.
---

# Adding a world metric

A "metric" is a continuous world fact keyed per country (population, area, GDP, coffee production, ...). It lives in `flags/metrics/<key>.json` and, once added, can surface on up to six places. **Only the data file is mandatory.** Every consumer below is an independent opt-in, and several are free once the data exists.

**Two artifacts, two jobs.** This skill is the *recipe* (how each surface is wired, identical for every metric). The *tracking* of which surfaces are done, in flight, or deferred for a specific metric belongs in a **DATA_FEATURE.md Feature entry** with a phase checklist, exactly like Features DD/DE/DF/DG. Don't record per-metric state here; paste the checklist at the bottom into a new Feature entry and tick it there.

## Writing style: never the em dash

Jan bans the long em dash (`—`) everywhere: i18n copy, code comments, this skill, commit messages, chat. It reads as AI-generated. Use a comma, a full stop, a colon before a list, or parentheses. The en dash `–` for numeric ranges (`1946–1992`) is a different character and is fine. Grep new content for `—` before finishing. See memory `feedback_no_em_dash`.

## The data contract (read this before anything else)

Two rules that every surface leans on. Settle them at data time; getting them wrong makes the TTT "no data" guard misbehave.

1. **Every real place gets a value; only non-places have none.** A "real place" is `category !== 'other'` (sovereign states, territories, sub-national regions). A "non-place" is `category === 'other'` (the org flags: EU, UN, ASEAN, and any future fictional flag like a Jolly Roger). The TTT picker's `metricDataGap` guard (`flags/metricTiers.js`) shows a suggestion disabled with a "no data" tag exactly when a metric axis has no value for it, so **"no data" must mean "not a rankable place," nothing else.** A real place with a missing value would be wrongly blocked (this is the Antarctica bug we fixed: it was omitted, so it read "no data" on a "population under 1M" cell even though it obviously qualifies). Fill every real place. Uninhabited or zero-quantity places carry `0`, not omission. The test `flags/metrics.test.js` pins this invariant per metric.

2. **Absence policy for sparse metrics.** Population and area are *dense*: every real place has a real value, so you fill them all (population fills the ~8 uninhabited territories with 0 or transient counts in `build-population.mjs`). Production metrics (coffee, apples, medals) are *sparse*: the source table only lists producers. For those, "absent from the source" safely means `0` for a real place (a country not in the coffee table grows no coffee). Two ways to honor rule 1 for a sparse metric:
   - Simplest: fill `0` for every real place missing from the source (explicit, larger data file).
   - Cleaner (not built yet): give the metric file an `absence: 'zero'` hint and have the `attach<Key>s` loader default missing real places to `0`. Build this the first time a sparse metric lands; population/area don't need it. **Never infer `0` for a metric where absence means "unknown, not zero"** (GDP: every country has substantial GDP; a missing value is unsourced, not zero). For an `absence: 'unknown'` metric, a missing real place stays truly "no data" and the guard correctly blocks it until you source it. So: source it.

## The six surfaces, cheapest first

Numbered to match how the work is usually described. Each notes what it touches, its sub-skill, and whether it can be deferred.

### 1. Data file (required, small)

Add `flags/metrics/<key>.json`, self-describing: `key` / `label` / `unit` / `format` / `source` / `year` / `values`. `format` is a display hint (`'compact'` for 1.4B / 337M / 552K, `'decimal1'` for one-decimal rates). Generate it with an `authoring/build-<key>.mjs` refresh script modelled on `build-population.mjs` (fetch source, join by ISO code, hand-maintained `FILLS` for what the source omits, honor the data contract above). Add one line to `flags/metrics/index.js`'s `METRIC_FILES`. Add the schema + data-contract test to `flags/metrics.test.js` (integers, coverage invariant, keys are real places). This alone lights up surface 2 for free.

### 2. flagsdata metric lens (free once data exists)

The lens (pick a metric, see value + rank per tile, sort, sparse dimming) is metric-agnostic via `createMetric` (`flags/metrics.js`) and the `METRIC_FILES` registry. Adding the data file (surface 1) makes the new metric appear in the flagsdata lens selector with no further code. Feature DE. Nothing to do here beyond surface 1.

### 3. flagsdata filter bar + findFlag "Make a puzzle" filter (moderate)

Threshold tier pills (`>=100M` / `<=1M`, ...) that both surfaces share via `flags/metricTiers.js`. Order:

- **Register the tiers once.** Add one line to `METRIC_TIER_REGISTRY`: `<key>: { breaks: <KEY>_BREAKS_FOR_RANDOM, factory: <key>, has: (c) => typeof c.<key> === 'number' }` (the `breaks` and `factory` come from surface 4; `has` powers the no-data guard). `buildMetricTierItems('<key>', countries)` now backs both surfaces so they can't drift.
- **findFlag chooser** (five coordinated edits): (a) scalar `<key>` on `Filters` + a `matchesFilters` branch reading the denormalized field (`flags/flagsFilter.js`); (b) a `<key>:>=N` URL token in `parseFilterString` / `serializeFilter` + `pillLabel` / `filterTitle` (`flags/findFlag.js`), reusing the `<key>.atLeast/atMost` i18n from surface 4; (c) a single-select chooser section in `findFlag/page.js` built from `buildMetricTierItems`; (d) `attach<Key>s` at findFlag's own load site (it fetches the metric JSON itself); (e) a `<key>Probability` modifier path in `pickRandomMix` (mutually exclusive with colorCount) so Random can reach every tier. Then update the **findflag-random-coverage** skill (its rule requires documenting the new modifier). Add `findFlag.sections.<key>` (en + pl).
- **flagsdata filter group.** A single-select group via `buildFilterGroup`-style code in `flagsdata/page.js` (the `buildPopulationGroup` pattern), labelled by the shared `pillLabel`, wired into Clear / the filter-count badge / the language switch, plus `attach<Key>s` at flagsdata's load site. No new i18n if surface 4's `<key>.atLeast/atMost` labels and a `findFlag.sections.<key>` title exist.

### 4. TTT threshold mode + no-data handling (most code)

Mirror Feature DF. In `flags/engine.js`: a `<key>(op, n)` category factory (bake `exclusiveGroup: '<key>'`) + a `<KEY>_BREAKS_FOR_RANDOM` list; mark all-but-one break `ultimateEligible: false` if the extremes can't back a 9×9 cell. Wire into `buildRandomCategoryPool` / `categoryFromId` / `translateCategoryLabel`. Add `<key>.atLeast.*` / `<key>.atMost.*` i18n (en + pl). See the **ttt-puzzle-generator** skill.

**`attach<Key>s(countries, values)` at every load site.** Both party servers (`party/server.js`, `party/ultimateServer.js`), both offline pages, both online pages (they fetch the metric JSON tolerantly so a fetch failure only disables the guard), and findFlag (surface 3d). **Forgetting one site = silently-empty cells or a misfiring guard.** Model `attach<Key>s` on `attachPopulations` in `flags/group.js`.

**No-data handling comes for free if the data contract holds.** `metricDataGap` (`flags/metricTiers.js`) already blocks any suggestion whose metric value is missing, and the registry's `has` (surface 3) is what it reads. As long as every real place has a value (rule 1), the guard blocks only non-places, which is correct. Nothing metric-specific to write here beyond the `has` line. Verify in-browser on a threshold cell that a real small place is pickable and an org shows "no data" (the `verify` recipe used for population).

### 5. Flag Party round (moderate; the round factory is already generalized)

`flags/partyRounds/superlative.js` exports a `createSuperlativeRound(metric, roundId)` factory that takes a `createMetric(...)` instance, so a new metric is a **sibling round**, not a rewrite. Population (`superlative`), area (`superlative-area`), and density (`superlative-density`) are all registered through it. Unlike surfaces 2-4 this one does **not** auto-light from `METRIC_FILES`: each round is registered explicitly, so it's the surface most likely to be forgotten. Mirror the density round across six spots (grep `densityRound` / `superlative-density` for the exact set): (a) `superlative.js` (import the metric json + `export const <key>Round = createSuperlativeRound(createMetric(<key>, []), 'superlative-<key>')`); (b) `superlative.test.js` round-instance test; (c) `party/partyGameServer.js`'s `ROUNDS` array; (d) `flags/partyPlan.js` `METRIC_MODES` + `partyPlan.test.js`; (e) `flagParty/page.js` `MODE_LABELS` + `SUPERLATIVE_MODES` + an icon SVG; (f) i18n en+pl `party.mode.superlative<Key>` / `party.modeShort.*`.

### 6. Daily puzzles: NOT part of "done"; tracked in `METRIC_DAILY_PUZZLES.md`

The daily surface is deliberately **not** a code surface and **does not block the Feature's completion**. It's open-ended authoring on Jan's cadence (released daily puzzles are immutable, so they can't ride along with a code PR). So it lives in its own tracker, `METRIC_DAILY_PUZZLES.md`: when a metric's surfaces 1-5 land, add a row there and close the Feature. Do not author daily puzzles unprompted (see memory `project_metric_daily_puzzles_deferred`). For reference, the two parts, both metric-agnostic:

- **Superlatives: zero new code.** `resolveSuperlative` (`flags/superlative.js`) is metric-agnostic. Author `{ kind: "superlative", metric: "<key>", scope, direction, topN, filter? }` entries per the **daily-puzzle-author** skill. Rendering, difficulty, `checkSuperlativeShape` and `audit-superlative.mjs` already handle any metric key.
- **Result-screen rank captions (small code).** The population captions (`flags/populationRank.js` + the `metric === 'population'` branch in `daily/page.js`) are metric-specific. Add a `build<Key>RankNotes` and a branch, or generalize `populationRank.js` to take a metric key + label/unit + en/pl caption strings. Without it, that metric's superlatives show the plain flag name on zoom (harmless, just plainer).

## Tracking: seed a DATA_FEATURE.md Feature entry

When you actually start a metric, open a Feature entry under `## Now` in DATA_FEATURE.md and paste this checklist (surfaces 1-5). Tick each as it lands. **Close the Feature (move to `## Done`) once surfaces 1-5 are shipped**; the daily surface is tracked separately in `METRIC_DAILY_PUZZLES.md` and never keeps a Feature open.

```markdown
### Feature <ID>: <Metric> as a world metric

**Data contract:** dense (fill all real places) | sparse (absence: zero) | universal (source all, absence: unknown)

- [ ] 1. Data: `flags/metrics/<key>.json` + `build-<key>.mjs` + `METRIC_FILES` line + `metrics.test.js` schema/coverage/no-org invariant
- [ ] 2. flagsdata lens (free once step 1 lands; just confirm it appears)
- [ ] 3. Filters: `metricTiers.js` registry line (+ `has`); findFlag chooser (5 edits) + `findflag-random-coverage` skill note; flagsdata filter group; `attach<Key>s` at both load sites
- [ ] 4. TTT: `<key>()` factory + `<KEY>_BREAKS_FOR_RANDOM` + pool/id/label wiring; `attach<Key>s` at all 6 load sites; `<key>.atLeast/atMost` i18n; verify no-data guard in-browser
- [ ] 5. Flag Party round (needs `partyRounds/superlative.js` generalized first, a one-time cost)

Surface 6 (daily puzzles) is NOT a checkbox here: when 1-5 land, add a row to `METRIC_DAILY_PUZZLES.md` and close the Feature.
```

Sub-skills for the individual surfaces: **ttt-puzzle-generator** (surface 4), **findflag-random-coverage** (surface 3e), **daily-puzzle-author** (surface 6). Worked example end to end: population (Features DD, DE, DF, DG in DATA_FEATURE.md, plus the no-data guard and uninhabited-fill follow-ups).
