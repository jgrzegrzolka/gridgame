# Flag Grid Game — design notes

## What this is

A 3x3 grid puzzle. Each row and each column has a category. To solve cell
`(r, c)` the player picks a country that satisfies BOTH `rows[r]` and
`cols[c]`. Example shape (the categories are illustrative — not what's
implemented today):

|                          | Has only 2 colours | Has red and white | Has at least 3 colours |
| ------------------------ | ------------------ | ----------------- | ---------------------- |
| **In Europe**            |                    |                   |                        |
| **Population > 50M**     |                    |                   |                        |
| **Flag has a weapon**    |                    |                   |                        |

The same country can be used at most once. The player types a country
name into the cell, an autocomplete dropdown helps them pick, and the
game highlights cells as correct / wrong / duplicate as they fill in.

## Status

- **Engine**: `flags/grid.js` — `validateCell`, `solutionState`, the
  `Category` / `Puzzle` / `SolutionState` types, and a starter set of
  category factories (`continent`, `statehood`, `nameStartsWith`).
- **Tests**: `flags/grid.test.js` — covers predicate behaviour,
  cell validation, empty/partial/full solutions, and duplicate
  detection.
- **Categories available today**: continent, statehood,
  nameStartsWith. These are the only fields on `Country` in
  `flags/countries.json`, so the playable surface is thin until we
  enrich the data.
- **UI**: minimal v0 at `flagGrid/index.html` — 3x3 grid with column
  headers, clickable cells, autocomplete picker (`<dialog>` + prefix
  search over country names), live cell validation with colour
  feedback (green = valid, red = invalid, amber = duplicate), and a
  "Solved!" status when all 9 cells are filled, valid, and distinct.
  The active puzzle is `continent(Europe/Asia/Africa)` x
  `nameStartsWith(A/B/C)` — every cell is solvable; the game aspect
  is mild until richer categories land.
- **Menu integration**: linked from the home menu (`/index.html`).

## What to build next

### Data: enrich `flags/countries.json`

The engine is only as fun as the categories we can express. Each new
field unlocks a family of categories:

- `flagColors: string[]` — dominant flag colours, e.g.
  `["red", "white", "blue"]`. Unlocks `hasColor`, `onlyColors`,
  `hasAtLeastNColors`, `hasExactlyNColors`.
- `flagMotifs: string[]` — visual elements, e.g.
  `["weapon", "star", "cross", "crescent", "sun", "animal"]`. Unlocks
  `hasMotif("weapon")` etc.
- `population: number` — unlocks `populationAtLeast(n)`, `populationAtMost(n)`.

Curating these by hand for ~250 countries is the bulk of the work. Open
question whether to (a) hand-curate, (b) auto-extract colours from the
SVGs in `flags/svg/` and review by hand, or (c) start with a subset of
~50 well-known countries and grow the dataset over time.

### Category factories

Once the data lands, add factories alongside `continent` /
`statehood`:

```js
hasColor(color)
onlyColors(...colors)
hasAtLeastNColors(n)
hasMotif(motif)
populationAtLeast(n)
populationAtMost(n)
```

### Contradiction detection

When generating or accepting a puzzle, reject category pairs that
no country can satisfy. Examples:

- `onlyColors("red", "white")` AND `hasAtLeastNColors(3)` — impossible.
- `hasMotif("weapon")` AND a very narrow colour constraint may
  produce an empty cell.

Implementation sketch: for each cell `(rowCat, colCat)`, compute
`countries.filter(rowCat.predicate).filter(colCat.predicate)`. If the
result is empty, the puzzle is contradictory at that cell. Reject the
puzzle (during generation) or warn (during validation).

### Puzzle generation

Pick row and column categories so that every cell has at least one
candidate country AND a full distinct-country solution exists.
Brute-force search over a category pool is fine for v0:

1. Pick three row categories.
2. Pick three column categories.
3. For each cell, list candidates.
4. Try to assign one distinct country per cell (bipartite matching).
5. If no assignment exists, retry with a different set.

### UI: `flagGrid/index.html`

- 3x3 visual grid, row and column headers showing category labels.
- Each cell is clickable; clicking opens a text input with country-name
  autocomplete (driven by `flags/countries.json`).
- On commit, the cell shows the chosen country's flag and is coloured
  based on `CellState`: correct (green), wrong (red), duplicate
  (amber).
- A "Done" or "Reveal" button confirms the final solution.
- Back button (top-right corner pattern from the rest of the project)
  returning to the home menu.

### Menu integration

`/index.html` currently lists `All flags` and `Flag Quiz`. Add a
`Flag Grid` entry here once `/flagGrid/index.html` exists.
