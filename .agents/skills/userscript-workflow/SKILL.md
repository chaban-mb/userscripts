---
name: userscript-workflow
description: Userscript lifecycle, menu registration patterns, Violentmonkey direct MCP and dev server synchronization, and release management.
---

# Userscript Development Workflow & Lifecycle

Welcome to the **userscript-workflow** skill for the userscripts repository. This skill defines standard operating procedures for scaffolding, developing, testing, syncing, committing, and releasing userscripts.

## Scaffolding

To initialize a new userscript from the standard repository template:

```bash
python tools/workflow.py init "<Script Name>" [--description "..."] [--branch]
```

This automatically:

- Scaffolds `src/<Script Name>.user.js` from `templates/userscript.template.js` with complete metadata headers.
- Scaffolds `docs/descriptions/<Script Name>.md` from `templates/description.template.md`.
- Registers the canonical slug in `.agents/rules/references/commit-scopes.md`.
- Optionally creates and checks out the topic branch `<slug>/feat/initial-setup` off `dev`.

## Menu Commands (`GM.registerMenuCommand`)

When registering menu commands in Violentmonkey / Tampermonkey, follow standard ballot box iconography for toggle states and dynamic re-registration patterns:

- **Active / Enabled**: `☑ <Command Label>` (U+2611)
- **Inactive / Disabled**: `☐ <Command Label>` (U+2610)
- **Value Displays**: `<Setting Name>: <Value>` (e.g. `Theme: Dark`)

### Dynamic Re-Registration Pattern

Script managers do not update menu labels in-place automatically. To update a label when toggled without requiring a page reload:

```javascript
let registeredMenuCommandIDs = [];

async function setupMenuCommands() {
    // 1. Unregister all existing commands
    for (const commandId of registeredMenuCommandIDs) {
        try {
            await GM.unregisterMenuCommand(commandId);
        } catch (e) { /* ignore */ }
    }
    registeredMenuCommandIDs = [];

    // 2. Read state
    const isEnabled = await GM.getValue('feature_enabled', true);

    // 3. Register updated command preserving order
    const label = `${isEnabled ? '☑' : '☐'} Enable Feature`;
    const id = await GM.registerMenuCommand(label, async () => {
        await GM.setValue('feature_enabled', !isEnabled);
        await setupMenuCommands();
    });
    registeredMenuCommandIDs.push(id);
}
```

## Browser Testing & Live Sync

### Primary: Official Violentmonkey MCP (`@violentmonkey/mcp`) Handshake

1. Launch browser instance via `chrome-devtools` (`new_page`).
2. Build distribution artifact with inline dependencies:

   ```bash
   python tools/build_dist.py --print "src/<Script Name>.user.js"
   ```

3. Sync script directly into Violentmonkey via the MCP `scripts_write` tool (inlining `@require ../lib/` references).
4. Reload the target tab to test live behavior against clean baseline DOM.

### Fallback: HTTP Dev Server & Violentmonkey External Tracking

1. Start the local dev server:

   ```bash
   node tools/dev_server.js
   ```

2. Open the dev dashboard in Chromium/Chrome: Navigate to `http://localhost:8080/`.
3. Click **"Track in Violentmonkey"** for the script you are developing.
4. In the Violentmonkey installation tab that opens:
   - Check **"Track external edits"** (enables Violentmonkey ETag polling of local files).
   - Check **"Reload tab"** (automatically reloads the active webpage when you save).
   - Keep the tab open while editing in `src/*.user.js`.
5. Mandatory cleanup when testing concludes:

   ```bash
   node tools/dev_server.js --kill
   manage_task kill
   ```

## Branching, Commits & Release

- **Branch Naming**: `<slug>/<type>/<desc>` off `dev` branch.
- **Atomic Commits**: Conventional commits (`<type>(<slug>): <summary>`).
- **Release Execution**:

  ```bash
  python tools/workflow.py release --non-interactive --push
  ```

  Validates versions, rebases onto `main`, inlines shared libraries (`lib/`), and synchronizes standalone bundles to `dist`.

- **Publishing Assistant**:

  ```bash
  python tools/workflow.py publish-info "<Script Name>" [--greasyfork-id <id>]
  ```

  Displays Greasy Fork sync URLs and generates formatted Discourse forum announcement drafts with `[grid]` screenshot galleries.

## Reference Documents

1. [Userscript API Grant Architecture & Sandbox Nuances](references/userscript_grant_architecture.md): Detailed breakdown of `@grant` permissions, GM storage isolation, cross-tab synchronization patterns, and security best practices.
2. [Violentmonkey Extension Architecture & Storage Nuances](references/violentmonkey_architecture.md): Internal storage model, LevelDB namespaces, and messaging protocol.

