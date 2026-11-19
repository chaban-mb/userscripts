# Site Bookmarklet Toolbar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a cross-site userscript (`Site Bookmarklet Toolbar.user.js`) that bundles the `bookmarklets` pack at build time, mounts a site-scoped Shadow DOM toolbar (prioritizing MusicBrainz `div.header` plus an extensible fallback dock), and provides a Command Palette and unified Drag-and-Drop Manager UI.

**Architecture:** The `bookmarklets` repo compiles `src/*.js` into a single `bookmarklets.json` manifest, which `userscripts/tools/sync_bookmarklets_pack.py` converts into `lib/BookmarkletToolbarPacks.js`. Core pattern matching, pack diffing, layout reducers, code normalization, and import/export validation live in `lib/BookmarkletToolbarCore.js`; site adapters and page-context script execution live in `lib/BookmarkletToolbarAdapters.js`; self-contained Shadow DOM CSS/UI and Drag-and-Drop live in `lib/BookmarkletToolbarUI.js`; and `src/Site Bookmarklet Toolbar.user.js` ties them together with `GM.*` storage so `tools/build_dist.py` cleanly inlines all `@require ../lib/*` files inside one closure.

**Tech Stack:** Vanilla ES2022+ JavaScript (userscript & `lib/`), Shadow DOM + scoped CSS (zero external CSS/JS runtime deps), Python 3 stdlib (pack sync script), Node.js `node:test` + Python `unittest` + headless Chrome E2E verification.

**Spec:** [2026-11-15-site-bookmarklet-toolbar-design.md](file:///d:/Documents/git/userscripts/docs/superpowers/specs/2026-11-15-site-bookmarklet-toolbar-design.md)

## Global Constraints

- **Repo edit targets (`AGENTS.md`):** Edit `src/*.user.js`, `lib/*.js`, `tools/*`, and tests only; never edit `dist/` directly (`tools/build_dist.py` generates `dist/`).
- **Branches & commits:** Commit directly on `dev` unless a dedicated branch is requested; use atomic conventional commits (`feat(site-bookmarklet-toolbar): ...`, `feat(tools): ...`). Preserve existing comments/docstrings outside changed scope.
- **Closure & `build_dist.py` compatibility:** Outer userscript closure must use `(function () { 'use strict'; ... })();` (matching `tools/build_dist.py` `CLOSURE_START_RE`) with an inner async bootstrap `(async function init() { ... })();`.
- **Minimal `@grant`s:** Declare only `GM.getValue`, `GM.setValue`, `GM.deleteValue`, and `GM.registerMenuCommand` (no `GM.xmlHttpRequest`, no `unsafeWindow`).
- **Storage key schema:** Use isolated `UserJS.BookmarkletToolbar.<FieldName>` keys: `LocalScripts`, `Pack.<packId>`, `Layout`, `Recents`, `Settings`.
- **Logging:** Prefix all console output with `[Bookmarklet Toolbar]`; zero transient `console.log` statements; English UI only.
- **Style isolation & fast-path:** Exit early before creating any Shadow DOM host if zero **Toolbar-Placed** scripts match the current URL. All injected UI lives inside a closed/open Shadow DOM with self-contained CSS (no Tailwind CDN or external stylesheets).
- **No blocking browser dialogs & no per-card folder dropdowns:** Never call `window.prompt()` or `window.confirm()`; use the shared `28px` inline edit pill, in-UI delete confirmation modal, and unified Drag-and-Drop into sticky Toolbar/Folder targets.

## Review Focus

- **Raw `%` operators vs URL-encoded `javascript:` strings:** Pasted raw JS containing modulo (`5 % 2`) or printf strings alongside `javascript:%28function...` must normalize cleanly without throwing `URIError` or mangling code; covered in Task 3.
- **Violentmonkey `@match` apex-domain & scheme bounds:** `*://*.musicbrainz.org/*` must match `https://musicbrainz.org/release/1` and `https://beta.musicbrainz.org/edit` without matching `https://notmusicbrainz.org/`, `*://*/*` must reject `chrome://` or `about:`, and empty `match: []` must match nothing; covered in Task 3.
- **Strict CSP inline `<script>` block & page-context execution:** Sites whose CSP blocks inline `<script>` execution must trigger a `securitypolicyviolation` catch and show a non-blocking Shadow DOM toast error rather than failing silently or crashing; covered in Task 4.
- **Chromium Shadow DOM `dragleave` flicker, stacked handlers, & self-drag false warnings:** Re-rendering DnD containers must not stack listeners, `dragleave` with `relatedTarget === null` over child text nodes must not clear active highlights prematurely, and dragging a folder script chip over itself or its own folder pill must stay a neutral no-op rather than showing `"Folders cannot be nested inside folders"`; covered in Tasks 5 & 7.
- **Shadow DOM `Esc` & event retargeting:** Pressing `Escape` while editing an inline pill or recording a hotkey inside the Shadow DOM must cancel only that active control (via `composedPath()` / Shadow-root listeners) without closing the entire Manager modal; covered in Tasks 5 & 7.

---

### Task 1: Generate `bookmarklets.json` Manifest & Tests (`bookmarklets` repo)

**Files:**

- Create: `d:\Documents\git\userscripts\.worktrees\bookmarklets-manifest\tools\build_manifest.mjs`
- Create: `d:\Documents\git\userscripts\.worktrees\bookmarklets-manifest\bookmarklets.json`
- Create: `d:\Documents\git\userscripts\.worktrees\bookmarklets-manifest\tests\test_build_manifest.mjs`

**Interfaces:**

- Consumes: `d:\Documents\git\userscripts\.worktrees\bookmarklets-manifest\src\*.js` (all 22 source files)
- Produces:
  - `buildManifest({ srcDir, version })` returning `{ schemaVersion: 1, id: 'chaban-bookmarklets', name, version, description, homepage, scripts }`
  - Valid `bookmarklets.json` file in `d:\Documents\git\userscripts\.worktrees\bookmarklets-manifest\bookmarklets.json` (24 script entries: 18 direct files + 6 expanded same-tab/new-tab pairs + `universalSwitcher` only from `entity_subpage_transformers.js`).

- [ ] **Step 1: Write the failing test in `d:\Documents\git\userscripts\.worktrees\bookmarklets-manifest\tests\test_build_manifest.mjs`**

Assert against `buildManifest()`:

- Top-level fields: `schemaVersion === 1`, `id === 'chaban-bookmarklets'`, non-empty `name`, `version`, `description`, `homepage`.
- Script count is 24: expanded pairs exist for `open_in_harmony` / `open_in_harmony_new_tab`, `sambl_artist` / `sambl_artist_new_tab`, `convert_to_sambl_links` / `convert_to_sambl_links_new_tab`; `entity_subpage_transformers` contributes only `universal_switcher` (not individual entity subpage IIFEs).
- Every script has non-empty `id`, `name`, `description`, non-empty `match` array of strings, and `code` that compiles cleanly under `new vm.Script(script.code)`.
- Same-tab vs new-tab expanded `code` actually invoke `false` vs `true` respectively (no identical duplicate payloads).

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test d:\Documents\git\userscripts\.worktrees\bookmarklets-manifest\tests\test_build_manifest.mjs`
Expected: FAIL with module not found (`tools/build_manifest.mjs` missing).

- [ ] **Step 3: Implement `buildManifest` and CLI writer in `d:\Documents\git\userscripts\.worktrees\bookmarklets-manifest\tools\build_manifest.mjs`**

Export `buildManifest({ srcDir, version })` and run CLI mode when invoked directly (`--out bookmarklets.json`). Include explicit metadata table mapping all 22 source files in `src/` to `id`, `name`, `label`, `description`, non-empty site-scoped `@match` arrays (e.g., `*://*.musicbrainz.org/*`, `*://*.youtube.com/*`, `*://*.deezer.com/*`, `*://*.qobuz.com/*`, `*://*.music.apple.com/*`, `*://harmony.pulsewidth.org.uk/*`, `*://harmony.mybrainz.dev/*`, etc., using `*://*/*` only for universal URL/storage helpers `lookup_url`, `met_seeder`, `export_storage_cookies`, `convert_to_harmony_links`), and optional `folder` hint. Strip leading JSDoc header comments, handle `(newTab = false) { ... })();` expansion to explicit `(false);` and `(true);`, and extract the first `universalSwitcher` IIFE block cleanly from `entity_subpage_transformers.js`. Export default JSON cleanly to `bookmarklets.json`.

- [ ] **Step 4: Run test & generate `d:\Documents\git\userscripts\.worktrees\bookmarklets-manifest\bookmarklets.json`**

Run:
`node d:\Documents\git\userscripts\.worktrees\bookmarklets-manifest\tools\build_manifest.mjs`
`node --test d:\Documents\git\userscripts\.worktrees\bookmarklets-manifest\tests\test_build_manifest.mjs`
Expected: Writes `bookmarklets.json` and all assertions PASS.

- [ ] **Step 5: Commit in `d:\Documents\git\userscripts\.worktrees\bookmarklets-manifest`**

```bash
git -C d:\Documents\git\userscripts\.worktrees\bookmarklets-manifest add tools/build_manifest.mjs tests/test_build_manifest.mjs bookmarklets.json
git -C d:\Documents\git\userscripts\.worktrees\bookmarklets-manifest commit -m "feat: add build-time bookmarklets.json manifest generator"
```

---

### Task 2: Build-Time Sync Script (`tools/sync_bookmarklets_pack.py`) & Bundled Pack Generation

**Files:**

- Create: `d:\Documents\git\userscripts\.worktrees\site-bookmarklet-toolbar\tools\sync_bookmarklets_pack.py`
- Create: `d:\Documents\git\userscripts\.worktrees\site-bookmarklet-toolbar\lib\BookmarkletToolbarPacks.js`
- Create: `d:\Documents\git\userscripts\.worktrees\site-bookmarklet-toolbar\tests\test_sync_bookmarklets_pack.py`

**Interfaces:**

- Consumes: `bookmarklets.json` (either `--source <path>` or `--url <https_url>`)
- Produces:
  - `load_manifest(source=None, url=None) -> dict` and `render_packs_module(manifests: list[dict]) -> str` in `tools/sync_bookmarklets_pack.py`
  - `lib/BookmarkletToolbarPacks.js` (with `// ==UserScript==` header + `const BUNDLED_BOOKMARKLET_PACKS = [...];`, plus CJS export guard when `typeof module !== 'undefined'`).

- [ ] **Step 1: Write the failing Python test in `d:\Documents\git\userscripts\.worktrees\site-bookmarklet-toolbar\tests\test_sync_bookmarklets_pack.py`**

Test using `unittest`:

- Loading valid `bookmarklets.json` from a local temp file renders JS containing `BUNDLED_BOOKMARKLET_PACKS` and expected pack metadata.
- Loading from an HTTP URL via `http.server.ThreadingHTTPServer` succeeds identically.
- Invalid manifest (missing `schemaVersion !== 1`, empty `match`, or empty `code`) raises `ValueError`.
- Rendered JS parses cleanly when loaded in Node (`node -e` or `vm`).

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m unittest d:\Documents\git\userscripts\.worktrees\site-bookmarklet-toolbar\tests\test_sync_bookmarklets_pack.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'sync_bookmarklets_pack'`.

- [ ] **Step 3: Implement `tools/sync_bookmarklets_pack.py` and generate `lib/BookmarkletToolbarPacks.js`**

Support CLI args `--source` (defaulting to `../bookmarklets/bookmarklets.json`), `--url`, and `--output` (defaulting to `lib/BookmarkletToolbarPacks.js`). Validate `schemaVersion === 1`, required pack strings, and non-empty `scripts[].id`, `name`, `match`, `code`. Serialize deterministic JSON wrapped with `// ==UserScript==` metadata block (so `tools/build_dist.py` strips header cleanly during inlining) plus dual browser-closure / `module.exports` exposure (`if (typeof module !== 'undefined' && module.exports) { module.exports = BUNDLED_BOOKMARKLET_PACKS; }`). Note: ensure `tools/build_dist.py` strips or avoids leaking `module.exports` — wrap export in `try { if (typeof module === 'object' && module && module.exports) module.exports = BUNDLED_BOOKMARKLET_PACKS; } catch {}`.

- [ ] **Step 4: Run generator and tests**

Run:
`python d:\Documents\git\userscripts\.worktrees\site-bookmarklet-toolbar\tools\sync_bookmarklets_pack.py --source d:\Documents\git\userscripts\.worktrees\bookmarklets-manifest\bookmarklets.json`
`python -m unittest d:\Documents\git\userscripts\.worktrees\site-bookmarklet-toolbar\tests\test_sync_bookmarklets_pack.py -v`
Expected: `lib/BookmarkletToolbarPacks.js` generated with 24 scripts; all tests PASS.

- [ ] **Step 5: Commit in `d:\Documents\git\userscripts`**

```bash
git add tools/sync_bookmarklets_pack.py lib/BookmarkletToolbarPacks.js tests/test_sync_bookmarklets_pack.py
git commit -m "feat(tools): add bookmarklets pack sync script and bundled pack"
```

---

### Task 3: Core Matcher, Pack Sync, Layout Reducers, Normalization & Backup Engine (`lib/BookmarkletToolbarCore.js`)

**Files:**

- Create: `d:\Documents\git\userscripts\.worktrees\site-bookmarklet-toolbar\lib\BookmarkletToolbarCore.js`
- Create: `d:\Documents\git\userscripts\.worktrees\site-bookmarklet-toolbar\tests\test_bookmarklet_toolbar_core.js`

**Interfaces:**

- Produces (on `BookmarkletToolbarCore` class/namespace + conditional CJS export):
  - `STORAGE_KEYS`: `{ localScripts: 'UserJS.BookmarkletToolbar.LocalScripts', layout: 'UserJS.BookmarkletToolbar.Layout', recents: 'UserJS.BookmarkletToolbar.Recents', settings: 'UserJS.BookmarkletToolbar.Settings', packKey(packId) }`
  - `isValidMatchPattern(pattern) -> boolean`
  - `matchPattern(pattern, url) -> boolean`
  - `scriptMatchesUrl(script, url) -> boolean`
  - `syncPackCache(cachedPack, bundledPack, layout) -> { packCache, changed, stats }`
  - `buildScriptsMap(packsById, localScripts) -> Record<string, ScriptEntry>`
  - `shouldMountToolbar(layout, scriptsMap, url) -> boolean`
  - `getVisibleLayoutForUrl(layout, scriptsMap, url) -> VisibleNode[]`
  - `getPlacement(layout, scriptId) -> { kind: 'toolbar'|'folder', index, folderId?, folderName? } | null`
  - Immutable layout helpers returning new `layout` arrays (avoiding stale references):
    - `toggleToolbarPin(layout, scriptId)`
    - `placeScriptOnToolbarAt(layout, scriptId, targetIdx)`
    - `moveToolbarNode(layout, fromIdx, toIdx)`
    - `moveScriptToFolder(layout, scriptId, folderId, targetIdx?)`
    - `setScriptLabel(layout, target, label)` / `removeFolderItem(layout, folderId, itemIdx)` / `renameFolder(layout, folderId, newName)` / `createFolder(layout, name)`
    - `convertRemovedPackScriptToLocal(packCache, localScripts, layout, scriptId)`
    - `removeOrphanedPackScriptFully(packCache, layout, scriptId)`
    - `deleteLocalScript(localScripts, layout, scriptId)`
    - `deleteFolder(layout, folderIdx)`
  - `normalizeBookmarkletCode(rawCode) -> string`
  - `buildExportEnvelope(localScripts, layout) -> object`
  - `parseAndValidateImport(rawJson) -> { scripts, layout }`
  - `matchesHotkey(event, combo) -> boolean` & `formatHotkeyEvent(event) -> string|null`

- [ ] **Step 1: Write the failing test suite in `tests/test_bookmarklet_toolbar_core.js`**

Using `node:test`, cover all core behaviors and Review Focus edge cases:

- `matchPattern`: `<all_urls>`, `*://*/*` (rejects `chrome://settings`, `file:///a`), `*://*.musicbrainz.org/*` matches both `https://musicbrainz.org/release/1` (apex) and `https://beta.musicbrainz.org/x`, rejects `https://notmusicbrainz.org/`, path wildcards, query parameters, `match: []` never matches.
- `syncPackCache`: first install populates `Pack.<packId>` without touching `layout`; version bump adds new scripts, updates changed code, clears `removed` if script returns, drops unplaced removed scripts, and preserves placed scripts flagged `removed: true` with runnable `code` intact.
- `shouldMountToolbar` & `getVisibleLayoutForUrl`: returns `false` when matching script exists only in Library (unplaced), returns `true` when matching script is Pinned or inside a Folder, hides empty folders and non-matching items per URL, applies label override precedence `node.label || script.label || script.name`.
- Layout reducers: moving forward within Toolbar (`0 -> 2`), moving script across folders and into Toolbar while preserving `label`, reordering inside same folder without stale cloned folder bug, converting `removed: true` script into `LocalScripts` & rewriting `layout` references cleanly.
- `normalizeBookmarkletCode`: strips `javascript:`, decodes URI-encoded `(function()%7B...%7D)()`, leaves raw JS with modulo operators (`if (x % 2 === 0)`) untouched!
- `parseAndValidateImport`: accepts schema v1 export, rejects nested folders (`folder.items` containing `type: 'folder'`), rejects invalid script shapes or non-array `match`.
- Hotkeys: `matchesHotkey` ignores modifier-only presses, matches `Alt+B`, and `formatHotkeyEvent` requires at least one modifier (`Ctrl`/`Alt`/`Shift`).

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test d:\Documents\git\userscripts\.worktrees\site-bookmarklet-toolbar\tests\test_bookmarklet_toolbar_core.js`
Expected: FAIL with module not found (`lib/BookmarkletToolbarCore.js`).

- [ ] **Step 3: Implement `lib/BookmarkletToolbarCore.js`**

Start file with `// ==UserScript==` header (`@name Bookmarklet Toolbar Core`, `@license MIT`). Implement all pure functions listed in Interfaces, ensuring deep/clean immutable clones in layout reducers so UI state never mutates stale references. Guard CJS export cleanly so `build_dist.py` can inline inside the userscript closure without side effects.

- [ ] **Step 4: Run unit tests to verify they pass**

Run: `node --test d:\Documents\git\userscripts\.worktrees\site-bookmarklet-toolbar\tests\test_bookmarklet_toolbar_core.js`
Expected: All assertions PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/BookmarkletToolbarCore.js tests/test_bookmarklet_toolbar_core.js
git commit -m "feat(site-bookmarklet-toolbar): add core matcher, pack diff, and layout engine"
```

---

### Task 4: Site Mount Adapters & Page-Context Execution (`lib/BookmarkletToolbarAdapters.js`)

**Files:**

- Create: `d:\Documents\git\userscripts\.worktrees\site-bookmarklet-toolbar\lib\BookmarkletToolbarAdapters.js`
- Create: `d:\Documents\git\userscripts\.worktrees\site-bookmarklet-toolbar\tests\test_bookmarklet_toolbar_adapters.js`

**Interfaces:**

- Consumes: `normalizeBookmarkletCode` from `BookmarkletToolbarCore`
- Produces:
  - `SITE_ADAPTERS` (`musicbrainz` adapter + `fallback` adapter implementing `{ id, matches(url), mount(doc, hostEl), unmount(doc, hostEl) }`)
  - `resolveMountAdapter(url, doc) -> adapter` (matches `*.musicbrainz.org` and `*.musicbrainz.eu`, verifies header mount point exists, falls back cleanly to `fallback` adapter on unrecognized DOM/other sites)
  - `executeScriptInPage(rawCode, { doc, win, onError }) -> { ok: boolean, error?: string }`

- [ ] **Step 1: Write the failing test suite in `tests/test_bookmarklet_toolbar_adapters.js`**

Verify using lightweight mock DOM elements:

- `resolveMountAdapter`: picks `musicbrainz` adapter for `https://musicbrainz.org/release/abc`, `https://beta.musicbrainz.org/artist/abc`, and `https://musicbrainz.eu/` when `div.header .right .top` and `.search-container` exist; falls back to `fallback` adapter on `youtube.com` or if MB header selector is absent (e.g., error pages).
- `musicbrainz.mount`: inserts host element directly before `.search-container` inside `.header .right .top` without modifying `.links-container`, `.search-container`, or `.header .bottom` nav links; `unmount()` removes host element cleanly and re-mounting is idempotent.
- `fallback.mount`: appends fixed-position Shadow DOM host cleanly to `document.documentElement || document.body` and unmounts cleanly.
- `executeScriptInPage`: injects synchronous inline `<script>` inside `document.head || document.documentElement` with normalized JS and removes `<script>` node immediately after execution; captures `securitypolicyviolation` events matching inline script violation or `window` error handler triggers and calls `onError` cleanly with a user-readable CSP message.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test d:\Documents\git\userscripts\.worktrees\site-bookmarklet-toolbar\tests\test_bookmarklet_toolbar_adapters.js`
Expected: FAIL with module not found (`lib/BookmarkletToolbarAdapters.js`).

- [ ] **Step 3: Implement `lib/BookmarkletToolbarAdapters.js`**

Add `// ==UserScript==` header. Implement `musicbrainz` adapter (`div.header .right .top` pre-`.search-container` flex slot with `min-width: 0; flex: 1 1 auto` and zero perturbation to surrounding MB menus) and `fallback` dock adapter, plus `executeScriptInPage` (attaching a transient capture-phase `securitypolicyviolation` listener on `document` around synchronous `<script>` insertion to detect strict CSP blocks reliably).

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test d:\Documents\git\userscripts\.worktrees\site-bookmarklet-toolbar\tests\test_bookmarklet_toolbar_adapters.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/BookmarkletToolbarAdapters.js tests/test_bookmarklet_toolbar_adapters.js
git commit -m "feat(site-bookmarklet-toolbar): add site mount adapters and CSP-aware page execution"
```

---

### Task 5: Self-Contained Shadow DOM UI & Hardened DnD (`lib/BookmarkletToolbarUI.js`)

**Files:**

- Create: `d:\Documents\git\userscripts\.worktrees\site-bookmarklet-toolbar\lib\BookmarkletToolbarUI.js`
- Create: `d:\Documents\git\userscripts\.worktrees\site-bookmarklet-toolbar\tests\test_bookmarklet_toolbar_ui.js`

**Interfaces:**

- Consumes: helpers from `BookmarkletToolbarCore`
- Produces:
  - `createToolbarUI({ mountRoot, initialState, callbacks })` returning `{ update(nextState), openPalette(), openManager(), showToast(message), isRecordingHotkey(), destroy() }`
  - `mountRoot` renders:
    - Inline/floating **Toolbar** (`displayLabel`, `⚠` indicator for `removed: true`, click-to-open/close Folder dropdowns, `⌘` Command Palette trigger with amber dot badge when `hasRemovedPlacedScript()` is true).
    - **Modal Root** (lazy-created inside a separate fixed overlay Shadow DOM host when Command Palette or Manager opens, so the Command Palette and Manager remain available everywhere even on sites where the Toolbar does not mount!).
  - Full UI parity with v15 mockup using self-contained CSS custom properties (`--bt-*` with light/dark scheme tokens, `all: initial` reset, `border-box`, minimum `12px` font sizes):
    - **Command Palette:** Live search, Recently Run group, Matching Library group, searchable `Open Settings / Manager` action, inline source badges, keyboard `ArrowUp`/`ArrowDown`/`Enter`/`Escape` navigation.
    - **Manager Modal:** Top-right anchored `×`, sub-bar (`+ New Local Script`, `Export`, `Import`, live shortcut recorder button), Sticky Toolbar Strip (`+ Folder` inline `28px` pill, draggable script/folder pills, `★` unpin, double-click label edit, high-contrast `4px` `::before`/`::after` reorder anchors centered in `8px` gaps), Selected Folder Drawer (double-click folder title to rename inline, `🗑` delete folder, draggable chips with double-click relabel + `☆` pin + `×` remove, explicit `"Folders cannot be nested inside folders"` hint ONLY on folder-into-drawer/chip drags, never on self-hover), Searchable Library (Packs badge popover supporting 1 vs `N` packs, "Matching current site" filter, aligned `☆`/`★` + `⚠` slot, `ⓘ` popover inline right after title, clickable `📁 <Folder>` badge, `✎`/`🗑` for local, `Convert`/`🗑` for orphaned pack scripts, ZERO per-card folder dropdowns).
    - **Sub-modals:** Editor modal (name, optional desc, required `@match` patterns with **Prefill current site**, **Prefill all sites**, and Violentmonkey `@match` docs link, code textarea), In-UI Delete Confirmation modal (never `window.confirm()`), Export modal (JSON preview, Copy to clipboard with selection fallback, Download `.json`), Import modal (File picker, Paste clipboard, textarea, **Replace** confirmation).

- [ ] **Step 1: Write the failing UI behavior test in `tests/test_bookmarklet_toolbar_ui.js`**

Test key DOM/interaction contracts (using a minimal ShadowRoot/DOM shim or Chrome headless helper):

- Overlay Shadow DOM mounts independently when `openPalette()` or `openManager()` is called with `toolbarMounted = false`.
- `Escape` inside an active inline edit pill calls `stopPropagation()` and cancels only that inline pill without invoking `onClose` on the Manager modal.
- `bindDropTarget` separates neutral self-hover (`null` -> no error hint) from disallowed folder nesting (`{ blocked: true }` -> displays `"Folders cannot be nested inside folders"`), uses `ondragover`/`ondrop`/`ondragleave` single assignment (never stacking listeners across repeated `render()` calls), and checks `e.relatedTarget` safely across `contains()`.
- Library cards do NOT render any `<select>` folder chooser; clicking a `📁 <Folder>` status badge selects that folder in the sticky drawer.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test d:\Documents\git\userscripts\.worktrees\site-bookmarklet-toolbar\tests\test_bookmarklet_toolbar_ui.js`
Expected: FAIL with module not found (`lib/BookmarkletToolbarUI.js`).

- [ ] **Step 3: Implement `lib/BookmarkletToolbarUI.js`**

Write clean, single-purpose helper builders (`buildStyles()`, `renderToolbarView()`, `renderPaletteView()`, `renderManagerView()`, `createInlineEditPill()`, `bindDropTarget()`) inside `BookmarkletToolbarUI`. Use `e.composedPath()` and shadow-root `keydown`/`click` handlers so Shadow DOM event retargeting never breaks outside-click dismissal, inline `Escape`, or hotkey recording. Keep all text plain English and icon grammar consistent with Spec Section 5.2 item 4.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test d:\Documents\git\userscripts\.worktrees\site-bookmarklet-toolbar\tests\test_bookmarklet_toolbar_ui.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/BookmarkletToolbarUI.js tests/test_bookmarklet_toolbar_ui.js
git commit -m "feat(site-bookmarklet-toolbar): add Shadow DOM toolbar, palette, and manager UI"
```

---

### Task 6: Userscript Entrypoint (`src/Site Bookmarklet Toolbar.user.js`) & `build_dist.py` Build Verification

**Files:**

- Create: `d:\Documents\git\userscripts\.worktrees\site-bookmarklet-toolbar\src\Site Bookmarklet Toolbar.user.js`
- Create: `d:\Documents\git\userscripts\.worktrees\site-bookmarklet-toolbar\tests\test_site_bookmarklet_toolbar_entry.js`

**Interfaces:**

- Consumes: `BookmarkletToolbarCore`, `BUNDLED_BOOKMARKLET_PACKS`, `SITE_ADAPTERS`/`resolveMountAdapter`/`executeScriptInPage`, `createToolbarUI`
- Produces: Working in-browser userscript with:
  - Header: `@match *://*/*`, `@run-at document-end`, `@grant GM.getValue`, `@grant GM.setValue`, `@grant GM.deleteValue`, `@grant GM.registerMenuCommand`, `@require ../lib/BookmarkletToolbarCore.js`, `@require ../lib/BookmarkletToolbarPacks.js`, `@require ../lib/BookmarkletToolbarAdapters.js`, `@require ../lib/BookmarkletToolbarUI.js`, `@updateURL https://github.com/chaban-mb/userscripts/raw/main/src/Site%20Bookmarklet%20Toolbar.user.js`, `@downloadURL https://github.com/chaban-mb/userscripts/raw/main/src/Site%20Bookmarklet%20Toolbar.user.js`.
  - Logger using `[Bookmarklet Toolbar]` prefix (`console.debug`/`info`/`warn`/`error`).
  - Cross-tab / state persistence (`UserJS.BookmarkletToolbar.*`), SPA URL mutation watch (throttled `MutationObserver` / `history` / `popstate` check re-evaluating `shouldMountToolbar` without leaking duplicate listeners), menu command registration (**Open Command Palette**, **Open Bookmarklet Manager**), global hotkey listener (skipping editable page inputs unless hotkey has non-Shift modifier and isn't suppressed while recording), and lazy modal Shadow DOM initialization on unmatched sites.

- [ ] **Step 1: Write the failing entrypoint integration test in `tests/test_site_bookmarklet_toolbar_entry.js`**

Test in Node VM + mock `GM`:

- Verify `tools/build_dist.py`'s `inline_userscript('src/Site Bookmarklet Toolbar.user.js')` succeeds cleanly, removes `../lib/*` `@require` lines, rewrites URLs to `dist/`, keeps all library code strictly INSIDE the outer `(function () { 'use strict'; ... })();` closure, and compiles with `new vm.Script(inlinedCode)`.
- Run the script on an unmatched URL (`https://example.com/`) with fresh empty `GM` storage:
  - Asserts `UserJS.BookmarkletToolbar.Pack.chaban-bookmarklets` is synced (24 scripts) while `Layout` remains `[]` (no auto-pinning).
  - Asserts **zero** toolbar DOM host elements are appended to the page (fast-path exit).
  - Asserts `GM.registerMenuCommand` registered both **Open Command Palette** and **Open Bookmarklet Manager**.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test d:\Documents\git\userscripts\.worktrees\site-bookmarklet-toolbar\tests\test_site_bookmarklet_toolbar_entry.js`
Expected: FAIL (`src/Site Bookmarklet Toolbar.user.js` not found).

- [ ] **Step 3: Implement `src/Site Bookmarklet Toolbar.user.js`**

Follow `.agents/rules/userscript-development.md`:

- Outer closure `(function () { 'use strict'; (async function main() { ... })(); })();` (so `build_dist.py` `CLOSURE_START_RE` inlines all `@require`s inside the IIFE).
- Load `Settings`, `LocalScripts`, `Layout`, `Recents`, and each bundled pack's `Pack.<packId>` via `await Promise.all([...])`. Sync any bundled pack whose version changed via `syncPackCache` and persist updated `Pack.<packId>`.
- Always register `GM.registerMenuCommand` items and the global `keydown` listener; initialize toolbar mount ONLY when `shouldMountToolbar(...)` returns `true` for the current URL, and lazily create the overlay Shadow DOM host when Command Palette or Manager is first opened.
- Wire mutations (`saveLayout`, `saveLocalScripts`, `savePackCache`, `saveSettings`, `recordExecution`) back to `GM.setValue` / `GM.deleteValue` cleanly with `try/catch` and `[Bookmarklet Toolbar]` error logging.

- [ ] **Step 4: Run test & full unit suite to verify everything passes**

Run:
`node --test d:\Documents\git\userscripts\.worktrees\site-bookmarklet-toolbar\tests\test_bookmarklet_toolbar_*.js d:\Documents\git\userscripts\.worktrees\site-bookmarklet-toolbar\tests\test_site_bookmarklet_toolbar_entry.js`
`python -m unittest d:\Documents\git\userscripts\.worktrees\site-bookmarklet-toolbar\tests\test_build_dist_sync.py d:\Documents\git\userscripts\.worktrees\site-bookmarklet-toolbar\tests\test_sync_bookmarklets_pack.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "src/Site Bookmarklet Toolbar.user.js" tests/test_site_bookmarklet_toolbar_entry.js
git commit -m "feat(site-bookmarklet-toolbar): add userscript entrypoint and storage wiring"
```

---

### Task 7: Real Headless Chrome E2E Verification & Documentation

**Files:**

- Create: `d:\Documents\git\userscripts\.worktrees\site-bookmarklet-toolbar\tests\test_bookmarklet_toolbar_chrome_e2e.mjs`
- Create (or update): `d:\Documents\git\userscripts\.worktrees\site-bookmarklet-toolbar\README.md` (if script listing / docs apply — verify existing repo docs first) and `d:\Documents\git\userscripts\.worktrees\bookmarklets-manifest\README.md` (`universalSwitcher` note from Spec Section 6)

**Interfaces:**

- Consumes: Inlined userscript output from `tools/build_dist.py` (`inline_userscript('src/Site Bookmarklet Toolbar.user.js')`) injected into headless Chrome via CDP / `--remote-debugging-port` against mock HTML pages simulating MusicBrainz `div.header` (with `.links-container`, `.search-container`, and `.bottom` nav) and an unmatched `example.com` page.

- [ ] **Step 1: Write real headless Chrome E2E test in `tests/test_bookmarklet_toolbar_chrome_e2e.mjs`**

Drive real Chrome (via built-in `WebSocket` + `--headless=new --remote-debugging-port=0` with `GM` mock bindings on `page`):

1. Unmatched page first run -> zero Shadow DOM toolbar host created.
2. Open Manager via mocked menu command -> assert Manager modal renders inside Shadow DOM, search Library for `"Approve"`, pin via `☆` -> Toolbar mounts cleanly inside MusicBrainz `div.header .right .top` between `.links-container` and `.search-container` without shifting or breaking `.search-container` or `.header .bottom` nav bounding boxes.
3. Click `+ Folder` inline pill -> press `Escape` -> inline pill closes cleanly while Manager modal remains open! Create folder `"QC"`, double-click `"QC"` title in Folder drawer to rename inline to `"Review"` -> persists.
4. Dispatch HTML5 Drag & Drop inside Shadow DOM: verify dragging a folder onto the open Folder drawer displays `"Folders cannot be nested inside folders"` with no highlight, whereas dragging a chip over itself produces NO blocked hint, and dragging script card onto folder pill moves it cleanly.
5. Export JSON -> Import JSON (`Replace` semantics) -> verify Local Scripts and Layout replace cleanly and persist across reload.
6. Test executing a script accessing `window.MB._releaseEditor` runs in real page context, and verify CSP violation event toast displays cleanly on a CSP-restricted test frame.

- [ ] **Step 2: Run E2E test & fix any real-browser Shadow DOM / DnD / layout issues uncovered**

Run: `node d:\Documents\git\userscripts\.worktrees\site-bookmarklet-toolbar\tests\test_bookmarklet_toolbar_chrome_e2e.mjs`
Expected: PASS (if any Shadow DOM focus, `composedPath`, CSS, or DnD bug appears in real Chrome, fix it in `lib/BookmarkletToolbarUI.js` / `lib/BookmarkletToolbarAdapters.js` with a regression assertion).

- [ ] **Step 3: Update user docs (`bookmarklets/README.md` `universalSwitcher` note + `userscripts` docs/workflow sync)**

Add `universalSwitcher` documentation to `d:\Documents\git\userscripts\.worktrees\bookmarklets-manifest\README.md`, and run any repo docs generator or markdown linter (`tools/build_list.py` / markdown check if configured — inspect first before running). Verify `git status` leaves `dist/` untouched on `dev`.

- [ ] **Step 4: Run complete verification suite cleanly across both repos**

Run:
`node --test d:\Documents\git\userscripts\.worktrees\bookmarklets-manifest\tests\test_build_manifest.mjs`
`node --test d:\Documents\git\userscripts\.worktrees\site-bookmarklet-toolbar\tests\test_bookmarklet_toolbar_*.js d:\Documents\git\userscripts\.worktrees\site-bookmarklet-toolbar\tests\test_site_bookmarklet_toolbar_entry.js`
`python -m unittest d:\Documents\git\userscripts\.worktrees\site-bookmarklet-toolbar\tests\test_sync_bookmarklets_pack.py d:\Documents\git\userscripts\.worktrees\site-bookmarklet-toolbar\tests\test_build_dist_sync.py -v`
`node d:\Documents\git\userscripts\.worktrees\site-bookmarklet-toolbar\tests\test_bookmarklet_toolbar_chrome_e2e.mjs`
Expected: Every single test passes with 0 skipped/failed checks.

- [ ] **Step 5: Commit docs & E2E tests**

```bash
git -C d:\Documents\git\userscripts\.worktrees\bookmarklets-manifest add README.md
git -C d:\Documents\git\userscripts\.worktrees\bookmarklets-manifest commit -m "docs: document universalSwitcher bookmarklet"
git -C d:\Documents\git\userscripts\.worktrees\site-bookmarklet-toolbar add tests/test_bookmarklet_toolbar_chrome_e2e.mjs
git -C d:\Documents\git\userscripts\.worktrees\site-bookmarklet-toolbar commit -m "test(site-bookmarklet-toolbar): add headless Chrome E2E verification"
```
