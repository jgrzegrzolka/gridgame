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

### Feature B: Daily challenge — global stats ("compare with other users")

**Status:** ready to start. Feature A (hosting migration) shipped 2026-06-09 — site is live on Azure SWA at `https://www.yetanotherquiz.com`. Cosmos resources for Feature B were pre-created during Feature A and are sitting idle.

**Goal:** after a player finishes their daily challenge, show per-flag find rates aggregated from everyone who attempted the same puzzle. Primary UI is a table below the existing found / missed lists.

**Decisions locked (don't relitigate without asking Jan):**

- **Identity:** anonymous UUID in `localStorage` (`gridgame.deviceId`). No login. Cosmos document `id = "{puzzleId}:{deviceId}"` enforces single-submission-per-device.
- **Abuse defenses:** Cloudflare Turnstile (invisible CAPTCHA, free, vendor-neutral — Azure has no managed CAPTCHA on free SKUs) + server-side sanity bounds + simple per-IP rate limit (in-memory counter in the Function is fine for low traffic).
- **When stats appear:** only after the player submits their own result for that puzzle. Same rule in archive. Keeps the play-to-see-stats incentive.
- **Distribution one-liner** ("You: 3/5 — median today: 3, top: 5/5 by 12%") is Phase B5, not Phase B4. MVP ships without it.

**Out of scope for v1** (decide later, do not add now): usernames / accounts, leaderboards, friend comparison, cross-puzzle streaks, time percentile UI.

**Endpoints (v1):**

- `POST /api/v1/daily/result` — body `{puzzleId, foundCodes, totalCount, durationMs, deviceId, turnstileToken}`. Response 204 on success, 409 on duplicate, 400 on bad input, 429 on rate-limited.
  - `puzzleId` is the integer `n` from `daily/daily_puzzles.json` (the catalog key — *not* a date).
  - `foundCodes` is `string[]` of 2-letter country codes — mirrors what `daily/scores.js` already keeps in `c`. Earlier plan said `foundMask` (a bitmask over a canonical answer order); switched to codes because codes are self-describing and don't break when a puzzle's answer list changes.
- `GET  /api/v1/daily/stats/{puzzleId}` — response `{totalAttempts, perCodeFinds: {[code]: count}, median, topPct}`. (`median` = median total-found, `topPct` = % of submissions that found everything. Populated in Phase B3 even though only rendered in Phase B5.)

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
  "id": "7:c8f3...uuid",
  "puzzleId": 7,
  "deviceId": "c8f3...uuid",
  "foundCodes": ["ch", "dk", "gb"],
  "totalCount": 9,
  "durationMs": 87000,
  "submittedAt": 1717920000000
}
```

Aggregation query (single-partition, cheap): `SELECT VALUE c.foundCodes FROM c WHERE c.puzzleId = @pid` — reduce in Function code to `{[code]: count}` + `totalAttempts` + `median` + `topPct`.

**Phase B1 — Cosmos infra**

- [x] Create Cosmos account `cosmos-yetanotherquiz-jg` with `--enable-free-tier true`, NoSQL, single region, Session consistency.
- [x] Create database `yetanotherquiz` + container `dailyResults` (PK `/puzzleId`, 400 RU/s).
- [x] Set `COSMOS_CONN` in SWA app settings.

**Phase B2 — Submit endpoint (split across multiple PRs after the SWA Functions plumbing fought us)**

*Phase B2a — `api/` skeleton + `/api/health`* (#284). Done. Validated the SWA-bundled Functions deploy path.

*Phase B2b — `POST /api/v1/daily/result`, validate-only* (#285 → #290 → #292 → #293). Done after a long debug saga — see "Lessons from B2b" below. Currently lands a 204 on a valid body and a 400 (with stable `error` code) otherwise. No Cosmos call yet.

*Phase B2c — Restore the Cosmos insert.* Next up. Re-adds `@azure/cosmos` and replaces the 204 with an insert into `dailyResults`. 409 on duplicate `(puzzleId, deviceId)`. Module-scoped client cache for warm invocations.

*Phase B2d — Abuse defenses.* After B2c lands:
- Verify Cloudflare Turnstile token server-side. `TURNSTILE_SECRET` in SWA app settings.
- In-memory per-IP rate limit in the Function (5 req/min). Reset-on-cold-start is fine at this traffic.

**Lessons from B2b (don't relearn these):**
1. **`api/package.json` must pin `"type": "commonjs"`.** Without it the Azure runtime inherits the root package.json's `"type": "module"` and starts treating `require()` as ESM-interop. Symptom: `require(...)` returns `{ __esModule, default }` instead of named exports.
2. **`scripts/minify.mjs` skips `api/`.** It runs esbuild with `format: 'esm'` on every `.js` it finds. If it touches api/ Function code, it mangles the requires into invalid ESM and the Function host fails to load anything. Symptom (after CommonJS pin is in place): every `/api/*` route 404s.
3. **`lib/` belongs under `api/src/lib/`, not `api/lib/`.** Oryx's v4 packaging walks from `package.json` `main` and drops anything outside the resolved set.

**Phase B3 — Fetch endpoint + caching**

- [ ] Add `api/src/functions/dailyStats.js` (GET /api/v1/daily/stats/{puzzleId}).
- [ ] Query: `SELECT VALUE c.foundCodes FROM c WHERE c.puzzleId = @pid` — single-partition, cheap.
- [ ] Pure aggregator `api/src/lib/aggregate.js`: `aggregate(rows) → {totalAttempts, perCodeFinds, median, topPct}`. Add tests.
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
- [ ] Open question for Jan: should archive also show the device's own foundCodes alongside the new stats?

---

## Done

### Feature A: Migrate site hosting to Azure SWA — *shipped 2026-06-09*

GitHub Pages → Azure Static Web Apps (Free SKU). Public URL `https://www.yetanotherquiz.com` (apex 301-redirects to www via Cloudflare). Resources: `rg-yetanotherquiz`, `swa-yetanotherquiz`. Permanent hosting facts moved to `CLAUDE.md` "Hosting" section; PR #281 + #282 + the wrap-up PR have the implementation history.
