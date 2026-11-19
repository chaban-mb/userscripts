# Generic Collapsible Dock, Touch DnD & Mobile Responsive UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace site-specific header injection with a collapsible, drag-to-snap generic dock (`bottom-center` default, per-`origin` position/expand/hide persistence, Bookmark Bolt SVG), make Manager/Palette/dropdowns responsive at `412px`, add Pointer-Event touch DnD on `⠿` handles, and add Pixel 10 Chrome E2E tests.

**Architecture:** `BookmarkletToolbarCore.js` owns dock settings normalization (`dockExpandMode`, `dockSitePositions`, `dockSiteExpanded`, `dockSiteHidden`), `getSiteOrigin(url)`, and `shouldMountToolbar(..., settings)`. `BookmarkletToolbarAdapters.js` drops `musicbrainzAdapter` so all matched sites use the generic fixed dock host. `BookmarkletToolbarUI.js` renders the Bookmark Bolt SVG dock handle, 6-zone drag-to-snap, hover/click expand modes, viewport-aware dropdowns, `412px`-safe modals/palette, and unified Pointer-Event touch DnD alongside HTML5 DnD. `Site Bookmarklet Toolbar.user.js` wires `normalizeSettings` and a GM menu toggle for hiding/showing the dock on the current origin.

**Tech Stack:** Vanilla JavaScript (Shadow DOM, Pointer Events, SVG `createElementNS`), `node:test` + `node:assert/strict`, Headless Chrome E2E, Python `tools/build_dist.py`.

**Spec:** [2026-11-19-generic-dock-mobile-ux-design.md](file:///d:/Documents/git/userscripts/docs/superpowers/specs/2026-11-19-generic-dock-mobile-ux-design.md)

## Global Constraints

- Edit `lib/*.js`, `src/Site Bookmarklet Toolbar.user.js`, and `tests/*`; never edit `dist/` directly (rebuild via `tools/build_dist.py`).
- Zero `innerHTML` or HTML/SVG string sinks; build all DOM and SVG (`http://www.w3.org/2000/svg`) elements via `createElement` / `createElementNS` and `textContent`.
- Preserve backward compatibility for stored `UserJS.BookmarkletToolbar.Settings` (`hotkey` + new optional dock fields).
- Use Chrome-supported APIs (verified against MDN: Pointer Events, `elementFromPoint`, `dvh` with `vh` fallback) without external dependencies.
- Commit atomically on `dev` (`<type>(bookmarklet-toolbar): <summary>`).

## Review Focus

- **Unset/malformed `url` or `origin` (`about:blank`, `file://`, empty string):** `getSiteOrigin` must safely return a non-throwing fallback key (or `''`) without breaking `shouldMountToolbar` or `dockSitePositions` lookups.
- **Tap vs drag threshold (`6px`) on dock handle & touch pills:** A jittery finger tap (`<= 6px` movement) must still toggle expand/collapse (or double-tap/button click inside pills), while `> 6px` enters drag without triggering `click`.
- **Dock hidden on `origin` (`dockSiteHidden[origin] === true`):** Floating dock must not mount/render, while Command Palette (`Alt+Shift+B` / GM menu) and Manager (with "Show dock on this site" toggle) remain fully reachable.
- **Popup/dropdown clamping on `*-center` and `*-right` dock positions:** Folder dropdowns must open upward on `bottom-*`, downward on `top-*`, and stay within `8px` of left/right viewport edges on `412px` screens.
- **`pointercancel` / interrupted touch drag:** Releasing or cancelling pointer capture mid-drag (both dock snap drag and Manager `⠿` touch drag) must clean up snap guides, floating ghost pills, and `drop-active-*` / `data-dragging` states.

---

### Task 1: Core dock settings, origin helper, and per-site hide check

**Files:**

- Modify: `lib/BookmarkletToolbarCore.js:510-513`, `lib/BookmarkletToolbarCore.js:1267-1314`
- Test: `tests/test_bookmarklet_toolbar_core.js`

**Interfaces:**

- Produces:
  - `DOCK_SNAP_ZONES`: frozen array `['top-left', 'top-center', 'top-right', 'bottom-left', 'bottom-center', 'bottom-right']`
  - `DOCK_EXPAND_MODES`: frozen array `['both', 'click', 'hover']`
  - `getSiteOrigin(url: string) -> string`
  - `normalizeSettings(raw: object) -> { hotkey, dockExpandMode, dockSitePositions, dockSiteExpanded, dockSiteHidden, ... }`
  - `shouldMountToolbar(layout, scriptsMap, url, settings?) -> boolean`

- [ ] **Step 1: Write failing tests in `tests/test_bookmarklet_toolbar_core.js`**

Add a test verifying:

1. `Core.getSiteOrigin('https://musicbrainz.org/release/123?foo=1') === 'https://musicbrainz.org'`, `Core.getSiteOrigin('http://localhost:3000/app') === 'http://localhost:3000'`, and invalid/empty URLs return `''` without throwing.
2. `Core.normalizeSettings(null)` returns `{ hotkey: 'Alt+B', dockExpandMode: 'both', dockSitePositions: {}, dockSiteExpanded: {}, dockSiteHidden: {} }`.
3. `Core.normalizeSettings({ hotkey: 'Ctrl+K', dockExpandMode: 'invalid', dockSitePositions: { 'https://a.test': 'top-left', 'https://b.test': 'bad-zone' }, dockSiteExpanded: { 'https://a.test': true }, dockSiteHidden: { 'https://c.test': true } })` normalizes `dockExpandMode` to `'both'`, drops `'bad-zone'`, and preserves valid per-origin flags.
4. `Core.shouldMountToolbar(layout, scriptsMap, 'https://musicbrainz.org/release/123', { dockSiteHidden: { 'https://musicbrainz.org': true } })` returns `false`, while `https://beta.musicbrainz.org/release/123` returns `true`.

- [ ] **Step 2: Run core tests to verify they fail**

Run: `node --test tests/test_bookmarklet_toolbar_core.js`
Expected: FAIL (`Core.getSiteOrigin` / `Core.normalizeSettings` is not a function).

- [ ] **Step 3: Implement `getSiteOrigin`, `normalizeSettings`, and `shouldMountToolbar(..., settings)` in `lib/BookmarkletToolbarCore.js`**

Implement constants `DOCK_SNAP_ZONES`, `DOCK_EXPAND_MODES`, `getSiteOrigin(url)`, `normalizeSettings(raw)`, update `shouldMountToolbar(layout, scriptsMap, url, settings = null)` to return `false` when `origin && settings?.dockSiteHidden?.[origin] === true`, and export them on `BookmarkletToolbarCore`.

- [ ] **Step 4: Run core tests to verify they pass**

Run: `node --test tests/test_bookmarklet_toolbar_core.js`
Expected: PASS (all core tests green).

- [ ] **Step 5: Commit Task 1**

```bash
git add lib/BookmarkletToolbarCore.js tests/test_bookmarklet_toolbar_core.js
git commit -m "feat(bookmarklet-toolbar): add origin-scoped dock settings and hide check in Core"
```

---

### Task 2: Remove site-specific adapter and wire dock settings + GM menu toggle in entrypoint

**Files:**

- Modify: `lib/BookmarkletToolbarAdapters.js:20-218`
- Modify: `src/Site Bookmarklet Toolbar.user.js:204-216`, `src/Site Bookmarklet Toolbar.user.js:308-330`, `src/Site Bookmarklet Toolbar.user.js:406-445`
- Test: `tests/test_bookmarklet_toolbar_adapters.js`, `tests/test_site_bookmarklet_toolbar_entry.js`

**Interfaces:**

- Consumes: `Core.getSiteOrigin`, `Core.normalizeSettings`, `Core.shouldMountToolbar(layout, scriptsMap, url, settings)`.
- Produces: `Adapters.resolveMountAdapter(url, doc)` always returning the generic dock adapter (`id: 'fallback'`, `position: fixed; z-index: 2147483640;`); `GM.registerMenuCommand('Toggle Dock on This Site', ...)` in entrypoint.

- [ ] **Step 1: Update `tests/test_bookmarklet_toolbar_adapters.js` and `tests/test_site_bookmarklet_toolbar_entry.js` for generic dock everywhere + per-origin hide**

1. In `tests/test_bookmarklet_toolbar_adapters.js`, replace the `musicbrainzAdapter` header-injection tests with assertions that `resolveMountAdapter('https://musicbrainz.org/release/abc', mbDoc)` returns the generic `fallback` dock adapter and does not mutate `.header .right .top`.
2. In `tests/test_site_bookmarklet_toolbar_entry.js`, update the MusicBrainz mount assertions to expect the generic dock host on `doc.body` (leaving MusicBrainz's `.header .right .top` untouched), seed `dockSiteExpanded` where expanded buttons are clicked (or test expanding first), and add a test asserting `Toggle Dock on This Site` menu command hides/shows the dock for `https://musicbrainz.org` and persists `dockSiteHidden`.

- [ ] **Step 2: Run adapter & entry tests to verify they fail**

Run: `node --test tests/test_bookmarklet_toolbar_adapters.js tests/test_site_bookmarklet_toolbar_entry.js`
Expected: FAIL (`resolveMountAdapter` still returns `musicbrainz`, `Toggle Dock on This Site` menu command missing).

- [ ] **Step 3: Update `lib/BookmarkletToolbarAdapters.js` and `src/Site Bookmarklet Toolbar.user.js`**

1. Remove `musicbrainzAdapter`, `MB_URL_PATTERNS`, `findMusicBrainzMountTarget`, and `savedTopRowStyles` from `lib/BookmarkletToolbarAdapters.js` so `SITE_ADAPTERS = [fallbackAdapter]`. Let `fallbackAdapter.mount` set `position: fixed; z-index: 2147483640;` without overriding `top`/`right`/`bottom`/`left`/`transform` once `UI` manages snap coordinates (or let `UI` set them on `toolbarHost`).
2. In `src/Site Bookmarklet Toolbar.user.js`:
   - Normalize `state.settings` via `Core.normalizeSettings(...)` on startup and in `saveSettings(...)`.
   - Pass `state.settings` to `Core.shouldMountToolbar(state.layout, getScriptsMap(), state.url, state.settings)` on startup and in `evaluateUrlAndMountState()`.
   - Register `GM.registerMenuCommand('Toggle Dock on This Site', ...)` to flip `settings.dockSiteHidden[origin]`, persist via `saveSettings`, and update/mount or unmount `uiInstance`.

- [ ] **Step 4: Run adapter & entry tests to verify they pass**

Run: `node --test tests/test_bookmarklet_toolbar_adapters.js tests/test_site_bookmarklet_toolbar_entry.js`
Expected: PASS.

- [ ] **Step 5: Commit Task 2**

```bash
git add lib/BookmarkletToolbarAdapters.js src/Site\ Bookmarklet\ Toolbar.user.js tests/test_bookmarklet_toolbar_adapters.js tests/test_site_bookmarklet_toolbar_entry.js
git commit -m "refactor(bookmarklet-toolbar): use generic dock on all sites and add per-origin dock toggle"
```

---

### Task 3: Collapsible drag-to-snap dock, Bookmark Bolt SVG, responsive modals (`412px`), and touch Pointer DnD

**Files:**

- Modify: `lib/BookmarkletToolbarUI.js`
- Test: `tests/test_bookmarklet_toolbar_ui.js`

**Interfaces:**

- Consumes: `Core.DOCK_SNAP_ZONES`, `Core.DOCK_EXPAND_MODES`, `Core.getSiteOrigin`, `Core.normalizeSettings`.
- Produces:
  - `.bt-dock-handle` with Bookmark Bolt `<svg>` (`createElementNS`), hover/click expand behavior, and 6-zone pointer drag-to-snap (`dockSitePositions[origin]`).
  - Viewport-aware `.bt-dropdown` alignment (`up`/`down`, `left`/`right`/`center` clamped).
  - Manager header controls for `dockExpandMode` (`both`/`click`/`hover`) and `Hide/Show dock on this site` (`dockSiteHidden[origin]`), plus Command Palette action `Hide/Show Dock on Current Site`.
  - `412px`-safe `.bt-modal`, `.bt-modal-lg`, `hdrSubBar`, `libHeader`, `#mgr-search`, `.bt-palette-item`, and popovers.
  - Unified Pointer-Event touch DnD on `.bt-grip` (`touch-action: none`) and draggable pills using `elementFromPoint` + floating ghost pill + shared drop resolution.

- [ ] **Step 1: Write failing UI tests in `tests/test_bookmarklet_toolbar_ui.js`**

Add tests covering:

1. Dock defaults to `bottom-center` and **collapsed** (`dockSiteExpanded[origin]` unset), rendering the `.bt-dock-handle` Bookmark Bolt `<svg>` without expanded script buttons until hovered/clicked (or `dockSiteExpanded[origin] === true`).
2. Clicking `.bt-dock-handle` in `'both'` / `'click'` mode toggles `settings.dockSiteExpanded[origin]` and emits `onStateChange`; hovering temporarily expands in `'both'` / `'hover'` mode.
3. Pointer-dragging `.bt-dock-handle` (`pointerdown` -> `pointermove` > 6px -> `pointerup` near top-right) snaps and emits `settings.dockSitePositions[origin] = 'top-right'`, while `<= 6px` triggers click toggle only, and `pointercancel` cleans up snap guides.
4. Folder dropdown opens upward (`bt-dropdown-up`) on `bottom-*` and downward on `top-*`.
5. Hiding dock on current origin (`dockSiteHidden[origin] = true`) unmounts `toolbarHost` while `openManager()` / `openPalette()` still expose the toggle to re-enable it.
6. Responsive CSS rules exist in `uiSource` (`overflow-x: hidden` on `.bt-manager-body`, `flex-wrap: wrap` on responsive header/library bars, `min-width: 0` on `.bt-modal`/`.bt-palette-item`, `100dvh`, `touch-action: none` on `.bt-grip` / `.bt-dock-handle`).
7. Pointer-event touch drag on a Library card `.bt-grip` (`pointerdown` -> `pointermove` > 6px over `#toolbar-strip` via mocked `elementFromPoint` -> `pointerup`) pins the script to Toolbar, and `pointercancel` cleans up the ghost pill and active drop feedback.

- [ ] **Step 2: Run UI tests to verify they fail**

Run: `node --test tests/test_bookmarklet_toolbar_ui.js`
Expected: FAIL on missing `.bt-dock-handle`, SVG icon, snap-zone drag, responsive CSS rules, and pointer touch DnD.

- [ ] **Step 3: Implement dock, responsive CSS, and touch Pointer DnD in `lib/BookmarkletToolbarUI.js`**

1. **CSS updates in `buildStyles()`:**
   - Replace inline/dock split with unified `.bt-toolbar-dock` styles, `.bt-dock-handle` (`touch-action: none; display: inline-flex; align-items: center; gap: 5px; cursor: grab;`), `.bt-dock-snap-overlay` & `.bt-dock-snap-zone` (6 fixed corner/center guides shown during dock drag), `.bt-dropdown` horizontal/vertical edge variants, and `.bt-touch-ghost` for touch DnD.
   - Responsive rules: `.bt-modal` (`max-width: calc(100vw - 24px); min-width: 0;`), `.bt-modal-lg` (`max-height: calc(100vh - 24px); max-height: calc(100dvh - 24px);`), `.bt-manager-body` (`overflow-x: hidden; min-width: 0;`), `.bt-palette-item` (`min-width: 0; overflow: hidden;`), `.bt-popover` / `.bt-pack-popover` (`max-width: calc(100vw - 48px)`), wrapping `hdrSubBar` / `stickyTopRow` / `libHeader`, fluid `#mgr-search`, and `touch-action: none` on `.bt-grip`.
2. **Dock rendering & drag-to-snap (`renderToolbarView`):**
   - Apply snap-zone positioning to `toolbarHost` (`applyDockPosition(toolbarHost, snapZone)`).
   - Build Bookmark Bolt `<svg>` via `createElementNS('http://www.w3.org/2000/svg', ...)` inside `.bt-dock-handle`.
   - Wire `pointerdown`/`pointermove`/`pointerup`/`pointercancel` on `.bt-dock-handle` (`6px` threshold -> click toggle vs 6-zone drag-to-snap), plus `mouseenter`/`mouseleave` on `.bt-toolbar-dock` for hover expand when `dockExpandMode !== 'click'`.
   - Adjust `.bt-dropdown` vertical/horizontal alignment based on `snapZone` and viewport bounds.
3. **Manager & Palette Dock Controls:**
   - Add compact `Expand: Hover+Click / Click / Hover` selector (`dockExpandMode`) and `Show/Hide dock on this site` toggle (`dockSiteHidden[origin]`) in Manager header, plus `Hide/Show Dock on Current Site` action in Command Palette.
4. **Pointer-Event Touch DnD in Manager:**
   - Extract shared `resolveDropTargetAtPoint(clientX, clientY)` using `overlayShadow.elementFromPoint(clientX, clientY)` (walking up to `[data-drop-key]`) and shared drop plan evaluation (`__btResolveDrop(payload, syntheticEvent)` stored via WeakMap or target registry).
   - Wire `pointerdown` / `pointermove` / `pointerup` / `pointercancel` on `.bt-grip` (and pills with `> 6px` threshold for `pointerType !== 'mouse'` or touch/pen) with floating `.bt-touch-ghost` pill and guaranteed cleanup on `pointerup`/`pointercancel`.

- [ ] **Step 4: Run all JS unit tests to verify they pass**

Run: `node --test tests/test_bookmarklet_toolbar_core.js tests/test_bookmarklet_toolbar_adapters.js tests/test_bookmarklet_toolbar_ui.js tests/test_site_bookmarklet_toolbar_entry.js`
Expected: PASS (all unit/entry tests green).

- [ ] **Step 5: Commit Task 3**

```bash
git add lib/BookmarkletToolbarUI.js tests/test_bookmarklet_toolbar_ui.js
git commit -m "feat(bookmarklet-toolbar): add collapsible snap dock, responsive modals, and touch DnD"
```

---

### Task 4: Desktop & Pixel 10 (`412×924`) Chrome E2E tests and `dist/` rebuild

**Files:**

- Modify: `tests/test_bookmarklet_toolbar_chrome_e2e.mjs`
- Rebuild: `dist/Site Bookmarklet Toolbar.user.js`

**Interfaces:**

- Consumes: `src/Site Bookmarklet Toolbar.user.js`, `tools/build_dist.py`, Headless Chrome (`--headless=new` via CDP/DevTools or existing `test_bookmarklet_toolbar_chrome_e2e.mjs` harness).

- [ ] **Step 1: Update desktop scenarios and add Pixel 10 (`412×924`, `hasTouch: true`) scenario in `tests/test_bookmarklet_toolbar_chrome_e2e.mjs`**

1. Update desktop MusicBrainz assertions: verify MusicBrainz header/search box is untouched, generic dock starts collapsed at `bottom-center`, expands on click/hover, and executes bookmarklets / opens Manager / Command Palette.
2. Add a Pixel 10 (`412×924`, `deviceScaleFactor: 2.625` or `1`, `hasTouch: true`) test scenario verifying:
   - Dock renders at `bottom-center` within `[0, 412]` horizontally and expands on tap.
   - Pointer-dragging dock handle moves and snaps dock to `top-right` (`rect.top < 60`, `rect.right > 300`).
   - Manager modal and Command Palette have `scrollWidth <= clientWidth` and `rect.right <= 412` (zero horizontal overflow).
   - Touch pointer-drag on a Library card `.bt-grip` drops onto `#toolbar-strip` and updates layout.
   - Toggling "Hide dock on this site" unmounts the dock while Command Palette remains openable.

- [ ] **Step 2: Rebuild `dist/Site Bookmarklet Toolbar.user.js` and run full verification suite**

Run:

- `python tools/build_dist.py --out dist --script "Site Bookmarklet Toolbar.user.js"`
- `node --test tests/test_bookmarklet_toolbar_core.js tests/test_bookmarklet_toolbar_adapters.js tests/test_bookmarklet_toolbar_ui.js tests/test_site_bookmarklet_toolbar_entry.js tests/test_bookmarklet_toolbar_chrome_e2e.mjs`
- `python -m unittest tests/test_build_dist_sync.py`
Expected: PASS (all JS unit tests, Pixel 10 + Desktop Chrome E2E tests, and `build_dist_sync` pass).

- [ ] **Step 3: Commit Task 4**

```bash
git add tests/test_bookmarklet_toolbar_chrome_e2e.mjs
git commit -m "test(bookmarklet-toolbar): add Pixel 10 mobile E2E and update generic dock assertions"
```
