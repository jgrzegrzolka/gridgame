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

*(nothing in flight — pick the next feature from `## Backlog` or open a new one)*

---

## Backlog

### Feature DB: Stripes-only orientation tag

**Status:** unblocked (DA shipped 2026-06-13). Additive feature — opens new puzzle dimensions without fixing any existing problem.

**Goal:** new field `stripeOrientation: 'horizontal' | 'vertical' | null` on each country. Enables clean puzzles like "all European flags that are vertical tricolour" (France, Italy, Belgium, Ireland, ...) or "all European flags that are horizontal tricolour" (Germany, Russia, Bulgaria, Netherlands, Hungary, ...). Both are visually crisp categories players will read confidently.

**Open design call when this comes off the parking brake:**

- **Definition: pure tricolour only, or tricolour-with-emblem too?** Recommend starting pure-only (`null` for Mexico, Slovakia, Spain — they have stripes *and* a charge). Loosen later if the pure pool runs out of puzzle ideas.
- **Single-stripe flags** (e.g. Japan, Bangladesh — one stripe plus a disc). Probably also `null` — "stripe orientation" loses meaning at n=1.
- **Token name.** `stripeOrientation` for the field, but the filter DSL token can stay terse, e.g. `stripes:horizontal` / `stripes:vertical`.

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
