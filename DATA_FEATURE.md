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

### Feature DA: Ambiguity column for colour count

**Status:** in design. Field shape ↓ is the next decision to lock in before tagging.

**Trigger:** discovered while auditing the daily backlog. Puzzle **#53** (`continent:Asia,color:yellow,colorCount:3` → bt, mn) is currently a Bhutan trap — a player who counts Bhutan as 4 colours misses it; one who counts it as 3 finds it. With ~30 `colorCount`-based puzzles in the backlog and no way to flag this kind of case, we have no way to catch the rest short of eyeballing each one.

**Problem:** some flags have a colour count *or a colour membership* that a reasonable player can disagree about. Two flavours:

- **Count ambiguity.** Bhutan: 3 or 4 (does the white dragon outline count?). American Samoa: 4 to 7 (multiple shades of brown on the eagle, often collapsed into "brown" or split into "dark brown / light brown / tan").
- **Membership ambiguity.** Bhutan: does it "have white"? (the only white is the dragon outline). Vatican: gold or yellow? Sri Lanka: is the maroon panel border yellow / gold or just decorative?

When such a flag participates in a puzzle keyed on the ambiguous dimension — `Asia × colorCount:3` for Bhutan's count, `Asia × has-white` for Bhutan's membership — the answer rejection (or acceptance) reads as "the game is wrong" — exactly the kind of trust-loss the rule-5 / rule-6 enforcement was built to avoid for *other* failure modes, but with no equivalent for count/membership ambiguity today.

**Goal:** the puzzle generator never builds a combination where a flag in the answer-set scope is ambiguous on the dimension the puzzle keys on. The flag stays fully usable everywhere else (regional puzzles, motif puzzles, single-colour puzzles where the colour isn't its contested one); it's only excluded from the slice that would put a player in the disagreement zone.

**Likely shape:**

```jsonc
// in flags/countries.json, on the offending country:
{
  "code": "bt",
  "name": "Bhutan",
  "continent": "Asia",
  "primaryColors": ["yellow", "orange"],
  "additionalColors": ["red", "white"],
  "ambiguousColorCount": [3, 4],   // ← contested count; plausible answers a reasonable player might give
  "ambiguousColors": ["white"]      // ← contested membership; player look-time call could go either way
}
```

Semantics — two veto rules, same mechanism:

- A puzzle whose filter contains `colorCount:N` (exact or `>=N` / future `<=N`) is **invalid** if any country in its answer-set scope has `ambiguousColorCount` containing `N`.
- A puzzle whose filter contains `color:X` (include) or `color:!X` (exclude) is **invalid** if any country in its answer-set scope has `ambiguousColors` containing `X`.

Both checks apply to the candidate generator (`scripts/generate-candidates.mjs` rejects such filters before they reach `daily_ideas.json`) and to a new catalog validation rule that fires `npm test`.

Existing puzzles that violate the new rule:

- **#53** — Asia + yellow + colorCount:3 contains Bhutan (Bhutan's count range includes 3). Needs replacement / rework.

(Will surface more — including any `color:white` puzzles that include Bhutan — by running the audit script once the fields are tagged. That's step 2.)

**Open design calls (settle before tagging):**

Marker key: ✓ = settled with Jan, ◯ = still open (proposed leaning shown; needs Jan's confirm before phase 1).

1. ◯ **Field shape — list-of-plausible-counts or boolean?** Leaning list, e.g. `ambiguousColorCount: [3, 4]`. A boolean (`colorCountAmbiguous: true`) would over-veto — Bhutan's range is `[3, 4]` so it should *only* taint Asia×3 and Asia×4, not Asia×5 or Asia×6. The list is barely more authoring work and gives precise vetoes.
2. ◯ **Field name.** `ambiguousColorCount` reads natural ("Bhutan's ambiguous colour count is 3 or 4"). Alternative: `colorCountRange` — but "range" implies the player's answer is somewhere in there, which isn't quite right (the player picks one answer and we don't know which). Going with `ambiguousColorCount`.
3. ◯ **Initial tag list.** Definitely Bhutan `[3, 4]` + `["white"]` and American Samoa `[4, 5, 6, 7]`. Probably also worth a pass on: Vatican (gold-vs-yellow, but its yellow is canonical), Sri Lanka (gold border on the maroon panel — does it count?), Mexico/Guatemala/Ecuador (eagle plumage colours). Tagging conservatively at first is safer than over-tagging; we can extend once the audit script reveals which ones actually appear in count- or membership-based puzzles.
4. ◯ **Audit script — npm script, test, or both?** Leaning **both**: a `node scripts/audit-flag-ambiguity.mjs` for ad-hoc author checks (with a nicer report) AND a hard rule in `flags/daily.test.js` so a future authored puzzle can't slip past `npm test`. The script is the human-friendly surface; the test is the guarantee.
5. ◯ **Generator behaviour.** When a candidate combination is vetoed, the generator should **silently skip it and try another template** (same as today's rule-6 enforcement) — *not* attempt to "rescue" the combination by adding more filters. Compounding to escape an ambiguity ban is exactly the kind of contrived-set behaviour rule 10 is meant to prevent.
6. ✓ **Scope** *(settled 2026-06-12)*. Phase 1 covers two dimensions: `colorCount:N` (via `ambiguousColorCount`) and `color:X` membership (via `ambiguousColors`). Both use the same veto pattern; tagging one flag for both fields is fine and common (Bhutan needs both). **Does not** cover motifs in phase 1 — even though e.g. Albania's eagle (is it a coat-of-arms or just an animal?) or Mexico's emblem are borderline at look-time, motif data is already a defensible classification in `countries.json` and the player-disagreement frequency there feels lower than for colours. If empirical evidence shows otherwise once the color side ships, a parallel `ambiguousMotifs: ['coat-of-arms']` field would slot in cleanly using the exact same veto mechanism. Defer, don't bend.

**Next step for a fresh agent picking this up:** confirm the ◯ calls #1–#5 with Jan (the proposed leanings are defaults, not decisions). Once all 6 are ✓, start phase 1 — that's data-only changes to `countries.json`, no code yet.

**Phases:**

1. **Tag the data.** Add both fields to the seed flags in `countries.json`:
   - Bhutan: `ambiguousColorCount: [3, 4]`, `ambiguousColors: ["white"]` (dragon outline)
   - American Samoa: `ambiguousColorCount: [4, 5, 6, 7]` (no membership ambiguity worth tagging yet — the multi-brown question is purely a count thing)
   - No code changes yet. One PR.
2. **Audit script + hard rule.** Write `scripts/audit-flag-ambiguity.mjs` and a matching test in `flags/daily.test.js` that fires on live + backlog + ideas. The script reports both kinds of violation (count and membership) in one report. Run it; surface every offending puzzle. One PR (or split into "script first, then test" if the audit reveals a lot to fix).
3. **Fix the offenders.** Replace / rework each flagged puzzle in the backlog. Live entries are frozen (rule 1's drift detector) — if #53 had already gone live we'd be stuck with it, but it's still in the backlog so we can edit in place. One PR per batch.
4. **Wire into the generator.** Add both vetoes to `scripts/generate-candidates.mjs` so any future batch automatically respects the new constraints. One PR.
5. **Update the skill.** Once the script is live, the daily-puzzle-author skill should reference it: "before authoring a new puzzle, run `node scripts/audit-flag-ambiguity.mjs`." Update `SKILL.md` with a one-liner and a sentence about the field shape.
6. **(Deferred) Motif ambiguity.** If empirical complaints arrive after color-side ships, add `ambiguousMotifs` using the same mechanism. Not in this feature; track as a follow-up.

**Why this matters:**

The whole rule-5 / rule-6 framing in `SKILL.md` is built around "the first 100 puzzles are where players build trust; surprises here are uniquely expensive." Count ambiguity is a surprise of exactly that flavour — same shape as a primary-clean violation, different mechanism. Catching it before puzzle-#53 ships costs one data field; catching it after costs a frustrated player and a retroactive can't-edit-because-frozen problem.

---

## Backlog

### Feature DB: Stripes-only orientation tag

**Status:** parked until DA ships. Additive feature — opens new puzzle dimensions without fixing any existing problem.

**Goal:** new field `stripeOrientation: 'horizontal' | 'vertical' | null` on each country. Enables clean puzzles like "all European flags that are vertical tricolour" (France, Italy, Belgium, Ireland, ...) or "all European flags that are horizontal tricolour" (Germany, Russia, Bulgaria, Netherlands, Hungary, ...). Both are visually crisp categories players will read confidently.

**Open design call when this comes off the parking brake:**

- **Definition: pure tricolour only, or tricolour-with-emblem too?** Recommend starting pure-only (`null` for Mexico, Slovakia, Spain — they have stripes *and* a charge). Loosen later if the pure pool runs out of puzzle ideas.
- **Single-stripe flags** (e.g. Japan, Bangladesh — one stripe plus a disc). Probably also `null` — "stripe orientation" loses meaning at n=1.
- **Token name.** `stripeOrientation` for the field, but the filter DSL token can stay terse, e.g. `stripes:horizontal` / `stripes:vertical`.

**Why parked:** DA's audit win is bigger (catches a Bhutan trap already in the backlog at #53). DB is purely additive — every day it's not shipped is a day we *could've* had new puzzle dimensions, but no existing puzzle is broken by its absence. Order is DA → DB, not parallel.
