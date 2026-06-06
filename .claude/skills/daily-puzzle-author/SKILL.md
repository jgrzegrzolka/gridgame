---
name: daily-puzzle-author
description: Adds or vets entries in the gridgame daily-puzzle catalog (daily/daily_puzzles.json and daily/daily_backlog.json). Use when authoring a new puzzle, refilling the backlog, releasing the next backlog entry to live, or reviewing whether a proposed filter would make a good puzzle. Carries the 13 rules (5 hard / 8 soft) that the catalog and tests enforce — primary-clean colours, small-property compounds, no-subset, etc. Pulls from flags/countries.json so changes to country data don't require re-deriving the rules.
---

# Daily-puzzle author

The daily catalog is two append-only JSON files:

- `daily/daily_puzzles.json` — released puzzles, visible to players. "Today's puzzle" = last entry.
- `daily/daily_backlog.json` — staged, hidden. Releasing = move `backlog[0]` to the end of live.

Each entry is `{ "n": <int>, "filter": "<filterString>", "answers": ["<code>", ...] }`. Numbering is sequential across the two files (live ends at N → backlog starts at N+1).

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

6. **No strict-subset puzzles (puzzles #1–100).** *(no-subset test)* For any two puzzles in #1–100, neither's answer set may be a strict subset of the other's. *Why:* the player who already met the superset has seen every answer in the subset, so the subset puzzle isn't "find all the X" — it's "remember which of those are also Y". Past #100 allowed as a deliberate recall mechanic.

### Soft (hand-check)

7. **`nameScore` cap by N.**
   - #1–5: every answer `nameScore ≤ 3`
   - #6–50: every answer `nameScore ≤ 5`
   - #51–100: every answer `nameScore ≤ 6`
   - Past #100: any
   *Why soft:* a few generous puzzles deserve an exception (e.g. a famous-country-only puzzle that includes one nm=4 country).

8. **Answer-set size by N.**
   - #1–50: 2–25 flags
   - Past #50: 1–25 flags
   - 1-flag puzzles allowed only past #50.

9. **No small-property compounds (puzzles #1–100).** If any filter property has under 15 sovereign matches under `primaryColors`, use it solo. Current small properties:
   - `motif:weapon` — 13
   - `continent:South America` — 12
   - `continent:Oceania` — 14
   - `color:orange` — 10
   *Why:* compounding produces tiny, contrived sets ("Africa, weapon, yellow" = "the African weapon flags that happen to also be yellow") — not a category the player would recognise. "Solo" means worldwide without continent/colour/other-motif. These solo puzzles tend to need higher nameScore caps and live later in onboarding.

   *Verify before adding:* run a quick check against `flags/countries.json` — these counts shift when sovereign data changes.

10. **No motif-emblem traps (puzzles #1–100).** Until `primaryMotifs` exists, avoid filters whose answer set is dominated by emblem-only motifs:
    - `continent:South America,motif:animal` and its colour-compound variants (bo/ec/pe are all COA-only fauna)
    - Most `continent:Europe,motif:animal` filters (Albania is the only primary-visible animal)
    *Why:* `primaryColors` distinguishes "visible from across a room" colours from "only in the COA"; `motifs` has no equivalent. Peru's animal (vicuña inside its tiny COA) gets weighted the same as Sri Lanka's animal (the entire flag is a lion). Until that asymmetry is fixed in the data, hand-blocklist the emblem-only-dominant filters.

11. **Country-reuse cap.** No country appears in more than 5 puzzles across the full catalog (live + backlog). When hand-authoring, check the cumulative count.

12. **#1 is pinned.** `continent:Europe,motif:cross` stays at position #1. Regenerations don't touch it without a deliberate decision.

13. **Continent variety in onboarding.** At least 5 of the first 10 are Europe ("start mostly with Europe"); the rest spread across Asia / Africa / NA. Don't try to fit every continent into the first 10 — South America's primary-clean-and-not-small options are essentially zero, so it appears later.

## When data changes

The small-property list in rule 8 and the emblem-only list in rule 9 are derived from `flags/countries.json`. If you add countries, change `primaryColors`, or split a continent, the counts shift. Before relying on a rule, re-verify the current state with a quick query against the file. The hard rules (1–5) are always derived live by the test, so they self-correct.

## When a soft rule graduates to hard

E.g. we add `primaryMotifs` and rule 9 becomes a test. Update this SKILL.md AND the test in the same change.
