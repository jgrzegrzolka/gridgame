# Metric daily puzzles: deferred authoring backlog

The **daily-puzzle** surface (surface 6 in the `add-world-metric` skill) lives here, split out of `DATA_FEATURE.md` on purpose.

Surfaces 1-5 of a world metric are bounded engineering: once they land, the metric is **done** and its `DATA_FEATURE.md` Feature closes. Surface 6 is open-ended **authoring** that Jan does on his own cadence and under his supervision, because released daily puzzles are immutable (daily rule 1), so they can't safely ride along with a code PR. Tracking it here keeps metric Features from sitting "in progress" forever just because their daily puzzles aren't written yet.

**Deferred 2026-07-11 at Jan's request.** Agents: do **not** author these unprompted, wait for Jan. See memory `project_metric_daily_puzzles_deferred`.

## How to pick this up (per metric, when Jan says he's ready)

For a metric whose code surfaces (1-5) already shipped:

1. **Superlative puzzles (authoring, zero new code).** `resolveSuperlative` (`flags/superlative.js`) is metric-agnostic. Author `{ kind: "superlative", metric: "<key>", scope, direction, topN, filter? }` entries via the **daily-puzzle-author** skill, the way population shipped in Feature DG ("the 10 largest by area", per-continent largest/smallest, ...). Rendering, difficulty, `checkSuperlativeShape`, and `audit-superlative.mjs` already handle any metric key. Compute rosters, show Jan the diff, then push to blob. Add a reservoir of ideas over time.
2. **Result-screen rank captions (small code).** The population captions (`flags/populationRank.js` + the `metric === 'population'` branch in `daily/page.js`) are metric-specific. Add a `build<Key>RankNotes` + a branch, or generalize `populationRank.js` to take a metric key + label/unit + en/pl caption strings. Without it, that metric's superlatives show the plain flag name on zoom (harmless, just plainer). Do this alongside a metric's first daily puzzles.

## Pending, per metric

Population is the shipped precedent (Feature DG: 14 superlative puzzles + per-flag captions). The rest have all code surfaces done, daily deferred:

- [ ] **Area** (Feature DH): superlative puzzles + rank captions
- [ ] **Population density** (Feature DI): superlative puzzles + rank captions
- [ ] **GDP** (Feature DJ): superlative puzzles + rank captions
- [ ] **GDP per capita** (Feature DJ): superlative puzzles + rank captions. **Watch:** "largest per capita" surfaces Vatican #1 ($375K estimate artifact), then Monaco / Liechtenstein: accurate to the data, but worth a human eye when picking answer sets.
- [ ] **Coffee production** (Feature DK): superlative puzzles + rank captions. **Sparse + one-directional:** author **"most" only** ("the 10 biggest coffee producers", per-continent biggest), never "least" — coffee is a sparse metric, so `resolveSuperlative` ranks the ~78 growers, and "smallest grower" is an obscure question (this matches the code surfaces: atLeast-only filters, biggest-only party round). Both overrides matter when picking answer sets: CAR (2.8K t) and Guinea (10K t) are deliberately low, not top-10.
- [ ] **Highest elevation** (Feature DL): superlative puzzles + rank captions. **Dense + two-directional:** author BOTH directions, unlike coffee, "the 10 highest peaks" (Everest / K2 / Kangchenjunga …) and the fun "lowest highpoint" (Maldives 2 m, Tuvalu / Tokelau 5 m, the low coral atolls), plus per-continent highest / lowest. Values are exact metres (`plain` format). Rank captions want the peak name too (the build script names each in a comment), a nice-to-have beyond the plain "8,849 m".
- [ ] **Wine production** (Feature DM): superlative puzzles + rank captions. **Sparse + one-directional**, exactly like coffee: author **"most" only** ("the 10 biggest wine producers" = France / Italy / Spain / USA / China …, per-continent biggest), never "least" (`resolveSuperlative` ranks the ~78 makers and "smallest maker" is obscure). A fun "old-world vs new-world" angle for answer sets. Four minor makers carry a pre-2023 figure (Malta, Réunion, Syria, Zimbabwe), all tiny, safe to ignore when picking top-N sets.
- [ ] **Cocoa production** (Feature DN): superlative puzzles + rank captions. **Sparse + one-directional**, like coffee / wine: author **"most" only** ("the 10 biggest cocoa producers"), never "least" (`resolveSuperlative` ranks the ~59 growers). Great "did you know" answer set: Côte d'Ivoire is the runaway #1 (1.9M t, roughly triple #2 Indonesia), and West Africa (Côte d'Ivoire / Ghana / Nigeria / Cameroon) dominates, a per-continent-Africa puzzle is especially clean.
- [ ] **Banana production** (Feature DO): superlative puzzles + rank captions. **Sparse + one-directional**, like the other crops: author **"most" only** ("the 10 biggest banana producers"), never "least" (`resolveSuperlative` ranks the ~127 producers). India is the runaway #1 (37.6M t, ~3× #2 China); a surprising answer set since bananas read as a Latin-American export but the biggest *producers* are Asian (India / China / Indonesia / Philippines) growing mostly for domestic use.

Every future metric adds a row here when its code surfaces (1-5) land, and its Feature closes in `DATA_FEATURE.md` without waiting on this list.
