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

### Feature A: Migrate site hosting to Azure SWA

**Goal:** the existing gridgame site (currently on GitHub Pages) is deployed to and served by Azure Static Web Apps. GitHub Pages deploy is retired. No new game features; this ships on its own as "site is now on Azure."

**Why this comes first:** before adding API + Cosmos features (Feature B), prove SWA hosts the existing static site correctly. Smaller change, isolated risk, builds Azure muscle memory.

**Azure resources for Feature A:**

| Resource | Name | SKU | Notes |
|---|---|---|---|
| Resource group | `rg-yetanotherquiz` | — | West Europe |
| Static Web App | `swa-yetanotherquiz` | Free | Hostname: `black-dune-0ebd24603.7.azurestaticapps.net`. Unlinked from GitHub for now — Phase A2 wires it. |

**Phase A1 — Azure infra** *(no app changes; site keeps serving from GitHub Pages)*

- [x] Create resource group `rg-yetanotherquiz` (West Europe).
- [x] Create SWA `swa-yetanotherquiz` (Free SKU) — unlinked.

**Phase A2 — Deploy pipeline migration** *(this is where the site actually moves)*

- [ ] Branch off `main` (run `git checkout main && git pull` first).
- [ ] Get SWA deployment token: `az staticwebapp secrets list -n swa-yetanotherquiz -g rg-yetanotherquiz --query "properties.apiKey" -o tsv`. Add to GitHub repo secrets as `AZURE_STATIC_WEB_APPS_API_TOKEN` (Jan does this in the GitHub UI).
- [ ] Rewrite `.github/workflows/deploy.yml`:
  - Keep `test` and `typecheck` jobs as-is.
  - In `deploy` job: keep cache-bust, strip-preview-files, and minify steps as-is.
  - Replace `actions/upload-pages-artifact` + `actions/deploy-pages` with `Azure/static-web-apps-deploy@v1`. Inputs: `app_location: "."`, `api_location: ""` (no API yet in Feature A), `output_location: ""`, `skip_app_build: true`.
  - Remove `concurrency: pages` group (no longer applicable).
- [ ] Push branch, open PR. CI runs test + typecheck. Once merged to `main`, the workflow runs against `main` and deploys to SWA.
- [ ] Verify: visit `https://black-dune-0ebd24603.7.azurestaticapps.net` — every page (`/`, `/daily/`, `/flagQuiz/`, `/findFlag/`, `/flagsdata/`) loads, daily puzzle works end-to-end, PartyKit-backed games still connect.
- [ ] Decide with Jan: cut over `github.io` immediately (remove the old workflow path) or run both for a week as fallback. Default: cut over.
- [ ] Update `CLAUDE.md` "Where things live" with the SWA hosting note + naming convention.

**Phase A3 — Cleanup**

- [ ] If the GitHub Pages path stays disabled cleanly after a week, delete the leftover `upload-pages-artifact` / `deploy-pages` references and the `pages` permissions in the workflow.
- [ ] Repoint custom domain (if/when one is added).

---

### Feature B: Daily challenge — global stats ("compare with other users")

**Status:** parked until Feature A merges. Cosmos resources have been pre-created (see below) but are unused until then.

**Goal:** after a player finishes their daily challenge, show per-flag find rates aggregated from everyone who attempted the same puzzle. Primary UI is a table below the existing found / missed lists.

**Decisions locked (don't relitigate without asking Jan):**

- **Identity:** anonymous UUID in `localStorage` (`gridgame.deviceId`). No login. Cosmos document `id = "{puzzleId}:{deviceId}"` enforces single-submission-per-device.
- **Abuse defenses:** Cloudflare Turnstile (invisible CAPTCHA, free, vendor-neutral — Azure has no managed CAPTCHA on free SKUs) + server-side sanity bounds + simple per-IP rate limit (in-memory counter in the Function is fine for low traffic).
- **When stats appear:** only after the player submits their own result for that puzzle. Same rule in archive. Keeps the play-to-see-stats incentive.
- **Distribution one-liner** ("You: 3/5 — median today: 3, top: 5/5 by 12%") is Phase B5, not Phase B4. MVP ships without it.

**Out of scope for v1** (decide later, do not add now): usernames / accounts, leaderboards, friend comparison, cross-puzzle streaks, time percentile UI.

**Endpoints (v1):**

- `POST /api/v1/daily/result` — body `{puzzleId, foundMask, durationMs, deviceId, turnstileToken}`. Response 204 on success, 409 on duplicate, 400 on bad input, 429 on rate-limited.
- `GET  /api/v1/daily/stats/{puzzleId}` — response `{totalAttempts, perFlagFinds: number[], median, topPct}`. (`median` and `topPct` populated in Phase B3 even though they're not rendered until Phase B5.)

**Azure resources for Feature B** (pre-created 2026-06-09):

| Resource | Name | SKU | Notes |
|---|---|---|---|
| Cosmos DB account | `cosmos-yetanotherquiz-jg` | Provisioned, **Free Tier ON** | NoSQL API, West Europe. 1000 RU/s + 25 GB free *forever*. One free-tier account per subscription — this is it; future features share it. |
| Cosmos DB database | `yetanotherquiz` | shared | Generic, future features share it. |
| Cosmos DB container | `dailyResults` | manual 400 RU/s | Partition key `/puzzleId`. Within the free 1000 RU/s. |
| SWA app setting | `COSMOS_CONN` | — | Connection string with primary key. Rotate via `az cosmosdb keys regenerate -n cosmos-yetanotherquiz-jg -g rg-yetanotherquiz --key-kind primary` then re-set on SWA. |

**Cosmos document shape:**

```json
{
  "id": "2026-06-09:c8f3...uuid",
  "puzzleId": "2026-06-09",
  "deviceId": "c8f3...uuid",
  "foundMask": 13,
  "durationMs": 87000,
  "submittedAt": 1717920000000
}
```

Aggregation query (single-partition, cheap): `SELECT VALUE c.foundMask FROM c WHERE c.puzzleId = @pid` — reduce in code.

**Phase B1 — Cosmos infra**

- [x] Create Cosmos account `cosmos-yetanotherquiz-jg` with `--enable-free-tier true`, NoSQL, single region, Session consistency.
- [x] Create database `yetanotherquiz` + container `dailyResults` (PK `/puzzleId`, 400 RU/s).
- [x] Set `COSMOS_CONN` in SWA app settings.

**Phase B2 — Submit endpoint + abuse defenses**

- [ ] Add `api/dailyResult/` Function (POST /api/v1/daily/result).
- [ ] Pure-function module `api/lib/validate.js` for body schema + sanity bounds (puzzle-id regex confirmed by reading `daily/scores.js` / `daily/playFlow.js`, foundMask < `1 << numFlags`, durationMs between 1s and 6h). Add `validate.test.js`.
- [ ] Cosmos client via `@azure/cosmos`. Connection string from `process.env.COSMOS_CONN`.
- [ ] Verify Turnstile token server-side. Add `TURNSTILE_SECRET` to SWA app settings (don't commit).
- [ ] Insert doc with `id = "{puzzleId}:{deviceId}"`. Cosmos 409 on duplicate → translate to HTTP 409.
- [ ] In-memory per-IP rate limit in the Function (5 req/min). Reset on cold start is fine at this traffic.

**Phase B3 — Fetch endpoint + caching**

- [ ] Add `api/dailyStats/` Function (GET /api/v1/daily/stats/{puzzleId}).
- [ ] Query: `SELECT VALUE c.foundMask FROM c WHERE c.puzzleId = @pid` — single-partition, cheap.
- [ ] Pure aggregator `api/lib/aggregate.js`: `aggregate(masks, numFlags) → {totalAttempts, perFlagFinds, median, topPct}`. Add tests.
- [ ] In-memory cache per Function instance, keyed by puzzleId, TTL 60s.
- [ ] Verify with `curl` after seeding test rows.

**Phase B4 — Client integration on finish screen** *(feature first visible)*

- [ ] `daily/identity.js`: generate UUID, store as `localStorage.gridgame.deviceId`. Tests.
- [ ] Embed Turnstile widget in `daily/index.html` (managed/invisible mode). Site key in HTML.
- [ ] On finish (in `daily/playFlow.js` or wherever the finish screen renders): POST to `/api/v1/daily/result` with Turnstile token. Fire-and-forget on failure — never block the finish screen.
- [ ] Fetch `/api/v1/daily/stats/{puzzleId}`. Render per-flag table below found/missed lists. Match existing daily list styling — grep `daily/index.css` and sibling pages first per CLAUDE.md UI-consistency rule.
- [ ] Loading + failure states: skeleton row while fetching, table just doesn't render on error.
- [ ] Extract pure render logic to a sibling module + tests (per "proactive testing" feedback).
- [ ] Browser-test E2E. `npm run validate`.

**Phase B5 — Distribution one-liner**

- [ ] Render `You: X/N — median today: M, top: P% got N/N` above the per-flag table. Data already in `/stats` from Phase B3.
- [ ] i18n: en + pl strings, match existing daily i18n approach.
- [ ] Pure-function formatter + tests.

**Phase B6 — Archive integration** *(optional — confirm with Jan before starting)*

- [ ] On `daily/archive.html`, when opening a past puzzle the device already submitted, fetch and render the same stats table.
- [ ] Skip the table for puzzles never submitted (keeps the play-to-see-stats incentive).
- [ ] Open question for Jan: should archive also show the device's own found_mask alongside the new stats?

---

## Done

(empty)
