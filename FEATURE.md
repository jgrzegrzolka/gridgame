# Tasks

Working document for in-progress work that spans multiple sessions. A fresh agent picking this up should:

1. Read `CLAUDE.md` (project rules).
2. Read this file.
3. Find the **first uncompleted feature** under `## Now`, locate its **next step**, and continue.
4. Update this file as each step completes (check off boxes, move finished features to `## Done`).

**Branching:** each phase = one branch off `main` + one PR. Run `git checkout main && git pull` *before* `git checkout -b ...`. Don't auto-merge — Jan merges each PR himself.

**Shared decisions (apply to all features below):**

- **Backend stack:** Azure Static Web Apps (Free SKU) + bundled Azure Functions (Node) + Azure Cosmos DB NoSQL with **Free Tier toggle ON**. Reason: Jan is a C# Azure dev — personal-project portfolio + learning value. Stays $0/month on always-free quotas indefinitely. (Cloudflare Workers + D1 was equally valid technically; Jan opted into Azure on 2026-06-09.)
- **Naming convention:** code, pages, repo stay `gridgame` (historical). Azure resources use `yetanotherquiz` (matches subscription, current product framing). Don't mix.
- **Subscription:** `yetanotherquiz` / `6da299d6-bdfe-4277-a544-ae8ef68f99a0`, all resources in West Europe.
- **Cost protection in place:** €5/month budget on the subscription, email alerts at 50% / 80% / 100% to `jangrzegrzolka@gmail.com`. Don't re-add. Created via `az rest` on `Microsoft.Consumption/budgets/monthly-5eur`.

---

## Now

### Local development setup — *parked mid-install (2026-06-10)*

Scaffolding shipped in PR #315 (`npm run dev:swa` / `npm run dev:api`, `local.settings.json.example`, CLAUDE.md "Local development" section). Jan is mid-install of Azure Functions Core Tools v4 via `winget install Microsoft.Azure.FunctionsCoreTools` (the npm package install fails on Node 20+ with ESM/CJS incompatibility — winget is the reliable path).

**Resume when:** `func --version` works in a fresh PowerShell. Then:

1. `git pull`
2. `cp api/local.settings.json.example api/local.settings.json`
3. Fill in `COSMOS_CONN` from `az staticwebapp appsettings list -n swa-yetanotherquiz -g rg-yetanotherquiz --query "properties.COSMOS_CONN" -o tsv` (paste into the file, not into chat)
4. Leave `TURNSTILE_SECRET` empty — handler's skip-when-unset path accepts any token locally
5. `npm run dev:swa` → http://localhost:4280

**Not blocking anything** — only blocks the convenience of running locally instead of deploy-to-test.

---

### Feature C: Cross-device identity via WebAuthn passkey

**Status:** parked. Don't start until Feature B is fully shipped and there's actual demand for cross-device stats.

**Goal:** an existing user can opt-in to "save my progress across devices" with one click + Face ID / Touch ID / Windows Hello. From that point on, their stats follow them between phone, laptop, and any other browser-connected device — without registering, without a password, without an email field.

**Why this is a separate feature, not part of B:** identity is not the value prop of the daily stats. v1's anonymous UUID covers ~95% of what the stats UX needs. Passkeys are the right answer the day cross-device starts mattering — but doing them at the same time as the stats feature would balloon both the scope and the risk.

**Why not OAuth / magic-link / fingerprinting:**
- **Browser fingerprinting** (UA + canvas + screen) — GDPR risk, breaks on Safari/Brave, ~70% accurate.
- **IP-based** — high false-positive rate on NAT/mobile.
- **OAuth (Google / GitHub / etc.)** — defeats the "no registration" intent.
- **Magic-link email** — requires email infra + user action; passkey is the better cross-device path.

**Storage-shape compatibility (already designed for):**
- Add an optional `identityId` field to existing `dailyResult` docs. Anonymous rows (no `identityId`) stay valid forever.
- When a user creates a passkey for the first time, backfill all existing docs with their `deviceId` to also have the new `identityId`. One Cosmos query, one bulk update.
- Stats aggregation can dedupe by `identityId` where present, `deviceId` otherwise — so a user who plays on two devices counts as one player.

**Likely phases when this comes off the parking brake:**
1. New Cosmos container `users` with `(identityId, publicKey, createdAt)`.
2. `@simplewebauthn/server` integrated into a new `api/src/functions/passkey.js` (register + authenticate endpoints).
3. "Save across devices" button on the finish screen → browser passkey prompt → server stores public key → `identityId` returned to the client → write into `localStorage.gridgame.identityId`.
4. Client sends `identityId` alongside `deviceId` on submissions; server fills in the doc.
5. Optional later: stats UI surfaces "verified player" vs "anonymous browser" so users can tell whether their cross-device merge actually happened.

**Out of scope even for Feature C:** usernames, email, profile pages, social features. The passkey is the only piece of identity.

---

## Done

### Feature D: Emergency SWA failover migration — *shipped 2026-06-10*

**What happened.** Around 10:21 UTC the Azure Static Web Apps deploy-promotion pipeline broke for `swa-yetanotherquiz` (West Europe, Free SKU). Every deploy after the 09:02 success uploaded its artifact to Azure in ~3 seconds, then sat in `Polling on deployment` for 10 minutes until the GitHub action gave up with `Upload Timed Out`. Azure's `/builds` endpoint showed `status: Uploading` indefinitely, then eventually flipped to `Failed` with no error message. 4 retries and a local `swa deploy` CLI attempt all failed the same way. Portal's **Diagnose and solve problems → Content Deployment** was itself broken with `Sorry, an error occurred`. No public Azure incident acknowledged.

**Why it mattered.** PR #336 (Turnstile soft-disable) was unshipped, meaning legitimate users hitting Cloudflare Turnstile 401s (e.g. Firefox with strict tracking protection) were having their daily-puzzle submissions silently dropped — and every hour of delay locked more bias into community stats.

**Diagnosis path.**
1. Created `swa-yetanotherquiz-v2` (West Europe, fresh) — same failure → ruled out instance-specific corruption.
2. Created `swa-yetanotherquiz-v3` (West US 2, fresh) — **deployed cleanly in 32 seconds**, confirmed the issue was West Europe regional, not service-wide.
3. Filed a public issue at https://github.com/Azure/static-web-apps/issues so Microsoft sees it.

**Cutover.** Removed `www.yetanotherquiz.com` from V1, added to V3 with DNS-TXT validation, flipped the Cloudflare CNAME from `black-dune-...` → `wonderful-ground-01bf3091e.7.azurestaticapps.net`. V1 was accidentally deleted mid-cutover (a queued `az staticwebapp delete` finally executed during the WE control-plane chaos) — not a problem since V1 was unusable anyway.

**Resulting topology.**
- **Active prod:** `swa-yetanotherquiz-v3` (West US 2), serving `www.yetanotherquiz.com`.
- **Deleted:** `swa-yetanotherquiz` (V1, WE), `swa-yetanotherquiz-v2` (V2, WE).
- **Workflow:** single `.github/workflows/deploy.yml` using GH secret `AZURE_STATIC_WEB_APPS_API_TOKEN_V3`.
- **Latency cost:** Functions in WUS2 + Cosmos in WE = ~300 ms cross-region per API call. Acceptable for low-volume endpoints.

**Recovery playbook — for when Azure WE recovers** (or when we want lower API latency):
1. Verify WE is healthy: create a throwaway SWA in WE via `az staticwebapp create`, trigger one deploy. If it completes in seconds (not 10 minutes), WE is back.
2. Create `swa-yetanotherquiz-we` (or reuse the `swa-yetanotherquiz` name) in West Europe. Copy `COSMOS_CONN` + `TURNSTILE_SECRET` app settings. Add its deploy token as GH secret `AZURE_STATIC_WEB_APPS_API_TOKEN_WE`.
3. Add a sibling `.github/workflows/deploy-we.yml` (copy of the current `deploy.yml`, swap the secret). Two independent workflows = both fire on push, neither blocks the other if the other fails.
4. Add `www.yetanotherquiz.com` as a custom domain on the new WE SWA via TXT validation while V3 is still serving (Azure requires the source SWA to release first — same conflict we hit today; remove from V3 before adding to WE).
5. Flip Cloudflare CNAME back to the WE hostname. Validate. Done — V3 stays as hot-standby for next time.

**Open cleanup (Cloudflare, manual):**
- 4 stale apex A records pointing at GitHub Pages IPs (`185.199.108-111.153`) from before the original SWA migration. Functionally irrelevant (Cloudflare redirect rule fires before origin contact) but worth cleaning up.
- Stale apex TXT `_9n7yl364eeo06i0bnmr5hyuxtpcpff2` — the original SWA's hostname validation token, no longer used.

Key PRs from the day: #336 (Turnstile soft-disable, the fix that needed to ship), #337 (deploy-v2.yml diagnostic, deleted in #339), #338 (deploy-v3.yml diagnostic, repurposed into the new `deploy.yml` in #339), #339 (this cleanup).

### Feature B: Daily challenge — global stats — *shipped 2026-06-10*

Per-flag find rates aggregated across everyone who attempted the same daily puzzle, plus an "Average today: X/Y" headline below the result. Live in production.

**Architecture in one paragraph:** Cosmos doc `id = "{puzzleId}:{deviceId}"` enforces single-submission-per-device. `POST /api/v1/daily/result` (5/min/IP rate-limited; was originally Turnstile-verified but **soft-disabled 2026-06-10** after CF started 401-blocking legitimate users — see CLAUDE.md "Local development" for the rationale) inserts a row; 409 on duplicate. `GET /api/v1/daily/stats/{puzzleId}` aggregates to `{totalAttempts, perCodeFinds, mean, topPct}`, in-Function cached 60s, with `?fresh=1` bypass for the player who just submitted. Permanent infra/API plumbing facts (Functions v4 layout, CommonJS pin, Cosmos REST instead of `@azure/cosmos`, etc.) moved to `CLAUDE.md` "API / Azure Functions" section.

**Closed unbuilt:**
- **B6 — archive integration** — delivered indirectly by B4. Clicking an archive square already routes through the daily revisit branch, which fetches the same stats. Inline aggregate hints on the archive grid itself weren't worth doing at current per-puzzle N.
- **B7 — player-percentile headline ("you're in the top X% today")** — the existing "Average today" line covers the job at current traffic. Adding a server distribution endpoint (`SELECT COUNT(*) GROUP BY ...`) + client aggregation isn't a felt need yet. Re-open when traffic justifies.

Key PR milestones: #284 (api skeleton), #293 (validate-only POST), #296 (Cosmos REST insert), #304 (identity + submitted tracking), #315 (local dev scaffolding), #322 (median → mean).

### Feature A: Migrate site hosting to Azure SWA — *shipped 2026-06-09*

GitHub Pages → Azure Static Web Apps (Free SKU). Public URL `https://www.yetanotherquiz.com` (apex 301-redirects to www via Cloudflare). Resources: `rg-yetanotherquiz`, `swa-yetanotherquiz`. Permanent hosting facts moved to `CLAUDE.md` "Hosting" section; PR #281 + #282 + the wrap-up PR have the implementation history.
