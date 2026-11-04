---
name: violentmonkey-mcp
description: >-
  Workflows, authorization protocol, script deployment, and match verification
  using the Violentmonkey MCP server (@violentmonkey/mcp).
---

# Violentmonkey MCP Workflow

Guides using Violentmonkey's Model Context Protocol (MCP) server for deploying and testing userscripts.

## Triggers
Activate when:
- Deploying userscripts from `src/*.user.js` (`scripts_write`).
- Inspecting installed scripts (`scripts_list`, `scripts_get`).
- Verifying `@match` and `@exclude` evaluation (`scripts_test_match`).
- Resolving connection issues (`vm_status`).

---

## Authorization Protocol

Requires one manual approval per browser session:

1. **Check Status**: Call `vm_status`. If `connected: true`, proceed.
2. **Open Authorization Tab**: If `connected: false`, open `connectUrl` via `new_page({ url: connectUrl })`.
   > [!NOTE]
   > Navigation reports `net::ERR_ABORTED`. This is normal—the extension intercepts the request and redirects to `chrome-extension://<id>/options/index.html#settings/mcp`.
3. **Prompt User**: Ask the user:
   > *"I opened the Violentmonkey authorization tab. Please click **`[Approve]`** in settings to connect."*
4. **Verify & Cleanup**: Call `vm_status` to verify `connected: true`, then close the tab with `close_page`.

---

## Script Deployment & Verification

### 1. Deploy Script (`scripts_write`)
- Call `scripts_write({ id, code })` (or omit `id` to match by `@name` and `@namespace`).
- Pass full userscript source including `==UserScript==` block.

### 2. Verify Matching (`scripts_test_match`)
- Test positive URLs return `matched: true`.
- Test excluded URLs return `matched: false`.

> [!IMPORTANT]
> **`@exclude` Glob Nuance**:
> While `@match` covers the apex domain with `*.`, `@exclude` uses glob matching where `*.` requires a subdomain. Use `*://*domain.tld/*` to match both apex and subdomains.
