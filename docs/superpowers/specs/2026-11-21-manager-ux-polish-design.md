# Manager Modal Layout Stability & Info Popover Design (Pass 1)

**Scope:** Small change to `lib/BookmarkletToolbarUI.js` and `tests/test_bookmarklet_toolbar_ui.js`, plus `dist/Site Bookmarklet Toolbar.user.js` rebuild.

## Intent & Why

1. **Info popover clipping offscreen (#1):** Clicking `ⓘ` on a Library card near the bottom of `.bt-manager-body` opens `.bt-popover` (`position: absolute; top: calc(100% + 4px)`), which gets clipped at the bottom of the modal when the `@match` list is long.
2. **Layout shift on filter & folder toggle (#2 & #3):** `#manager-backdrop` uses `align-items: center` and `.bt-modal-lg` only sets `max-height`. Toggling `"Matching current site"` or opening/closing `.bt-folder-drawer` changes `.bt-modal-lg` height and re-centers the entire modal vertically, shifting the header, `📁` folder pills, and checkbox away from the cursor.

## Goals, Non-Goals & Future Ideas

- **Goals:**
  - Keep `#manager-backdrop` top-anchored and `.bt-modal-lg` at a consistent height so filtering (`"Matching current site"`) or toggling `.bt-folder-drawer` never shifts the modal header, `Toolbar Layout` pills, or filter controls.
  - Position script `.bt-popover` within the viewport so long `@match` lists never clip offscreen.
- **Non-Goals (Deferred to Future Revisit):**
  - **Decluttering Manager Header (`#4`):** Moving `Shortcut`, `Dock expand`, `Hide dock on this site`, `Export`, and `Import` behind a `⚙` Settings sub-modal next to `×` (440px sub-modal reusing `.bt-backdrop-sub`, leaving `+ New Local Script`, `⚙`, `×` in the header) is deferred for a potential future revisit.
  - **Pass 2 (Dock):** Dock expansion direction (`*-right` expanding left, `*-left` expanding right), orientation (`Auto`/`Horizontal`/`Vertical`), and `»` overflow menu will be designed separately.

## Constraints

- Trusted Types-safe DOM (`createElement` / `textContent`, zero `innerHTML`).
- Responsive on `412px` mobile viewports (`max-width: calc(100vw - 24px)`, `100dvh` with `100vh` fallback).
- Rebuild `dist/Site Bookmarklet Toolbar.user.js` via `tools/build_dist.py` after changes.

## Approaches

1. **Top-anchored fixed-height `.bt-modal-lg` + `position: fixed` viewport-clamped `.bt-popover` (Selected):**
   - Anchor `#manager-backdrop` with `align-items: flex-start` (matching `#palette-backdrop`'s `.bt-backdrop-top` pattern, with `padding-top: 16px`) and set `.bt-modal-lg` `height: calc(100vh - 32px); height: calc(100dvh - 32px);` (`calc(100dvh - 24px)` on `<= 600px`).
   - Position script `.bt-popover` using `position: fixed` anchored to the clicked `ⓘ` button's `getBoundingClientRect()`, flipping above `ⓘ` when bottom space is tight, clamping within `8px` of all viewport edges, and capping height at `min(320px, calc(100dvh - 32px))` with `overflow-y: auto`.
   - *Trade-off:* Uses `getBoundingClientRect()` measurement on render/open (with safe fallback in headless mock DOMs); clicking/scrolling `.bt-manager-body` closes or keeps `.bt-popover` safely bounded inside the viewport.
2. **Convert `ⓘ` info into a sub-modal (Rejected):**
   - *Trade-off:* Heavyweight backdrop switch for a quick read-only `@match` inspection.

## Left to Implementation

- Exact `position: fixed` top/left/maxHeight clamping math for `.bt-popover` (and closing `openInfoId` on `managerBody` scroll if desired so a fixed popover doesn't detach from a scrolled card).
- Unit tests in `tests/test_bookmarklet_toolbar_ui.js` for `.bt-modal-lg` fixed height / top alignment and `.bt-popover` viewport flipping/clamping.
