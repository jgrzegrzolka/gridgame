# Design context

A factual brief on the existing product for a designer new to the codebase. No
recommendations. Everything here is observable in the repo as of 2026-08-01.

## 1. What the product is, and who uses it

**Yet Another Quiz** (repo name `gridgame`) is a free browser game site about
country flags. Live at `https://www.yetanotherquiz.com`.

- **Delivery:** a static site (hand-written HTML + ES modules + plain CSS, no
  framework, no build step beyond a deploy-time cache-bust rewrite), hosted on
  Azure Static Web Apps. A small Azure Functions API (`api/`) stores daily-puzzle
  results and stats. A PartyKit WebSocket server powers the two live multi-device
  modes (online tic-tac-toe, Flag Party).
- **Content:** 269 entries in `flags/countries.json` (sovereign states,
  territories, and other flags), one SVG per entry, plus 39 world-metric data
  files (`flags/metrics/*.json` — population, area, GDP, forest cover, coffee,
  Olympic medals, happiness, and so on).
- **Users:** anonymous casual players. There is no signup, no password, no email.
  Identity is a device id generated into `localStorage`; a player may optionally
  set a nickname (which generates a deterministic avatar), and may link a second
  device by scanning a QR code. Nothing is gated behind identity — every game is
  playable with no state at all.
- **Languages:** English and Polish only.
- **Audience shape implied by the code:** phone-first, drop-in play. The daily
  puzzle is the promoted entry point (the home hero's only CTA); the other three
  games are a secondary list. Party and online tic-tac-toe assume several people
  in the same room, each on their own phone.

## 2. Screens and routes

18 HTML entry points. Every page shares the same chrome (see §3) and follows the
same pattern: markup-only HTML, a sibling `page.js` exporting one `bootX()`
function, a sibling `index.css`.

Two pages under `/daily/` (`backlog/`, `ideas/`) are author-only preview tools,
not linked from anywhere in the player-facing navigation.

### `/` — Home
Purpose: landing and routing. A static hero (headline, subtitle, a row of four
animated invented-flag "stamps", the "Today's puzzle" CTA, and a `No. N` caption
computed client-side from the launch date), then a three-item list linking to
60s Quiz, Party, and Tic Tac Toe.
States: one. The page deliberately fetches nothing, so it has no loading, empty,
or error state.

### `/daily/` — Daily puzzle
Purpose: one puzzle per day, identical for everyone, released at Warsaw midnight.
The player is given a criterion (e.g. "flags with a star, in Africa") and types
country names to find every flag that matches.
Layout while playing: header (puzzle number · criteria title · `found / total`),
a row of 7 hearts, a text input with a suggestion dropdown, a grid of found flag
tiles, and the bottom dock (Give up · Previous puzzles · Home).
Key states:
- **Loading** — game section hidden, nothing shown until the catalog resolves.
- **Error / not-found** — a single message screen (`#daily-state`) covering
  "puzzle not found", "invalid filter", "no targets".
- **Correct answer** — the flag appears as a tile in the found grid; the counter
  advances.
- **Wrong answer** — the input border flashes pink for 700 ms, then clears; one
  heart hollows out. On the last life the heart row pulses (it does not turn red).
- **Give up / out of lives / all found** → result.
- **Revisit** — a completed puzzle jumps straight to the result screen, with the
  hearts row rebuilt from the saved record.
- **Result** — score line, personal stats block (score · community average ·
  streak, plus a share button on touch devices), `Found` and `Missed` grids with
  a per-flag community find-rate strip on each tile, a community callout line
  (easiest / hardest flag with %), and a "most common mistake" rail that is
  collapsed to repeated mistakes with a "show all (N)" toggle.
- **Community stats pending** — a "Loading stats" line with animated dots; the
  player's own score paints immediately and does not wait on it.
- **Community stats failed** — the result stands; the average and callout simply
  never appear.

### `/daily/archive.html` — Previous puzzles
Purpose: grid of past puzzles with the player's saved result on each.
States: list, and an empty state ("No puzzles yet.").

### `/daily/backlog/`, `/daily/ideas/` (+ `play.html` each) — author preview
Purpose: internal review of unpublished puzzles and generated candidates. Reuse
the daily play flow verbatim.

### `/findFlag/` — Make a puzzle
Purpose: the player builds a custom puzzle from filters, then plays it or shares
the URL.
Layout: a chooser of filter sections (continent, colours, motifs, statehood,
a "colour count" control, and the shared metric hub for statistic thresholds),
then `Play` (primary) and `Random` (secondary).
Key states:
- **Chooser, nothing picked** — `Play` disabled.
- **Chooser, 0 matches** — `Play` stays disabled; live match counts sit on the
  controls.
- **Playing** — same header / input / suggestion / tile-grid mechanics as the
  daily, minus hearts (no life limit).
- **Result** — `Found` / `Missed` grids, share button, dock (Random · Make
  another puzzle · Home).
- **Shared link whose filters intersect to nothing** — falls back to the chooser
  instead of starting an unwinnable game.

### `/flagQuiz/` — 60s Quiz
Purpose: rapid multiple-choice. Four decks (`flags`, `weird`, `outlines`,
`facts`) × three modes (`60s` timed with a 4 s wrong-answer penalty, `10q`,
`all`).
Layout: a timer line carrying the deck indicator and mode, the prompt (country
name, or a map contour for the Outlines deck), and a grid of answer choices.
Key states: loading question · correct pick · wrong pick (the wrong tile gets a
country-name band so the player learns what they hit) · timer expiry · give up ·
result (final score, time, personal best, and today's leaderboard). The
leaderboard itself has loading, empty ("Be the first!"), and populated states.

### `/flagQuiz/stats/` — Personal records
Purpose: a grid of chips, one per deck × mode, showing the best score and time.
States: a filled chip (score tinted by performance), an untouched slot (faded,
showing "Play" as a call to action), and a hard failure state that replaces the
page body with "Failed to load: …".

### `/flagParty/` — Flag Party
Purpose: a multi-round quiz show for several people in one room, each on their
own phone, with a host device. The longest state machine in the product; the
same `<main>` swaps between seven sections.
Screens: **Start** (create / join by 5-character room code / "back into your
game" resume button) → **Lobby** (room code + invite share, seat list, an
"add bot" seat with a three-level difficulty control, and a host setup card:
first-round mode as a radiogroup with a "covered start" switch, plus game length
or "even picks") → **Round card** (a short beat announcing the round, with a
countdown ring) → **Question** (a draining timer bar, the prompt, the answer
grid) → **Reveal** (shares the question screen; adds name bands, an optional
bar chart with a unit line, and a "hold to read" control) → **Draft pick** (the
picking player chooses the next round from a hand of cards; watchers see the
standings) → **Break** (standings with per-bucket scoring passes, then an MVP
card) → **Final** (final board).
Round modes: 4 picture modes (`flags-all`, `flags-weird`, `spot-flag`,
`map-outlines`) plus 39 metric superlative modes, one per world metric.
Other states: a connection-status line, a join error line, and a **pause dialog**
— a modal shown when the room is holding for a dropped player, deliberately
without a dismiss control (only the host can release it).

### `/ticTacToe/` — Tic Tac Toe (online)
Purpose: two players, one 3×3 board. Every cell sits at the intersection of a row
category and a column category; a player claims a cell by naming a country whose
flag satisfies both.
Layout: room line (code · share · live status), a head-to-head match strip, and a
`<table>` grid whose first row/column are the category headers, with a `?`
rules button in the corner.
Key states: lobby (create / join / error line) · waiting for opponent ·
your turn / their turn · picker sheet open (a bottom sheet with a country search)
· valid pick (cell fills with the flag) · invalid pick (shake) · win (line
highlight) · draw · give up · result · rematch. A rules dialog carries the
"Advanced mode" switch (which adds country-statistic categories).

### `/ticTacToe/offline/`, `/ticTacToe/solo/`
Same board and mechanics without any room: two players sharing one device, and
solo play. No room line, no lobby, no WebSocket.

### `/flagsdata/` — Browse flags
Purpose: reference view of every flag, filterable, with a per-country detail
popup.
Layout: a filter bar (the same pill / chip / metric-hub vocabulary as findFlag,
plus a metric "lens" that overlays `#rank · value` on each tile), then sections
of flag tiles, then an optional world map.
Key states: default grid · filtered grid · metric lens on · zoom dialog open. The
zoom dialog itself has an optional "story of the flag" panel (intro, timeline,
"did you know" list, historical flag renders, image credit) and a raw data dump;
countries without a story simply omit that panel.

### `/profile/` — Profile
Purpose: nickname + avatar, and the achievements collection.
States: empty nickname · saving · saved · rejected (offensive word, or invalid
characters) · achievements loading · achievements grid (earned vs locked) ·
achievement detail dialog. A separate full-screen celebration overlay fires when
an achievement is newly earned.

### `/profile/sync/` — Link another device
Purpose: move progress to a second device by QR code.
States: preparing (loading dots) · QR shown (with an expiry hint and a copyable
link) · linking in progress · already linked (shows the linked device id) ·
error.

### `/privacy/` — Privacy
Purpose: static privacy text plus a "request data removal" link with a status
line.

## 3. Existing reusable components

**Chrome (every page, `common.css`)**
- `.lang-toggle`, `.flags-link`, `.burger` — a fixed top-right cluster of three
  44 × 44 px buttons on a 52 px step, all `box-sizing: border-box`.
- `.burger-panel` / `.menu` — the slide-down menu; items are contributed per page
  plus shared mounters (`mountNicknameMenuItem`, `mountSyncMenuItem`,
  `mountPrivacyMenuItem`). `disableBurgerIfEmpty` disables the button when a page
  contributes nothing.
- `body::before` — the fixed full-width top strip the chrome sits on.
- `.sr-only` — visually hidden text.

**Navigation**
- `mountDock()` / `setDock()` + `DOCK_CATALOG` (`common.js`) — the bottom dock.
  A page declares only which items appear via `data-dock="giveUp archive home"`;
  the component owns markup, inline Lucide icons, labels, and ids. Catalog:
  `giveUp`, `playAgain`, `playAgainInline`, `playAgainBtn`, `playAgainParty`,
  `home`, `archive`, `backToSettings`, `random`, `randomResult`, `makeAnother`,
  `sync`, `back`. `setDock` swaps the set when game state changes.
- There is no "up one level" affordance anywhere by design; every page exits via
  Home. Enforced by `chrome.test.js`.

**Buttons and controls**
- `.lobby-btn` / `.lobby-btn.primary` — the shared button family, sharing a press
  grammar (`.pressable`, `--press-scale`) with `.rules-close`, `.help-close`,
  `.picker-close`, `.zoom-close`, `.map-*` buttons and `.profile-save`.
- `.scope-toggle` (+ `buildToggleSwitch` / `buildToggleLi`) — the site's only
  on/off switch, used in burger menus, the TTT rules dialog, and the Party lobby.
- `.pill`, `.pill-modifier`, `.pill-swatch`, `.filter-chip`, `.color-count-pill` —
  the filter vocabulary shared by findFlag and flagsdata.
- `createMetricHub()` (`flags/metricHub.js`) — the "Statistics" control: a row of
  metric icon chips with `+ N more` overflow and one inline panel of threshold
  tiers. Two consumers (flagsdata lens, findFlag chooser).
- `createColorCountPicker()` — the "exactly N colours" control.
- `fitChipRow()` (`flags/chipRowFit.js`) — measures a chip row and decides what
  fits vs what goes behind "+ N more".

**Flags**
- `.flag-tile` / `.find-tile` — the flag thumbnail with a `data-name` hover /
  focus name-strip. 4:3 aspect, `auto-fill` grid from 64 px.
- `<dialog id="zoom">` — the per-country zoom popup, present on almost every game
  page. Opened by `openZoom()` (per page) or `openFlagZoom()` (shared).
- `openFlagLightbox()` / `wireFlagLightbox()` — the full-viewport magnification
  layer inside the zoom dialog. The only flag element that is keyboard-reachable.
- `renderFlagFacts()` / `renderImageCredit()` — the flag-story panel.
- `flags/flagMap.js` + `flagMap.css` — the contour-map renderer (quiz Outlines
  deck, flagsdata, Party map rounds).

**Feedback and results**
- `.hover-tip` + `data-tip` — the shared dark caption bubble.
- `.find-suggestions` — the country-search dropdown (findFlag, daily); the TTT
  picker sheet has its own `.picker-suggestions` variant.
- `.loading-dots` — the shared pending indicator.
- `.cell.shake` / `.cell.shake-win`, `pulse-correct` / `pulse-wrong` keyframes.
- `runCelebration()` / `launchConfetti()` / `launchFireworks()` (`confetti.js`).
- `celebrate()` (`flags/achievementCelebrate.js`) — the achievement overlay;
  `.achievement-info` — its detail dialog.
- `renderLeaderboard()` (`flags/dailyLeaderboardRender.js`).
- `buildShareText()` (`flags/shareGrid.js`) — the emoji-grid share text;
  `shareUrl()` / `shareText()` (`common.js`) wrap the Web Share API with a
  clipboard fallback; `.share-link` + `.share-icon` are the shared trigger.
- `avatarSvg()` / `buildAvatar()` — deterministic avatar from a device id.

**Dialog shells**: `.help-dialog` (Party pause, sync wizard), `.rules-help` (TTT),
`.match-sheet`, `.picker` (bottom sheet).

**Internationalisation**: `data-i18n` / `data-i18n-attr` attributes, `t()`,
`bootI18n()`, `wireLangToggle()`, and `bindTileCountry()` / `refreshTileNames()`
for re-labelling flag tiles on a language switch.

## 4. Hard constraints

**Mobile-first.** Breakpoints are overwhelmingly `max-width` (8 × 600 px,
3 × 700 px, plus 756 px and 379 px), i.e. the desktop layout is the base and
phones are adjusted. Content is capped at 756 px site-wide, and the chrome
cluster is offset inward to align with that cap on wide screens. The bottom dock
is a full-width bar on phones and a centred pill at `min-width: 700px`, reserving
`--dock-height: 66px` at the page foot.

**No offline support.** There is no service worker and no web app manifest. Every
page needs the network for `countries.json`, flag SVGs, and (for the daily) the
puzzle catalog blob. Opening the files over `file://` does not work.

**Internationalisation is structural, not optional.**
- Exactly two languages, English and Polish, 1354 leaf keys each, kept in lockstep.
- All markup ships English and is swapped in JS. `<html lang>` is set by an inline
  synchronous script before any module loads (a mismatch made Chrome offer to
  translate every page).
- Language switching is a **soft** switch: every page must re-localise in place
  and preserve in-progress state (typed input, found tiles, scroll, an open
  dialog, a live WebSocket room). Nothing may depend on a reload.
- Polish strings are frequently longer than English; several controls (the Party
  bot-difficulty row, the length segments) deliberately carry no words for this
  reason.

**Colour and type are a closed system.** Ten CSS custom properties in
`common.css`: primary, secondary, muted, muted-soft, surface, selected, page-bg,
hover, plus two narrowly-scoped additions (`--accent-rose` for dock press,
`--border-strong-color` for the button hover border). Separately, a semantic
`--correct-color` / `--wrong-color` pair means only "this answer was right/wrong"
and may not be borrowed for emphasis. Ad-hoc hex values are not allowed; the
documented exceptions are the flag SVGs themselves, the home hero's invented
stamps, the map's geographic fills, and the tile bottom strip's
`rgba(0,0,0,0.7)`. Type runs on two weights (regular/bold) plus a light weight
used only on the home hero headline and a medium used only in the burger menu.

**Light only.** `color-scheme: light` is pinned at `:root`; there is no dark
theme, and native widgets are forced light so dark-OS users do not get a
half-dark page.

**Motion is opt-out.** 12 `prefers-reduced-motion: reduce` blocks across the
stylesheets; animated components (hero stamps, celebrations, press-scale) all
have a reduced branch.

**Layout locked by mechanics.**
- Tic-tac-toe is a `<table>`: each cell must be readable against both its row
  header and its column header, so the header row and column cannot be dropped
  or collapsed on small screens.
- The daily's life budget is 7 hearts, rendered as one row.
- Find-style games need the answer input, the running `found / total` count, and
  the growing tile grid on screen simultaneously while typing (with a mobile
  keyboard raised).
- Party question screens must fit prompt + timer + answer grid in one phone
  viewport with no scrolling, since answers are timed.
- Timed quiz screens need the timer in a fixed position that does not move as
  content changes.
- Result-tile metadata has fixed slots: rank badge top-left, metric value
  top-right, community find-rate strip along the bottom.

**Accessibility: no formal target is documented anywhere in the repo.** What
exists today: `focus-visible` rings on the chrome and button families,
`aria-live` regions on 8 pages, `aria-expanded` on the burger, a `radiogroup`
with roving `tabindex` in the Party lobby, `alt` text on every flag image,
`aria-hidden` on decorative artwork, and `sr-only` headings on 7 pages. What is
absent: flag tiles are `<li>` / `<div>` with click handlers and no `tabindex` or
`role`, so the grids are mouse/touch-only (the lightbox image and the daily
players pill are the two exceptions); 7 of the 18 pages ship no `<h1>` at all.

**Engineering rules that constrain design work.**
- Same mechanism = same code. If two pages implement the same named behaviour,
  the CSS/JS lives in one shared place and both reference it; copying a rule into
  a second feature stylesheet is treated as a bug.
- `page.js` files are DOM glue and are deliberately not unit-tested, so any rule
  worth verifying must be pushed into a testable sibling module.
- Assets are cached for a year and busted by a `?v=__BUILD__` rewrite at deploy.

## 5. Currently weak or unresolved

Observable gaps, not judgements about taste.

1. **Keyboard parity on the core interaction.** The flag tile is the product's
   primary object and cannot be reached or activated by keyboard on any grid
   (daily, findFlag, flagsdata, the mistake rail, the result grids). The zoom
   dialog it opens is otherwise fully accessible.
2. **Document structure is inconsistent.** 7 pages have no `<h1>`; of the 7 that
   do, all are `sr-only`, so no page has a visible page title. Section headings
   exist only on result screens.
3. **Two competing homes for the primary action.** Some screens put the main CTA
   in the body as a `.lobby-btn.primary` (findFlag `Play`, Party `Start game`,
   TTT `New online game`), others put actions only in the dock. Each page's HTML
   carries a comment justifying its own choice; there is no single rule.
4. **Loading, empty, and error states are per-page improvisations.** The daily
   has a dedicated `#daily-state` message screen; `/flagQuiz/stats/` replaces the
   whole `document.body` with a plain error string; findFlag silently falls back
   to the chooser when a shared link resolves to nothing; the home page has no
   failure path at all. Empty states exist in only two places (archive,
   leaderboard).
5. **Cross-feature stylesheet coupling.** `/daily/` loads `findFlag/index.css`
   before its own and reuses `.find-header`, `.find-tile`, `.find-input`,
   `.find-suggestions`. The daily's appearance is therefore partly owned by
   another feature's stylesheet.
6. **The palette has already outgrown its own rule.** The documented system is
   "eight variables"; two more (`--accent-rose`, `--border-strong-color`) were
   added later, each with a comment explaining why its scope is narrow. Both are
   real exceptions to a rule the rest of the CSS is held to.
7. **Two presentations of the same "what am I filtering" idea.** flagsdata renders
   filters as boxed `.filter-chip`s; the findFlag and daily play screens render
   the same information as an inline enriched title
   (`renderCriteriaInline` / `renderMetricLeadInline`). Both live in
   `flags/filterChips.js`.
8. **Metric coverage is uneven by construction.** 39 metric data files exist, but
   each of the six surfaces a metric can appear on (flagsdata lens, flagsdata
   filter, findFlag filter, tic-tac-toe categories, Party rounds, daily
   superlatives) has to be wired separately. A given statistic may be available in
   one game and absent in another with no visible explanation.
9. **`common.css` is 2452 lines** and mixes site chrome with idioms shared by only
   two features; there are 13 stylesheets in total and no documented boundary
   between "shared" and "feature".
10. **Flag delivery is architecturally fragile at grid scale.** Every tile fetches
    its own SVG; a full findFlag or flagsdata grid fires hundreds of parallel
    requests. `PERF.md` lists this as an open item (sprite sheet / batched preload
    / placeholder shapes are the noted options) that is currently masked by a warm
    CDN cache.
