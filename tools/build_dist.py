#!/usr/bin/env python3
import io
import os
import re
import sys
import subprocess
import shutil
import tarfile
import tempfile
from pathlib import Path

# Paths
REPO_ROOT = Path(__file__).resolve().parent.parent
SRC_DIR = REPO_ROOT / "src"
LIB_DIR = REPO_ROOT / "lib"

REQUIRE_RE = re.compile(r'^[ \t]*//[ \t]*@require[ \t]+(?:\.\./)?lib/([^\s]+)', re.MULTILINE)
USERSCRIPT_HEADER_RE = re.compile(r'//[ \t]*==UserScript==.*?//[ \t]*==/UserScript==\s*', re.DOTALL)
CLOSURE_START_RE = re.compile(r'(\(\s*function\s*\([^)]*\)\s*\{|\(\s*\(\)\s*=>\s*\{)')

def clean_lib_content(lib_text):
    """Strips the UserScript header from library file so only the executable code remains."""
    return USERSCRIPT_HEADER_RE.sub('', lib_text).strip()

def inline_script_content(script_text, repo_root=REPO_ROOT):
    """
    Finds relative @require directives pointing to lib/ in script_text,
    removes the @require line from metadata, and inlines the library code into the script.
    """
    matches = list(REQUIRE_RE.finditer(script_text))
    inlined_libs = []
    lib_codes = []

    for match in matches:
        lib_filename = match.group(1)
        lib_path = Path(repo_root) / "lib" / lib_filename
        if not lib_path.exists():
            print(f"Warning: Library file not found: {lib_path}")
            continue

        with open(lib_path, 'r', encoding='utf-8') as f:
            raw_lib_text = f.read()

        cleaned_lib = clean_lib_content(raw_lib_text)
        lib_codes.append(f"    // --- Inlined Library: lib/{lib_filename} ---\n{cleaned_lib}\n    // --- End Inlined Library ---")
        inlined_libs.append(lib_filename)

    # Always update @updateURL and @downloadURL to point to dist branch
    transformed_text = re.sub(r'(/raw/)main(/src/)', r'\g<1>dist\g<2>', script_text)

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

def extract_commit_sources(commit, target_dir):
    """Extracts src/ and lib/ from a git commit into target_dir using git archive."""
    paths = [p for p in ["src", "lib"] if subprocess.run(
        ["git", "cat-file", "-e", f"{commit}:{p}"],
        capture_output=True
    ).returncode == 0]
    if not paths:
        return
    archive_bytes = subprocess.run(
        ["git", "archive", commit, *paths],
        capture_output=True,
        check=True
    ).stdout
    with tarfile.open(fileobj=io.BytesIO(archive_bytes)) as tar:
        tar.extractall(target_dir)

def find_commits_to_sync(main_branch="main", dist_branch="dist"):
    """
    Finds commits on main_branch that modified src/ or lib/ and need to be synced to dist_branch.
    Matches the latest commit on dist against main_branch commit history.
    """
    dist_log = subprocess.run(
        ["git", "log", "-50", "--format=%s|||%ad", dist_branch],
        capture_output=True, text=True, check=True
    ).stdout.strip().splitlines()

    main_log = subprocess.run(
        ["git", "log", "-200", "--format=%H|||%s|||%ad", main_branch],
        capture_output=True, text=True, check=True
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

    if matched_main:
        log_range = f"{matched_main}..{main_branch}"
        commits = subprocess.run(
            ["git", "log", log_range, "--reverse", "--format=%H", "--", "src/", "lib/"],
            capture_output=True, text=True, check=True
        ).stdout.strip().splitlines()
        return [c.strip() for c in commits if c.strip()]
    else:
        tip = subprocess.run(
            ["git", "rev-parse", main_branch],
            capture_output=True, text=True, check=True
        ).stdout.strip()
        return [tip] if tip else []

def sync_dist_branch(main_branch="main", dist_branch="dist"):
    """
    Builds inlined userscripts from main_branch onto a dedicated dist branch,
    ensuring that the commit message history reflects the substantive changes
    from main (including script updates and shared lib updates).
    Replays each commit from main that touches src/ or lib/ sequentially.
    Uses a temporary git worktree to avoid switching branches in the main working tree.
    """
    # Check if dist branch exists locally
    branches = subprocess.run(["git", "branch", "--list", dist_branch], capture_output=True, text=True, check=True).stdout.strip()
    dist_exists = bool(branches)

    if not dist_exists:
        # Create a true orphan root commit containing only inlined scripts + LICENSE
        print(f"Creating true orphan '{dist_branch}' branch with initial standalone userscripts...")
        main_author = subprocess.run(["git", "log", "-1", "--format=%an <%ae>", main_branch], capture_output=True, text=True, check=True).stdout.strip()
        main_date = subprocess.run(["git", "log", "-1", "--format=%ad", main_branch], capture_output=True, text=True, check=True).stdout.strip()
        author_name = subprocess.run(["git", "log", "-1", "--format=%an", main_branch], capture_output=True, text=True, check=True).stdout.strip()
        author_email = subprocess.run(["git", "log", "-1", "--format=%ae", main_branch], capture_output=True, text=True, check=True).stdout.strip()

        with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as init_wt_dir, \
             tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as build_tmpdir:
            build_all_inlined_scripts(build_tmpdir)
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
                init_wt_path = Path(init_wt_dir)
                shutil.copytree(Path(build_tmpdir) / "src", init_wt_path / "src")

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

    commits_to_sync = find_commits_to_sync(main_branch, dist_branch)
    if not commits_to_sync:
        print(f"Branch '{dist_branch}' is already up-to-date with '{main_branch}'. No new commit needed.")
        return True

    print(f"Found {len(commits_to_sync)} commit(s) from '{main_branch}' to sync to '{dist_branch}'.")

    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as worktree_dir:
        subprocess.run(["git", "worktree", "add", worktree_dir, dist_branch], check=True)
        try:
            wt_path = Path(worktree_dir)
            wt_src = wt_path / "src"

            committed_count = 0
            for commit_hash in commits_to_sync:
                subject = subprocess.run(["git", "log", "-1", "--format=%s", commit_hash], capture_output=True, text=True, check=True).stdout.strip()
                body = subprocess.run(["git", "log", "-1", "--format=%b", commit_hash], capture_output=True, text=True, check=True).stdout.strip()
                author = subprocess.run(["git", "log", "-1", "--format=%an <%ae>", commit_hash], capture_output=True, text=True, check=True).stdout.strip()
                date = subprocess.run(["git", "log", "-1", "--format=%ad", commit_hash], capture_output=True, text=True, check=True).stdout.strip()

                with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as commit_src_dir, \
                     tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as build_tmpdir:
                    extract_commit_sources(commit_hash, commit_src_dir)
                    build_all_inlined_scripts(build_tmpdir, source_root=commit_src_dir)

                    if wt_src.exists():
                        shutil.rmtree(wt_src)
                    shutil.copytree(Path(build_tmpdir) / "src", wt_src)

                    subprocess.run(["git", "-C", worktree_dir, "add", "-A"], check=True)

                    diff_cached = subprocess.run(["git", "-C", worktree_dir, "diff", "--cached", "--quiet"], capture_output=True)
                    if diff_cached.returncode != 0:
                        commit_msg = subject
                        if body:
                            commit_msg += f"\n\n{body}"

                        print(f"Committing inlined scripts on '{dist_branch}': '{subject}'...")
                        env = os.environ.copy()
                        subprocess.run([
                            "git", "-C", worktree_dir, "commit",
                            "-m", commit_msg,
                            "--author", author,
                            "--date", date
                        ], env=env, check=True)
                        committed_count += 1

            if committed_count == 0:
                print(f"Branch '{dist_branch}' is already up-to-date with '{main_branch}'. No new commit needed.")
            else:
                print(f"Successfully synced {committed_count} commit(s) to '{dist_branch}'.")

            return True
        finally:
            subprocess.run(["git", "worktree", "remove", "--force", worktree_dir], capture_output=True)
            subprocess.run(["git", "worktree", "prune"], capture_output=True)

if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Inlines local libraries for userscripts and updates the dist branch.")
    parser.add_argument("--sync-branch", action="store_true", help="Sync inlined scripts directly onto local dist branch")
    parser.add_argument("--main-branch", default="main", help="Source branch (default: main)")
    parser.add_argument("--dist-branch", default="dist", help="Target branch (default: dist)")
    args = parser.parse_args()

    if args.sync_branch:
        sync_dist_branch(args.main_branch, args.dist_branch)
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
