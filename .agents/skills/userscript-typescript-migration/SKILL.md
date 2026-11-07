---
name: userscript-typescript-migration
description: Systemic migration of JavaScript userscript repositories to modular TypeScript, multi-entry bundlers (vite-plugin-monkey), suite consolidation, and automated Greasy Fork distribution.
---

# Userscript TypeScript Migration & Suite Architecture

This skill provides the end-to-end engineering methodology for transforming a flat, multi-script JavaScript userscript repository into a modular TypeScript monorepo with automated bundling, suite consolidation, and clean distribution.

## Core Principles

1. **Parity First (Zero Functional Change during Refactor)**:
   - Never mix behavioral changes (`fix`, `feat`) with structural migrations (`refactor`).
   - Before converting any script to TypeScript, lock its behavior with an offline unit test or DOM fixture.
   - Initial TypeScript conversion must produce identical DOM interactions and API payloads.

2. **GitHub for Source, Greasy Fork for Distribution**:
   - **GitHub**: Houses pure TypeScript source (`src/`), shared libraries (`src/shared/`), unit test fixtures (`tests/`), and build tooling. No compiled artifacts (`dist/`) are committed to working git branches.
   - **Greasy Fork & GitHub Releases**: Serve compiled, standalone, and suite bundles (`dist/*.user.js`) with inlined dependencies and auto-generated userscript headers.

3. **Dual-Output Architecture (Suites vs. Standalones)**:
   - Group related micro-scripts into thematic **Suites** (e.g., *ISRC Suite*, *Edit Reviewer Suite*, *Release Editor Suite*).
   - Export both an all-in-one suite script (with modular toggle settings) and tree-shaken standalone micro-scripts from the exact same TypeScript modules.

---

## Tooling & Bundling: `vite-plugin-monkey`

`vite-plugin-monkey` is the standard engine for TypeScript userscripts:

### Installation

```bash
npm install -D vite vite-plugin-monkey typescript @types/tampermonkey
```

### Typical `vite.config.ts` Multi-Entry Setup

```typescript
import { defineConfig } from 'vite';
import monkey, { cdn } from 'vite-plugin-monkey';

export default defineConfig({
  plugins: [
    monkey({
      entry: 'src/suites/isrc-suite/index.ts',
      userscript: {
        name: 'MusicBrainz ISRC Suite',
        namespace: 'https://github.com/chaban-mb/userscripts',
        match: [
          'https://*.musicbrainz.org/*',
          'https://*.harmony.murdos-soft.com/*'
        ],
        grant: [
          'GM_getValue',
          'GM_setValue',
          'GM_registerMenuCommand',
          'GM_xmlhttpRequest'
        ],
        runAt: 'document-end',
      },
      build: {
        fileName: 'mb-isrc-suite.user.js'
      }
    }),
  ],
});
```

---

## Step-by-Step Migration Phases

### Phase 0: Baseline & Test Locking

1. Ensure all in-flight git branches are merged or stashed.
2. For the target script or cluster, write or verify an offline test fixture in `tests/test_<name>.js` (or `.ts`).
3. Document all DOM selectors and `@grant` requirements.

### Phase 1: Shared Core Foundation (`src/shared/`)

Extract universal utilities to prevent duplication:

- `src/shared/dom/`: `waitForElement`, `observeMutations`, `h` (hyperscript / DOM creation).
- `src/shared/api/`: Typed MusicBrainz API client, rate limiting queue (>= 1.0s delay), exponential backoff.
- `src/shared/storage/`: Type-safe wrappers around `GM_getValue` / `GM_setValue` with fallback to `localStorage`.
- `src/shared/types/`: Interfaces for MusicBrainz entities (Artist, Release, Medium, Track, Recording, ISRC, Edit).

### Phase 2: Pilot Script Conversion

1. Rename target file to `.ts`.
2. Enable strict type checking (`strict: true`, `noImplicitAny: true`).
3. Replace regex-based inlining (`build_dist.py`) with native ES module `import`.
4. Build dist bundle and verify with `node tests/<test_file>.js`.
5. Test live in Chromium via dev server / Violentmonkey MCP.

### Phase 3: Suite Consolidation

For scripts operating on similar pages or sharing domain logic:

1. Extract individual script actions into modular functions (`registerFeatureA()`, `registerFeatureB()`).
2. Create a Suite Controller with a GM menu or modal setting dialog where users can toggle features on/off.
3. Keep standalone entrypoints alive so individual builds remain available on Greasy Fork for users who want single features.

### Phase 4: CI/CD & Greasy Fork Release Automation

1. Set up a GitHub Action on tag push (`v*.*.*`):
   - Runs `npm run typecheck` and `npm test`.
   - Runs `npm run build` to generate all `dist/*.user.js`.
   - Creates a GitHub Release with attached `.user.js` assets.
   - Syncs to Greasy Fork via webhook or `greasyfork-deploy` action.

## Reference Documents

1. [TypeScript Monorepo & Modern Build Architecture (rainz-box)](references/typescript_monorepo_build_architecture.md)
