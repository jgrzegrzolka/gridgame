# Data tasks

Working document for in-progress work on **flag-data maintenance** — anything that changes `flags/countries.json` (the shape, the tags, the per-flag rules) or the catalog conventions that depend on data shape. Kept separate from `FEATURE.md` (program / hosting / infra) so the two streams don't tangle in one file.

A fresh agent picking this up should:

1. Read `CLAUDE.md` (project rules).
2. Read `.claude/skills/daily-puzzle-author/SKILL.md` (the catalog rules — most data changes ripple into puzzle authoring).
3. Read this file.
4. Find the **first uncompleted feature** under `## Now`, locate its **next step**, and continue.
5. `## Backlog` is off-limits to agents — items there are deferred-but-not-forgotten. Jan promotes a backlog item to `## Now` when he decides to ship it.
6. Update this file as each step completes.

**Branching:** each phase = one branch off `main` + one PR. Run `git checkout main && git pull` *before* `git checkout -b ...`. Don't auto-merge — Jan merges each PR himself.

**Concurrent-work caution:** Jan often has a separate agent in flight on program/perf work. Before committing here, run `git status` and **stage data files by name only** (e.g. `git add flags/countries.json DATA_FEATURE.md`) — never `git add -A` or `git add .`, both of which would scoop up the other agent's WIP.

---

## Now

### Feature DJ: GDP + GDP per capita as world metrics

Fourth and fifth world metrics, added as a pair. **GDP** is *sourced* (World Bank, exactly like area); **GDP per capita** is *derived* from it (`gdp / population`, exactly like density). Doing them together is cheaper than separately: per-capita is derived from GDP, so once GDP's data lands the second is a ~20-line build script, and both surfaces get wired in one pass over near-identical code. Adds an economic dimension: "10 biggest economies", `>=$1T`, richest/poorest per head.

**Data contract:** GDP is **universal** (absence = unsourced, not zero), so *every* real place is sourced or hand-filled: World Bank covers 203 at 2023, 10 states fall back to their most-recent WB year (Cuba 2020, Eritrea 2011, ...), and 49 territories / sub-national regions / North Korea / Taiwan come from `build-gdp.mjs`'s FILLS (best-available estimates, magnitude is what the game surfaces). The 8 uninhabited territories carry **0 deliberately** (no permanent economy), not omission. GDP per capita is **dense** off that: derived where both inputs exist, and the 3 population-0 places (Bouvet, Heard, Clipperton) are defined as 0 rather than a divide-by-zero drop.

**Data-quality note:** Vatican tops per-capita ($375K), an artifact of its rough $300M GDP estimate over ~800 people (its GDP isn't really measured). Harmless for the code surfaces; watch it when hand-authoring per-capita superlative puzzles (surface 6, deferred).

**Verification sweep (2026-07-12):** four parallel agents cross-checked all 74 hand-estimated + stale-fallback figures against Eurostat / ONS / INE / INSEE / IMF / CIA Factbook. 71 held; 3 corrected: South Sudan $12B→$6B (stale 2015 WB figure, oil-collapse; now an `OVERRIDES` entry in `build-gdp.mjs`), Saint Helena whole-territory $50M→$80M (was inconsistent with its own component islands), Niue $10M→$18M. All 8 uninhabited zeros and the North Korea / Taiwan / Vatican estimates were confirmed defensible.

**Refactor first (PR #827, merged):** before adding GDP, the threshold-metric filter machinery was generalized onto a single `THRESHOLD_METRICS` registry in `engine.js` (behavior-neutral, −80 lines). A consequence: the registry now drives *both* the filter surfaces and the TTT random pool, so **surfaces 3 and 4 are one unit** for GDP, not separate PRs like density had, adding the registry entry lights up both (and would break TTT generation without the attach sites).

- [x] 1. Data: `flags/metrics/gdp.json` + `gdpPerCapita.json` (262 real places each) + `build-gdp.mjs` (WB fetch + mrnev fallback + 49 FILLS) + `build-gdp-per-capita.mjs` (derived, no fetch) + two `METRIC_FILES` lines + `formatValue` trillions tier (+ its test) + `metrics.test.js` schema/coverage/universal-invariant/derived-spot-check/uninhabited-0/ranking for both (#825)
- [x] 2. flagsdata lens (free once step 1 landed; "GDP" + "GDP per capita" in the selector, compact display)
- [x] 3 + 4 (landed together, see refactor note). `gdp()` / `gdpPerCapita()` factories + `GDP_BREAKS_FOR_RANDOM` (`>=100B/500B/1T`, `<=10B/1B/100M`, `>=100B` ultimate) / `GDP_PER_CAPITA_BREAKS_FOR_RANDOM` (`>=30K/50K/70K`, `<=5K/2K/1K`, `>=30K` ultimate) + two `THRESHOLD_METRICS` registry entries with `labelFor` (compact US$ token, breakpoints chosen so bare "$30K" reads as per-capita and "$100M" as total). `attachGdps` / `attachGdpPerCapitas` (group.js) at all 8 load sites (2 party servers, 2 online + 2 offline TTT pages, flagsdata, findFlag). Filters: `Filters` fields + findFlag chooser sections + `gdpProbability` / `gdpPerCapitaProbability` random modifiers + flagsdata filter groups. i18n en+pl (`metric.*`, `gdp.atLeast/atMost.*`, `gdpPerCapita.*`, `findFlag.sections.*`). Tests: factories, categoryFromId round-trip, labelFor formatting, attach, parse/serialize, pillLabel/filterTitle, random reachability, real-data 3×3 surfacing + 9×9 ultimate pins (+10 tests). `findflag-random-coverage` skill updated. **Verified in-browser** (fresh-origin dev server): flagsdata lens (value+rank overlays) + both filter groups render, "over $1T" → exactly 20 flags; findFlag chooser shows both GDP sections with correct pills; offline TTT loads + generates clean. (#828)
- [ ] 5. Flag Party round (needs `partyRounds/superlative.js` generalized first, a one-time cost that then benefits every future metric)
- [ ] 6. Daily (deferred, see Backlog): rank captions + superlative puzzles

**Standing artifact:** `authoring/build-gdp.mjs` — the pattern for a **universal** metric (fill every real place; mrnev fallback for states missing the snapshot year). `build-gdp-per-capita.mjs` — a second derived metric after density, confirming the divide-and-round pattern generalizes.

---

### Feature DI: Population density as a world metric

Third world metric (after population, area). A **derived rate**: no external source, `density = population / area` for every real place that has both. Exercises the `decimal1` format and confirms the `add-world-metric` process on a computed metric.

**Data contract:** dense (every real place has both population and area, so density is defined for all; only orgs have none). Values are people/km², stored rounded to 2 decimals for ranking precision, displayed at 1 decimal (`decimal1`). Derived, so `build-density.mjs` reads the two metric files with no network call.

- [x] 1. Data: `flags/metrics/density.json` (262 real places) + `authoring/build-density.mjs` (derived, no fetch) + `METRIC_FILES` line + `metrics.test.js` schema/coverage/no-org/derived-spot-check/ranking
- [x] 2. flagsdata lens (free once step 1 landed; "Population density" in the selector, decimal1 display)
- [x] 3. Filters: `density()` factory + `DENSITY_BREAKS_FOR_RANDOM` (>=100/200/500, <=100/30/10) + `metricTiers` registry entry + `attachDensities`; flagsFilter `density` constraint + `matchesFilters`; findFlag parse/serialize/pillLabel/filterTitle + `densityProbability` modifier + chooser section; flagsdata group (reused `buildMetricGroup`); i18n; tests. Verified in-browser: flagsdata "over 500 people/km²" → 28 flags
- [x] 4. TTT: `density(op, n)` breaks wired into `buildRandomCategoryPool` / `categoryFromId` / `translateCategoryLabel` (plain-integer token, reusing surface-3's `density.atLeast/atMost` keys) + `attachDensities` at all 6 load sites; engine pool/9×9 tests + real-data seed pins (surfaces in 3×3, only `>=100` in 9×9). Verified in-browser: a generated 3×3 rendered a `density:>=500` cell; 262 real places valued, only the 7 orgs are no-data (#808)
- [x] 5. Flag Party round: `createSuperlativeRound(createMetric(density, []), 'superlative-density')` registered in `partyGameServer` + PARTY_MODE + client `MODE_LABELS` / `SUPERLATIVE_MODES` entry + en/pl i18n + round test. Verified against dev server: mode in `PARTY_MODES`, i18n keys resolve, density.json loads (#809)
- [ ] 6. Daily (deferred, see Backlog): rank captions + superlative puzzles

**Standing artifact:** `authoring/build-density.mjs` — the first **derived** metric (computed from other metrics, no source). The pattern for future ratios (GDP per capita, etc.): read the input metric files, divide, round, emit.

---

## Backlog

### Deferred: metric daily superlative puzzles (area, density, future metrics)

**Deferred 2026-07-11 at Jan's request** — daily-content authoring is time-consuming and needs his supervision (released puzzles are immutable, daily rule 1), so it does not ride along with the code surfaces. Not forgotten; see memory `project_metric_daily_puzzles_deferred`.

**What's pending, per metric:** author daily superlative puzzles ("the N largest / smallest countries by area / density", per-continent) via the **daily-puzzle-author** skill, the way population's shipped in Feature DG. `resolveSuperlative` is metric-agnostic so this is **zero new code** — just authored `{ kind: "superlative", metric, scope, direction, topN }` entries + a review pass with Jan. Optionally the result-screen rank captions (`build<Metric>RankNotes`, small code). Applies to area (Feature DH surface 6), density (DI surface 6), GDP + GDP per capita (DJ surface 6), and every future metric. Agents: do NOT author these unprompted; wait for Jan.

---

## Done

### Feature DH: Land area as a world metric — *code surfaces shipped 2026-07-11 (#802, #803, #804, #805); daily deferred*

Second world metric after population, added to prove the `add-world-metric` skill end to end. All five **code** surfaces shipped; surface 6 (daily puzzles) is deferred to Backlog at Jan's request.

**Data contract:** dense. Every real place has a land area (km²), including uninhabited territories (Antarctica ~14.2M, Bouvet 49). Source: World Bank WDI `AG.LND.TOTL.K2` (2022) + 47 hand-fills. Values whole km² except microstates under 1 (Vatican 0.49).

**Verified 2026-07-12:** the 47 hand-filled areas + a join-sanity pass on the World Bank leaders were cross-checked by the same 4-agent sweep used for GDP (see Feature DJ). Clean, zero corrections. Clipperton's 2 km² is land-only, consistent with the `AG.LND.TOTL.K2` land basis.

- [x] 1. Data (`area.json` + `build-area.mjs` + tests). [x] 2. Lens (free). [x] 3. Filters (flagsdata + findFlag, via the shared `metricTiers` registry + generalized `buildMetricGroup`). [x] 4. TTT (`area()` factory + `AREA_BREAKS_FOR_RANDOM`, attach at 6 sites, seed pins). [x] 5. Flag Party (generalized `createSuperlativeRound` factory, `superlative-area` mode).
- [ ] 6. Daily — **deferred** (see Backlog + Feature DG's population precedent).

**Standing artifacts that made DI (density) and every future metric cheaper:** the `metricTiers` registry (one line per metric lights up both filter surfaces), `buildMetricGroup` (metric-keyed flagsdata group), and `createSuperlativeRound(metric, id)` (any metric gets a Flag Party round). Verified in-browser at each surface.

### Feature DE: Metric lens in flagsdata — *shipped 2026-07-11 (phase 3 reframed)*

**Goal.** flagsdata gains an opt-in **metric lens** — pick a world metric (from `flags/metrics/`) to *look through*, and the explorer reparameterizes: each tile shows that metric's value + rank, you can sort by it, filter by tier, and one-tap superlative presets (Top N / Lowest N / Top N in Europe). Defaults to **None** — flagsdata stays a flag explorer; metrics are the power-user layer. First real consumer of Feature DD's data. **Explore-only; create-puzzle stays untouched.**

**Design decisions (settled 2026-07-10, from the interactive mockup):**

- **Default None.** flagsdata's core identity is flag browsing (colour / motif / continent). A metric is an opt-in lens layered on top, never forced.
- **Metric = a lens (one active metric), not columns.** The tile shows *at most* the active metric's value + rank. Switching the lens re-renders everything. Ten metrics don't crowd a tile — you look through one at a time.
- **Why it does NOT touch shared `flagsFilter.js`.** Metric rank/tier is **set-relative** (you need the whole scope to know the cutoff), while `matchesFilters(country, filters)` is a **per-flag predicate**. They're architecturally different, so metric logic lives in the flagsdata page via `createMetric` and never enters the shared filter DSL. This is *why* the lens can't leak into findFlag's create-puzzle chooser — the sharing that categorical filters have simply doesn't apply.
- **Sparse handling.** On a sparse metric, countries with no value **dim to "no data"** and drop out of the ranking / sort / tier (`createMetric().has()`).
- **Three capabilities, mapped deliberately.** *Lens display* (value/rank/sort) → explore only. *Tiers* (high/mid/low) → explore only; tertile boundaries are fuzzy, fine for browsing but bad for puzzle answer sets. *Superlative top-N* → the crisp, good puzzle mechanic, but here it appears only as an explore **preset**.
- **create-puzzle / daily superlatives are a separate later feature** (settled: "leave out for now"). When built, they get a *superlative builder* (metric + scope + N → exact set), never tier pills, and never via the per-flag filter DSL.
- **Additive metric-file change:** a `format` hint (`'compact'` → 1.4B / 337M / 552K, `'decimal1'` → one-decimal per-capita rates). Self-describing; consumers read it for display.

**Phasing** (this feature, on one branch each — don't auto-merge):

1. **Data + spec** *(done — #763).* `format` hint on `population.json` + `build-population.mjs`; `createMetric` passthrough (defaults to `'compact'`); schema test; this spec; moved Feature DD to Done.
2. **Lens UI in flagsdata** *(done — #767, #769, #772).* Metric selector (None default) built from the `flags/metrics/` registry; tiles show value + rank for the active metric; sort (A–Z / Highest / Lowest); sparse dimming. i18n labels in `en.json` / `pl.json`. Lens-state logic extracted to the testable `flags/metricLens.js` (`computeLensView`) so the page stays thin glue.
3. **~~Tiers + superlative presets~~ → Population tier pills, reused from Make-a-puzzle** *(done — feature/de-metric-tier-pills).* **Reframed** from the original plan. The written phase 3 (set-relative High/Mid/Low tertile tiers + explore-only Top 10 / Lowest 10 / Top 5-in-Europe presets) was **dropped** — the tertile tiers were the design's own weakest capability (line above: "fuzzy, bad for puzzles"), and the superlative presets became redundant once Feature DG shipped the superlative mechanic as real daily gameplay. Instead, flagsdata reuses the **exact threshold tier pills from findFlag's "Make a puzzle" chooser** (`>=100M` / `<=1M` / …). These are *absolute per-flag predicates* (not set-relative), so they ride the shared `matchesFilters` path flagsdata already runs — crisp where tertiles were fuzzy, and already built. **Net win: the next metric (area / GDP) inherits tier pills on both surfaces for one line** (see the metric-tier registry in the Feature DD onboarding map). Feature DE closes.

**What shipped (phase 3).** New pure `flags/metricTiers.js` — a `METRIC_TIER_REGISTRY` (`metricKey → { breaks, factory }`; population fills it today) + `buildMetricTierItems(metricKey, countries)` that counts each breakpoint via the metric's canonical predicate and drops 0-count tiers. findFlag's inlined tier build (`page.js`) rewired to call it (behaviour-neutral). flagsdata gained a single-select **Population** filter group (`buildPopulationGroup`) rendered in its own filter-bar chrome, labelled via the shared `pillLabel('population', …)`, wired into Clear / the filter-count badge / the soft-language-switch re-translate. `attachPopulations` denormalises population onto the loaded countries so the filter predicate resolves (the lens reads the values map directly; the filter reads the field). No new i18n keys (reuses `findFlag.sections.population` + `population.atLeast/atMost`). `flags/metricTiers.test.js` pins the builder. Verified in-browser: 6 tiers render, `>=100M` → 16 flags, `<=1M` → 85, single-select replace + toggle-off, badge count, and full en↔pl re-translation.

**Standing artifact:** `flags/metricTiers.js` — the shared threshold-tier builder + registry. Any future threshold metric that exposes a `<KEY>_BREAKS_FOR_RANDOM` list + `<key>()` factory adds one registry line and lights up tier pills in **both** the findFlag chooser and the flagsdata filter bar.

---

### Feature DG: Superlative daily puzzles — "the N most/least X by a metric" — *shipped 2026-07-10 (#780–#783, content on blob, +#785)*

**Goal.** A new daily-puzzle mechanic: *the top-N countries by a world metric, in a scope, optionally intersected with a flag filter.* First examples (population): "the 10 most populous countries", "the 5-7 most populous in each continent", "the 5 most populous European flags with white". Second *play* consumer of the metric namespace (Feature DD) after the TTT population categories (Feature DF).

**Why a new entry kind, not a filter token.** A superlative is **set-relative** — the answer depends on ranking the whole scope — while the daily filter DSL is a **per-flag predicate** (`matchesFilters(country, ...)`). You cannot express "top 10" as one more token; the same architectural split the metric-lens design (Feature DE) already called out. So the mechanic is: *reuse the flag DSL to narrow the pool, then rank the survivors by the metric and take N.* A superlative entry is `{ kind: "superlative", metric, scope, direction, topN, filter? }` alongside the frozen `answers` / `title` / `description`.

**Key decision — frozen answers, like manual entries.** The catalog does **not** live-recompute a superlative's answers against the metric. `population.json` refreshes yearly and released daily puzzles are immutable (rule 1), so a live recompute would permanently break a past puzzle after a refresh with no legal fix. Instead `resolveSuperlative` is an **authoring** tool: the generator computes the roster, and an audit recomputes *future-dated* (still-editable) drafts to warn on drift before release. Net: a superlative is "a manual entry whose roster the machine computes + validates for you," plus auto-title and generatable ideas. The daily rules that already iterate all entries (rule 3 sovereign codes, rule 9 size 4-30, rule 7 en/pl description, rule 5 primary-clean on the flag-filter part, rule 15 ambiguity) apply unchanged.

**Content notes (computed 2026-07-10, sovereign-only):**
- World top-10 and the per-continent top-5/7 rosters are all famous countries → score easy, good for onboarding.
- **Oceania (decided 2026-07-10, Jan):** include it, as **top-5 most populous in Oceania** *and* **top-5 smallest in Oceania** (a `direction: 'least'` puzzle). The "smallest" set is deliberately obscure-leaning (Tuvalu / Nauru / Palau…), so it's a late-N curiosity; slot both later in the schedule.
- Heavy overlap between "world top-10" and "Asia/Africa top-N" (the giants recur) — space them apart in the schedule and watch the rule-11 country-reuse cap.

**Phasing** (one branch each — don't auto-merge):

1. **Compute core + schema + resolution** *(this PR).* `flags/superlative.js` (`resolveSuperlative` + `isValidScope` / `SUPERLATIVE_SCOPES`); `superlative` kind wired into `flags/daily.js` (`resolvePuzzleEntry` treats it like manual — frozen answers, `filter: null`; `superlativeToCategory` label helper with a Phase-1 English fallback); unit tests (`flags/superlative.test.js`) + daily-resolution/label tests. No rendering, no i18n, no content yet.
2. **Rendering + difficulty** *(done).* Superlative renders like a manual entry — a **hand-written en/pl `title`**, not an auto-generated pill chain (auto-gen was dropped: rule 7 already establishes that PL grammar needs a human, and hand-writing ~15 titles is trivial). Wired the title path through `daily/page.js`, `daily/backlog/play.js`, and `daily/squares.js` (the `isTitleEntry` = manual|superlative helper), and taught `daily/difficulty.js` to score a superlative off its answers (no token friction; worldwide bump keyed on `scope`, not a continent token). No new i18n keys needed (titles are per-entry data). The Phase-1 `superlativeToCategory` English fallback stays as defence-in-depth.
3. **Catalog validation + audit** *(done).* `flags/dailyValidate.js` gained a `superlative` branch — `checkSuperlativeShape` (metric/scope/direction/topN/title, `topN === answers.length`) validates shape but deliberately does NOT re-derive the roster (frozen; skipped in `checkDriftFree`). `authoring/audit-superlative.mjs` recomputes future-dated drafts against the live metric and exits 1 on drift (author-time correctness net). `flags/dailyValidate.test.js` pins every branch. `daily-puzzle-author` SKILL.md documents the new kind + authoring recipe. (The `generate-candidates.mjs` templates were dropped — for a ~15-puzzle family, computing rosters directly with `resolveSuperlative` at authoring time is simpler than a generator, and superlatives don't fit the filter-shaped `ideas.json` pipeline anyway.)

4. **Suite kind-awareness + ideas superlative support** *(done).* The `daily.test.js` filter-shape rules (drift, redundant-token, no-subset/refinement, primary-clean, single-use, ambiguity, shape) now skip or handle the superlative kind via an `isFilterEntry` helper, and `validateCatalog` runs inside `npm test` (superlative shape coverage in the suite). `/daily/ideas/` (grid `page.js` + `play.js`) and `reviewState.js` (`ideaKey`) handle superlative ideas so compound concepts can be previewed/played locally. This is the prerequisite for putting superlative entries in either catalog file without breaking the suite or the author tooling.

5. **Content** *(done — blob, 2026-07-10).* Shipped **14 population superlative puzzles** to `puzzles.json`: world most/least-10 and per-continent most/least-5 (Europe/Asia/Africa/N.America/S.America + Oceania). Rather than appending a wall and generating filler regulars, they were **spliced** into the existing future schedule (from #47 / 2026-07-22, spaced ~3 apart, ending 2026-09-12) — existing regulars only shift `n`/`date`, verified content-identical. `world-most` and its subset `Asia-most` land 48 days apart. Each carries **per-flag population captions** via `entry.notes` (e.g. "Population: 1.44 billion", EN+PL), rendered in the zoom on the result grid. `ideas.json` gained **14 compound superlatives** (Europe-red/blue/white, Africa-green/star, cross, coat-of-arms, colorCount:3, …) computed clean under `primaryColors`, plus 3 fresh generator regulars — a months-long reservoir (99 ideas total). One test fix rode along (PR #785): the ideas size check sizes superlative ideas by `topN` since they carry no frozen `answers`. Near-miss rank feedback ("you guessed #12, just outside the top 10") was scoped but deferred as its own feature — it needs rank data threaded into the shared `playFlow.js`.

---

### Feature DF: Population thresholds as a tic-tac-toe category — *shipped 2026-07-10 (#779)*

**Goal.** The first *play* consumer of a world metric (Feature DD): population becomes a TTT category family, like `colorCount`. Six breakpoints — populous `>=10M / >=50M / >=100M` and small `<=20M / <=5M / <=1M` — surfacing in the 3×3 and 9×9 random pools. Difficulty falls out of the threshold: `>=10M` / `<=20M` cover ~half the world (easy), `>=100M` (~16 countries) / `<=1M` are tight (hard).

**Design decisions:**

- **Predicate reads a denormalized field, not a metric map.** TTT categories rehydrate from an id string alone (across the PartyKit wire and storage, via `categoryFromId`), so a predicate must read a plain `Country` field. `attachPopulations(countries, values)` (in `group.js`) copies `population.json`'s value onto each Country at load; the metric file stays the single source. `population:>=10000000` then reconstructs to `c => c.population >= 1e7` with no data threading — identical to every other predicate. **The metric file is *not* baked into `countries.json`** (that would erode Feature DD's sparse-metric separation).
- **Attach at every generate/validate site:** both party servers (static JSON import, safe on Cloudflare) and both offline pages (browser `fetch`, per the never-import-JSON-in-browser rule). Online clients are server-authoritative and skip it (they only rehydrate categories for labels).
- **One `exclusiveGroup: 'population'`** across all six, so no puzzle carries population on both axes — rules out the impossible band (`>=100M × <=1M`, always empty) and the redundant one (`>=10M × <=20M`).
- **9×9 keeps exactly one breakpoint (`>=10M`).** The extreme tiers can't back 9-distinct-per-cell against a continent, so five of six carry `ultimateEligible: false` and `buildUltimateCategoryPool()` drops them — same mechanism as `stripesOnly`.

**What shipped.** `population(op, n)` factory + `POPULATION_BREAKS_FOR_RANDOM` + `categoryFromId` / `translateCategoryLabel` branches in `flags/engine.js`; `attachPopulations` in `flags/group.js` (+ `population?` on the `Country` typedef); wiring in `party/server.js`, `party/ultimateServer.js`, `ticTacToe/offline/page.js`, `ticTacToe/9x9/offline/page.js`; `population.*` i18n block (en + pl). Tests: factory/predicate/rehydration/translate + `attachPopulations` units, and real-data seed pins that population surfaces in 3×3 and only `>=10M` reaches 9×9. Skill `.claude/skills/ttt-puzzle-generator/SKILL.md` updated. 2250 tests + typecheck green.

**Standing artifact:** the pattern for *any* future metric-as-category (area, GDP, …) — one factory + breakpoint list + `attach<Metric>` at the TTT load sites, predicate reads the denormalized field.

---

### Feature DD: World metrics — population first, as a self-describing metric namespace — *shipped 2026-07-10 (#763)*

**Goal.** A general home for **continuous world metrics** (population today; area, GDP, coffee production, ships-per-capita, … later) so new metrics unlock new game modes without running out of ideas. Population + pure helper + tests, no game consumer (consumers are their own later features — Feature DE is the first).

**Why a metric namespace, not flat fields on `countries.json`:**

- **Different species of data.** `countries.json` holds *flag-identity* data — hand-curated, stable, coupled to the SVG. World metrics are *external facts* — sourced, refreshed on their own cadence, each with its **own source and year**. A flat `coffeeProduction: 123` field has nowhere to record "FAO 2022"; parallel `…Year` fields are the tell the shape is wrong.
- **Sparsity.** A metric lists **only** the countries it applies to (`values` map) — no `null` splatter. Contract: "every metric key is a real country," not "every country has a value."
- **Game-mode multiplier.** Each metric is self-describing (`label`, `unit`, `format`, `source`, `year`, `values`), so one generic helper gives every metric top-N / rank / tiers / compare for free.

**Storage decisions:** raw number, never rank (rank is scope-dependent and derived — one sort at load); scope = all real places (`category !== 'other'`); uninhabited/transient places (Antarctica, Bouvet, Heard & McDonald, Clipperton, South Georgia, French Southern Territories, US Minor Outlying, British Indian Ocean Territory) **omitted** rather than stored as `0`, so "least populated" stays meaningful (Vatican ~800 is the floor).

**What shipped.** 254 countries in `flags/metrics/population.json` (World Bank WDI `SP.POP.TOTL` 2023 for 216; 38 dependencies / sub-national regions from national-statistics / UN estimates, rounded, in `build-population.mjs`'s `FILLS`; 8 omitted). Pure `flags/metrics.js` `createMetric(metric, countries)` → `valueOf` / `has` / `ranked` / `topN` / `bottomN` / `rankOf` / `tierOf` / `compare` + `label` / `unit` / `format`, scoped `world` / `un_member` / continent. `flags/metrics/index.js` explicit registry. `authoring/build-population.mjs` (yearly refresh = one command). `flags/metrics.test.js` fixture logic + real-data schema gate.

**Verified 2026-07-12:** the ~40 hand-filled populations + a join-sanity pass on the World Bank leaders were cross-checked by the same 4-agent sweep used for GDP (see Feature DJ). Clean, zero corrections; every figure within ~15% of national-statistics / UN estimates.

**Standing artifacts:** `flags/metrics/` namespace + `createMetric` helper — every future metric (area, GDP, coffee) drops in as one self-describing file and inherits all mechanics. The `format` hint was added in Feature DE phase 1.

**Onboarding a NEW metric (area / GDP / …).** The full end-to-end recipe now lives in the **`add-world-metric`** skill (`.claude/skills/add-world-metric/SKILL.md`): the six surfaces a metric can reach, which are free vs which need code, the cross-surface data contract ("every real place has a value; no-data means only non-places"), the sparse-metric absence policy, and a paste-able checklist to track done/deferred per metric. Population is the worked example (Features DD, DE, DF, DG here, plus the TTT no-data guard and the uninhabited-fill follow-up). When you start a metric, open a Feature entry under `## Now` and paste that checklist to track it.

---

### Feature DB: Stripes-only orientation tag — *shipped 2026-06-18*

**Goal.** New field `stripesOnly: 'horizontal' | 'vertical' | null` on each country. Enables clean puzzles like "European vertical-stripe flags" (France, Italy, Belgium, Ireland, Romania) or "European horizontal-stripe flags" (Germany, Russia, Bulgaria, Netherlands, Hungary, Estonia, Lithuania, Luxembourg). Surfaces in flagsdata filters, findFlag "make a puzzle" chooser, TTT random pool, and daily-puzzle authoring.

**Design decisions (settled 2026-06-16):**

- **Embedded purity ("Design X").** `stripesOnly` is set only for pure tricolours — flags whose visual is *just* equal stripes, no overlaid emblem/charge/canton. Mexico, Spain, Andorra, Egypt, US, UK all get `null` even though they have stripes. This conflates "orientation" and "purity" into one field deliberately: the player experience for "European horizontal stripes" wants Spain (COA) *out*, and the embedded shape gives that automatically.
- **Sharp definition of "pure":** equal-width N-band (N≥2), no overlaid emblem, no canton, no charge, no cross/saltire overlay. Includes Indonesia/Poland (2 stripes pure). Excludes US (canton), UK (cross), Greece (canton-equivalent), Mexico/Spain/Egypt/Iran/Libya (charge).
- **Token name `stripesOnly:horizontal` / `stripesOnly:vertical`.** Field name matches. The "only" in the token carries the purity constraint into the filter DSL so authors reading a backlog filter string aren't surprised that Egypt is excluded.
- **Single-stripe flags** (Japan, Bangladesh, Palau, Vietnam) → `null`. "Orientation" doesn't mean anything at n=1.
- **TTT integration via two complementary mechanisms:**
  - *Structural disjointness* — per-category `incompatibleWith: string[]` annotation declares pairs that produce empty cells by construction. `hasStripesOnly` factory lists every charge motif (`hasMotif:cross`, `coat-of-arms`, `animal`, `bird`, `weapon`, `star-or-moon`). One small extension to `axesConflict` picks the field up. Pattern is co-located with the factory it describes; auditable via a test that "every incompatibleWith entry produces 0 matches in current data."
  - *Size tightness for 9×9* — `ultimateEligible: false` annotation on stripesOnly factories. `generateUltimateRandomPuzzle` filters the pool to ultimate-eligible cats. Reason: Europe has 8 pure-horizontals (< 9) and 5 pure-verticals (< 9); other continents tighter. Pure stripes can't reliably back a 9×9 cell.
- **TTT random pool** (3×3 only) gets the two stripesOnly cats; daily-puzzle generator (`authoring/generate-candidates.mjs`) respects them too.

**Phasing.** Each phase = one branch off `main` + one PR. Don't auto-merge.

1. **Seed data + audit script + schema test.** Add `stripesOnly` to every country in `countries.json`. Build `authoring/audit-stripe-orientation.mjs` (mirrors `audit-ambiguity.mjs`) — prints classification per continent for human review. Schema test in `flags/countries.test.js` enforces the field exists with valid values everywhere.
2. **Engine + filter wiring + tests.** `hasStripesOnly(orientation)` factory in `flags/engine.js` (with `exclusiveGroup: 'stripesOnly'`, `incompatibleWith`, `ultimateEligible: false`). Add `stripesOnly` to the `Filters` typedef in `flags/flagsFilter.js`, `emptyFilters()`, `matchesFilters()`. Parse/serialize `stripesOnly:horizontal` in `flags/findFlag.js` (`GROUP_ORDER`, `parseFilterString`, `serializeFilter`, legacy `?cat=`, `pillLabel`, `translateCategoryLabel`). Extend `axesConflict` for `incompatibleWith`. Split `buildRandomCategoryPool()` so `generateUltimateRandomPuzzle` skips non-ultimate-eligible cats. Tests for everything.
3. **flagsdata surface.** New "Stripes" pill group in `flagsdata/page.js`, added to the include/exclude bookkeeping arrays + Clear, language switch re-translates labels.
4. **findFlag chooser surface + random pool.** New section in `findFlag/page.js` with two pills. Include in chooser's Random pool. Update `findflag-random-coverage` skill note.
5. **TTT random pool.** Wire `hasStripesOnly` into `buildRandomCategoryPool()` (already done in Phase 2 effectively — confirm + add an integration test that 3×3 generation stays inside the retry budget with the new cats).
6. **First puzzle ideas.** Draft 3–4 backlog daily-puzzle ideas using the new dimension via `daily-puzzle-author` skill (`continent:Europe,stripesOnly:horizontal`, etc.).

**What shipped.** All six phases. PRs #473, #474, #475, #476, #477 (Phases 1-5) + the non-sovereign follow-on `feature/db-stripes-only-non-sovereign` (Catalonia → horizontal, Canary Islands → horizontal). Phase 6 closed 2026-06-18 by extending `authoring/generate-candidates.mjs` with two stripes-aware templates (T28 continent + stripesOnly, T29 stripesOnly + colour). The generator emitted 15 stripes candidates into the new backlog; the two flagship Europe entries (`continent:Europe,stripesOnly:vertical` = 5 famous flags / difficulty 1.0; `continent:Europe,stripesOnly:horizontal` = 13 flags / difficulty 1.5) are the easiest puzzles in the whole batch.

**Phase 6 framing decision.** Solo worldwide `stripesOnly:X` was *not* added as a template — under rule 6 the regional and solo framings can't coexist (regional is a strict subset + literal token-refinement of solo). Regional wins because the named country sets are more concrete and the difficulty stays tighter. Solo worldwide is available for past-#100 (park manually if Jan wants the "exhausted set" finale puzzle).

**Standing artifacts:**

- `flags/countries.json` `stripesOnly` field on every country (sovereign + non-sovereign).
- `flags/engine.js` `hasStripesOnly(orientation)` factory with `incompatibleWith` + `ultimateEligible: false` (3×3 only).
- `flags/flagsFilter.js` + `flags/findFlag.js` parse/serialise `stripesOnly:horizontal` / `stripesOnly:vertical` end-to-end.
- `flagsdata/page.js` "Stripes" pill group; `findFlag/page.js` chooser section + random pool.
- `authoring/audit-stripe-orientation.mjs` per-continent classification report.
- `authoring/generate-candidates.mjs` T28 + T29 stripes templates (shipped Phase 6).
- TTT 3×3 random pool includes the two stripesOnly cats; 9×9 deliberately skips them.

---

## Backlog

---

## Done

### Feature DA: Ambiguity column for colour count and membership — *shipped 2026-06-13*

**Goal.** The puzzle generator never builds a combination where a flag in the answer-set scope is ambiguous on the dimension the puzzle keys on. The flag stays fully usable everywhere else (regional puzzles, motif puzzles, single-colour puzzles where the colour isn't its contested one); it's only excluded from the slice that would put a player in the disagreement zone. Two flavours of ambiguity covered with the same veto mechanism: **count** (Bhutan: 3 or 4 colours depending on whether the dragon outline counts) and **membership** (Bhutan: does it "have white"? — the only white is the dragon outline).

**What shipped (six phases collapsed into a one-day sprint, 2026-06-13):**

1. **Seed data.** `flags/countries.json` gained `ambiguousColorCount` and `ambiguousColors` fields on Bhutan and American Samoa. Conservative tag list — other candidates (Vatican, Sri Lanka, Mexico, Guatemala, Ecuador) deferred pending audit-driven evidence rather than over-tagging upfront.
2. **Audit module + CLI.** Pure module `flags/ambiguityAudit.js` (unit-tested) plus `authoring/audit-ambiguity.mjs` CLI wrapper. Same module powers both the human-friendly ad-hoc report and the hard test gate.
3. **Hard rule + offender fixes.** New test in `flags/daily.test.js` fires on live + backlog + ideas, ensuring no authored puzzle slips past `npm test`. Backlog #53 (`continent:Asia,color:yellow,colorCount:3`) reworked to `continent:Asia,color:yellow,color:black`; #79 reworked from worldwide `colorCount:5` to `continent:!Oceania,colorCount:5`.
4. **Generator wiring.** `authoring/generate-candidates.mjs` applies the audit during batch candidate generation — vetoed combinations are silently skipped, no "rescue by adding filters" (compounding to escape an ambiguity ban is exactly the contrived-set behaviour rule 10 prevents).
5. **Skill docs.** Daily-puzzle-author skill `SKILL.md` gained **rule 15** for flag-data ambiguity, with the authoring cue ("before authoring, run `node authoring/audit-ambiguity.mjs`") and a field-shape note.
6. **Bhutan pin correction.** Mid-flight find: the original tag had `ambiguousColors: ["white"]`, but the actually-contested colour is the dragon outline (black) — the dragon body is unambiguously white. Re-pinned; backlog #37 and #53 reworked accordingly. The "Bhutan ambiguousColors is black not white" memory was added during this fix.

**Mid-flight sweep:** the audit, once turned on, surfaced more violators than the original two — Africa/Asia/Europe sweep dropped 8 broken puzzles (#407), Americas sweep dropped #52 and #57 (#408), SA + Oceania sweep dropped #54 (#409). All caught before they could ship.

**Standing artifacts** (load-bearing outputs future data work inherits):

- `flags/ambiguityAudit.js` + tests — the pure veto logic. Any future ambiguity dimension (motifs, statehood?) composes the same module.
- `authoring/audit-ambiguity.mjs` — the author-side CLI; cited in skill rule 15.
- `flags/daily.test.js` ambiguity gate — locks the rule against silent regression in live + backlog + ideas.
- `authoring/generate-candidates.mjs` integration — every batch run respects the new constraint without remembering to.
- Memory pin "Bhutan ambiguousColors is black not white" — protects the contested-colour identity against re-derivation.

**Key PRs.** #381 (DATA_FEATURE.md proposal), #400 (seed data), #401 (audit module + CLI), #402 (offender rework + hard rule), #403 (generator wiring), #404 (rule 15 in skill), #406 (Bhutan pin correction), #407–#409 (sweeps).

**Out of scope, intentionally deferred:** **motif ambiguity** (would tag e.g. Albania's eagle as "coat-of-arms or just an animal" or Mexico's emblem similarly). Same `ambiguousMotifs` veto mechanism would slot in cleanly, but the player-disagreement frequency for motifs feels lower than for colours, and motif data is already a defensible classification in `countries.json`. Re-open if empirical evidence post-colour-ship shows otherwise.
