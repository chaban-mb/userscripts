# Userscript Concurrency & Multi-Tab Audit Notes

> Moved from `.agents/skills/userscript-workflow/references/userscript_grant_architecture.md` to keep reference docs focused on `@grant` & sandbox mechanics.

## Known Concurrency Hotspots & Multi-Tab Audit

Multiple scripts in the repository handle state via in-memory objects serialized into a single `GM` key. When multiple browser tabs are open, these scripts are vulnerable to "Last-Write-Wins" clobbering:

### 1. `MusicBrainz Reports Statistics` (`src/MusicBrainz Reports Statistics.user.js`)

- **Central Storage Key**: `CENTRAL_CACHE_KEY = 'UserJS.MusicBrainz.ReportsStatistics.Cache'`
- **Failure Mechanism**: Reads the monolithic cache once during `init()` into `newReportCache`. It then enters a long asynchronous sequential fetch loop (with `REQUEST_DELAY = 1000`) that frequently takes 30–60+ seconds.
- **The Race Scenario**: If Tab B updates or refreshes a report while Tab A's loop is still running, Tab A finishes its run and blindly calls `await GM.setValue(CENTRAL_CACHE_KEY, ...)` with its stale in-memory snapshot, completely obliterating Tab B's updates.
- **Remediation**:
  - **Patch (Read-Merge-Write)**: Immediately before writing, re-read `latest = await GM.getValue(CENTRAL_CACHE_KEY)`, shallow-merge reports by comparing `lastChecked` timestamps (`latestReport.lastChecked > inMemoryReport.lastChecked ? latestReport : inMemoryReport`), and write the merged payload.
  - **Alternative**: Granular per-report keys (`UserJS.MusicBrainz.ReportsStatistics.Report.<ReportName>`) to eliminate cross-report collisions entirely.

### 2. `MusicBrainz Editor Subscription Manager` (`src/MusicBrainz Editor Subscription Manager.user.js`)

- **Central Storage Key**: `mb_editor_subscriptions`
- **Failure Mechanism**: Hydrates state into `_cache` on initialization. Mutations immediately update `_cache` and fire `GM.setValue`.
- **The Race Scenario**: Subscribing/unsubscribing in Tab A is invisible to Tab B's in-memory `_cache`. A subsequent save from Tab B overwrites Tab A's subscription changes.
- **Remediation**: Wire `GM_addValueChangeListener` to synchronize `_cache` across tabs, or perform fresh read-and-merge on mutation.

### 3. `MusicBrainz Subscriber Spam Filter` (`src/MusicBrainz Subscriber Spam Filter.user.js`)

- **Central Storage Key**: Cached editor subscriptions / filter configuration
- **Failure Mechanism**: Reads state into memory during filter processing; manual actions or subscription checks persist the state.
- **The Race Scenario**: Concurrent tab moderation actions clobber subscription states.
- **Remediation**: Sync state via change listeners or verify latest storage state prior to mutating.

## Architectural Roadmap: The "Proper" Long-Term Solution

The in-memory cache pattern works reliably for single-tab workflows but has known architectural limitations:

1. **Multi-Tab Divergence**: If tab A modifies storage, tab B's in-memory cache remains stale unless polled or synced.
