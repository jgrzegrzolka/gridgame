# `infra/`

Infrastructure-as-code for Azure resources that sit *outside* the Static Web App's managed Function App.

## Files

| File | Purpose |
|---|---|
| `funcapp-release-daily.bicep` | Standalone Function App (`func-yetanotherquiz-release`, Linux Consumption Y1, Node 22) that owns midnight puzzle promotion. Replaces the GitHub Actions release workflow + Logic App pair retired in Feature P Phase 2. |
| `release-fn/` | Source for the Function App above. Bundled into a deployable zip by `scripts/build-release-fn.mjs` (esbuild). |
| `dailyLeaderboards-index-policy.json` | Cosmos container index policy applied at create time (Feature K). |
| `edge-proxy/` | Cloudflare Worker that proxies www to the raw SWA hostname (mitigates the custom-domain edge flap — Feature D 2026-06-11). |
| `operations.md` | Live-system reference: resource inventory, secrets, recurring symptoms + runbook. Read this when something looks wrong in prod. |

## Conventions

- **Single source of truth:** these `.bicep` files are authoritative. **Don't click-edit deployed resources in the portal** — round-trip every change through the template and `az deployment group create`.
- **Names follow `yetanotherquiz-*`** to match the rest of the Azure-side naming (the `gridgame` name stays in code/pages/localStorage; Azure resources use the product framing).
- **No secrets committed.** Anything sensitive is a `@secure()` Bicep param or a managed identity.

## Deploying `funcapp-release-daily.bicep`

Provisions the Function App, Consumption plan, App Insights, runtime storage, and the role assignment that gives the Function's managed identity `Storage Blob Data Contributor` on `styetanotherquiz`.

```powershell
az deployment group create `
  -g rg-yetanotherquiz `
  -f infra/funcapp-release-daily.bicep
```

To ship code changes after a `src/` edit:

```powershell
node scripts/build-release-fn.mjs
# zip the dist/ folder, forward slashes inside (PowerShell's Compress-Archive
# uses backslashes which break on Linux Consumption) — use Python:
python -c "import os,zipfile; src='infra/release-fn/dist'; out='infra/release-fn/release-fn.zip'; z=zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED); [z.write(os.path.join(r,f), os.path.relpath(os.path.join(r,f), src).replace(os.sep,'/')) for r,_,fs in os.walk(src) for f in fs]; z.close()"
az functionapp deployment source config-zip `
  -g rg-yetanotherquiz `
  -n func-yetanotherquiz-release `
  --src infra/release-fn/release-fn.zip
```

After upload, the Function App needs ~30–60s to re-index. Verify with:

```powershell
$key = az functionapp keys list -g rg-yetanotherquiz -n func-yetanotherquiz-release --query masterKey -o tsv
curl -H "x-functions-key: $key" https://func-yetanotherquiz-release.azurewebsites.net/admin/functions
# Expect: a JSON array with one entry named "releaseDaily" and schedule "0 5 22,23 * * *"
```

## Manual invocation (smoke test)

To run the promotion immediately without waiting for the cron — useful when verifying a code change. **The handler will short-circuit if Warsaw isn't midnight or today's puzzle is already in `live`**, so a midday invocation returns without mutating blob:

```powershell
$key = az functionapp keys list -g rg-yetanotherquiz -n func-yetanotherquiz-release --query masterKey -o tsv
curl -X POST -H "x-functions-key: $key" -H "Content-Type: application/json" -d '{}' `
  https://func-yetanotherquiz-release.azurewebsites.net/admin/functions/releaseDaily
```

To actually exercise the promote path mid-day, snapshot live + backlog blobs first, then re-upload them after the test:

```powershell
curl -o live.bak.json  https://styetanotherquiz.blob.core.windows.net/catalog/live.json
curl -o bl.bak.json    https://styetanotherquiz.blob.core.windows.net/catalog/backlog.json
# ...invoke and verify...
$key2 = az storage account keys list -n styetanotherquiz -g rg-yetanotherquiz --query "[0].value" -o tsv
az storage blob upload --account-name styetanotherquiz --account-key $key2 -c catalog -n live.json    -f live.bak.json --overwrite
az storage blob upload --account-name styetanotherquiz --account-key $key2 -c catalog -n backlog.json -f bl.bak.json   --overwrite
```

## DST resilience

`WEBSITE_TIME_ZONE` is silently ignored on Linux Consumption and the `CRON_TZ=Europe/Warsaw` prefix is rejected by the indexer. The schedule is therefore expressed in UTC: `0 5 22,23 * * *` fires at both 22:05 and 23:05 UTC every day. Exactly one of those is Warsaw midnight under either CEST (22:05) or CET (23:05); the handler computes `warsawClock(now)` and runs only when `hour === 0`. No manual bumps at DST boundaries — pinned by `infra/release-fn/src/lib/warsawTime.test.js`.

## Disabling temporarily

Portal: open the Function App → **Overview** → **Stop**, or via CLI: `az functionapp stop -g rg-yetanotherquiz -n func-yetanotherquiz-release`. The next cron fire will not run. Re-enable with `start`.
