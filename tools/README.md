# Developer Tools

This directory contains development utilities, automation scripts, and workflow tooling for the `userscripts` repository.

## Table of Contents
- [Local Development Server (`dev_server.js`)](#local-development-server-dev_serverjs)
  - [Overview](#overview)
  - [CLI Usage & Options](#cli-usage--options)
  - [Tracking Scripts in Violentmonkey](#tracking-scripts-in-violentmonkey)
  - [How It Works](#how-it-works)
- [Workflow Automation (`workflow.py`)](#workflow-automation-workflowpy)
- [Distribution Builder (`build_dist.py`)](#distribution-builder-build_distpy)
- [Documentation Generator (`build_list.py`)](#documentation-generator-build_listpy)

---

## Local Development Server (`dev_server.js`)

A lightweight zero-dependency Node.js HTTP server designed specifically for **Violentmonkey's native "Track external edits"** workflow.

### Overview

Developing userscripts by manually copy-pasting code into the browser editor on every change is slow and prone to errors. `tools/dev_server.js` serves scripts directly from `src/` over HTTP with on-the-fly development safeguards:
- **In-Place Tracking (Zero Conflict)**: By default, `@name` is preserved identically to production so Violentmonkey updates your existing installed script in-place. This guarantees **only ONE script instance runs** on target sites (preventing duplicate UI elements and conflicting handlers).
- **Git-Aware Versioning**: Injects the active git branch and commit hash into `@version` (e.g. `2.8.1-dev.beatport-checker.3357794`) for exact build identification in Violentmonkey without artificial version hacks.
- **Update URL Redirection**: Rewrites `@updateURL` and `@downloadURL` to `http://localhost:8080/...` so Violentmonkey won't overwrite your local development script with upstream GitHub releases during polling.
- **Shared Libraries**: Serves helper libraries from `lib/` (e.g., `/lib/MusicBrainzAPI.js`) for relative `@require` resolution.
- **Web Dashboard**: Provides a clean visual interface at `http://localhost:8080/` with one-click tracking links and instant links to restore official release versions.

### CLI Usage & Options

Start the development server:
```bash
node tools/dev_server.js
```

#### Available Flags

| Option | Default | Description |
| :--- | :--- | :--- |
| `--port <number>` | `8080` (or `process.env.PORT`) | Port number to bind the server. |
| `--host <ip>` | `127.0.0.1` (or `process.env.HOST`) | Host IP to listen on. |
| `--separate` | `false` | Tag `@name` with `[DEV]` to install side-by-side as a separate script. |
| `--name-tag <tag>` | `[DEV]` (when `--separate`) | Custom suffix appended to the `@name` metadata field. |
| `--no-tag` | `false` | Serve unmodified source files without injecting dev metadata or rewriting URLs. |
| `--help`, `-h` | — | Display CLI help screen with tracking instructions and exit. |

#### Examples

```bash
# Default: in-place tracking (replaces existing installed script cleanly)
node tools/dev_server.js

# Custom port
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
   node tools/dev_server.js
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

- **ETag Caching**: Violentmonkey sends `If-None-Match` requests matching the file's modification time. The server returns `304 Not Modified` when unchanged, minimizing CPU and network overhead.
- **Metadata Injection**: The server intercepts the userscript metadata block on-the-fly using regex stream transformation:
  ```javascript
  // Original
  // @name        Beatport MusicBrainz Checker
  // @version     2.8.0

  // Served on localhost:8080
  // @name        Beatport MusicBrainz Checker [DEV]
  // @version     2.8.0-dev.beatport-checker/refactor.0d961bb
  // @updateURL   http://127.0.0.1:8080/Beatport%20MusicBrainz%20Checker.user.js
  // @downloadURL http://127.0.0.1:8080/Beatport%20MusicBrainz%20Checker.user.js
  ```

---

## Workflow Automation (`workflow.py`)

A comprehensive CLI tool managing branch lifecycles, release packaging, changelogs, version bumps, and git synchronizations.

```bash
python tools/workflow.py --help
```

Key subcommands:
- `status`: Show status of userscripts across branches.
- `release <script_name>`: Bump version, build distribution files, create release commit, and tag release.
- `sync`: Synchronize branch state with remotes.

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
