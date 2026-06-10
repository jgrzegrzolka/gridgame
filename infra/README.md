# `infra/`

Infrastructure-as-code for Azure resources that sit *outside* the Static Web App's managed Function App.

Right now there is exactly one template here, and it backs Feature D from `../FEATURE2.md`.

## Files

| File | Purpose |
|---|---|
| `logicapp-release-daily.bicep` | Logic App (Consumption) that POSTs `workflow_dispatch` to `release-daily.yml` at 00:05 Warsaw daily, replacing flaky GH cron. |

## Conventions

- **Single source of truth:** these `.bicep` files are authoritative. **Don't click-edit the deployed Logic App in the portal** — round-trip every change through the template and `az deployment group create`.
- **Names follow `yetanotherquiz-*`** to match the rest of the Azure-side naming (the `gridgame` name stays in code/pages/localStorage; Azure resources use the product framing).
- **No secrets committed.** Anything sensitive is a `@secure()` Bicep param, supplied at deploy time.

## Deploying `logicapp-release-daily.bicep`

Prerequisite: a GitHub fine-grained PAT scoped to `jgrzegrzolka/gridgame` with `Actions: write` (see `../FEATURE2.md` Phase D1 for mint steps).

```powershell
az deployment group create `
  -g rg-yetanotherquiz `
  -f infra/logicapp-release-daily.bicep `
  -p githubPat=<paste PAT>
```

What this creates / updates:

- `Microsoft.Logic/workflows` resource named `logic-yetanotherquiz-release-daily` in `rg-yetanotherquiz`, region inherited from the resource group (West Europe).
- Recurrence trigger at 00:05 Warsaw (`Central European Standard Time`, follows DST).
- HTTP action that POSTs to GitHub's `workflow_dispatch` endpoint for `release-daily.yml`.

Verify after deploy:

```powershell
az resource show -g rg-yetanotherquiz -n logic-yetanotherquiz-release-daily --resource-type Microsoft.Logic/workflows --query "properties.state"
# Expect: "Enabled"
```

## Quirk: Recurrence trigger fires on registration

When `az deployment group create` **creates** the Logic App (first deploy), the Recurrence trigger fires once immediately as part of registration, then settles into its 00:05 Warsaw schedule for subsequent runs. This is documented Logic Apps behaviour, not a bug.

In practice:

- **First deploy:** doubles as a free end-to-end smoke test — the HTTP action hits GitHub, `release-daily.yml` runs, the `already released today` guard catches it (because we're not actually at 00:05 Warsaw), workflow exits clean.
- **Future redeploys** (e.g. PAT rotation): one extra `workflow_dispatch` fires at redeploy time. The guard handles it. No action needed; just don't be surprised by the run in `gh run list`.
- **Pure update deploys** that don't recreate the resource (e.g. tag changes): do *not* trigger this — only resource creation does.

## Rotating the PAT

When the PAT expires (90 days; GitHub sends an email 7 days before), mint a new one with the same scope and redeploy with the new value — same `az deployment group create` command as above. The Logic App parameter is re-supplied; no other change.

## Disabling temporarily

Portal: open the Logic App → **Overview** → **Disable**. Stops future runs immediately. Re-enable the same way. This is the rollback knob from `../FEATURE2.md`.
