---
name: ui-consistency
description: Reuse-first checklist for adding or changing any UI on gridgame, so a new element matches the rest of the site instead of being hand-rolled. Use BEFORE building a tile, dialog/popup, button, scroll region, hover label, name strip, chip, colour, or animation — anything visual. Carries the catalog of shared patterns (the 8 colour vars, the pill-button rule, the dialog card family, `.flag-tile` hover name-strip, `.quiet-scroll` scrollbar, `wireFlagLightbox`, filterChips, the shake keyframes) with the exact file to reuse, plus the "promote on the 2nd consumer and delete the copy" recipe and the verify step. Triggers whenever CLAUDE.md's "UI consistency between pages" rules apply: new/changed markup or CSS in any `page.js`, `index.css`, `common.css`, or a feature stylesheet; a popup/tooltip/scrollbar/tile/label that "should look like the rest of the app"; or a review comment like "why isn't this consistent with X".
---

# UI consistency: reuse before you build

CLAUDE.md's "UI consistency between pages" section is the law; this skill is the pre-flight that keeps you from breaking it. The failure mode it prevents: hand-rolling an element (a scrollbar, a tooltip, a tile, a close button) that the site already has a canonical version of, so it ships looking subtly foreign. That is a **bug**, not a style nit.

Motivating case (the reason this skill exists): the tic-tac-toe give-up "all matches" sheet first shipped with a raw browser `title` tooltip and the chunky OS scrollbar. The app already had a hover **name-strip** (`flagsdata/.flag`) and a **quiet hairline scrollbar** (the flag-story dialog). Both had to be promoted to shared classes after the fact.

## The one rule

**Before adding any visual element, grep the other pages for the same thing and reuse it.** If a shared class/module exists, use it. If the pattern exists but is page-scoped and you are the second consumer, **promote it to `common.css` (or a shared module), point both consumers at it, and delete the copy** (CLAUDE.md: "promote when the second consumer actually arrives"). Copy-pasting a rule into a second stylesheet is the bug, even byte-identical.

## Catalog — want X? reuse this

| You're adding… | Reuse | Where |
| --- | --- | --- |
| Any colour | one of the **8 vars** only: `--primary-color`, `--secondary-color`, `--muted-color`, `--muted-soft-color`, `--surface-color`, `--selected-color`, `--page-bg-color`, `--hover-color` | `common.css` (grep the var before typing a hex) |
| A chrome button (44×44 slot) | `box-sizing: border-box`, spaced 52px; **add your class to the shared pill-button comma-list**, don't restyle | `common.css` (`.profile-save, .lobby-btn, .rules-close, … { font: inherit; … }` + `:hover`/`:active` + the 32×32 icon-button group) |
| A dialog dismiss | a corner **×** (top-right), text `×`, `aria-label` via `game.close`; add the class to the **32×32 icon-button group**, not the padding group | `common.css` (`.zoom-close` / `.match-close` / `.rules-close` / `.picker-close`) |
| A modal/popup card | the dialog card family: 1px `--muted-soft-color` border, 8px radius, `--surface-color`, `box-shadow: 0 4px 24px rgba(0,0,0,.22)`, backdrop `rgba(0,0,0,.6)`. `#zoom` also animates in (scaleX + `@starting-style`); `rules-help` just pops | `common.css` `dialog#zoom` / `.rules-help` |
| A grid of flags where hovering names the tile | **`.flag-tile`** + set `data-name` on the tile; append the `<img>` | `common.css` `.flag-tile` (hover/focus name-strip) |
| A scroll region inside a popup | **`.quiet-scroll`** (thin hairline scrollbar) | `common.css` `.quiet-scroll` |
| Tap a flag to see it full-screen | **`wireFlagLightbox(img, t)`** (or `openFlagLightbox`) | `flags/flagLightbox.js` |
| A dark name band on a wrong/revealed tile | the shared `content: attr(data-name)` strip | `common.css` (`.flag-choice.wrong[data-name]::after` family) |
| A category label / criteria chip with its icon | `renderCategoryLabel` / `renderCategoryPair` / `categoryIconEl` / `buildFilterChip` | `flags/filterChips.js` |
| Wrong-answer shake | `pulseShake(el)` + the `cell-shake` keyframes | `flags/engine.js` + `common.css` |
| Online/offline player cards + scoreboard | `renderMatchStrip` / `renderOfflineStrip` | `ticTacToe/matchStrip.js` |
| A picker / search dropdown | the `.picker` sheet + `suggest`/`exactSingleMatch` | `flags/engine.js` + a `page.js` picker (grep `openPicker`) |

If your element isn't here, `grep` for its class name / behaviour across the repo before inventing one. The table is a starting point, not the whole vocabulary.

## Promotion recipe (you're the 2nd consumer)

1. Move the shared declarations into `common.css` under a new class (e.g. `.flag-tile`, `.quiet-scroll`), documented with a one-line "promoted on the 2nd consumer" note.
2. Add that class to **both** consumers' markup (`className = 'existing shared'`, or the `<div class="… shared">` in HTML).
3. **Delete** the now-duplicated rules from the original page's stylesheet, leaving only its genuinely page-specific bits.
4. Prefer **deleting an override** over adding another one on the new page (CLAUDE.md).

## Verify (both surfaces)

After a promotion, drive **both** the new element and the deduped old one, per the `verify-flag-map-ui` Playwright pattern (serve with `python -m http.server`, navigate, probe computed styles + screenshot):

- New surface renders and behaves right.
- Old surface (flagsdata grid, story dialog, whichever you touched) is unchanged — grep its computed `::after content` / `scrollbar-width` etc. to prove the shared rule still resolves.

Never claim a UI change works before seeing the screenshot (CLAUDE.md / memory).

## Smell tests

- About to write `background: #…` or `rgba(…)`? Stop — is it one of the 8 vars? (Exceptions are documented: flag SVG colours, the `rgba(0,0,0,.x)` per-tile strip, the rose CTA.)
- About to copy a rule from one feature stylesheet into another? Stop — promote it.
- Reaching for a native `title` tooltip, a default scrollbar, or a bespoke close button? The app almost certainly has a styled version already. Grep first.
- Adding an override in a feature stylesheet that fights a `common.css` rule? Suspect — confirm it's intentional or delete it.
