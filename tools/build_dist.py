#!/usr/bin/env python3
import os
import re
import sys
import subprocess
import shutil
import tempfile
from dataclasses import dataclass, field
from pathlib import Path

# Paths
REPO_ROOT = Path(__file__).resolve().parent.parent
SRC_DIR = REPO_ROOT / "src"
LIB_DIR = REPO_ROOT / "lib"

REQUIRE_RE = re.compile(r'^[ \t]*//[ \t]*@require[ \t]+(?:\.\./)?lib/([^\s]+)', re.MULTILINE)
USERSCRIPT_HEADER_RE = re.compile(r'//[ \t]*==UserScript==.*?//[ \t]*==/UserScript==\s*', re.DOTALL)
CLOSURE_START_RE = re.compile(r'(\(\s*function\s*\([^)]*\)\s*\{|\(\s*\(\)\s*=>\s*\{)')
VERSION_RE = re.compile(r'^[ \t]*//[ \t]*@version[ \t]+(\S+)', re.MULTILINE)
VERSION_BUMP_SUBJECT_RE = re.compile(r'^chore(?:\([^)]+\))?:\s*bump version\b', re.IGNORECASE)


def extract_version(script_text):
    """Extracts the @version metadata value from a userscript header, or None."""
    match = VERSION_RE.search(script_text)
    return match.group(1).strip() if match else None


def _git_output(args, check=True):
    """Runs a git command and returns CompletedProcess with UTF-8 text output."""
    return subprocess.run(
        ["git", *args],
        capture_output=True, text=True, check=check, encoding="utf-8"
    )


def verify_version_bumps(main_branch, dist_branch):
    """Ensures new scripts have @version and modified scripts bumped @version relative to dist."""
    main_tip_hash = _git_output(["rev-parse", main_branch]).stdout.strip()
    main_ls = _git_output(["ls-tree", "-r", "--name-only", main_branch, "--", "src/"])
    expected_scripts = [
        line.strip() for line in main_ls.stdout.splitlines()
        if line.strip().endswith(".user.js")
    ]

    lib_cache = {}
    missing_version = []
    unbumped = []
    for script_path in sorted(expected_scripts):
        main_res = _git_output(["show", f"{main_branch}:{script_path}"], check=False)
        if main_res.returncode != 0:
            continue

        main_ver = extract_version(main_res.stdout)
        dist_res = _git_output(["show", f"{dist_branch}:{script_path}"], check=False)
        if dist_res.returncode != 0:
            if not main_ver:
                missing_version.append(script_path)
            continue

        expected_inlined, _ = inline_script_content(
            main_res.stdout,
            commit_hash=main_tip_hash,
            lib_cache=lib_cache
        )
        if expected_inlined == dist_res.stdout:
            continue

        dist_ver = extract_version(dist_res.stdout)
        if not main_ver or main_ver == dist_ver:
            unbumped.append((script_path, dist_ver))

    if missing_version or unbumped:
        if missing_version:
            print(f"Error: {len(missing_version)} new script(s) on '{main_branch}' are missing @version:", file=sys.stderr)
            for path in missing_version:
                print(f"  - {path}", file=sys.stderr)
        if unbumped:
            print(f"Error: {len(unbumped)} modified script(s) on '{main_branch}' have not bumped @version relative to '{dist_branch}':", file=sys.stderr)
            for path, ver in unbumped:
                print(f"  - {path} (still @version {ver})", file=sys.stderr)
        return False
    return True

def clean_lib_content(lib_text):
    """Strips the UserScript header from library file so only the executable code remains."""
    return USERSCRIPT_HEADER_RE.sub('', lib_text).strip()

def inline_script_content(script_text, repo_root=REPO_ROOT, commit_hash=None, lib_cache=None, rewrite_urls=True):
    """
    Finds relative @require directives pointing to lib/ in script_text,
    removes the @require line from metadata, and inlines the library code into the script.
    """
    matches = list(REQUIRE_RE.finditer(script_text))
    inlined_libs = []
    lib_codes = []

    for match in matches:
        lib_filename = match.group(1)
        raw_lib_text = None

        if lib_cache is not None and lib_filename in lib_cache:
            raw_lib_text = lib_cache[lib_filename]
        elif commit_hash:
            res = subprocess.run(
                ["git", "show", f"{commit_hash}:lib/{lib_filename}"],
                capture_output=True, text=True, encoding="utf-8"
            )
            if res.returncode == 0:
                raw_lib_text = res.stdout
                if lib_cache is not None:
                    lib_cache[lib_filename] = raw_lib_text

        if raw_lib_text is None:
            lib_path = Path(repo_root) / "lib" / lib_filename
            if lib_path.exists():
                with open(lib_path, 'r', encoding='utf-8') as f:
                    raw_lib_text = f.read()

        if raw_lib_text is None:
            print(f"Warning: Library file not found: lib/{lib_filename}")
            continue

        cleaned_lib = clean_lib_content(raw_lib_text)
        lib_codes.append(f"    // --- Inlined Library: lib/{lib_filename} ---\n{cleaned_lib}\n    // --- End Inlined Library ---")
        inlined_libs.append(lib_filename)

    # Always update @updateURL and @downloadURL to point to dist branch
    transformed_text = script_text
    if rewrite_urls:
        transformed_text = re.sub(r'(/raw/)main(/src/)', r'\g<1>dist\g<2>', transformed_text)

    # Remove all relative lib @require directives
    transformed_text = REQUIRE_RE.sub('', transformed_text)
    # Clean any potential extra blank lines left in header
    transformed_text = re.sub(r'(\r?\n){3,}', r'\n\n', transformed_text)

    combined_lib_code = "\n\n".join(lib_codes) if lib_codes else ""

    if combined_lib_code:
        # Check if there is an IIFE closure (e.g. (function () { 'use strict'; ...)
        closure_match = CLOSURE_START_RE.search(transformed_text)
        if closure_match:
            idx = closure_match.end()
            # Check if 'use strict' immediately follows
            use_strict_match = re.match(r"\s*('use strict'|\"use strict\");?", transformed_text[idx:])
            if use_strict_match:
                insert_pos = idx + use_strict_match.end()
                transformed_text = transformed_text[:insert_pos] + "\n\n" + combined_lib_code + "\n" + transformed_text[insert_pos:]
            else:
                transformed_text = transformed_text[:idx] + "\n" + combined_lib_code + "\n" + transformed_text[idx:]
        else:
            # Append after the UserScript header
            header_end = transformed_text.find('// ==/UserScript==')
            if header_end != -1:
                line_end = transformed_text.find('\n', header_end)
                if line_end != -1:
                    transformed_text = transformed_text[:line_end + 1] + "\n" + combined_lib_code + "\n\n" + transformed_text[line_end + 1:]
                else:
                    transformed_text = transformed_text + "\n\n" + combined_lib_code
            else:
                transformed_text = combined_lib_code + "\n\n" + transformed_text

    return transformed_text, inlined_libs

def inline_userscript(src_path, repo_root=REPO_ROOT, rewrite_urls=True):
    """Reads a userscript from src_path, inlines any local @require lib/ dependencies, and returns the inlined content."""
    path_obj = Path(src_path)
    if not path_obj.is_absolute():
        path_obj = Path(repo_root) / path_obj
    if not path_obj.exists():
        raise FileNotFoundError(f"Userscript not found: {path_obj}")
    text = path_obj.read_text(encoding='utf-8')
    inlined_content, _ = inline_script_content(text, repo_root=repo_root, rewrite_urls=rewrite_urls)
    return inlined_content

def build_all_inlined_scripts(output_dir, source_root=REPO_ROOT):
    """Reads all src/*.user.js from source_root, inlines libraries, and writes them to output_dir/src/."""
    source_src = Path(source_root) / "src"
    output_src = Path(output_dir) / "src"
    output_src.mkdir(parents=True, exist_ok=True)

    results = {}
    for script_path in source_src.glob("*.user.js"):
        with open(script_path, 'r', encoding='utf-8') as f:
            content = f.read()

        inlined_content, libs = inline_script_content(content, repo_root=source_root)
        out_file = output_src / script_path.name
        with open(out_file, 'w', encoding='utf-8') as f:
            f.write(inlined_content)

        results[script_path.name] = libs

    return results

def find_commits_to_sync(main_branch="main", dist_branch="dist", with_mode=False):
    """
    Finds commits on main_branch that modified src/ or lib/ and need to be synced to dist_branch.
    Matches the latest commit on dist against main_branch commit history and replays
    non-merge commits individually so each script preserves its own changelog on Greasy Fork.
    """
    dist_log = subprocess.run(
        ["git", "log", "-50", "--format=%s|||%ad", dist_branch],
        capture_output=True, text=True, check=True, encoding="utf-8"
    ).stdout.strip().splitlines()

    main_log = subprocess.run(
        ["git", "log", "-200", "--format=%H|||%s|||%ad", main_branch],
        capture_output=True, text=True, check=True, encoding="utf-8"
    ).stdout.strip().splitlines()

    matched_main = None
    for dist_line in dist_log:
        if not dist_line.strip():
            continue
        parts = dist_line.split("|||")
        if len(parts) != 2:
            continue
        d_sub, d_date = parts
        for main_line in main_log:
            m_parts = main_line.split("|||")
            if len(m_parts) != 3:
                continue
            m_hash, m_sub, m_date = m_parts
            if m_sub == d_sub and m_date == d_date:
                matched_main = m_hash
                break
        if matched_main:
            break

    tip = subprocess.run(
        ["git", "rev-parse", main_branch],
        capture_output=True, text=True, check=True, encoding="utf-8"
    ).stdout.strip()

    if matched_main:
        log_range = f"{matched_main}..{main_branch}"
        commits = subprocess.run(
            ["git", "log", log_range, "--reverse", "--no-merges", "--format=%H", "--", "src/", "lib/"],
            capture_output=True, text=True, check=True, encoding="utf-8"
        ).stdout.strip().splitlines()
        clean_commits = [c.strip() for c in commits if c.strip()]
        return (clean_commits, False) if with_mode else clean_commits
    else:
        clean_commits = [tip] if tip else []
        return (clean_commits, True) if with_mode else clean_commits

@dataclass
class CommitPlanEntry:
    commit_hash: str
    full_sync: bool
    subject: str
    body: str
    author: str
    date: str
    scripts_to_update: set[str]
    scripts_to_delete: set[str]
    libs_changed: set[str] = field(default_factory=set)
    source_commits: dict[str, str] = field(default_factory=dict)


def _is_pure_version_bump_for_script(commit_hash, script_path):
    """Returns True if commit_hash only modified @version in script_path."""
    before = _git_output(["show", f"{commit_hash}^:{script_path}"], check=False)
    after = _git_output(["show", f"{commit_hash}:{script_path}"], check=False)
    if before.returncode != 0 or after.returncode != 0:
        return False
    return VERSION_RE.sub("", before.stdout) == VERSION_RE.sub("", after.stdout)


def _collect_commit_changes(commit_hash, full_sync=False):
    """Collects metadata and affected userscripts for a single commit on main."""
    subject = _git_output(["log", "-1", "--format=%s", commit_hash]).stdout.strip()
    body = _git_output(["log", "-1", "--format=%b", commit_hash]).stdout.strip()
    author = _git_output(["log", "-1", "--format=%an <%ae>", commit_hash]).stdout.strip()
    date = _git_output(["log", "-1", "--format=%ad", commit_hash]).stdout.strip()

    scripts_to_update = set()
    scripts_to_delete = set()
    libs_changed = set()

    if full_sync:
        ls_res = _git_output(["ls-tree", "-r", "--name-only", commit_hash, "--", "src/"])
        scripts_to_update = {line.strip() for line in ls_res.stdout.splitlines() if line.strip().endswith(".user.js")}
    else:
        diff_res = _git_output(
            ["diff-tree", "--root", "--no-commit-id", "--name-status", "--no-renames", "-r", "-m", commit_hash, "--", "src/", "lib/"]
        )
        for line in diff_res.stdout.splitlines():
            parts = line.strip().split(maxsplit=1)
            if len(parts) != 2:
                continue
            status, file_path = parts[0], parts[1].replace("\\", "/")
            if file_path.startswith("src/") and file_path.endswith(".user.js"):
                if status == "D":
                    scripts_to_delete.add(file_path)
                else:
                    scripts_to_update.add(file_path)
            elif file_path.startswith("lib/"):
                libs_changed.add(Path(file_path).name)

        for lib_name in libs_changed:
            grep_res = _git_output(["grep", "-l", f"lib/{lib_name}", commit_hash, "--", "src/"], check=False)
            if grep_res.returncode != 0:
                continue
            for match_line in grep_res.stdout.splitlines():
                _, _, matched_path = match_line.strip().partition(":")
                matched_path = matched_path.replace("\\", "/").strip()
                if matched_path.startswith("src/") and matched_path.endswith(".user.js"):
                    scripts_to_update.add(matched_path)

    return CommitPlanEntry(
        commit_hash=commit_hash,
        full_sync=full_sync,
        subject=subject,
        body=body,
        author=author,
        date=date,
        scripts_to_update=scripts_to_update,
        scripts_to_delete=scripts_to_delete,
        libs_changed=libs_changed,
    )


def _fold_version_bumps(plan):
    """Folds pure version-bump commits into each script's latest preceding substantive commit."""
    for idx, entry in enumerate(plan):
        if entry.scripts_to_delete or entry.libs_changed or not VERSION_BUMP_SUBJECT_RE.match(entry.subject):
            continue

        for script_path in list(entry.scripts_to_update):
            if not _is_pure_version_bump_for_script(entry.commit_hash, script_path):
                continue
            for prev_idx in range(idx - 1, -1, -1):
                prev_entry = plan[prev_idx]
                if VERSION_BUMP_SUBJECT_RE.match(prev_entry.subject):
                    continue
                if script_path in prev_entry.scripts_to_update:
                    prev_entry.source_commits[script_path] = entry.commit_hash
                    entry.scripts_to_update.discard(script_path)
                    break

    return [e for e in plan if e.scripts_to_update or e.scripts_to_delete or e.full_sync]


def sync_dist_branch(main_branch="main", dist_branch="dist"):
    """
    Builds inlined userscripts from main_branch onto a dedicated dist branch,
    ensuring that the commit message history reflects the substantive changes
    from main (including script updates and shared lib updates).
    Replays each commit from main that touches src/ or lib/ incrementally.
    Uses a temporary git worktree to avoid switching branches in the main working tree.
    """
    # Check if dist branch exists locally or on remote
    branches = subprocess.run(["git", "branch", "--list", dist_branch], capture_output=True, text=True, check=True).stdout.strip()
    dist_exists = bool(branches)

    if not dist_exists:
        remote_branch = subprocess.run(["git", "rev-parse", "--verify", f"origin/{dist_branch}"], capture_output=True, text=True)
        if remote_branch.returncode == 0:
            subprocess.run(["git", "branch", "--track", dist_branch, f"origin/{dist_branch}"], check=True)
            dist_exists = True

    if not dist_exists:
        # Create a true orphan root commit containing only inlined scripts
        print(f"Creating true orphan '{dist_branch}' branch with initial standalone userscripts...")
        main_author = subprocess.run(["git", "log", "-1", "--format=%an <%ae>", main_branch], capture_output=True, text=True, check=True, encoding="utf-8").stdout.strip()
        main_date = subprocess.run(["git", "log", "-1", "--format=%ad", main_branch], capture_output=True, text=True, check=True, encoding="utf-8").stdout.strip()
        author_name = subprocess.run(["git", "log", "-1", "--format=%an", main_branch], capture_output=True, text=True, check=True, encoding="utf-8").stdout.strip()
        author_email = subprocess.run(["git", "log", "-1", "--format=%ae", main_branch], capture_output=True, text=True, check=True, encoding="utf-8").stdout.strip()

        with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as init_wt_dir:
            env = os.environ.copy()
            env["GIT_AUTHOR_NAME"] = author_name
            env["GIT_AUTHOR_EMAIL"] = author_email
            env["GIT_COMMITTER_NAME"] = author_name
            env["GIT_COMMITTER_EMAIL"] = author_email

            # 1. Create an empty root commit (no parent commit)
            tree_empty = subprocess.run(["git", "mktree"], input="", text=True, capture_output=True, check=True).stdout.strip()
            root_commit = subprocess.run([
                "git", "commit-tree", tree_empty,
                "-m", "chore(dist): initialize standalone userscripts"
            ], env=env, capture_output=True, text=True, check=True).stdout.strip()

            # 2. Point dist branch to this root commit
            subprocess.run(["git", "branch", dist_branch, root_commit], check=True)
            subprocess.run(["git", "worktree", "add", init_wt_dir, dist_branch], check=True)
            try:
                build_all_inlined_scripts(init_wt_dir, source_root=Path.cwd())
                subprocess.run(["git", "-C", init_wt_dir, "add", "-A"], check=True)
                subprocess.run([
                    "git", "-C", init_wt_dir, "commit", "--amend",
                    "-m", "chore(dist): initialize standalone userscripts",
                    "--author", main_author,
                    "--date", main_date
                ], env=env, check=True)
                print(f"Successfully initialized clean orphan '{dist_branch}' branch.")
                return True
            finally:
                subprocess.run(["git", "worktree", "remove", "--force", init_wt_dir], capture_output=True)
                subprocess.run(["git", "worktree", "prune"], capture_output=True)

    commits_to_sync, is_full_sync = find_commits_to_sync(main_branch, dist_branch, with_mode=True)
    if not commits_to_sync:
        print(f"Branch '{dist_branch}' is already up-to-date with '{main_branch}'. No new commit needed.")
        return True

    if not verify_version_bumps(main_branch, dist_branch):
        return False

    print(f"Found {len(commits_to_sync)} commit(s) from '{main_branch}' to sync to '{dist_branch}'.")

    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as worktree_dir:
        subprocess.run(["git", "worktree", "add", worktree_dir, dist_branch], check=True)
        try:
            wt_path = Path(worktree_dir)
            wt_src = wt_path / "src"
            wt_src.mkdir(parents=True, exist_ok=True)

            commit_plan = _fold_version_bumps([
                _collect_commit_changes(commit_hash, full_sync=(is_full_sync and idx == 0))
                for idx, commit_hash in enumerate(commits_to_sync)
            ])

            committed_count = 0
            for entry in commit_plan:
                if entry.full_sync:
                    existing_names = {p.name for p in wt_src.glob("*.user.js")}
                    expected_names = {Path(s).name for s in entry.scripts_to_update}
                    for removed_name in (existing_names - expected_names):
                        (wt_src / removed_name).unlink(missing_ok=True)

                for del_script in entry.scripts_to_delete:
                    target = wt_src / Path(del_script).name
                    if target.exists():
                        target.unlink()
                    entry.scripts_to_update.discard(del_script)

                if entry.scripts_to_update:
                    lib_cache = {}
                    for script_path in sorted(entry.scripts_to_update):
                        src_commit = entry.source_commits.get(script_path, entry.commit_hash)
                        show_res = subprocess.run(
                            ["git", "show", f"{src_commit}:{script_path}"],
                            capture_output=True, text=True, encoding="utf-8"
                        )
                        if show_res.returncode != 0:
                            continue
                        inlined_content, _ = inline_script_content(
                            show_res.stdout,
                            commit_hash=src_commit,
                            lib_cache=lib_cache if src_commit == entry.commit_hash else None
                        )
                        target = wt_src / Path(script_path).name
                        target.write_text(inlined_content, encoding="utf-8")

                subprocess.run(["git", "-C", worktree_dir, "add", "-A"], check=True)

                diff_cached = subprocess.run(["git", "-C", worktree_dir, "diff", "--cached", "--quiet"], capture_output=True)
                if diff_cached.returncode != 0:
                    commit_msg = entry.subject
                    if entry.body:
                        commit_msg += f"\n\n{entry.body}"

                    print(f"Committing inlined scripts on '{dist_branch}': '{entry.subject}'...")
                    env = os.environ.copy()
                    subprocess.run([
                        "git", "-C", worktree_dir, "commit",
                        "-m", commit_msg,
                        "--author", entry.author,
                        "--date", entry.date
                    ], env=env, check=True)
                    committed_count += 1

            # --- MANDATORY SAFETY INVARIANT: Verify 100% parity with main_branch at HEAD ---
            # Regardless of incremental replay path, ensure the final files on dist EXACTLY match
            # what main has at HEAD. This prevents any possibility of skipped files, missed merge
            # commits, or downgraded userscripts reaching Greasy Fork.
            main_ls = subprocess.run(
                ["git", "ls-tree", "-r", "--name-only", main_branch, "--", "src/"],
                capture_output=True, text=True, check=True, encoding="utf-8"
            )
            expected_scripts = {l.strip() for l in main_ls.stdout.splitlines() if l.strip().endswith(".user.js")}
            actual_scripts = {f"src/{p.name}" for p in wt_src.glob("*.user.js")}

            reconciled_any = False
            # 1. Remove any extra scripts that no longer exist on main
            for extra in (actual_scripts - expected_scripts):
                (wt_path / extra).unlink(missing_ok=True)
                reconciled_any = True

            # 2. Check content of all expected scripts
            main_tip_hash = subprocess.run(["git", "rev-parse", main_branch], capture_output=True, text=True, check=True).stdout.strip()
            lib_cache = {}
            for exp in sorted(expected_scripts):
                target_file = wt_path / exp
                show_res = subprocess.run(
                    ["git", "show", f"{main_branch}:{exp}"],
                    capture_output=True, text=True, encoding="utf-8"
                )
                if show_res.returncode != 0:
                    continue
                expected_inlined, _ = inline_script_content(
                    show_res.stdout,
                    commit_hash=main_tip_hash,
                    lib_cache=lib_cache,
                    repo_root=REPO_ROOT
                )

                current_content = target_file.read_text(encoding="utf-8") if target_file.exists() else None
                if current_content != expected_inlined:
                    target_file.parent.mkdir(parents=True, exist_ok=True)
                    target_file.write_text(expected_inlined, encoding="utf-8")
                    reconciled_any = True
                    print(f"Safety Reconciliation: corrected out-of-sync script on dist: {exp}")

            if reconciled_any:
                subprocess.run(["git", "-C", worktree_dir, "add", "-A"], check=True)
                diff_cached = subprocess.run(["git", "-C", worktree_dir, "diff", "--cached", "--quiet"], capture_output=True)
                if diff_cached.returncode != 0:
                    main_subject = subprocess.run(["git", "log", "-1", "--format=%s", main_branch], capture_output=True, text=True, check=True, encoding="utf-8").stdout.strip()
                    main_author = subprocess.run(["git", "log", "-1", "--format=%an <%ae>", main_branch], capture_output=True, text=True, check=True, encoding="utf-8").stdout.strip()
                    main_date = subprocess.run(["git", "log", "-1", "--format=%ad", main_branch], capture_output=True, text=True, check=True, encoding="utf-8").stdout.strip()

                    commit_msg = f"chore(dist): reconcile standalone userscripts with {main_branch}\n\nEnforce parity with '{main_branch}' tip: {main_subject}"
                    env = os.environ.copy()
                    subprocess.run([
                        "git", "-C", worktree_dir, "commit",
                        "-m", commit_msg,
                        "--author", main_author,
                        "--date", main_date
                    ], env=env, check=True)
                    committed_count += 1
                    print(f"Safety Reconciliation: Committed final parity synchronization with '{main_branch}'.")

            if committed_count == 0:
                print(f"Branch '{dist_branch}' is already up-to-date with '{main_branch}'. No new commit needed.")
            else:
                print(f"Successfully synced {committed_count} commit(s) to '{dist_branch}'.")

            return True
        finally:
            subprocess.run(["git", "worktree", "remove", "--force", worktree_dir], capture_output=True)
            subprocess.run(["git", "worktree", "prune"], capture_output=True)

def build_scripts_to_dir(output_dir, scripts=None, source_root=REPO_ROOT, rewrite_urls=True):
    """Builds selected (or all) src/*.user.js scripts with inlined lib/ dependencies directly into output_dir."""
    source_root_path = Path(source_root)
    source_src = source_root_path / "src"
    out_dir = Path(output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    if scripts:
        targets = []
        for raw in scripts:
            cand = Path(raw)
            if not cand.is_absolute():
                rel = source_root_path / cand
                cand = rel if rel.exists() else (source_src / cand)
            if not cand.exists():
                raise FileNotFoundError(f"Userscript not found: {raw}")
            targets.append(cand)
    else:
        targets = sorted(source_src.glob("*.user.js"))

    results = {}
    for script_path in targets:
        raw_content = script_path.read_text(encoding="utf-8")
        inlined_content, libs = inline_script_content(
            raw_content,
            repo_root=source_root_path,
            rewrite_urls=rewrite_urls,
        )
        out_file = out_dir / script_path.name
        out_file.write_text(inlined_content, encoding="utf-8")
        results[script_path.name] = libs

    return results


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Inlines local libraries for userscripts and updates the dist branch.")
    parser.add_argument("--sync-branch", action="store_true", help="Sync inlined scripts directly onto local dist branch")
    parser.add_argument("--main-branch", default="main", help="Source branch (default: main)")
    parser.add_argument("--dist-branch", default="dist", help="Target branch (default: dist)")
    parser.add_argument("--print", dest="print_script", default=None, help="Print inlined userscript content to stdout without rewriting URLs")
    parser.add_argument("--out", dest="out_dir", default=None, help="Write standalone inlined userscript(s) into a local output directory (e.g. dist)")
    parser.add_argument("--script", action="append", dest="scripts", default=None, help="Specific userscript(s) to build when using --out")
    parser.add_argument("--no-rewrite-urls", action="store_true", help="Preserve existing @updateURL/@downloadURL instead of rewriting main -> dist when using --out")
    args = parser.parse_args()

    if args.print_script:
        content = inline_userscript(args.print_script, rewrite_urls=False)
        sys.stdout.write(content)
        sys.exit(0)

    if args.out_dir:
        src_root = Path.cwd() if (Path.cwd() / "src").is_dir() else REPO_ROOT
        res = build_scripts_to_dir(
            args.out_dir,
            scripts=args.scripts,
            source_root=src_root,
            rewrite_urls=not args.no_rewrite_urls,
        )
        out_path = Path(args.out_dir)
        print(f"Built {len(res)} inlined script(s) to {out_path}:")
        for script, libs in res.items():
            detail = f"inlined {libs}" if libs else "standalone (no local libs)"
            print(f"  * {script}: {detail}")
        sys.exit(0)

    if args.sync_branch:
        ok = sync_dist_branch(args.main_branch, args.dist_branch)
        sys.exit(0 if ok else 1)
    else:
        import tempfile
        with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmpdir:
            res = build_all_inlined_scripts(tmpdir)
            print("Build dry-run complete. Inlined dependencies summary:")
            for script, libs in res.items():
                if libs:
                    print(f"  * {script}: inlined {libs}")
                else:
                    print(f"  * {script}: standalone (no local libs)")
