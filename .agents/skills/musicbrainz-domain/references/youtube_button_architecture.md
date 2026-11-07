# YouTube Button Architecture & UI Integration

This document outlines the architecture, DOM hierarchy, and styling conventions for integrating native-styled buttons into YouTube's desktop Single Page Application (Polymer/Kevlar).

---

## 🏛️ Native YouTube Button DOM Structure

Modern YouTube buttons follow standard custom element classes (utilizing `.ytSpecButtonShapeNext*` in modern YouTube and `.yt-spec-button-shape-next*` for legacy):

```html
<div class="musicbrainz-button-renderer">
  <button class="ytSpecButtonShapeNextHost ytSpecButtonShapeNextTonal ytSpecButtonShapeNextMono ytSpecButtonShapeNextSizeM ytSpecButtonShapeNextIconLeading yt-spec-button-shape-next" aria-label="Label" title="Tooltip">
    <!-- Leading Icon -->
    <div class="ytSpecButtonShapeNextIcon ytSpecButtonShapeNextElevatedContent yt-spec-button-shape-next__icon" aria-hidden="true">
      <!-- Direct SVG Node created via createElementNS -->
    </div>
    <!-- Button Text -->
    <div class="ytSpecButtonShapeNextButtonTextContent ytSpecButtonShapeNextElevatedContent yt-spec-button-shape-next__button-text-content">
      <span class="ytAttributedStringHost ytAttributedStringWhiteSpaceNoWrap" role="text">Label</span>
    </div>
  </button>
</div>
```

> [!WARNING]
> **Polymer Custom Element Lifecycle**: Do **not** instantiate `<yt-button-shape>` or `<yt-icon>` using `document.createElement('yt-button-shape')`. These are registered Polymer/WebComponents elements on `youtube.com`. When instantiated outside of Polymer's internal data-binding pipeline, Polymer's `connectedCallback()` executes and resets/destroys light DOM children. Use standard `<div>` / `<span>` elements with YouTube's styling classes (`ytSpecButtonShapeNext*`).

For hyperlink navigation buttons, `<button>` is replaced with `<a target="_blank">`, maintaining the exact same class hierarchy.

---

## 🎨 Theme & Typography Integration

By utilizing `.yt-spec-button-shape-next`, buttons automatically inherit YouTube's global design tokens:

1. **Typography & Geometry**:
   - `height: 36px`
   - `border-radius: 18px`
   - `font-family: "Roboto", "Arial", sans-serif`
   - `font-size: 14px; font-weight: 500; line-height: 36px; letter-spacing: 0.2px;`
   - `padding: 0 16px` (or `0 14px 0 12px` with leading icon)

2. **CSS Variables & Color Modes**:
   - **Tonal Background**: `var(--yt-spec-badge-chip-background, rgba(0,0,0,0.05))` (light) / `rgba(255,255,255,0.1)` (dark).
   - **Tonal Text**: `var(--yt-spec-text-primary, #0f0f0f)` (light) / `#f1f1f1` (dark).
   - **Tonal Hover**: `var(--yt-spec-badge-chip-background-hover, rgba(0,0,0,0.1))` (light) / `rgba(255,255,255,0.2)` (dark).
   - **Brand Overrides**: Minimal modifier classes (e.g. `yt-spec-button-shape-next--brand-mb` with `#BA478F` and `yt-spec-button-shape-next--brand-lb` with `#EB743B`) applied to primary call-to-actions.

---

## ⚓ Dock Mounting Selectors & SPA Lifecycle

YouTube watch pages and channel headers mount dynamic action rows across Desktop (`www.youtube.com`) and Mobile (`m.youtube.com`):

| Location | Primary Selector | Fallback Selector | Context |
|---|---|---|---|
| **Watch Page Owner Row (Desktop & Mobile)** | `#top-row.ytd-watch-metadata #owner.ytd-watch-metadata, ytm-slim-video-action-bar-renderer .slim-video-action-bar-actions` | `#top-row.ytd-watch-metadata #actions.ytd-watch-metadata, ytm-slim-video-action-bar-renderer` | Sits next to the channel subscribe button on Desktop and inside the 32px slim action chip bar on Mobile. |
| **Channel Page Header (Desktop & Mobile)** | `yt-page-header-view-model yt-flexible-actions-view-model, yt-page-header-view-model subscribe-button-view-model, ytd-page-header-renderer #page-header-actions` | `ytd-page-header-renderer ytd-subscribe-button-renderer, ytd-c4-tabbed-header-renderer #buttons, #inner-header-container #buttons` | Channel banner / header action row (validating `getChannelAnchorElement(expectedTarget)` against header text/channelId to avoid docking onto an outgoing SPA channel header). |

### SPA Navigation Button Preservation (Zero Layout Shift)

1. **Desktop vs. Mobile DOM Persistence on SPA Navigation**:
   - On **Desktop** (`www.youtube.com`), `#owner.ytd-watch-metadata` remains connected (`isConnected === true`) throughout video-to-video SPA navigations; YouTube never unmounts the button container.
   - On **Mobile** (`m.youtube.com`), `.slim-video-action-bar-actions` is unmounted during skeleton loading (`anchorWaitMs: ~1000–2200 ms`) and re-mounted when the new watch metadata renders.

2. **Two-Phase In-Place Transition (`prepareForNavigation()` + `setPending(true)`)**:
   - **Phase 1 (`prepareForNavigation()` on URL change)**: Immediately strips `href` attributes from any `<a>` buttons, removes hidden `<input>` fields from `<form>`, unbinds previous `pointerdown`/`mousedown` invalidation listeners, and dims the existing button in-place (`opacity: 0.5`, `pointer-events: none`) without hiding (`display: none`) or changing its label/width.
   - **Phase 2 (In-place `setPending(true)` on MusicBrainz Cache Miss)**: If the button container is already visible (`isAlreadyVisible`), `setPending(true)` **must not** call `this.clear()` or overwrite the button label to `"Loading..."` (which would destroy `<a>` tags, flip button colors to grey `tonal`, and shrink button width by ~30px). Instead, it preserves the existing label, variant, and width at `opacity: 0.5` and swaps only the leading icon slot to `SVGIcons.spinner` using DOM-safe child removal (`while (activeBtn.firstChild) activeBtn.removeChild(activeBtn.firstChild)`), transitioning in a single atomic swap when the MusicBrainz lookup resolves.
   - **Cross-Page-Type Transitions (`Watch <-> Channel`)**: Do not call `.reset()` (`display: none`) on the outgoing page type's button manager at the start of navigation while the outgoing Polymer view is still visible during the red progress bar. Instead, call `prepareForNavigation()` on the outgoing manager and defer `.reset()` until the incoming page's buttons are ready to render.

3. **Touch & Mouse Cache Invalidation (`pointerdown` + `mousedown`)**:
   - Bind both `pointerdown` and `mousedown` (guarded by a single-execution `fired` flag and cleaned up via `removeEventListener` on reset/navigation) so cache invalidation triggers reliably on both desktop clicks (including middle-click) and mobile touch taps.

---

## 🧩 Reusable Component Pattern (`YTButton`)

Userscripts should encapsulate this structure into a modular factory (`YTButton`) supporting:
- Fluent updates (`update({ label, title, icon, variant, href, disabled })`)
- Form submissions (`<form method="get" action="..." target="_blank">`)
- State dimming on async lookup (`setPending(true)`)
- Clean reset and teardown across `yt-navigate-finish` events

---

---

## 🔒 Trusted Types & DOM Injection Rules
YouTube enforces strict **TrustedHTML** CSP policies on modern browsers:
- ❌ **Anti-pattern 1**: `element.innerHTML = ...` throws `TypeError: Failed to set the 'innerHTML' property on 'Element': This document requires 'TrustedHTML' assignment.`
- ❌ **Anti-pattern 2**: `new DOMParser().parseFromString(..., 'image/svg+xml')` ALSO throws `TypeError: Failed to execute 'parseFromString' on 'DOMParser': This document requires 'TrustedHTML' assignment.` under Chromium's strict Trusted Types DOM sink rules.
- ✅ **Standard**:
  1. Use DOM creation methods (`document.createElement`) for wrapping elements (`yt-button-shape`, `button`, `div`, `span`).
  2. Construct SVG nodes directly using `document.createElementNS('http://www.w3.org/2000/svg', 'svg'|'path'|'circle')` with structured icon descriptors (`viewBox`, `paths`). This completely bypasses all string-to-DOM parser sinks and is 100% immune to Trusted Types restrictions.
  3. Clear child nodes using `while (el.firstChild) el.removeChild(el.firstChild)` or `el.replaceChildren(...)` instead of `el.innerHTML = ''`.

---

## 🛡️ CSS Scoping Rules (Preventing YouTube UI Pollution)
Because YouTube uses class names like `.ytSpecButtonShapeNextHost`, `.ytSpecButtonShapeNextTonal`, `.yt-spec-button-shape-next` globally for all native buttons:
- ❌ **Anti-pattern**: Defining top-level CSS selectors for `.ytSpecButtonShapeNextHost` or `.ytSpecButtonShapeNextTonal` leaks styles onto native YouTube buttons (`Subscribed`, `Join`, `Community`, `Like`, `Share`).
- ✅ **Standard**: Every single userscript button CSS rule MUST be strictly prefixed with `.musicbrainz-button-renderer` (e.g. `.musicbrainz-button-renderer .ytSpecButtonShapeNextHost`, `.musicbrainz-button-renderer .ytSpecButtonShapeNextTonal`).

---

---

## 🧭 Channel & Video Relationship Resolution Mechanics

### 1. SPA Channel ID Persistence
During YouTube SPA navigation (`yt-navigate-finish`), YouTube's Polymer router does **not** update `<meta itemprop="channelId">` or `<link rel="canonical">` in the document `<head>`, and `window.ytInitialData` retains the prior page's payload.
- **Solution**: Maintain a session handle-to-channelId mapping (`_channelCache.set('@handle', 'UC...')`) populated whenever video metadata is parsed. Combine this with `event.detail.endpoint.browseEndpoint.browseId` and in-page anchor inspects (`a[href*="/channel/UC..."]`).

### 2. Multi-Entity Relationships on Channel URLs
YouTube channels may be linked to multiple MusicBrainz entities (e.g. multiple artists in a collective, or an artist plus a record label):
- **Channel Page Behavior**: If >1 distinct MB entity is linked across the channel ID and handle URLs, the script triggers `On MB (Multi) ✓` linking to `https://musicbrainz.org/url/<url-mbid>`.
- **Video Import Behavior (Add Recording)**:
  - Current implementation: `_extractArtistMbid()` selects the first `target-type === 'artist'` relation to seed into `artist = <mbid>`. If no artist relations exist (e.g. only a Label), it falls back to unlinked text `edit-recording.artist_credit.names.0.name = channelTitle`.
  - **Future Enhancement Note**: When multiple artists are linked to the channel URL, consider prompting the user or falling back to unlinked text / multi-artist credit rather than silently defaulting to the first match.

---

## 🎨 Official Brand & Design System References
Official vector assets, logos, and color palettes are maintained in the MetaBrainz Design System repository:
- **Repository**: [metabrainz/design-system](https://github.com/metabrainz/design-system)
- **Brand Assets Directory**: `brand/logos/`
  - **MusicBrainz Icons**: `brand/logos/MusicBrainz/icons/`
    - `musicbrainz-icon.svg` (`viewBox="0 0 27 30"`): Standard dual-crystal silhouette (`#ba478f` / `#eb743b`).
    - `musicbrainz-icon-detail.svg` (`viewBox="0 0 27 30"`): Detailed logo with musical note beam and neural brain tree.
  - **ListenBrainz Icons**: `brand/logos/ListenBrainz/icons/`
    - `listenbrainz-icon.svg` (`viewBox="0 0 27 30"`): Standard dual-crystal silhouette (`#353070` / `#eb743b`).
    - `listenbrainz-icon-detail.svg` (`viewBox="0 0 27 30"`): Detailed logo with headphones and neural brain tree.
- **Brand Colors**:
  - MusicBrainz Magenta: `#BA478F`
  - MetaBrainz Orange: `#EB743B`
  - ListenBrainz Dark Purple: `#353070`



