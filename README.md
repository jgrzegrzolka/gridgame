# gridgame

Static-site country-flag puzzles (daily, find-all, quiz, tic-tac-toe) with a small Azure Functions API for daily-puzzle stats. Lives at <https://www.yetanotherquiz.com>.

## Setup (one-time)

1. Install **Azure Functions Core Tools v4** as a system tool (npm install is unreliable on Node 20+; use winget):
   ```powershell
   winget install Microsoft.Azure.FunctionsCoreTools
   ```
   Verify in a fresh PowerShell: `func --version` should print `4.x`.
2. Install npm deps at the repo root **and** inside `api/`:
   ```powershell
   npm install
   cd api
   npm install
   cd ..
   ```
3. Create your local env file:
   ```powershell
   cp api/local.settings.json.example api/local.settings.json
   ```
   Fill in `COSMOS_CONN` from the Azure Portal → `swa-yetanotherquiz` → Environment variables (or `az staticwebapp appsettings list -n swa-yetanotherquiz -g rg-yetanotherquiz --query properties.COSMOS_CONN -o tsv`). Leave `TURNSTILE_SECRET` empty — the handler's skip-when-unset branch accepts any token locally. Keep `AzureWebJobsStorage` as the example ships it (`UseDevelopmentStorage=true`) — it points the runtime at Azurite, which `npm run dev` boots for you. `local.settings.json` is gitignored.

> **Heads up:** the local Functions runtime talks to **real prod Cosmos** by default — writes you make locally land in shared rows (they're tagged `local: true` server-side so the stats aggregator filters them out, but they still take up space). Fine for tiny traffic; see [CLAUDE.md](CLAUDE.md) for the longer trade-off. The dev reset toolbar (below) cleans them up.

## Run locally

```powershell
npm run dev
```

Opens at <http://localhost:4280/>. Boots SWA emulator + Azurite (local Azure Storage emulator) + the PartyKit dev server (`ws://localhost:1999/`, used by tic-tac-toe online) together via `concurrently`; log lines are prefixed `[swa]` / `[azurite]` / `[party]`. Ctrl+C stops all three.

Opening the HTML files via `file://` won't work — `fetch()` needs HTTP.

Narrower modes if you don't need everything:

- `npm run dev:swa` — site + API + Azurite, no PartyKit. Use this for daily/flagQuiz work; saves the partykit-dev memory.
- `npm run dev:api` — Functions only at `http://localhost:7071/api/*`. Does **not** start Azurite; run `npm run dev:azurite` in another terminal first if you want quiet logs.
- `npm run dev:party` — PartyKit only at `ws://localhost:1999/`. Use this for TTT-server-only work.

### Dev reset toolbar

On the daily + archive pages a small yellow toolbar appears bottom-left **only when the hostname is `localhost` / `127.0.0.1` / `::1`**. Two buttons:

- **Reset browser** — clears the five daily-flow localStorage keys (`gridgame.deviceId`, `gridgame.submittedPuzzles`, `daily.scores`, `gridgame.ideas.reviewed`, `gridgame.nickname`) and reloads. Use it to replay puzzles cleanly without 409s.
- **Clear Cosmos local rows** — deletes every `dailyResults` doc tagged `local: true` from prod Cosmos. The endpoint is server-gated to localhost-only (refuses 403 elsewhere), so the button is safe.

Both are no-ops in prod — the hostname gate ensures the toolbar never renders, and the endpoint refuses even if hit directly.

For deeper notes (Azurite trade-offs, why we don't use `@azure/cosmos`, how routes register, etc.) see [CLAUDE.md → "Local development"](CLAUDE.md) and the "API / Azure Functions" section above it.
