# Developer Tools

This directory contains development utilities, automation scripts, and workflow tooling for the `userscripts` repository.

## Table of Contents

- [Violentmonkey AI Agent Access (MCP)](#violentmonkey-ai-agent-access-mcp)
  - [Why Prefer MCP Over HTTP File Tracking?](#why-prefer-mcp-over-http-file-tracking)
  - [Direct AI Agent MCP Setup (`@violentmonkey/mcp`)](#direct-ai-agent-mcp-setup-violentmonkeymcp)
  - [Authorization & Connection Protocol](#authorization--connection-protocol)
  - [Available Violentmonkey MCP Tools](#available-violentmonkey-mcp-tools)
- [Local Development Server (`dev_server.js`)](#local-development-server-dev_serverjs)
  - [Overview](#overview)
  - [CLI Usage & Options](#cli-usage--options)
  - [Tracking Scripts in Violentmonkey](#tracking-scripts-in-violentmonkey)
  - [How It Works](#how-it-works)
- [Workflow Automation (`workflow.py`)](#workflow-automation-workflowpy)
- [Distribution Builder (`build_dist.py`)](#distribution-builder-build_distpy)
- [Documentation Generator (`build_list.py`)](#documentation-generator-build_listpy)

---

## Violentmonkey AI Agent Access (MCP)

Starting with **Violentmonkey v2.49.5** ([PR #2699](https://github.com/violentmonkey/violentmonkey/pull/2699)) and expanded in **v2.49.6** ([PR #2715](https://github.com/violentmonkey/violentmonkey/pull/2715)), Violentmonkey includes native **Model Context Protocol (MCP)** support.

- **Official Guide**: [https://violentmonkey.github.io/guide/ai-agent-access/](https://violentmonkey.github.io/guide/ai-agent-access/)
- **Upstream MCP Repository**: [https://github.com/violentmonkey/mcp](https://github.com/violentmonkey/mcp) (`@violentmonkey/mcp`, `@violentmonkey/mcp-client`, `@violentmonkey/mcp-protocol`)
- **Extension Implementation**: [`src/background/utils/mcp.js`](https://github.com/violentmonkey/violentmonkey/blob/master/src/background/utils/mcp.js) and [`src/options/views/tab-settings/vm-mcp.vue`](https://github.com/violentmonkey/violentmonkey/blob/master/src/options/views/tab-settings/vm-mcp.vue)

### Why Prefer MCP Over HTTP File Tracking?

Violentmonkey's MCP WebSocket integration (`ws://127.0.0.1:<port>/ws`) is strictly superior to the legacy HTTP *"Track external edits"* workflow:

1. **Zero Open Installer Tabs**: HTTP file tracking requires keeping a dedicated Violentmonkey confirmation/editor tab open for every tracked script so the extension can poll HTTP 304 ETags. MCP maintains a persistent background WebSocket connection (with 20s MV3 service-worker heartbeats) and pushes code changes immediately.
2. **Automatic Target Tab Reloading**: Calling `scripts_write` in Violentmonkey invokes `parseScript({ code, id, bumpDate: true, reloadTab: true })`, which immediately updates storage and reloads matching tabs without manual browser interaction.
3. **Closed-Loop Agent Diagnostics (v2.49.6+)**: Beyond installing/updating scripts, MCP gives AI agents direct visibility into whether a script matched a URL (`scripts_test_match`), whether injection succeeded or threw at `document-start` (`tab_scripts`), controlled tab reloading with `loadId` correlation (`tab_reload`), and structured `GM_log` output streaming (`script_logs`).

### Direct AI Agent MCP Setup (`@violentmonkey/mcp`)

To give an AI coding agent (Claude Code, Antigravity, Cursor, Claude Desktop, etc.) direct MCP tool access to Violentmonkey (requires **Violentmonkey &ge; 2.49.5** and **Node.js &ge; 24**):

```json
{
  "mcpServers": {
    "violentmonkey": {
      "command": "npx",
      "args": ["-y", "@violentmonkey/mcp", "-p", "5678"]
    }
  }
}
```

Or via Claude Code CLI:

```bash
claude mcp add violentmonkey -- npx -y @violentmonkey/mcp -p 5678
```

### Authorization & Connection Protocol

Unlike Chrome DevTools MCP (which attaches directly to a debugging port), Violentmonkey is a browser extension and registers connection requests via a dedicated web redirect:

1. **Check Connection Status**: Call `vm_status` from your AI agent or MCP client to verify whether the extension is connected.
2. **Retrieve Authorization URL**: If `connected: false`, `vm_status` provides a URL formatted as:

   ```text
   https://violentmonkey.github.io/mcp_connect.html?port=5678&token=<token>
   ```

3. **Open in Active Browser Session**:
   - In automated agent sessions with `chrome-devtools`, open the connect URL via `new_page({ url: connectUrl })`.
   - Violentmonkey intercepts this request via `browser.webRequest.onBeforeRequest`, registers the pending connection request, and redirects the tab to `chrome-extension://<id>/options/index.html#settings/mcp`.
4. **Approve Request**: In the Violentmonkey settings tab, click **`[Approve]`**. (Browser extension security prevents external scripts from clicking buttons on `chrome-extension://` pages automatically, so this single approval is granted once per browser session).
5. **Verify & Close Tab**: Verify `vm_status` reports `connected: true`, and close the options tab.

> [!NOTE]
> **Shared Library Inlining (`lib/*.js`)**: Because `scripts_write` sends code directly into Violentmonkey's internal storage without an HTTP base URL, any relative dependencies (such as `// @require ../lib/MusicBrainzAPI.js`) cannot be resolved over HTTP. When pushing via `scripts_write`, inline shared library code into the payload or ensure `@require` targets an absolute HTTP/CDN URL.

### Available Violentmonkey MCP Tools

| Tool | Minimum VM Version | Tab Grant Required? | Description |
| :--- | :--- | :--- | :--- |
| `vm_status` | Any (Server-side) | No | Returns connection status, extension version, and the `connectUrl`. |
| `scripts_list` | `&ge; 2.49.5` | No | Lists installed scripts (`id`, `name`, `namespace`, `version`, `enabled`, `matches`). |
| `scripts_get` | `&ge; 2.49.5` | No | Retrieves full source code and metadata for a script by `id`. |
| `scripts_write` | `&ge; 2.49.5` | No | Creates or updates a script in-place (matching by `id` or `@name` + `@namespace`) and reloads matching tabs. |
| `scripts_set_enabled` | `&ge; 2.49.5` | No | Enables or disables a userscript by `id`. |
| `scripts_delete` | `&ge; 2.49.5` | No | Moves a userscript to the recycle bin / removes it. |
| `scripts_test_match` | `&ge; 2.49.6` | No | Tests whether a script's metadata block would match a target URL and reports the deciding `@match`/`@include`/`@exclude` rule. |
| `tabs_list` | `&ge; 2.49.6` | No | Lists browser tabs explicitly granted to the agent in Violentmonkey settings. |
| `tab_scripts` | `&ge; 2.49.6` | Yes | Reports which scripts were injected (`injected`, `failed`, `pending`), their `codeHash`, and any startup error on a granted tab. |
| `tab_reload` | `&ge; 2.49.6` | Yes | Reloads a granted tab and returns the new document `loadId`. |
| `script_logs` | `&ge; 2.49.6` | Yes | Reads captured `GM_log` entries (requires `@grant GM_log`) for a granted tab using a monotonic `afterSeq` cursor or `sinceLoadId`. |

---

## Local Development Server (`dev_server.js`)

A lightweight zero-dependency Node.js HTTP server designed for **Violentmonkey's native "Track external edits"** workflow. It serves userscripts from `src/` and shared dependencies from `lib/` as a fallback when direct MCP access is not active.

### Overview

Developing userscripts by manually copy-pasting code into the browser editor on every change is slow and error-prone. `tools/dev_server.js` automates live reloading with built-in repository safeguards:

- **In-Place Updates (Zero Conflict)**: By default, `@name` is preserved identically to production so Violentmonkey updates your existing installed script in-place. This guarantees **only ONE script instance runs** on target sites (preventing duplicate UI elements and conflicting handlers).
- **Git-Aware Versioning**: Injects the active git branch and commit hash into `@version` (e.g. `2.8.1-dev.3357794` on `dev`, or `2.8.1-dev.beatport-checker.3357794` on topic branches) for exact build identification in Violentmonkey without artificial version hacks.
- **Preserve Upstream Update URLs**: Preserves original `@updateURL` and `@downloadURL` so your script can cleanly update to stable upstream releases via Violentmonkey once development is complete.
- **Web Dashboard**: Provides a visual interface at `http://localhost:8080/` with one-click **Track in Violentmonkey** links for each script.
- **Conflict Diagnostic & Graceful Shutdown**: Intercepts `EADDRINUSE` to identify any occupying process (`tasklist` / `lsof`) and offers automatic takeover (`--kill`) or fallback (`--find-port`).

### CLI Usage & Options

Start the development server:

```bash
node tools/dev_server.js
```

#### Available Flags

| Option | Default | Description |
| :--- | :--- | :--- |
| `--port`, `-p <number>` | `8080` (or `process.env.PORT`) | Server port to listen on. |
| `--host <ip>` | `127.0.0.1` (or `process.env.HOST`) | Server host IP. |
| `--separate` | `false` | Tag `@name` with `[DEV]` to install side-by-side as a separate script. |
| `--name-tag <tag>` | `[DEV]` (when `--separate`) | Custom suffix appended to the `@name` metadata field. |
| `--no-tag` | `false` | Serve raw source files without injecting dev `@version` metadata. |
| `--kill`, `--force` | `false` | Terminate any existing process occupying the port before starting. |
| `--find-port` | `false` | Automatically select the next available port if requested port is in use. |
| `--help`, `-h` | — | Display CLI help screen with tracking instructions and exit. |

#### Examples

```bash
# Default: start HTTP server on port 8080 (in-place tracking)
node tools/dev_server.js

# Terminate conflicting process occupying port 8080 and take over
node tools/dev_server.js --kill

# Automatically bind to the next available port if 8080 is busy
node tools/dev_server.js --find-port

# Listen on a custom port
node tools/dev_server.js --port 3000

# Install side-by-side as an isolated separate script with [DEV] tag
node tools/dev_server.js --separate

# Serve raw production source without dev metadata injection
node tools/dev_server.js --no-tag
```

### Tracking Scripts in Violentmonkey

Follow these steps to establish live auto-reloading:

1. **Start the server**:

   ```bash
   node tools/dev_server.js --kill
   ```

2. **Open the dashboard**:
   Navigate to [http://localhost:8080/](http://localhost:8080/) in your browser.
3. **Select a script**:
   Find the script you are working on and click **Track in Violentmonkey &rarr;**.
4. **Configure Violentmonkey installer**:
   In the Violentmonkey installation tab that opens:
   - Check **`[x] Track external edits`** (or click the track button).
   - Check **`[x] Reload tab`** so open target website tabs automatically reload when the script changes.
   - **Keep the Violentmonkey installer/editor tab open**. Violentmonkey performs ETag polling while this tab remains active.
5. **Edit & Iterate**:
   Make edits in your local IDE (`src/*.user.js`) and save. Violentmonkey will detect the change via HTTP 304 ETags, update the script immediately, and reload your target tab.

### How It Works

- **ETag Caching**: Violentmonkey sends `If-None-Match` requests matching the file's modification time and git commit hash. The server returns `304 Not Modified` when unchanged, minimizing CPU and network overhead.
- **Metadata Injection**: The server intercepts the userscript metadata block on-the-fly:

  ```javascript
  // Original (src/)
  // @name        Beatport: MusicBrainz Checker
  // @version     2.8.2

  // Served by dev_server.js
  // @name        Beatport: MusicBrainz Checker
  // @version     2.8.2-dev.beatport-checker.0d961bb
  // @updateURL   https://github.com/chaban-mb/userscripts/raw/main/src/Beatport%20MusicBrainz%20Checker.user.js
  // @downloadURL https://github.com/chaban-mb/userscripts/raw/main/src/Beatport%20MusicBrainz%20Checker.user.js
  ```

---

## Workflow Automation (`workflow.py`)

A comprehensive CLI tool managing branch lifecycles, release packaging, changelogs, version bumps, and git synchronizations.

```bash
python tools/workflow.py --help
```

Key subcommands:

- `init "<Script Name>"` (alias: `new`): Initialize a new userscript from `templates/`, generate companion documentation in `docs/descriptions/`, register scope in `commit-scopes.md`, and optionally create topic branch (`--branch`).
- `check`: Check unreleased scripts, cascading dependency bumps, and missing metadata.
- `bump`: Batch bump version tags (`--bump-type patch|minor|major`).
- `release`: Automated or interactive release assistant with changelog generation and dist sync. On initial release of brand-new scripts, automatically displays the publishing assistant.
- `publish-info "<Script Name>"` (alias: `announce`): Display Greasy Fork code & description sync URLs and a pre-formatted Discourse forum announcement draft.
- `cleanup [branch]`: Clean up local and remote feature branches merged on GitHub.
- `build-dist`: Build standalone inlined scripts and sync directly to the `dist` branch (`--sync-branch`).

---

## Distribution Builder (`build_dist.py`)

Compiles and bundles userscripts into the `dist/` distribution directory, inlining dependencies or preparing standalone scripts.

```bash
python tools/build_dist.py
```

---

## Documentation Generator (`build_list.py`)

Scans all userscripts in `src/` and descriptions in `docs/descriptions/` to regenerate the central [docs/USERSCRIPTS.md](../docs/USERSCRIPTS.md) directory.

```bash
python tools/build_list.py
```
