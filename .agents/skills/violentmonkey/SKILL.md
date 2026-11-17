---
name: violentmonkey
description: >-
  Violentmonkey live-sync development (`tools/dev_server.js`), "Track external
  edits", and Violentmonkey MCP diagnostics (`vm_status`, `scripts_list`,
  `scripts_test_match`, `tab_scripts`, `script_logs`). Use when testing
  userscripts in Violentmonkey, verifying `@match`/`@exclude` rules, inspecting
  `-dev` versions, or reading Violentmonkey script logs.
---

# Violentmonkey Live-Sync & Diagnostics

Sync local script edits to Violentmonkey through `tools/dev_server.js` with **"Track external edits"** so `@require` resolution and extension storage stay consistent with git. Use `/chrome-devtools` for general browser tab, DOM, and console inspection.

## Live Sync & Testing (`dev_server.js`)

Read [`references/violentmonkey_architecture.md`](references/violentmonkey_architecture.md) when investigating Violentmonkey internals, LevelDB namespaces, or ETag/messaging issues; skip for standard live-sync workflows.

1. **Start the local dev server** (if not already running):

   ```bash
   node tools/dev_server.js
   ```

2. **Check which modified scripts need tracking**:
   - Query `http://localhost:8080/api/scripts` (or open `http://localhost:8080/?changed=1`) and inspect installed scripts via `scripts_list` (requires MCP Authorization below) to see which changed scripts already have an active `-dev.<hash>` (on `dev`) or `-dev.<branch>.<hash>` (on topic branches) `@version`.
3. **Track untracked scripts**:
   - **If `chrome-devtools` has `--categoryExtensions` enabled** (`## Extension Pages` is visible in `list_pages`):
     - Open `http://localhost:8080/<script>.user.js` via `new_page("about:blank")` → `navigate_page(pageId, type: "url", url: ...)` (or click **"Track in Violentmonkey"** on `http://localhost:8080/?changed=1`).
     - Locate the opened Violentmonkey `confirm/index.html` tab under `## Extension Pages`, `take_snapshot`, and click **`Track external edits`**, **`Reload tab`**, and **`Confirm installation`**.
   - **Fallback (without `--categoryExtensions`):** Open `http://localhost:8080/?changed=1` in the browser, present only the untracked scripts, and ask the user to click **"Track in Violentmonkey"** once and enable **"Track external edits"** + **"Reload tab"**.
   - Keep the tracking tab open while editing. Note: `localhost` tracking overwrites `custom.lastInstallURL`, so `@updateURL`/`@downloadURL` must stay intact in `dev_server.js` to preserve upstream GitHub updates.
   - **Done when:** Every modified script shows an active `-dev.<hash>` or `-dev.<branch>.<hash>` `@version` in Violentmonkey.
4. **Verify live behavior**:
   - Open or reload target tabs (using `/chrome-devtools` or browser automation) and check console output, DOM state, and script logs.
5. **Mandatory teardown when work finishes**:

   ```bash
   node tools/dev_server.js --stop
   ```

   Also stop any background dev-server task in your runtime. (Use `--kill` only when starting to replace a stale port occupant.)
   - **Done when:** `node tools/dev_server.js --stop` succeeds and the background dev-server task is stopped.

## MCP Authorization Protocol

Requires one approval per browser session:

1. **Check Status**: Call `vm_status`. If `connected: true`, proceed.
2. **Open Authorization Tab**: If `connected: false`, call `new_page("about:blank")` to get a `pageId`, then `navigate_page(pageId, type: "url", url: connectUrl)` (`net::ERR_ABORTED` is expected—using `navigate_page` keeps the tab open so Violentmonkey redirects to `#settings/mcp` instead of `new_page` closing it).
3. **Approve**: If `--categoryExtensions` is enabled (`#settings/mcp` appears under `## Extension Pages`), `take_snapshot` and click **`[Approve]`**; otherwise ask the user to click **`[Approve]`** in the opened Violentmonkey settings tab.
4. **Verify & Cleanup**: Poll `vm_status` until `connected: true`, then close the authorization tab.

**Done when:** `vm_status` returns `connected: true`.

## MCP Write Guard

- **Never use `violentmonkey` MCP for full code writes** (`scripts_write` must remain disabled in `mcp_config.json`). Sync code changes through `tools/dev_server.js` + **"Track external edits"**; use `violentmonkey` MCP only for diagnostics and lightweight state toggles (such as enabling/disabling scripts).

## Diagnostic Workflows

### Installed & Tracked Scripts (`scripts_list`, `scripts_get`)

- Call `scripts_list` to verify enabled state, script IDs, and active `-dev.<hash>` / `-dev.<branch>.<hash>` `@version` tags from `dev_server.js`.
- Call `scripts_get` to inspect installed metadata or source when debugging version/override mismatches.
- Read [`references/data-sync.md`](references/data-sync.md) when diagnosing multi-device sync, `GM_setValue` scope, or override sync conflicts; skip for local `@match` or tab-injection checks.

### Match Verification (`scripts_test_match`)

- Run `scripts_test_match(id, url)` against target and excluded URLs, asserting `matched: true` on targets and `matched: false` on exclusions.
- **`@exclude` Glob Nuance**: While `@match` covers the apex domain with `*.`, `@exclude` uses glob matching where `*.` requires a subdomain. Use `*://*domain.tld/*` to match both apex and subdomains.

### Tab Injection & Logs (`tabs_list`, `tab_scripts`, `script_logs`)

- Use `tabs_list` and `tab_scripts` to confirm which scripts injected into a granted tab.
- Use `script_logs` alongside browser console logs: `script_logs` captures userscript-context logs even when the page console is isolated (e.g., sandboxed `@grant` contexts).

**Done when:** The target script's enabled state, `-dev` version, `@match` result, or tab injection/logs are verified against observed tool output.

## Common Rationalizations

| Rationalization | Reality |
| :--- | :--- |
| "Editing directly in Violentmonkey's UI instead of `localhost:8080` is faster." | Bypassing `dev_server.js` breaks *"Track external edits"*, skips `@require` resolution, and desyncs extension storage from git. |
| "I'll just print `localhost:8080` instead of opening it." | If the dashboard isn't open, the user has an extra manual step; open `http://localhost:8080/` if not already open. |
| "I'll leave `dev_server.js` running in case they test more." | Orphaned dev servers hold port 8080 and serve stale branches; always run `node tools/dev_server.js --stop` when work finishes. |
