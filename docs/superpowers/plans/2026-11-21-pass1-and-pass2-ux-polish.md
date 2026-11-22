# Pass 1 & Pass 2 UX Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate Manager modal layout shifts and offscreen `ⓘ` popovers (Pass 1), then add zero-shift anchor-relative dock expansion (two-tier at center, left/right/vertical at corners), `Auto | Horizontal | Vertical` orientation, a `»` overflow menu, expansion animations, and Library drop-back unpinning (Pass 2).

**Architecture:** Pass 1 updates `BookmarkletToolbarUI.js` so `#manager-backdrop` is top-anchored (`align-items: flex-start`) with fixed-height `.bt-modal-lg` (`calc(100dvh - 32px)`) and positions script/pack `.bt-popover` via `position: fixed` clamped to the viewport. Pass 2 extends `BookmarkletToolbarCore.js` with `DOCK_ORIENTATIONS` (`auto` | `horizontal` | `vertical`), binds `.bt-library-section` as an unpin/remove drop target, and refactors `renderToolbarView()` in `BookmarkletToolbarUI.js` to render constant-`4px`-padding zero-shift handles, two-tier `*-center` bars with a hover bridge, right-pinned `TR`/`BR` vertical header rows, single-line overflow measurement into a `»` dropdown (`state.openDropdownId = '__overflow__'`), and `prefers-reduced-motion`-safe expansion animations.

**Tech Stack:** Vanilla JavaScript (Shadow DOM, Pointer Events, SVG `createElementNS`), `node:test`, Headless Chrome E2E, Python `tools/build_dist.py`.

**Specs:**

- Pass 1: [2026-11-21-manager-ux-polish-design.md](file:///d:/Documents/git/userscripts/docs/superpowers/specs/2026-11-21-manager-ux-polish-design.md)
- Pass 2: [2026-11-21-dock-expansion-overflow-design.md](file:///d:/Documents/git/userscripts/docs/superpowers/specs/2026-11-21-dock-expansion-overflow-design.md)

## Global Constraints

- Edit `lib/*.js`, `src/Site Bookmarklet Toolbar.user.js`, and `tests/*`; never edit `dist/` directly (rebuild via `tools/build_dist.py`).
- Zero `innerHTML` or HTML/SVG string sinks; use `createElement` / `createElementNS` and `textContent`.
- Preserve backward compatibility for stored `UserJS.BookmarkletToolbar.Settings`.
- Commit atomically on `dev` (`<type>(bookmarklet-toolbar): <summary>`).

## Review Focus

- **`ⓘ` popover near bottom/right viewport edge or scrolled inside `.bt-manager-body`:** Must flip above `ⓘ` when bottom space is insufficient, clamp horizontally within `[8, vw - 8]`, cap `maxHeight` with `overflow-y: auto`, and close or re-anchor cleanly on `.bt-manager-body` scroll.
- **Zero-pixel shift of `.bt-dock-handle` (`[⚡]`) across all 6 zones & orientations:** Toggling collapsed ↔ expanded must keep `[⚡]`'s bounding box stationary (`0px` delta on the anchored corner/center edge), including `TR`/`BR` in vertical mode (`justify-content: flex-end`).
- **`[⌘]` stability & `[»]` placement:** `[⌘]` must stay immediately adjacent to `[⚡]` (or first in the center bar) so `[⌘]` never shifts when `[»]` appears; in vertical mode `[»]` must appear **last** at the bottom of the script list.
- **Two-tier `*-center` hover bridge in `'both'` / `'hover'` mode:** Moving the pointer across the `6px` gap between `[⚡]` and the floating center bar must not fire `mouseleave` collapse.
- **Overflowed `📁` folders inside `»` menu:** Clicking/expanding an overflowed folder inside `»` must reveal and run its matching items inline within the `»` dropdown without opening a second clipping flyout.

---

### Task 1 (Pass 1): Top-anchored fixed-height Manager modal and viewport-clamped `position: fixed` info popovers

**Files:**

- Modify: `lib/BookmarkletToolbarUI.js`
- Test: `tests/test_bookmarklet_toolbar_ui.js`
- Rebuild: `dist/Site Bookmarklet Toolbar.user.js`

**Interfaces:**

- Produces: Top-anchored `#manager-backdrop` (`.bt-backdrop-top` / `align-items: flex-start`), fixed-height `.bt-modal-lg` (`height: calc(100vh - 32px); height: calc(100dvh - 32px)`), and `positionElementInViewport(popEl, anchorEl, win, doc)` for `.bt-popover` (`position: fixed`, vertical flip + horizontal clamp + `maxHeight`).

- [ ] **Step 1: Write failing tests in `tests/test_bookmarklet_toolbar_ui.js` for Pass 1**

Add tests verifying:

1. `#manager-backdrop` uses top alignment and `.bt-modal-lg` defines fixed `height: calc(100vh - 32px)` / `calc(100dvh - 32px)` in `uiSource`.
2. `.bt-popover` uses `position: fixed` and `overflow-y: auto`, and opening `ⓘ` on a card near the bottom of an `800×600` viewport (`infoBtn.getBoundingClientRect = () => ({ top: 540, bottom: 560, left: 600, right: 620, width: 20, height: 20 })`, `pop.getBoundingClientRect = () => ({ width: 288, height: 220 })`) positions `pop.style.top` above `540px` and clamps `pop.style.left` within `800 - 288 - 8 = 504px`.
3. Scrolling `.bt-manager-body` while `state.openInfoId` is open closes or re-clamps the popover so it never floats detached over unrelated cards.

- [ ] **Step 2: Run UI tests to verify RED failure**

Run: `node --test tests/test_bookmarklet_toolbar_ui.js`
Expected: FAIL on `.bt-modal-lg` fixed height and `.bt-popover` viewport positioning.

- [ ] **Step 3: Implement Pass 1 in `lib/BookmarkletToolbarUI.js` and rebuild `dist/`**

1. Add fixed `height: calc(100vh - 32px); height: calc(100dvh - 32px);` (`calc(100dvh - 24px)` under `@media (max-width: 600px)`) to `.bt-modal-lg` and top alignment (`align-items: flex-start; padding-top: 16px;`) for `#manager-backdrop`.
2. Update `.bt-popover` to `position: fixed; max-height: min(320px, calc(100dvh - 32px)); overflow-y: auto; z-index: 2147483646;` and implement `positionPopoverInViewport(popEl, triggerEl)` (called when `state.openInfoId` renders for a script card or `#pack-info-btn`), plus close `state.openInfoId` on `managerBody` scroll when open.
3. Rebuild `dist/Site Bookmarklet Toolbar.user.js` via `python tools/build_dist.py --out dist --script "Site Bookmarklet Toolbar.user.js"`.

- [ ] **Step 4: Run tests to verify GREEN**

Run: `node --test tests/test_bookmarklet_toolbar_ui.js tests/test_bookmarklet_toolbar_chrome_e2e.mjs`
Expected: PASS.

- [ ] **Step 5: Commit Task 1 (Pass 1)**

```bash
git add docs/superpowers/specs/2026-11-21-manager-ux-polish-design.md lib/BookmarkletToolbarUI.js tests/test_bookmarklet_toolbar_ui.js
git commit -m "fix(bookmarklet-toolbar): lock manager modal height and clamp info popovers to viewport"
```

---

### Task 2 (Pass 2A): Core `dockOrientation` setting and Library drop-back unpin/remove target

**Files:**

- Modify: `lib/BookmarkletToolbarCore.js`, `lib/BookmarkletToolbarUI.js`
- Test: `tests/test_bookmarklet_toolbar_core.js`, `tests/test_bookmarklet_toolbar_ui.js`

**Interfaces:**

- Produces:
  - `Core.DOCK_ORIENTATIONS`: frozen array `['auto', 'horizontal', 'vertical']`
  - `Core.normalizeSettings(raw)` including `dockDefaultPosition` (default `'bottom-center'`), `dockOrientation` (default `'auto'`), and `dockSiteOrientations: { [origin]: 'auto' | 'horizontal' | 'vertical' }`
  - `.bt-library-section` drop target (`data-drop-key="library-unpin"`) accepting `toolbar-script` (`Core.toggleToolbarPin`) and `folder-item` (`Core.removeFolderItem`), ignoring `library-script` and `toolbar-folder`.

- [ ] **Step 1: Write failing tests in `tests/test_bookmarklet_toolbar_core.js` and `tests/test_bookmarklet_toolbar_ui.js`**

1. Assert `Core.DOCK_ORIENTATIONS` equals `['auto', 'horizontal', 'vertical']` and `Core.normalizeSettings({ dockDefaultPosition: 'top-right', dockOrientation: 'vertical', dockSiteOrientations: { 'https://musicbrainz.org': 'horizontal', 'https://bad.test': 'invalid' } })` normalizes `dockDefaultPosition`, `dockOrientation`, and `dockSiteOrientations` (dropping invalid values and defaulting to `'bottom-center'` / `'auto'`).
2. Assert dragging a `toolbar-script` pill or `folder-item` chip onto `.bt-library-section` (via HTML5 `dragover`/`drop` and touch Pointer DnD) shows `"Unpin … from Toolbar"` / `"Remove … from …"` and removes the item from Toolbar or Folder, while dragging a `library-script` or `toolbar-folder` over `.bt-library-section` is a no-op.

- [ ] **Step 2: Run core & UI tests to verify RED failure**

Run: `node --test tests/test_bookmarklet_toolbar_core.js tests/test_bookmarklet_toolbar_ui.js`
Expected: FAIL (`DOCK_ORIENTATIONS` undefined, `.bt-library-section` has no `data-drop-key`).

- [ ] **Step 3: Implement `DOCK_ORIENTATIONS` in Core and `.bt-library-section` drop target in UI**

1. Add `DOCK_ORIENTATIONS = Object.freeze(['auto', 'horizontal', 'vertical'])` and `dockOrientation` normalization in `lib/BookmarkletToolbarCore.js`.
2. Bind `overlayEls.librarySection` (`class="bt-library-section"`) with `bindDropTarget(librarySection, 'library-unpin', ...)` in `renderManagerView()` in `lib/BookmarkletToolbarUI.js`.

- [ ] **Step 4: Run core & UI tests to verify GREEN**

Run: `node --test tests/test_bookmarklet_toolbar_core.js tests/test_bookmarklet_toolbar_ui.js`
Expected: PASS.

- [ ] **Step 5: Commit Task 2 (Pass 2A)**

```bash
git add lib/BookmarkletToolbarCore.js lib/BookmarkletToolbarUI.js tests/test_bookmarklet_toolbar_core.js tests/test_bookmarklet_toolbar_ui.js
git commit -m "feat(bookmarklet-toolbar): add dockOrientation setting and library drop-back unpinning"
```

---

### Task 3 (Pass 2B): Zero-shift dock expansion, two-tier center, vertical orientation, `»` overflow menu, and E2E verification

**Files:**

- Modify: `lib/BookmarkletToolbarUI.js`
- Test: `tests/test_bookmarklet_toolbar_ui.js`, `tests/test_bookmarklet_toolbar_chrome_e2e.mjs`
- Rebuild: `dist/Site Bookmarklet Toolbar.user.js`

**Interfaces:**

- Consumes: `Core.DOCK_ORIENTATIONS`, `state.settings.dockOrientation`.
- Produces:
  - Zero-shift (`0px` delta) `.bt-dock-handle` (`[⚡]`) across all 6 snap zones and `horizontal`/`vertical` orientations.
  - Ordering:
    - `*-center`: stationary `[⚡]` anchor pill + floating horizontal bar `[⌘] [Scripts…] [»]` with hover bridge.
    - `*-left` horizontal: `[⚡] [⌘] [Scripts…] [»]`
    - `*-right` horizontal: `[»] [Scripts…] [⌘] [⚡]`
    - `*-left` / `*-right` vertical: header row (`[⚡] [⌘]` left-aligned on `*-left`, `[⌘] [⚡]` right-aligned on `*-right`) at the anchored corner + vertical script list (`Script 1 … Script N`) with `[»]` placed **last**.
  - Single-line dynamic pixel-budget overflow into `More »` (`[data-action="open-overflow"]`, `textContent = 'More »'`, `state.openDropdownId = '__overflow__'`), re-evaluated on `window` `resize` and `orientationchange`, with overflowed folders rendered as inline expandable groups inside `More »` and vertical-mode dropdowns opening sideways beside the column.
  - Hybrid scope (#3) for Position (`dockSitePositions[origin]` + `dockDefaultPosition`) and Orientation (`dockSiteOrientations[origin]` + `dockOrientation`) via Manager header `Orientation: Auto | Horiz | Vert` control.
  - `200ms cubic-bezier(0.22, 1, 0.36, 1)` expansion animation with `@media (prefers-reduced-motion: reduce)`.

- [ ] **Step 1: Write failing tests in `tests/test_bookmarklet_toolbar_ui.js` and `tests/test_bookmarklet_toolbar_chrome_e2e.mjs`**

Add tests verifying:

1. Element order & zero-shift handle geometry across `bottom-center` (two-tier: `.bt-dock-anchor-pill` + `.bt-dock-items-bar`), `bottom-left` horizontal (`[⚡, ⌘, ...scripts, »]`), `bottom-right` horizontal (`[», ...scripts, ⌘, ⚡]`), and `top-right`/`bottom-right` vertical (header row `[⌘, ⚡]` with `justify-content: flex-end`, scripts top-to-bottom, `»` last).
2. `Auto` orientation resolves to `'vertical'` on portrait (`412×924`) at `*-left`/`*-right` and `'horizontal'` at `*-center` or landscape (`1280×800`); Manager `Orientation` buttons update `settings.dockOrientation`.
3. When visible scripts/folders exceed the dock budget, excess items move into `»` (`[data-action="open-overflow"]`), clicking `»` opens the overflow `.bt-dropdown`, clicking an overflowed script executes it, and clicking an overflowed `📁` folder toggles its items inline inside the `»` dropdown.
4. In Chrome E2E (`tests/test_bookmarklet_toolbar_chrome_e2e.mjs`), verify `[⚡]` bounding-box coordinates change by `0px` on expand/collapse across `bottom-center` and `bottom-right`, `»` overflow menu appears when many scripts are pinned, and dragging a Toolbar pill back to `.bt-library-section` unpins it.

- [ ] **Step 2: Run UI tests to verify RED failure**

Run: `node --test tests/test_bookmarklet_toolbar_ui.js`
Expected: FAIL on two-tier center structure, corner ordering, orientation buttons, and `»` overflow menu.

- [ ] **Step 3: Implement zero-shift expansion, orientation, `»` overflow, and animations in `lib/BookmarkletToolbarUI.js`, then rebuild `dist/`**

Implement the CSS, two-tier center layout + hover bridge, corner horizontal/vertical ordering, viewport-budget `»` overflow partition + inline folder expansion inside `»`, Manager orientation segmented control, and rebuild `dist/Site Bookmarklet Toolbar.user.js`.

- [ ] **Step 4: Run full JS, Chrome E2E, and Python build sync test suites to verify GREEN**

Run:

- `python tools/build_dist.py --out dist --script "Site Bookmarklet Toolbar.user.js"`
- `node --test tests/test_bookmarklet_toolbar_core.js tests/test_bookmarklet_toolbar_adapters.js tests/test_bookmarklet_toolbar_ui.js tests/test_site_bookmarklet_toolbar_entry.js tests/test_bookmarklet_toolbar_chrome_e2e.mjs`
- `python -m unittest tests/test_build_dist_sync.py`
Expected: PASS (all unit, E2E, and build sync tests green).

- [ ] **Step 5: Commit Task 3 (Pass 2B)**

```bash
git add docs/superpowers/specs/2026-11-21-dock-expansion-overflow-design.md docs/superpowers/plans/2026-11-21-pass1-and-pass2-ux-polish.md lib/BookmarkletToolbarUI.js tests/test_bookmarklet_toolbar_ui.js tests/test_bookmarklet_toolbar_chrome_e2e.mjs
git commit -m "feat(bookmarklet-toolbar): add zero-shift dock expansion, orientation modes, and overflow menu"
```
