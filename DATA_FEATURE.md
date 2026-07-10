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

### Feature DE: Metric lens in flagsdata

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

1. **Data + spec** (this PR). `format` hint on `population.json` + `build-population.mjs`; `createMetric` passthrough (defaults to `'compact'`); schema test; this spec; move Feature DD to Done.
2. **Lens UI in flagsdata.** Metric selector (None default) built from the `flags/metrics/` registry; tiles show value + rank for the active metric; sort (A–Z / Highest / Lowest); sparse dimming. i18n labels in `en.json` / `pl.json`. Extract the lens-state logic to a testable sibling module (`flagsdata/metricLens.js` or `flags/metricLens.js`) so the page stays thin glue and the reducer gets unit tests.
3. **Tiers + superlative presets.** High/Mid/Low tier pills + Top 10 / Lowest 10 / Top 5 in Europe presets, all driven by the active metric via `createMetric`.

---

## Backlog

---

## Done

### Feature DD: World metrics — population first, as a self-describing metric namespace — *shipped 2026-07-10 (#763)*

**Goal.** A general home for **continuous world metrics** (population today; area, GDP, coffee production, ships-per-capita, … later) so new metrics unlock new game modes without running out of ideas. Population + pure helper + tests, no game consumer (consumers are their own later features — Feature DE is the first).

**Why a metric namespace, not flat fields on `countries.json`:**

- **Different species of data.** `countries.json` holds *flag-identity* data — hand-curated, stable, coupled to the SVG. World metrics are *external facts* — sourced, refreshed on their own cadence, each with its **own source and year**. A flat `coffeeProduction: 123` field has nowhere to record "FAO 2022"; parallel `…Year` fields are the tell the shape is wrong.
- **Sparsity.** A metric lists **only** the countries it applies to (`values` map) — no `null` splatter. Contract: "every metric key is a real country," not "every country has a value."
- **Game-mode multiplier.** Each metric is self-describing (`label`, `unit`, `format`, `source`, `year`, `values`), so one generic helper gives every metric top-N / rank / tiers / compare for free.

**Storage decisions:** raw number, never rank (rank is scope-dependent and derived — one sort at load); scope = all real places (`category !== 'other'`); uninhabited/transient places (Antarctica, Bouvet, Heard & McDonald, Clipperton, South Georgia, French Southern Territories, US Minor Outlying, British Indian Ocean Territory) **omitted** rather than stored as `0`, so "least populated" stays meaningful (Vatican ~800 is the floor).

**What shipped.** 254 countries in `flags/metrics/population.json` (World Bank WDI `SP.POP.TOTL` 2023 for 216; 38 dependencies / sub-national regions from national-statistics / UN estimates, rounded, in `build-population.mjs`'s `FILLS`; 8 omitted). Pure `flags/metrics.js` `createMetric(metric, countries)` → `valueOf` / `has` / `ranked` / `topN` / `bottomN` / `rankOf` / `tierOf` / `compare` + `label` / `unit` / `format`, scoped `world` / `un_member` / continent. `flags/metrics/index.js` explicit registry. `authoring/build-population.mjs` (yearly refresh = one command). `flags/metrics.test.js` fixture logic + real-data schema gate.

**Standing artifacts:** `flags/metrics/` namespace + `createMetric` helper — every future metric (area, GDP, coffee) drops in as one self-describing file and inherits all mechanics. The `format` hint was added in Feature DE phase 1.

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
