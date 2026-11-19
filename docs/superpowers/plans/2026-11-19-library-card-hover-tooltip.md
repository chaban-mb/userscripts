# Library Card Hover Tooltip Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep Library script cards strictly single-line with `text-overflow: ellipsis` and display an instant themed floating tooltip on hover/focus for truncated titles with zero layout shift, then rebuild `dist/Site Bookmarklet Toolbar.user.js`.

**Architecture:** Update the Shadow DOM CSS and Library card rendering inside `lib/BookmarkletToolbarUI.js` to remove the `:hover`/`:focus-within` title unwrapping rule and attach a `pointer-events: none` `.bt-card-tooltip` sibling element inside each `.bt-library-card`. On `mouseenter` and `focusin`, measure `titleSpan.scrollWidth > titleSpan.clientWidth + 1` and available space beneath `.bt-sticky-section` / `.bt-manager-body` to toggle `dataset.truncated`, `dataset.tooltipPos`, and `dataset.tooltipSuppressed`. Update `tests/test_bookmarklet_toolbar_ui.js` to pin these invariants, then rebuild the standalone bundle into `dist/` via `tools/build_dist.py`.

**Tech Stack:** Vanilla JavaScript (Shadow DOM, Trusted Types-safe DOM APIs), `node:test` + `node:assert/strict`, Python `tools/build_dist.py`.

**Spec:** [2026-11-19-library-card-hover-tooltip-design.md](file:///d:/Documents/git/userscripts/docs/superpowers/specs/2026-11-19-library-card-hover-tooltip-design.md)

## Global Constraints

- Edit `lib/BookmarkletToolbarUI.js` and `tests/test_bookmarklet_toolbar_ui.js`; never edit `dist/` directly (always regenerate via `tools/build_dist.py`).
- Preserve Trusted Types compliance (`createElement` + `textContent` only; no `innerHTML` or HTML string sinks).
- Use existing `--bt-*` theme tokens so light and dark modes stay consistent.
- Keep `.bt-library-card` height fixed to a single line and `.bt-card-title-row` `flex-wrap: nowrap`.
- Commit directly on `dev` using atomic conventional commits (`fix(bookmarklet-toolbar): ...`).

## Review Focus

- **Non-truncated short titles (`scrollWidth <= clientWidth + 1`):** Must set `dataset.truncated = "false"` so short names do not show redundant tooltips.
- **Top-edge / sticky-header proximity:** When a hovered card sits close to the bottom of `.bt-sticky-section` (or `.bt-manager-body` top), `dataset.tooltipPos` must flip to `"bottom"` so the tooltip does not clip behind the sticky header.
- **Open `ⓘ` popover (`state.openInfoId === s.id`):** Tooltip must be suppressed (`dataset.tooltipSuppressed = "true"`) so it never overlaps the popover.
- **Active drag (`state.dragState.dragPayload`):** Tooltip must be suppressed while dragging so tooltips do not linger mid-drag.
- **Headless/mock DOM without layout metrics:** Cards whose elements report `0` dimensions or lack `getBoundingClientRect` must not throw during `mouseenter` or `focusin`.

---

### Task 1: Replace hover unwrap with fixed single-line ellipsis + instant themed tooltip

**Files:**

- Modify: `lib/BookmarkletToolbarUI.js:670-706`, `lib/BookmarkletToolbarUI.js:3380-3477`
- Test: `tests/test_bookmarklet_toolbar_ui.js:1067-1147`

**Interfaces:**

- Consumes: `BookmarkletToolbarUI.createToolbarUI(...)`, `state.openInfoId`, `state.dragState`, `overlayEls.managerBody`, `overlayEls.stickySection` (or `.bt-sticky-section` inside `overlayShadow`).
- Produces: `.bt-card-tooltip` CSS + DOM node per `.bt-library-card` with `data-truncated`, `data-tooltip-pos`, and `data-tooltip-suppressed` attributes updated on `mouseenter` / `focusin` (and initial render state when suppressed).

- [ ] **Step 1: Update `tests/test_bookmarklet_toolbar_ui.js` with failing assertions for single-line ellipsis, tooltip rendering, truncation detection, top/bottom flip, and suppression**

Replace the obsolete hover-unwrap assertion at line 1075 (`assert.match(uiSource, /\.bt-library-card:hover\s+\.bt-card-title[\s\S]*white-space:\s*normal;/);`) and add assertions verifying:

```js
assert.doesNotMatch(
    uiSource,
    /\.bt-library-card:hover\s+\.bt-card-title[\s\S]*?white-space:\s*normal;/
);
assert.match(uiSource, /\.bt-card-tooltip\s*\{/);
```

Plus runtime DOM assertions in a new `test('Library cards keep single-line ellipsis and show instant tooltip only when truncated, flipping near sticky header and suppressing on drag/popover', ...)` checking:

1. Every `.bt-library-card` contains `.bt-card-tooltip` with `aria-hidden === 'true'` and `textContent === script.name`.
2. Dispatching `mouseenter` on a card whose `.bt-card-title` has `scrollWidth = 320, clientWidth = 180` sets `card.dataset.truncated === 'true'`; on a card with `scrollWidth = 120, clientWidth = 180` sets `card.dataset.truncated === 'false'`.
3. When `card.getBoundingClientRect` returns `{ top: 100 }` and `.bt-sticky-section` `getBoundingClientRect` returns `{ bottom: 80 }` (gap `20px < 44px`), `mouseenter` sets `card.dataset.tooltipPos === 'bottom'`; when `{ top: 200 }` (gap `120px >= 44px`), it sets `card.dataset.tooltipPos === 'top'`.
4. Clicking `ⓘ` on that card (`state.openInfoId === s.id`) or starting a drag sets `card.dataset.tooltipSuppressed === 'true'`, and dispatching `focusin` on a card with missing layout metrics does not throw.

- [ ] **Step 2: Run the UI test file to verify the new/updated tests fail**

Run: `node --test tests/test_bookmarklet_toolbar_ui.js`
Expected: FAIL on the removed `.bt-library-card:hover .bt-card-title` assertion and missing `.bt-card-tooltip` elements.

- [ ] **Step 3: Update CSS and card rendering in `lib/BookmarkletToolbarUI.js`**

1. In `buildStyles()` (`lib/BookmarkletToolbarUI.js:670-706`):
   - Keep `.bt-library-card:hover` and `.bt-library-card:focus-within` border highlight, and raise hovered/focused card `z-index: 25` (with `openInfoId` still overriding inline `zIndex = '35'`).
   - Remove `.bt-library-card:hover .bt-card-title, .bt-library-card:focus-within .bt-card-title { white-space: normal; ... }`.
   - Add `.bt-card-tooltip` styles:
     - `position: absolute; left: 40px; bottom: calc(100% + 5px); max-width: calc(100% - 48px); padding: 5px 9px; border-radius: 6px; background: var(--bt-fg); color: var(--bt-bg); font-size: 12px; font-weight: 500; line-height: 1.35; box-shadow: 0 8px 20px rgba(0, 0, 0, 0.24); pointer-events: none; opacity: 0; transform: translateY(2px); transition: opacity 90ms ease, transform 90ms ease; z-index: 30; white-space: normal; overflow-wrap: anywhere;`
     - `.bt-library-card[data-tooltip-pos="bottom"] .bt-card-tooltip { bottom: auto; top: calc(100% + 5px); transform: translateY(-2px); }`
     - `.bt-library-card[data-truncated="true"]:not([data-tooltip-suppressed="true"]):hover .bt-card-tooltip, .bt-library-card[data-truncated="true"]:not([data-tooltip-suppressed="true"]):focus-within .bt-card-tooltip { opacity: 1; transform: translateY(0); }`
2. Add a small helper `syncLibraryCardTooltip(card, titleSpan, scriptId)` inside `BookmarkletToolbarUI.js`:
   - Reads `state.openInfoId === scriptId || Boolean(state.dragState.dragPayload)` -> sets `card.dataset.tooltipSuppressed = suppressed ? 'true' : 'false'`.
   - Computes `const titleWidth = Number(titleSpan.clientWidth) || 0; const titleScroll = Number(titleSpan.scrollWidth) || 0; card.dataset.truncated = titleWidth > 0 && titleScroll > titleWidth + 1 ? 'true' : 'false';`.
   - Computes top clearance between `card.getBoundingClientRect().top` and `stickyBottom` (from `overlayShadow.querySelector('.bt-sticky-section')?.getBoundingClientRect().bottom` or `overlayEls.managerBody?.getBoundingClientRect().top` if available), setting `card.dataset.tooltipPos = topGap < 44 ? 'bottom' : 'top'`.
3. In `renderManagerView()` (`lib/BookmarkletToolbarUI.js:3380-3477`):
   - Create `tooltip = doc.createElement('div')`, `tooltip.className = 'bt-card-tooltip'`, `tooltip.setAttribute('aria-hidden', 'true')`, `tooltip.textContent = s.name`, and append to `card`.
   - Set initial `card.dataset.tooltipSuppressed = state.openInfoId === s.id || Boolean(state.dragState.dragPayload) ? 'true' : 'false'`.
   - Attach `mouseenter` and `focusin` listeners on `card` calling `syncLibraryCardTooltip(card, titleSpan, s.id)`.

- [ ] **Step 4: Run UI and related unit tests to verify they pass**

Run: `node --test tests/test_bookmarklet_toolbar_ui.js tests/test_bookmarklet_toolbar_core.js tests/test_bookmarklet_toolbar_adapters.js tests/test_site_bookmarklet_toolbar_entry.js`
Expected: PASS (all tests green, 0 failures).

- [ ] **Step 5: Commit design spec, implementation plan, UI fix, and tests**

```bash
git add docs/superpowers/specs/2026-11-19-library-card-hover-tooltip-design.md docs/superpowers/plans/2026-11-19-library-card-hover-tooltip.md lib/BookmarkletToolbarUI.js tests/test_bookmarklet_toolbar_ui.js
git commit -m "fix(bookmarklet-toolbar): show instant themed tooltip on truncated library titles"
```

---

### Task 2: Rebuild `dist/` bundle and verify build & E2E checks

**Files:**

- Rebuild: `dist/Site Bookmarklet Toolbar.user.js` (gitignored local build artifact)

**Interfaces:**

- Consumes: `src/Site Bookmarklet Toolbar.user.js`, `lib/BookmarkletToolbarUI.js`, `tools/build_dist.py`
- Produces: Updated `dist/Site Bookmarklet Toolbar.user.js` with inlined tooltip CSS/DOM changes.

- [ ] **Step 1: Rebuild `dist/Site Bookmarklet Toolbar.user.js`**

Run: `python tools/build_dist.py --out dist --script "Site Bookmarklet Toolbar.user.js"`
Expected: Command exits 0 and writes `dist/Site Bookmarklet Toolbar.user.js`.

- [ ] **Step 2: Verify built `dist/` contains the updated tooltip code and passes sync/build checks**

Run:

- `rg -n "bt-card-tooltip" "dist/Site Bookmarklet Toolbar.user.js"`
- `python -m unittest tests/test_build_dist_sync.py`
Expected: `bt-card-tooltip` present in `dist/Site Bookmarklet Toolbar.user.js`, and `test_build_dist_sync.py` passes.

- [ ] **Step 3: Run Chrome E2E test if Playwright/Chrome harness is available**

Run: `node tests/test_bookmarklet_toolbar_chrome_e2e.mjs` (or check how it runs in this repo)
Expected: E2E passes or any environment block is accurately reported without claiming unverified results.
