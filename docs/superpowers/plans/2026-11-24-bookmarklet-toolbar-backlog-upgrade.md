# Site Bookmarklet Toolbar — Unified Backlog Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver all 18 backlog improvements for `Site Bookmarklet Toolbar` in one cohesive 3-wave upgrade: strict CSP styling & bookmarklet execution, mobile layout/touch fixes, `@noframes`, global/per-origin dock visibility, Manager dimming & portrait ergonomics, independent `⚙ Settings` modal, global folder hover/keep-open & hover grace delay, and Command Palette drill-down settings.

**Architecture:** Wave 1 updates pure settings/matching logic in `lib/BookmarkletToolbarCore.js`, the 3-tier CSP execution chain in `lib/BookmarkletToolbarAdapters.js`, and `@noframes`/`@grant GM.addElement`/menu wiring in `src/Site Bookmarklet Toolbar.user.js`. Wave 2 updates `lib/BookmarkletToolbarUI.js` in four focused passes (CSP styling + mobile/touch fixes → input isolation + hover/folder ergonomics → standalone Settings modal + Manager dimming/portrait fix → Command Palette fixes + drill-down sub-views). Wave 3 adds unmocked Headless Chrome CSP/iframe/mobile E2E checks, rebuilds `dist/Site Bookmarklet Toolbar.user.js`, and verifies all suites pass.

**Tech Stack:** Vanilla ES2022 JavaScript (IIFE modules, Shadow DOM, Constructable Stylesheets `CSSStyleSheet`/`adoptedStyleSheets`, Trusted Types), Node.js `node:test`, Headless Chrome CDP E2E (`tests/test_bookmarklet_toolbar_chrome_e2e.mjs`), Python (`tools/build_dist.py`, `pytest`).

**Spec:** [docs/superpowers/specs/2026-11-24-bookmarklet-toolbar-backlog-upgrade-design.md](../specs/2026-11-24-bookmarklet-toolbar-backlog-upgrade-design.md)

## Global Constraints

- Edit only `src/*.user.js`, `lib/*.js`, and `tests/*`; never edit `dist/` directly (regenerate via `python tools/build_dist.py`).
- Zero `innerHTML` / `outerHTML` anywhere; use Trusted Types-safe DOM (`createElement`, `createElementNS`, `textContent`) and extend `userjs-bt-toolbar` Trusted Types policy with `createScriptURL`.
- Primary Shadow DOM CSS uses `CSSStyleSheet` + `adoptedStyleSheets`; avoid `<style>` tags in Shadow DOM when constructable stylesheets exist and never call `setAttribute('style', ...)` or `style.cssText = ...` on `toolbarHost` or `overlayHost`.
- `GM.addElement` is strictly a last-resort fallback after standard DOM methods fail; library files (`lib/*.js`) receive optional `gmAddElement` via options and never read global `GM` directly.
- Real browser CSP E2E tests must NEVER mock `GM.addElement` to hide strict-CSP errors.
- Preserve `0px` `[⚡]` anchor shift on expand/collapse across all 6 snap zones and preserve backward compatibility with persisted `dockSiteHidden` settings.
- Commit directly on `dev` using atomic conventional commits (`feat|fix|test|chore|docs(bookmarklet-toolbar): ...`).

## Review Focus

1. **Bookmarklet runtime JS error must not retry CSP fallback:** If a bookmarklet runs via Tier 1 inline `<script>` and throws a JS runtime exception, `executeScriptInPage` must report the error once and MUST NOT re-execute it via Tier 2 (`blob:`) or Tier 3 (`gmAddElement`) (pinned in Task 2).
2. **Legacy `dockSiteHidden` migration + default visibility flip:** Loading persisted `{ dockSiteHidden: { 'https://a.test': true } }` must migrate to `dockSiteVisibility['https://a.test'] = 'hidden'`, and toggling `'https://a.test'` visible when `dockDefaultVisible: true` must delete the override so flipping `dockDefaultVisible` to `false` later hides it (pinned in Task 1).
3. **Non-HTTP(S) origins (`file://`, `about:blank`, empty URL):** `toggleDockSiteVisibility` must be a safe no-op, Settings must disable the per-site dock button, and Command Palette must omit `toggle-dock-site` without throwing (pinned in Tasks 1, 6, 7).
4. **Modal & sub-view `Escape` layering:** Pressing `Escape` inside a Command Palette drill-down sub-view must return to the root palette (keeping the overlay open); pressing `Escape` in `Settings` opened from Manager must close Settings while leaving Manager open; pressing `Escape` in `Settings` opened directly from Command Palette must close Settings with no orphaned modal behind it (pinned in Tasks 6, 7).
5. **Input keystroke isolation vs Shadow DOM shortcuts:** Typing printable keys (`'j'`, `'/'`, `' '`) inside Search/Editor/Import inputs must not bubble to host `document`/`window` listeners, while `Escape`, Palette `ArrowUp`/`ArrowDown`/`Enter`, and Hotkey Recorder combos continue to work inside `overlayHost` (pinned in Tasks 5, 7).

---

### Task 1: Core Settings Schema, Visibility Migration & Layout Matching Helper

**Files:**
- Modify: `lib/BookmarkletToolbarCore.js:557-610, 1370-1404`
- Test: `tests/test_bookmarklet_toolbar_core.js`

**Interfaces:**
- Consumes: `getSiteOrigin(url)`, `normalizeOriginMap(raw, validator)`, `scriptMatchesUrl(script, url)`, `getVisibleLayoutForUrl(layout, scriptsMap, url)` (existing in `BookmarkletToolbarCore.js`).
- Produces (exported on `BookmarkletToolbarCore`):
  - `normalizeSettings(raw)` returning normalized settings including `dockDefaultVisible: boolean` (default `true`), `dockSiteVisibility: { [origin]: 'shown' | 'hidden' }` (migrating legacy `dockSiteHidden[origin] === true` → `'hidden'`, omitting `dockSiteHidden` from normalized output), `folderHoverOpen: boolean` (default `false`), `keepFolderOpenAfterRun: boolean` (default `false`).
  - `isDockVisibleOnOrigin(settings, urlOrOrigin) -> boolean`
  - `toggleDockSiteVisibility(settings, origin) -> NormalizedSettings`
  - `shouldMountToolbar(layout, scriptsMap, url, settings) -> boolean` (delegating visibility check to `isDockVisibleOnOrigin`)
  - `doesLayoutNodeMatchUrl(node, scriptsMap, url) -> boolean`

- [ ] **Step 1: Write failing unit tests in `tests/test_bookmarklet_toolbar_core.js`**

Add test cases covering:
- `normalizeSettings` defaults (`dockDefaultVisible: true`, `dockSiteVisibility: {}`, `folderHoverOpen: false`, `keepFolderOpenAfterRun: false`) and legacy migration of `dockSiteHidden: { 'https://a.test': true, 'https://b.test': false }` → `dockSiteVisibility: { 'https://a.test': 'hidden' }` without overwriting explicit `dockSiteVisibility` entries.
- `isDockVisibleOnOrigin` and `shouldMountToolbar` across `dockDefaultVisible: true | false` with `'shown'`, `'hidden'`, and unset origin overrides.
- `toggleDockSiteVisibility`: toggling `'https://a.test'` hidden then back to shown deletes `'https://a.test'` from `dockSiteVisibility` (so flipping `dockDefaultVisible` to `false` hides it); toggling with empty/non-HTTP(S) origin returns unchanged normalized settings (Review Focus #2, #3).
- `doesLayoutNodeMatchUrl`: returns `true` for matching script node, `false` for non-matching/missing script node, `true` for folder containing at least one matching script, `false` for empty folder or folder whose scripts all fail to match.

- [ ] **Step 2: Run Core unit tests to verify they fail**

Run: `node --test tests/test_bookmarklet_toolbar_core.js`
Expected: FAIL (missing `isDockVisibleOnOrigin`, `toggleDockSiteVisibility`, `doesLayoutNodeMatchUrl`, and new settings fields).

- [ ] **Step 3: Implement settings normalization, visibility helpers, and `doesLayoutNodeMatchUrl` in `lib/BookmarkletToolbarCore.js`**

- Extend `normalizeSettings(raw)`:
  - Normalize `dockDefaultVisible` (`typeof source.dockDefaultVisible === 'boolean' ? source.dockDefaultVisible : true`).
  - Normalize `dockSiteVisibility` via `normalizeOriginMap(source.dockSiteVisibility, (v) => v === 'shown' || v === 'hidden')`.
  - Migrate any `source.dockSiteHidden[origin] === true` into `dockSiteVisibility[origin] = 'hidden'` when `dockSiteVisibility[origin]` is absent; remove `dockSiteHidden` from the returned object (`delete out.dockSiteHidden`).
  - Normalize `folderHoverOpen: source.folderHoverOpen === true` and `keepFolderOpenAfterRun: source.keepFolderOpenAfterRun === true`.
- Implement `isDockVisibleOnOrigin(settings, urlOrOrigin)`: resolve origin via `getSiteOrigin(urlOrOrigin)` (falling back to normalized origin string if already an origin), check `settings?.dockSiteVisibility?.[origin]`, else check legacy `settings?.dockSiteHidden?.[origin] === true`, else `settings?.dockDefaultVisible !== false`.
- Implement `toggleDockSiteVisibility(settings, origin)`: normalize `origin` via `getSiteOrigin(origin)`; if empty return `normalizeSettings(settings)`. Compute `nextVisible = !isDockVisibleOnOrigin(settings, origin)` and `defaultVisible = settings?.dockDefaultVisible !== false`. Clone `dockSiteVisibility`; if `nextVisible === defaultVisible`, `delete nextMap[origin]`, else `nextMap[origin] = nextVisible ? 'shown' : 'hidden'`. Return `normalizeSettings({ ...settings, dockSiteVisibility: nextMap })`.
- Update `shouldMountToolbar(layout, scriptsMap, url, settings)` to return `false` when `!isDockVisibleOnOrigin(settings, url)`.
- Implement `doesLayoutNodeMatchUrl(node, scriptsMap, url)` using `scriptMatchesUrl(scriptsMap[sid], url)`.
- Export `isDockVisibleOnOrigin`, `toggleDockSiteVisibility`, and `doesLayoutNodeMatchUrl` on `BookmarkletToolbarCore`.

- [ ] **Step 4: Run Core unit tests to verify they pass**

Run: `node --test tests/test_bookmarklet_toolbar_core.js`
Expected: PASS (0 failures).

- [ ] **Step 5: Commit**

```bash
git add lib/BookmarkletToolbarCore.js tests/test_bookmarklet_toolbar_core.js
git commit -m "feat(bookmarklet-toolbar): add default dock visibility, folder settings, and node matching helpers"
```

---

### Task 2: Adapters 3-Tier Strict CSP Bookmarklet Execution Fallback Chain

**Files:**
- Modify: `lib/BookmarkletToolbarAdapters.js:155-282`
- Test: `tests/test_bookmarklet_toolbar_adapters.js`

**Interfaces:**
- Consumes: `normalizeBookmarkletCode`, Trusted Types `userjs-bt-toolbar` policy, optional `options.gmAddElement(parentNode, tagName, attrs)`.
- Produces: `Adapters.executeScriptInPage(code, { doc, win, gmAddElement, onError }) -> { ok: boolean, error: string | null }` with 3-tier fallback:
  1. Tier 1: inline `<script>` (`textContent`, Trusted Types `createScript`).
  2. Tier 2 (only on inline `script-src` CSP block or inline append/assign throw): `blob:` URL `<script src="blob:...">` (`new Blob([code], { type: 'text/javascript' })`, `URL.createObjectURL`, Trusted Types `createScriptURL`, revoked & detached on `load`/`error`).
  3. Tier 3 (strictly last resort, only if Tier 2 is unavailable or fails via `error`/`script-src` CSP): `gmAddElement(mountContainer, 'script', { textContent: normalizedCode })`.

- [ ] **Step 1: Write failing unit tests in `tests/test_bookmarklet_toolbar_adapters.js`**

Add test cases covering:
- Tier 1 inline succeeds → does NOT call `URL.createObjectURL` or `gmAddElement`.
- Tier 1 blocked by `script-src` `securitypolicyviolation` (`blockedURI: 'inline'`, both synchronous and asynchronous) → falls back to Tier 2 `blob:` `<script src="blob:...">` (uses `trustedTypes.createPolicy('userjs-bt-toolbar', { createScript, createScriptURL })` when `trustedTypes` exists), revokes `blob:` URL on `load`, does NOT call `gmAddElement`, does NOT call `onError`.
- Tier 1 blocked AND Tier 2 `blob:` blocked (`error` or `script-src` CSP violation) with `gmAddElement` provided → revokes `blob:` URL and calls `gmAddElement(mountContainer, 'script', { textContent: normalizedCode })` once.
- Tier 1 blocked AND Tier 2 `blob:` blocked WITHOUT `gmAddElement` → calls `onError` once with a clear CSP violation message (does not silently swallow).
- Tier 1 executes inline and triggers a JS runtime `window` `'error'` event (NOT CSP) → calls `onError` once and does NOT fall back to Tier 2 `blob:` or Tier 3 `gmAddElement` (Review Focus #1).

- [ ] **Step 2: Run Adapter unit tests to verify they fail**

Run: `node --test tests/test_bookmarklet_toolbar_adapters.js`
Expected: FAIL (missing Tier 2 `blob:` fallback and Tier 3 `gmAddElement` last-resort behavior).

- [ ] **Step 3: Implement the 3-tier CSP fallback chain in `lib/BookmarkletToolbarAdapters.js`**

- Extend `trustedTypesPolicy` creation (`'userjs-bt-toolbar'`) to provide both `createScript: (s) => s` and `createScriptURL: (u) => u`.
- Refactor `executeScriptInPage(code, options = {})` to distinguish `isScriptCspViolation(event)` (effective/violated directive starts with `'script-src'`) from runtime `window` `error` events:
  - Runtime error sets `runtimeFailed = true`, calls `reportErrorOnce`, and blocks Tier 2/Tier 3 fallback.
  - Inline `script-src` CSP block (or synchronous inline assignment/append throw) invokes `tryBlobFallback(cspReason)`.
  - `tryBlobFallback` checks `Blob` and `URL.createObjectURL`/`revokeObjectURL` availability (on `resolvedWin` or global); if unavailable, delegates immediately to `tryGmFallback(cspReason)`. Otherwise creates `<script>`, sets `src` (via `createScriptURL` if available), listens for `load`, `error`, and `script-src` `securitypolicyviolation` (ignoring stale inline violations), revokes URL and detaches element on settle, and delegates to `tryGmFallback` only on `error`/CSP failure.
  - `tryGmFallback(cspReason)` calls `options.gmAddElement(mountContainer, 'script', { textContent: normalizedCode })` if `typeof options.gmAddElement === 'function'`; if absent or throws, calls `reportErrorOnce(cspReason)`.
- Preserve existing synchronous `{ ok, error }` return semantics when inline succeeds or fails synchronously without async fallback.

- [ ] **Step 4: Run Adapter unit tests to verify they pass**

Run: `node --test tests/test_bookmarklet_toolbar_adapters.js`
Expected: PASS (0 failures).

- [ ] **Step 5: Commit**

```bash
git add lib/BookmarkletToolbarAdapters.js tests/test_bookmarklet_toolbar_adapters.js
git commit -m "feat(bookmarklet-toolbar): add 3-tier CSP script execution fallback (inline -> blob -> GM.addElement)"
```

---

### Task 3: Entry Script `@noframes`, Top-Frame Guard, `@grant GM.addElement` & Menu Commands

**Files:**
- Modify: `src/Site Bookmarklet Toolbar.user.js:1-65, 223-346`
- Test: `tests/test_site_bookmarklet_toolbar_entry.js`

**Interfaces:**
- Consumes: `Core.toggleDockSiteVisibility(settings, origin)` (Task 1), `Adapters.executeScriptInPage(code, { doc, win, gmAddElement, onError })` (Task 2), `UI.createToolbarUI({ doc, win, gmAddElement, initialState, callbacks })` + `ui.openSettings()` (Tasks 4 & 6; graceful fallback if `openSettings` not yet called in older UI mocks).
- Produces: Userscript header with `// @noframes` and `// @grant GM.addElement`; runtime top-frame guard; `GM.registerMenuCommand` entries `'Open Command Palette'`, `'Open Bookmarklet Manager'`, `'Open Settings'`, and symmetric `'Toggle Dock on This Site'`.

- [ ] **Step 1: Write failing unit tests in `tests/test_site_bookmarklet_toolbar_entry.js`**

Add test cases covering:
- Userscript header metadata includes `// @noframes` and `// @grant       GM.addElement`.
- Runtime guard exits early without registering menu commands or mounting UI when `win.self !== win.top` (and when accessing `win.top` throws a cross-origin `SecurityError`).
- `GM.addElement` (when present) is forwarded as `gmAddElement` to both `UI.createToolbarUI` and `Adapters.executeScriptInPage` (and `null` when absent).
- Registers `'Open Settings'` menu command calling `ui.openSettings()`.
- `'Toggle Dock on This Site'` uses `Core.toggleDockSiteVisibility` so toggling works both when `dockDefaultVisible` is `true` and when `dockDefaultVisible` is `false`.

- [ ] **Step 2: Run Entry unit tests to verify they fail**

Run: `node --test tests/test_site_bookmarklet_toolbar_entry.js`
Expected: FAIL on missing `@noframes`, `@grant GM.addElement`, top-frame guard, `'Open Settings'`, and `dockSiteVisibility` toggle.

- [ ] **Step 3: Implement Entry script changes in `src/Site Bookmarklet Toolbar.user.js`**

- Add `// @noframes` and `// @grant       GM.addElement` in the userscript metadata header.
- Right after `if (!win || !doc) return;`, add the `try { if (win.top && win.self !== win.top) return; } catch { return; }` guard.
- Resolve `const gmAddElement = typeof GM !== 'undefined' && typeof GM.addElement === 'function' ? GM.addElement.bind(GM) : null;`.
- Pass `gmAddElement` into `UI.createToolbarUI({ doc, win, gmAddElement, ... })` and `Adapters.executeScriptInPage(script.code, { doc, win, gmAddElement, onError })`.
- Add `GM.registerMenuCommand('Open Settings', () => { ... ui.openSettings(); })` and update `'Toggle Dock on This Site'` to call `Core.toggleDockSiteVisibility(state.settings, origin)`.

- [ ] **Step 4: Run Entry unit tests to verify they pass**

Run: `node --test tests/test_site_bookmarklet_toolbar_entry.js`
Expected: PASS (0 failures).

- [ ] **Step 5: Commit**

```bash
git add "src/Site Bookmarklet Toolbar.user.js" tests/test_site_bookmarklet_toolbar_entry.js
git commit -m "feat(bookmarklet-toolbar): add @noframes guard, GM.addElement forwarding, and Open Settings menu"
```

---

### Task 4: UI CSP-Safe Shadow DOM Styling (`adoptedStyleSheets`) & Mobile Dock/Sub-Modal/Touch Fixes

**Files:**
- Modify: `lib/BookmarkletToolbarUI.js:101-155, 410-505, 1080-1145, 2425-2445, 2639-2792, 2829-2845, 3503-3526`
- Test: `tests/test_bookmarklet_toolbar_ui.js`

**Interfaces:**
- Consumes: `options.gmAddElement` passed to `UI.createToolbarUI(options)`.
- Produces:
  - `mountShadowStyles(shadowRoot, cssText, gmAddElement)` helper (primary: `new CSSStyleSheet()` + `replaceSync` + `adoptedStyleSheets`; fallback 1: `<style>` for non-constructable mock DOMs; fallback 2 last resort: `gmAddElement(shadowRoot, 'style', { textContent: cssText })`).
  - `:host` positioning rules for `#userjs-bt-toolbar-host` (`:host([data-snap-zone="..."])` for all 6 zones) and `#userjs-bt-overlay-host`, removing `style.cssText` / `setAttribute('style')` assignments.
  - Viewport-safe `*-center` `.bt-dock-items-bar` (`position: fixed`), `visualViewport`-aware `getViewportSize()`, top-aligned scrollable `.bt-backdrop-sub` / `.bt-form-body`, and click-only tap toggle on `[⚡]`.

- [ ] **Step 1: Write failing unit tests in `tests/test_bookmarklet_toolbar_ui.js`**

Add test cases covering:
- **#10 CSP styling:** When `win.CSSStyleSheet` and `shadowRoot.adoptedStyleSheets` are available, `toolbarShadow` and `overlayShadow` use `adoptedStyleSheets` with zero `<style>` elements appended; `applyDockPosition` sets `data-snap-zone` attribute and never writes `style.cssText` (live drag sets only individual `style.transform`, cleared on drop); when `CSSStyleSheet` is unavailable and `<style>` throws, falls back to `gmAddElement(shadowRoot, 'style', { textContent })`.
- **#2 Dock outer button polish:** Horizontal dock CSS gives `.bt-btn-dark` pill-matched border-radius and balanced horizontal capsule padding without changing `[⚡]` anchor geometry.
- **#7 Mobile `*-center` overflow:** `getViewportSize()` uses `Math.min` across positive `win.innerWidth`, `doc.documentElement.clientWidth`, and `win.visualViewport.width`; `.bt-dock-items-bar` CSS uses `position: fixed; left: 50%; translate: -50% 0; max-width: calc(100vw - 24px);` instead of `position: absolute` inside the `36px` `.bt-dock-center` wrapper.
- **#8 Mobile sub-modals:** `.bt-backdrop-sub` CSS sets `align-items: flex-start; padding-top: 16px; overflow-y: auto;` and `.bt-form-body` sets `overflow-y: auto; min-height: 0;`.
- **#9 Touch single-tap toggle:** Simulating `pointerdown` → `pointerup` (no drag) followed by delayed `click` (e.g. after `20ms`) toggles the dock **once** (expanded on tap 1, collapsed on tap 2); simulating drag (`> 6px`) suppresses the subsequent `click` within `400ms`.

- [ ] **Step 2: Run UI unit tests to verify they fail**

Run: `node --test tests/test_bookmarklet_toolbar_ui.js`
Expected: FAIL on the newly added #2, #7, #8, #9, #10 tests.

- [ ] **Step 3: Implement #10, #2, #7, #8, #9 in `lib/BookmarkletToolbarUI.js`**

- Add `mountShadowStyles(shadowRoot, cssText, gmAddElement)` and use it in `ensureToolbarHostCreated()` and `ensureOverlayMounted()`.
- Add `:host` positioning rules inside `buildStyles()` for `#userjs-bt-toolbar-host` (all 6 `:host([data-snap-zone="..."])` rules) and `#userjs-bt-overlay-host` (`:host(#userjs-bt-overlay-host)`). Update `applyDockPosition` and `ensureOverlayMounted` to set `data-snap-zone` and individual CSSOM properties only (zero `cssText` / `setAttribute('style')`).
- Polish horizontal `.bt-toolbar-dock:not(.bt-dock-vertical) .bt-btn-dark` and `.bt-dock-items-bar .bt-btn-dark` border-radius (`9999px`) and horizontal outer padding (`padding: 4px 6px` on `.bt-dock-items-bar`, symmetric on `.bt-dock-corner`).
- Update `.bt-dock-items-bar` to `position: fixed; left: 50%; translate: -50% 0; width: max-content; max-width: calc(100vw - 24px);` anchored cleanly below `top-center` (`top: 60px`) / above `bottom-center` (`bottom: 60px`) with the transparent hover bridge spanning the gap; update `getViewportSize()` to consider `win.visualViewport?.width` / `.height`.
- Update `.bt-backdrop-sub` to top-align (`align-items: flex-start; padding-top: 16px; overflow-y: auto;`, `12px` under `<= 600px`) and `.bt-form-body` to `overflow-y: auto; min-height: 0; flex: 1 1 auto;`.
- Update `attachDockHandleDrag` so `onPointerUp` only sets `suppressNextHandleClick = true` (with a `400ms` reset timer) when `wasDragging === true`, and does NOT call `toggleDockPinnedExpanded()` — leaving `click` as the sole tap toggle path.

- [ ] **Step 4: Run UI unit tests to verify they pass**

Run: `node --test tests/test_bookmarklet_toolbar_ui.js`
Expected: PASS (0 failures).

- [ ] **Step 5: Commit**

```bash
git add lib/BookmarkletToolbarUI.js tests/test_bookmarklet_toolbar_ui.js
git commit -m "fix(bookmarklet-toolbar): adopt CSP-safe Shadow DOM stylesheets and fix mobile dock, sub-modals, and touch toggle"
```

---

### Task 5: UI Input Keystroke Isolation, Hover Ergonomics & Global Folder Settings

**Files:**
- Modify: `lib/BookmarkletToolbarUI.js:410-560, 2400-2430, 2807-2880, 3030-3155, 4275-4285, 6074-6100`
- Test: `tests/test_bookmarklet_toolbar_ui.js`

**Interfaces:**
- Consumes: `state.settings.folderHoverOpen`, `state.settings.keepFolderOpenAfterRun` (Task 1).
- Produces: Bubble-phase editable-target keystroke isolation on `overlayHost`/`overlayShadow`, `HOVER_COLLAPSE_DELAY_MS = 400`, `FOLDER_HOVER_INTENT_MS = 120`, `FOLDER_CLOSE_GRACE_MS = 250`, expanded-only `12px` hover buffer CSS, and timer cleanup in `destroy()`.

- [ ] **Step 1: Write failing unit tests in `tests/test_bookmarklet_toolbar_ui.js`**

Add test cases covering:
- **#1 Input keystroke isolation (Review Focus #5):** Dispatching `keydown`, `keyup`, `keypress` (e.g. `'j'`, `'/'`, `' '`) from `#palette-search`, `#mgr-search`, and `#ed-code` calls `stopPropagation()` so a host `doc` listener never receives them, while `Escape` still closes the overlay and `recordingHotkey` still captures shortcuts.
- **#15 `keepFolderOpenAfterRun`:** When `keepFolderOpenAfterRun: true`, running a script inside a folder dropdown or inside `More »` keeps `state.openDropdownId` open (while running a script from Command Palette still closes the palette); when `false` (default), running closes the dropdown.
- **#16 `folderHoverOpen`:** When `folderHoverOpen: true`, hovering a folder button or `More »` opens its dropdown after `~120ms` (cancelled if `mouseleave` fires before `120ms`); click/tap still toggles open/closed; ignored within `400ms` of touch pointer events.
- **#17 Hover collapse grace & expanded hit buffer:** In `hover` / `both` mode, `mouseleave` does not collapse immediately — re-entering within `400ms` cancels collapse, while staying outside past `400ms` collapses; CSS includes expanded-only buffer (`:not(.bt-toolbar-dock-collapsed)::before` or equivalent) and never adds a buffer when `.bt-toolbar-dock-collapsed` is present.

- [ ] **Step 2: Run UI unit tests to verify they fail**

Run: `node --test tests/test_bookmarklet_toolbar_ui.js`
Expected: FAIL on #1, #15, #16, #17 tests.

- [ ] **Step 3: Implement #1, #15, #16, #17 in `lib/BookmarkletToolbarUI.js`**

- Add bubble-phase `keydown`, `keyup`, `keypress` listeners on `overlayShadow` (after `handleKeydown`) that call `e.stopPropagation()` when the target is editable (`INPUT`, `TEXTAREA`, `SELECT`, `isContentEditable`).
- In `triggerRunScript(scriptId)`, only call `closeToolbarDropdown()` when `!state.settings?.keepFolderOpenAfterRun`.
- Add `dockHoverCollapseTimer`, `folderHoverOpenTimer`, and `folderHoverCloseTimer` with helper cancel/schedule functions (cleared in `destroy()`):
  - `toolbarContainer` `mouseleave` schedules `400ms` collapse (cancelled on `mouseenter` of `toolbarContainer`, `.bt-dock-items-bar`, or `.bt-dropdown`).
  - Folder button and `More »` button attach `mouseenter` / `mouseleave` handlers when `state.settings?.folderHoverOpen` is true (`120ms` open intent, `250ms` leave grace cancelled when entering the open `.bt-dropdown`).
- Add expanded-only `12px` transparent hover buffer CSS (`::before` with `inset: -12px` and `z-index: -1` on expanded `.bt-toolbar-dock:not(.bt-toolbar-dock-collapsed)` / `.bt-dock-items-bar`, disabled when collapsed).

- [ ] **Step 4: Run UI unit tests to verify they pass**

Run: `node --test tests/test_bookmarklet_toolbar_ui.js`
Expected: PASS (0 failures).

- [ ] **Step 5: Commit**

```bash
git add lib/BookmarkletToolbarUI.js tests/test_bookmarklet_toolbar_ui.js
git commit -m "feat(bookmarklet-toolbar): isolate input keystrokes, add folder hover/keep-open, and hover collapse grace"
```

---

### Task 6: Standalone `⚙ Settings` Modal, Streamlined Manager, Portrait Fix, Dimming & Pack Badges

**Files:**
- Modify: `lib/BookmarkletToolbarUI.js:1320-1378, 1745-1785, 2586-2608, 3639-3840, 4280-4400, 4809-5640, 6009-6116`
- Test: `tests/test_bookmarklet_toolbar_ui.js`

**Interfaces:**
- Consumes: `Core.isDockVisibleOnOrigin`, `Core.toggleDockSiteVisibility`, `Core.doesLayoutNodeMatchUrl`, `Core.scriptMatchesUrl` (Task 1).
- Produces:
  - Standalone `#settings-backdrop` modal (`state.settingsOpen`, `openSettings()`, `closeSettings()`, `renderSettingsView()`), exposed as `ui.openSettings()`.
  - Streamlined Manager header (`Bookmarklet Toolbar — Manager`, `+ New Local Script`, `⚙ Settings`, `×`), portrait non-sticky `.bt-sticky-section`, `.bt-pill-dimmed` class for non-matching scripts and fully non-matching/empty folders in Toolbar Layout & Folder Drawer, and truncated `.bt-badge` with `title` showing pack name on Library cards.

- [ ] **Step 1: Write failing unit tests in `tests/test_bookmarklet_toolbar_ui.js`**

Add test cases covering:
- **#18/#14 Standalone `⚙ Settings` modal (Review Focus #3, #4):**
  - `ui.openSettings()` opens `#settings-backdrop` independently without opening `#manager-backdrop`; `Escape` closes Settings and leaves Manager closed.
  - Clicking `#btn-manager-settings` inside Manager opens `#settings-backdrop` over Manager; pressing `Escape` closes only Settings and leaves Manager open.
  - Settings modal contains Shortcut recorder, Dock expand segmented control, Orientation segmented control, Default visibility (`Shown` / `Hidden`) segmented control, per-site dock toggle (disabled on non-HTTP(S) URLs), `Open folders & More » on hover` checkbox, `Keep folder & More » open after running a script` checkbox, `Export` button, and `Import` button.
- **#14 Manager header & portrait sticky fix:** Manager header has `+ New Local Script`, `⚙ Settings`, and `×` (no inline Export/Import/Shortcut/Dock controls); CSS disables `position: sticky` on `.bt-sticky-section` under `@media (max-width: 600px), (max-height: 760px)`.
- **#13 Manager dimming:** Non-matching script pills in `Toolbar Layout`, folders with zero matching scripts (and empty folders), and non-matching chips inside `Folder Drawer` receive `.bt-pill-dimmed`, while matching script pills, folders with ≥1 matching script, and Library cards do NOT.
- **#5 Library pack badge consistency:** With a single pack installed (`{ id: 'mb', name: 'MusicBrainz Pack' }`), Library card `.bt-badge` renders `'MusicBrainz Pack'` (not `'Pack'`) with `title="MusicBrainz Pack"`, and `.bt-badge` CSS includes `max-width`, `overflow: hidden`, `text-overflow: ellipsis`, `white-space: nowrap`.

- [ ] **Step 2: Run UI unit tests to verify they fail**

Run: `node --test tests/test_bookmarklet_toolbar_ui.js`
Expected: FAIL on `openSettings`, `#settings-backdrop`, Manager header simplification, `.bt-pill-dimmed`, and Library pack badge tests.

- [ ] **Step 3: Implement standalone Settings modal, Manager updates, dimming, and badge truncation in `lib/BookmarkletToolbarUI.js`**

- Build `#settings-backdrop` (`.bt-backdrop.bt-backdrop-sub.hidden`, modal `.bt-modal` `max-width: min(480px, calc(100vw - 24px))`) in `buildOverlaySkeleton` containing the 4 sections from Spec §4.7 (Shortcut, Dock Behavior, Toolbar Folders & `More »`, Backup & Restore `Export`/`Import`).
- Add `state.settingsOpen`, `openSettings()`, `closeSettings()`, `renderSettingsView()`, update `handleKeydown` `Escape` priority (`pendingConfirm` → `editorOpen` → `exportOpen` → `importOpen` → `settingsOpen` → inline edits → `paletteOpen`/`managerOpen`), and expose `openSettings` on the returned UI instance.
- Update `toggleDockOnCurrentSite()` to use `Core.toggleDockSiteVisibility(state.settings, origin)` and `Core.isDockVisibleOnOrigin(nextSettings, origin)`.
- Simplify Manager header to `Bookmarklet Toolbar — Manager` + `+ New Local Script` + `⚙ Settings` (`#btn-manager-settings`) + `×`.
- Add `@media (max-width: 600px), (max-height: 760px) { .bt-sticky-section { position: static; } }` and `.bt-pill-dimmed { opacity: 0.45; transition: opacity 120ms ease; } .bt-pill-dimmed:hover, .bt-pill-dimmed:focus-within { opacity: 1; }`.
- Apply `.bt-pill-dimmed` in `renderManagerView()` using `Core.doesLayoutNodeMatchUrl(node, scriptsMap, state.url)` on toolbar script & folder pills and `Core.scriptMatchesUrl(s, state.url)` on folder drawer chips.
- Update `.bt-badge` CSS (`max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;`) and render `packMeta?.name || s.packId` with `badge.title = badgeText` on Library cards.

- [ ] **Step 4: Run UI unit tests to verify they pass**

Run: `node --test tests/test_bookmarklet_toolbar_ui.js`
Expected: PASS (0 failures).

- [ ] **Step 5: Commit**

```bash
git add lib/BookmarkletToolbarUI.js tests/test_bookmarklet_toolbar_ui.js
git commit -m "feat(bookmarklet-toolbar): extract standalone Settings modal, dim non-matching Manager items, and fix portrait layout"
```

---

### Task 7: Command Palette Fixes, Dual Footer Buttons & Drill-Down Inline Settings

**Files:**
- Modify: `lib/BookmarkletToolbarUI.js:2364-2368, 3533-3638, 4343-4397, 4645-4808, 5985-6016`
- Test: `tests/test_bookmarklet_toolbar_ui.js`

**Interfaces:**
- Consumes: `openManager()`, `openSettings()`, `openEditorModal(null)`, `openExportModal()`, `openImportModal()`, `setDockOrientation(v)`, `setDockExpandMode(v)`, `setDockSnapZone(v)`, `toggleDockOnCurrentSite()` (Tasks 4 & 6).
- Produces: Command Palette footer with `#palette-open-manager` (`Manager`) and `#palette-open-settings` (`⚙ Settings`), `state.paletteSubView` (`null | 'dock-orientation' | 'dock-expand' | 'dock-position'`), drill-down sub-views with `← Back` and `Esc` step-back, and direct-search sub-option matching.

- [ ] **Step 1: Write failing unit tests in `tests/test_bookmarklet_toolbar_ui.js`**

Add test cases covering:
- **#3 Query matching:** Typing `"command"` or `"action"` in `#palette-search` returns the `Actions` command rows instead of an empty list.
- **#4 Description line:** A script with empty `description` renders no `.bt-subtitle` description line (does NOT fall back to `s.match.join(', ')`); a script with `description` renders it.
- **#5 Pack badge:** With 1 pack installed, Command Palette script row `.bt-badge` displays `packMeta.name` with `title` attribute (never generic `'Pack'`).
- **#18 Dual footer buttons:** Palette footer renders separate `#palette-open-manager` (`Manager`, carrying `#palette-removed-dot`) and `#palette-open-settings` (`⚙ Settings`).
- **#18 Expanded root commands & non-HTTP(S) safety (Review Focus #3):** Root actions include `Open Manager`, `Open Settings`, `New Local Script`, `Export Configuration`, `Import Configuration`, `Change Command Palette Shortcut`, `Default Dock Visibility`, `Open Folders & More on Hover`, `Keep Folder & More Open After Run`, and compact drill-down rows `Dock Orientation`, `Dock Expand Mode`, `Dock Position`; on `file://` URL `toggle-dock-site` is omitted.
- **#18 Drill-down sub-views & `Escape` step-back (Review Focus #4):** Selecting `Dock Orientation` swaps palette into sub-view (`Select Dock Orientation…`) with `← Back` + `Auto`/`Horizontal`/`Vertical` (`Active` badge on current value); pressing `Escape` returns to root palette with `#palette-backdrop` still visible; picking `Vertical` updates `dockOrientation`, shows a toast, and closes the palette.
- **#18 Direct-search shortcuts:** Typing `"vert"` or `"bottom-right"` in root palette surfaces `Dock Orientation: Vertical` / `Dock Position: Bottom-Right` directly for one-step `Enter` execution.

- [ ] **Step 2: Run UI unit tests to verify they fail**

Run: `node --test tests/test_bookmarklet_toolbar_ui.js`
Expected: FAIL on #3, #4, #5, and #18 Command Palette tests.

- [ ] **Step 3: Implement Command Palette updates in `lib/BookmarkletToolbarUI.js`**

- Add `paletteSubView: null` to `state` (reset on `openPalette()` and when closing palette).
- Replace the single footer button in `buildOverlaySkeleton` with `#palette-open-manager` (`Manager` + `#palette-removed-dot`) and `#palette-open-settings` (`⚙ Settings`).
- Refactor `renderPaletteView()` and `executePaletteEntry(entry)` so keyboard `Enter` and row `click` share one dispatch path:
  - When `state.paletteSubView` is active, render `← Back` row + filtered options for that setting (with `'Active'` badge on current value).
  - When in root view, render script rows (omitting `descLine` if `!s.description`, showing `packMeta?.name || s.packId` with `title` on `.bt-badge`), root commands (all matching `'command action'` keywords), and when `q` is non-empty, matching flat direct-search sub-options (`Dock Orientation: <label>`, `Dock Expand Mode: <label>`, `Dock Position: <label>`).
- Update `paletteSearch` `Escape` handler (and `handleKeydown`) so `Escape` while `state.paletteSubView !== null` clears `state.paletteSubView`, clears `paletteQuery`, resets `paletteIndex = 0`, and re-renders without closing the palette.

- [ ] **Step 4: Run UI unit tests to verify they pass**

Run: `node --test tests/test_bookmarklet_toolbar_ui.js`
Expected: PASS (0 failures).

- [ ] **Step 5: Commit**

```bash
git add lib/BookmarkletToolbarUI.js tests/test_bookmarklet_toolbar_ui.js
git commit -m "feat(bookmarklet-toolbar): add Command Palette drill-down settings, dual footer buttons, and search/badge fixes"
```

---

### Task 8: Unmocked Headless Chrome E2E Verification, `dist/` Rebuild & Backlog Sync

**Files:**
- Modify: `tests/test_bookmarklet_toolbar_chrome_e2e.mjs`
- Regenerate: `dist/Site Bookmarklet Toolbar.user.js` (via `python tools/build_dist.py`)
- Modify: `docs/superpowers/specs/2026-11-22-bookmarklet-toolbar-backlog.md`

**Interfaces:**
- Consumes: All Wave 1 & Wave 2 deliverables in `src/` and `lib/` inlined via `buildInlinedUserscript()`.
- Produces: Passing real-browser E2E scenarios for strict CSS CSP, Spotify-style `blob:` JS CSP, strict no-`blob:` JS CSP (unmocked!), iframe suppression, and non-viewport-meta mobile Firefox-equivalent layout/touch; synced `dist/Site Bookmarklet Toolbar.user.js`; checked-off backlog.

- [ ] **Step 1: Add Headless Chrome E2E routes and test cases in `tests/test_bookmarklet_toolbar_chrome_e2e.mjs`**

Add HTTP routes to `createTestServer()` and tests covering:
1. `/csp-style-strict` (`Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self'`): asserts dock and Manager/Settings modals render styled via `adoptedStyleSheets` with **zero** `style-src` CSP console violations.
2. `/csp-script-blob` (`Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-eval' blob:; style-src 'self'`): asserts running a bookmarklet executes via `blob:` fallback **without** `GM.addElement` (sets a page global marker, no error toast).
3. `/csp-script-strict` (`Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'`, **NO mocked `GM.addElement`**): asserts running a bookmarklet surfaces a real CSP error toast (does not silently succeed or mask the CSP error).
4. `/iframe-host`: embeds a same-origin `<iframe>` matching the script URL; asserts only 1 `#userjs-bt-toolbar-host` exists in top document and `0` inside the iframe document.
5. `/mobile-no-viewport` (`412×924` mobile emulation, page without `<meta name="viewport">`): asserts `top-center` dock triggers `More »` with `.bt-dock-items-bar` `right <= viewportWidth`, sub-modals (`Add Local Script`, `⚙ Settings`) open top-aligned inside viewport, single taps on `[⚡]` toggle open and closed cleanly, and portrait Manager scrolls cleanly without squishing Library.

- [ ] **Step 2: Rebuild `dist/` and run full verification suite**

Run in one chained command:
```powershell
python tools/build_dist.py; node --test tests/test_bookmarklet_toolbar_core.js tests/test_bookmarklet_toolbar_adapters.js tests/test_bookmarklet_toolbar_ui.js tests/test_site_bookmarklet_toolbar_entry.js; pytest tests/test_build_dist_sync.py; node --test tests/test_bookmarklet_toolbar_chrome_e2e.mjs
```
Expected: ALL unit tests, `test_build_dist_sync.py`, and Headless Chrome E2E tests PASS with 0 failures.

- [ ] **Step 3: Mark items #1–#18 completed in `docs/superpowers/specs/2026-11-22-bookmarklet-toolbar-backlog.md`**

Update `- [ ]` to `- [x]` for items `#1` through `#18` in `docs/superpowers/specs/2026-11-22-bookmarklet-toolbar-backlog.md`.

- [ ] **Step 4: Commit E2E tests, `dist/` rebuild, and backlog update**

```bash
git add tests/test_bookmarklet_toolbar_chrome_e2e.mjs "dist/Site Bookmarklet Toolbar.user.js" docs/superpowers/specs/2026-11-22-bookmarklet-toolbar-backlog.md
git commit -m "test(bookmarklet-toolbar): add unmocked CSP/iframe/mobile E2E checks and rebuild dist"
```
