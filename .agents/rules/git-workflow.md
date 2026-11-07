---
trigger: model_decision
description: Git branching rules, conventional commit scopes, SemVer standards, and repository safety policies.
---

# Git Workflow & Commit Guidelines

## Rules

### Branching & Commits

- Active development, feature integration, and testing happens on the `dev` branch.
- Topic branches follow the naming pattern: `<slug>/<type>/<short-description>` (e.g., `harmony-enhancements/feat/schema-codec-engine` or `guesscase-improver/refactor/transformation-engine`).
- **Atomic Commits & Separation of Concerns**: Ensure each commit represents exactly one logical change. Never bundle opportunistic refactoring with bug fixes (`fix`) or features (`feat`). Keep bug fixes strictly surgical and isolate structural improvements into dedicated `refactor(<scope>)` commits.
- Follow the Conventional Commits specification:
  - **Scopes**: Must match the canonical script slug defined in [commit-scopes.md](references/commit-scopes.md) or infrastructure scopes (`tools`, `workflow`, `dist`, `docs`, `repo`, `lib`).
  - **No Version Numbers in Subject**: Never include version bumps in feature/fix subject lines (e.g. do **not** write `fix(scope): fix bug and bump version to 1.2.3`). Focus the subject line strictly on the functional change. Dedicated version bumps use `chore(<scope>): bump version to x.y.z` or are folded via fixup rebase during release.

### GitHub Interaction

- Always use the `gh` and `git` CLI apps when interacting with GitHub or GitHub URLs. Do not attempt direct API calls or scraping for GitHub actions.

### Versioning & SemVer

- Prior to releasing, update the `// @version` field in the userscript's metadata header.
- **Timing**: Version bumps must only occur at the start or the end of work on a topic branch. Do not increment version numbers in intermediate or debugging commits on a topic branch.
- Use standard SemVer:
  - **Major** (e.g., `1.0.0` -> `2.0.0`): incompatible UI/behavior changes or complete rewrite.
  - **Minor** (e.g., `1.0.0` -> `1.1.0`): new features or backwards-compatible enhancements.
  - **Patch** (e.g., `1.0.0` -> `1.0.1`): bug fixes and minor internal adjustments.
- When committing manually: `chore(<script-slug>): bump version to x.y.z`.
- When using `workflow.py release`, version bumps are automatically folded into the latest unpushed script commit via `--fixup` rebase.

### Release Execution

- The complete step-by-step release, dist distribution synchronization, and branch cleanup workflow is documented and executed via the [userscript-workflow](../skills/userscript-workflow/SKILL.md#branching-commits--release) skill (`python tools/workflow.py release --non-interactive --push`).
