# Dock Expansion, Orientation, Overflow Menu & Library Drop-Back Design (Pass 2)

**Scope:** Project across `lib/BookmarkletToolbarCore.js`, `lib/BookmarkletToolbarUI.js`, and tests (`tests/test_bookmarklet_toolbar_core.js`, `tests/test_bookmarklet_toolbar_ui.js`, `tests/test_site_bookmarklet_toolbar_entry.js`, `tests/test_bookmarklet_toolbar_chrome_e2e.mjs`), plus `dist/Site Bookmarklet Toolbar.user.js` rebuild.

## Intent & Why

Currently `.bt-toolbar-dock` always lays out horizontally with `flex-wrap: wrap` and `[⚡]` on the left:

- At `*-center` and `*-right`, expanding shifts `[⚡]` away from the user's cursor/finger.
- On portrait mobile (`412×924`), horizontal space is constrained while vertical edge space is plentiful.
- Starring many scripts wraps the rounded pill onto multiple rows with awkward corner overlap instead of a clean overflow menu.
- Dragging a Toolbar pill or Folder chip back to the Library in the Manager does not unpin or remove it.

## Goals, Non-Goals & Anti-Goals

- **Goals:**
  - Keep `[⚡]` at **0px** movement between collapsed and expanded states across all 6 snap zones and both orientations, and keep `[⌘]` locked next to `[⚡]` (or first in the center bar) so it never wanders when `»` appears.
  - Support dock orientation (`auto` | `horizontal` | `vertical`, default `auto`: vertical at portrait `*-left`/`*-right`, horizontal otherwise; `*-center` stays two-tier horizontal).
  - Replace multi-row pill wrapping with a single-line (`flex-wrap: nowrap`) dock + `»` overflow dropdown menu (Chrome bookmarks bar style), with `»` placed **last** in the scripts list in vertical mode and overflowed folders rendered as inline expandable groups inside `»`.
  - Add smooth `200ms cubic-bezier(0.22, 1, 0.36, 1)` expansion animations (respecting `prefers-reduced-motion: reduce`), while collapsing immediately unmounts expanded buttons from the DOM.
  - Allow dragging `toolbar-script` and `folder-item` pills back into `.bt-library-section` (mouse & touch) to unpin or remove from folder.
- **Non-Goals:**
  - Decluttering the Manager header behind a `⚙` Settings sub-modal (deferred separately).
  - Bumping `@version` or releasing to `main`.
- **Anti-Goals:**
  - Multi-row pill wrapping on the dock.
  - Rotated sideways text in vertical mode (vertical mode stacks horizontally readable buttons in a column).
  - Any pixel shift of `[⚡]` on expand/collapse.

## Constraints

- Trusted Types-safe DOM (`createElement` / `createElementNS` / `textContent`, zero `innerHTML`).
- Backward-compatible `Settings` schema (`dockOrientation: 'auto' | 'horizontal' | 'vertical'`, default `'auto'`).
- Chrome-first, MDN-verified CSS/DOM APIs (`prefers-reduced-motion`, `100dvh` with `100vh` fallback).

## Detailed Design

### 1. Zero-Shift Anchor-Stationary Expansion & Item Ordering

- **Consistent Geometry:** `.bt-toolbar-dock` and `.bt-dock-handle` use identical `padding: 4px` and fixed handle dimensions across collapsed and expanded states so `[⚡]` moves `0px` on toggle.
- **`*-left` (`top-left`, `bottom-left`):**
  - Horizontal: `[⚡] [⌘] [Script 1 … Script N] [»]` — `[⚡]` pinned at left edge, `[⌘]` adjacent to `[⚡]`, scripts expand rightward, `[»]` at the outer right end.
  - Vertical: Header row `[⚡] [⌘]` (`justify-content: flex-start`) pinned at top (`top-left`) or bottom (`bottom-left`) edge; horizontally readable script buttons stack top-to-bottom (`Script 1 … Script N`) with `[»]` placed **last** at the bottom of the script list.
- **`*-right` (`top-right`, `bottom-right`):**
  - Horizontal: `[»] [Script 1 … Script N] [⌘] [⚡]` — `[⚡]` pinned at right edge, `[⌘]` adjacent to `[⚡]`, scripts expand leftward preserving left-to-right reading order, `[»]` at the outer left end.
  - Vertical: Header row `[⌘] [⚡]` (`justify-content: flex-end`) pinned at top (`top-right`) or bottom (`bottom-right`) edge so `[⚡]` never wanders left; horizontally readable script buttons stack top-to-bottom (`Script 1 … Script N`) with `[»]` placed **last** at the bottom of the script list.
- **`*-center` (`top-center`, `bottom-center`):**
  - Two-tier horizontal layout: `[⚡]` sits alone in its centered anchor pill (`0px` shift), and when expanded, the scripts bar (`[⌘] [Script 1 … Script N] [»]`) floats `6px` above (`bottom-center`) or below (`top-center`) `[⚡]`.
  - A transparent hover-bridge (`padding` / pseudo-element on the wrapper) spans the `6px` gap between `[⚡]` and the bar so pointer movement in `Hover` / `Hover + Click` mode never triggers `mouseleave` mid-move.

### 2. Orientation & Hybrid Per-Origin + Global Default Scope

- **Hybrid Scope (#3) for Position & Orientation:**
  - **Position:** Dragging the dock saves `dockSitePositions[origin] = snapZone` for the current origin *and* updates `settings.dockDefaultPosition = snapZone` (initial default `'bottom-center'`) as the fallback for any uncustomized origin.
  - **Orientation:** Add `DOCK_ORIENTATIONS = ['auto', 'horizontal', 'vertical']`, `settings.dockOrientation` (initial default `'auto'`), and `settings.dockSiteOrientations: { [origin: string]: 'auto' | 'horizontal' | 'vertical' }` in `Core.normalizeSettings`. Changing `Orientation: Auto | Horiz | Vert` in the Manager saves `dockSiteOrientations[origin]` (when an HTTP(S) origin exists) *and* updates `settings.dockOrientation` as the default for new sites.
- **Resolution & Live Rotation:** At `*-center`, effective orientation is always `'horizontal'` (the two-tier bar). At corners (`*-left` / `*-right`), `'auto'` resolves to `'vertical'` when `win.innerHeight > win.innerWidth` (portrait) and `'horizontal'` otherwise. Listen to `window` `resize` and `orientationchange` so `Auto` orientation and `»` overflow capacity adapt immediately on mobile rotation.

### 3. Single-Row / Single-Column + `»` Overflow Menu & Sideways Vertical Menus

- `.bt-toolbar-dock` uses `flex-wrap: nowrap` (never wraps onto multiple pill rows).
- When expanded (and on `resize` / `orientationchange`), measure actual available pixel space (`vw - 24` horizontal, `vh - 32` vertical; with a deterministic fallback when mock DOM dimensions are `0`) so as many buttons as fit the current screen are shown before `»` appears.
- Overflowed scripts and folders move into the `More »` overflow button (`data-action="open-overflow"`, `textContent = 'More »'`, `title = "${count} more items"`). Clicking `More »` toggles `state.openDropdownId = '__overflow__'`, opening a viewport-clamped `.bt-dropdown` where overflowed scripts run on click and overflowed `📁` folders render as inline expandable/grouped sections inside the same dropdown.
- **Sideways Menus in Vertical Mode:** When effective orientation is `'vertical'`, folder dropdowns and the `»` overflow menu open **sideways beside the vertical column** (to the right on `*-left`, to the left on `*-right`, clamped within `8px` of viewport edges) so they never cover the vertical script list.

### 4. Animations & Micro-Interactions

- Smooth `200ms cubic-bezier(0.22, 1, 0.36, 1)` expansion animation on the expanded items/bar (`@keyframes` outward glide + fade from `[⚡]`), subtle button hover/active feedback, and `@media (prefers-reduced-motion: reduce)` override.
- Collapsing unmounts expanded buttons immediately so collapsed DOM stays empty.

### 5. Library Drop-Back (Unpin / Remove from Folder)

- Bind `.bt-library-section` via `bindDropTarget` (`'library-unpin'`) in `lib/BookmarkletToolbarUI.js`:
  - `toolbar-script`: hint `"Unpin \"<label>\" from Toolbar"`, `accept()` calls `Core.toggleToolbarPin(state.layout, payload.scriptId)`.
  - `folder-item`: hint `"Remove \"<label>\" from \"<folderName>\""`, `accept()` calls `Core.removeFolderItem(state.layout, payload.folderId, payload.index)`.
  - `library-script` / `toolbar-folder`: returns `null` (no-op).
- Works identically for both HTML5 DnD and Pointer-Event touch DnD.
