# Site Bookmarklet Toolbar — Unified Backlog Upgrade Design (#1–#18)

**Date:** 2026-11-24  
**Scope:** Project across `src/Site Bookmarklet Toolbar.user.js`, `lib/BookmarkletToolbarCore.js`, `lib/BookmarkletToolbarAdapters.js`, `lib/BookmarkletToolbarUI.js`, unit & Headless Chrome E2E tests, and `dist/Site Bookmarklet Toolbar.user.js` rebuild.  
**References:**

- [2026-11-22-bookmarklet-toolbar-backlog.md](2026-11-22-bookmarklet-toolbar-backlog.md)
- [2026-11-21-dock-expansion-overflow-design.md](2026-11-21-dock-expansion-overflow-design.md)
- [2026-11-21-manager-ux-polish-design.md](2026-11-21-manager-ux-polish-design.md)
- [csp-shadow-dom-gm-styles.md](../research/csp-shadow-dom-gm-styles.md)

---

## 1. Intent & Why

Real-world usage across desktop Chrome, Firefox Mobile (including non-viewport-meta pages like MusicBrainz), strict-CSP sites (MusicBrainz `/account/*` `style-src 'self'`, Spotify `script-src 'self' 'unsafe-eval' blob:`), and iframe-heavy dashboards (MetaBrainz Jira) surfaced 18 concrete gaps spanning reliability, mobile layout/touch bugs, CSP compatibility, hover/folder ergonomics, Manager cognitive overload, and Manager/Settings/Command Palette architecture.

### Goals

- Fix all Batch 1 correctness, mobile, iframe, CSP, and Command Palette issues (**#1–#11**).
- Separate **Manager** (scripts, folders, layout) from **Settings** (configuration, backup) into independent modals, both directly accessible from the Command Palette (**#14, #18**).
- Add global default dock visibility (`Shown` vs `Hidden`) with per-origin overrides (**#12**).
- Reduce Manager layout cognitive overload by dimming non-matching scripts and fully non-matching folders in `Toolbar Layout` and `Folder Drawer` (**#13**).
- Make multi-script folder workflows and hover mode effortless via global folder settings (`Open folders & More » on hover`, `Keep folder & More » open after running`) and hover collapse grace delay + expanded hit buffer (**#15–#17**).
- Expose Manager actions and multi-state settings in the Command Palette via drill-down sub-views with direct-search shortcuts (**#18**).

### Non-Goals

- Bumping `@version` or releasing to `main` (handled separately via `tools/workflow.py release`).
- Adding a hide-non-matching toggle inside Manager's `Toolbar Layout` / `Folder Drawer` panes (dimming only; Library keeps its existing `"Matching current site"` filter checkbox).
- Per-folder keep-open pin toggles inside dropdowns (global setting only).
- Mobile keyboard-shortcut workarounds for hidden-by-default docks (users toggle/open via Violentmonkey menu commands for now).

### Anti-Goals

- Mocking away CSP errors in browser E2E tests (e.g. injecting a fake `GM.addElement` in strict-CSP Chrome tests to force a green run). Real CSP failures must remain visible when standard DOM mechanisms are blocked and no extension API is present.
- Invoking `GM.addElement` eagerly before standard DOM mechanisms fail.
- Breaking `0px` `[⚡]` anchor stability on expand/collapse across all 6 snap zones.
- Breaking backward compatibility with persisted `UserJS.BookmarkletToolbar.Settings` (specifically existing `dockSiteHidden` maps).

---

## 2. Constraints

- **Edit targets:** Edit only `src/*.user.js`, `lib/*.js`, `tests/*`, and rebuild `dist/Site Bookmarklet Toolbar.user.js` via `tools/build_dist.py`.
- **Trusted Types safety:** Zero `innerHTML` / `outerHTML`; `createElement` / `createElementNS` / `textContent` only; extend `userjs-bt-toolbar` Trusted Types policy with `createScriptURL` for `blob:` script URLs.
- **CSP cleanliness:** Avoid `<style>` tags in Shadow DOM when constructable stylesheets (`CSSStyleSheet` + `adoptedStyleSheets`) are available, and avoid `setAttribute('style', ...)` / `cssText` strings on `toolbarHost` / `overlayHost`.
- **Browser support:** Chrome, Firefox (desktop & Firefox Mobile portrait/landscape, including non-viewport-meta pages), and Safari 16.4+.
- **Pure library modules:** `lib/BookmarkletToolbarAdapters.js` and `lib/BookmarkletToolbarUI.js` accept an optional `gmAddElement` callback via options rather than coupling directly to global `GM`.

---

## 3. Approaches Considered

1. **Approach 1 (Selected): Single Unified 3-Wave Upgrade (#1–#18)**
   - **Wave 1 (Core, Adapters, Entry):** Extend `Core.normalizeSettings` + visibility/matching helpers, implement 3-tier CSP script execution fallback chain in `Adapters`, add `@noframes`, top-frame guard, `@grant GM.addElement`, and menu updates in `src/Site Bookmarklet Toolbar.user.js`.
   - **Wave 2 (UI):** Extract standalone `⚙ Settings` modal, update Command Palette (buttons + drill-down sub-views + search/description/badge fixes), migrate Shadow DOM CSS to `adoptedStyleSheets` + `:host([data-snap-zone="..."])`, fix mobile `*-center` overflow, sub-modals, touch double-toggle, input keystroke isolation, Manager dimming, portrait sticky layout, folder hover/keep-open, and hover grace delay + expanded hit buffer.
   - **Wave 3 (Verification & Build):** Update unit tests, add unmocked Headless Chrome CSP/iframe/mobile E2E scenarios, and rebuild `dist/`.
   - *Trade-off:* Single cohesive pass avoids editing the Manager header and Command Palette twice and gives a clean unified verification pass, at the cost of a larger single milestone.
2. **Approach 2 (Not Selected): Two Sequential Releases (Batch 1 Fixes → Batches 2–3 UX/Settings)**
   - *Trade-off:* Smaller intermediate PR for mobile/CSP fixes, but doubles design→plan→test→build cycles and touches Manager/Palette twice.
3. **Approach 3 (Rejected): Parallel Feature Branches inside `BookmarkletToolbarUI.js`**
   - *Trade-off:* `lib/BookmarkletToolbarUI.js` is a ~6,100-line IIFE with shared CSS template and state closures; concurrent edits cause severe merge conflicts.

---

## 4. Detailed Design

### Wave 1: Entry, Core Schema & Adapters

#### 4.1 Entry Script (`src/Site Bookmarklet Toolbar.user.js`) — #6, #10, #11, #12, #18

- **No-frames guard (#6):** Add `// @noframes` to the userscript metadata block **and** an early runtime check immediately after `win`/`doc` resolution:

  ```js
  try {
      if (win.top && win.self !== win.top) {
          return;
      }
  } catch {
      return; // Cross-origin frame access error implies non-top frame
  }
  ```

- **Grant & injection (#10, #11):** Add `// @grant GM.addElement`. Resolve `const gmAddElement = typeof GM !== 'undefined' && typeof GM.addElement === 'function' ? GM.addElement.bind(GM) : null;` and pass `gmAddElement` into `Adapters.executeScriptInPage(code, { doc, win, gmAddElement, onError })` and `UI.createToolbarUI({ ..., gmAddElement })`.
- **Menu commands (#12, #18):** Register:
  1. `'Open Command Palette'` → `ui.openPalette()`
  2. `'Open Bookmarklet Manager'` → `ui.openManager()`
  3. `'Open Bookmarklet Settings'` → `ui.openSettings()` *(Author call: matches independent Manager/Settings UX)*
  4. `'Toggle Dock on This Site'` → calls `Core.toggleDockSiteVisibility(state.settings, origin)`, saves settings, and mounts/updates UI so toggling works symmetrically whether global default is `Shown` or `Hidden`.

#### 4.2 Core Schema & Helpers (`lib/BookmarkletToolbarCore.js`) — #12, #13, #15, #16

- **Settings fields in `normalizeSettings(raw)`:**
  - `dockDefaultVisible`: `boolean` (default `true`).
  - `dockSiteVisibility`: origin map `{ [origin: string]: 'shown' | 'hidden' }`.
    - **Migration:** For every `[origin, hidden]` in legacy `source.dockSiteHidden`, if `hidden === true` and `dockSiteVisibility[origin]` is unset, migrate to `dockSiteVisibility[origin] = 'hidden'`.
    - *(Author call)* Keep `dockSiteVisibility` canonical and strip or stop writing new entries to `dockSiteHidden` (preserving read compatibility if imported from older JSON exports).
  - `folderHoverOpen`: `boolean` (default `false`) — applies to toolbar folders and `More »`.
  - `keepFolderOpenAfterRun`: `boolean` (default `false`) — applies to toolbar folders and `More »`.
- **Visibility helpers:**
  - `isDockVisibleOnOrigin(settings, urlOrOrigin)`: resolves origin (`getSiteOrigin` if URL, or normalized origin string). If `dockSiteVisibility[origin] === 'shown'` return `true`; if `'hidden'` return `false`; otherwise return `settings?.dockDefaultVisible !== false`.
  - `toggleDockSiteVisibility(settings, origin)`: computes `currentlyVisible = isDockVisibleOnOrigin(settings, origin)` and target `nextVisible = !currentlyVisible`. If `nextVisible === (settings.dockDefaultVisible !== false)`, delete `dockSiteVisibility[origin]` (returns site to following global default); otherwise set `dockSiteVisibility[origin] = nextVisible ? 'shown' : 'hidden'`. *(Author call: keeps per-site overrides clean so toggling back restores global-default inheritance.)*
  - `shouldMountToolbar(layout, scriptsMap, url, settings)`: returns `false` if `!isDockVisibleOnOrigin(settings, url)`, otherwise `getVisibleLayoutForUrl(layout, scriptsMap, url).length > 0`.
- **Matching helper for Manager dimming (#13):**
  - `doesLayoutNodeMatchUrl(node, scriptsMap, url)`:
    - `node.type === 'script'`: `Boolean(scriptsMap[node.scriptId] && matchesUrl(scriptsMap[node.scriptId].match, url))`.
    - `node.type === 'folder'`: `Array.isArray(node.items) && node.items.some((item) => Boolean(scriptsMap[item.scriptId] && matchesUrl(scriptsMap[item.scriptId].match, url)))` (so empty folders and folders where every contained script fails to match return `false`).

#### 4.3 Strict CSP Bookmarklet Execution (`lib/BookmarkletToolbarAdapters.js`) — #11

- **3-tier fallback chain in `executeScriptInPage(code, options = {})`** (where `options` accepts `{ doc, win, gmAddElement, onError }`):
  1. **Tier 1 — Inline `<script>` (primary, zero extra `@grant`):** Same Trusted Types `createScript` + `scriptEl.textContent = scriptPayload; mountContainer.appendChild(scriptEl)` path as today.
  2. **Tier 2 — `blob:` URL `<script src="blob:...">` (automatic fallback on inline `script-src` CSP block):**
     - Triggered when Tier 1 hits a `script-src` / `script-src-elem` CSP violation (`securitypolicyviolation` with `blockedURI === 'inline'` or `''`, synchronously in mock DOM or asynchronously in real browsers within the CSP listener window) or synchronous throw from inline assignment/append.
     - Creates `new Blob([normalizedCode], { type: 'text/javascript' })` + `URL.createObjectURL(blob)` (wrapped via `trustedTypesPolicy.createScriptURL(blobUrl)` when `trustedTypes` is enforced; extend `userjs-bt-toolbar` policy with `createScriptURL: (u) => u`).
     - Appends `<script>` with `src = scriptUrl`, revokes `blobUrl` and detaches `<script>` on `load` or `error`.
     - If `load` fires without CSP/runtime error, execution succeeded — stop (do NOT invoke Tier 3).
  3. **Tier 3 — `gmAddElement` (strictly last resort):**
     - Invoked **only** if Tier 2 (`blob:`) is unavailable (e.g., no `Blob`/`URL.createObjectURL`) or fails via `error` / `script-src` CSP violation (e.g., `script-src 'self'` without `blob:` on GitHub).
     - Calls `gmAddElement(mountContainer, 'script', { textContent: normalizedCode })` if provided.
     - If `gmAddElement` is absent or throws/fails, calls `onError(message)` once with a clear CSP failure message (never silently swallowed).
- **Runtime errors vs CSP errors:** A JavaScript runtime `error` thrown by the bookmarklet itself after inline execution starts is reported via `onError` and must **not** trigger Tier 2/Tier 3 re-execution (prevents running a bookmarklet twice).
- **Return shape compatibility:** Keep synchronous `{ ok, error }` return for direct callers/existing unit tests, while handling asynchronous browser CSP fallback transitions cleanly via `onError`.

---

### Wave 2: UI, Styling, Mobile Fixes, Settings Modal & Command Palette (`lib/BookmarkletToolbarUI.js`)

#### 4.4 CSP-Safe Shadow DOM Styling (#10)

- Create a `mountShadowStyles(shadowRoot, cssText, gmAddElement)` helper:
  1. **Primary:** If `CSSStyleSheet` constructor and `shadowRoot.adoptedStyleSheets` are supported (Chrome 73+, Firefox 101+, Safari 16.4+), create `new CSSStyleSheet()`, call `sheet.replaceSync(cssText)`, and assign `shadowRoot.adoptedStyleSheets = [sheet]` (zero `<style>` elements, zero `style-src` CSP violations, zero extra `@grant`).
  2. **Fallback 1 (non-constructable environments such as Node mock DOM):** Inject `<style>` element as today.
  3. **Fallback 2 (strictly last resort):** If `<style>` injection throws or triggers a `style-src` violation when `adoptedStyleSheets` is unavailable and `gmAddElement` was provided, call `gmAddElement(shadowRoot, 'style', { textContent: cssText })`.
- **Host positioning without `cssText` / `setAttribute('style')`:**
  - Move static snap-zone rules for `#userjs-bt-toolbar-host` into `:host` rules inside the adopted stylesheet (`:host([data-snap-zone="bottom-center"])`, etc. for all 6 snap zones, with `position: fixed; z-index: 2147483640; max-width: calc(100vw - 24px);` on `:host`).
  - Set `hostEl.setAttribute('data-snap-zone', zone)` (and `hostEl.dataset.snapZone = zone`).
  - For live drag offsets only, set individual CSSOM properties (`hostEl.style.transform = ...`, cleared via `hostEl.style.transform = ''` on drop/cancel) — never `hostEl.style.cssText = ...` or `setAttribute('style', ...)`.
  - Keep `hostEl.style` mirrored safely for mock DOM unit tests where `CSSStyleSheet` is absent (setting individual CSSOM properties rather than `cssText` also passes `style-src 'self'`).

#### 4.5 Dock & Mobile Layout / Touch Fixes (#1, #2, #7, #8, #9)

- **#1 Input keystroke isolation:** On `overlayHost` (or `overlayShadow` root), add bubble-phase `keydown`, `keyup`, and `keypress` listeners that call `e.stopPropagation()` whenever the event originates from an editable element (`INPUT`, `TEXTAREA`, `SELECT`, or `contentEditable`) inside the Shadow DOM. This runs *after* `overlayShadow`'s own `handleKeydown` / Palette input handlers so `Escape`, `ArrowUp`/`ArrowDown`, `Enter`, and hotkey recording keep working while host-page global shortcuts never receive typed keys.
- **#2 Dock outer button corner/padding polish:** In horizontal dock mode (`.bt-toolbar-dock:not(.bt-dock-vertical)` and `.bt-dock-items-bar`), give `.bt-btn-dark` pill-matched corner radius (`border-radius: 9999px` or `12px`) and give `.bt-dock-items-bar` / horizontal dock outer edge comfortable breathing room (`padding: 4px 6px` on `.bt-dock-items-bar`; keep `[⚡]` handle padding symmetric so `0px` anchor shift is preserved).
- **#7 Fix horizontal `*-center` dock overflow/bleeding on mobile:**
  - Replace `.bt-dock-items-bar`'s shrink-to-fit `position: absolute; left: 50%; translate: -50% 0; width: max-content;` inside the narrow `36px` `.bt-dock-center` parent with viewport-anchored positioning: `position: fixed; left: 50%; translate: -50% 0; width: max-content; max-width: calc(100vw - 24px);` with vertical placement anchored relative to the viewport edge (`top: calc(12px + 38px + 6px)` for `top-center`, `bottom: calc(12px + 38px + 6px)` for `bottom-center` — or measured from `anchorPill.getBoundingClientRect()`).
  - In `getViewportSize()`, compute effective `vw` and `vh` using the minimum of `win.innerWidth`, `doc.documentElement.clientWidth`, and `win.visualViewport?.width` (when valid `> 0`) so non-viewport-meta pages on Firefox Mobile calculate the real visible budget and trigger `More »` cleanly before any pill reaches the viewport edge.
  - Ensure the transparent hover bridge spans the `6px` gap between `.bt-dock-anchor-pill` and `.bt-dock-items-bar` under `position: fixed`.
- **#8 Fix sub-modals clipped offscreen at bottom on mobile:**
  - Top-align `.bt-backdrop-sub` (`align-items: flex-start; padding-top: 16px; overflow-y: auto;`, matching `#manager-backdrop`, with `12px` on `<= 600px`).
  - Make `.bt-form-body` scrollable (`overflow-y: auto; min-height: 0; flex: 1 1 auto;`) inside flex-column `.bt-modal` so `Add Local Script`, `Export`, `Import`, `Confirm`, and the new `⚙ Settings` modal never clip offscreen on mobile.
- **#9 Fix mobile touch double-toggle on `[⚡]`:**
  - In `attachDockHandleDrag`, remove the `toggleDockPinnedExpanded()` call from `onPointerUp`.
  - When `wasDragging === false`, let the browser's native `click` event be the sole toggle path (`suppressNextHandleClick` stays `false`).
  - When `wasDragging === true`, set `suppressNextHandleClick = true` and clear it after a `400ms` timer (covering Firefox Mobile's delayed compatibility `click` synthesis).

#### 4.6 Hover Ergonomics & Global Folder Settings (#15, #16, #17)

- **#17 Hover-expand collapse grace delay & expanded hit buffer:**
  - Add a `400ms` (`HOVER_COLLAPSE_DELAY_MS = 400`) timeout on `mouseleave` before setting `state.dockHoverExpanded = false` and collapsing the dock.
  - Cancel the collapse timer immediately on `mouseenter` of `toolbarContainer`, `.bt-dock-items-bar`, or any open `.bt-dropdown` menu.
  - Add a transparent `12px` invisible hover buffer (`::before` or wrapper padding/inset) around the **expanded** dock only (`:not(.bt-toolbar-dock-collapsed)`), and **never** when collapsed so collapsed `[⚡]` does not block clicks on underlying host-page links.
- **#15 Global `keepFolderOpenAfterRun` (folders + `More »`):**
  - In `triggerRunScript(scriptId)`, only call `closeToolbarDropdown()` when `!state.settings?.keepFolderOpenAfterRun`.
  - Always close Command Palette (`state.paletteOpen = false`) when running a script from the palette regardless of `keepFolderOpenAfterRun`.
  - Clicking outside the toolbar (`handleDocumentClick`) or pressing `Escape` still closes the open folder / `More »` dropdown as usual.
- **#16 Global `folderHoverOpen` (folders + `More »`):**
  - When `state.settings?.folderHoverOpen === true` (and not within `400ms` of a touch pointer event):
    - Hovering over a toolbar folder button or `More »` starts a `120ms` (`FOLDER_HOVER_INTENT_MS = 120`) intent timer that sets `state.openDropdownId` to that folder's id (or `'__overflow__'`) and re-renders.
    - Moving the pointer out of the button cancels any pending open timer; leaving both the trigger and its open dropdown starts a short close grace timer (`250ms`, synced with dock hover grace so sliding diagonally into the dropdown doesn't close it).
  - Click/tap toggle on folder buttons and `More »` **always remains active** even when `folderHoverOpen === true`, so touchscreens and deliberate clicks work normally.

#### 4.7 Independent Manager & `⚙ Settings` Modal + Portrait Fix + Dimming (#12, #13, #14, #18)

- **Standalone `⚙ Settings` modal (`#settings-backdrop`, `openSettings()`):**
  - Independent top-aligned `.bt-backdrop.bt-backdrop-sub` modal (`max-width: min(480px, calc(100vw - 24px))`) that can be opened directly from the Command Palette, Violentmonkey menu, or Manager header without requiring Manager to be open behind it.
  - Exposed on the UI instance API: `openSettings()`.
  - Escape / backdrop click closes Settings cleanly (returning to Manager if Manager was open underneath).
  - **Contents of `⚙ Settings` modal:**
    1. **Command Palette Shortcut:** Interactive hotkey recorder button (`Shortcut: Alt+B` / `Press shortcut…`).
    2. **Dock Behavior:**
       - `Dock expand`: segmented `Hover + Click` | `Click` | `Hover`
       - `Orientation`: segmented `Auto` | `Horiz` | `Vert`
       - `Default visibility`: segmented `Shown` | `Hidden` (`dockDefaultVisible`)
       - `This site (<origin>)`: toggle button (`Hide dock on this site` / `Show dock on this site`, plus subtle hint if overriding global default; disabled on non-HTTP(S) origins)
    3. **Toolbar Folders & `More »`:**
       - Checkbox/toggle: `Open folders & More » on hover` (`folderHoverOpen`)
       - Checkbox/toggle: `Keep folder & More » open after running a script` (`keepFolderOpenAfterRun`)
    4. **Backup & Restore** *(Author call: moved out of Manager header to declutter mobile portrait)*:
       - `Export` button (opens `#export-backdrop`) and `Import` button (opens `#import-backdrop`).
- **Streamlined Manager Modal (`#manager-backdrop`) — #14:**
  - Title becomes `Bookmarklet Toolbar — Manager`.
  - Header drops the multi-row settings controls and keeps only: title/subtitle, `+ New Local Script`, `⚙ Settings`, and `×`.
  - **Portrait/short-viewport sticky fix (#14):** Disable `position: sticky` on `.bt-sticky-section` below `@media (max-width: 600px), (max-height: 760px)` (setting `position: static;`) so `.bt-manager-body` scrolls as one smooth container and an open `.bt-folder-drawer` never squishes the Library down to a single card. Desktop tall viewports keep the sticky `Toolbar Layout` header.
- **Manager Dimming for Non-Matching Scripts & Folders (#13):**
  - In `renderManagerView()`:
    - On each `Toolbar Layout` script pill: if `!Core.doesLayoutNodeMatchUrl(node, scriptsMap, state.url)`, add `.bt-pill-dimmed` (reduced opacity e.g. `0.45`, restored to `1` on `:hover`/`:focus-within` so dragging/relabeling stays clear).
    - On each `Toolbar Layout` folder pill: if `!Core.doesLayoutNodeMatchUrl(node, scriptsMap, state.url)` (i.e. empty or all contained scripts don't match `state.url`), add `.bt-pill-dimmed`.
    - On each `Folder Drawer` chip: if `!Core.matchesUrl(script.match, state.url)`, add `.bt-pill-dimmed`.
    - Library keeps its existing `"Matching current site"` checkbox behavior unchanged.
- **Pack badge consistency (#5):**
  - Mirror the Command Palette pack-name badge on Library cards too *(Author call)*: show `packMeta?.name || s.packId` (or `Pack: <name>`) instead of collapsing to generic `'Pack'` when `packCount === 1`.

#### 4.8 Command Palette Improvements & Drill-Down Settings (#3, #4, #5, #18)

- **Footer buttons (#18):** Replace single `⚙ Settings / Manager` footer button with two side-by-side buttons:
  - `Manager` (carries the `#palette-removed-dot` amber badge when placed pack scripts were removed) → `openManager()`
  - `⚙ Settings` → `openSettings()`
- **Search matching (#3):** Include `'command action'` and group/badge text in command query matching so typing `"command"` or `"action"` surfaces `Actions` rows.
- **Description line (#4):** For script rows, render `descLine` **only** when `s.description` is non-empty; remove the `|| s.match.join(', ')` fallback.
- **Pack name badge (#5):** For pack scripts, show `packMeta?.name || s.packId` (e.g., `MusicBrainz Pack` or `Pack: <name>`) even when only 1 pack is installed.
- **Expanded Command Palette actions & drill-down sub-views (#18):**
  - **Root Actions (shown when query is empty or matches):**
    - `Open Manager` (`open-manager`)
    - `Open Settings` (`open-settings`)
    - `New Local Script` (`new-local-script`) — opens Editor modal directly
    - `Export Configuration` (`open-export`) — opens Export modal directly
    - `Import Configuration` (`open-import`) — opens Import modal directly
    - `Change Command Palette Shortcut` (`record-hotkey`) — opens Settings modal and enters hotkey-recording mode
    - `Hide/Show Dock on Current Site` (`toggle-dock-site`, when HTTP(S) origin exists)
    - `Default Dock Visibility` (badge: `Shown` / `Hidden` — toggles directly or drills in)
    - `Open Folders & More on Hover` (badge: `On` / `Off` — toggles directly)
    - `Keep Folder & More Open After Run` (badge: `On` / `Off` — toggles directly)
    - **Multi-state drill-down rows** (compact 1 row each in root view, showing current value as badge):
      - `Dock Orientation` (badge: `Auto` / `Horizontal` / `Vertical`) → Enter/click switches palette into `paletteSubView = 'dock-orientation'`
      - `Dock Expand Mode` (badge: `Hover + Click` / `Click` / `Hover`) → Enter/click switches to `paletteSubView = 'dock-expand'`
      - `Dock Position` (badge: e.g. `Bottom-Center`) → Enter/click switches to `paletteSubView = 'dock-position'`
  - **Drill-down sub-view behavior:**
    - Entering a sub-view clears the search box, updates placeholder (e.g., `"Select Dock Orientation…"`), displays a `← Back` row/control plus the setting's options (marking the active choice with an `Active` badge).
    - Picking an option applies & persists the setting immediately, shows a toast, and returns to the root palette (or closes cleanly — *Author call: closes on selection matching single-command execution, while `Esc` / `← Back` returns to root palette without closing the whole overlay!*).
    - Pressing `Esc` while in a sub-view steps back to the root palette (preserving the overlay open); pressing `Esc` in the root palette closes the Command Palette.
  - **Direct-search shortcuts:**
    - Whenever the root search query is **non-empty**, sub-options are also searchable as flat command matches (e.g., typing `"vert"` matches `Dock Orientation: Vertical`, `"bottom-right"` matches `Dock Position: Bottom-Right`, `"hover"` matches `Dock Expand Mode: Hover` and `Open Folders & More on Hover`) for immediate one-step `Enter` execution.

---

### Wave 3: Verification Strategy & Unmocked CSP Testing

1. **Unit tests (`node --test`):**
   - `tests/test_bookmarklet_toolbar_core.js`: `dockDefaultVisible`, `dockSiteVisibility`, `dockSiteHidden` migration, `isDockVisibleOnOrigin`, `toggleDockSiteVisibility`, `shouldMountToolbar`, `folderHoverOpen`, `keepFolderOpenAfterRun`, `doesLayoutNodeMatchUrl`.
   - `tests/test_bookmarklet_toolbar_adapters.js`: Tier 1 inline success, Tier 1 CSP block → Tier 2 `blob:` success (and `createScriptURL` + `revokeObjectURL`), Tier 2 CSP block → Tier 3 `gmAddElement` last-resort, Tier 2 CSP block without `gmAddElement` → `onError` surfaced, runtime JS error does NOT retry Tier 2/3.
   - `tests/test_bookmarklet_toolbar_ui.js`: `adoptedStyleSheets` & `:host([data-snap-zone])`, input keystroke isolation, Command Palette (`"command"`/`"action"`, no `@match` description fallback, pack name badge, footer buttons, drill-down sub-views, direct-search shortcuts), standalone `⚙ Settings` modal, Manager header/dimming, touch single-tap open & close without double-toggle, `keepFolderOpenAfterRun`, `folderHoverOpen` + `More »`, hover collapse grace timer.
   - `tests/test_site_bookmarklet_toolbar_entry.js`: `@noframes` header + runtime `win.self !== win.top` guard, `@grant GM.addElement` forwarding, updated `GM.registerMenuCommand` entries (`Open Bookmarklet Settings`, symmetric `Toggle Dock on This Site`).
2. **Unmocked Headless Chrome E2E (`tests/test_bookmarklet_toolbar_chrome_e2e.mjs`):**
   - `/csp-style-strict` (`style-src 'self'`): asserts `adoptedStyleSheets` styles dock & overlays with **zero** `style-src` CSP console violations.
   - `/csp-script-blob` (`script-src 'self' 'unsafe-eval' blob:` — Spotify-like): asserts bookmarklet executes via `blob:` fallback **without** `GM.addElement`.
   - `/csp-script-strict` (`script-src 'self'` — no `'unsafe-inline'`, no `blob:`, **no mocked `GM.addElement`**): asserts the bookmarklet does not silently fail and surfaces a real CSP error via toast / `onError`.
   - `/iframe-host`: page with same-origin `<iframe>` matching the script URL; asserts dock mounts only in top frame (count = 1, zero mounts inside iframe).
   - `/mobile-no-viewport` (`412×924` portrait without `<meta name="viewport">`): asserts `top-center` dock triggers `More »` without horizontal bleeding past viewport, sub-modals (`Add Local Script`, `⚙ Settings`) sit top-aligned within viewport with scrollable form bodies, tapping `[⚡]` opens and closes reliably on single taps, and portrait Manager scrolls cleanly without squishing Library.
3. **Distribution sync:** Run `python tools/build_dist.py` and `pytest tests/test_build_dist_sync.py`.

---

## 5. Author Calls (Made for Builder Clarity)

- **Export / Import placement:** Moved into the standalone `⚙ Settings` modal (also directly runnable from Command Palette) to keep the Manager header compact on portrait mobile (`+ New Local Script`, `⚙ Settings`, `×`).
- **Violentmonkey menu:** Added `'Open Bookmarklet Settings'` alongside `'Open Command Palette'`, `'Open Bookmarklet Manager'`, and `'Toggle Dock on This Site'`.
- **Per-site visibility toggle normalization:** Toggling a site back to match `dockDefaultVisible` deletes its entry in `dockSiteVisibility` so it resumes inheriting future changes to the global default.
- **Pack badge consistency:** Library cards mirror the Command Palette's pack-name badge even when only 1 pack is installed.
- **Drill-down selection behavior:** Picking a choice inside a Command Palette sub-view applies it immediately, shows a toast, and closes the Command Palette (matching other one-shot commands), while `Esc` / `← Back` returns to the root palette.

## 6. Left to Implementation / Builder

- Exact CSS visual polish tokens (dimmed pill opacity, pill border-radius values `9999px` vs `12px`, `:host` selector block structure, Settings modal spacing).
- Exact hover timer constants within the specified ranges (`400ms` dock collapse grace, `120ms` folder hover-intent, `250ms` dropdown leave grace, `400ms` post-drag click suppression).
- Exact DOM structure and keyboard focus management inside the `⚙ Settings` modal and Command Palette sub-view `← Back` row.
