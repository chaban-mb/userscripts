# Research: Shadow DOM Styling & GM Style APIs under Strict `style-src 'self'` CSP

**Date:** 2026-11-23  
**Context:** MusicBrainz pages such as `/account/edit` and `/account/preferences` enforce `Content-Security-Policy: style-src 'self' staticbrainz.org static.metabrainz.org` (without `'unsafe-inline'`), causing the Bookmarklet Toolbar Shadow DOM UI to render unstyled.

---

## 1. Empirical Probe in Headless Chrome (`style-src 'self'`)

Tested directly in Chrome (`--headless=new`, `Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self'`) inside an open `ShadowRoot`:

| Mechanism | Computed Result | CSP Violation? |
| :--- | :--- | :--- |
| `<style>` element inside `ShadowRoot` | **Blocked** (`rgb(0, 0, 0)`) | Yes (`style-src-elem:inline`) |
| `new CSSStyleSheet()` + `replaceSync()` + `shadowRoot.adoptedStyleSheets` | **Applied** (`rgb(4, 5, 6)`) | **None** |
| `el.setAttribute('style', '...')` | **Blocked** (`rgb(0, 0, 0)`) | Yes (`style-src-attr:inline`) |
| `el.style.cssText = '...'` | **Applied** (`rgb(7, 8, 9)`) | **None** (in Chrome) |
| `el.style.color = '...'` (CSSOM property) | **Applied** (`rgb(10, 11, 12)`) | **None** |

**Correction to initial diagnosis:** In `dist/Site Bookmarklet Toolbar.user.js`, line `1880` is `container.appendChild(hostEl);` inside `fallbackAdapter.mount`. Connecting `toolbarHost` to `document.body` connects the `<style>` tag already appended inside `toolbarShadow`, which is why Chrome reported the `style-src` violation at `mount @ line 1880`. The culprit is the `<style>` tag inside Shadow DOM (`style-src-elem`), not `el.style.cssText` (though avoiding `cssText` and `setAttribute('style', ...)` in favor of stylesheet rules / individual CSSOM properties remains best practice across browsers).

---

## 2. Primary Source Findings

### A. `GM_addStyle` / `GM.addStyle`
- **Source:** [Violentmonkey GM API Docs (`GM_addStyle`)](https://violentmonkey.github.io/api/gm/#gm_addstyle), [Tampermonkey Documentation](https://www.tampermonkey.net/documentation.php#api:GM_addStyle)
- **Facts:**
  - Appends a `<style>` element to the **host document** (`<head>` / `documentElement`), and in Violentmonkey accommodates CSP pages asynchronously.
  - **Limitation for our architecture:** It cannot target a `ShadowRoot`. Light-DOM styles in `<head>` do not style elements inside `toolbarShadow` or `overlayShadow` (aside from `:host` or inherited CSS custom properties).

### B. `GM_addElement` / `GM.addElement`
- **Source:** [Violentmonkey GM API Docs (`GM_addElement`)](https://violentmonkey.github.io/api/gm/#gm_addelement) (since v2.13.1), [Tampermonkey Documentation](https://www.tampermonkey.net/documentation.php#api:GM_addElement)
- **Facts:**
  - Signature `GM_addElement(parentNode, tagName, attributes)` explicitly supports targeting a **`ShadowRoot`** (`someElement.shadowRoot`) in Violentmonkey (and in Tampermonkey).
  - Designed to inject `<style>`, `<script>`, or `<link>` elements while bypassing page CSP via extension privileges.
  - **Trade-offs:** Requires declaring `@grant GM.addElement` / `GM_addElement`, is not part of the standard DOM or older Greasemonkey 4 API surface, and adds manager-specific mocking in unit tests.

### C. Constructable Stylesheets (`CSSStyleSheet` + `shadowRoot.adoptedStyleSheets`)
- **Sources:**
  - [MDN: `ShadowRoot.adoptedStyleSheets`](https://developer.mozilla.org/en-US/docs/Web/API/ShadowRoot/adoptedStyleSheets) — supported in **Chrome 73+**, **Firefox 101+**, **Safari 16.4+**.
  - [W3C CSP Level 3](https://www.w3.org/TR/CSP3/) & [MDN: `style-src-attr`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Content-Security-Policy/style-src-attr) — programmatic constructable stylesheets via `adoptedStyleSheets` are governed by script execution (CSSOM), not `style-src-elem` / `style-src-attr` inline-style checks.
- **Trade-offs:**
  - Native web standard across Chrome, Firefox, and Safari; works synchronously inside `toolbarShadow` and `overlayShadow` with **zero additional `@grant`**.
  - Keeps Shadow DOM encapsulation intact and avoids creating `<style>` elements (falling back to `<style>` only in environments lacking `adoptedStyleSheets`, such as Node mock DOMs).
  - Paired with `:host([data-snap="..."])` stylesheet rules (replacing `applyInlineStyles`'s `cssText` on `hostEl`), it handles both host positioning and Shadow DOM internals cleanly without CSP violations.

---

## 3. Conclusion

- **Primary choice:** Use **`new CSSStyleSheet()` + `replaceSync(css)` + `shadowRoot.adoptedStyleSheets = [sheet]`** inside `BookmarkletToolbarUI.js`, and move `toolbarHost` positioning into `:host([data-snap="..."])` CSS rules (avoiding `<style>` tags and `setAttribute('style', ...)` / `cssText` strings).
- **Role of `GM.addElement`:** Viable CSP bypass if an environment ever blocked `<style>` fallback or `<script>` execution, at the cost of adding `@grant GM.addElement` — unnecessary for Shadow DOM CSS when `adoptedStyleSheets` is available.
- **Role of `GM.addStyle`:** Insufficient on its own because it cannot style inside `ShadowRoot` trees.
