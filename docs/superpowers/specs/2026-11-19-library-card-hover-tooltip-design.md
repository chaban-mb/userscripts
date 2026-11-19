# Library Card Title Truncation & Hover Tooltip Design

**Scope:** Small change to `lib/BookmarkletToolbarUI.js` (and `tests/test_bookmarklet_toolbar_ui.js`).

## Intent & Why

Currently, hovering or focusing a Library card in the Manager modal removes `white-space: nowrap` from `.bt-card-title` (`lib/BookmarkletToolbarUI.js`), causing truncated titles to wrap onto multiple lines. That changes the card height on hover, pushes all cards below downward (layout shift / hover flicker), and shifts inline icons (`ⓘ`, `Pack`/`Local`, `📁`, action buttons) vertically relative to the wrapped text.

The user wants every Library card to remain strictly single-line with CSS `text-overflow: ellipsis` clipping, keep all icons and badges on a single aligned row, and reveal the full title cleanly on hover without layout shift.

## Goals, Non-Goals & Anti-Goals

- **Goals:**
  - Keep `.bt-library-card` at a fixed single-line height regardless of hover or focus state.
  - Keep `.bt-card-title` clipped with `text-overflow: ellipsis` at all times and keep `.bt-card-title-row` single-line (`flex-wrap: nowrap`) so icons/badges never wrap or shift.
  - Show the full script title immediately on hover or keyboard focus (`:focus-within`) via an instant, themed floating tooltip—only when the title is actually truncated.
- **Non-Goals:**
  - Redesigning the Library grid columns, Toolbar strip, Folder drawer, or Command Palette.
  - Adding multi-line descriptions to Library cards.
- **Anti-Goals:**
  - Any hover state that changes card height or shifts sibling cards.
  - Covering adjacent cards' interactive controls with an expanded card surface.

## Constraints

- Must live inside the existing Shadow DOM stylesheet (`buildStyles()`) and respect both light and dark themes (`--bt-*` tokens).
- Must remain Trusted Types-safe (DOM creation via `createElement` / `textContent`, no `innerHTML`).
- Must not interfere with drag-and-drop or the `ⓘ` info popover (`z-index: 35`).

## Approaches

1. **Fixed single-line cards + instant themed tooltip (Selected):** Keep `.bt-card-title` permanently clipped with ellipsis, and display a `pointer-events: none` floating tooltip pill above (or below when near the top of the scroll container) on hover/focus when truncated.
   - *Trade-off:* Slightly more CSS/DOM logic than a native `title` attribute to detect truncation and avoid clipping at the top edge, in exchange for instant feedback, theme parity, and zero layout shift.
   - *Why chosen:* User tested interactive mockups of all three approaches and leaned toward Option 1 for immediate, themed visibility without covering neighboring cards.
2. **Fixed-height grid slot + floating overlay card (Rejected):** Lock the grid cell height and lift an `absolute` inner card on hover so the title wraps over the row below.
   - *Trade-off:* User explicitly noted this produces the overlapping/expanding card behavior they want to avoid.
3. **Fixed single-line cards + native browser `title` attribute (Rejected as primary):** Rely on browser-native `title` hover tooltips.
   - *Trade-off:* Minimal code, but suffers from a ~500ms hover delay, ignores keyboard focus, and cannot match the Shadow DOM theme.

## Design Details (My Calls)

- **Single-line card & title:** Remove the `.bt-library-card:hover .bt-card-title, .bt-library-card:focus-within .bt-card-title` unwrapping rule in `lib/BookmarkletToolbarUI.js`. Keep `.bt-card-title` clipped (`white-space: nowrap; overflow: hidden; text-overflow: ellipsis`) and `.bt-card-title-row` single-line (`flex-wrap: nowrap`).
- **Instant themed tooltip element:** Render a non-interactive `.bt-card-tooltip` (`aria-hidden="true"`, `pointer-events: none`, high contrast using `--bt-fg` / `--bt-bg` or `--bt-card` + shadow, `z-index: 30`) inside each `.bt-library-card`, containing `s.name`.
- **Truncation detection & edge placement:** On `mouseenter` and `focusin` of the card (and initial check / resize when needed), set `card.dataset.truncated` based on `titleSpan.scrollWidth > titleSpan.clientWidth + 1` so non-truncated titles never show redundant tooltips. Also check the card's top position against the scroll viewport / `.bt-sticky-section` bottom edge and flip the tooltip below the card (`data-tooltip-pos="bottom"`) if placing it above would clip behind the sticky header.
- **Suppression states:** Hide `.bt-card-tooltip` while dragging (`dragState.dragPayload` active) or when `state.openInfoId === s.id` so it never collides with the `ⓘ` popover or drag feedback.
- **Keyboard accessibility:** Ensure `.bt-library-card` or its focusable controls trigger `:focus-within` tooltip visibility for truncated titles (without hijacking button clicks).

## Left to Implementation

- Exact CSS spacing/offset (`4px`–`6px` gap), max-width, and transition timing (`~90ms`).
- Updating `tests/test_bookmarklet_toolbar_ui.js` to assert single-line clipping, tooltip creation/suppression, and no hover unwrap behavior.
