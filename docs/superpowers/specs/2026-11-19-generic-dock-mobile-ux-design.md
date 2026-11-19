# Generic Collapsible Dock, Touch DnD & Mobile Responsive UX Design

**Scope:** Project across `lib/BookmarkletToolbarCore.js`, `lib/BookmarkletToolbarAdapters.js`, `lib/BookmarkletToolbarUI.js`, `src/Site Bookmarklet Toolbar.user.js`, and unit/Chrome E2E tests (`tests/`).

## Intent & Why

Site-specific header injection (`musicbrainzAdapter` mutating `div.header .right .top`) breaks across host CSS variations, custom userstyles (such as sticky MusicBrainz menus), and narrow mobile viewports (`412px` Pixel 10). Meanwhile, non-wrapping rows in the Manager modal and Command Palette overflow `412px` screens horizontally, and HTML5 Drag & Drop does not fire on touch devices (confirmed on Firefox Mobile and Chrome DevTools touch mode).

Moving to a single generic, collapsible, drag-to-snap floating dock removes host-DOM fragility completely while making the Manager, Command Palette, and script dragging work smoothly on both desktop and mobile.

## Goals, Non-Goals & Anti-Goals

- **Goals:**
  - Replace site-specific DOM adapters with the generic floating dock on all matched sites.
  - Anchor the dock to any of 6 snap positions (`top-left`, `top-center`, `top-right`, `bottom-left`, `bottom-center`, `bottom-right`), defaulting to `bottom-center`, persisted per `location.origin`.
  - Allow dragging the dock itself (mouse & touch) with live 6-zone snap previews.
  - Allow hiding the floating dock per `location.origin` (for dense full-screen web apps like WhatsApp, Element, or Discord) while keeping the Command Palette and Manager accessible via hotkey / Violentmonkey menu.
  - Make the dock collapsible with a custom **Bookmark Bolt** SVG icon, supporting `Hover + Click` expand/collapse (default) with per-site remembered click-pinned state and a Manager setting (`Hover + Click`, `Click only`, `Hover only`).
  - Eliminate horizontal overflow in the Manager modal, Command Palette, popovers, and folder dropdowns at `412px` mobile width.
  - Support touch drag-and-drop in the Manager via Pointer Events on `⠿` handles and draggable pills (working in Firefox Mobile and Chrome Mobile).
  - Add Pixel 10 (`412×924`, `hasTouch: true`) E2E tests in `tests/test_bookmarklet_toolbar_chrome_e2e.mjs`.
- **Non-Goals:**
  - Keeping `musicbrainzAdapter` or adding new site-specific header adapters.
  - Adding tap-based "Move" button menus to Library cards (touch reuses existing `⠿` handles).
  - Bumping `@version` or releasing to `main` (handled separately via `tools/workflow.py release`).
- **Anti-Goals:**
  - Mutating host page header styles or layout.
  - Horizontal scrolling (`scrollWidth > clientWidth`) in modals or palette on `412px` screens.
  - Loading external icon/polyfill dependencies (must stay self-contained and Trusted Types-safe).

## Constraints

- **Trusted Types & Self-Contained:** Build all DOM and SVG nodes via `createElement` / `createElementNS('http://www.w3.org/2000/svg', ...)` and `textContent`; zero `innerHTML`.
- **Storage Compatibility:** Extend `UserJS.BookmarkletToolbar.Settings` backward-compatibly with optional fields (`dockExpandMode`, `dockSitePositions`, `dockSiteExpanded`, `dockSiteHidden`).
- **Git & Build:** Work and commit on `dev`; rebuild `dist/Site Bookmarklet Toolbar.user.js` via `tools/build_dist.py`.
- **Browser Support:** Chrome-first with MDN-verified APIs (Pointer Events, `elementFromPoint`, `dvh` with `vh` fallback); note any Firefox gaps explicitly.

## Approaches Considered

1. **Responsive inline MusicBrainz header + touch drag:** Keep `musicbrainzAdapter` and wrap buttons onto a second header row on mobile. *Rejected:* Still vulnerable to host CSS/userstyle changes (such as sticky menus) and crowds mobile headers.
2. **Responsive modals + tap-based Move menus (no touch drag):** Replace drag on mobile with extra Move buttons. *Rejected:* Clutters cards and diverges from desktop interaction.
3. **Generic collapsible drag-to-snap dock everywhere + Pointer-Event touch DnD + responsive modals (Selected):** Eliminates host-header fragility, adapts cleanly to any site/viewport, and preserves one unified drag model across desktop and mobile.

## Detailed Design

### 1. Generic Dock Adapter & Removal of Site-Specific Header Injection

- Remove `musicbrainzAdapter` from `SITE_ADAPTERS` in `lib/BookmarkletToolbarAdapters.js`; keep `fallbackAdapter` (renamed/aliased as the generic fixed dock mount) as the active mount strategy for all matched URLs.
- Update `lib/BookmarkletToolbarAdapters.js` and `tests/test_bookmarklet_toolbar_adapters.js` / `tests/test_site_bookmarklet_toolbar_entry.js` / `tests/test_bookmarklet_toolbar_chrome_e2e.mjs` to reflect generic dock mounting on MusicBrainz and other matched sites.

### 2. Dock Positioning, Drag-to-Snap & Persistence

- **6 Snap Zones:** `top-left`, `top-center`, `top-right`, `bottom-left`, `bottom-center`, `bottom-right`.
- **Default:** `bottom-center` (`bottom: 16px; left: 50%; transform: translateX(-50%)`). Corner anchors use `16px` insets from their respective edges; `top-center` uses `top: 16px; left: 50%; transform: translateX(-50%)`.
- **Settings Schema (`lib/BookmarkletToolbarCore.js`):**
  - `dockExpandMode`: `'both' | 'click' | 'hover'` (default `'both'`).
  - `dockSitePositions`: `{ [origin: string]: SnapZone }` (default `{}`).
  - `dockSiteExpanded`: `{ [origin: string]: boolean }` (default `{}`).
  - `dockSiteHidden`: `{ [origin: string]: boolean }` (default `{}`).
- **Per-Site Hide/Show:**
  - When `dockSiteHidden[origin]` is `true`, the floating dock does not mount on that origin; scripts remain runnable via the Command Palette (`Alt+Shift+B` or Violentmonkey menu command).
  - Users can toggle hiding/showing the dock for the current `origin` from the Manager modal (dock controls) and from the Command Palette / Violentmonkey menu.
- **Drag-to-Snap Interaction:**
  - The dock handle button (`Bookmark Bolt` icon) listens for Pointer Events (`pointerdown` / `pointermove` / `pointerup` / `pointercancel`, `touch-action: none`).
  - Movement `<= 6px` is treated as a click/tap (toggles pinned expand/collapse when click mode is enabled).
  - Movement `> 6px` enters dock-drag mode: shows 6 translucent snap-zone drop guides inside the toolbar/overlay layer, highlights the zone nearest the pointer, and on `pointerup` snaps the dock to that zone and saves `dockSitePositions[origin]`.

### 3. Bookmark Bolt Icon & Collapsible Expand Behavior

- Render the **Bookmark Bolt** 16×16 SVG icon (`createElementNS`) inside the dock handle button (plus `.bt-amber-dot` when `hasRemoved` is true).
- **Default State:** When `dockSiteExpanded[origin]` is unset (`undefined`), the dock starts **collapsed** (`false`) so mobile viewports stay unobstructed and `'both'` mode's hover-to-expand is active immediately.
- **Collapsed:** Shows only the compact dock handle pill.
- **Expanded:** Reveals the site-matching script buttons, folder dropdown buttons, and `⌘` Command Palette button (existing unit/entry/E2E tests in `tests/test_bookmarklet_toolbar_ui.js`, `tests/test_site_bookmarklet_toolbar_entry.js`, and `tests/test_bookmarklet_toolbar_chrome_e2e.mjs` will be updated to expand the dock or seed `dockSiteExpanded` where they assert expanded toolbar buttons).
- **Modes (`settings.dockExpandMode`):**
  - `'both'` (default): Hovering temporarily expands; clicking the handle toggles pinned open/closed (`dockSiteExpanded[origin]`).
  - `'click'`: Only clicking toggles pinned open/closed.
  - `'hover'`: Expands on hover/focus-within and collapses on pointer leave/blur.
- Configure `dockExpandMode` via a compact segmented control/selector in the Manager modal header.
- **Viewport-Aware Folder Dropdowns:** Open upward when anchored at `bottom-*`, downward when at `top-*`, and align/clamp horizontally (`left: 0` on `*-left`, `right: 0` on `*-right`, centered and clamped within `100vw - 16px` on `*-center`) so menus never clip off-screen.

### 4. Responsive Manager Modal, Command Palette & Popovers (`412px` Safe)

- `.bt-modal` / `.bt-modal-lg`: `max-width: calc(100vw - 24px); max-height: calc(100vh - 24px); max-height: calc(100dvh - 24px); min-width: 0;` with `padding: 12px` on `.bt-backdrop` on narrow screens (`@media (max-width: 600px)`).
- Wrap `hdrSubBar`, `stickyTopRow`, and `libHeader` cleanly (`flex-wrap: wrap`); make `#mgr-search` fluid (`flex: 1 1 180px; min-width: 0; max-width: 100%`) instead of fixed `236px`.
- `.bt-manager-body`: `overflow-x: hidden; overflow-y: auto; min-width: 0;`.
- `.bt-palette-item`: `min-width: 0; overflow: hidden;` so `.bt-subtitle` ellipsis truncates inside the modal instead of expanding `.bt-modal` past `412px`.
- `.bt-popover` / `.bt-pack-popover`: `max-width: calc(100vw - 48px); left: 16px;` on narrow viewports.

### 5. Touch Drag-and-Drop in Manager (`⠿` Handles & Pills)

- Keep existing HTML5 DnD for desktop mouse, and add unified Pointer Events (`pointerdown` / `pointermove` / `pointerup` / `pointercancel`) on `.bt-grip` (`touch-action: none`) for Library cards and on draggable Toolbar/Folder pills (`.pill-base` / `.bt-grip` with `> 6px` drag threshold so double-click/tap-to-open still works).
- During touch/pointer drag, render a floating drag ghost pill following the pointer, query `overlayShadow.elementFromPoint(clientX, clientY)` to find the nearest `[data-drop-key]` target, apply the same `drop-active-*` classes and `#drag-hint` feedback, and invoke the target's `accept()` on `pointerup`.

### 6. Mobile & Desktop E2E Tests

- Update `tests/test_bookmarklet_toolbar_chrome_e2e.mjs` to add a Pixel 10 (`412×924`, `hasTouch: true`) scenario testing:
  - Generic dock renders at `bottom-center` by default, expands/collapses, and snaps to another zone on pointer drag.
  - Manager modal and Command Palette fit within `412px` (`scrollWidth <= clientWidth`, `rect.right <= 412`).
  - Touch pointer-drag on a Library card `⠿` handle drops onto the Toolbar strip and updates layout.

## Left to the Builder

- Exact CSS spacing/colors for the 6 snap-zone guides and floating touch-drag ghost pill.
- Helper refactoring between HTML5 `bindDropTarget` and pointer-drag target resolution so drop acceptance logic is shared without duplication.
