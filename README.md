# gridgame

Static-site country-flag puzzles (daily, find-all, quiz, tic-tac-toe) with a small Azure Functions API for daily-puzzle stats. Lives at <https://www.yetanotherquiz.com>.

## Run locally

Full stack — static site + Functions API + Cosmos round-trips — via the Azure Static Web Apps emulator:

```powershell
npm run dev:swa
```

Then open <http://localhost:4280/>. Ctrl+C to stop.

Opening the HTML files via `file://` won't work — `fetch()` needs HTTP.

First-time setup (Azure Functions Core Tools install, `api/local.settings.json` with `COSMOS_CONN`, etc.) is in [CLAUDE.md → "Local development"](CLAUDE.md).
