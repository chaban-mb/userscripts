# Userscript API Grant Architecture & Sandbox Nuances

This document details the mechanics, security boundaries, and cross-engine nuances of the `@grant` directive across Violentmonkey (VM) and Tampermonkey (TM), specifically contrasting Greasemonkey 3 (GM3 legacy) and Greasemonkey 4 (GM4 modern) APIs.

---

## 1. The `@grant` Sandbox Boundary & `@require` Isolation

### Root Script Precedence Invariant

Userscript managers parse `@grant` declarations **strictly and exclusively** from the root userscript's metadata header block (`// ==UserScript== ... // ==/UserScript==`).

- **Libraries Cannot Grant Permissions**: If an external library included via `@require` (e.g. `../lib/MusicBrainzAPI.js`) has its own `// ==UserScript==` header containing `// @grant GM.xmlHttpRequest`, that block is **completely ignored** by the script manager.
- **Consumer Responsibility**: Any script that `@require`s a library calling privileged APIs (`GM.*` or `GM_*`) **must explicitly declare those grants in its own header**. Failure to do so results in runtime errors (e.g. `TypeError: GM.xmlHttpRequest is not a function`).

---

## 2. API Style Matrix: GM3 (`GM_*`) vs GM4 (`GM.*`)

| API Functionality | Legacy GM3 (Underscore) | Modern GM4 (Dot) | Return Type / Execution |
| :--- | :--- | :--- | :--- |
| **HTTP Request** | `GM_xmlhttpRequest` | `GM.xmlHttpRequest` | Callback (`onload`) / Returns Promise in GM4 |
| **Get Storage** | `GM_getValue` | `GM.getValue` | **Synchronous** in GM3 / **Returns Promise** in GM4 |
| **Set Storage** | `GM_setValue` | `GM.setValue` | Synchronous in GM3 / Returns Promise in GM4 |
| **Delete Storage** | `GM_deleteValue` | `GM.deleteValue` | Synchronous in GM3 / Returns Promise in GM4 |
| **List Keys** | `GM_listValues` | `GM.listValues` | Synchronous in GM3 / Returns Promise in GM4 |
| **Inject CSS** | `GM_addStyle` | `GM.addStyle` | Synchronous DOM node / Returns Promise (or element) |
| **Menu Commands** | `GM_registerMenuCommand` | `GM.registerMenuCommand` | Command ID / Returns Promise<ID> in GM4 |
| **Unregister Menu** | `GM_unregisterMenuCommand` | `GM.unregisterMenuCommand` | `void` / Returns Promise<void> in GM4 |
| **Open Browser Tab** | `GM_openInTab` | `GM.openInTab` | Tab object / Returns Promise in GM4 |
| **Clipboard** | `GM_setClipboard` | `GM.setClipboard` | `void` / Returns Promise in GM4 |
| **Script Metadata** | `GM_info` | `GM.info` | Static Object (always available) |

---

## 3. The Casing Trap (`xmlHttpRequest` vs `xmlhttpRequest`)

A frequent source of silent or baffling runtime failures is the casing difference between GM3 and GM4:

- **GM3 Legacy**: `GM_xmlhttpRequest` (lowercase **`h`**)
- **GM4 Modern**: `GM.xmlHttpRequest` (capital **`H`**)

### The Hybrid Mistake: `GM.xmlhttpRequest`

When migrating a script or typing from memory, developers often replace `GM_` with `GM.` while retaining the lowercase `h`:

```javascript
// @grant GM.xmlhttpRequest   <-- INVALID DIRECTIVE
```

### Consequences in Violentmonkey

1. **Unrecognized Directive**: VM matches grant strings against its known table of GM4 exports. `GM.xmlhttpRequest` (lowercase `h`) does not match `GM.xmlHttpRequest`.
2. **Missing Property**: Because it is unrecognized, VM does not attach `xmlHttpRequest` to the `GM` proxy.
3. **Runtime Crash**: When the script (or an included library) executes `GM.xmlHttpRequest({...})`, it fails with `TypeError: GM.xmlHttpRequest is not a function`.

---

## 4. Synchronous vs. Asynchronous Storage (`getValue` / `setValue`)

> [!WARNING]
> Never perform a search-and-replace from `@grant GM_getValue` to `@grant GM.getValue` without auditing caller execution flow.

- **GM3 `GM_getValue(key, defaultValue)` is Synchronous**:

  ```javascript
  // Top-level or synchronous event handler
  const enabled = GM_getValue('feature_enabled', true);
  if (enabled) { /* runs immediately */ }
  ```

- **GM4 `GM.getValue(key, defaultValue)` is Asynchronous (Returns `Promise`)**:

  ```javascript
  // Must be awaited inside an async function
  const enabled = await GM.getValue('feature_enabled', true);
  ```

### The Truthiness Bug

If synchronous code is granted `GM.getValue` and calls `GM.getValue(key, default)` without `await`:

```javascript
const isEnabled = GM.getValue('feature_enabled', false); // returns Promise { <pending> }
if (isEnabled) {
    // ALWAYS EXECUTES! Objects (Promises) are always truthy in JavaScript!
}
```

---

## 5. Violentmonkey Runtime Scope Mechanics

Violentmonkey wraps userscripts in an isolated closure before running them in the page or content script context:

```javascript
window.wvPPv6F2CSlh61xuq = function dQtWDT6$eUTCaQ6vg(GM) {
    with (this) with (c) delete c, ((define, module, exports) => {
        // Userscript body + concatenated @require modules
    })();
};
```

1. **Context Object `c`**: Contains legacy `GM_*` APIs. Populated strictly based on declared `@grant GM_*` headers.
2. **Parameter `GM`**: An object containing GM4 promisified methods. Populated strictly based on declared `@grant GM.*` headers.
3. **The `GM.info` Illusion**: Violentmonkey **always** provides `GM.info` even if no `@grant GM.*` was declared. This creates a false impression that the `GM` object is fully initialized, leading developers to assume `GM.xmlHttpRequest` or `GM.getValue` must also exist when they do not.

---

## 6. Tampermonkey vs. Violentmonkey Compatibility Differences

- **Tampermonkey Auto-Aliasing**: In many versions of Tampermonkey, declaring `@grant GM_xmlhttpRequest` also automatically defines `GM.xmlHttpRequest` (and vice-versa) as compatibility shims.
- **Violentmonkey Strict Sandboxing**: Violentmonkey enforces strict metadata adherence. If a script only declares `@grant GM_xmlhttpRequest`, `GM.xmlHttpRequest` is **NOT** defined on `GM`.
- **Multi-Engine Rule**: Never rely on Tampermonkey's permissive aliasing. Always declare the exact API syntax matching the code invocations in the script and required modules.

---

## 8. State Management & Asynchronous Storage Patterns

### The Synchronous UI vs. Asynchronous Storage Dilemma

When migrating legacy userscripts from synchronous `GM_getValue` to modern `GM.getValue`, UI rendering logic and event handlers cannot simply call `GM.getValue` synchronously without receiving an unresolved `Promise`. In JavaScript, Promises are truthy, which leads to silent logical failures in conditionals (e.g., `if (storage.getCache().isSpammer)`).

### Pragmatic Pattern: In-Memory Cached Storage Adapter

For legacy scripts with dozens of synchronous DOM traversal, sorting, and filtering helpers, converting every function to `async`/`await` introduces significant boilerplate, latency, and race conditions during rapid user interactions.

The interim solution is the **In-Memory Cache Pattern**:

```javascript
let _cache = null;

const storage = {
    // 1. Asynchronously hydrates state once during script bootstrap:
    init: async () => {
        _cache = (await GM.getValue(CACHE_KEY, {})) || {};
    },
    // 2. Synchronous UI helpers read in-memory cache directly:
    getCache: () => _cache || {},
    // 3. Mutators update memory immediately and asynchronously persist to GM:
    save: async (key, val) => {
        if (!_cache) _cache = {};
        _cache[key] = val;
        await GM.setValue(CACHE_KEY, _cache);
    }
};
```

### Known Concurrency Hotspots & Multi-Tab Audit

Multiple scripts in the repository handle state via in-memory objects serialized into a single `GM` key. When multiple browser tabs are open, these scripts are vulnerable to "Last-Write-Wins" clobbering:

#### 1. `MusicBrainz Reports Statistics` (`src/MusicBrainz Reports Statistics.user.js`)

- **Central Storage Key**: `CENTRAL_CACHE_KEY = 'UserJS.MusicBrainz.ReportsStatistics.Cache'`
- **Failure Mechanism**: Reads the monolithic cache once during `init()` into `newReportCache`. It then enters a long asynchronous sequential fetch loop (with `REQUEST_DELAY = 1000`) that frequently takes 30–60+ seconds.
- **The Race Scenario**: If Tab B updates or refreshes a report while Tab A's loop is still running, Tab A finishes its run and blindly calls `await GM.setValue(CENTRAL_CACHE_KEY, ...)` with its stale in-memory snapshot, completely obliterating Tab B's updates.
- **Remediation**:
  - **Patch (Read-Merge-Write)**: Immediately before writing at line 727, re-read `latest = await GM.getValue(CENTRAL_CACHE_KEY)`, shallow-merge reports by comparing `lastChecked` timestamps (`latestReport.lastChecked > inMemoryReport.lastChecked ? latestReport : inMemoryReport`), and write the merged payload.
  - **Alternative**: Granular per-report keys (`UserJS.MusicBrainz.ReportsStatistics.Report.<ReportName>`) to eliminate cross-report collisions entirely.

#### 2. `MusicBrainz Editor Subscription Manager` (`src/MusicBrainz Editor Subscription Manager.user.js`)

- **Central Storage Key**: `mb_editor_subscriptions`
- **Failure Mechanism**: Hydrates state into `_cache` on initialization. Mutations immediately update `_cache` and fire `GM.setValue`.
- **The Race Scenario**: Subscribing/unsubscribing in Tab A is invisible to Tab B's in-memory `_cache`. A subsequent save from Tab B overwrites Tab A's subscription changes.
- **Remediation**: Wire `GM_addValueChangeListener` to synchronize `_cache` across tabs, or perform fresh read-and-merge on mutation.

#### 3. `MusicBrainz Subscriber Spam Filter` (`src/MusicBrainz Subscriber Spam Filter.user.js`)

- **Central Storage Key**: Cached editor subscriptions / filter configuration
- **Failure Mechanism**: Reads state into memory during filter processing; manual actions or subscription checks persist the state.
- **The Race Scenario**: Concurrent tab moderation actions clobber subscription states.
- **Remediation**: Sync state via change listeners or verify latest storage state prior to mutating.

### Architectural Roadmap: The "Proper" Long-Term Solution

The in-memory cache pattern works reliably for single-tab workflows but has known architectural limitations:

1. **Multi-Tab Divergence**: If tab A modifies storage, tab B's in-memory cache remains stale unless polled or synced.

- [Violentmonkey Metadata Block (`@grant`)](https://violentmonkey.github.io/api/metadata-block/#grant) — Explains default sandboxing, `@grant none` un-sandboxed behavior, and permission whitelisting.
- **Tampermonkey**:
  - [Tampermonkey Documentation Homepage](https://www.tampermonkey.net/documentation.php?locale=en) — Official index of metadata keys, application programming interface, settings, and deployment schemas.
  - [Tampermonkey `@grant` Directive Specification](https://www.tampermonkey.net/documentation.php?locale=en&q=grant) — Whitelisting rules for `GM_*`, `GM.*`, `unsafeWindow`, and privileged browser `window` methods (`window.close`, `window.focus`, `window.onurlchange`).
  - [Tampermonkey `GM_xmlhttpRequest`](https://www.tampermonkey.net/documentation.php?locale=en&q=GM_xmlhttpRequest) — Parameter reference and callback definitions.
- **Greasemonkey**:
  - [Greasemonkey v4 API Manual](https://wiki.greasespot.net/Greasemonkey_Manual:API) — The specification standard that established the asynchronous `GM.*` namespace and the `GM.xmlHttpRequest` naming convention.
