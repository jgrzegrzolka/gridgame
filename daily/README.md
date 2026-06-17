# `daily/`

The daily-puzzle feature: one new flag puzzle every Polish midnight, drawn from a hand-curated dated catalog. This folder holds the player-facing pages, two author-only preview pages, and the per-day persistence + stats glue. **No catalog data is in this folder** — the catalog lives in an Azure blob.

## File-on-blob, not file-in-repo

The four catalog JSON files live at `https://styetanotherquiz.blob.core.windows.net/catalog/`:

| Blob | Role | Who writes |
|---|---|---|
| `puzzles.json` | Every puzzle past, present, and future — each with its own `date`. "Today's puzzle" = the highest-dated entry with `date <= warsawToday()`. Single source of truth (Feature R). | Agent skill on author requests. |
| `ideas.json` | Generator output + brainstorm pipeline reviewed on `/daily/ideas/`. | Agent skill (via `authoring/generate-candidates.mjs` + edits). |
| `parked.json` | Filters that don't fit current rules but worth keeping. | Agent skill. |
| `policy.json` | Single-use token policy (catalog rule 14). | Agent skill. |

All blobs are public-read (no auth needed to fetch), `Cache-Control: max-age=60`, blob versioning ON. Writes go through the agent skill (`authoring/push.mjs` using a storage account key fetched on demand via `az`).

## Runtime flow — how players see a puzzle

```
Player loads /daily/   ─►  daily/page.js → fetchCatalog('puzzles')
                           │
                           │  GET https://styetanotherquiz.blob.core.windows.net/catalog/puzzles.json
                           │      Cache-Control: max-age=60
                           │
                           │  visiblePuzzles(allEntries, warsawToday())
                           │    → entries with date <= today
                           │
                           ▼
                       renders the highest-dated entry as "Today's puzzle"
```

There is no scheduler. The page does the filter on every load, so a puzzle becomes player-visible at Warsaw midnight on its `date` without anything firing. `<link rel="preload">` in `daily/index.html` kicks off the blob fetch in parallel with the JS bundle, so first paint doesn't wait on a serial roundtrip.

Player play → submit hits `api/v1/daily/result` (SWA-managed Function, Cosmos write). The server rejects submissions for puzzleIds whose Warsaw release date hasn't arrived yet, closing the "curl the blob, submit tomorrow's result early" attack that the public-read dated catalog opened up.

## Player-facing surface

| File | Role |
|---|---|
| `index.html` + `page.js` | Today's puzzle play surface. Streak, share, finish flow. |
| `archive.html` + `archive.js` | Archive grid of past puzzles. Scores per tile from `daily.scores` localStorage. |
| `catalogSource.js` | One-liner shim: `fetchCatalog(name)` returns blob URL + JSON. Same code path in prod and local dev. |
| `playFlow.js`, `finishFlow.js` | Shared game-state machine + result panel. Also used by the author preview pages below. |
| `scores.js`, `submitted.js`, `streakClient.js` | Per-player persistence (localStorage + Cosmos round-trip for stats). |
| `statsClient.js`, `statsOverlay.js`, `statsSubmit.js`, `extraStats.js`, `squares.js` | Community-stats fetch + render + submit. |
| `turnstileClient.js`, `turnstileSiteKey.js` | Cloudflare Turnstile widget — currently soft-disabled (see CLAUDE.md). |
| `devReset.js` | Yellow toolbar that appears on `localhost` only — wipes localStorage / clears local Cosmos rows. |
| `difficulty.js` | Author-facing difficulty score; informs scheduling order. |

## Author preview pages (stripped from prod)

`daily/backlog/` and `daily/ideas/` are two hidden HTML+JS pages for play-testing **future** puzzles before they ship.

- `/daily/backlog/` — grid of future-dated entries from `puzzles.json` (filter `date > warsawToday()`), click to play-test any of them. URL kept as "backlog" for stability; the page is now a "what's coming next" preview.
- `/daily/ideas/` — generator-output review surface; reject / approve / promote to `puzzles.json`.

Both read from blob like the live page does. They're served by `npm run dev:swa` at `http://localhost:4280/daily/backlog/` and `/daily/ideas/`. **`deploy.yml` strips both folders from the production artifact**, so `https://www.yetanotherquiz.com/daily/backlog/` returns 404. Author-eyes-only by construction.

## Authoring flow

You don't run authoring scripts directly. The daily-puzzle-author skill (`.claude/skills/daily-puzzle-author/SKILL.md`) owns the loop. Ask the agent something like:

- "Add a puzzle for `motif:cross + color:green`."
- "Generate 30 candidate ideas."
- "Promote ideas #5 and #8."
- "What's currently scheduled / in ideas / parked?"

The agent pulls blobs into `.catalog/` (gitignored), edits, runs `npm test` against the 15 rules (9 hard / 6 soft), shows you a diff for any change to `puzzles.json`, asks for confirmation, then uploads. Detects "another agent session wrote since the last pull" as a conflict and refuses to clobber.

Primitives live in `authoring/` (also see `authoring/README.md`):

| File | Job |
|---|---|
| `authoring/pull.mjs` | Download all 4 blobs to `.catalog/` + snapshot for conflict detection. |
| `authoring/push.mjs` | Validate + diff + prompt + upload. |
| `authoring/generate-candidates.mjs` | Brainstorm new ideas, append to `.catalog/ideas.json`. |
| `authoring/audit-ambiguity.mjs` | Surface flag-data ambiguity violations (rule 15) in plain-English form. |

## Runtime + auth boundaries

| Layer | Identity | Why |
|---|---|---|
| Page load → blob read | Anonymous | Catalog is public; CORS allows the prod + localhost origins. |
| Agent push → blob write | Storage account key fetched on demand via `az` | Lets the agent run from any machine Jan is logged into. No long-lived RBAC role for the author. |

## See also

- `infra/operations.md` — full resource inventory + topology + runbook.
- `.claude/skills/daily-puzzle-author/SKILL.md` — the 15 catalog rules + agent workflow.
- `FEATURE.md` Feature R — narrative of how the "time is data, not a trigger" architecture came to be (three failed schedulers → dated catalog + client filter).
