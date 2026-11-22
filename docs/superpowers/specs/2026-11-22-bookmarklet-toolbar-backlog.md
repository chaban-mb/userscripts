# Site Bookmarklet Toolbar — Systematic Improvement Backlog

Created: 2026-11-22  
Related specs:

- [2026-11-21-manager-ux-polish-design.md](2026-11-21-manager-ux-polish-design.md) (also tracks deferred `#4`: decluttering Manager header behind a `⚙` Settings sub-modal)
- [2026-11-21-dock-expansion-overflow-design.md](2026-11-21-dock-expansion-overflow-design.md)

---

## Batch 1: Quick Fixes & Polish (Low Risk, No Open UX Decisions)

- [ ] **1. Isolate input keystrokes from host-page listeners**
  - **Symptom:** Sites with global `keydown`/`keyup`/`keypress` shortcuts intercept typing inside script/search/editor inputs.
  - **Root cause:** `lib/BookmarkletToolbarUI.js` inputs inside `overlayHost` do not stop `keydown`/`keyup`/`keypress` propagation before events bubble out of the Shadow DOM to host `window`/`document` listeners.
  - **Fix:** Stop propagation of keyboard events (`keydown`, `keyup`, `keypress`) originating from text inputs/textareas inside `overlayHost` (preserving modal `Escape` / hotkey handling inside `handleKeydown`).

- [ ] **2. Dock outer button corner/padding polish** *(Item #7)*
  - **Symptom:** Outermost rectangular button (`border-radius: 4px`, e.g. `Edit ▾`) tangentially touches the `border-radius: 9999px` capsule edge of `.bt-toolbar-dock` (`padding: 4px`).
  - **Root cause:** `lib/BookmarkletToolbarUI.js:412-465, 646` pairs sharp `4px` button corners with `4px` capsule padding inside a `9999px` rounded shell.
  - **Fix:** Give horizontal dock `.bt-btn-dark` pill-matched rounding (e.g. `border-radius: 9999px` or `12px`) and/or increase capsule horizontal padding (`padding: 4px 8px` or `padding-inline: 8px` on item bars) while preserving `0px` `[⚡]` anchor alignment.

- [ ] **3. Command Palette: match `"command"` / `"action"` queries** *(Item #3)*
  - **Symptom:** Typing `"command"` (or `"action"`) in the Command Palette matches the badge visually but filters out `Actions` (`kind: 'command'`) rows.
  - **Root cause:** `renderPaletteView()` (`lib/BookmarkletToolbarUI.js:4678-4715`) checks custom keyword strings per command (`settings manager...`, `hide show dock...`) without matching `'command'` / `'action'` or the `Command` badge text.
  - **Fix:** Include `'command action'` (and badge/group labels) in command item search matching.

- [ ] **4. Command Palette: remove `@match` fallback in description line** *(Item #5)*
  - **Symptom:** Command Palette shows `@match` patterns under some scripts (e.g. local scripts or pack scripts lacking a description) and not others.
  - **Confirmed cause:** `lib/BookmarkletToolbarUI.js:4780` does `descLine.textContent = s.description || s.match.join(', ');`.
  - **Fix:** Render `s.description` only when non-empty and omit `descLine` when a script has no description.

- [ ] **5. Command Palette: show pack name/origin alongside type** *(Item #8)*
  - **Symptom:** When a single pack is installed (`packCount === 1`), the Command Palette badge only says `Pack` instead of identifying which pack/origin it comes from.
  - **Confirmed cause:** `lib/BookmarkletToolbarUI.js:4772-4777` collapses `badgeText` to `'Pack'` whenever `packCount <= 1`.
  - **Fix:** Show `packMeta?.name || s.packId` (or `Pack: <name>`) clearly on palette script badges (and evaluate whether Library card badges should stay consistent).

- [ ] **6. Skip iframe / sub-frame injection** *(Jira Dashboard gadgets, etc.)*
  - **Symptom:** On sites with embedded same-origin/matched iframes (e.g., `https://tickets.metabrainz.org/secure/Dashboard.jspa` gadgets), the dock is injected inside each iframe as well as the top-level page.
  - **Confirmed cause:** `src/Site Bookmarklet Toolbar.user.js` lacks `// @noframes` in its userscript header and lacks a `win.top && win.self !== win.top` guard.
  - **Fix:** Add `// @noframes` to `src/Site Bookmarklet Toolbar.user.js` (plus an early `win.self !== win.top` runtime guard).

---

## Batch 2: Manager Visibility & Default Dock Policy (Medium Scope)

- [ ] **6. Configurable default dock visibility (Shown vs Hidden by default)** *(Item #2)*
  - **Goal:** Beyond hiding the dock per site (`dockSiteHidden`), let users choose globally whether the dock is **shown (collapsed `[⚡]`)** or **hidden** by default on sites that have matching placed scripts, with per-origin overrides.
  - **Design questions to settle:**
    - Schema migration: replace or complement `dockSiteHidden` with `dockDefaultVisible: boolean` (`true` vs `false`) + per-origin override map (`dockSiteVisibility: { [origin]: 'shown' | 'hidden' }` or keep `dockSiteHidden` / `dockSiteShown`).
    - Mobile discoverability when default is hidden (GM menu command `Toggle Dock on This Site` + Command Palette).

- [ ] **7. Highlight matching scripts / dim non-matching scripts in Manager** *(Item #4)*
  - **Goal:** Keep the full global tree (`Toolbar Layout`, `Folder Drawer`, and `Library`) visible while visually highlighting scripts matching the active site and fading non-matching scripts, instead of relying only on hiding via `"Matching current site"`.
  - **Design questions to settle:**
    - Whether `"Matching current site"` becomes a 2-state or 3-state control (`All` | `Highlight matching` | `Only matching`), or defaults to always highlighting matching + dimming non-matching in both `Toolbar Layout` pills and `Library` cards.

---

## Batch 3: Expanded Command Palette Actions & Settings UX (Needs Design)

- [ ] **8. Expose Manager actions & multi-state settings in Command Palette** *(Item #6)*
  - **Goal:** Trigger `Import`, `Export`, `New Local Script`, `Hotkey`, `Dock expand` (`Hover + Click` / `Click` / `Hover`), `Orientation` (`Auto` / `Horizontal` / `Vertical`), and `Dock position` directly from the Command Palette.
  - **Design questions to settle:**
    - **Sub-modal vs direct modal:** Should `"Settings"` open a dedicated Settings sub-modal (connecting with deferred `#4` `⚙` Settings button in [2026-11-21-manager-ux-polish-design.md](2026-11-21-manager-ux-polish-design.md)) vs opening Import/Export/Editor modals directly?
    - **Multi-state settings in Command Palette:** Cycle-on-Enter (`Orientation: Auto → Horiz → Vert`) vs nested/inline choice items (`Set Orientation: Auto`, `Set Orientation: Horizontal`, `Set Orientation: Vertical`) vs a Command Palette sub-view.
