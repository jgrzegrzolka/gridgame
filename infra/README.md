# `infra/`

Infrastructure-as-code for Azure resources that sit *outside* the Static Web App's managed Function App.

## Files

| File | Purpose |
|---|---|
| `dailyLeaderboards-index-policy.json` | Cosmos container index policy applied at create time (Feature K). |
| `edge-proxy/` | Cloudflare Worker that proxies www to the raw SWA hostname (mitigates the custom-domain edge flap — Feature D 2026-06-11). |
| `operations.md` | Live-system reference: resource inventory, secrets, recurring symptoms + runbook. Read this when something looks wrong in prod. |
| `release-incidents.md` | Time-ordered journal of release-path failures. Closed when Feature R demolished the scheduler (2026-06-17); kept for the lessons. |

## Conventions

- **Single source of truth:** Bicep files (where present) are authoritative. **Don't click-edit deployed resources in the portal** — round-trip every change through the template and `az deployment group create`.
- **Names follow `yetanotherquiz-*`** to match the rest of the Azure-side naming (the `gridgame` name stays in code/pages/localStorage; Azure resources use the product framing).
- **No secrets committed.** Anything sensitive is a `@secure()` Bicep param or a managed identity.

## Daily-puzzle release model

There is no release scheduler. Each puzzle in `puzzles.json` carries a `date` field; the daily page filters `entries.filter(p => p.date <= warsawToday())` on every load, so a puzzle becomes player-visible at Warsaw midnight on its `date` without anything firing. Authoring goes through `authoring/push.mjs` (which uploads the dated catalog to the `styetanotherquiz` blob); the only operational responsibility is keeping the schedule populated a few days ahead.

This replaced three previous scheduler attempts (GitHub Actions cron → Azure Logic App → standalone Function App) — all three failed independently within a week, motivating Feature R's structural shift to "time is data, not a trigger" (see FEATURE.md Feature R for the full story).
