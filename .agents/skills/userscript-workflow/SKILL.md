---
name: userscript-workflow
description: Userscript lifecycle, menu registration patterns, HTTP dev server file tracking, read-only Violentmonkey MCP diagnostics, and release management.
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

Sync all script changes (new scripts and multi-file edits) through the local HTTP dev server with Violentmonkey's native **"Track external edits"**:

1. **Start the local dev server**:

   ```bash
   node tools/dev_server.js
   ```

2. **Check which modified scripts need tracking** (when `violentmonkey` read-only MCP is connected):
   - Call `scripts_list` to check which modified scripts already have an active `-dev.` `@version` (meaning file tracking is already active for them).
   - Present only the untracked scripts (with their `http://localhost:8080/` dashboard link) for the user to click **"Track in Violentmonkey"** once.
3. **In the Violentmonkey installation tab** (first-time setup per script):
   - Check **"Track external edits"** (enables ETag polling of `src/` and `lib/`).
   - Check **"Reload tab"** (automatically reloads the active webpage on save).
   - Keep the tracking tab open while editing `src/*.user.js` or `lib/*.js`.
4. **Verify live behavior**:
   - Open or reload target tabs via `chrome-devtools` and check console/DOM state (plus read-only `script_logs` / `scripts_test_match` if needed).
5. **Mandatory cleanup when testing concludes**:

   ```bash
   node tools/dev_server.js --kill
   ```

   Also stop any background dev-server task (`manage_task kill`).

## Branching, Commits & Release

- **Branch Naming**: `<slug>/<type>/<desc>` off `dev` branch.
- **Atomic Commits**: Conventional commits (`<type>(<slug>): <summary>`).
- **Release Execution**:

  ```bash
  python tools/workflow.py release --non-interactive --push
  ```

  Validates versions, rebases onto `main`, and pushes to `main` (GitHub Actions then inlines shared libraries and syncs `dist`).

- **Publishing Assistant**:

  ```bash
  python tools/workflow.py publish-info "<Script Name>" [--greasyfork-id <id>]
  ```

  Displays Greasy Fork sync URLs and generates formatted Discourse forum announcement drafts with `[grid]` screenshot galleries.

## Reference Documents

1. [Userscript API Grant Architecture & Sandbox Nuances](references/userscript_grant_architecture.md): Detailed breakdown of `@grant` permissions, GM storage isolation, cross-tab synchronization patterns, and security best practices.
2. [Violentmonkey Extension Architecture & Storage Nuances](references/violentmonkey_architecture.md): Internal storage model, LevelDB namespaces, and messaging protocol.

