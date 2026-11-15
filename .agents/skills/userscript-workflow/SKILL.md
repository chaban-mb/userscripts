---
name: userscript-workflow
description: >-
  Manages userscript scaffolding (`tools/workflow.py init`), `GM.registerMenuCommand`
  patterns, `@grant` architecture, and Greasy Fork publishing info. Use when
  initializing a new userscript, registering GM menu commands, or generating
  publishing announcements.
---

# Userscript Workflow & Lifecycle

Manager-agnostic procedures for scaffolding, menu commands, and publishing userscripts.

- **Testing in Violentmonkey**: Use the `violentmonkey` skill for `dev_server.js` live-sync, *"Track external edits"*, and Violentmonkey MCP diagnostics.
- **Git, Commits & Release**: Use the `git-workflow` skill for branching, conventional commits, SemVer bumps, and `tools/workflow.py release`.

## Scaffolding

Initialize a new userscript from the repository template:

```bash
python tools/workflow.py init "<Script Name>" [--description "..."] [--branch]
```

This automatically:

- Scaffolds `src/<Script Name>.user.js` from `templates/userscript.template.js` with complete metadata headers.
- Scaffolds `docs/descriptions/<Script Name>.md` from `templates/description.template.md`.
- Registers the canonical slug in [`.agents/skills/git-workflow/references/commit-scopes.md`](../git-workflow/references/commit-scopes.md).
- Optionally creates and checks out the topic branch `<slug>/feat/initial-setup` off `dev`.

**Done when:** `src/<Script Name>.user.js` and `docs/descriptions/<Script Name>.md` exist and the slug is registered in `commit-scopes.md`.

## Menu Commands (`GM.registerMenuCommand`)

Use ballot box iconography for toggle states and dynamic re-registration:

- **Active / Enabled**: `☑ <Command Label>` (U+2611)
- **Inactive / Disabled**: `☐ <Command Label>` (U+2610)
- **Value Displays**: `<Setting Name>: <Value>` (e.g. `Theme: Dark`)

Read [`references/userscript_grant_architecture.md`](references/userscript_grant_architecture.md) when debugging `@grant` permissions, GM storage isolation, or cross-tab sync; skip for simple DOM/UI scripts.

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

## Publishing Assistant

```bash
python tools/workflow.py publish-info "<Script Name>" [--greasyfork-id <id>]
```

Displays Greasy Fork sync URLs and generates formatted Discourse forum announcement drafts with `[grid]` screenshot galleries.

**Done when:** `publish-info` outputs the Greasy Fork sync URLs and announcement draft.
