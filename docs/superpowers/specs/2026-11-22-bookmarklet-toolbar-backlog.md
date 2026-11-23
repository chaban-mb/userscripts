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

- [ ] **7. Fix horizontal `*-center` dock overflow/bleeding on mobile** *(Firefox Mobile `top-center`)*
  - **Symptom:** Scripts in `.bt-dock-items-bar` overflow and bleed right out of the dark pill capsule and past the viewport edge instead of triggering `More »`.
  - **Confirmed cause:** `.bt-dock-items-bar` (`lib/BookmarkletToolbarUI.js:447-464`) uses `position: absolute; left: 50%; translate: -50% 0; width: max-content;` inside the `~36px` `position: relative` `.bt-dock-center` wrapper, which causes CSS shrink-to-fit / containing-block width clamping around `~50vw` and mismatches `partitionDockOverflow` budget (especially on non-viewport-meta sites like MusicBrainz on Firefox Mobile).
  - **Fix:** Anchor `.bt-dock-items-bar` against a full-viewport-width container (e.g. `position: fixed` or `inset-inline: 0; margin-inline: auto; width: fit-content; max-width: calc(100vw - 24px)`) and measure `partitionDockOverflow` against the true layout/visual viewport width (`min` of `100vw` and measured container budget).

- [ ] **8. Fix sub-modals (`Add Local Script`, `Export`, `Import`) clipped offscreen at bottom** *(Firefox Mobile)*
  - **Symptom:** Sub-modals open near the lower half of the screen with `Code` / `Save` cut off below the bottom browser toolbar.
  - **Confirmed cause:** `.bt-backdrop` / `.bt-backdrop-sub` (`lib/BookmarkletToolbarUI.js:1088-1124`) uses `align-items: center`, which on tall non-viewport-meta pages in Firefox Mobile centers the sub-modal vertically inside the taller layout viewport rather than keeping it at the top like `#manager-backdrop` (`align-items: flex-start; padding-top: 16px`), and `.bt-form-body` lacks `overflow-y: auto`.
  - **Fix:** Top-align sub-modal backdrops (`align-items: flex-start; padding-top: 16px; overflow-y: auto`) and allow `.bt-form-body` to scroll (`overflow-y: auto; min-height: 0`) inside `.bt-modal`.

- [ ] **9. Fix mobile touch double-toggle when tapping dock handle (`[⚡]`)** *(Firefox Mobile)*
  - **Symptom:** Tapping `[⚡]` expands the dock reliably, but tapping `[⚡]` again to close takes multiple tries (only closing when tapped in quick succession).
  - **Confirmed cause:** `attachDockHandleDrag` (`lib/BookmarkletToolbarUI.js:2640-2769`) calls `toggleDockPinnedExpanded()` inside `onPointerUp` (rebuilding `handleBtn` at the exact same `0px`-shifted coordinates) while resetting `suppressNextHandleClick` via `setTimeout(..., 0)`. On Firefox Mobile, the synthesized compatibility `click` fires after `setTimeout(0)` expires, hits the recreated `handleBtn`, and toggles the dock right back open.
  - **Fix:** Let `click` be the sole toggle path for taps (`!wasDragging`) instead of calling `toggleDockPinnedExpanded()` in `onPointerUp`, and only set `suppressNextHandleClick` (with a `~400ms` window) when `wasDragging === true`.

- [ ] **10. Fix CSP `style-src 'self'` violations on strict MusicBrainz account pages** *(e.g. `/account/edit`, `/account/preferences`)*
  - **Symptom:** Dock and overlays render completely unstyled under strict `style-src 'self'` CSP, logging `Applying inline style violates ... 'style-src 'self' ...'`.
  - **Confirmed cause:** `lib/BookmarkletToolbarAdapters.js:20, 60` (`applyInlineStyles` calling `el.style.cssText = ...`) and `lib/BookmarkletToolbarUI.js:2837, 3514` (injecting `<style>` elements into `toolbarShadow` / `overlayShadow`) both trigger `'unsafe-inline'` CSP violations, alongside any `style.cssText` assignments.
  - **Fix:** Adopt Shadow DOM constructable stylesheets (`new CSSStyleSheet()` + `replaceSync(css)` + `shadowRoot.adoptedStyleSheets = [sheet]`, with `<style>` fallback only if `CSSStyleSheet`/`adoptedStyleSheets` is unavailable), replace `el.style.cssText` in `Adapters` and `UI` with attribute/class selectors (`:host([data-snap="..."])`) or CSSOM property updates verified under a strict `style-src 'self'` Headless Chrome E2E scenario.

---

## Batch 2: Manager Visibility, Portrait Layout & Highlighting (Medium Scope)

- [ ] **9. Configurable default dock visibility (Shown vs Hidden by default)** *(Item #2)*
  - **Goal:** Beyond hiding the dock per site (`dockSiteHidden`), let users choose globally whether the dock is **shown (collapsed `[⚡]`)** or **hidden** by default on sites that have matching placed scripts, with per-origin overrides.
  - **Design questions to settle:**
    - Schema migration: replace or complement `dockSiteHidden` with `dockDefaultVisible: boolean` (`true` vs `false`) + per-origin override map (`dockSiteVisibility: { [origin]: 'shown' | 'hidden' }` or keep `dockSiteHidden` / `dockSiteShown`).
    - Mobile discoverability when default is hidden (GM menu command `Toggle Dock on This Site` + Command Palette).

- [ ] **10. Highlight matching scripts / dim non-matching scripts in Manager** *(Item #4)*
  - **Goal:** Keep the full global tree (`Toolbar Layout`, `Folder Drawer`, and `Library`) visible while visually highlighting scripts matching the active site and fading non-matching scripts, instead of relying only on hiding via `"Matching current site"`.
  - **Design questions to settle:**
    - Whether `"Matching current site"` becomes a 2-state or 3-state control (`All` | `Highlight matching` | `Only matching`), or defaults to always highlighting matching + dimming non-matching in both `Toolbar Layout` pills and `Library` cards.

- [ ] **11. Portrait Manager vertical space: compact header & non-crowding sticky/folder drawer** *(Firefox Mobile portrait)*
  - **Symptom:** In portrait mode, the multi-row Manager header (`+ New Local Script`, `Export`, `Import`, `Shortcut`, `Dock expand`, `Orientation`, `Hide dock`) plus `.bt-sticky-section` (especially with an open `Edit (9)` `.bt-folder-drawer`) consumes ~85% of the height and squishes the Library down to 1 card.
  - **Design questions to settle:**
    - Disable `position: sticky` on `.bt-sticky-section` below a height/portrait threshold (so the whole `.bt-manager-body` scrolls naturally while keeping `.bt-folder-drawer` capped/scrollable) vs moving secondary settings behind `⚙` Settings sub-modal (connecting with Batch 3 / deferred `#4`).

---

## Batch 3: Expanded Command Palette Actions & Settings UX (Needs Design)

- [ ] **12. Expose Manager actions & multi-state settings in Command Palette** *(Item #6)*
  - **Goal:** Trigger `Import`, `Export`, `New Local Script`, `Hotkey`, `Dock expand` (`Hover + Click` / `Click` / `Hover`), `Orientation` (`Auto` / `Horizontal` / `Vertical`), and `Dock position` directly from the Command Palette.
  - **Design questions to settle:**
    - **Sub-modal vs direct modal:** Should `"Settings"` open a dedicated Settings sub-modal (connecting with deferred `#4` `⚙` Settings button in [2026-11-21-manager-ux-polish-design.md](2026-11-21-manager-ux-polish-design.md)) vs opening Import/Export/Editor modals directly?
    - **Multi-state settings in Command Palette:** Cycle-on-Enter (`Orientation: Auto → Horiz → Vert`) vs nested/inline choice items (`Set Orientation: Auto`, `Set Orientation: Horizontal`, `Set Orientation: Vertical`) vs a Command Palette sub-view.
