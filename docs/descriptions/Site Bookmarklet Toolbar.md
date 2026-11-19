Replaces the browser bookmarks bar with an in-page, site-scoped bookmarklet toolbar, folder dropdowns, searchable Command Palette, and drag-and-drop Manager modal isolated inside Shadow DOM.

Ships with the [MusicBrainz Bookmarklets](https://github.com/chaban-mb/bookmarklets) collection bundled in the Library (unpinned by default so you choose what appears on your Toolbar) and supports custom Local Scripts for any website.

### Features

- **Site-Scoped Toolbar & Folders:** Only mounts when at least one Toolbar-Placed script (Pinned button or Folder item) matches the current page URL. Fast-path exits with zero DOM injection on unmatched sites.
- **MusicBrainz Header & Floating Dock Integration:** Mounts inline inside MusicBrainz's `div.header .right .top` between `.links-container` and `.search-container`, or as a compact bottom-right floating dock on other matched sites.
- **Command Palette (`Alt+B` / `⌘`):** Searchable overlay surfacing recently run scripts at the top, all matching Pack and Local scripts below, and quick access to the Manager (`GM.registerMenuCommand` also registers **Open Command Palette** and **Open Bookmarklet Manager** everywhere).
- **Drag-and-Drop Manager Modal:** Sticky WYSIWYG Toolbar strip and expandable Folder drawer above a searchable Library. Pin/unpin scripts (`☆`/`★`), create/rename/reorder folders, double-click buttons or chips to customize labels inline, and create or edit Local Scripts with Violentmonkey `@match` patterns.
- **Safe Pack Updates:** Bundled pack updates sync automatically into an isolated `PackCache` without touching your `LocalScripts` or `Layout`. If an upstream pack update removes a script you had placed on your Toolbar, it stays functional and is flagged (`⚠`) so you can **Convert** it to a Local Script or delete it.

### JSON Import / Export Schema

Backups exported from the Manager (**Export** / **Import**) use schema version `1` and store your custom `LocalScripts` and `Layout` (pack script code is omitted so pack references stay lightweight and receive future updates):

```json
{
  "version": 1,
  "exportedAt": "2026-11-19T12:00:00.000Z",
  "scripts": {
    "local:custom_example": {
      "id": "local:custom_example",
      "source": "local",
      "name": "Custom Script",
      "label": "Custom",
      "description": "Optional summary",
      "match": ["*://*.musicbrainz.org/*"],
      "code": "javascript:(()=>{ console.info(location.href); })();"
    }
  },
  "layout": [
    {
      "type": "script",
      "scriptId": "pack:chaban-bookmarklets/approve_all_edits",
      "label": "Approve All"
    },
    {
      "type": "folder",
      "id": "folder:1700000000000",
      "name": "Release Editor",
      "items": [
        {
          "type": "script",
          "scriptId": "local:custom_example"
        }
      ]
    }
  ]
}
```

Importing a backup uses **Replace** semantics, validating all `@match` patterns and layout nodes before replacing your active `LocalScripts` and `Layout`.

### Page-Context Execution, CSP & Trusted Types

Bookmarklets frequently inspect or invoke host-page globals (such as `window.MB._releaseEditor` in the MusicBrainz release editor). To support full page-context access without unsafe `@grant unsafeWindow` coupling, `executeScriptInPage` normalizes `javascript:` URLs and executes code via an ephemeral inline `<script>` element in the page document.

- **Strict CSP Sites:** If a host page enforces a restrictive Content Security Policy (such as `Content-Security-Policy: script-src 'none'` without `'unsafe-inline'`), the browser will block inline `<script>` execution and fire a `securitypolicyviolation` event. The toolbar captures this violation, logs a warning with the `[Bookmarklet Toolbar]` prefix, and displays a non-blocking Shadow DOM toast (`Bookmarklet error: Blocked by page Content Security Policy (...)`).
- **Trusted Types Sites:** The Shadow DOM UI is built strictly via DOM APIs without `.innerHTML`, and script injection uses a `userjs-bt-toolbar` `TrustedTypes` policy (`createScript`) when `window.trustedTypes` is available. If a host page locks down `trusted-types` policy creation (`require-trusted-types-for 'script'`), the failure is caught cleanly and surfaced via the same console warning and Shadow DOM toast without breaking page scripts.

### Site Mount Adapter Interface

Site placement is handled by pluggable adapters in `lib/BookmarkletToolbarAdapters.js` (`SITE_ADAPTERS`), evaluated in order by `resolveMountAdapter(url, doc)`:

```javascript
{
  id: 'site-id',
  matches(url, doc) {
    // Return true when the URL matches the target site and required anchor DOM exists
  },
  mount(doc, hostEl) {
    // Attach the Shadow DOM toolbar host element into the site's DOM and return true
  },
  unmount(doc, hostEl) {
    // Cleanly detach hostEl from the DOM
  }
}
```

If no site-specific adapter matches (or if a matched site page lacks its header container, such as an error page), `resolveMountAdapter` falls back to the `fallback` floating dock adapter.
