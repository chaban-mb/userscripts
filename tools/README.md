# Developer Tools

This directory contains development utilities, automation scripts, and workflow tooling for the `userscripts` repository.

## Table of Contents

- [Violentmonkey AI Agent Access (MCP) & Live Sync](#violentmonkey-ai-agent-access-mcp--live-sync)
  - [Why Prefer MCP Over HTTP File Tracking?](#why-prefer-mcp-over-http-file-tracking)
  - [Direct AI Agent MCP Setup (`@violentmonkey/mcp`)](#direct-ai-agent-mcp-setup-violentmonkeymcp)
  - [Available Violentmonkey MCP Tools](#available-violentmonkey-mcp-tools)
- [Local Development & MCP Sync Server (`dev_server.js`)](#local-development--mcp-sync-server-dev_serverjs)
  - [Overview](#overview)
  - [CLI Usage & Options](#cli-usage--options)
  - [Method 1: Native MCP Push Sync (Preferred)](#method-1-native-mcp-push-sync-preferred)
  - [Method 2: HTTP File Tracking ("Track external edits")](#method-2-http-file-tracking-track-external-edits)
  - [How It Works](#how-it-works)
- [Workflow Automation (`workflow.py`)](#workflow-automation-workflowpy)
- [Distribution Builder (`build_dist.py`)](#distribution-builder-build_distpy)
- [Documentation Generator (`build_list.py`)](#documentation-generator-build_listpy)

---

## Violentmonkey AI Agent Access (MCP) & Live Sync

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

Then ask the agent to call `vm_status` to retrieve the authorization URL (`https://violentmonkey.github.io/mcp_connect.html?port=5678&token=<token>`), open it in your browser, and click **Approve** in Violentmonkey's settings.

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

## Local Development & MCP Sync Server (`dev_server.js`)

A zero-dependency Node.js HTTP and WebSocket server that implements **both** the **Violentmonkey MCP WebSocket Bridge (`/ws`, protocol v1)** for instant `fs.watch` push synchronization and the classic **HTTP ETag "Track external edits"** server.

### Overview

Developing userscripts by manually copy-pasting code into the browser editor on every change is slow and error-prone. `tools/dev_server.js` automates live syncing from `src/` and `lib/` with built-in repository safeguards:

- **Native MCP Auto-Push (`fs.watch`)**: When Violentmonkey (&ge; 2.49.5) is connected to `dev_server.js` via `/ws`, saving any `src/*.user.js` or `lib/*.js` file in your editor automatically pushes the updated script over WebSocket (`scripts_write`) and reloads active target tabs.
- **Automatic Relative `@require` Inlining on MCP Push**: Because `scripts_write` sends raw source code without an HTTP `lastInstallURL` base, `dev_server.js` automatically inlines relative `../lib/*.js` dependencies (such as `lib/MusicBrainzAPI.js`) into the pushed code payload—and automatically re-pushes dependent scripts whenever a file in `lib/` is saved!
- **In-Place Updates (Zero Conflict)**: By default, `@name` is preserved identically to production so Violentmonkey updates your existing installed script in-place. This guarantees **only ONE script instance runs** on target sites (preventing duplicate UI elements and conflicting handlers).
- **Git-Aware Versioning**: Injects the active git branch and commit hash into `@version` (e.g. `2.8.1-dev.3357794` on `dev`, or `2.8.1-dev.beatport-checker.3357794` on topic branches) for exact build identification in Violentmonkey without artificial version hacks.
- **Preserve Upstream Update URLs**: Preserves original `@updateURL` and `@downloadURL` so your script can cleanly update to stable upstream releases via Violentmonkey once development is complete.
- **Web Dashboard**: Provides a visual interface at `http://localhost:8080/` with an MCP connection status badge, a one-click **Connect Violentmonkey MCP** authorization button, one-click **&#9889; Push via MCP** buttons for every script, and fallback **Track via HTTP** links.
- **Conflict Diagnostic & Graceful Shutdown**: Intercepts `EADDRINUSE` to identify the occupying process (`tasklist` / `lsof`) and offers automatic takeover (`--kill`) or fallback (`--find-port`). Sends WebSocket close code `4002` and drains active sockets cleanly on shutdown.

### CLI Usage & Options

Start the development server:

```bash
node tools/dev_server.js
```

#### Available Flags

| Option | Default | Description |
| :--- | :--- | :--- |
| `--port`, `-p <number>` | `8080` (or `process.env.PORT`) | Port number for both HTTP dashboard and `/ws` MCP WebSocket bridge. |
| `--host <ip>` | `127.0.0.1` (or `process.env.HOST`) | Host IP to listen on. |
| `--token <string>` | Random 32-byte `base64url` (or `VM_MCP_TOKEN`) | Fixed authentication token for Violentmonkey MCP WebSocket handshake. |
| `--no-watch` | `false` | Disable automatic `fs.watch` push to connected Violentmonkey MCP client. |
| `--separate` | `false` | Tag `@name` with `[DEV]` to install side-by-side as a separate script. |
| `--name-tag <tag>` | `[DEV]` (when `--separate`) | Custom suffix appended to the `@name` metadata field. |
| `--no-tag` | `false` | Serve/push unmodified source files without injecting dev `@version` metadata. |
| `--kill`, `--force` | `false` | Terminate any existing process occupying the port before starting. |
| `--find-port` | `false` | Automatically select the next available port if requested port is in use. |
| `--help`, `-h` | — | Display CLI help screen with MCP & HTTP tracking instructions and exit. |

#### Examples

```bash
# Default: start HTTP + MCP bridge server on port 8080 (in-place sync)
node tools/dev_server.js

# Terminate conflicting process occupying port 8080 and take over
node tools/dev_server.js --kill

# Use a fixed MCP token so Violentmonkey can reconnect across server restarts
node tools/dev_server.js --token my-local-dev-secret

# Install side-by-side as an isolated separate script with [DEV] tag
node tools/dev_server.js --separate

# Serve/push raw production source without dev metadata injection
node tools/dev_server.js --no-tag
```

### Method 1: Native MCP Push Sync (Preferred)

Requires **Violentmonkey &ge; 2.49.5**. No installer tabs need to be kept open!

1. **Start the server**:

   ```bash
   node tools/dev_server.js --kill
   ```

2. **Authorize Violentmonkey MCP**:
   Open the connect URL printed in the terminal (`https://violentmonkey.github.io/mcp_connect.html?port=8080&token=...`) or open [http://localhost:8080/](http://localhost:8080/) and click **Connect Violentmonkey MCP &rarr;**.
3. **Approve in Violentmonkey**:
   Violentmonkey intercepts the URL and opens **Settings &rarr; AI agent access (MCP)**. Click **Approve**.
4. **Edit & Save**:
   - Save any `src/*.user.js` or `lib/*.js` file in your IDE: `dev_server.js` automatically transforms the metadata, inlines relative `../lib/` files, pushes the script over WebSocket (`scripts_write`), and Violentmonkey reloads matching tabs!
   - Alternatively, click **&#9889; Push via MCP** next to any script on [http://localhost:8080/](http://localhost:8080/) to install or update it on demand.

### Method 2: HTTP File Tracking ("Track external edits")

Fallback method for older Violentmonkey versions or when the MCP port is connected to an external `@violentmonkey/mcp` agent process:

1. **Start the server** (`node tools/dev_server.js`) and navigate to [http://localhost:8080/](http://localhost:8080/).
2. Click **Track via HTTP &rarr;** on the script you are working on.
3. In the Violentmonkey installation tab that opens:
   - Check **`[x] Track external edits`** and **`[x] Reload tab`**.
   - **Keep the Violentmonkey installer/editor tab open** so Violentmonkey continues polling HTTP 304 ETags.

### How It Works

- **MCP WebSocket Protocol v1 (`/ws`)**: Validates the `Origin` header (`chrome-extension://` or `moz-extension://`), completes the `hello` &rarr; `ready` handshake using constant-time SHA-256 token comparison, responds to 20s `ping` heartbeats with `pong`, and dispatches `call` frames (`scripts_write`, `scripts_list`).
- **ETag Caching (HTTP Mode)**: Violentmonkey sends `If-None-Match` requests matching the file's modification time and git commit hash. The server returns `304 Not Modified` when unchanged.
- **Metadata Injection**: Intercepts the userscript metadata block on-the-fly:

  ```javascript
  // Original (src/)
  // @name        Beatport: MusicBrainz Checker
  // @version     2.8.2

  // Served / Pushed by dev_server.js
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
