# Violentmonkey Data Sync Details (v2.50.0)

This reference outlines what Violentmonkey synchronizes across devices and the practical implications for userscript development, testing, and state management.

---

## Sync Matrix

| Category | Synced? | Backup (.zip)? | Details |
| :--- | :---: | :---: | :--- |
| **Script Code & Metadata** | **Yes** | **Yes** | Full source code (`code`) and `@meta` block (`@name`, `@version`, `@match`, `@grant`, etc.). |
| **Script Overrides (`custom`)** | **Yes** | **Yes** | Per-script user customizations configured in the script settings tab. |
| **Script Config (`config`)** | **Yes** | **Yes** | Update check preferences and enabled/disabled state. |
| **Dashboard Position (`position`)** | **Yes** | **Yes** | Manual ordering of scripts in the dashboard. |
| **Script Storage (`GM_setValue`)** | **No** | **Optional** | Runtime values stored under `S_VALUE_PRE` stay strictly local in sync; exported in backup only if "Export script data" is enabled. |
| **Cached Dependencies (`@require` / `@resource`)** | **No** | **No** | Cached scripts (`S_REQUIRE_PRE` / `req:`) and resources (`S_CACHE_PRE` / `cac:`) are neither synced nor included in backup archives. |
| **Global Manager Settings** | **No** | **Yes** | General options and editor settings are excluded from cloud sync but included in `.zip` backup (`settings`). Sync credentials stay local. |

---

## Detailed Payload Breakdown

### 1. Script Code & Metadata
Each script syncs as an individual payload (typically `vm@2-<uri>`):
* **Source Code (`code`):** The complete userscript text.
* **Parsed Metadata (`meta`):** Extracted userscript header tags (`@name`, `@namespace`, `@version`, `@match`, `@grant`, `@require`, `@resource`, `@run-at`, etc.).

### 2. Script Overrides (`custom`)
Violentmonkey serializes user overrides configured in the script settings UI:
* **Metadata Overrides:** `custom.name`, `custom.comment` (user notes), `custom.icon`, `custom.tag`.
* **Execution & Injection:** `custom.injectInto` (`auto`, `page`, `content`), `custom.runAt` (`start`, `body`, `end`, `idle`), `custom.noframes`.
* **URL Match Rules:** `custom.match`, `custom.include`, `custom.exclude`, `custom.origExclude`.
* **Source & URLs:** `downloadURL`, `updateURL`, `homepageURL`, `lastInstallURL`, `custom.pathMap`.

### 3. Script Configuration & Ordering
* **Update Preferences:** `config.shouldUpdate` (enabled, disabled, or frozen), `config.notifyUpdates`.
* **Execution Flags:** `config.noCmdNames`, `config.httpOnly`.
* **Status:** `config.enabled` is synced when the global "Sync script status" toggle (`syncScriptStatus`) is active (default). Resolves via timestamps.
* **Ordering:** `props.position` preserves dashboard list arrangement.

### 4. What Does NOT Sync & Backup Archive Omissions
* **Cached Dependencies (`@require` & `@resource`):**
  * Cached dependency payloads stored in Violentmonkey's internal storage under `S_REQUIRE_PRE` (`req:<url>`) and `S_CACHE_PRE` (`cac:<url>`) are **never synchronized via cloud sync** and are **completely excluded from Export to zip backup archives**.
  * Both Cloud Sync and Backup Export transfer only the raw userscript code and parsed metadata containing the `@require` and `@resource` URLs.
  * When a userscript is imported from a `.zip` archive or downloaded onto a new profile via Cloud Sync, Violentmonkey initiates fresh HTTP/HTTPS network requests to download the required dependencies from scratch.
  * If the dependencies cannot be resolved over the network (e.g. offline environment, deleted remote library, or relative paths like `// @require ../lib/foo.js` without a valid base URL), execution will fail.
* **Script Storage Values (`GM_setValue` / `GM.setValue`):**
  * Persistent storage entries stored under `S_VALUE_PRE` (`val:<id>`) are **never synchronized** via cloud sync.
  * In Backup archives (`ExportZip`), script values are only included if the user explicitly checks *"Export script data"* (`exportValues: true`).
* **Manager Options (Global Preferences):**
  * General preferences, editor configuration, and blacklist rules are not synced via cloud sync (though they are saved in `.zip` backups).
  * Sync credentials and access tokens are strictly local per profile and never exported.

---

## Practical Implications for Userscript Authoring

1. **State Persistence Across Devices:**
   * Do not design userscripts with the assumption that `GM_setValue` data transfers across computers.
   * If cross-device state synchronization is required, implement an external backend (e.g. sync API, Gist, or manual JSON export/import via userscript UI).

2. **Debugging URL Matching & Injection Realms:**
   * When testing with `scripts_test_match`, remember that Violentmonkey evaluates both header metadata (`meta.match`) and user overrides (`custom.match`).
   * Overridden `custom.injectInto` or `custom.runAt` will sync across devices and override script headers.

3. **Development vs. Production Sync Conflicts:**
   * When deploying development builds via `scripts_write` on a machine connected to Violentmonkey sync, changes may sync to other connected profiles.
   * Setting `config.shouldUpdate: 0` freezes automated remote updates, preventing auto-updates from clobbering development versions.

4. **Dependency Resolution on Fresh Profiles & Restores:**
   * Because `@require` and `@resource` caches are omitted from both sync payloads and `.zip` backups, scripts that rely on local relative dependencies (such as unbuilt development scripts using `// @require ../lib/MusicBrainzAPI.js`) cannot be restored or synced to another device.
   * On destination profiles, Violentmonkey will attempt to fetch the dependency URLs over HTTP; relative paths will fail to resolve unless properly rewritten to public URLs or inlined.
