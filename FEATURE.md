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
- **Subscription:** `yetanotherquiz` / `6da299d6-bdfe-4277-a544-ae8ef68f99a0`. Resource group is in West Europe and most resources live there (Cosmos, RG metadata); the SWA itself is `swa-yetanotherquiz-v3` in **West US 2** after the 2026-06-10 WE failover — see Done / Feature D for the why and the recovery playbook.
- **Cost protection in place:** €5/month budget on the subscription, email alerts at 50% / 80% / 100% to `jangrzegrzolka@gmail.com`. Don't re-add. Created via `az rest` on `Microsoft.Consumption/budgets/monthly-5eur`.

---

## Now

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

### Feature E: Reliable daily-puzzle auto-release via Azure Logic App — *shipped 2026-06-10*

**Problem.** GitHub Actions `schedule:` cron on `release-daily.yml` was firing very late — observed firings on the night of 2026-06-09→10 (run IDs `27242130968`, `27244311244`, both `event=schedule` per GitHub's own record) landed at ~01:19 and ~02:15 Warsaw, i.e. 75–135 min after the 00:00 nominal target. The manual morning dispatch always won the race, so from a user's POV the puzzle never auto-released; the 14-firings-per-night defensive burst was masking lateness, not curing it.

**Fix.** Moved the *trigger* to an Azure Logic App (Consumption tier) with a Recurrence trigger at 00:05 Warsaw. The Logic App POSTs `workflow_dispatch` to the existing `release-daily.yml`; everything downstream is unchanged — the workflow still promotes `daily/daily_backlog.json[0]` → `daily/daily_puzzles.json`, commits, kicks `deploy.yml`, and the static site ships the new puzzle as part of the normal deploy path.

**Architecture.** Single `Microsoft.Logic/workflows` resource (`logic-yetanotherquiz-release-daily`) in `rg-yetanotherquiz`, West Europe. Recurrence trigger uses Windows TZ identifier `Central European Standard Time` (auto-follows DST). HTTP action authenticates with a fine-grained GitHub PAT stored as a `securestring` WDL parameter — never baked into the deployed workflow JSON, masked in portal + run history. No managed identity, no storage account, no Function App — Logic App Consumption is a single resource. Cost: $0 (free grant covers ~31 executions/month vs the ~30 we use). Defined in `infra/logicapp-release-daily.bicep` as single source of truth — round-trip every change through the template and `az deployment group create`, no portal click-edits.

**The "fires on registration" quirk.** When `az deployment group create` *creates* the Logic App, the Recurrence trigger fires once immediately as part of registration, then settles into its schedule for subsequent runs. Documented Logic Apps behaviour, not a bug. In practice the first deploy doubles as a free end-to-end smoke test, and future redeploys (e.g. for PAT rotation) fire one extra `workflow_dispatch` that `release-daily.yml`'s "already released today" guard catches cleanly. Pure update deploys that don't recreate the resource (e.g. tag changes) do NOT trigger this. Captured in `infra/README.md`.

**Verification.** All hops verified live during deploy day before the schedule-cutover commit:
1. Deploy-time auto-fire 16:16:29Z 2026-06-10 → Logic App run `08584204986959706003361452862CU13` Succeeded → workflow run `27289674634` (`event: workflow_dispatch`, 14s, guard hit cleanly).
2. One-off scheduled fire at 19:10 Warsaw — schedule swapped to `hours:[19] minutes:[10]` for a 15-min test window, then reverted same hour. Logic App run `08584204954564865890913776253CU32` fired at 19:10:28 Warsaw → workflow run `27292799473` (13s, guard hit cleanly). Log line: `Already released today (2026-06-10 Warsaw, last commit was 2026-06-09T22:40:38Z) — skipping.`
3. Reverted-schedule deploy → trigger metadata `nextExecutionTime: 2026-06-10T22:05:28Z` = 00:05 Warsaw 2026-06-11.
4. First natural 00:05 Warsaw fire on 2026-06-11 → `daily: release #6 — auto-promoted from backlog` commit on `main`.

Soak window skipped — Logic Apps don't have GitHub cron's "sometimes fires" failure mode that justified multi-night observation.

**PAT lifecycle.** Fine-grained GitHub PAT, repo-scoped to `jgrzegrzolka/gridgame`, permission `Actions: write` only (auto-grants `Metadata: Read-only` as a forced dependency). Initial mint 2026-06-10 with 90-day expiry; future rotations will use GitHub's 1-year max. Rotation = mint new PAT + `az deployment group create` with the new value. GitHub emails 7 days before expiry — that's the reminder.

**Future considerations** (captured so the question doesn't need re-deriving):
- **Option: GitHub App + OIDC federation.** Replace the PAT with Logic App managed identity → OIDC ID token → GitHub App installation token. Zero secrets stored, zero rotation ever. Cost: a few hours of plumbing (create GitHub App, install on repo, configure federated credential on the Logic App identity, swap HTTP action auth). Re-examine if rotation becomes friction or extended absence (>1 year) is planned.
- **Option (ruled out): Move backlog to Cosmos + new `/api/daily/today` endpoint.** Kills GitHub from the runtime path entirely — no PAT, no daily release commit. Loses two values explicitly preserved in this project: "the file is the released state" (git as source of truth, `git log` as audit trail) and the per-puzzle authoring workflow (edit JSON + commit + PR is more locality than tool-mediated Cosmos writes). Authoring happens ~weekly, PAT rotation ~annually — bad swap as long as authoring is done by hand.

**Rollback playbook.**
- *Logic App firing wrong / spamming runs*: portal → `logic-yetanotherquiz-release-daily` → **Disable**. Stops all future runs instantly. Re-enable when fixed.
- *PAT compromised or leaked*: revoke at GitHub Settings → Developer settings → PATs. Logic App's HTTP action will start returning 401 (visible in Logic App run history). Mint new PAT, redeploy Bicep with new value.
- *Logic App entirely broken*: temporarily restore the `schedule:` block to `.github/workflows/release-daily.yml` (GH cron is flaky but better than nothing) and disable the Logic App.

Key PRs: #341 (Bicep template scaffolded, no deploy), #342 (`schedule:` removal + FEATURE.md promotion + docs cleanup — this PR).

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

**2026-06-11 follow-up — redirect rule hardening + Cloudflare cleanup.** The CF apex→www redirect "Redirect from root to WWW [Template]" was firing intermittently. Its wildcard `https://yetanotherquiz.com/*` only matched HTTPS with a trailing path — plain-HTTP requests and edge cases fell through to the 4 stale GH Pages A records (`185.199.108-111.153`), surfacing as unstyled stale content or Azure 404s on apex. The "functionally irrelevant" rationale in the original cleanup list was wrong: those records were one rule-misfire away from being the actual origin. Rewrote the rule to match by host header instead — Match: `(http.host eq "yetanotherquiz.com")`, Target (Dynamic): `concat("https://www.yetanotherquiz.com", http.request.uri.path)`, 301, preserve query string. Then deleted all 4 GH Pages A records and replaced with a single placeholder A record (`192.0.2.1`, TEST-NET-1, proxied) so apex stays resolvable for the rule to fire on, but any future rule misfire falls through to an unroutable IP rather than a real stale server. Also removed the stale apex TXT `_9n7yl364eeo06i0bnmr5hyuxtpcpff2` (the original SWA's hostname validation token, no longer used). All Feature D Cloudflare-side cleanup is now closed.

Key PRs from the day: #336 (Turnstile soft-disable, the fix that needed to ship), #337 (deploy-v2.yml diagnostic, deleted in #339), #338 (deploy-v3.yml diagnostic, repurposed into the new `deploy.yml` in #339), #339 (this cleanup).

Current-state reference for what's deployed and the runbook for these symptoms: [`infra/operations.md`](infra/operations.md).

### Feature B: Daily challenge — global stats — *shipped 2026-06-10*

Per-flag find rates aggregated across everyone who attempted the same daily puzzle, plus an "Average today: X/Y" headline below the result. Live in production.

**Architecture in one paragraph:** Cosmos doc `id = "{puzzleId}:{deviceId}"` enforces single-submission-per-device. `POST /api/v1/daily/result` (5/min/IP rate-limited; was originally Turnstile-verified but **soft-disabled 2026-06-10** after CF started 401-blocking legitimate users — see CLAUDE.md "Local development" for the rationale) inserts a row; 409 on duplicate. `GET /api/v1/daily/stats/{puzzleId}` aggregates to `{totalAttempts, perCodeFinds, mean, topPct}`, in-Function cached 60s, with `?fresh=1` bypass for the player who just submitted. Permanent infra/API plumbing facts (Functions v4 layout, CommonJS pin, Cosmos REST instead of `@azure/cosmos`, etc.) moved to `CLAUDE.md` "API / Azure Functions" section.

**Closed unbuilt:**
- **B6 — archive integration** — delivered indirectly by B4. Clicking an archive square already routes through the daily revisit branch, which fetches the same stats. Inline aggregate hints on the archive grid itself weren't worth doing at current per-puzzle N.
- **B7 — player-percentile headline ("you're in the top X% today")** — the existing "Average today" line covers the job at current traffic. Adding a server distribution endpoint (`SELECT COUNT(*) GROUP BY ...`) + client aggregation isn't a felt need yet. Re-open when traffic justifies.

Key PR milestones: #284 (api skeleton), #293 (validate-only POST), #296 (Cosmos REST insert), #304 (identity + submitted tracking), #315 (local dev scaffolding), #322 (median → mean).

### Local development setup — *shipped 2026-06-10*

Full local stack runs via `npm run dev:swa` (static site + Functions API + Cosmos round-trips against real prod Cosmos + Azurite for the Storage health check). Permanent setup/run docs live in `README.md` (setup + run sections) and `CLAUDE.md` "Local development" (Azurite trade-offs, deeper notes). Dev reset toolbar mounts localhost-only on the daily + archive pages for one-click localStorage + Cosmos-local-rows cleanup. Key PR milestones: #315 (scaffolding), #335 (Azurite + dev reset toolbar + `/api/v1/dev/clear-local-rows`).

### Feature A: Migrate site hosting to Azure SWA — *shipped 2026-06-09*

GitHub Pages → Azure Static Web Apps (Free SKU). Public URL `https://www.yetanotherquiz.com` (apex 301-redirects to www via Cloudflare). Resources: `rg-yetanotherquiz`, `swa-yetanotherquiz` (the original WE instance — replaced by `swa-yetanotherquiz-v3` in West US 2 during Feature D's failover the next day). Permanent hosting facts moved to `CLAUDE.md` "Hosting" section; PR #281 + #282 + the wrap-up PR have the implementation history.
