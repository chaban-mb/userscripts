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
  - **Symptom:** Dock and overlays render completely unstyled under strict `style-src 'self'` CSP, logging `Applying inline style violates ... 'style-src 'self' ...'` at `mount`.
  - **Confirmed cause:** `lib/BookmarkletToolbarUI.js:2837, 3514` injects `<style>` elements into `toolbarShadow` / `overlayShadow`; when `fallbackAdapter.mount` (`lib/BookmarkletToolbarAdapters.js:60`) calls `container.appendChild(hostEl)`, Blink evaluates the connected Shadow DOM `<style>` tag and blocks it (`style-src-elem`). (Verified in Headless Chrome under `style-src 'self'`: `<style>` and `setAttribute('style', ...)` are blocked, whereas `adoptedStyleSheets` and CSSOM property setters succeed; see [csp-shadow-dom-gm-styles.md](../research/csp-shadow-dom-gm-styles.md).)
  - **Fix:** Adopt Shadow DOM constructable stylesheets (`new CSSStyleSheet()` + `replaceSync(css)` + `shadowRoot.adoptedStyleSheets = [sheet]`, with `<style>` fallback only where `CSSStyleSheet`/`adoptedStyleSheets` is unavailable), move `hostEl` positioning into `:host([data-snap="..."])` rules (avoiding `setAttribute('style')`/`cssText`), and verify under a strict `style-src 'self'` Headless Chrome E2E scenario.
  - **GM API Tradeoffs Note:** See [docs/research/csp-shadow-dom-gm-styles.md](../research/csp-shadow-dom-gm-styles.md) — `GM.addStyle` cannot target `ShadowRoot` internals; `GM.addElement(shadowRoot, 'style', ...)` bypasses CSP in Violentmonkey/Tampermonkey at the cost of adding `@grant GM.addElement`; `adoptedStyleSheets` works natively in Chrome 73+/Firefox 101+/Safari 16.4+ with zero extra `@grant`.

- [ ] **11. Fix bookmarklet `script-src` CSP execution block on strict sites** *(e.g. Spotify `script-src 'self' 'unsafe-eval' blob:`)*
  - **Symptom:** Running `"Open current page in Harmony"` (or any script) fails with `Executing inline script violates the following Content Security Policy directive 'script-src ...'` when `'unsafe-inline'` is absent.
  - **Confirmed cause:** `executeScriptInPage` (`lib/BookmarkletToolbarAdapters.js:216-241`) only attempts inline `<script>` injection (`scriptEl.textContent = scriptPayload; mountContainer.appendChild(scriptEl)`).
  - **Fix options to evaluate/combine:**
    - **Blob URL `<script src="blob:...">` fallback** (`URL.createObjectURL(new Blob([code], { type: 'text/javascript' }))`, with Trusted Types `createScriptURL` if `trustedTypes` is enforced, revoked on load/error): works on sites allowing `blob:` (like Spotify) with zero extra `@grant`.
    - **`GM.addElement('script', { textContent })`** (when granted/available in Violentmonkey/Tampermonkey): bypasses strict `script-src` even when `blob:` is disallowed (e.g., GitHub), at the cost of `@grant GM.addElement` (could also pair with `adoptedStyleSheets` / CSP fallback from #10).
    - **Fallback chain:** Inline `<script>` (or `GM.addElement` if granted) → `blob:` URL `<script>` if inline is blocked by CSP → report clear CSP error if both are blocked.

---

## Batch 2: Manager Visibility, Portrait Layout & Highlighting (Medium Scope)

- [ ] **12. Configurable default dock visibility (Shown vs Hidden by default)** *(Item #2)*
  - **Goal:** Beyond hiding the dock per site (`dockSiteHidden`), let users choose globally whether the dock is **shown (collapsed `[⚡]`)** or **hidden** by default on sites that have matching placed scripts, with per-origin overrides.
  - **Design questions to settle:**
    - Schema migration: replace or complement `dockSiteHidden` with `dockDefaultVisible: boolean` (`true` vs `false`) + per-origin override map (`dockSiteVisibility: { [origin]: 'shown' | 'hidden' }` or keep `dockSiteHidden` / `dockSiteShown`).
    - Mobile discoverability when default is hidden (GM menu command `Toggle Dock on This Site` + Command Palette).

- [ ] **13. Highlight matching scripts / dim non-matching scripts in Manager** *(Item #4)*
  - **Goal:** Keep the full global tree (`Toolbar Layout`, `Folder Drawer`, and `Library`) visible while visually highlighting scripts matching the active site and fading non-matching scripts, instead of relying only on hiding via `"Matching current site"`.
  - **Design questions to settle:**
    - Whether `"Matching current site"` becomes a 2-state or 3-state control (`All` | `Highlight matching` | `Only matching`), or defaults to always highlighting matching + dimming non-matching in both `Toolbar Layout` pills and `Library` cards.

- [ ] **14. Portrait Manager vertical space: compact header & non-crowding sticky/folder drawer** *(Firefox Mobile portrait)*
  - **Symptom:** In portrait mode, the multi-row Manager header (`+ New Local Script`, `Export`, `Import`, `Shortcut`, `Dock expand`, `Orientation`, `Hide dock`) plus `.bt-sticky-section` (especially with an open `Edit (9)` `.bt-folder-drawer`) consumes ~85% of the height and squishes the Library down to 1 card.
  - **Design questions to settle:**
    - Disable `position: sticky` on `.bt-sticky-section` below a height/portrait threshold (so the whole `.bt-manager-body` scrolls naturally while keeping `.bt-folder-drawer` capped/scrollable) vs moving secondary settings behind `⚙` Settings sub-modal (connecting with Batch 3 / deferred `#4`).

- [ ] **15. Configurable keep-folder-open after running a script** *(multi-step script chaining)*
  - **Goal:** Optionally keep an open toolbar folder `.bt-dropdown` (and `More »` menu) open after clicking/running a script inside it so users can chain sequential scripts without reopening the folder each time.
  - **Confirmed cause:** `triggerRunScript(scriptId)` (`lib/BookmarkletToolbarUI.js:2820`) unconditionally calls `closeToolbarDropdown()`.
  - **Design questions to settle:**
    - Global setting (`settings.keepFolderOpenAfterRun`, e.g. in Settings) vs per-folder pin/toggle inside the dropdown header (or both), and whether auto-close (`false`) remains the default.

- [ ] **16. Configurable hover-to-open for toolbar folders** *(and `More »`)*
  - **Goal:** Allow opening toolbar folder dropdowns (and optionally `More »`) on hover instead of requiring a click.
  - **Design notes:** Add a short hover-intent delay (~120ms) before opening/switching folders so moving across neighboring buttons doesn't flicker menus, and close cleanly on leave (respecting the dock hover grace delay in #17).

- [ ] **17. Hover-expand collapse grace delay & expanded hit buffer** *(Hover usability)*
  - **Symptom:** In `Hover` / unpinned `Hover + Click` mode, keeping the cursor strictly inside the thin pill area is finicky — slipping slightly outside the edge immediately collapses the dock.
  - **Recommended UX solution:** Combine a **350–450ms `mouseleave` collapse grace timeout** (cancelled if `mouseenter` re-enters the dock or an open dropdown) with a modest **invisible `10–14px` hover buffer** around the **expanded** dock only (never when collapsed, so it doesn't block underlying page links).

---

## Batch 3: Expanded Command Palette Actions & Settings UX (Needs Design)

- [ ] **18. Expose Manager actions & multi-state settings in Command Palette** *(Item #6)*
  - **Goal:** Trigger `Import`, `Export`, `New Local Script`, `Hotkey`, `Dock expand` (`Hover + Click` / `Click` / `Hover`), `Orientation` (`Auto` / `Horizontal` / `Vertical`), and `Dock position` directly from the Command Palette.
  - **Design questions to settle:**
    - **Sub-modal vs direct modal:** Should `"Settings"` open a dedicated Settings sub-modal (connecting with deferred `#4` `⚙` Settings button in [2026-11-21-manager-ux-polish-design.md](2026-11-21-manager-ux-polish-design.md)) vs opening Import/Export/Editor modals directly?
    - **Multi-state settings in Command Palette:** Cycle-on-Enter (`Orientation: Auto → Horiz → Vert`) vs nested/inline choice items (`Set Orientation: Auto`, `Set Orientation: Horizontal`, `Set Orientation: Vertical`) vs a Command Palette sub-view.
