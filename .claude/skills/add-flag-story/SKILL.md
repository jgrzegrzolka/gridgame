---
name: add-flag-story
description: Reference for writing a "story of the flag" description on /flagsdata/ (the flag-zoom popup with an intro, a historical timeline, and a "Did you know?" list). Use when Jan asks to add or edit a flag's description/story/history, anything that touches `flags/flagFacts.js`, the `flagFacts.<code>` i18n keys, or `flags/history/`. Covers the data shape, the en+pl prose, sourcing and render-checking historical SVGs, the completeness rule, fact-verification, and the local visual verify. Feature notes live in memory `project_flag_facts_feature`; this skill is the recipe.
---

# Adding a flag story

A story is what shows in the flag-zoom popup on `/flagsdata/` (and behind the home-page "flag of the day" card) when a flag is clicked: an **intro paragraph**, an ordered **timeline** of historical flags, and an optional **"Did you know?"** fact list. Structure lives in `flags/flagFacts.js`; all prose lives in i18n so it translates. The tests are generic over every entry, so a correct entry auto-validates, but they can't judge prose, sourcing, or whether a thumbnail reads.

## Writing style: NEVER use the em dash

Jan bans the long em dash (`—`) everywhere: i18n copy, captions, code comments, this skill, commit messages, chat. It reads as AI-generated and he actively dislikes it. Use a comma, a full stop, a colon before a real list, or parentheses instead. Do not blind-swap to a stiff colon where a comma or period reads better. Before finishing, grep your new content for `—` and remove every one. The en dash `–` for numeric ranges (`1946–1992`) is a different character and is fine. See memory `feedback_no_em_dash`.

## 0. Timeline depth: default to the LONGEST history that is VISIBLE on the flag

**We always want as long a flag history as possible.** Include every historical design whose difference is *visible on the flag itself*. This is the default now, not a thing to ask about. Albania started as a timid 2-step and Jan pushed three times ("2 flags???", "wiki has 8") before it reached the full 9-step gallery. Do not make him ask: go long from the start.

- **Include every distinct design.** Walk the whole run (Albania: white star, bare eagle, wide-winged republic eagle, royal helmet, fascist fasces, crowned state flag, wartime hammer-and-sickle, communist star, plain eagle today). Match the source gallery (e.g. the Wikipedia "historical flags" list) design-for-design.
- **"Visible on the flag" is the only filter.** Drop a candidate only when its difference does not show on the flag: a pure shade-of-red tweak, or a file that renders pixel-identical to a neighbour. Even near-plain-eagle years earn a step if they were a real period; caption them honestly ("the re-established state flew the bare eagle again"), do not invent a fake distinction.
- **If a flag genuinely has no history worth showing**, a short story is still fine: give the colour meaning and stop. Do not pad, and do not let a "Did you know?" fact restate the intro. But when history exists, err all the way toward completeness.

Render-check every candidate (step 2) before writing captions: the caption on Wikipedia cannot be trusted to tell you what the flag looks like. The 1928-1934 Kingdom file renders as a plain eagle, but the 1934-1939 one carries the golden helmet; a "1943 crowned" file turned out identical to the Kingdom helmet flag. Look at each one.

## 1. Source the historical SVGs

Current flags already live in `flags/svg/<code>.svg`; reference those directly for the "today" step. Only *superseded* designs need new assets, under `flags/history/`.

- Source from **Wikimedia Commons**. **Prefer public domain** (flags generally aren't copyrightable and these designs predate modern authorship). CC BY-SA is acceptable **only with attribution** recorded in `flags/history/SOURCES.md` (used unmodified). CC0 needs no attribution but list it for provenance.
- Download the **SVG itself**, not a thumbnail (Wikimedia thumb PNG URLs are hotlink-blocked). Resolve the real file via `Special:FilePath/<exact file name>.svg` (URL-encode spaces and any en dash `–` as `%E2%80%93`). If the filename is wrong you get an HTML page instead of `<svg …>`, so verify the first bytes. Find the exact filename with the Commons search API via **WebFetch** (curl to the API often gets blocked or returns HTML): `https://commons.wikimedia.org/w/api.php?action=query&list=search&srsearch=<terms>&srnamespace=6&format=json`.
- Rename to `<code>-<era>.svg` (e.g. `al-communist.svg`, `af-kingdom.svg`).
- **NEVER overwrite an existing `flags/history/*.svg`. Ever.** These files are served `immutable, max-age=1yr` (see `staticwebapp.config.json`) and the timeline references them by a **bare, unversioned URL**, so replacing one at the same filename ships the *old* bytes to Cloudflare + browsers for a **year**. When you need a different design for an existing era, add a **new filename** and repoint `flagFacts.js` at it (the winged-harp lesson: PR #664 overwrote `ie-harp.svg` and prod kept the old harp until #665 renamed it to `ie-harp-1642.svg`). A test enforces this: `flags/history/checksums.test.js` pins every SVG's content hash and fails if one changes in place.
- **After adding a new SVG, run `npm run history:checksums`** to pin its hash, or the guard test fails ("New history SVG(s) not pinned"). The generator is add-only, so it will not silently bless an edit to an existing file.
- **Watch what a name implies.** "Flag of the Skanderbeg Division" is a WWII SS unit, not a national flag. Read what a file actually depicts before using it.
- **A single era often has several variant files that look different.** "Flag of Albania (1920-1926).svg" and "Flag of Albania 1926.svg" are different eagles; the 1944 flag has one Commons file with a plain eagle and another with a hammer-and-sickle canton. **When Jan links a specific Commons file, download THAT exact file** (`Special:FilePath/<exact name>`), not a plausibly-named neighbour, and render it against his link. Both times I guessed the filename I got the wrong design and he had to correct me.

## 2. Render-check every thumbnail at ~84px, NON-NEGOTIABLE

Before committing any historical SVG, **render it at ~84px and look at it**, even when Jan says "just wire it up." This is the rule a Monaco sunburst masquerading as a Polish cockade got through by skipping. Trusting a Wikimedia filename is not enough.

Workflow on this machine (the `cd`-in-subshell and `--directory` server tricks fail here, and `cd` drifts the persistent shell cwd so use absolute paths):
1. `python -m http.server <port>` as a **backgrounded Bash** command from the repo root (serves the whole repo). Do not `cd` inside it.
2. Stage temp SVGs plus a tiny preview HTML under `flags/history/_tmp/` showing each flag at 84px **and** ~200px, with the current flag beside them for comparison.
3. View via Playwright MCP (`browser_navigate`, then `browser_take_screenshot` with `scale: device`, then `Read` the PNG).
4. Confirm each reads at 84px and is not a confusing crop. Write captions from what you actually see.
5. **Delete `flags/history/_tmp/` before running tests** (`chrome.test.js` scans every `.html` in the repo and fails on a stray preview page). Put screenshots in the scratchpad, never the repo root, and delete them before committing.

## 3. Verify the facts against a second source

Check dates and claims against **Wikipedia / Britannica** (his book once caught a wrong Greece date). When Jan cites a source (a blog, his book), use its facts but **cross-check the surprising or checkable ones**; state folklore as folklore ("by tradition…") and **drop claims a second source contradicts**. Albania lesson: a blog's "naval flag has a yellow star" failed against Wikipedia ("eagle on a white field, red stripe below, no star"), dropped. The "25 feathers = 25 years / 25 battles" tradition was confirmed by both English and Polish Wikipedia (9 per wing + 7 tail = 25), kept. When Jan cites a specific detail you can't match to an image, surface the tradeoff, do not silently substitute. Keep fact notes to the flag's meaning only, no category-justification prose.

## 4. Add the entry to `flags/flagFacts.js`

```js
al: {
  addedOn: '2026-07-03',            // YYYY-MM-DD the story ships, see below
  introKey: 'flagFacts.al.intro',
  timeline: [
    { year: '1946–1992', img: 'history/al-communist.svg', captionKey: 'flagFacts.al.communist' },
    { year: '1992',      img: 'svg/al.svg',               captionKey: 'flagFacts.al.current' },
  ],
  factKeys: ['flagFacts.al.fact.feathers', 'flagFacts.al.fact.landofeagles'],
},
```

- `img` is **relative to `flags/`**: `svg/<code>.svg` for the current flag, `history/<code>-<era>.svg` for a superseded one. Nothing else.
- `year` is a display label kept in the data (language-neutral): a year, a range (`1946–1992`, en dash), or a phrase (`since 13th c.`).
- `addedOn` drives the flag-of-the-day rotation's **append-safety**: a flag becomes eligible only the day after its `addedOn`, so adding a story never disturbs today's or a past day's pick. Use today's date; a test pins the shape.
- The story pool (home-page flag-of-the-day) grows automatically from `FLAG_FACTS` keys. To *feature* a new story immediately, add an override pin in `flags/flagOfDay.js`.

**Optional advanced step shapes** (read the typedef in `flagFacts.js`):
- **Equation** (`parts` + `partLabelKeys`): renders `part₁ + part₂ = img`, for a composite flag assembled from ingredients at a moment (GB 1606 = England + Scotland). **Every colour/element in an ingredient must actually appear in the result** (France's first pass used a gold-fleurs-de-lis flag as the "white" ingredient; the gold never appears on the Tricolour, so it became a plain-white swatch).
- **Compare** (`compare`): a "right way up vs upside down" pair under one fact bullet, for flags whose asymmetry has a consequence (the Union Jack distress signal). `afterFactKey` must name a real bullet in `factKeys`.

## 5. Write the prose in `i18n/en.json` AND `i18n/pl.json`

Every key the entry references lives under `flagFacts.<code>` in **both** language files (nested objects, not flat dotted keys). Missing either fails the i18n test.

```jsonc
"al": {
  "intro": "…",              // one or more paragraphs; a blank line (\n\n) splits them
  "communist": "…",          // caption for each timeline step's captionKey
  "current": "…",
  "fact": { "feathers": "…", "landofeagles": "…" }   // one per factKey
}
```

- Intro paragraphs split on a literal blank line (`\n\n`).
- Write real **Polish**, not a machine gloss (Jan reads both). Use Polish typographic quotes `„…”`.
- The intro carries colour meaning plus the through-line; facts are standalone trivia that don't belong in the intro or on one flag.
- No em dashes (see the style rule at the top).

## 6. Record provenance in `flags/history/SOURCES.md`

Add a table row per new historical SVG: repo filename, exact Commons source file, licence, one-line description. For CC BY-SA add the attribution note below the table. Current flags (flag-icons/MIT) are covered by the standing note. This file is the public image-credit page the popup links to.

## 7. Run `npm run validate`

Tests plus typecheck, the same gate CI enforces. The generic `flags/flagFacts.test.js` checks, for every entry: `addedOn` shape, each `img`/`part` sits under `history/` or `svg/` and **exists on disk**, and every i18n key is present in **both** en.json and pl.json. Don't finish if either fails.

## 8. Verify visually on the real page, before claiming success

Never declare the story done before seeing it rendered. Serve the repo, open `/flagsdata/index.html`, click the flag (find the tile by its `img[src$="/<code>.svg"]`), screenshot the popup, `Read` it. Toggle the `.lang-toggle` and re-open to confirm the **Polish** render too. Check: intro paragraphs, every timeline thumbnail legible, facts present, no layout break. The `/api/*` 404s in this static preview are harmless (no Functions runtime). Note the modal resets its own scroll on open; to prove a lower step rendered, read the DOM (`.flag-facts-step` count and `.flag-facts-caption` text) rather than trusting a single screenshot.

## Things that go wrong

- **Skipped the 84px render-check.** A filename lied and the wrong flag shipped (the Monaco-cockade-as-Polish incident, and the two wrong Albania files). The one non-negotiable step.
- **Under-shipped the history.** Curated a long history down to a few "distinct" steps when Jan wanted the full gallery. Default to completeness; every design visible on the flag gets a step.
- **Left `flags/history/_tmp/` in place.** `chrome.test.js` fails on the stray preview `.html`. Delete it before validating.
- **Prose in only one language file.** i18n test fails: `pl.json missing flagFacts.<code>.<key>`. Both files, every key.
- **Used an em dash.** Jan's hard rule. Grep for `—` and remove it before committing.
- **Trusted a single blog for a surprising claim.** Cross-check; drop what a second source contradicts.
- **Overwrote an existing asset filename.** These SVGs are `immutable`-cached for a year at a bare URL, so a same-filename replacement serves stale bytes to prod for a year, not just a hard-refresh nuisance (PR #664 → #665). Add a new filename and repoint `flagFacts.js`; never edit an existing history SVG in place. The `flags/history/checksums.test.js` guard now fails the build if you do.

## See also

- `flags/flagFacts.js` (catalog + full typedef), `flags/flagFactsRender.js` (pure renderer), `flags/flagFacts.test.js` (generic checks).
- `flags/history/SOURCES.md` (provenance table), `flags/flagOfDay.js` (rotation + override pins).
- Memory `project_flag_facts_feature` (what's shipped, per-country lessons) and `feedback_no_em_dash`.
