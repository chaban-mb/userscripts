---
name: git-workflow
description: >-
  Git branching, atomic conventional commits, SemVer versioning, GitHub CLI
  operations, and release execution (`tools/workflow.py release`). Use when
  creating branches, committing changes, bumping `@version`, interacting with
  GitHub PRs/issues, or releasing scripts to `main`.
---

# Git Workflow & Release

## Branching & Commits

- **Active Development**: Commit bugfixes, maintenance, and small self-contained changes directly on `dev`.
- **Topic Branches**: Create `<slug>/<type>/<short-description>` off `dev` (e.g., `harmony-enhancements/feat/schema-codec-engine`) for large multi-step features, complex refactors, or when requested. Keep `main` and `dist` untouched by direct commits.
- **Atomic Commits**: Keep each commit to one logical change. Isolate structural refactoring into dedicated `refactor(<scope>)` commits, separate from `fix` or `feat` changes.
- **Conventional Commits**: Format subjects as `<type>(<scope>): <summary>`.
  - **Scopes**: Use the canonical script slug from [`references/commit-scopes.md`](references/commit-scopes.md) or infrastructure scopes (`tools`, `workflow`, `dist`, `docs`, `repo`, `lib`).
  - **Clean Subjects**: Focus feature/fix subjects strictly on the functional change; keep version bumps in their own commit or let `workflow.py release` fold them.

## GitHub Interaction

Use the `gh` and `git` CLI tools for all GitHub operations (PRs, issues, releases, checks) instead of direct API calls or scraping.

## Versioning & SemVer

- Update `// @version` in the script's metadata header before releasing.
- **Timing**: Bump versions only at the start or end of work on a topic branch; keep intermediate commits at the same version.
- **SemVer**:
  - **Major** (`1.0.0` -> `2.0.0`): incompatible UI/behavior changes or complete rewrite.
  - **Minor** (`1.0.0` -> `1.1.0`): new features or backwards-compatible enhancements.
  - **Patch** (`1.0.0` -> `1.0.1`): bug fixes and minor internal adjustments.
- **Manual Bump Commit**: `chore(<script-slug>): bump version to x.y.z`. When releasing with `workflow.py release`, version bumps fold automatically into the latest unpushed script commit via `--fixup` rebase.

## Release Execution

```bash
python tools/workflow.py release --non-interactive --push
```

Validates `@version` headers, rebases onto `main`, and pushes to `main` (GitHub Actions then inlines shared libraries and syncs the `dist` branch).

**Done when:** Changes are committed with valid conventional commit scopes on `dev` or a topic branch, or for a release, `tools/workflow.py release` exits cleanly and pushes to `main`.
