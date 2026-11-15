# Userscripts

## Core Invariants

- Edit Target: Edit `src/*.user.js` and `lib/*.js`. Never edit `dist/` directly (generated via `tools/build_dist.py`).
- Git Branches: Work and commit directly on `dev` for bugfixes, maintenance, and small self-contained changes. Only create a dedicated branch (`<slug>/<type>/<desc>` off `dev`) for large multi-step features, complex refactors, or when explicitly requested. Never commit directly to `main` or `dist`.
- Commits: Atomic conventional (`<type>(<slug>): <summary>`), using the script or tool slug (e.g. `mb-align-info-links`, `tools`).
- Upstream URLs: Preserve existing `@updateURL` and `@downloadURL`. Bump versions via `tools/workflow.py release`.
