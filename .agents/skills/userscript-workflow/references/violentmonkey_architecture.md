# Violentmonkey Extension Architecture & Storage Nuances

This document details the internal architecture, storage model, and messaging protocol of the Violentmonkey extension (Chromium extension ID: `jinjaccalgkegednnccohejagnlnfdag`), derived directly from source inspection of `sw.js`, `common-ui.js`, and `options/index.js`.

---

## 1. Storage Architecture (`Jn` / `Hn`)

Violentmonkey persists all data via `chrome.storage.local`, backed by LevelDB on disk at:
`%LOCALAPPDATA%\Google\Chrome\User Data\Default\Local Extension Settings\jinjaccalgkegednnccohejagnlnfdag`

Storage is partitioned into discrete namespaces using key prefixes:

| Prefix | Subsystem | Content |
| :--- | :--- | :--- |
| `scr:<id>` | **Script Record** | Core script object containing `props`, `meta`, `custom`, and `config`. |
| `code:<id>` | **Source Code** | Full userscript source code string. |
| `val:<id>` | **Script Values** | Key-value store backing `GM_setValue` / `GM_getValue`. |
| `req:<url>` | **Requires** | Cached content of external `@require` libraries. |
| `cac:<url>` | **Cache** | Cached resources (`@resource`, `@icon`). |
| `options` | **Base Options** | Global extension configuration and settings. |

---

## 2. Script Data Model (`scr:<id>`)

Each userscript is represented as an object with four distinct sections:

```typescript
interface ViolentmonkeyScript {
  props: {
    id: number;              // Unique integer ID
    position: number;        // Display order in the script list
    lastModified: number;    // Timestamp (ms)
    uri?: string;            // Source URI
  };
  meta: {
    name: string;            // Parsed from // @name
    namespace?: string;      // Parsed from // @namespace
    version?: string;        // Parsed from // @version
    tag?: string[];          // Parsed from // @tag headers
    match?: string[];
    grant?: string[];
    updateURL?: string;
    downloadURL?: string;
  };
  config: {
    enabled: 0 | 1;          // Whether script is active
    removed: 0 | 1;          // 1 indicates script is in the Recycle Bin
    shouldUpdate: 0 | 1;
  };
  custom: {
    name?: string;           // Custom display name override
    tag?: string[] | string; // User-assigned custom tags
    origTag?: boolean;       // If false, suppresses tags inherited from meta.tag
    origMatch?: boolean;     // If false, suppresses header matches
    origExclude?: boolean;
    noframes?: 0 | 1;
  };
}
```

### Tagging Resolution Rules
Violentmonkey computes the visible tags for a script via `Oc(script)`:
- If `custom.origTag !== false`, tags from `meta.tag` (parsed `@tag` headers) and `custom.tag` (user overrides) are combined.
- If `custom.origTag === false`, `meta.tag` is completely ignored and only `custom.tag` is used.
- To permanently remove or strip a tag (even if it exists in the script's header), set `custom.origTag = false` and define `custom.tag` with the remaining tags.

---

## 3. Extension Messaging Protocol (`chrome.runtime.sendMessage`)

Communication between extension pages (Options dashboard, Popup, Editor) and the background service worker (`sw.js`) uses a structured `{ cmd: string, data?: any }` payload.

### Critical Nuances
1. **Automatic Promisification**: Violentmonkey's `common-ui.js` proxies `chrome.runtime.sendMessage` to return a native `Promise`. **Never pass a callback function**; doing so causes a `TypeError: No matching signature` due to double callback wrapping.
2. **Mandatory Object Payload for `GetData`**: The background handler `Tl({ id, ids, sizes })` destructs its argument. Calling `chrome.runtime.sendMessage({ cmd: 'GetData' })` without `data: {}` causes an unhandled `TypeError: Cannot destructure property 'id' of 'undefined'`. Always supply `data: {}`.
3. **Context Restriction (`isOwn`)**: Core administrative commands are registered with `isOwn = true` and will reject if called from outside extension pages.

### Key Background Commands (`sw.js`)

| Command | Payload (`data`) | Description |
| :--- | :--- | :--- |
| `GetData` | `{ id?: number, ids?: number[], sizes?: boolean }` | Returns `{ scripts, cache, downloads, sync }`. Use `data: {}` to fetch all scripts. |
| `GetScript` | `number \| { id: number }` | Returns metadata and configuration for a single script. |
| `GetScriptCode` | `number \| number[]` | Returns the raw source code string for the specified script ID(s). |
| `GetTags` | `undefined` | Returns an array of all unique tags across installed scripts. |
| `UpdateScriptInfo` | `{ id: number, config?: object, custom?: object }` | Updates script configuration or custom settings in storage and fires an `UpdateScript` event to re-render open dashboards. |
| `MarkRemoved` | `{ id: number, removed: boolean }` | Soft-deletes a script to the recycle bin (`removed: true`) or restores it (`removed: false`). |
| `RemoveScripts` | `number[]` | Permanently deletes scripts by ID. |
| `Move` | `{ id: number, offset: number }` | Reorders a script in the list. |
| `CheckUpdate` | `{ ids?: number[], force?: boolean }` | Triggers background update checks. |
| `Vacuum` | `undefined` | Cleans orphaned storage records and expired caches. |

---

## 4. Scripting Recipes (Dashboard DevTools Console)

These recipes can be run directly in the DevTools console on `chrome-extension://jinjaccalgkegednnccohejagnlnfdag/options/index.html`.

### Batch Tag Modification
```javascript
(async () => {
  const { scripts } = await chrome.runtime.sendMessage({ cmd: 'GetData', data: {} });
  
  for (const script of scripts) {
    const custom = script.custom || {};
    const meta = script.meta || {};
    
    // Normalize existing tags
    let tags = [];
    if (Array.isArray(custom.tag)) tags.push(...custom.tag);
    else if (typeof custom.tag === 'string') tags.push(...custom.tag.split('\n'));
    if (custom.origTag !== false && Array.isArray(meta.tag)) tags.push(...meta.tag);
    tags = tags.map(t => t.trim()).filter(Boolean);

    // Filter target tag
    if (tags.some(t => t.toLowerCase() === 'target-tag')) {
      const remaining = [...new Set(tags.filter(t => t.toLowerCase() !== 'target-tag'))];
      await chrome.runtime.sendMessage({
        cmd: 'UpdateScriptInfo',
        data: {
          id: script.props.id,
          custom: {
            ...custom,
            origTag: false,
            tag: remaining
          }
        }
      });
    }
  }
  location.reload();
})();
```
