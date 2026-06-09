# Feature D: Reliable daily-puzzle auto-release via Azure Logic App

**Status:** planned, not started. Picked up here because the existing GitHub Actions `schedule:` trigger has *never* autonomously released a puzzle — every released entry (#2, #3, #4) was a manual `workflow_dispatch` by Jan or by Claude. See "Background" below for the receipts.

**Goal:** at Warsaw midnight every day, automatically promote `daily/daily_backlog.json[0]` → `daily/daily_puzzles.json` and let the existing deploy pipeline ship it. Without anyone touching anything.

---

## Background — why we're moving the trigger to Azure

GitHub Actions `schedule:` cron is best-effort and on this repo has been failing badly:

- `release-daily.yml` defines 14 firings/night (every 5 min × 30 min, both DST states). Documented in the workflow header as a defensive burst against late/skipped firings.
- Across the first 3 nights since the workflow shipped (2026-06-07 → 2026-06-10), the *only* successful releases were manual `workflow_dispatch` calls by Jan or Claude. The 4 scheduled firings that *did* run all hit the "already released today" guard because they were beaten to the punch.
- Since `2026-06-09T00:07:07Z` (~46h before this doc was written), **zero scheduled runs of any workflow** have fired on this repo. Cron is just not firing.
- Workflow is `state: active`, not disabled. Repo is highly active. Likely cause: GitHub-side dispatch unreliability under load — the workflow's own docstring already calls this out.

**Decision (2026-06-10):** stop trying to make GitHub cron reliable. Move the *trigger* to Azure (the platform we just moved onto for hosting). Keep the `release-daily.yml` workflow exactly as-is — only swap what fires it. `workflow_dispatch` has been 100% reliable across 6/6 successful invocations; only `schedule:` is broken.

---

## Architecture

```
Azure Logic App (Recurrence trigger, Warsaw midnight)
        │
        ▼  HTTP POST + PAT
GitHub API: /repos/jgrzegrzolka/gridgame/actions/workflows/release-daily.yml/dispatches
        │
        ▼  fires workflow_dispatch
.github/workflows/release-daily.yml (UNCHANGED logic — promote backlog[0], commit, push, kick deploy.yml)
        │
        ▼
.github/workflows/deploy.yml → SWA → live site
```

Logic App is the **only** new piece. Everything downstream is the existing, proven path.

**Why Logic App over Function App with Timer trigger:**
- SWA Free SKU's managed Functions are HTTP-only — a Timer trigger needs a separate Function App + storage account.
- Logic App Consumption is a single resource, no storage account, no build pipeline, no Node code.
- Recurrence trigger has native timezone support (`Central European Standard Time` — follows Polish DST automatically). No two-cron-line DST gymnastics like in the GH workflow.
- Cost: Consumption tier ~$0 at once-daily execution (well under free-grant trigger executions).

**Why not move the catalog to Cosmos/Blob (option C from the discussion):**
- Breaks "the file is the released state" — Jan's stated preference, reinforced in `feedback_prefer_manual_release.md`.
- Loses git history of releases, code review on backlog changes, and `git log` as the audit trail.
- Forces a page rewrite and new API endpoints.
- The problem is the *trigger*, not the storage. Fix the trigger.

---

## Decisions locked (don't relitigate without asking Jan)

- **Trigger source:** Azure Logic App (Consumption tier), Recurrence trigger.
- **Trigger target:** existing `release-daily.yml` workflow via `workflow_dispatch` REST call. No changes to the workflow's promotion logic.
- **Schedule:** once per day at 00:05 Warsaw time. (5 min after midnight, not on the dot — gives a small buffer; reduces clock-skew flakiness; still well within "feels like a daily release at midnight" for any human.)
- **Catalog stays in git.** `daily/*.json` does not move.
- **Existing `schedule:` block in `release-daily.yml`:** **keep it** as belt-and-braces for the first ~2 weeks of Logic App soak. The workflow's own "already released today" guard means double-firing is a no-op. Remove the `schedule:` block only after Logic App has demonstrated 14 consecutive reliable nights. Reduces blast radius if the new trigger has its own surprises.
- **PAT scope:** fine-grained personal access token, repo-scoped to `jgrzegrzolka/gridgame` only, permission `Actions: write`. Nothing else. Stored as a Logic App parameter, not in source.
- **PAT expiration:** 90 days. Calendar reminder for rotation lives in… (open question — see below).
- **Resource naming:** `logic-yetanotherquiz-release-daily` in `rg-yetanotherquiz`, West Europe. Matches the `yetanotherquiz` Azure naming convention.
- **Infrastructure-as-code:** Logic App defined in a Bicep template checked into `infra/logicapp-release-daily.bicep` (new directory — first IaC file in the repo). Deploy via `az deployment group create`. Don't click-ops in the portal — we want this in source.

## Out of scope (do not add now)

- Removing `release-daily.yml`'s `schedule:` block. (Future cleanup after soak period.)
- Monitoring/alerting on Logic App failures. (Add only if we observe failures during soak.)
- Cross-region redundancy. (Single Warsaw user, single region is fine.)
- Migrating other GH cron workflows. (None exist today.)

---

## Azure resources for Feature D (to create)

| Resource | Name | SKU | Notes |
|---|---|---|---|
| Logic App | `logic-yetanotherquiz-release-daily` | Consumption | West Europe, in `rg-yetanotherquiz`. Recurrence trigger + single HTTP action. |
| GitHub PAT | (not an Azure resource) | fine-grained | Repo `jgrzegrzolka/gridgame`, permission `Actions: write` only, 90-day expiry. Stored as Logic App parameter `githubPat`. |

Expected cost: $0/month. Logic App Consumption free grant covers thousands of executions; we use ~31/month.

---

## Phase D1 — mint PAT + scaffold Bicep

- [ ] Mint a GitHub fine-grained PAT:
  - GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token.
  - Resource owner: `jgrzegrzolka` (personal account).
  - Repository access: only select repositories → `jgrzegrzolka/gridgame`.
  - Repository permissions: **Actions: Read and write** (the only thing checked). Everything else stays at default "No access".
  - Expiration: 90 days.
  - Copy the token immediately — GitHub only shows it once.
- [ ] Verify the PAT works locally before putting it in Azure:
  ```
  curl -X POST -H "Authorization: Bearer $PAT" \
    -H "Accept: application/vnd.github+json" \
    -H "X-GitHub-Api-Version: 2022-11-28" \
    https://api.github.com/repos/jgrzegrzolka/gridgame/actions/workflows/release-daily.yml/dispatches \
    -d '{"ref":"main"}'
  ```
  Expect HTTP 204 No Content. A new workflow run should appear in `gh run list --workflow=release-daily.yml`. (It'll hit the "already released today" guard if you've already manually released that day — that's fine, it confirms the PAT works.)
- [ ] Create `infra/` directory and `infra/logicapp-release-daily.bicep` (template — see Phase D2 for the contents).

## Phase D2 — write the Bicep template

`infra/logicapp-release-daily.bicep` should define:

1. A `Microsoft.Logic/workflows` resource (Consumption tier — `sku.name` is implicit, not declared, on Consumption).
2. **Recurrence trigger:**
   - Frequency: `Day`
   - Interval: `1`
   - Schedule: `{ hours: [0], minutes: [5] }`
   - Time zone: `Central European Standard Time` (Windows TZ identifier — yes, that is correct for Warsaw and handles DST).
3. **HTTP action** named `dispatchReleaseDaily`:
   - Method: `POST`
   - URI: `https://api.github.com/repos/jgrzegrzolka/gridgame/actions/workflows/release-daily.yml/dispatches`
   - Headers:
     - `Authorization`: `Bearer @{parameters('githubPat')}`
     - `Accept`: `application/vnd.github+json`
     - `X-GitHub-Api-Version`: `2022-11-28`
     - `User-Agent`: `yetanotherquiz-logicapp` (GitHub requires a UA)
   - Body: `{ "ref": "main" }`
4. **Parameter:** `githubPat` (type: `securestring`). Passed at deploy time, not committed.
5. No managed identity needed — the only outbound call is to GitHub, which uses the PAT.

Use the Bicep file as the single source of truth. Don't click-edit the Logic App in the portal after deploy; round-trip changes through the template.

## Phase D3 — deploy + smoke test

- [ ] Deploy:
  ```
  az deployment group create \
    -g rg-yetanotherquiz \
    -f infra/logicapp-release-daily.bicep \
    -p githubPat=<paste PAT>
  ```
- [ ] Use the Logic App designer's "Run Trigger" → "Run" to fire it on demand. Expect:
  - Logic App run succeeds, HTTP action returns 204.
  - A new `release-daily.yml` workflow run appears in `gh run list`, triggered by `workflow_dispatch`.
  - Workflow either promotes the next puzzle, or skips with "already released today" — both are correct outcomes depending on state.
- [ ] If the on-demand run works, leave the recurrence trigger to fire at 00:05 Warsaw the next 3 nights without touching anything.

## Phase D4 — soak + verification

**Definition of "fixed" — don't claim this until all are true:**

- [ ] 3 consecutive Warsaw nights where Logic App fires at 00:05 and the workflow_dispatch lands a `daily: release #N — auto-promoted from backlog` commit, **without any human running `gh workflow run` or clicking anything**.
- [ ] On at least one of those nights, observe the existing GH `schedule:` firings either don't fire (their usual flakiness) or fire and correctly hit the "already released today" guard — proving belt-and-braces works either way.
- [ ] Verify the deployed catalog visible on `https://www.yetanotherquiz.com/daily/` advances daily without intervention.

Only after all three: write a short note in `## Done` and remove the `schedule:` block from `release-daily.yml` in a follow-up PR.

## Phase D5 — cleanup (after soak)

- [ ] Remove the `schedule:` cron block from `.github/workflows/release-daily.yml`. Keep `workflow_dispatch:` (Logic App needs it) and the `force` input (manual override stays useful).
- [ ] Update the workflow's docstring to describe the new trigger model.
- [ ] Add a Bicep-deploy note to `CLAUDE.md` if useful — minimal, just where the infra lives.

---

## Rollback plan

If the Logic App misfires or starts spamming workflow runs:

1. Portal: disable the Logic App (`logic-yetanotherquiz-release-daily` → Overview → Disable). Stops all future runs immediately.
2. Existing `schedule:` block in `release-daily.yml` remains until Phase D5, so the system reverts to the old (flaky-but-known) behaviour.
3. If a PAT leak is suspected: revoke at GitHub → Settings → Developer settings → PATs. Logic App will start returning 401 from the HTTP action — visible in the run history. Mint a new PAT, redeploy the Bicep with the new value.

---

## Open questions to resolve before starting

- **PAT rotation reminder:** where does it live? Options: (a) Outlook calendar reminder 80 days from issue date, (b) a `pat-rotations.md` checklist in the repo, (c) GitHub's own expiration email (it sends at 7 days remaining). Probably (c) is enough on a personal-scale project. Confirm with Jan.
- **Time zone identifier:** Logic App Recurrence uses **Windows time-zone identifiers** (`Central European Standard Time`), not IANA (`Europe/Warsaw`). Double-check the spelling against an authoritative list when writing the Bicep — typos here silently UTC-default.
- **Soak window length:** 3 nights feels light for "real fix" confidence. Worth 7? Jan to decide.
- **Should the Logic App also trigger `deploy.yml` on success?** No — the existing `release-daily.yml`'s last step already does `gh workflow run deploy.yml --ref main`. Don't add a second path.
