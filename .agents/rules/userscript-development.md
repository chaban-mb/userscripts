---
trigger: model_decision
description: Runtime code standards for userscripts, including async IIFE encapsulation, minimal grants, console logging conventions, and error boundaries.
---

# Userscript Code Standards & Runtime Architecture

## 1. Script Encapsulation & Grants

- **Script Boundaries**: Primary source files reside in `src/*.user.js` and shared modules in `lib/*.js`.
- **Minimal Grants**: Do not declare `@grant`s that the script does not use. If no privileged APIs are required, declare `// @grant none`.
- **Closure Encapsulation**: Wrap scripts in an async IIFE closure `(async function () { 'use strict'; ... })();` to avoid leaking variables into target window contexts.
- **Scaffolding & Lifecycle**: For initializing new scripts, menu registration patterns, and release workflows, see skill [userscript-workflow](../skills/userscript-workflow/SKILL.md).

---

## 2. Error Handling & Asynchronous Flow

- **Adhere to JavaScript Standards**: For modern syntax, asynchronous flows, error boundaries, and code hygiene, strictly follow [javascript.md](javascript.md).
- **API Retries & Backoff**: When interacting with external Web Services, implement structured retry loops with backoff to handle rate limits (HTTP 429/503) and transient network drops.
- **Asynchronous Storage Pitfall**: GM4 `GM.getValue` returns a `Promise`, which is always truthy in JavaScript conditionals (`if (GM.getValue(...))`). Always `await` the value before branching.

---

## 3. Storage Architecture, Origin Isolation & Key Naming

- **Storage Key Naming Standard**: To avoid key collisions across shared namespaces (such as localStorage or extension-wide GM_setValue / GM_getValue), all userscripts MUST adhere to the standardized hierarchy:
  UserJS.<SiteName>.<ScriptName>.<FieldName>
  - Examples:
    - UserJS.MusicBrainz.SubscriberSpamFilter.Cache
    - UserJS.MusicBrainz.EditorSubscriptionManager.Settings
    - UserJS.ListenBrainz.ExtendedListenControls
    - UserJS.MusicBrainz.GuessCaseImprover.CustomEtiPhrases
- **Cross-Origin & Beta Domain Boundaries**:
  - localStorage and IndexedDB are strictly bound to the Same-Origin Policy. Data stored on musicbrainz.org is completely inaccessible from beta.musicbrainz.org.
  - When state must persist across production and beta domains, use **GM.setValue / GM.getValue** (extension-level storage spanning all matched origins).
  - Use sessionStorage only for purely ephemeral, per-tab session data.
- **Explicit Key Deletion**:
  - Always use GM.deleteValue(key) to remove obsolete keys or un-set authentication tokens, and declare // @grant GM.deleteValue.

---

## 4. Logging Standards

- **Zero Transient Debugging**: Never commit transient debugging statements (`console.log`) to production code.
- **Leveled Methods**: Use standard console levels:
  - `console.debug`: Detailed operational diagnostics (trace data, hydration details).
  - `console.info`: Significant milestone events (initialization, batch completion).
  - `console.warn`: Recoverable anomalies or deprecated data structures.
  - `console.error`: Unrecoverable errors or failed network operations.
- **Standardized Prefix**: Prefix all log output with the script name: `[${SCRIPT_NAME}]` (optionally including timestamps or tab IDs for multi-tab operations).

---

## 5. UI Interaction & Menu Registration

- **Menu Icons**: Format toggleable menu commands with Ballot Box icons `☑` (U+2611) and `☐` (U+2610).
- **Dynamic Re-Registration**: For the full dynamic menu update pattern, see [userscript-workflow](../skills/userscript-workflow/SKILL.md#menu-commands-gmregistermenucommand).
- **Localization**: Use English for all menu items, settings labels, and UI elements.
