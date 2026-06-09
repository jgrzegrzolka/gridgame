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

- **Identity (v1):** anonymous UUID per browser. See the *Identity model* section below for the full picture, including the future upgrade path. Cosmos document `id = "{puzzleId}:{deviceId}"` enforces single-submission-per-device.
- **Abuse defenses:** Cloudflare Turnstile (invisible CAPTCHA, free, vendor-neutral — Azure has no managed CAPTCHA on free SKUs) + server-side sanity bounds + simple per-IP rate limit (in-memory counter in the Function is fine for low traffic).
- **When stats appear:** only after the player submits their own result for that puzzle. Same rule in archive. Keeps the play-to-see-stats incentive.
- **Distribution one-liner** ("You: 3/5 — median today: 3, top: 5/5 by 12%") is Phase B5, not Phase B4. MVP ships without it.

**Out of scope for v1** (decide later, do not add now): usernames / accounts, leaderboards, friend comparison, cross-puzzle streaks, time percentile UI.

**Identity model:**

*v1 (this feature):* anonymous UUID per browser.
- On first visit to www.yetanotherquiz.com, the client generates `crypto.randomUUID()` and stores it as `localStorage.gridgame.deviceId`.
- The server trusts the string (validated 8–64 chars, nothing else) and uses it in the Cosmos `id` to enforce single-submission per (puzzle, device).
- **What it gives:** same browser = same identity; one submission per puzzle; zero PII, zero ceremony.
- **What it explicitly does *not* give:** cross-device (phone + laptop = two identities); resilience to "clear site data"; spoof-proof (curl can post any deviceId); tied-to-person (shared family browser = shared identity). These are acceptable for a daily flag puzzle — the value is the game, not the identity.

*Future Feature C — cross-device identity via WebAuthn passkey* (parked, not blocking anything):
- One "Save my progress across devices" button on the finish screen. Click → OS prompts for Face ID / Touch ID / Windows Hello → cryptographic keypair created. Server stores `(identityId, publicKey)`. No password, no email, no third party (not OAuth, not "log in with Google").
- Cross-device works for free via iCloud Keychain / Google Password Manager / 1Password syncing the private key.
- Storage-shape compatibility: add an optional `identityId` field to the existing dailyResult docs. Anonymous rows stay valid. When a user creates a passkey, backfill their existing UUID's rows with the new `identityId`. Stats queries can opt to dedupe by identityId where present, deviceId otherwise.
- Server library: `@simplewebauthn/server` (battle-tested, Node-native). We'd consume, not implement crypto from scratch.

*Explicitly NOT going to do:*
- **Browser fingerprinting** (UA + canvas + screen) — GDPR risk, breaks on Safari/Brave, ~70% accurate.
- **IP-based** — high false-positive rate on NAT/mobile.
- **OAuth (Google / GitHub / etc.)** — defeats the "no registration" intent.
- **Magic-link email** — requires email infra + user action; passkey is the better cross-device path.

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

*Phase B2c — Cosmos insert via REST* (#296). Done. Replaced the `@azure/cosmos` SDK with a small REST client in `api/src/lib/cosmos.js` because the SDK reliably triggered SWA's "Failure during content distribution" at deploy time (see Lessons #4). 9 unit tests cover connection-string parsing and signature determinism. End-to-end verified: 204 on success, 409 on duplicate, 400 on bad bodies.

*Phase B2d — Abuse defenses.*
- [x] In-memory per-IP rate limit in the Function (5 req/min, fixed window). Module-scope `Map` keyed by `x-forwarded-for` first entry. 429 + `Retry-After` header on breach. Reset-on-cold-start is fine at this traffic. (`api/src/lib/rateLimit.js`)
- [x] Verify Cloudflare Turnstile token server-side. Pure `verifyTurnstile({secret, token, remoteIp, fetchImpl})` in `api/src/lib/turnstile.js` (fetch injected for tests). Handler returns 403 `turnstile_failed` on a bad token. **Skip-when-unset:** if `TURNSTILE_SECRET` isn't configured, verification is skipped with a warning log — lets local dev work; production has it set. Site key for the HTML widget (B4): `0x4AAAAAADhdZ-XDzVHaLk9R`. ⚠️ When rotating the **secret** in Cloudflare, the **site key also changes** — both must be updated in lockstep (lesson from B4 hotfix).

**Lessons from B2 (don't relearn these):**
1. **`api/package.json` must pin `"type": "commonjs"`.** Without it the Azure runtime inherits the root package.json's `"type": "module"` and starts treating `require()` as ESM-interop. Symptom: `require(...)` returns `{ __esModule, default }` instead of named exports.
2. **`scripts/minify.mjs` skips `api/`.** It runs esbuild with `format: 'esm'` on every `.js` it finds. If it touches api/ Function code, it mangles the requires into invalid ESM and the Function host fails to load anything. Symptom (after CommonJS pin is in place): every `/api/*` route 404s.
3. **`lib/` belongs under `api/src/lib/`, not `api/lib/`.** Oryx's v4 packaging walks from `package.json` `main` and drops anything outside the resolved set.
4. **Don't use `@azure/cosmos`.** Every version we tried triggered SWA's "Failure during content distribution" at deploy time, even after the three landmines above were fixed. We talk to Cosmos via REST instead (`api/src/lib/cosmos.js`) — HMAC-SHA256 auth with `node:crypto`, no third-party crypto deps, ~80 LOC. The REST surface for our use case is one POST.

**Phase B3 — Fetch endpoint + caching**

- [x] Add `api/src/functions/dailyStats.js` (GET /api/v1/daily/stats/{puzzleId}).
- [x] Query: `SELECT c.foundCodes, c.totalCount FROM c WHERE c.puzzleId = @pid` — single-partition, cheap. (Pulls `totalCount` too so the aggregator can compute `topPct` without a second round-trip; `SELECT VALUE c.foundCodes` from the original plan would have lost it.)
- [x] Pure aggregator `api/src/lib/aggregate.js`: `aggregate(rows) → {totalAttempts, perCodeFinds, median, topPct}`. 12 tests.
- [x] In-memory cache per Function instance (`api/src/lib/ttlCache.js`), keyed by puzzleId, TTL 60s. Also sets `Cache-Control: public, max-age=60` so browser/edge cache the same window.
- [ ] Verify with `curl` after seeding test rows.

**Caching:** 60s server-side cache + matching `Cache-Control: public, max-age=60` so browser/edge cache the same window. **Bypass after own submit:** the client sends `?fresh=1` on the GET fired by `handleFinish` (immediately after a 204 POST), the server skips the cache lookup, then writes the fresh result back so subsequent GETs (from other players, this player's revisits) get the up-to-date snapshot without their own bypass. `?fresh=1` responses are `Cache-Control: no-store` so the browser doesn't memoize the bypass. Revisits use the default cached path.

**Temporary testing toggle: `DAILY_RESULT_UPSERT`.** When this env var is `true` on the SWA, `dailyResult` upserts into Cosmos instead of insert-only — replays update the stored row rather than 409'ing. **Currently ON for testing** so the stats panel reflects each player's latest replay, keeping localStorage and Cosmos in sync per device. **Plan to flip OFF** to lock in first-attempt-only stats once the feature feels right (no code change needed — just unset the env var in the Azure portal).

**Cosmos REST query support:** `queryDocs` added to `api/src/lib/cosmos.js`. Pagination via `x-ms-continuation` handled (accumulates all pages). Single-partition only — cross-partition isn't exposed because we don't need it.

**Phase B4 — Client integration on finish screen** *(feature first visible)*

**Retry contract (read this before writing code — it's the part the server-side already enforces):**

- **The server stores first-attempt only.** `dailyResult` Function 409s on duplicate `(puzzleId, deviceId)`. This is by design — stats are honest only if "12% got 5/5" means "12% solved it on their *first* try." If we upserted, everyone would replay until 5/5 and the top percentile would saturate.
- **Local replay still works exactly like today.** `daily/scores.js` already overwrites the localStorage record on replay (see the comment at the top of that file). Don't change that — players replay to learn, their personal archive should show their latest attempt.
- **The client POSTs on every finish — including replays. No client-side gate.** An earlier version of `statsSubmit.js` gated on `hasSubmitted(n)` as a "don't waste a round-trip when we know it'll 409" optimization, but that gate prevented the server's upsert path from doing its job (the second POST never reached the server, so the row never got replaced). The gate is gone — the server is the source of truth for dedup in both modes (insert: 409 on duplicate; upsert: replaces). `submitted.js` is still used by the **revisit branch** in `page.js` to decide whether to show the stats panel without re-POSTing.
- **Treat 204 and 409 as equivalent locally.** If we POST a duplicate (replay, or user cleared the submitted-flag but kept the deviceId), 409 means "the server already has this" — same end state as 204 for the client. Mark submitted and render stats.

**Tasks:**

- [x] `daily/identity.js`: generate UUID (`crypto.randomUUID()`), store as `localStorage.gridgame.deviceId` (sticky after first call). Tests. (PR #304)
- [x] Track "submitted to server" per puzzle in localStorage. `daily/submitted.js` — separate `localStorage.gridgame.submittedPuzzles` set. Tests. (PR #304)
- [x] Embed Turnstile widget in `daily/index.html` (size: invisible). Site key `0x4AAAAAAAhdZ-XDzVHaLk9R` in `daily/page.js` as a public const. CF SDK lazy-loaded by `daily/turnstileClient.js` only when needed.
- [x] On finish: `daily/statsSubmit.js` POSTs to `/api/v1/daily/result` with Turnstile token + body. Treats 204 and 409 as success → marks submitted. Fire-and-forget on failure — never blocks the finish screen.
- [x] Fetch `/api/v1/daily/stats/{puzzleId}` and render per-flag table. Reuses `.find-stats` (added to the shared grid rule in `findFlag/index.css` next to `.find-result-found` / `.find-missed`). Each tile carries a bottom-strip percentage. Sorted hardest first.
- [x] Loading + failure states: small "Loading stats…" placeholder while fetching; container hides silently on any error so the rest of the result page still works.
- [x] Pure render extracted to `daily/statsRender.js` with 10 tests (uses `container.ownerDocument` so a fake-doc test rig has no globals to set up).
- [x] `npm run validate` — 870 tests, all green; typecheck clean. Browser E2E in production after merge (no SWA preview env wired up).

**Retry contract as implemented:**
- POST gated by `hasSubmitted(n)` *inside* `submitResult` (the gate is in one place, not scattered at call sites). 204/409 → mark submitted. The `isReplay` check used to gate `onFinish` in `page.js` — removed because it suppressed self-healing retries when the first POST failed.
- Stats panel only renders when the player has submitted (or just attempted to and got 204/409). The revisit branch in `page.js` checks `hasSubmitted` directly; the finish branch in `handleFinish` checks `submitResult`'s outcome — keeps the play-to-see-stats incentive intact.
- Turnstile token fetched at finish time (not page-load), via `getTurnstileToken()` which reuses an unexpired token if present or runs `execute()` for a fresh one. The widget is rendered with `execution: 'execute'` so it does *not* auto-challenge at render time (lesson from B4 hotfix: default mode + manual execute is a silent-hang trap). Token failure (script blocked, CF rejected) silently skips the POST and the stats render — the player keeps their local score.

**Phase B5 — Distribution one-liner** *(partial — see B7 for the planned upgrade)*

- [x] Pure-function formatter + tests (`daily/distributionSummary.js`).
- [x] i18n: en + pl strings.
- [x] Render headline below the per-flag overlays: **`Average today: 2.5/6`** (one line, plus the caption explaining the per-tile %s).
- **Departures from the original FEATURE.md sketch:**
  - Word "Median" → "Average" (plain-English; the value is still the median internally, the better robust-typical measure).
  - Dropped the "X% got everything" trailer entirely. At low N, `topPct = 0` was noise; even at higher N it was buried at the end of a long line.
  - Dropped the originally-shipped "X plays · Hardest: <country> (Y% found)" second line. At early-traffic N values (1-10) both pieces felt awkward: "3 plays" admits low traffic, and "12% found" with N=3 is misleadingly precise (only 0/33/67/100% are possible).
  - The per-tile percentage overlays still carry per-flag detail.

**Phase B7 — Player-percentile headline** *(future, when traffic justifies it)*

- [ ] Replace / supplement the headline with `You're in the top X% of players today` — meaningful at any N once the distribution exists. Player's percentile based on found-count rank.
- [ ] Server change: extend the stats endpoint to return a small distribution (count of submissions at each found-count: `{ "0": 3, "1": 5, "2": 12, ... }`). Cheap query (`SELECT COUNT(*) GROUP BY ...`); no schema change; existing rows are sufficient (no replays needed — every row already has `foundCodes + totalCount`).
- [ ] Client: aggregate to percentile given the player's own score + the distribution.
- [ ] Decide when to show plain "Average today" vs the percentile (probably percentile from N ≥ ~10, average always).

**Phase B6 — Archive integration** *(optional — confirm with Jan before starting)*

- [ ] On `daily/archive.html`, when opening a past puzzle the device already submitted, fetch and render the same stats table.
- [ ] Skip the table for puzzles never submitted (keeps the play-to-see-stats incentive).
- [ ] Open question for Jan: should archive also show the device's own foundCodes alongside the new stats?

---

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

**Why not OAuth / magic-link / fingerprinting:** see the "Identity model" section under Feature B.

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

### Feature A: Migrate site hosting to Azure SWA — *shipped 2026-06-09*

GitHub Pages → Azure Static Web Apps (Free SKU). Public URL `https://www.yetanotherquiz.com` (apex 301-redirects to www via Cloudflare). Resources: `rg-yetanotherquiz`, `swa-yetanotherquiz`. Permanent hosting facts moved to `CLAUDE.md` "Hosting" section; PR #281 + #282 + the wrap-up PR have the implementation history.
