---
name: add-flag-grid-puzzle
description: Add the next daily Flag Grid puzzle in the gridgame repo — wire a new PUZZLE_N + ARCHIVE entry into flagGrid/puzzles.js, create flagGrid/N/index.html, and re-point every "Today" link (including the main-menu 3x3 tile in /index.html) to the new slug. Enforces the four daily-puzzle rules: no repeated (row × col) pair vs. any earlier puzzle, solvable against the real flags/countries.json, dated exactly one day after the previous puzzle, and mixes category families (not all colors, not all continents). Use when the user asks to "add today's flag grid", "wire game 4", "roll the next daily puzzle", "create tomorrow's grid", or invokes /add-flag-grid-puzzle.
---

You are operating as the **flag-grid daily-puzzle agent** for this turn and all following turns in the conversation. Drive the procedure below to completion.

## What this does

Adds a new daily Flag Grid puzzle to the gridgame repo. Each daily puzzle is **one folder + one PUZZLE_N export + one ARCHIVE entry + five "Today" link updates** (four burger-menu HTMLs inside `flagGrid/` plus the 3x3 game tile on the main menu in `/index.html`).

A previous run of this work missed the main-menu tile — `/index.html` still pointed at `flagGrid/2/` after Game 3 was wired. That mistake is the single most important thing this skill prevents: **the main-menu 3x3 tile must always land on today's puzzle**.

## The four rules a new puzzle MUST satisfy

Before wiring anything, verify the candidate puzzle against all four rules. If any fails, redesign before touching files.

1. **No repeated (rowCat × colCat) pair vs. any earlier ARCHIVE puzzle.** Each puzzle defines 9 cell signatures (each row category crossed with each column category — e.g. `continent:Africa|hasColor:red`). None of the new puzzle's 9 signatures may appear in any earlier puzzle, in either axis orientation (Africa-row × red-col collides with red-row × Africa-col).
2. **Solvable against the real `flags/countries.json`** — there must exist 9 distinct countries satisfying every cell. Verified by `findPuzzleSolution(puzzle, COUNTRIES)` returning non-null.
3. **Dated exactly one day after the previous ARCHIVE entry** (ISO `YYYY-MM-DD`).
4. **Mixes category families** — not all 6 categories may be colors, and not all 6 may be continents. Pure-color or pure-continent puzzles collapse the game into one dimension; we always combine at least two families (continent + color, continent + motif, color + motif, …).

All four rules are encoded in `flags/countries.test.js` via the `ARCHIVE` loop tests:
- `every ARCHIVE puzzle is solvable against the real countries.json`
- `every ARCHIVE puzzle mixes category families (not all colors, not all continents)`
- `ARCHIVE puzzles never repeat a (rowCat × colCat) pair across days`
- `ARCHIVE dates form a consecutive day-by-day sequence`

Two further tests in the same file enforce the rotation wiring — these are the safety net that catches the missed-link class of mistake at CI time:
- `the main-menu 3x3 game tile in /index.html points at the most recent ARCHIVE puzzle`
- `every flagGrid burger-menu "Today" link points at the most recent ARCHIVE puzzle`

`npm test` is the gate. If a new puzzle breaks any of those six tests, fix the wiring or redesign the puzzle — do not weaken the test.

## Procedure

### Step 1 — Read the current ARCHIVE

Read `flagGrid/puzzles.js`. Identify:
- the highest existing `PUZZLE_N`,
- its `date` in `ARCHIVE`,
- every (rowCat × colCat) signature already used across all entries.

The next puzzle will be `PUZZLE_{N+1}`, dated `date + 1 day`.

### Step 2 — Design the puzzle

Pick 3 row categories and 3 column categories from these factories in `flags/grid.js`:
- `continent('Europe' | 'Asia' | 'Africa' | 'North America' | 'South America' | 'Oceania')`
- `hasColor('red' | 'white' | 'blue' | 'green' | 'yellow' | 'black' | 'orange')`
- `hasMotif('animal' | 'coat-of-arms' | 'weapon' | 'star-or-moon')`

Constraints to apply while designing (mirror the four rules):
- Continents and statehoods carry an `exclusiveGroup` — never put two different continents on opposite axes (one on rows, one on cols). Same axis is fine. `axesConflict` enforces this.
- Pre-compute the 9 candidate pairs. Cross-check each against the union of all earlier ARCHIVE pairs. **Both orientations** count — `A|B` collides with `B|A`.
- The 6 chosen categories must not all be colors and must not all be continents.

### Step 3 — Verify before writing files

Open a Node REPL or write a small ad-hoc check that imports the candidate puzzle alongside the existing `ARCHIVE` and runs:
- `findPuzzleSolution(candidate, COUNTRIES)` — must be non-null.
- `puzzleMixesCategoryFamilies(candidate)` — must be true.
- For each earlier ARCHIVE puzzle, `sharedPuzzlePairs(earlier, candidate)` — must be `[]`.

If any check fails, swap one category and re-check. Do not proceed to file edits until all three pass.

### Step 4 — Edit `flagGrid/puzzles.js`

Append the new `PUZZLE_N` export immediately after the previous one, then append the matching `ARCHIVE` entry. Keep the format and ordering exactly as the existing entries — same indentation, same comment style, same `slug: 'N'` / `label: 'Game N'` shape.

### Step 5 — Create `flagGrid/N/index.html`

Copy `flagGrid/{N-1}/index.html` byte-for-byte, then change only:
- `<title data-i18n="grid.title{N-1}">Flag Grid — Game {N-1}</title>` → `grid.titleN` + `Game N`
- the `import { PUZZLE_{N-1} } from ...` line → `PUZZLE_N`
- `bootFlagGrid(() => PUZZLE_{N-1}, { stateKey: 'flaggrid.state.{N-1}', allowReplay: true });` → use `PUZZLE_N` and `flaggrid.state.N`

Add the i18n keys `grid.titleN` to whichever lang JSON files the project ships (look at how `grid.title3` / `grid.title2` are defined and match the pattern).

### Step 6 — Re-point every "Today" link to the new slug

This is the step the previous run missed. There are FIVE places, not four:

1. `index.html` (repo root) — the main-menu 3x3 game tile: `<a class="game-tile" href="flagGrid/N/">`. **This is the link a user actually clicks from the home page.** Miss it and "today's puzzle" silently keeps loading yesterday's grid.
2. `flagGrid/1/index.html` — burger menu "Today" link `../N/`
3. `flagGrid/2/index.html` — same, `../N/`
4. … through `flagGrid/N/index.html` — same, `../N/`
5. `flagGrid/archive/index.html` — same, `../N/`
6. `flagGrid/rand/index.html` — same, `../N/`

Use a Grep first to enumerate every `../{N-1}/` and `flagGrid/{N-1}/` reference, then update them all. Re-grep afterwards to confirm zero leftover references to `{N-1}`.

### Step 7 — Run the full validation gate

```
npm run validate
```

This runs `npm test` (which includes the six ARCHIVE-loop and link-wiring rule checks) and `npm run typecheck`. Every test must pass. If `ARCHIVE puzzles never repeat a (rowCat × colCat) pair across days` fails, your new puzzle reuses an old pair — return to step 2. If either of the two link-wiring tests fails, you missed a "Today" link in step 6.

### Step 8 — Sanity-check links manually

Grep for the previous slug to confirm nothing else points to it:

```
Grep pattern="(flagGrid/|\.\./){N-1}/" output_mode=content
```

Expect zero matches outside of the `flagGrid/{N-1}/` folder itself (its own files legitimately still reference its own slug for `stateKey` / `title` / `PUZZLE_{N-1}` import). Critically, expect zero matches in `index.html` and in the burger menus of folders 1..N-1, archive, rand.

## Files this skill touches

- `flagGrid/puzzles.js` — add `PUZZLE_N` and the `ARCHIVE` entry.
- `flagGrid/N/index.html` — new file, cloned from the previous game.
- `flagGrid/1/index.html` … `flagGrid/{N-1}/index.html` — burger menu "Today" link.
- `flagGrid/archive/index.html` — burger menu "Today" link.
- `flagGrid/rand/index.html` — burger menu "Today" link.
- `flagGrid/N/index.html` — its own burger menu "Today" link (self-referential, points at `../N/`).
- `index.html` — main-menu 3x3 game tile.
- i18n JSON (en + pl) — add `grid.titleN`.

## What this skill does NOT do

- It does not generate puzzles automatically. The designer (the user, working with you) picks the categories. The skill enforces the rules and wires the result.
- It does not redesign historical puzzles. If existing ARCHIVE entries violate the rules (because the rules were added later), surface that for the user — do not unilaterally rewrite.
- It does not open a PR. After the user confirms the wiring is correct, use the gridgame PR flow (GitHub: `gh pr create`).

## Why the WHY matters

Each rule earns its place:

- **Pair uniqueness** — a daily puzzle is supposed to feel fresh. Even one repeated cell (e.g. an "African flag with red") gives returning players a free answer and undermines the daily rhythm.
- **Solvability** — a daily puzzle with an unfillable cell is unshipable. The engine can detect it for free; we should always check before shipping.
- **Next-day** — the archive grid renders dates as a calendar trail. Skipping a day breaks the trail; doubling up confuses the "today" concept.
- **Family mix** — a pure-color or pure-continent puzzle is one-dimensional. The whole point of a 3×3 grid is the crossing of two different framings.
- **Main-menu tile** — burger-menu "Today" links matter, but the main-menu tile is what most users click. The bug this skill exists to prevent: updating the burger menus and forgetting the tile, leaving the home page silently routing to yesterday's puzzle for everyone who didn't open the burger.
