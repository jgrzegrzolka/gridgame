# Operations — `yetanotherquiz.com`

Current-state reference for what's deployed where, and a runbook for the recurring symptoms we've seen in production. Time-ordered narratives of *how we got here* live in `../FEATURE.md`; this doc tells you the live picture and what to do when something looks wrong.

## Topology

A single page load follows:

```
browser
  └─ DNS  (Cloudflare-hosted zone for yetanotherquiz.com)
       ├─ apex  →  Cloudflare proxy (orange cloud)  →  Redirect Rule: 301 to https://www.…
       └─ www   →  CNAME (grey cloud, DNS-only)  →  SWA-hosted hostname
                                                       │
                                                       ▼
                                            Azure Static Web App
                                            swa-yetanotherquiz-v3 (West US 2)
                                              ├─ static content (this repo, app_location=".")
                                              └─ managed Function App (api/, not a discrete resource)
                                                       │
                                                       ▼
                                            Azure Cosmos DB NoSQL
                                            cosmos-yetanotherquiz-jg (West Europe)
```

Notes:

- **Apex is Cloudflare-proxied** so the Redirect Rule can intercept before any origin contact. The apex A record points at `192.0.2.1` (TEST-NET-1, unrouteable) on purpose: if the rule ever misfires, the fall-through is unreachable rather than a real stale server. **Never restore real apex A records** (e.g. old GitHub Pages IPs `185.199.108-111.153`) — see FEATURE.md Feature D 2026-06-11 follow-up for why.
- **www is grey-cloud** (DNS only) — requests go directly to Azure SWA without Cloudflare on the path. There's no CF cache in front of www today.
- **Functions are managed by SWA**, not a discrete resource. In the Azure portal they appear under `swa-yetanotherquiz-v3 → APIs → (managed)`.
- **Cross-region API hop:** the SWA lives in West US 2 but Cosmos is in West Europe, so every API call eats ~300 ms cross-region. Acceptable at current volume. The recovery playbook in FEATURE.md Feature D removes this by re-creating a WE sibling when WE recovers.

## Resources

All in subscription **`yetanotherquiz`** (`6da299d6-bdfe-4277-a544-ae8ef68f99a0`), resource group **`rg-yetanotherquiz`** (West Europe).

| Name | Type | Region | Role |
|---|---|---|---|
| `swa-yetanotherquiz-v3` | Static Web App (Free) | West US 2 | Serves the site + bundled Functions. Hostname `wonderful-ground-01bf3091e.7.azurestaticapps.net`. |
| `cosmos-yetanotherquiz-jg` | Cosmos DB NoSQL (Free tier ON) | West Europe | `dailyResults` container — one row per (puzzle, deviceId) submission. Provisioned at **1000 RU/s manual** (Free Tier covers it via the account-wide 1000 RU/s quota). `defaultTtl: 31_536_000` (1 year) — rows auto-purge from `_ts + 1y`, set 2026-06-11 per FEATURE.md Feature F. |
| `logic-yetanotherquiz-release-daily` | Logic App (Consumption) | West Europe | 00:05 Warsaw daily cron that POSTs `workflow_dispatch` to `release-daily.yml`. Replaces flaky GH cron. Template: `logicapp-release-daily.bicep`. |

Outside Azure:

- **Cloudflare:** DNS zone for `yetanotherquiz.com`. The Redirect Rule "Redirect from root to WWW [Template]" matches `http.host eq "yetanotherquiz.com"` and 301s to `concat("https://www.yetanotherquiz.com", http.request.uri.path)`.
- **PartyKit:** `gridgame-ttt.jgrzegrzolka.partykit.dev` (Cloudflare-hosted), the tic-tac-toe WebSocket server. Deployed by `deploy-partykit.yml`. Unrelated to the SWA path — don't conflate.

Cost guardrail: €5/month subscription budget with email alerts at 50/80/100% to `jangrzegrzolka@gmail.com` (`Microsoft.Consumption/budgets/monthly-5eur`). Don't re-add.

## Secrets and tokens

Four secrets keep the runtime working. Rotation expectations differ — only one expires on a clock.

| Secret | Lives in | Used by | Expires | How to rotate |
|---|---|---|---|---|
| `AZURE_STATIC_WEB_APPS_API_TOKEN_V3` | GitHub repo secret | `.github/workflows/deploy.yml` (SWA upload) | Never — rotate only if compromised | Portal → `swa-yetanotherquiz-v3` → **Manage deployment token** → **Reset** → copy → update repo secret |
| `CLOUDFLARE_API_TOKEN` | GitHub repo secret | `.github/workflows/deploy.yml` (cache-purge step) | Never (no TTL set on the token) | CF dash → My Profile → API Tokens → `gridgame deploy — cache purge` → **Roll** → copy → update repo secret |
| `PARTYKIT_TOKEN` | GitHub repo secret | `.github/workflows/deploy-partykit.yml` | No documented expiry; rotate only if compromised | Local `partykit token` CLI → copy → update repo secret |
| GitHub fine-grained PAT (Logic App caller) | Azure Bicep parameter on `logic-yetanotherquiz-release-daily` | Logic App HTTP action that POSTs `workflow_dispatch` to `release-daily.yml` | **2026-09-08** (initial 90-day mint 2026-06-10; future rotations use GitHub's 1-year max) | Mint new fine-grained PAT (Actions:write, scoped to `jgrzegrzolka/gridgame`) → `az deployment group create` against `infra/logicapp-release-daily.bicep` with the new value |

**The PAT is the only secret with a hard expiry.** GitHub emails 7 days before the date — that's the actionable reminder; no other tracking needed.

**Compromise response.** Revoke at source first (SWA portal / CF dash / PartyKit CLI / GitHub Developer settings), then mint a fresh value and update wherever it lives.

## Known issues

### Azure SWA 404 on www `/` right after a deploy

**Symptom.** Within ~20 minutes after a successful deploy, hitting `https://www.yetanotherquiz.com/` (or following the apex→www redirect) returns the blue **"Azure Static Web Apps — 404: Not Found"** page. The raw SWA hostname `https://wonderful-ground-01bf3091e.7.azurestaticapps.net/` returns 200 with fresh content the whole time. Chrome hides the `www.` prefix in the URL bar, so the browser may *look* like it's still on apex when it's actually on www after the redirect.

**Cause.** SWA's custom-domain edge propagation lags the SWA-hosted hostname's distribution. The deploy reports "Succeeded" the moment the raw hostname is serving new content — the custom-domain edge can take many more minutes to catch up. Not a Cloudflare issue, not an artifact issue.

**Confirmation that it's this and not something else.** Curl the raw SWA hostname — if `/` returns 200 there, the artifact is fine and you're in the propagation window. If the raw hostname also 404s, the deploy artifact is genuinely broken (very rare; look at the Oryx logs in the GH Actions run).

**What to do.**
- **Real users:** wait. Single-digit-minute windows are typical; we've observed up to ~20 min once.
- **Diagnostic:** `deploy.yml` runs a smoke-check after each deploy that polls www `/` for up to 5 minutes and logs the propagation curve. If a run fails the smoke-check, the timing is in the Actions log.
- **If this becomes chronic** (smoke-check failing repeatedly): escalate to one of (a) add a `staticwebapp.config.json` with `navigationFallback: { rewrite: "/index.html" }` so SWA serves index for any unmatched path, or (b) flip www to Cloudflare-proxied (orange cloud) with cache-bypass on 404 so CF normalises responses. Both are tracked as follow-ups, neither is shipped yet.

### Apex serves unstyled/stale content or a non-Azure 404

**Symptom.** `https://yetanotherquiz.com/` (apex) loads but with broken styling, or shows a non-Azure 404 (e.g. the GitHub Pages octocat).

**Cause.** The Cloudflare apex→www Redirect Rule isn't firing, and the request is falling through to whatever the apex DNS A record points at. This was the cause of the **2026-06-10/11 unstyled-apex outage**: the rule's matcher was a URL wildcard (`https://yetanotherquiz.com/*`) that missed plain-HTTP and edge-case apex requests, and the fall-through hit four stale GitHub Pages A records (`185.199.108-111.153`) left over from before the SWA migration.

**What to do.**
1. Confirm the symptom: `curl -sSI http://yetanotherquiz.com/` and `curl -sSI https://yetanotherquiz.com/` should both return `301 Moved Permanently` with `Location: https://www.yetanotherquiz.com/`. If either returns 200, the rule isn't firing.
2. In Cloudflare → Rules → Redirect Rules, the rule **"Redirect from root to WWW [Template]"** should match by **host header** (`http.host eq "yetanotherquiz.com"`), not by URL wildcard. Target is a dynamic `concat("https://www.yetanotherquiz.com", http.request.uri.path)`, status 301, preserve query string.
3. In Cloudflare → DNS, the apex A record should be exactly **one** entry: `192.0.2.1` (TEST-NET-1), proxied (orange). If you see GitHub Pages IPs back, delete them.

History: FEATURE.md Feature D "2026-06-11 follow-up — redirect rule hardening + Cloudflare cleanup".

### Deploys hang at "Uploading" indefinitely

**Symptom.** GitHub Actions deploy step uploads the artifact in seconds, then sits in `Polling on deployment` and the build's `/builds` endpoint shows `status: Uploading` for 10+ minutes before failing with `Upload Timed Out`. Azure portal's **Diagnose and solve problems → Content Deployment** also broken. No public Azure incident necessarily acknowledged.

**Cause.** Azure SWA content-distribution outage scoped to a single region. We hit this on **2026-06-10** in West Europe — every fresh SWA in WE failed the same way, but a fresh SWA in West US 2 deployed cleanly in 32 seconds. That's how we ended up on V3 in WUS2.

**What to do.** Don't retry endlessly. Cut over to a sibling SWA in a different region per the **recovery playbook in FEATURE.md Feature D** (create the sibling, copy app settings, swap GH deploy token, rebind `www.yetanotherquiz.com`, flip the Cloudflare CNAME).

## Where to look for what

- **`../CLAUDE.md`** — project rules and high-level "Hosting" intro for someone new to the repo.
- **`../FEATURE.md`** — time-ordered narrative: in-progress work under `## Now`, completed work under `## Done`. The discovery stories behind everything in this doc live there (Features A, D, E).
- **`./README.md`** — IaC reference (Bicep templates).
- **`../api/src/functions/`** — endpoint code. Adding a new endpoint requires *both* a file here and a matching `require()` in `api/src/index.js` (CLAUDE.md "API / Azure Functions" has the contract).
