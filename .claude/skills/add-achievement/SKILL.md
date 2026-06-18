---
name: add-achievement
description: Reference for adding a new achievement rule to the gridgame catalog — the predicate / name / description / hint / icon pieces and where each lives, the stable-id rule that protects already-released badges, when a new snapshot field needs server-side compute work, and the test-pinning that every rule must pass. Use when Jan asks to add an achievement, design a tier, or change one — anything that touches `flags/achievements.js`. Architecture rationale (compute-on-read vs denorm, the snapshot contract) lives in `flags/ACHIEVEMENTS.md`; this skill is the recipe.
---

# Adding an achievement

Each rule is `{ id, predicate, name, description, hint, icon }` in `flags/achievements.js`. Five steps below — none are optional.

## 1. Pick a stable id

Lowercase kebab-case, unique across all tiers. **Never rename a released id.** Players who already earned a badge have its id baked into their derived state (and, when we eventually denorm, into Cosmos). Renaming orphans the badge for them.

Look at the existing pattern: `first-daily`, `daily-habit`, `two-weeks-strong`, `monthly-devotee`, `clean-sweep`, `ten-clean-sweeps`, `hundred-clean-sweeps`, `empty-slate`.

## 2. Write the predicate

```js
predicate: (s) => num(s.someField) >= threshold,
```

The snapshot shape is the contract — only fields documented in the `Snapshot` typedef at the top of `flags/achievements.js` are available. If your rule needs a new counter, **stop and go to step 3a first** — you need server-side work.

Always coerce via `num(s.field)` (defined at the bottom of the file) so a missing / non-numeric field collapses to 0 instead of throwing. Test 80 in `flags/achievements.test.js` enforces this defensively.

## 3. Wire the data (only if a new snapshot field is needed)

Skip this if you're hitting an existing field (`currentStreak`, `maxStreak`, `totalCompleted`, `totalPlayed`, `winPercent`, `cleanSweeps`, `zeroScoreFinishes`).

3a. **Server compute.** Pick the right library:
- Streak-shape data (consecutive days, totals, win %) → `api/src/lib/streakCompute.js`.
- Per-submission aggregates (counts of finishes matching a predicate) → `api/src/lib/masteryCompute.js`.
- A new dimension entirely (e.g. TTT, quizRecords) → new `*Compute.js` file under `api/src/lib/`, plus a matching query in `api/src/functions/dailyMe.js` (or a new endpoint if the data lives elsewhere).

3b. **Snapshot typedef.** Add the field to the `Snapshot` typedef in `flags/achievements.js` so future authors see it.

3c. **Client fetch defensiveness.** Add the field to `daily/streakClient.js`'s `toInt` defensive map so a stale server can't surface NaN.

3d. **Tests for the compute.** Add tests to the matching `*Compute.test.js`.

## 4. Name / description / hint

Three player-facing strings — short, no jargon.

- `name` — 1-3 words, displayed on the tile and the celebration card. Examples: `First Daily`, `Clean Sweep`, `Hundred Clean Sweeps`.
- `description` — what the player did. Shown on the celebration card AND the info dialog (earned state). Past tense. Example: `Finished a hundred daily puzzles 100%.`
- `hint` — what to do to earn it. Shown on the info dialog (locked state). Imperative. Example: `Get a clean sweep on a hundred daily puzzles.`

EN only today. The `description: { en, pl }` shape will arrive when PL polish lands; the typedef will change at that point.

## 5. Icon

Pixel-art SVG, 16×16 viewBox (or 16×24 if the icon needs a label below — see `ICON_BRUSH_X10`), `fill="currentColor"` so the palette flows from the parent (`--secondary-color` when earned, `--muted-color` when locked).

Inline string. The test at line 105 of `flags/achievements.test.js` smoke-checks every icon: starts with `<svg `, includes `currentColor`, ends with `</svg>`. Promote shared shapes (like the brush body in `BRUSH_SHAPES`) when you're building a tier — avoid copy-paste.

Existing palette: `ICON_CHECKMARK`, `ICON_STAR`, `ICON_BRUSH` family, `gridIcon(n)` for the 4×4-filled streak tier.

## 6. Pick the tier (STREAK or MASTERY)

Append to either `STREAK_ACHIEVEMENTS` or `MASTERY_ACHIEVEMENTS`. Declare from easiest to hardest within the tier — declaration order is rendering order on the profile tile grid AND playback order in the cascade celebration. The test at line 121 of `flags/achievements.test.js` pins the declaration order through `ALL_ACHIEVEMENTS`.

## 7. Tests

Add at least:

```js
test('your-id fires at <field> >= <threshold>', () => {
  const rule = ruleById('your-id');
  assert.equal(rule.predicate({ field: threshold - 1 }), false);
  assert.equal(rule.predicate({ field: threshold }), true);
});
```

If your rule reads multiple fields, add a cross-contamination test (see `mastery rules do NOT cross-contaminate`) so a future copy-paste rename can't silently wire the predicate to the wrong counter.

For a new snapshot field, also add a hygiene case to the `evaluateAchievements with a full snapshot earns every badge` test — bump the field value so the "all earned" baseline still passes.

## 8. Run `npm run validate`

Tests + typecheck together. **Don't open the PR if either fails.**

## Things that go wrong

- **Forgot the snapshot field.** Predicate reads `undefined` → `num()` → 0 → never fires. Tests pass (because the field defaults to 0) but no one ever earns it. Catch by setting the field to the threshold in a test and asserting `earned: true`.
- **Reused an id.** The unique-id test (line 100) fails. Easy catch — change the id.
- **Forgot the icon's currentColor.** Tile/card renders the icon in black instead of the tier colour. The icon hygiene test (line 105) catches this.
- **Wrong tier.** A "Clean Sweep ×10" landing in `STREAK_ACHIEVEMENTS` instead of `MASTERY_ACHIEVEMENTS` mis-orders the grid and gives a confused profile-page UX. No test catches it — rely on declaration-order judgment.

## See also

- `flags/ACHIEVEMENTS.md` — architecture (compute-on-read, the snapshot contract, when to denorm).
- `flags/achievements.js` — rule library + diff helper.
- `flags/achievements.test.js` — every test you'll need to mirror.
- `api/src/lib/masteryCompute.js`, `streakCompute.js` — server-side compute libraries (where to add a new counter).
- FEATURE.md Feature O — original design notes (rule ideas, naming patterns, tiered-vs-binary discussion).
