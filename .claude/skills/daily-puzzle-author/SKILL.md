---
name: daily-puzzle-author
description: Adds or vets entries in the gridgame daily-puzzle catalog (daily/daily_puzzles.json and daily/daily_backlog.json). Use when authoring a new puzzle, refilling the backlog, releasing the next backlog entry to live, or reviewing whether a proposed filter would make a good puzzle. Carries the 14 rules (7 hard / 7 soft) that the catalog and tests enforce — primary-clean colours, small-property compounds, no-subset, en+pl descriptions, etc. Pulls from flags/countries.json so changes to country data don't require re-deriving the rules.
---

# Daily-puzzle author

The daily catalog is two append-only JSON files:

- `daily/daily_puzzles.json` — released puzzles, visible to players. "Today's puzzle" = last entry.
- `daily/daily_backlog.json` — staged, hidden. Releasing = move `backlog[0]` to the end of live.

Each entry is `{ "n": <int>, "filter": "<filterString>", "answers": ["<code>", ...], "description": { "en": "...", "pl": "..." } }`. Numbering is sequential across the two files (live ends at N → backlog starts at N+1).

## Workflow

When you author or vet a puzzle, run through the checklist below in order — "fail fast", cheap data checks first, judgment calls last. Hard rules are pinned by `flags/daily.test.js`; failing one means `npm test` will fail. Soft rules need human judgment — failing one isn't a crash, but you need a reason.

After every change to either JSON file, run:

```
npm run validate
```

This runs the test suite (hard-rule enforcement) plus typecheck. Treat a failing test as the rule speaking — don't suppress it without understanding why.

## The 13 rules

### Hard (test-pinned)

1. **Filter parses + answers match what it resolves to.** *(drift detector)* `parseFilterString(filter)` must succeed, and stored `answers` must equal exactly `sov.filter(c => matchesFilters(c, parsed))` under the default `colors` field. Frozen-catalog invariant — once shipped, puzzle #N never silently changes.

2. **No redundant filter tokens.** *(redundant-filter test)* Dropping any single token from `filter` must change the answer set. If `Europe · cross · red` resolves to the same set as `Europe · cross`, drop the redundant token.

3. **Every answer is a sovereign country code.** *(sovereign test)* `answers[]` codes must all be in `flagsGamePool(COUNTRIES, false)`. Sovereign-only scope.

4. **Sequential numbering.** *(structural test)* In each file, `entry.n === index + 1`. Backlog continues where live leaves off (`backlog[0].n === live.length + 1`). Releasing a puzzle is a clean append.

5. **Primary-clean colours (puzzles #1–100).** *(primary-clean test)* The same answer set must resolve under `{ colorField: 'primaryColors' }` as under the default. No emblem-only colour matches in onboarding. *Why:* a player typing Bolivia in "South America · blue" and getting accepted because Bolivia's blue is only in its coat of arms reads as "the game is wrong". First 100 puzzles are where players build trust; surprises here are uniquely expensive. Past #100: still preferred, not enforced.

   **Escape hatch: `primaryCleanExempt: true`.** Add this field on a puzzle entry to opt that single entry out of the test. Use it sparingly — every exempt puzzle is a place a player may type a flag and feel "the game is wrong". Pattern when adding: include a note (in the skill or PLAN.md) explaining *which* flag drifts and *why* keeping it is worth the trust cost. Current exemptions:
   - `continent:Europe,color:black` (Malta's black is the George Cross detail, COA-only — primary resolves to 5, default colors to 6; the 6th flag is worth keeping because the puzzle reads as "famous European black-element flags").

6. **No strict-subset puzzles (puzzles #1–100).** *(no-subset test)* For any two puzzles in #1–100, neither's answer set may be a strict subset of the other's. *Why:* the player who already met the superset has seen every answer in the subset, so the subset puzzle isn't "find all the X" — it's "remember which of those are also Y". Past #100 allowed as a deliberate recall mechanic.

7. **Every puzzle has en + pl descriptions.** *(description test)* `entry.description.en` and `entry.description.pl` must both be non-empty strings. The sentence renders under the daily header to turn the pill chain ("Europe · cross") into plain language ("Find all European flags with a cross"). *Why:* a player reported reading "Europe · cross" as the puzzle title rather than the filter spec — they didn't realise they had to find flags that had a cross. The helper sentence closes that gap. Auto-generation was rejected because mixed include/exclude phrasing reads badly in EN and PL grammar needs a human (gendered adjectives, instrumental case). The shape stays narrow ("Find all X flags with/without Y") so it doesn't drift into a paragraph.

### Soft (hand-check)

8. **`nameScore` cap by N.**
   - #1–5: every answer `nameScore ≤ 3`
   - #6–50: every answer `nameScore ≤ 5`
   - #51–100: every answer `nameScore ≤ 6`
   - Past #100: any
   *Why soft:* a few generous puzzles deserve an exception (e.g. a famous-country-only puzzle that includes one nm=4 country).

9. **Answer-set size by N.**
   - #1–50: 2–25 flags
   - Past #50: 1–25 flags
   - 1-flag puzzles allowed only past #50.

10. **No small-property compounds (puzzles #1–100).** If any filter property has under 15 sovereign matches under `primaryColors`, use it solo. Current small properties:
   - `motif:weapon` — 13
   - `continent:South America` — 12
   - `continent:Oceania` — 14
   - `color:orange` — 10
   *Why:* compounding produces tiny, contrived sets ("Africa, weapon, yellow" = "the African weapon flags that happen to also be yellow") — not a category the player would recognise. "Solo" means worldwide without continent/colour/other-motif. These solo puzzles tend to need higher nameScore caps and live later in onboarding.

   *Verify before adding:* run a quick check against `flags/countries.json` — these counts shift when sovereign data changes.

   **Small intersections behave like small properties.** Some pairs are themselves small enough that compounding further produces contrived sets, even when both members are individually large:
   - `continent:Europe,color:black` — 5 sovereigns primary-clean (al, be, ee, de, li). Don't compound further; if you want a Europe+black puzzle, run it solo.

   When you discover another such pair (intersection under 15 primary-clean), add it here.

11. **No motif-emblem traps (puzzles #1–100).** Until `primaryMotifs` exists, avoid filters whose answer set is dominated by emblem-only motifs:
    - `continent:South America,motif:animal` and its colour-compound variants (bo/ec/pe are all COA-only fauna)
    - Most `continent:Europe,motif:animal` filters (Albania is the only primary-visible animal)
    *Why:* `primaryColors` distinguishes "visible from across a room" colours from "only in the COA"; `motifs` has no equivalent. Peru's animal (vicuña inside its tiny COA) gets weighted the same as Sri Lanka's animal (the entire flag is a lion). Until that asymmetry is fixed in the data, hand-blocklist the emblem-only-dominant filters.

12. **Country-reuse cap.** No country appears in more than 5 puzzles across the full catalog (live + backlog). When hand-authoring, check the cumulative count.

13. **#1 is pinned.** `continent:Europe,motif:cross` stays at position #1. Regenerations don't touch it without a deliberate decision.

14. **Continent variety in onboarding.** At least 5 of the first 10 are Europe ("start mostly with Europe"); the rest spread across Asia / Africa / NA. Don't try to fit every continent into the first 10 — South America's primary-clean-and-not-small options are essentially zero, so it appears later.

## When data changes

The small-property list in rule 10 and the emblem-only list in rule 11 are derived from `flags/countries.json`. If you add countries, change `primaryColors`, or split a continent, the counts shift. Before relying on a rule, re-verify the current state with a quick query against the file. The hard rules (1–7) are always derived live by the test, so they self-correct.

## When a soft rule graduates to hard

E.g. we add `primaryMotifs` and rule 10 becomes a test. Update this SKILL.md AND the test in the same change.
