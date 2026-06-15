# Operations — `yetanotherquiz.com`

Current-state reference for what's deployed where, and a runbook for the recurring symptoms we've seen in production. Time-ordered narratives of *how we got here* live in `../FEATURE.md`; this doc tells you the live picture and what to do when something looks wrong.

## Topology

A single page load follows:

```
browser
  └─ DNS  (Cloudflare-hosted zone for yetanotherquiz.com)
       ├─ apex  →  Cloudflare proxy (orange cloud)  →  Redirect Rule: 301 to https://www.…
       └─ www   →  Cloudflare proxy (orange cloud)
                       │
                       ▼
                  CF Worker  yetanotherquiz-edge-proxy
                  (route www.yetanotherquiz.com/* → Worker)
                       │   rewrites Host to raw SWA hostname
                       ▼
                  Azure Static Web App
                  swa-yetanotherquiz-v3 (West US 2)
                  reached via wonderful-ground-01bf3091e.7.azurestaticapps.net
                    ├─ static content (this repo, app_location=".")
                    └─ managed Function App (api/, not a discrete resource)
                       │
                       ▼
                  Azure Cosmos DB NoSQL
                  cosmos-yetanotherquiz-jg (West Europe)
```

Notes:

- **Apex is Cloudflare-proxied** so the Redirect Rule can intercept before any origin contact. The apex A record points at `192.0.2.1` (TEST-NET-1, unrouteable) on purpose: if the rule ever misfires, the fall-through is unreachable rather than a real stale server. **Never restore real apex A records** (e.g. old GitHub Pages IPs `185.199.108-111.153`) — see FEATURE.md Feature D 2026-06-11 follow-up for why.
- **www is orange-cloud** since 2026-06-11. Requests hit a Cloudflare Worker (`yetanotherquiz-edge-proxy`) that forwards them to the *raw* SWA hostname instead of letting CF route them via SWA's custom-domain edge. The custom-domain edge has been flaky on the Free SKU — see "Known issues" below. Worker source lives at `infra/edge-proxy/index.js`.
- **CF caches HTML on www** with a Cache Rule (2 h Edge TTL, 4xx no-store, query-string-ignored cache key). `deploy.yml` purges the zone after every SWA deploy so the worst-case staleness window is the time between deploy completion and the post-deploy `Purge Cloudflare cache` step (single seconds in practice). With the Worker giving us a stable origin, this cache actually works — before the Worker, CF could pin a 14400 s 404 from the flapping custom-domain edge.
- **Functions are managed by SWA**, not a discrete resource. In the Azure portal they appear under `swa-yetanotherquiz-v3 → APIs → (managed)`.
- **Cross-region API hop:** the SWA lives in West US 2 but Cosmos is in West Europe, so every API call eats ~300 ms cross-region. Acceptable at current volume. The recovery playbook in FEATURE.md Feature D removes this by re-creating a WE sibling when WE recovers.

## Resources

All in subscription **`yetanotherquiz`** (`6da299d6-bdfe-4277-a544-ae8ef68f99a0`), resource group **`rg-yetanotherquiz`** (West Europe).

| Name | Type | Region | Role |
|---|---|---|---|
| `swa-yetanotherquiz-v3` | Static Web App (Free) | West US 2 | Serves the site + bundled Functions. Hostname `wonderful-ground-01bf3091e.7.azurestaticapps.net`. |
| `cosmos-yetanotherquiz-jg` | Cosmos DB NoSQL (Free tier ON) | West Europe | Containers under db `yetanotherquiz`: **`dailyResults`** — one row per (puzzle, deviceId) submission, **1000 RU/s manual**, `defaultTtl: 31_536_000` (1 year, set 2026-06-11 per FEATURE.md Feature F). **`quizRecords`** — one row per deviceId carrying every quiz config's PB + engagement counters (Feature F5), **400 RU/s manual**, no TTL. **`profiles`** — one row per deviceId carrying the optional nickname (Feature H2), **400 RU/s manual**, no TTL. **`tttPairs`** — one row per (deviceId, opponentId) per perspective carrying running head-to-head wins/losses/draws for both TTT modes (Feature G), **400 RU/s manual**, no TTL. **`dailyLeaderboards`** — one row per (deviceId, configKey, UTC-date) carrying that day's leaderboard entry for a flag-quiz config (Feature K), **autoscale 100–1000 RU/s**, partition key `/pk` = `"<configKey>\|<YYYY-MM-DD>"`, `defaultTtl: 172_800` (48 h — yesterday's rows auto-purge). Composite indexes on `(score, durationMs)` both directions, specified at create time in `infra/dailyLeaderboards-index-policy.json`. **`engagementEvents`** — one row per engagement event (share / findflag_play / daily_start) per device (Feature M Part B, created 2026-06-15), **autoscale 100–1000 RU/s**, partition key `/deviceId`, `defaultTtl: 31_536_000` (1 year, matches `dailyResults`). Doc shape carries `kind` discriminator + tagged-union `payload` validated server-side; per-kind id schemes give `daily_start` deterministic dedup and `findflag_play` / `share` uuid-based distinctness. The €5/month budget catches drift if any container goes paid past the Free Tier 1000 RU/s account quota. **(The `passkeys` container that briefly existed during the original Feature C passkey design was deleted 2026-06-15 when Feature C pivoted to a QR-claim flow — see FEATURE.md Done.)** |
| `logic-yetanotherquiz-release-daily` | Logic App (Consumption) | West Europe | 00:05 Warsaw daily cron that POSTs `workflow_dispatch` to `release-daily.yml`. Replaces flaky GH cron. Template: `logicapp-release-daily.bicep`. |

Outside Azure:

- **Cloudflare:** DNS zone for `yetanotherquiz.com`, plus:
  - Redirect Rule "Redirect from root to WWW [Template]" — matches `http.host eq "yetanotherquiz.com"` and 301s to `concat("https://www.yetanotherquiz.com", http.request.uri.path)`.
  - Worker `yetanotherquiz-edge-proxy` (account `jangrzegrzolka`, route `www.yetanotherquiz.com/*`) — forwards www requests to the raw SWA hostname so the flaky custom-domain edge is out of the path. Source: `infra/edge-proxy/index.js`. Deployed manually via the CF dashboard (no CI today).
  - Cache Rule "Cache HTML for Always Online" — `(http.host eq "www.yetanotherquiz.com") and (ends_with(http.request.uri.path, "/") or ends_with(http.request.uri.path, ".html"))`. Edge TTL 2 h (override origin), 4xx (single-code 404) → No store, cache key ignores all query strings. Purged on every deploy by `deploy.yml`.
  - Always Online — enabled, serves cached HTML if origin is unreachable.
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

### Azure SWA 404 on www `/` (mitigated by the edge proxy Worker)

**Symptom — historic.** Hitting `https://www.yetanotherquiz.com/` returned the blue **"Azure Static Web Apps — 404: Not Found"** page on a fraction of requests, sometimes for hours after a deploy. The raw SWA hostname `https://wonderful-ground-01bf3091e.7.azurestaticapps.net/` served 200 the whole time. Chrome hides the `www.` prefix in the URL bar, so the browser may *look* like it's still on apex when it's actually on www after the redirect.

**Cause.** SWA Free SKU's custom-domain edge propagation is unreliable. The deploy reports "Succeeded" the moment the raw hostname is serving new content — the custom-domain edge can take many more minutes (we've observed up to several hours) to catch up. Not a Cloudflare issue, not an artifact issue, not something we can fix from outside SWA. On 2026-06-11 the window stretched to ~30 % of requests still 404ing 3 + hours post-deploy and refused to settle without a fresh deploy to shake it loose.

**Current mitigation.** The custom-domain edge is now bypassed entirely. Since 2026-06-11 the topology routes www requests through Cloudflare Worker `yetanotherquiz-edge-proxy`, which proxies to the *raw* SWA hostname (the one that doesn't lag). The custom domain remains configured on SWA but no production traffic reaches it. See the Topology section above.

**Confirmation it's still the same underlying SWA bug** (i.e. test whether the Worker is still earning its keep, e.g. when considering removal): probe the custom-domain edge directly with `curl -H 'Host: www.yetanotherquiz.com' https://wonderful-ground-01bf3091e.7.azurestaticapps.net/` in a loop — if it flaps between 200 and 404, the SWA-side bug is still there and the Worker is still pulling its weight.

**If the Worker itself breaks** (CF Workers outage, code error, route binding lost), the fallback is to flip the www CNAME from orange (CF proxy → Worker) back to grey (DNS-only → SWA directly). Real users will see the SWA flap symptom again, but at least the path is shorter and the failure mode is the known one. To roll back: CF dashboard → DNS → click orange cloud on `www` row → flips to grey.

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

## Cosmos data migration policy

Every native write into `dailyResults` (`api/src/lib/dailyResultDoc.js`), `quizRecords` (`api/src/lib/quizRecordDoc.js`), `profiles` (`api/src/lib/profileDoc.js`), and `tttPairs` (`api/src/lib/tttPairDoc.js`) carries a numeric schema-version field `v` (today `v: 1`).

**The contract for any future shape change to `dailyResults`:**

1. Bump the writer's `v` to the new version. Native writes now include the new field with its real value.
2. Ship a one-off backfill script that reads every row where `v < newVersion`. For each row:
   - **(a)** add any missing **analytical** fields with a sensible default — same default the aggregator already returns on absence, so no behaviour change.
   - **(b)** set `backfilled: true` on the row **only if** an analytical field was defaulted in (a). Do *not* set it on rows where only the `v` field is being patched in — `backfilled` exists to flag analytical-value provenance ("treat this `wrongCodes: []` as 'we never asked' rather than 'user confirmed nothing'"), not migration touches. Marking metadata-only patches as `backfilled` would poison every future "exclude backfilled rows" analytic with rows whose analytical values are perfectly native.
   - **(c)** bump the row's `v` to the new version.
3. The backfill is the F4 pattern — same shape every time, just different default values and field names. See `scripts/backfill-daily-v1.cjs` as the reference template (pure `planRow()` exported for testability, idempotent dry-run by default, system fields stripped before upsert).

**Why a separate `backfilled: true` marker** (and not just relying on `v`):

A default value (e.g. `wrongCodes: []`) on a backfilled row is structurally indistinguishable from the same value on a native row where the user genuinely had nothing to record. The `backfilled: true` flag preserves that distinction forever — future analytics can choose to include or exclude these rows from any computation where the difference matters (e.g. a "no-wrong-picks rate" probably shouldn't count backfilled rows as confirmed-no-wrong-picks). Asymmetric like `local`: only present on backfilled rows; absence means "native at the row's `v`".

**Aggregator discipline (defense in depth):**

Even with the version field, aggregators should default missing fields rather than assume presence. `v` is for write-side migrations and analytic provenance — not a read-side gate. `api/src/lib/aggregate.js` already follows this: `const wrong = row.wrongCodes || [];` works the same whether the field is absent (pre-#317), `[]` (post-#317 native), or `[]` from a backfill.

**Worked example — `profiles` shipped at v: 1 from day one (Feature H2):**

The first container we provisioned *after* the policy was written. No pre-policy rows exist, so no backfill was ever needed: `buildProfileDoc()` stamps `v: 1` on every row from the first write, and the `backfilled: true` marker has never been set (and won't be unless a future shape change adds an analytical field with a defaulted value to existing rows). This is the cleanest possible application of the policy — the contract proven by absence rather than by a migration run.

**Worked example — what F4 did (applied 2026-06-11):**

20 dailyResults rows existed at the time F4 ran, all without `v`. The script split them into two groups:

- **Group A — 1 row** (puzzleId=1, deviceId `7012d6ba…`): predates PR #317 (`feat: capture wrongCodes on every submission`) and has no `wrongCodes` field. Backfilled as `wrongCodes: [], backfilled: true, v: 1`. The `backfilled` marker tells any future analytic "this `[]` is not a confirmed-no-wrong-picks signal."
- **Group B — 19 rows**: have `wrongCodes` as written by the native client, but predate `v: 1`. Patched to add `v: 1` only — no `backfilled` marker, since no analytical field was defaulted. Their `wrongCodes` arrays are native player data.

One row (the dev-tagged puzzleId=6 submission from the F3 deploy verification) was already at `v: 1` and was skipped. Idempotent re-run after the apply showed 0 changes, 21 skipped — the contract holds.

## Where to look for what

- **`../CLAUDE.md`** — project rules and high-level "Hosting" intro for someone new to the repo.
- **`../FEATURE.md`** — time-ordered narrative: in-progress work under `## Now`, completed work under `## Done`. The discovery stories behind everything in this doc live there (Features A, D, E).
- **`./README.md`** — IaC reference (Bicep templates).
- **`../api/src/functions/`** — endpoint code. Adding a new endpoint requires *both* a file here and a matching `require()` in `api/src/index.js` (CLAUDE.md "API / Azure Functions" has the contract).
