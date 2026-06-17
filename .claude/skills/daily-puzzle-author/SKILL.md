---
name: daily-puzzle-author
description: Owns the daily-puzzle catalog end-to-end. Use when Jan asks to add a puzzle, schedule the next few days, generate candidate ideas, promote an idea, review what's coming up or what's in ideas, audit flag-data ambiguity, or anything else that touches the catalog. The agent pulls the current state from blob, edits in `.catalog/`, runs `npm test`, shows Jan the diff for player-affecting changes, and pushes to blob. Carries the 15 rules (9 hard / 6 soft) that the catalog and tests enforce — primary-clean colours, small-property compounds, no-subset, single-use tokens, en+pl descriptions, flag-data ambiguity, etc.
---

# Daily-puzzle author

The daily catalog lives in the public-read Azure blob `styetanotherquiz/catalog/` — four files, **not in the repo**. Everything in this skill operates against blob (via the `.catalog/` working copy the agent maintains).

- `puzzles.json` — **single source of truth.** Every entry past, present, and future, each with its own `date`. Players see entries where `date <= warsawToday()`; "today's puzzle" is the highest-dated visible entry. There is no separate "live" vs "backlog" file — the date field is the only thing that gates visibility.
- `ideas.json` — **active review pipeline.** Fresh brainstorm candidates Jan reviews on `/daily/ideas/` and the agent promotes to `puzzles.json`. Each entry: `{ "filter", "notes", "answers", "difficulty", "suggestedN" }`. No `date` field yet — date is assigned at promote time.
- `parked.json` — **waiting room** for filters that don't fit current rules but are worth keeping for past-#100 use or until a constraint changes. Each entry: `{ "filter", "notes" }` only — no `answers`, no `difficulty`, no `date`. Not rendered on `/daily/ideas/`, not checked by tests. Ask explicitly ("what's parked", "promote some parked") to consult this file.
- `policy.json` — single-use-token policy (rule 14). Lists each token and its rationale.

Each `puzzles.json` entry is `{ "n": <int>, "date": "YYYY-MM-DD", "filter": "<filterString>", "answers": ["<code>", ...], "description": { "en": "...", "pl": "..." } }`. Both `n` and `date` are sequential — `n` increments by 1 in array order, `date` increments by exactly one day (the validator enforces both).

## Agent workflow

Jan does not run pull/push/test himself. The agent owns the loop and runs the primitives in `authoring/` directly on every catalog operation. For any request that *changes* the catalog (add, schedule, generate, edit), follow this loop:

1. **Pull** — `node authoring/pull.mjs` to sync `.catalog/` with blob. Always pull at the start of any session that will mutate, even if `.catalog/` exists from a prior run — between sessions, another agent run or Jan's own edits may have moved blob state.
2. **Edit** — apply the change in `.catalog/*.json`. When appending a new entry to `puzzles.json`, set `date = latest_date_in_file + 1 day`. Hand-write the en + pl description. For brainstorm batches, `node authoring/generate-candidates.mjs` (it appends to `ideas.json`, not `puzzles.json`).
3. **Test** — `npm test`. The full rule suite drives off `.catalog/`; this is the same gate `authoring/push.mjs` runs internally, but running it explicitly surfaces failure messages cleanly.
4. **Show + confirm** — for any change to `puzzles.json`, show Jan the diff (`git diff --no-index .catalog/.snapshot/puzzles.json .catalog/puzzles.json`) and ask for confirmation before pushing. For changes to `ideas.json` / `parked.json` / `policy.json`, push silently — these are author-state, not player-facing.
5. **Push** — `node authoring/push.mjs` (add `--yes` to skip the internal prompt; the agent already confirmed in step 4). Push validates against the hard rules a second time and uploads.

Read-only operations (review what's scheduled next, count entries, etc.) only need step 1 (pull) and then read from `.catalog/`.

For brainstorm review Jan can open `/daily/ideas/` in his browser — it reads blob directly, so after step 5 (push) the page reflects the new ideas immediately. Same for `/daily/backlog/` (which now shows future-dated entries from `puzzles.json` — name "backlog" preserved for URL stability).

## Conflict handling

`authoring/push.mjs` refuses to overwrite blob if the remote moved since the last pull (e.g. another agent session edited in parallel). On conflict: re-pull, re-apply the user's edits on top of the new state, re-test, push again. Tell Jan a conflict happened — don't silently re-do the edits, because the new state may have changed what counts as "next" entry (both `n` and `date`).

## Releasing

There is no release step. Each entry's `date` is the release date — the page filters `entries.filter(p => p.date <= warsawToday())` on every load, so a puzzle becomes player-visible at Warsaw midnight on its `date` without anything firing. To schedule the next N puzzles, the agent appends N entries to `puzzles.json` with sequential dates and pushes once.

**What this changes for you as author:**

- **The backlog is the schedule.** "Pick up tomorrow's puzzle" = append an entry with `date = today + 1 day`. There's no "promote" step where a separate file gets transformed.
- **Day-to-day work is "keep the schedule full" — at least a week of headroom is the comfort zone.** If the latest date in `puzzles.json` is within ~3 days of `warsawToday()`, that's a refill cue. Jan's 3-day-trip cadence is the target: leave whenever, come back, never panic about "did the puzzle ship."
- **Catalog drift = test failure on next push.** If `flags/countries.json` changes break a stored answer set, `validateCatalog()` throws and `push.mjs` refuses to upload. Refresh the offending entry or revert the country-data change.
- **No emergency manual fallback path.** The release used to have a midnight runner + a manual workflow trigger as backup. Feature R removed both. The single point of dependency is now `puzzles.json` being correctly populated — which is the agent's job. Catch missing dates with `npm test` before pushing.

## Two kinds of entries

Most puzzles are **filter** entries — `{ n, date, filter, answers, description }` — where the filter string drives the answer set and the catalog tests pin the link. The rest of this file calls these "filter entries" or just "entries."

**Manual entries** are the escape hatch for puzzles whose criterion can't be expressed in the filter DSL — ad-hoc visual patterns ("triangles pointing inward from the hoist"), non-flag-data facts ("countries that legalised X"), curated-list themes ("the original Schengen six"), or anything else the DSL doesn't reach. Shape:

```jsonc
{
  "n": 51,
  "date": "2026-07-26",
  "kind": "manual",                        // discriminator
  "answers": ["co", "py", "uy", "ve"],     // hand-curated, sovereign codes only
  "title": {                               // replaces the pill chain in the header
    "en": "Triangles pointing inward from the hoist",
    "pl": "Trójkąty wskazujące do środka z drzewca"
  },
  "description": {                         // same as filter entries
    "en": "Find all flags whose left edge has a triangle pointing toward the centre.",
    "pl": "Znajdź wszystkie flagi, których lewa krawędź ma trójkąt skierowany ku środkowi."
  }
}
```

No `filter` field on a manual entry — `kind` is the discriminator. The page picks `entry.title` for the header instead of `filterToCategory(...)`.

**When to reach for one.** Visual criteria the DSL can't capture (triangle direction, charge placement, motif orientation). Non-flag-data facts you don't want to bake into `countries.json` for one puzzle. One-off curiosities. If the criterion is going to come back in compounds ("Asia + has-X"), tag the data instead.

**The cost.** The catalog tests can't validate completeness — there's no `parseFilterString` against which "your answer list is missing Estonia" would surface. Curation is on you. Run the puzzle yourself; check sibling flags ("does my framing accept this one too?"); review at least one peer's eye before publishing.

**Funnel.** Manual entries go straight to **`puzzles.json`** (with `n` + `date`) or **`parked.json`** (without `n`/`date`, while you're still working out the answer list). Manual entries do NOT go through `ideas.json` — the ideas pipeline is generator-fed and the generator can't produce manual entries.

**Which rules apply.** Manual entries skip the filter-only rules (1, 2, 5, 6's filter-refinement half, 10, 14, 15) and keep the rest. Specifically:
- **Apply**: 3 (sovereign codes), 4 (sequential `n` + contiguous dates), 6 (no two entries — any kind — share an identical answer set), 7 (description), 8 (nameScore by N), 9 (answer-set size), 11 (country-reuse cap), 12/13 (onboarding shape).
- **Skip**: 1 (drift detector — no filter to resolve), 2 (no tokens), 5 (no colours to be primary-clean against), 6's strict-subset-via-refinement half (a manual entry can't be a "refinement" of a filter entry — no shared token vocabulary), 10 (no compounds), 14 (no tokens), 15 (no filter-membership-flipping flag to flag).
- **Extra**: manual entries need `title.en` and `title.pl`, both non-empty. Pinned by the `every manual entry has en + pl title` test.

## Filter DSL primitives

Filter strings are comma-separated tokens. Each token is `group:value` (include) or `group:!value` (exclude), plus the scalar `colorCount:N` (or `colorCount:>=N`).

- `continent:<name>` / `continent:!<name>` — scalar, can't AND two continents.
- `color:<name>` / `color:!<name>` — array, include is AND-among-values (must have every selected colour), exclude is none-of.
- `motif:<name>` / `motif:!<name>` — same shape as colour.
- `status:<sovereignty>` / `status:!<sovereignty>` — scalar.
- `colorCount:N` / `colorCount:>=N` — integer constraint on the country's full palette (`primaryColors + additionalColors`) size. Bare `colorCount:N` is exact (same as `colorCount:=N` — bare form preserved for back-compat with existing entries); `colorCount:>=N` matches "N or more". Used for "only N colours" or "busy flags" puzzles where chaining `color:!<other>` would be brittle. Always checks the union regardless of `colorField`, so it stays consistent under the primary-clean test.

The "only red+white+blue" pattern is `color:red,color:white,color:blue,colorCount:3` — every listed colour must be present AND the total count locks the rest out. Compare to the chain-of-excludes form `color:red,color:white,color:blue,color:!yellow,color:!green,color:!black,color:!orange,color:!violet`, which silently breaks the moment a new colour enters the palette.

## Workflow

When you author or vet a puzzle, run through the checklist below in order — "fail fast", cheap data checks first, judgment calls last. Hard rules are pinned by `flags/daily.test.js`; failing one means `npm test` will fail. Soft rules need human judgment — failing one isn't a crash, but you need a reason.

After every change to any catalog file, run:

```
npm run validate
```

This runs the test suite (hard-rule enforcement) plus typecheck. Treat a failing test as the rule speaking — don't suppress it without understanding why.

## The 15 rules

### Hard (test-pinned)

1. **Filter parses + answers match what it resolves to.** *(drift detector)* `parseFilterString(filter)` must succeed, and stored `answers` must equal exactly `sov.filter(c => matchesFilters(c, parsed))` under the default `colors` field. Frozen-catalog invariant — once shipped, puzzle #N never silently changes.

2. **No redundant filter tokens.** *(redundant-filter test)* Dropping any single token from `filter` must change the answer set. If `Europe · cross · red` resolves to the same set as `Europe · cross`, drop the redundant token.

3. **Every answer is a sovereign country code.** *(sovereign test)* `answers[]` codes must all be in `flagsGamePool(COUNTRIES, false)`. Sovereign-only scope.

4. **Sequential `n` AND contiguous dates.** *(structural test + validator)* In `puzzles.json`: `entry.n === index + 1` (starting at 1), and each entry's `date` is exactly one day after the previous entry's `date`. No gaps, no duplicates, format `YYYY-MM-DD`. Releasing a new puzzle is "append the next entry with the next date" — both fields move together.

5. **Primary-clean colours (puzzles #1–100).** *(primary-clean test)* The same answer set must resolve under `{ colorField: 'primaryColors' }` as under the default. No emblem-only colour matches in onboarding. *Why:* a player typing Bolivia in "South America · blue" and getting accepted because Bolivia's blue is only in its coat of arms reads as "the game is wrong". First 100 puzzles are where players build trust; surprises here are uniquely expensive. Past #100: still preferred, not enforced.

   **Escape hatch: `primaryCleanExempt: true`.** Add this field on a puzzle entry to opt that single entry out of the test. Use it sparingly — every exempt puzzle is a place a player may type a flag and feel "the game is wrong". Pattern when adding: include a note in the entry's `description` field (or below in this rule) explaining *which* flag drifts and *why* keeping it is worth the trust cost. Current exemptions:
   - `continent:Europe,color:black` (Malta's black is the George Cross detail, COA-only — primary resolves to 5, default colors to 6; the 6th flag is worth keeping because the puzzle reads as "famous European black-element flags").

6. **No filter-refinement puzzles (puzzles #1–100).** *(no-subset test, ideas-no-subset test)* For any two puzzles in #1–100: their answer sets must not be equal, AND a strict answer-subset is only a violation when it coincides with a *filter-token refinement* (the smaller-answers filter literally adds tokens to the larger-answers filter — e.g. `Europe+cross+blue` extends `Europe+cross`). **One of the most load-bearing rules** when the refinement is present: violations completely undermine the "find all the X" framing because the player has already seen every answer in the smaller set when they met the larger one and reads it as "you just filtered more." *Why:* `Europe + cross` (puzzle #1, 9 flags) followed by `Europe + cross + white` (8 of those 9) reads as "remember which of those 9 were white" — memory puzzle, not discovery. Past #100 allowed as a deliberate recall mechanic.

   *Refined as of 2026-06-08* — pure answer-set overlap with different filter framings is now allowed because the player reads such pairs as distinct puzzles. Example: `motif:cross,motif:!union-jack` (worldwide minus UJ-bearing) shares 3 NA flags with `continent:NA,motif:cross`, but the framings are unrelated (one is "global minus a sub-group," the other is "regional"), so the player sees two different puzzles. See `isFilterRefinement` in `flags/daily.js` for the exact predicate.

   *Enforcement is three-layered, all of it test-pinned or generator-enforced:*
   - **Catalog test** — fires on all `puzzles.json` pairs at `npm test` time.
   - **Ideas test** — fires on every entry in `ideas.json`, against (puzzles ∪ other ideas). Parked filters live in `parked.json` and aren't loaded by this test.
   - **Generator** (`authoring/generate-candidates.mjs`) enforces refined rule 6 within each batch — every new candidate is checked against (puzzles ∪ everything already accepted in the current run).

7. **Every puzzle has en + pl descriptions.** *(description test)* `entry.description.en` and `entry.description.pl` must both be non-empty strings. The sentence renders under the daily header to turn the pill chain ("Europe · cross") into plain language ("Find all European flags with a cross"). *Why:* a player reported reading "Europe · cross" as the puzzle title rather than the filter spec — they didn't realise they had to find flags that had a cross. The helper sentence closes that gap. Auto-generation was rejected because mixed include/exclude phrasing reads badly in EN and PL grammar needs a human (gendered adjectives, instrumental case). The shape stays narrow ("Find all X flags with/without Y") so it doesn't drift into a paragraph.

### Soft (hand-check)

8. **`nameScore` cap by N.**
   - #1–5: every answer `nameScore ≤ 3`
   - #6–50: every answer `nameScore ≤ 5`
   - #51–100: every answer `nameScore ≤ 6`
   - Past #100: any
   *Why soft:* a few generous puzzles deserve an exception (e.g. a famous-country-only puzzle that includes one nm=4 country).

9. **Answer-set size: 4–30 flags.** Every puzzle (filter or manual, every N) must have between 4 and 30 answers inclusive.

   *Why the floor of 4 (was 1–2 banded by N):* tiny answer sets read as unsatisfying — a "find all the X" framing collapses into a gotcha when there are only 2–3 to find, and the player typically meets the answer set by accident before they've engaged with the category. Compounding to land on 2–3 flags ("Asia + green + colorCount:2") also tends to be the contrived-set anti-pattern rule 10 guards against. 4 is the smallest size where "find all of them" still reads as a category, not a trivia question. Hard rule (gated by `flags/daily.test.js`).

   *Why 30 (was 25):* membership-shaped puzzles ("all EU members", "all Schengen", "all G20") naturally land in the high 20s. Capping at 25 forced an arbitrary "which 2 do you drop?" question for those puzzles. 30 keeps the autocomplete UX manageable while accepting the common membership sizes whole. NATO (32) and other rare large groups still need to be hand-judged.

   **Escape hatch: `sizeFloorExempt: true`.** Grandfathers shipped puzzles that predate this rule and are now in the immutable past. Two existing exemptions (#5 Asian-animal, #8 Asia-blue-no-red — both 3 flags). Do NOT set on new entries; if a draft lands below 4, drop a token or rework the framing rather than reaching for the exemption.

10. **No small-property compounds (puzzles #1–100).** If any filter property has under 15 sovereign matches under `primaryColors`, use it solo. Current small properties:
   - `motif:weapon` — 13
   - `continent:South America` — 12
   - `continent:Oceania` — 14
   - `color:orange` — 10
   *Why:* compounding produces tiny, contrived sets ("Africa, weapon, yellow" = "the African weapon flags that happen to also be yellow") — not a category the player would recognise. "Solo" means worldwide without continent/colour/other-motif. These solo puzzles tend to need higher nameScore caps and live later in onboarding.

   *Verify before adding:* run a quick check against `flags/countries.json` — these counts shift when sovereign data changes.

   **Small intersections behave like small properties.** Some pairs are themselves small enough that compounding further produces contrived sets, even when both members are individually large:
   - `continent:Europe,color:black` — 5 sovereigns primary-clean (al, be, ee, de, li). Don't compound further; if you want a Europe+black puzzle, run it solo.
   - `continent:Africa,motif:coat-of-arms` — 3 sovereigns primary-clean (eg, gq, ke). Don't compound; the "African coat-of-arms" set is also a category where the player can't reliably tell what's a coat of arms across the continent, so worldwide-COA compounds are usually a better framing.

   When you discover another such pair (intersection under 15 primary-clean), add it here.

11. **Country-reuse cap.** No country appears in more than 5 puzzles across `puzzles.json`. When hand-authoring, check the cumulative count.

12. **#1 is pinned.** `continent:Europe,motif:cross` stays at position #1 (date `2026-06-06`). Regenerations don't touch it without a deliberate decision.

13. **Continent variety in onboarding.** At least 5 of the first 10 are Europe ("start mostly with Europe"); the rest spread across Asia / Africa / NA. Don't try to fit every continent into the first 10 — South America's primary-clean-and-not-small options are essentially zero, so it appears later.

### Hard, added later

14. **Single-use tokens.** *(single-use test)* Each token listed in `policy.json` (`singleUseTokens[]`) must appear in **at most one** entry across `puzzles.json`. Initial list (see the JSON for current state and per-token rationale):
    - `motif:weapon` — 13 sovereigns
    - `motif:union-jack` — 5 sovereigns
    - `color:orange` — 10 sovereigns

    *Why:* once a property's full set has been exposed by a single "find all X" puzzle, the player has seen every X flag. Future puzzles compounding X (`Africa + X`, `X + animal`, etc.) ask "of those flags you already met, which are also Y" — that's a recall puzzle dressed as a find puzzle, and it feels redundant. Small properties are most prone to this because their compounds are tiny and contrived anyway.

    *How to add a token:* edit `policy.json` and add an entry to `singleUseTokens` with `token`, `sovs`, and `reason`. Leave the existing canonical "find all X" puzzle in place — the test enforces no-recurrence going forward. *Don't* add continent tokens — continents subdivide into recognizable subgroups (Europe + cross is a natural puzzle even though "find all Europe" exists), so the exhaustion logic doesn't apply.

    *Numbered 14 rather than 8* to avoid renumbering rules 8-13 (and the cross-references to them in this file plus `ideas.json` notes). The Hard / Soft split is now: hard = **1-7 + 14-15**, soft = 8-13.

15. **No flag-data ambiguity.** *(audit tests in `flags/daily.test.js`)* No entry in `puzzles.json` or `ideas.json` may put a flag with `ambiguousColorCount` or `ambiguousColors` into the disagreement zone — where a player's plausible-counting or plausible-membership call would flip its answer-set membership. Currently tagged in `flags/countries.json`: Bhutan (`ambiguousColorCount: [3, 4]`, `ambiguousColors: ["white"]`) and American Samoa (`ambiguousColorCount: [4, 5, 6, 7]`). `ambiguousColorCount` is the list of counts a reasonable player could give — it always includes the canonical count plus the contested neighbours; `ambiguousColors` is the list of colours whose presence on the flag is itself disputed. See `DATA_FEATURE.md` Feature DA for the rationale and the seed-tag list.

    *Why:* same failure shape as rule 5 (primary-clean) — a flag the game "judges" against a player's plausible count reads as "the game is wrong." Bhutan in `Asia + yellow + colorCount:3` was the poster-child: the dragon outline is the only white, and reasonable players land on 3 or 4 colours.

    *Authoring cue:* `node authoring/audit-ambiguity.mjs` reports any violation across `puzzles.json` + `ideas.json` with the offending flag and constraint — same gate as the test enforces, friendlier output. Run it after hand-editing a puzzle to surface the case the test would catch anyway, with a more readable message. `authoring/generate-candidates.mjs` applies the audit inline so brainstorm batches never propose ambig-broken candidates in the first place.

## Difficulty scoring

Author-facing sort signal — **advisory, not a rule.** Used to order the schedule so easier puzzles come earlier and the player has a learning curve. Hard caps by N (rule 8) still own the rule-level constraints.

**Implementation:** `daily/difficulty.js`. Pure function `scoreEntry(entry, byCode) → { score, mean, max, outlier, sizeAdjust, tokenAdjust, setSize, tokens }`. Tests + calibration anchors pinned in `daily/difficulty.test.js`. The code is the source of truth — if the math changes, update the test anchors AND this section in the same change.

**Formula:**

```
score = mean(nameScore)                       // primary: typical country fame
      + 0.4 × max(0, max − mean − 1.5)        // outlier bump
      + sizeAdjust                            // U-shape (n=1 +2; 2-3 +0.3; 4-15 0; 16-25 +0.2; 26-30 +0.5)
      + 0.1 × max(0, tokenCount − 2)          // compound friction
      + worldwideBump                         // +1.0 if no continent:X include token
```

**Philosophy:**

- **Mean (not max) is primary.** The typical country drives the player's experience. A puzzle of 5 famous + 1 Vatican plays mostly easy — the player gets 5/6 and feels fine; Vatican adds *some* drag (the outlier bump) but doesn't dominate.
- **Size is U-shaped.** 1-flag puzzles are categorically hard (no margin — wrong guesses give nothing). The 4-15 range is the sweet spot. Large sets (16+) grow harder because *recall* load grows even when each country is famous: "list all 27 EU members" is harder than "list 9 European cross flags," same individual fame.
- **Worldwide search is harder than regional.** When the filter has no `continent:X` include token, the player must mentally search ~200 countries instead of a known region (~12-54). `motif:cross + color:red` (any cross flag globally that's also red) plays much harder than `continent:Europe + motif:cross` even when the sets are similar size. Exempt: single-token `motif:eu-member` (and any other motifs added to `MEMBERSHIP_MOTIFS` in `daily/difficulty.js`) — those ask the player to *recall* a discrete known list, not search.
- **Small absolute differences are intentional.** Most puzzles cluster between 1.5 and 6.0 — the rank order matters, the absolute numbers are not a measurement.

**Calibration anchors** (catalog at time of writing — drift = test failure):
- #1 Europe + cross (10 flags, 7×nm=1 + 2×nm=2 + 1×nm=3) ≈ **1.5**
- #3 EU members (27 flags, all famous) ≈ **1.8** — the size penalty (+0.5 for n=27) pushes the membership puzzle *above* the smaller Europe + cross puzzle, even though every EU member is famous individually
- Sweden + Ukraine (Europe + blue+yellow + 2 colors, 2 flags both nm=1) ≈ **1.5**
- White+blue 2-color (6 flags including Vatican, nm6 outlier) ≈ **3.6**
- Africa RGYK-only-4 (3 small-nation flags) ≈ **5.4**

**When to use:** sort the upcoming entries after a generation pass, decide where to slot a new idea, decide whether a puzzle belongs earlier or later in the schedule. Author can override — if the formula says "rank 2" but rule 12 says "#1 is pinned to Europe + cross," rule 12 wins.

## When data changes

The small-property list in rule 10 is derived from `flags/countries.json`. If you add countries, change `primaryColors`, or split a continent, the counts shift. Before relying on a rule, re-verify the current state with a quick query against the file. The hard rules (1–7) are always derived live by the test, so they self-correct.

## When a soft rule graduates to hard

E.g. we add `primaryMotifs` and rule 10 becomes a test. Update this SKILL.md AND the test in the same change.

## Batch generation

Pump candidates into `ideas.json` for author review before they're promoted to `puzzles.json` with handwritten descriptions and dates.

Prompt: **"generate N candidates"** (with optional qualifiers). Examples:

- `"generate 100 candidates"` — default broad sweep across all templates and mechanics
- `"generate 30 targeting #100+"` — harder tier, ignores early-N nameScore caps
- `"generate 20 exploiting `colorCount:>=N`"` — focused on one mechanic
- `"fill the schedule to #200"` — compute how many entries needed, generate that many, then promote

Tool: `node authoring/generate-candidates.mjs`. The script enumerates filter templates (continent×color, continent×motif, `colorCount:N` and `colorCount:>=N` combos, exclude patterns), validates each against the hard rules + the size band of rule 9, scores with `daily/difficulty.js`, and writes survivors as `{ filter, notes, answers, difficulty, suggestedN }` entries **appended** to `.catalog/ideas.json` — existing entries (including the parked `parkUntilN: 101` ones) stay at the top of the file.

**What the script checks programmatically** (no manual review needed):
- Rule 1: filter parses + non-empty answer set
- Rule 2: no redundant filter tokens
- Rule 3: every answer is a sovereign code
- Rule 5: primary-clean
- Rule 6: candidate's answer set is neither a strict subset nor a strict superset of any existing `puzzles.json` entry's set (and is not exactly equal either — "same puzzle, different filter syntax" is also rejected). Checked against `puzzles.json` only, NOT against the parked entries in `ideas.json` (those are `parkUntilN: 101` precisely because they're rule-6 violators meant for past-#100 use). Strict-enforcement is correct as long as every catalog entry sits in #1-100 — when an entry first crosses #100 we'll need to relax this for past-#100 candidates.
- Rule 9: answer set size in [4, 30]
- Rule 14: no single-use token reuse
- Rule 15: no flag-data ambiguity (count or membership straddle on `ambiguousColorCount` / `ambiguousColors`)
- Dedup: filter string not already in the catalog or ideas

**What the author still decides at promote time** (when moving from ideas → `puzzles.json`):
- Rule 4: numbering AND date — `n = previous.n + 1`, `date = previous.date + 1 day`
- Rule 7: en/pl descriptions — hand-written per puzzle
- Rule 8: nameScore caps by N — `suggestedN` is advisory only
- Rule 10: small-property compounds — script avoids by template choice
- Rule 11: country-reuse cap — checked across the whole `puzzles.json` at promote
- Rule 12: #1 is pinned
- Rule 13: continent variety in onboarding

After generation: open `/daily/ideas/` to play-test the most interesting ones, then promote selected entries into `puzzles.json` with handwritten descriptions, the next free `n`, and `date = latestDate + 1 day`.

## When a new mechanic ships

When a new filter primitive lands (new DSL token like `colorCount:<=N`, a new motif/colour tag, a continent split, a new statehood category, etc.), the catalog needs a sweep — append-only doesn't give the new style enough early exposure, and existing entries may become rewritable into a cleaner form.

Prompt: **"new mechanic landed: `<name>`"** or **"revisit catalog for `<mechanic>`"**. The workflow:

1. **Sweep existing entries.** Does any `puzzles.json` filter get *cleaner, more accurate, or less brittle* when rewritten with the new mechanic? Flag those for possible replacement. (Example: the chain-of-excludes form `color:red,color:white,color:!yellow,color:!green,...` becomes a one-token `colorCount:N` rewrite.) **Already-released entries are frozen** (rule 1's drift detector) — only future-dated entries are editable in place.
2. **Generate candidates** the mechanic enables — puzzles that were impossible or contrived without it. Aim for variety, not volume.
3. **Score with `daily/difficulty.js`** and slot into the order. Append if the new style is niche; reorder future-dated entries (renumbering `n` and dates together is allowed per rule 4) if it should appear earlier for variety.
4. **Update the small-property list (rule 10)** if the new mechanic changes how compound counts behave.
5. **Update calibration anchors (`daily/difficulty.test.js`)** only if the formula's input distribution actually shifted — usually a no-op, but worth a glance.
6. **Update `SINGLE_USE_TOKENS` (rule 14)** if the new mechanic exposes a small-property motif/colour where the "find all X" puzzle now fully exhausts X.

If steps 1-2 produce nothing useful, stop — not every mechanic earns a sweep, and adding noise isn't free.

## Future DSL extensions

Ideas that need a new filter primitive before they become puzzles:

- **`colorCount:<=N`** — "at most N colours". The current grammar has `colorCount:N` (exact) and `colorCount:>=N` (at least). `<=` is the symmetric add — wire it through `parseFilterString`, `serializeFilter`, `matchesFilters`, and `pillLabel` / `filterTitle` at the same time, mirroring how `>=` was handled.
