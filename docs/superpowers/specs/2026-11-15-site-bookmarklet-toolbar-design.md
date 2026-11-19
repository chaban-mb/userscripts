# Site Bookmarklet Toolbar — Design Document

**Date:** 2026-11-15  
**Status:** Ready for Approval  
**Target Repos:** `userscripts` (`src/*.user.js`, optional `lib/*.js` / `tools/`) and `bookmarklets` (`bookmarklets.json`)

---

## 1. Intent & Why

Browser bookmark toolbars waste vertical/horizontal space by showing every bookmarklet on every website, even when most are site-specific (e.g., MusicBrainz, Harmony, YouTube, Qobuz, Deezer). Existing browser extensions hide bookmarklets behind an extension icon and a flat popup list, breaking the **one-click, zero-hunting** muscle memory of root toolbar buttons and compact folders.

This userscript moves bookmarklets onto the sites where they actually apply—starting with MusicBrainz's `div.header` (which stays reachable via sticky header userstyles)—while keeping the same root-button + folder ergonomics, adding a searchable command palette with recently run tracking, and allowing full in-browser customization.

---

## 2. Goals, Non-Goals, and Anti-Goals

### Goals

- **One-click Toolbar + Folders:** Pin frequent scripts directly to the Toolbar and group less-used scripts into Folder dropdowns, mirroring the browser bookmarks bar.
- **Runs everywhere (`*://*/*`) with fast-path exit:** Uses `@match *://*/*` so local scripts for any site and the fallback dock work out of the box, exiting early before creating any Shadow DOM UI when no scripts match the current URL.
- **MusicBrainz-first integration:** Dock cleanly into the empty space of MusicBrainz's `div.header` without interfering with the logo, user/data menus, or search bar.
- **Extensible site-mount architecture:** Support attaching unobtrusively to other sites (via site adapters or a compact fallback dock) when matching scripts exist.
- **User-controlled global layout:** A single global layout tree (Pinned Toolbar buttons + 1-level Folders) filtered at render time by each script's `@match` patterns, hiding non-matching buttons and empty folders per site. Users can pin/unpin scripts, organize folders, and customize button labels and folder names. Packs may optionally define suggested metadata, while the v1 bundled pack starts unpinned in the Library so the user chooses what appears on the Toolbar.
- **In-browser customization:** Add, edit, and delete local scripts; create, rename, reorder, and delete folders; pin/unpin and reorder toolbar items; export and import local scripts and layout as JSON.
- **Command palette & recents:** Quick search palette (keyboard shortcut + toolbar button) to filter and run any matching script, with recently run scripts surfaced at the top.
- **Cross-origin persistence:** Use `GM.getValue` / `GM.setValue` so layout, local scripts, and recents persist across `musicbrainz.org`, `beta.musicbrainz.org`, `musicbrainz.eu`, and any other matched site.

### Non-Goals (v1)

- **Runtime remote repo syncing:** Fetching arbitrary external repositories at runtime via `GM.xmlHttpRequest` / `@connect *` is deferred to the Future Roadmap (Section 8). v1 bundles the initial pack at build time.
- **Deeply nested folder trees:** One level of folders in the toolbar is sufficient; multi-level nested submenus are out of scope.

### Anti-Goals

- **Popup-first UX:** Never require clicking a menu icon just to reach frequent actions.
- **Forcing pack opinions:** Never force bundled scripts onto the user's toolbar or overwrite the user's layout/renames/folders when the bundled pack updates.
- **Site UI interference:** Never break host site CSS, header dropdowns, or sticky positioning.

---

## 3. Constraints

- **Repo & Userscript Standards:** Follow `AGENTS.md` and `.agents/rules/userscript-development.md`:
  - Edit `src/*.user.js` (and `lib/*.js` / `tools/` if needed); never edit `dist/` directly.
  - Async IIFE encapsulation `(async function () { 'use strict'; ... })();`.
  - Minimal `@grant`s (`GM.getValue`, `GM.setValue`, `GM.deleteValue`, `GM.registerMenuCommand`).
  - Storage keys under `UserJS.BookmarkletToolbar.<FieldName>` (e.g., `Layout`, `LocalScripts`, `Recents`, `Settings`).
  - Standardized `[Bookmarklet Toolbar]` console prefix; no transient `console.log` calls; English UI.
- **Page-Context Execution:** Bookmarklets such as `multi_tool.js` read and invoke page globals (e.g., `MB._releaseEditor`). Scripts must execute in the **page context** (not the isolated userscript sandbox), with clear error handling/notification if a site's Content Security Policy (CSP) blocks execution.
- **Style Isolation:** All injected UI (toolbar, folder dropdowns, command palette, manager modal) must live inside a Shadow DOM root so host site styles cannot leak in and toolbar styles cannot leak out.

---

## 4. Approaches Considered

1. **Layered Userscript + Runtime Repo Manifest Protocol**
   - *How it works:* Userscript fetches `bookmarklets.json` manifests and raw `.js` files from one or more remote repos at runtime via `GM.xmlHttpRequest` (`@connect *`), caching them locally and merging with user layout.
   - *Trade-off:* Enables independent repo updates without userscript updates, but adds network/caching complexity and broader `@connect` permissions. **Deferred to Roadmap.**

2. **Repo-Bundled Userscript with Local Customization *(Selected for v1)***
   - *How it works:* A build-time sync step packages the scripts from `d:\Documents\git\bookmarklets` into the userscript as a read-only bundled pack, while `GM` storage manages user layout (root pins, folders, ordering), custom local scripts, recents, and JSON import/export.
   - *Trade-off:* Zero network latency, minimal `@grant` permissions, works offline, and cleanly separates pack data from user layout—making runtime remote packs easy to plug in later.

3. **Remote Microkernel Shell *(Rejected)***
   - *How it works:* A minimal bootstrapper loads both UI and scripts remotely.
   - *Why rejected:* Conflicts with Greasy Fork policies against remote code loading and breaks offline/rate-limited usage.

---

## 5. Architecture & Design Decisions

### 5.1 Layered Data Model & Isolated Storage Schema

Separating **script sources** into isolated `GM` storage objects (one for local scripts, one per pack) prevents any cross-pack or pack-vs-local write conflicts, ensures pack updates never clobber user organization, and prepares the schema for future multi-repo packs:

- **Isolated `GM` Storage Keys (`UserJS.BookmarkletToolbar.*`):**
  - `LocalScripts` (`Record<string, LocalScript>`): User-created or converted scripts, completely untouched by pack updates.
  - `Pack.<packId>` (e.g., `Pack.chaban-bookmarklets`): One isolated object per pack (`{ version: string, scripts: Record<string, PackScript> }`) acting as that pack's `PackCache`.
  - `Layout` (`LayoutNode[]`): Single **global** tree stored in `GM` storage and filtered at render time by each script's `match` patterns (non-matching scripts and empty folders are hidden on the current site).
  - `Recents` (`Record<string, { lastRunAt: number, count: number }>`): Keyed by `scriptId` to rank recently/frequently used scripts in the Command Palette.
  - `Settings` (`{ hotkey?: string }`): User preferences.
- **Script Entry Shape (`PackScript` & `LocalScript`):**
  - `id`: Stable string identifier (e.g., `pack:chaban/approve_all_edits` or `local:<uuid>`).
  - `source`: `'pack:chaban-bookmarklets'` (v1 bundled) or `'local'`.
  - `name`: Display name.
  - `description`: Optional short summary (shown in library/palette).
  - `match`: Non-empty array of URL `@match`-style patterns (following [Violentmonkey `@match` syntax](https://violentmonkey.github.io/api/matching/), including `*.domain` matching both subdomains and the apex domain) determining which sites/pages the script applies to. Empty arrays are not treated as "match all."
  - `code`: JavaScript source (supporting `javascript:...` or raw JS, normalized before execution).
  - `removed?`: Boolean (`true` when a previously synced pack script is missing from a newer pack version).
- **Layout Node Shape (`LayoutNode`):**
  - Root array of items:
    - `{ type: 'script', scriptId, label? }` (renders as a one-click root button; `label` overrides the script's default `name`)
    - `{ type: 'folder', id, name, items: [{ type: 'script', scriptId, label? }] }` (renders as a folder dropdown)
- **JSON Export / Import Envelope:**
  - `{ version: 1, exportedAt: string, scripts: Record<string, LocalScript>, layout: LayoutNode[] }` — exports `LocalScripts` and `Layout` (preserving `scriptId` references to pack scripts without duplicating pack code).
- **Pack Snapshot & Merge Behavior (`Pack.<packId>`):**
  - On pack update (when bundled `version` differs from `Pack.<packId>.version`), bundled `PackScript` entries are synced into `Pack.<packId>.scripts`: new scripts are added, existing scripts are updated (clearing `removed` if a previously removed ID returns).
  - For scripts missing from the new pack: **unplaced** scripts (not in `Layout`) are dropped silently; **placed** scripts (in `Layout`) are kept and flagged `removed: true`.
  - `LocalScripts`, `Layout`, `Recents`, and other `Pack.*` objects remain untouched during pack updates.
  - Flagged `removed: true` scripts remain usable on the toolbar/palette (so nothing breaks mid-workflow) and trigger a subtle indicator dot on the Manager button plus a `[removed from pack]` badge in the Manager with actions to **Convert to local script** (moving/cloning into `LocalScripts` and updating `Layout`) or **Remove fully** (deleting from `Layout` and `Pack.<packId>`).

### 5.2 UI Components (Shadow DOM)

1. **Toolbar:**
   - Only mounts when at least one **Toolbar-Placed** script (Pinned or inside a Folder) matches the current URL. Renders the user's matching Pinned buttons and non-empty Folder dropdowns, plus a compact **Command Palette (`⌘`)** button.
   - Folder dropdowns open on click, execute the chosen script on click, and close automatically.
2. **Command Palette:**
   - Opened via the Toolbar `⌘` button, `GM.registerMenuCommand`, or keyboard shortcut.
   - Displays a search input, recently run matching scripts at the top, all matching scripts (Pack + Local) below, and a searchable/clickable **Open Settings / Manager** action. Each row places the source badge (`<packId>` / `Local` / `command`) inline next to the title (matching Library cards) so the title and description keep full row width. Supports keyboard navigation (`ArrowUp`, `ArrowDown`, `Enter`, `Escape`).
3. **Manager Modal (Merged Sticky Toolbar Strip + Library):**
   - Opens as a centered modal overlay over the host page (via the Command Palette or `GM.registerMenuCommand`).
   - **Sticky Toolbar Strip & Folder Drawer:** Top of the Manager displays a WYSIWYG horizontal **Toolbar** strip (showing Pinned buttons, Folders, and an inline `+ Folder` pill that turns into an input right inside the strip). Users drag items horizontally to reorder, drop Library scripts onto the Toolbar or onto **either** a Folder pill or its open Folder drawer (with single-target drop highlighting—never double-highlighting both parent and child), double-click a button to customize its Toolbar label, click `★` on a Pinned button to unpin it from the Toolbar, and click a Folder pill to open its drawer. Inside the Folder drawer, users manage the folder (double-click the folder title for inline rename, `🗑` delete) and have full parity with the Toolbar strip on folder items (drag chips horizontally to reorder within the folder, double-click a chip to relabel inline, `☆` to pin directly to Toolbar, `×` to remove from Folder)—keeping the Toolbar strip itself free of extra folder-management icons.
   - **Scrollable Library:** Searchable list/grid of all Pack and Local scripts with a "Matching current site" filter, a compact Packs badge (`Pack v<version> ⓘ` for 1 pack or `Packs (N) ⓘ` when multiple packs are installed, listing each pack's name, version, description, script count, and homepage in a popover), aligned leading star/status slot (`☆`/`★` pin toggle or `⚠` indicator for `removed: true`), drag handle (`⠿`), touch-friendly `ⓘ` info popover placed inline right after the script title (showing source pack name/version, `description`, and full `@match` list), source pack badge (`<packId>` or `Local`), a clickable `📁 <Folder>` status badge when placed in a folder (opens that folder's drawer above), and right-aligned per-script actions only where applicable (`✎`/`🗑` for Local Scripts, `Convert`/`🗑` for `removed: true` pack scripts). Removing any per-card folder dropdown keeps every Library card uncluttered and ensures folder and toolbar assignment follow one consistent Drag & Drop flow onto the sticky Toolbar/Folder area above.
   - **Editor Modal:** Create or edit Local Scripts (`name`, optional `description`, `match` patterns, `code`). Requires at least one explicit `@match` pattern (pre-filled with the current site's origin), includes quick-fill buttons (**Prefill current site** and **Prefill all sites**), and links to [match pattern syntax docs](https://violentmonkey.github.io/api/matching/).
   - **Shortcut & Import / Export:** Configurable Command Palette keyboard shortcut (`Settings.hotkey`) in the Manager, plus clean **Export** (Download `.json` + Copy JSON + selectable preview) and **Import** (Choose `.json` file + Paste Clipboard + paste textarea, clearly labeled **Replace** semantics replacing existing `LocalScripts` and `Layout`).
4. **UI Design System (Consistency Rules):**
   - **Icon Grammar:** `★`/`☆` exclusively means Toolbar pinning/unpinning (used identically in Library, Toolbar pills, and Folder items); `×` non-destructively removes an item from a Folder (or closes a modal header); `✎` edits/renames; `🗑` performs any destructive delete (Local Script, Folder, or removing an orphaned `removed: true` pack script); `ⓘ` sits inline after titles/badges and opens supplementary info (desktop hover + mobile click/tap).
   - **Delete Confirmation:** All destructive `🗑` actions (deleting a Local Script, Folder, or orphaned `removed: true` pack script) require an in-UI confirmation (two-step inline confirm or lightweight Shadow DOM confirm dialog—never `window.confirm()`).
   - **Shared Inline Edit Pill:** Creating a Folder (`+ Folder`), renaming a Folder (double-click folder title), and relabeling any Toolbar button or Folder item (double-click pill/chip) share one fixed-height (`28px`) inline input pill component (`Enter` saves, `Esc` cancels) to eliminate layout shift and visual drift.
   - **Unified Modal Chrome:** Every modal keeps a single `×` close button anchored strictly in the top-right corner of the title bar (never wrapped below the heading by action buttons; `Esc` also closes), with modal action controls placed either in a separate action row or the footer.
   - **Truthful Drag-and-Drop Feedback:** Visual drag affordances must strictly match drop behavior. Hovering reorderable Toolbar pills (Scripts or Folders) or Folder drawer chips renders a high-contrast left/right vertical insertion bar centered in the gap based on the cursor's horizontal half. Dragging a Script onto a different Folder pill or open Folder drawer highlights it as a folder target; hovering a script chip over itself or its own parent Folder pill stays a neutral no-op (never showing a nesting error). Dragging a Folder over another Folder pill shows left/right Toolbar reorder anchors (never folder-nesting highlight), while dragging a Folder over an open Folder drawer or its chips sets `dropEffect = 'none'`, shows zero drop highlight, and indicates that folders cannot be nested.

### 5.3 Site Mount Adapters

- **General Mounting Rule:** Across all adapters, the Toolbar UI only mounts when at least one **Toolbar-Placed** script (Pinned or inside a Folder) matches the current URL—so unpinned Library scripts or `*` utilities never clutter pages where nothing is placed on the Toolbar. The Command Palette and Manager remain accessible everywhere via `GM.registerMenuCommand` and the palette hotkey (including on first run before any scripts are pinned).
- **Adapter Interface:** `{ id, matches(url), mount(toolbarEl), unmount() }`
- **`musicbrainz` Adapter (v1 primary):** Targets `musicbrainz.org`, `beta.musicbrainz.org`, `musicbrainz.eu` (and mirrors). Injects the Shadow DOM host into the available horizontal space in `div.header` without disturbing existing navigation or search controls.
- **`fallback` Adapter (extensible):** For non-MusicBrainz sites, mounts as an unobtrusive, collapsible floating dock/pill so it never blocks site UI.

### 5.4 Script Execution

- Strip `javascript:` prefix (and URL-decode if needed) before execution.
- Execute in page context (e.g., via injected `<script>` element or page-context function evaluation) so scripts have direct access to `window` globals like `MB._releaseEditor` and `document`.
- Wrap execution in `try/catch` and surface errors via `[Bookmarklet Toolbar]` console warnings and a non-blocking toast/indicator in the Shadow DOM.

### 5.5 Documentation

- **In-UI Help:** Link to [Violentmonkey `@match` syntax](https://violentmonkey.github.io/api/matching/) directly next to the Editor's `match` field, plus clear inline hints for pasting `javascript:...` URLs.
- **User & Contributor Docs (README / Greasy Fork description):** Document the JSON import/export schema, page-context execution & CSP limitations on strict sites, and the Site Mount Adapter interface for adding new site integrations.

### 5.6 Pack Manifest Format (`bookmarklets.json`)

Lives in the source bookmarklets repository (`d:\Documents\git\bookmarklets\bookmarklets.json`, or generated and published there during its build step). Consumed by the build-time pack bundler in `userscripts/tools/` via its published HTTPS URL in CI (or local `../bookmarklets/bookmarklets.json` during development), and designed to work unchanged for future runtime remote repo syncing:

```json
{
  "schemaVersion": 1,
  "id": "chaban-bookmarklets",
  "name": "MusicBrainz Bookmarklets",
  "version": "2026.11.17",
  "description": "Collection of MusicBrainz and music-site bookmarklets",
  "homepage": "https://github.com/chaban-mb/bookmarklets",
  "scripts": [
    {
      "id": "approve_all_edits",
      "name": "Approve all edits",
      "label": "Approve All",
      "description": "Approve all edits on current page (requires POWER-VOTE).",
      "match": ["*://*.musicbrainz.org/*"],
      "code": "document.querySelectorAll('a.positive[href*=approve]').forEach(el=>el.click());",
      "folder": "Edit"
    }
  ]
}
```

- `id` (root) scopes the pack storage key (`Pack.<id>`) and namespaces each script's runtime ID (`pack:<packId>/<script.id>`).
- `version` triggers pack diffing when changed.
- `scripts[].code` is the inline JavaScript payload (compiled/inlined by the pack's build process for atomic single-request loading).
- `scripts[].label` (optional short toolbar text) and `scripts[].folder` (optional suggested folder hint) never force toolbar placement—pack scripts start unpinned in the Library.

---

## 6. Left to the Builder

- Exact MusicBrainz `div.header` DOM insertion point, CSS rules, and overflow/narrow-viewport handling to sit cleanly alongside `mb. STICKY HEADER` without disrupting MusicBrainz's own menu or impairing the site.
- Default `@match` patterns for each script in the initial `chaban-bookmarklets` pack imported from `d:\Documents\git\bookmarklets`.
- Pack mapping rules for non-1:1 files in `d:\Documents\git\bookmarklets\src\`:
  - Expand `open_in_harmony.js`, `sambl_artist.js`, and `convert_to_sambl_links.js` into **both** variants (same-tab and `(new tab)`).
  - From `entity_subpage_transformers.js`, include **only `universalSwitcher`** (the remaining IIFEs stay in source for reference; note to add `universalSwitcher` to `bookmarklets/README.md` later).
- Exact default keyboard shortcut for the Command Palette (avoiding conflicts with browser/MusicBrainz shortcuts; user-configurable via `Settings.hotkey`).
- Build-time sync script in `userscripts/tools/` that consumes `bookmarklets.json` from its published HTTPS URL in GitHub Actions or from `../bookmarklets/bookmarklets.json` locally (plus an initial generator/helper in `bookmarklets` to emit `bookmarklets.json` from `src/*.js`), updating the bundled pack in `userscripts` without editing `dist/` directly.
- CSP-safe execution fallback details for sites that restrict inline `<script>` injection.

---

## 7. Future Roadmap (TODO)

- **Runtime Remote Repo Sync:**
  - Add `@grant GM.xmlHttpRequest` and a multi-repo subscription UI in the Manager so users can subscribe to external repositories publishing a `bookmarklets.json` manifest (Section 5.6).
  - Fetch remote `bookmarklets.json` manifests (1 atomic HTTP request per repo), syncing into isolated `Pack.<packId>` storage keys with manual/periodic refresh and the same `removed: true` merge behavior.
- **Fallback Dock Polish (non-MusicBrainz sites):**
  - Collapsible/minimizable and repositionable floating dock controls so it never obscures player/navigation UI on external sites.
- **Optional Author Mode / Pack Forking & Recycle Bin:**
  - Author Mode toggle to reveal advanced editing features (such as duplicating/forking a Pack script into a Local Script).
  - Soft-delete Recycle Bin if users ever want undo beyond delete confirmation.

---

## 8. Glossary

Canonical terms used across this spec, the codebase, and user-facing docs:

| Term | Definition |
| --- | --- |
| **Pack (`PackScript`)** | Read-only collection of bookmarklets bundled at build time (or, in the future, synced from a remote repo). |
| **Local Script (`LocalScript`)** | User-created or converted bookmarklet stored in `GM` storage and editable in the Manager. |
| **Library** | The combined catalog of all `PackScript` and `LocalScript` entries, browsable in the Manager and Command Palette regardless of Toolbar placement. |
| **Toolbar** | The top-level horizontal bar rendered on matching sites (and previewed at the top of the Manager), holding **Pinned** buttons, **Folders**, and the Command Palette trigger. |
| **Toolbar-Placed** | Any script referenced in `Layout` (either **Pinned** directly on the **Toolbar** or inside a **Folder**). Only Toolbar-Placed scripts trigger Toolbar/dock mounting. |
| **Pinned (Toolbar Button)** | A script placed directly on the **Toolbar** (outside any Folder) for immediate one-click execution. |
| **Folder** | A single-level dropdown group on the **Toolbar** containing Toolbar-Placed scripts. |
| **Layout (`LayoutNode[]`)** | The user's single global tree of **Toolbar** buttons and **Folders**, filtered at render time by each script's `@match` patterns. |
| **PackCache (`Pack.<packId>`)** | Isolated `GM` storage snapshot of a pack's `PackScript` entries, used to detect removed pack scripts and offer **Convert to local script** or **Remove fully**. |
| **Site Mount Adapter** | Pluggable module (`{ id, matches, mount, unmount }`) that attaches the Shadow DOM Toolbar to a specific site's UI (e.g., `musicbrainz` in `div.header`) or the `fallback` floating dock. |
| **Command Palette** | Keyboard/button-triggered search overlay showing recently run and matching scripts from the entire **Library**. |
