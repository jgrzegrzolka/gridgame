---
name: add-world-metric
description: End-to-end recipe for adding a new world metric (area, GDP, coffee production, ...) to gridgame, or wiring an existing metric into one more surface. Covers all six surfaces a metric can reach (the data file, the flagsdata lens, the flagsdata + findFlag "Make a puzzle" filters, the TTT threshold mode with no-data handling, the Flag Party round, and daily superlative puzzles), which are free vs which need code, the cross-surface data contract (every real place has a value; "no data" means only non-places), how to pair a metric that is an existing one normalised (per capita, per km²) so it shows as a cut rather than a second chip or a second draft card, and a paste-able checklist to track done/deferred per metric. Use when Jan asks to add a metric, extend one to another surface, or plan/track that work. Per-metric progress lives in a DATA_FEATURE.md Feature entry, not here; this is the reusable recipe.
---

# Adding a world metric

A "metric" is a continuous world fact keyed per country (population, area, GDP, coffee production, ...). It lives in `flags/metrics/<key>.json` and, once added, can surface on up to six places. **Only the data file is mandatory** in the sense that each surface is technically independent, but the **default scope of "add a metric" is surfaces 1-5, one metric fully before starting the next.** Do not stop at the free lens (1-2) unless Jan explicitly scopes it down: a metric that ships lens-only reads as unfinished and leaves the trail half-built (the corruption / temperature / happiness batch of 2026-07-15 did exactly this, and the missing Feature entries below made the partial state invisible). If Jan does scope it down, say so in the Feature entry so the remaining surfaces are visibly to-do.

**Two artifacts, two jobs.** This skill is the *recipe* (how each surface is wired, identical for every metric). The *tracking* of which surfaces are done, in flight, or deferred for a specific metric belongs in a **DATA_FEATURE.md Feature entry** with a phase checklist, exactly like Features DD/DE/DF/DG. Don't record per-metric state here; paste the checklist at the bottom into a new Feature entry and tick it there.

## Writing style: never the em dash

Jan bans the long em dash (`—`) everywhere: i18n copy, code comments, this skill, commit messages, chat. It reads as AI-generated. Use a comma, a full stop, a colon before a list, or parentheses. The en dash `–` for numeric ranges (`1946–1992`) is a different character and is fine. Grep new content for `—` before finishing. See memory `feedback_no_em_dash`.

## The data contract (read this before anything else)

Two rules that every surface leans on. Settle them at data time; getting them wrong makes the TTT "no data" guard misbehave.

1. **Every real place gets a value; only non-places have none.** A "real place" is `category !== 'other'` (sovereign states, territories, sub-national regions). A "non-place" is `category === 'other'` (the org flags: EU, UN, ASEAN, and any future fictional flag like a Jolly Roger). The TTT picker's `metricDataGap` guard (`flags/metricTiers.js`) shows a suggestion disabled with a "no data" tag exactly when a metric axis has no value for it, so **"no data" must mean "not a rankable place," nothing else.** A real place with a missing value would be wrongly blocked (this is the Antarctica bug we fixed: it was omitted, so it read "no data" on a "population under 1M" cell even though it obviously qualifies). Fill every real place. Uninhabited or zero-quantity places carry `0`, not omission. The test `flags/metrics.test.js` pins this invariant per metric.

2. **Absence policy for sparse metrics.** Population and area are *dense*: every real place has a real value, so you fill them all (population fills the ~8 uninhabited territories with 0 or transient counts in `build-population.mjs`). Production metrics (coffee, apples, medals) are *sparse*: the source table only lists producers. For those, "absent from the source" safely means `0` for a real place (a country not in the coffee table grows no coffee). Two ways to honor rule 1 for a sparse metric:
   - Simplest: fill `0` for every real place missing from the source (explicit, larger data file).
   - Cleaner (not built yet): give the metric file an `absence: 'zero'` hint and have the `attach<Key>s` loader default missing real places to `0`. Build this the first time a sparse metric lands; population/area don't need it. **Never infer `0` for a metric where absence means "unknown, not zero"** (GDP: every country has substantial GDP; a missing value is unsourced, not zero). For an `absence: 'unknown'` metric, a missing real place stays truly "no data" and the guard correctly blocks it until you source it. So: source it.

3. **Physical-fact metrics MUST be dense, regardless of the source table's coverage.** Classify by the *nature of the quantity*, not by how many rows the source happens to list. If every real place inherently HAS a value (temperature, elevation, coastline, latitude, land area: a physical or geographic fact), the metric is dense: fill every real place, hand-filling the ones the source omits (temperature's ~28 sub-national parts / territories / polar islands are hand-filled in `build-temperature.mjs`). `absence: 'unknown'` is ONLY for genuine survey / measurement metrics where a missing place is truly unmeasured (a WHO consumption survey, a happiness poll, a corruption index). The trap: temperature was first shipped `absence: 'unknown'` because its source table had ~234 rows, exactly like beer, so 28 real places read "no data" on a temperature TTT cell, the Antarctica bug class. "The source table doesn't list Wales" is not the same as "Wales has no temperature." When in doubt, ask: could this value in principle exist for every real place? If yes, it's dense, source it.

## Pairs: when the new metric is another metric divided

Settle this **before** wiring surfaces 2-5, because two of them change. If the
metric you are adding is an existing metric normalised (GDP per capita against
GDP, Nobel per million against Nobel, medals per person against medals), it is
not a new subject. It is a second view of one already in the catalog, and both
surfaces that offer a *choice* between metrics group them so the reader picks a
subject, not a formula.

**The bar is "the same quantity divided by something", never "related subjects".**
Sheep per person and cattle per person share a barn, not a question, and stay
apart. A metric that only ever exists normalised (beer, meat, tourism,
electricity, McDonald's) is not a pair either: there is no second view to switch
to, so it is an ordinary single-key metric and the controls below must not
appear for it.

Two registrations, and they are deliberately not the same shape:

- **flagsdata** (`flags/metricCuts.js`, `METRIC_CUT_GROUPS`): one chip per
  subject, with a Total / Per person segmented control in the panel. Add a
  group whose `subjectKey` **is the total metric's key** (that identity is what
  lets the chip keep the icon, hue, i18n and tier breakpoints it already has;
  no synthetic ids). The normalised half then has no chip of its own: it is
  reached through the cut control. `metricCuts.test.js` fails if any metric
  becomes unreachable, so a half-done pairing cannot ship.
- **Flag Party** (`flags/partyDraft.js`, `GROUPED_FAMILIES`): one draft card per
  subject. A family id is a card no mode id matches, and the members still deal
  as separate rounds. Give the family a `sub` disclosure line in
  `flagParty/page.js` (the honesty line stating the range the card can resolve
  to) and its `party.mode.*` / `party.modeSub.*` i18n in en + pl.

The two surfaces group to different depths **on purpose**: a ten-card party hand
is scarce in a way a browse row is not, which is why all four Olympic metrics
share one party card but flagsdata keeps Summer and Winter as separate chips
(one icon and one hue cannot stand for the torch and the snowflake at once).
Do not "fix" that asymmetry. **findFlag's chooser is deliberately not grouped at
all**: its chips are filters, not a sort lens, so the normalised variants are
genuinely separate filterable things there. See memory
`project_metric_cut_grouping`.

New cut labels (anything other than Total / Per person / Per km²) need a
`flagsdata.cut*` i18n key in en + pl.

## The six surfaces, cheapest first

Numbered to match how the work is usually described. Each notes what it touches, its sub-skill, and whether it can be deferred.

### 1. Data file + visual identity (required, small)

Add `flags/metrics/<key>.json`, self-describing: `key` / `label` / `unit` / `format` / `source` / `year` / `values`. `format` is a display hint (`'compact'` for 1.4B / 337M / 552K, `'decimal1'` for one-decimal rates). Generate it with an `authoring/build-<key>.mjs` refresh script modelled on `build-population.mjs` (fetch source, join by ISO code, hand-maintained `FILLS` for what the source omits, honor the data contract above). Add one line to `flags/metrics/index.js`'s `METRIC_FILES`. Add the schema + data-contract test to `flags/metrics.test.js` (integers, coverage invariant, keys are real places).

**Visual identity is part of this step now:** one entry each in `flags/metricVisuals.js`'s `METRIC_ICONS` (24-box line-style svg, `currentColor`), `METRIC_HUES` (pick a hue distinct from the nearest existing metric; the blue/teal region is crowded), and `METRIC_SHORT` (compact chip label, usually reusing the `party.modeShort.*` key added in surface 5's i18n). `flags/metricVisuals.test.js` fails until all three exist, so a metric can't ship half-identified. These feed the metric hub chips on flagsdata + findFlag, flagsdata's applied-filter chips, AND Flag Party's setup chips + prompt lead. The hue is the sanctioned palette exception; it lives ONLY here (no CSS hue rules anywhere).

This step alone lights up surface 2 for free.

### 2. flagsdata metric lens (free once data exists)

The lens (pick a metric in the World-facts hub, see value + rank per tile, Highest/Lowest sort, sparse dimming) is metric-agnostic via `createMetric` (`flags/metrics.js`) and the `METRIC_FILES` registry. Adding the data file + visuals (surface 1) makes the new metric appear as a hub chip on flagsdata with no further code. Feature DE. Nothing to do here beyond surface 1.

**Unless it is a pair.** A metric that is another metric normalised must NOT arrive as a 35th chip: register it in `METRIC_CUT_GROUPS` (see "Pairs" above) so it appears as a cut inside its subject's panel instead. This is the one case where surface 2 is not free.

### 3. flagsdata filter bar + findFlag "Make a puzzle" filter (small since the hub)

Threshold tier pills (`>=100M` / `<=1M`, ...) that both pages render through the shared metric hub (`flags/metricHub.js`), fed by `flags/metricTiers.js`. Since the hub landed there is **no per-page section or filter-group code**: a metric registered in `METRIC_TIER_REGISTRY` gets its tier panel on both pages automatically. What remains:

- **Register the tiers once.** Add one line to `METRIC_TIER_REGISTRY`: `<key>: { breaks: <KEY>_BREAKS_FOR_RANDOM, factory: <key>, has: (c) => typeof c.<key> === 'number' }` (the `breaks` and `factory` come from surface 4; `has` powers the no-data guard). `buildMetricTierItems('<key>', countries)` backs both pages so they can't drift.
- **Shared filter plumbing** (unchanged by the hub): (a) scalar `<key>` on `Filters` + a `matchesFilters` branch reading the denormalized field (`flags/flagsFilter.js`); (b) a `<key>:>=N` URL token in `parseFilterString` / `serializeFilter` + `pillLabel` / `filterTitle` (`flags/findFlag.js`), reusing the `<key>.atLeast/atMost` i18n from surface 4; (c) `attach<Key>s` at both pages' load sites (each fetches the metric JSON itself); (d) a `<key>Probability` modifier path in `pickRandomMix` (mutually exclusive with colorCount) so Random can reach every tier. Then update the **findflag-random-coverage** skill (its rule requires documenting the new modifier). No `findFlag.sections.<key>` key anymore: the hub names metrics via `metric.<key>` + `METRIC_SHORT`.

### 4. TTT threshold mode + no-data handling (most code)

Mirror Feature DF. In `flags/engine.js`: a `<key>(op, n)` category factory (bake `exclusiveGroup: '<key>'`) + a `<KEY>_BREAKS_FOR_RANDOM` list. Wire into `buildRandomCategoryPool` / `categoryFromId` / `translateCategoryLabel`. Add `<key>.atLeast.*` / `<key>.atMost.*` i18n (en + pl). See the **ttt-puzzle-generator** skill.

> **Nothing per-metric to decide about board size any more.** Until 2026-07-16 a 9×9 board existed and every metric had to declare `ultimateEligible` per break, with a JSDoc paragraph arguing whether its extremes could back a 9-distinct cell. Feature U deleted the 9×9 board and that whole annotation. If you're copying an older metric as a template, drop any `ultimateEligible` / `ultimate: true` you find in it — those are the single biggest source of stale copy-paste in this file's history.

**`attach<Key>s(countries, values)` at every load site.** The party server (`party/server.js`), the offline / solo / online TTT pages (they fetch the metric JSON tolerantly so a fetch failure only disables the guard), and findFlag (surface 3d). **Forgetting one site = silently-empty cells or a misfiring guard.** Model `attach<Key>s` on `attachPopulations` in `flags/group.js`.

**No-data handling comes for free if the data contract holds.** `metricDataGap` (`flags/metricTiers.js`) already blocks any suggestion whose metric value is missing, and the registry's `has` (surface 3) is what it reads. As long as every real place has a value (rule 1), the guard blocks only non-places, which is correct. Nothing metric-specific to write here beyond the `has` line. Verify in-browser on a threshold cell that a real small place is pickable and an org shows "no data" (the `verify` recipe used for population).

### 5. Flag Party round (moderate; the round factory is already generalized)

A new metric is a **sibling round**, not a rewrite: `createSuperlativeQuestion(metric, questionId, opts)` (`flags/partyQuestions/superlativeCore.js`) takes a `createMetric(...)` instance and every round goes through it.

**Start with `flags/partyQuestions/superlativeCatalog.js`** — since Feature V Phase 4b-i that's the table driving the whole surface, and it's where the three per-metric decisions live that the data can't tell you:

- **`direction`** — `'most'` locks the round to one extreme; `null` deals both. Ask whether the LOW pole is a real question. "Biggest coffee producer" yes / "smallest grower" no → locked. "Lowest highpoint" (the Maldives) yes → both.
- **`zeroFiltered`** — `true` drops real zeros from *selection*. Needed whenever a real `0` means "doesn't do the thing" (landlocked 0 km, treeless 0.0%, dry states, islands with 0 borders), because a quartet of zeros ties and has no answer. **Not** needed for a sparse metric whose non-participants are simply absent from `values` (the crops) — `metric.has` already drops those.
- **`hintMost` / `hintLeast`** — the criterion label. `hintLeast` must be `null` exactly when the direction is locked (a test pins this).

Then the rest, six spots (grep `coalRound` / `superlative-coal` for a worked 'most'-only example, `forestRound` for a zero-filtered two-directional one):

1. **`superlativeCatalog.js`** — the entry above.
2. **`superlative.js`** — the JSON import, a `DATA` entry, and `export const <key>Round = QUESTIONS.<key>;`. No `createSuperlativeQuestion` call: the catalog loop builds it.
3. **`party/partyGameServer.js`** — add to the `QUESTIONS` array. **This is a PartyKit deploy** (Cloudflare, its own workflow).
4. **`flags/partyPlan.js`** `PARTY_MODES` + `partyPlan.test.js`.
5. **`flagParty/page.js`** `MODE_LABELS`.
6. **i18n en+pl** — `party.mode.superlative<Key>` / `party.modeShort.*` / `party.hintMost<Key>` (+ `hintLeast<Key>` if two-directional).

**This surface is no longer the one most likely to be forgotten.** It used to be, because rounds were registered by hand while surfaces 2-4 auto-lit from `METRIC_FILES`. `superlativeCatalog.test.js` now pins the catalog against **both** `METRIC_FILES` and `partyPlan`'s `METRIC_MODES` in both directions, so a metric registered in one and forgotten in the other **fails CI**. `superlative.js` throws at import if the catalog names a metric it has no data for.

**Still write the per-metric `superlative.test.js` test.** The generic tests prove the catalog's flags are **honoured** — they never prove they are **right**. Each one skips entries that don't carry the flag (`if (!m.zeroFiltered) continue;`), so a metric whose values hold real zeros and which you marked `zeroFiltered: false` has *no* coverage: it just quietly starts dealing quartets tied at zero. Nothing can decide that for you automatically either — population/density/gdp/gdpPerCapita carry real zeros (uninhabited territories) and are correctly *not* zero-filtered, so "has zeros ⇒ must filter" would be a false rule. It's a judgement call, and the per-metric test is where you record it. The generic tests are a floor for metrics nobody wrote one for, not a replacement.

**If the metric is a pair, add the seventh spot:** a `GROUPED_FAMILIES` entry in `flags/partyDraft.js` plus its card label and `sub` line, per "Pairs" above. Skipping it ships two cards for one subject, which is exactly the hand-crowding the families exist to stop.

The icon and hue are NOT party steps: the setup chip and the in-round criterion icon both resolve from `flags/metricVisuals.js` via the catalog's `key` (`metricKeyForQuestion` in `flagParty/page.js`), so surface 1's visuals entry covers them and a metric can no longer ship colourless (the old wine/cocoa/banana/coastline bug class).

### 6. Daily puzzles: NOT part of "done"; tracked in `METRIC_DAILY_PUZZLES.md`

The daily surface is deliberately **not** a code surface and **does not block the Feature's completion**. It's open-ended authoring on Jan's cadence (released daily puzzles are immutable, so they can't ride along with a code PR). So it lives in its own tracker, `METRIC_DAILY_PUZZLES.md`: when a metric's surfaces 1-5 land, add a row there and close the Feature. Do not author daily puzzles unprompted (see memory `project_metric_daily_puzzles_deferred`). For reference, the two parts, both metric-agnostic:

- **Superlatives: zero new code.** `resolveSuperlative` (`flags/superlative.js`) is metric-agnostic. Author `{ kind: "superlative", metric: "<key>", scope, direction, topN, filter? }` entries per the **daily-puzzle-author** skill. Rendering, difficulty, `checkSuperlativeShape` and `audit-superlative.mjs` already handle any metric key.
- **Result-screen rank captions (small code).** The population captions (`flags/populationRank.js` + the `metric === 'population'` branch in `daily/page.js`) are metric-specific. Add a `build<Key>RankNotes` and a branch, or generalize `populationRank.js` to take a metric key + label/unit + en/pl caption strings. Without it, that metric's superlatives show the plain flag name on zoom (harmless, just plainer).

## Tracking: seed a DATA_FEATURE.md Feature entry

Open the Feature entry as the **FIRST step**, before writing any code: put it under `## Now` in DATA_FEATURE.md and paste this checklist (surfaces 1-5) with every box unchecked. This is what makes partial or interrupted work visible (the corruption / temperature / happiness batch had no entries, so their half-done state was invisible until Jan noticed). Tick each box as it lands. **Close the Feature (move to `## Done`) once surfaces 1-5 are shipped**; the daily surface is tracked separately in `METRIC_DAILY_PUZZLES.md` and never keeps a Feature open.

```markdown
### Feature <ID>: <Metric> as a world metric

**Data contract:** dense (fill all real places) | sparse (absence: zero) | universal (source all, absence: unknown)

- [ ] 1. Data: `flags/metrics/<key>.json` + `build-<key>.mjs` + `METRIC_FILES` line + `metrics.test.js` schema/coverage/no-org invariant; visuals: icon + hue + short label in `flags/metricVisuals.js` (pinned by `metricVisuals.test.js`)
- [ ] 2. flagsdata lens (free once step 1 lands; just confirm the hub chip appears)
- [ ] 3. Filters: `metricTiers.js` registry line (+ `has`); `flagsFilter.js` scalar + `findFlag.js` URL token; `<key>Probability` in `pickRandomMix` + `findflag-random-coverage` skill note; `attach<Key>s` at both load sites (the hub renders both pages' tier pills automatically)
- [ ] 4. TTT: `<key>()` factory + `<KEY>_BREAKS_FOR_RANDOM` + pool/id/label wiring; `attach<Key>s` at all 6 load sites; `<key>.atLeast/atMost` i18n; verify no-data guard in-browser
- [ ] 5. Flag Party round (six spots, grep `superlative-density`; icon + hue come from step 1's visuals entry)
- [ ] Pair, ONLY if this metric is an existing one normalised: `METRIC_CUT_GROUPS` (`flags/metricCuts.js`) so flagsdata shows it as a cut rather than a new chip, and `GROUPED_FAMILIES` (`flags/partyDraft.js`) + card label + `sub` line so the party hand offers one card. Delete this box for an ordinary metric.

Surface 6 (daily puzzles) is NOT a checkbox here: when 1-5 land, add a row to `METRIC_DAILY_PUZZLES.md` and close the Feature.
```

Sub-skills for the individual surfaces: **ttt-puzzle-generator** (surface 4), **findflag-random-coverage** (surface 3e), **daily-puzzle-author** (surface 6). Worked example end to end: population (Features DD, DE, DF, DG in DATA_FEATURE.md, plus the no-data guard and uninhabited-fill follow-ups).
