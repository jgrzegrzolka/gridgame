# `authoring/`

Agent territory. Everything in this directory is tooling that the agent runs on Jan's behalf when he asks for daily-puzzle catalog work — adding entries, refilling the backlog, generating ideas, auditing flag ambiguity, etc. **None of it is part of the player-facing site or the build pipeline.**

The boundary exists so it's obvious what's prod (player-facing or load-bearing for deploy) vs. what's an agent's hammer. If you're touching files in `daily/`, `flags/`, `api/`, `infra/`, or `scripts/`, that's production code; if you're touching files here, that's an agent operation against the catalog.

## Files

| File | Purpose |
|---|---|
| `pull.mjs` | Download all 5 catalog blobs into `.catalog/` (gitignored) + take a snapshot for conflict detection. Anonymous read — no auth needed. |
| `push.mjs` | Validate `.catalog/` against the hard rules (`flags/dailyValidate.js`), detect remote drift since the last pull, diff + prompt for `live` / `backlog` changes, upload via `az storage account keys list` for auth. |
| `generate-candidates.mjs` | Brainstorm new puzzle candidates and append them to `.catalog/ideas.json` for review on `/daily/ideas/`. |
| `audit-ambiguity.mjs` | Scan live + backlog + ideas for flag-data ambiguity violations (rule 15). Exits non-zero on any hit; safe in CI. |
| `lib/catalog.mjs` | Shared constants + helpers (blob URLs, file list, snapshot paths). |

## How the agent uses these

The daily-puzzle-author skill (`.claude/skills/daily-puzzle-author/SKILL.md`) describes the workflow the agent follows for each kind of author request — what trigger phrases mean, what the canonical pull → edit → test → push loop looks like, how to handle conflicts. These scripts are the agent's primitives; the skill is the procedure.

Jan does not run these directly. If you find yourself typing `node authoring/push.mjs`, that's a sign the agent isn't doing its job — ask the agent to do the operation instead so the test gate + diff review + conflict detection all run inline as one step.
