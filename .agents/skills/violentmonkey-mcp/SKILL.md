---
name: violentmonkey-mcp
description: >-
  Read-only Violentmonkey MCP diagnostics: check extension connection (vm_status),
  inspect installed scripts and -dev versions (scripts_list, scripts_get), verify
  @match/@exclude rules (scripts_test_match), and read tab injection/logs
  (tabs_list, tab_scripts, script_logs).
---

# Violentmonkey MCP Diagnostics (Read-Only)

Use the Violentmonkey MCP server (`@violentmonkey/mcp --readonly`) to inspect extension state, verify `@match`/`@exclude` rules, and read script logs.

> [!NOTE]
> Live script syncing uses `node tools/dev_server.js` with Violentmonkey's *"Track external edits"* (see [userscript-workflow](../userscript-workflow/SKILL.md#browser-testing--live-sync)).

## Authorization Protocol

Requires one manual approval per browser session:

1. **Check Status**: Call `vm_status`. If `connected: true`, proceed.
2. **Open Authorization Tab**: If `connected: false`, open `connectUrl` via `new_page({ url: connectUrl })` (`net::ERR_ABORTED` is expected—the extension redirects to `#settings/mcp`).
3. **Prompt User**: Ask the user to click **`[Approve]`** in the opened Violentmonkey settings tab.
4. **Verify & Cleanup**: Call `vm_status` until `connected: true`, then `close_page`.

## Diagnostic Workflows

### Installed & Tracked Scripts (`scripts_list`, `scripts_get`)

- Call `scripts_list` to verify enabled state, script IDs, and active `-dev.<branch>.<hash>` `@version` tags from `dev_server.js`.
- Call `scripts_get` to inspect installed metadata or source when debugging version/override mismatches.

### Match Verification (`scripts_test_match`)

- Verify target URLs return `matched: true` and excluded URLs return `matched: false`.
- **`@exclude` Glob Nuance**: While `@match` covers the apex domain with `*.`, `@exclude` uses glob matching where `*.` requires a subdomain. Use `*://*domain.tld/*` to match both apex and subdomains.

### Tab Injection & Logs (`tabs_list`, `tab_scripts`, `script_logs`)

- Use `tabs_list` and `tab_scripts` to confirm which scripts injected into a tab.
- Use `script_logs` alongside `chrome-devtools` console messages to inspect userscript output.

## References

- [Data Sync Details (v2.50.0)](./references/data-sync.md): Multi-device state persistence, `GM_setValue` scope, custom override synchronization, and sync conflict behavior.
