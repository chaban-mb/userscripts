#!/usr/bin/env python3
import subprocess
import json
import sys
import os
import argparse
import re
from pathlib import Path

VERSION_RE = re.compile(r'//\s*@version\s+(\S+)')
NAME_RE = re.compile(r'//\s*@name\s+(.*)')

# ANSI Escape Codes for Terminal Colors
COLOR_RESET = "\033[0m"
COLOR_RED = "\033[31m"
COLOR_GREEN = "\033[32m"
COLOR_YELLOW = "\033[33m"
COLOR_CYAN = "\033[36m"
COLOR_MAGENTA = "\033[35m"
COLOR_BOLD = "\033[1m"

def run_cmd(cmd):
    res = subprocess.run(cmd, shell=True, text=True, capture_output=True)
    return res.stdout.strip() if res.returncode == 0 else ""

def get_git_stdout(args):
    try:
        res = subprocess.run(args, capture_output=True, text=True, encoding='utf-8', check=True)
        return res.stdout
    except subprocess.CalledProcessError:
        return ""

def parse_commit_scopes():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    scopes_path = os.path.normpath(os.path.join(script_dir, "..", ".agents", "rules", "references", "commit-scopes.md"))
    mapping = {}
    if os.path.exists(scopes_path):
        try:
            with open(scopes_path, 'r', encoding='utf-8') as f:
                content = f.read()
            matches = re.findall(r'\|\s*`([^`]+)`\s*\|\s*`([^`]+)`\s*\|', content)
            for file_name, slug in matches:
                mapping[file_name.strip()] = slug.strip()
        except Exception as e:
            print(f"Warning: Failed to parse commit-scopes.md: {e}")
    return mapping

def get_slug(file_path, mapping):
    file_name = os.path.basename(file_path)
    if file_name in mapping:
        return mapping[file_name]

    # Fallback slug generation
    name_without_ext = file_name.replace(".user.js", "")
    slug = re.sub(r'[^a-zA-Z0-9\s-]', '', name_without_ext)
    slug = re.sub(r'[\s_]+', '-', slug).lower()
    return slug

def extract_version_and_name(content):
    version_match = VERSION_RE.search(content)
    name_match = NAME_RE.search(content)
    version = version_match.group(1).strip() if version_match else None
    name = name_match.group(1).strip() if name_match else None
    return version, name

def get_main_file_content(rel_path_str, main_branch="main"):
    git_path = rel_path_str.replace('\\', '/')
    try:
        res = subprocess.run(['git', 'show', f'{main_branch}:{git_path}'], capture_output=True, text=True, encoding='utf-8', check=True)
        return res.stdout
    except subprocess.CalledProcessError:
        return None

def parse_semver(version_str):
    match = re.match(r'^(\d+)\.(\d+)(?:\.(\d+))?$', version_str)
    if match:
        major, minor, patch = match.groups()
        has_patch = patch is not None
        return [int(major), int(minor), int(patch) if has_patch else 0, has_patch]
    return None

def bump_version(version_str, bump_type):
    parts = parse_semver(version_str)
    if not parts:
        print(f"Error: Version '{version_str}' is not a valid Semantic Version (x.y or x.y.z). Please correct the '@version' tag in the script header.")
        return None
    major, minor, patch, has_patch = parts
    if bump_type == 'patch':
        if not has_patch:
            return f"{major}.{minor}.1"
        return f"{major}.{minor}.{patch + 1}"
    elif bump_type == 'minor':
        if not has_patch:
            return f"{major}.{minor + 1}"
        return f"{major}.{minor + 1}.0"
    elif bump_type == 'major':
        if not has_patch:
            return f"{major + 1}.0"
        return f"{major + 1}.0.0"
    return None

def get_git_remote():
    remotes = run_cmd("git remote").splitlines()
    remotes = [r.strip() for r in remotes if r.strip()]
    if not remotes:
        return "origin"
    if "origin" in remotes:
        return "origin"
    return remotes[0]

def get_main_branch_name(remote="origin"):
    local_branches = run_cmd("git branch --format='%(refname:short)'").splitlines()
    local_branches = [b.strip() for b in local_branches if b.strip()]
    if "main" in local_branches:
        return "main"
    if "master" in local_branches:
        return "master"

    # Fallback to check remote branches
    remote_branches = run_cmd(f"git branch -r --format='%(refname:short)'").splitlines()
    remote_branches = [b.strip() for b in remote_branches if b.strip()]
    if f"{remote}/main" in remote_branches:
        return "main"
    if f"{remote}/master" in remote_branches:
        return "master"

    return "main"

def update_version_in_file(file_path, new_version):
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()

        version_line_re = re.compile(r'(//\s*@version\s+)\S+')
        if version_line_re.search(content):
            new_content = version_line_re.sub(r'\g<1>' + new_version, content)
            with open(file_path, 'w', encoding='utf-8') as f:
                f.write(new_content)
            return True
        return False
    except Exception as e:
        print(f"Error updating file {file_path}: {e}")
        return False

def get_unreleased_userscripts(repo_root=None, main_branch="main", check_workspace=True):
    """
    Unified discovery engine: finds all modified, new, and deleted userscripts/libraries
    relative to main_branch, and automatically cascades changes from lib/ to dependent scripts.
    """
    if repo_root is None:
        repo_root = Path(__file__).resolve().parent.parent
    else:
        repo_root = Path(repo_root)

    diff_files = get_git_stdout(['git', 'diff', '--name-only', main_branch, '--', 'src/', 'lib/']).splitlines()
    untracked_files = get_git_stdout(['git', 'ls-files', '--others', '--exclude-standard', '--', 'src/', 'lib/']).splitlines()
    modified_files = run_cmd("git diff --name-only HEAD -- src/ lib/").splitlines() if check_workspace else []

    all_files = sorted(list(set(diff_files + untracked_files + modified_files)))
    userscripts = [f for f in all_files if f.endswith('.user.js') or (f.startswith('lib/') and f.endswith('.js'))]

    # Cascading library dependencies
    modified_libs = {f for f in userscripts if f.startswith('lib/')}
    if modified_libs:
        src_dir = repo_root / "src"
        if src_dir.exists():
            for script_path in src_dir.glob("*.user.js"):
                rel_script = str(script_path.relative_to(repo_root)).replace('\\', '/')
                if rel_script in userscripts:
                    continue
                try:
                    text = script_path.read_text(encoding='utf-8')
                    for mod_lib in modified_libs:
                        lib_name = Path(mod_lib).name
                        if f"lib/{lib_name}" in text:
                            userscripts.append(rel_script)
                            break
                except Exception:
                    pass

    return sorted(list(set(userscripts)))

def do_check(json_format=False, concise=False, main_branch=None):
    """
    Checks unreleased scripts, detects version bumps relative to main,
    flags missing descriptions, and outputs human or JSON diagnostics.
    """
    repo_root = Path(__file__).resolve().parent.parent
    if main_branch is None:
        main_branch = get_main_branch_name()

    userscripts = get_unreleased_userscripts(repo_root=repo_root, main_branch=main_branch, check_workspace=True)

    # Detect non-userscript files
    diff_all = get_git_stdout(['git', 'diff', '--name-only', main_branch]).splitlines()
    untracked_all = get_git_stdout(['git', 'ls-files', '--others', '--exclude-standard']).splitlines()
    all_repo_files = sorted(list(set(diff_all + untracked_all)))

    script_basenames = {Path(u).name.replace('.user.js', '') for u in userscripts}
    non_userscript_files = []
    for f in all_repo_files:
        if f in userscripts or f == 'docs/USERSCRIPTS.md':
            continue
        if f.startswith('docs/descriptions/') and f.endswith('.md'):
            base = Path(f).name.replace('.md', '')
            if base in script_basenames:
                continue
        non_userscript_files.append(f)

    if not userscripts and not non_userscript_files:
        if json_format:
            print(json.dumps({"unreleased_count": 0, "bump_needed_count": 0, "scripts": [], "infrastructure_files": []}))
        else:
            print(f"No unreleased changes found compared to {main_branch}.")
        return 0

    if not json_format and not concise:
        if userscripts:
            print(f"Found {len(userscripts)} modified/new userscript(s) or library file(s) relative to {main_branch}:\n")
        else:
            print(f"No unreleased userscripts found relative to {main_branch}.\n")

    bump_needed_count = 0
    script_data = []

    for rel_path_str in userscripts:
        full_path = repo_root / rel_path_str

        if not full_path.exists():
            if not json_format:
                print(f"[-] [DELETED] {rel_path_str}")
            script_data.append({"rel_path": rel_path_str, "status": "DELETED", "needs_bump": False})
            continue

        try:
            current_content = full_path.read_text(encoding='utf-8')
        except Exception as e:
            if not json_format:
                print(f"[!] [READ ERROR] {rel_path_str}: {e}")
            continue

        curr_ver, curr_name = extract_version_and_name(current_content)
        display_name = curr_name or full_path.name
        if rel_path_str.startswith('lib/'):
            display_name = f"[LIB] {display_name}"

        main_content = get_main_file_content(rel_path_str, main_branch)
        git_path = rel_path_str.replace('\\', '/')
        commits = get_git_stdout(['git', 'log', f'{main_branch}..HEAD', '--oneline', '--', git_path]).splitlines()
        has_uncommitted = bool(get_git_stdout(['git', 'status', '--porcelain', '--', git_path]).strip())

        has_desc = True
        if not rel_path_str.startswith('lib/'):
            script_base_name = full_path.name.replace('.user.js', '')
            desc_full_path = repo_root / f"docs/descriptions/{script_base_name}.md"
            has_desc = desc_full_path.exists()

        if main_content is None:
            needs_bump = not bool(curr_ver)
            status = "NEW"
            if needs_bump:
                bump_needed_count += 1
            script_data.append({
                "rel_path": rel_path_str,
                "name": display_name,
                "curr_version": curr_ver,
                "main_version": None,
                "status": status,
                "needs_bump": needs_bump,
                "has_description": has_desc,
                "changes_count": len(commits) + (1 if has_uncommitted else 0)
            })
            if not json_format:
                if concise:
                    bump_str = " [BUMP NEEDED]" if needs_bump else ""
                    print(f"[+] [NEW]{bump_str} {display_name} ({rel_path_str}) v{curr_ver}")
                else:
                    print(f"[+] [NEW SCRIPT] {display_name} ({rel_path_str})")
                    if curr_ver:
                        print(f"   Version: {curr_ver} (Ready)")
                    else:
                        print(f"   [!] [BUMP NEEDED] No @version header found!")
                        bump_needed_count += 1
        else:
            main_ver, _ = extract_version_and_name(main_content)
            needs_bump = (curr_ver == main_ver)
            if needs_bump:
                bump_needed_count += 1
                status = "BUMP_NEEDED"
            else:
                status = "BUMPED"

            script_data.append({
                "rel_path": rel_path_str,
                "name": display_name,
                "curr_version": curr_ver,
                "main_version": main_ver,
                "status": status,
                "needs_bump": needs_bump,
                "has_description": has_desc,
                "changes_count": len(commits) + (1 if has_uncommitted else 0)
            })

            if not json_format:
                if concise:
                    st_icon = "[!]" if needs_bump else "[*]"
                    print(f"{st_icon} [{status}] {display_name} ({rel_path_str}) v{main_ver} -> v{curr_ver}")
                else:
                    if needs_bump:
                        print(f"[!] [BUMP NEEDED] {display_name} ({rel_path_str})")
                        print(f"   Current version: {curr_ver} (Same as {main_branch})")
                    else:
                        print(f"[*] [BUMPED]      {display_name} ({rel_path_str})")
                        print(f"   Version: {main_ver} -> {curr_ver}")

        if not json_format and not concise:
            if not has_desc:
                print(f"   [!] [MISSING DESCRIPTION] Description file is missing")
            if commits or has_uncommitted:
                print(f"   Changes since {main_branch}:")
                for c in commits:
                    print(f"     * {c}")
                if has_uncommitted:
                    print("     * [Uncommitted changes in workspace]")
            print()

    if non_userscript_files:
        if not json_format:
            if concise:
                print(f"[#] [INFRASTRUCTURE] {len(non_userscript_files)} non-userscript file(s) modified: {', '.join(non_userscript_files)}")
            else:
                print(f"[#] Infrastructure / Non-Userscript Changes ({len(non_userscript_files)} file(s)):")
                for f in non_userscript_files:
                    print(f"     * {f}")
                print()

    if json_format:
        print(json.dumps({
            "unreleased_count": len(script_data),
            "bump_needed_count": bump_needed_count,
            "scripts": script_data,
            "infrastructure_files": non_userscript_files
        }, indent=2))
    elif not concise:
        if bump_needed_count > 0:
            print(f"[!] Action required: {bump_needed_count} script(s) need a version bump before release.")
        else:
            print("[*] All modified/new scripts have version bumps.")

    return 1 if bump_needed_count > 0 else 0

def do_build():
    script_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'build_list.py')
    res = subprocess.run([sys.executable, script_path])
    return res.returncode

def do_cleanup(branch_name=None, main_branch="main"):
    script_dir = os.path.dirname(os.path.abspath(__file__))
    git_cleanup_path = os.path.join(script_dir, "git_cleanup.py")

    if branch_name:
        subprocess.run([sys.executable, git_cleanup_path, branch_name, main_branch])
        return

    # Auto-detect using gh CLI
    branches_raw = run_cmd("git branch --format='%(refname:short)'")
    local_branches = [b.strip("'") for b in branches_raw.split('\n') if b.strip()]

    prs_json = run_cmd("gh pr list --state merged --limit 10 --json headRefName")
    if not prs_json:
        print("No recently merged PRs found or gh CLI is not authenticated.")
        return

    try:
        prs = json.loads(prs_json)
    except Exception as e:
        print(f"Error parsing JSON from gh: {e}")
        return

    merged_ref_names = [pr["headRefName"] for pr in prs]
    to_cleanup = [b for b in local_branches if b in merged_ref_names and b not in ["main", "master", "dev", "development"]]

    if not to_cleanup:
        print("All local branches are in sync. No merged branches require cleanup.")
        return

    print(f"Found merged branches ready for cleanup: {to_cleanup}")
    for branch in to_cleanup:
        print(f"\n--- Cleaning up branch: {branch} ---")
        subprocess.run([sys.executable, git_cleanup_path, branch, main_branch])

def prompt_user(prompt_msg, default='', non_interactive=False, auto_choice=None):
    if non_interactive:
        val = auto_choice if auto_choice is not None else default
        print(f"{prompt_msg}[Auto-selected: '{val}']")
        return str(val)
    res = input(prompt_msg).strip()
    return res if res else str(default)

def do_release(non_interactive=False, json_output=False, bump_strategy="auto", scripts_filter="all", custom_commit_type=None, custom_commit_msg=None, dry_run=False, apply_push=False):
    remote = get_git_remote()
    main_branch = get_main_branch_name(remote)
    commits_created = 0

    # Check for uncommitted changes upfront to prevent stash pop conflicts later
    dirty_lines = run_cmd("git status --porcelain").splitlines()
    other_dirty = []
    for line in dirty_lines:
        trimmed = line.strip()
        if not trimmed:
            continue
        parts = trimmed.split(maxsplit=1)
        if len(parts) < 2:
            continue
        filepath = parts[1].strip('"').replace('\\', '/')
        is_handled = (
            (filepath.startswith("src/") and filepath.endswith(".user.js")) or
            (filepath.startswith("docs/descriptions/") and filepath.endswith(".md")) or
            (filepath == "docs/USERSCRIPTS.md")
        )
        if not is_handled:
            other_dirty.append(filepath)

    if other_dirty:
        print(f"\n{COLOR_YELLOW}{COLOR_BOLD}Warning: You have uncommitted changes in files not managed by the release workflow:{COLOR_RESET}")
        for f in other_dirty:
            print(f"  * {f}")
        print("It is highly recommended to commit or stash them before releasing to avoid merge conflicts.")
        confirm = prompt_user("Do you want to proceed with the release anyway? (y/N): ", default='y', non_interactive=non_interactive, auto_choice='y').lower()
        if confirm != 'y':
            print(f"{COLOR_RED}Aborting.{COLOR_RESET}\n")
            return

    curr_branch = run_cmd("git branch --show-current")
    release_branch = curr_branch
    merged_feature_branch = None
    if curr_branch != "dev" and curr_branch != "main":
        print(f"\n{COLOR_YELLOW}{COLOR_BOLD}Warning: Current branch is '{curr_branch}', but releases should normally start from the 'dev' branch.{COLOR_RESET}")
        print("What would you like to do?")
        print(f"  1) Automatically merge '{curr_branch}' into 'dev', switch to 'dev', and proceed with release")
        print(f"  2) Continue on the current branch '{curr_branch}' anyway")
        print("  q) Quit")
        choice = prompt_user("Choice (default: 1): ", default='1', non_interactive=non_interactive, auto_choice='1').lower()
        if choice == '1':
            print(f"\n{COLOR_CYAN}Checking out dev...{COLOR_RESET}")
            subprocess.run(['git', 'checkout', 'dev'], check=True)
            print(f"{COLOR_CYAN}Merging '{curr_branch}' into dev...{COLOR_RESET}")
            merge_res = subprocess.run(['git', 'merge', curr_branch], capture_output=True, text=True)
            if merge_res.returncode != 0:
                print(f"{COLOR_RED}Merge conflict occurred merging '{curr_branch}' into dev! Aborting.{COLOR_RESET}")
                subprocess.run(['git', 'merge', '--abort'], capture_output=True)
                subprocess.run(['git', 'checkout', curr_branch], capture_output=True)
                return
            merged_feature_branch = curr_branch
            release_branch = "dev"
        elif choice == '2':
            pass
        else:
            print(f"{COLOR_RED}Aborting.{COLOR_RESET}\n")
            return

    repo_root = Path(__file__).resolve().parent.parent
    userscripts = get_unreleased_userscripts(repo_root=repo_root, main_branch=main_branch, check_workspace=True)

    if not userscripts:
        print(f"\n{COLOR_CYAN}No unreleased changes found in src/ or lib/ compared to {main_branch}.{COLOR_RESET}\n")
        return

    print("Checking unreleased userscripts...")
    unreleased_info = []
    deleted_scripts = []
    mapping = parse_commit_scopes()

    for rel_path_str in userscripts:
        full_path = repo_root / rel_path_str
        if not full_path.exists():
            deleted_scripts.append(rel_path_str)
            continue

        try:
            current_content = full_path.read_text(encoding='utf-8')
        except Exception as e:
            print(f"Error reading {rel_path_str}: {e}")
            continue

        curr_ver, curr_name = extract_version_and_name(current_content)
        display_name = curr_name or full_path.name
        if rel_path_str.startswith('lib/'):
            display_name = f"[LIB] {display_name}"

        main_content = get_main_file_content(rel_path_str, main_branch)
        main_ver = None
        if main_content is not None:
            main_ver, _ = extract_version_and_name(main_content)

        needs_bump = (main_ver is not None) and (curr_ver == main_ver)

        unreleased_info.append({
            'rel_path': rel_path_str,
            'full_path': full_path,
            'name': display_name,
            'curr_version': curr_ver,
            'main_version': main_ver,
            'needs_bump': needs_bump,
            'slug': get_slug(rel_path_str, mapping)
        })

    if not unreleased_info and not deleted_scripts:
        print(f"\n{COLOR_CYAN}No unreleased changes found in src/ or lib/ compared to {main_branch}.{COLOR_RESET}\n")
        return

    if deleted_scripts:
        print(f"\n{COLOR_RED}{COLOR_BOLD}Deleted script(s) (will be removed on {main_branch}):{COLOR_RESET}")
        for d in deleted_scripts:
            print(f"  * {COLOR_RED}[DELETED]{COLOR_RESET} {d}")

    if not unreleased_info:
        print(f"\n{COLOR_CYAN}No modified/new scripts to select. Only deleted script(s) detected.{COLOR_RESET}")
        proceed = prompt_user("Proceed with releasing deletion(s)? (y/N): ", default='y', non_interactive=non_interactive, auto_choice='y').lower()
        if proceed != 'y':
            print(f"{COLOR_RED}Aborting.{COLOR_RESET}\n")
            return
        selected_scripts = []
    else:
        print(f"\n{COLOR_CYAN}{COLOR_BOLD}Available scripts for release:{COLOR_RESET}")
        for idx, info in enumerate(unreleased_info, 1):
            if info['main_version'] is None:
                status_str = f"{COLOR_CYAN}[NEW]{COLOR_RESET}"
            elif info['needs_bump']:
                status_str = f"{COLOR_RED}{COLOR_BOLD}[BUMP NEEDED]{COLOR_RESET}"
            else:
                status_str = f"{COLOR_GREEN}{COLOR_BOLD}[BUMPED]{COLOR_RESET}"
            ver_str = f"({info['main_version']} -> {info['curr_version']})" if info['main_version'] else f"(New: {info['curr_version']})"
            print(f"  {idx}) {status_str} {info['name']} {ver_str}")

        print(f"\n{COLOR_CYAN}{COLOR_BOLD}Select scripts to release:{COLOR_RESET}")
        print("  Enter numbers separated by commas (e.g. 1,3)")
        print("  Enter 'all' to release all scripts")
        print("  Enter 'q' to quit")

        choice = prompt_user(f"{COLOR_BOLD}Choice:{COLOR_RESET} ", default=scripts_filter, non_interactive=non_interactive, auto_choice=scripts_filter).lower()
        if choice in ['q', 'quit', 'exit']:
            print(f"{COLOR_RED}Aborting.{COLOR_RESET}\n")
            return

        selected_indices = []
        if choice in ['all', 'a'] or (choice == '' and len(unreleased_info) == 1):
            selected_indices = list(range(len(unreleased_info)))
        else:
            try:
                selected_indices = [int(i.strip()) - 1 for i in choice.split(',') if i.strip()]
            except ValueError:
                print(f"{COLOR_RED}Invalid input. Aborting.{COLOR_RESET}\n")
                return

        selected_scripts = []
        for idx in selected_indices:
            if 0 <= idx < len(unreleased_info):
                selected_scripts.append(unreleased_info[idx])
            else:
                print(f"{COLOR_YELLOW}Invalid index {idx + 1}. Skipping.{COLOR_RESET}")

        if not selected_scripts:
            print(f"{COLOR_YELLOW}No scripts selected.{COLOR_RESET}\n")
            return

    valid_scripts = []
    for script in selected_scripts:
        print(f"\n{COLOR_CYAN}{COLOR_BOLD}Processing release for:{COLOR_RESET} {script['name']}")

        # Check description file existence and warn if missing (only for non-library scripts)
        if not script['rel_path'].startswith('lib/'):
            script_base_name = script['full_path'].name.replace('.user.js', '')
            desc_rel_path = f"docs/descriptions/{script_base_name}.md"
            desc_full_path = repo_root / desc_rel_path
            if not desc_full_path.exists():
                print(f"  {COLOR_YELLOW}{COLOR_BOLD}[!] WARNING:{COLOR_RESET} Description file is missing: {desc_rel_path}")
                print(f"      Please create this file to describe the userscript's features.")
                print()

        current_version = script['curr_version']

        if not current_version:
            print(f"{COLOR_YELLOW}Warning: No version tag found for {script['name']}.{COLOR_RESET}")
            current_version = prompt_user("Enter current/initial version (e.g. 1.0.0): ", default='1.0.0', non_interactive=non_interactive, auto_choice='1.0.0').strip()
            if not current_version:
                print(f"{COLOR_RED}Skipping due to invalid version.{COLOR_RESET}")
                continue

        if script['needs_bump']:
            print(f"Version bump required. Current version is {current_version}.")
            print("Select version bump type:")
            print("  1) Patch (bug fix/minor tweaks) [Default]")
            print("  2) Minor (backwards-compatible enhancements)")
            print("  3) Major (incompatible UI/behavior changes)")
            print("  4) Manual (custom version)")

            if non_interactive:
                if bump_strategy in ["patch", "minor", "major"]:
                    bump_choice = {"patch": "1", "minor": "2", "major": "3"}[bump_strategy]
                else:
                    bump_choice = "1"
            else:
                bump_choice = prompt_user("Choice (default: 1): ", default='1', non_interactive=non_interactive, auto_choice='1')

            new_version = None
            if bump_choice in ['1', 'patch']:
                new_version = bump_version(current_version, 'patch')
            elif bump_choice in ['2', 'minor']:
                new_version = bump_version(current_version, 'minor')
            elif bump_choice in ['3', 'major']:
                new_version = bump_version(current_version, 'major')
            elif bump_choice == '4':
                manual_ver = prompt_user("Enter new version: ", non_interactive=non_interactive, auto_choice="")
                if manual_ver and parse_semver(manual_ver) and manual_ver != current_version:
                    new_version = manual_ver
                else:
                    print(f"{COLOR_RED}Invalid or unchanged version '{manual_ver}'. Releases must include an incremented version.{COLOR_RESET}")
                    continue
            else:
                print(f"{COLOR_YELLOW}Invalid choice. Defaulting to patch bump.{COLOR_RESET}")
                new_version = bump_version(current_version, 'patch')

            if not new_version or new_version == current_version:
                print(f"{COLOR_RED}Error: Cannot release {script['name']} without a version bump. Aborting release for this script.{COLOR_RESET}")
                continue
        else:
            print(f"Script already has bumped version: {current_version}")
            new_version = current_version

        version_updated = False
        if new_version and new_version != script['curr_version']:
            if dry_run:
                print(f"[DRY-RUN] Would update version in file {script['rel_path']} to {new_version}")
                version_updated = True
            else:
                print(f"Updating version in file to {new_version}...")
                if update_version_in_file(script['full_path'], new_version):
                    print("File updated.")
                    version_updated = True
                else:
                    print("Failed to update version in file.")
                    continue

        script['version_updated'] = version_updated

        script['target_version'] = new_version
        valid_scripts.append(script)

    selected_scripts = valid_scripts
    if not selected_scripts:
        print(f"\n{COLOR_RED}No scripts were successfully prepared or bumped for release. Aborting release workflow.{COLOR_RESET}\n")
        return

    if not dry_run:
        # Phase 2 & 3: Stage and fold version bumps into unreleased commits
        fixup_targets = []
        has_amended_head = False

        # Fast path: single script whose latest unreleased commit is HEAD
        can_fast_amend = (
            len(selected_scripts) == 1 and
            selected_scripts[0].get('version_updated')
        )
        if can_fast_amend:
            script = selected_scripts[0]
            subprocess.run(['git', 'add', str(script['rel_path'])], check=True)
            if not script['rel_path'].startswith('lib/'):
                script_base_name = script['full_path'].name.replace('.user.js', '')
                desc_rel_path = f"docs/descriptions/{script_base_name}.md"
                if (repo_root / desc_rel_path).exists():
                    subprocess.run(['git', 'add', desc_rel_path], check=True)

            file_commits_out = get_git_stdout([
                'git', 'log', f'{main_branch}..HEAD',
                '--format=%H %s', '--', str(script['rel_path'])
            ]).strip()
            file_commits = [l.strip() for l in file_commits_out.splitlines() if l.strip()]
            head_hash = run_cmd("git rev-parse HEAD").strip()
            target_hash = file_commits[0].split(' ', 1)[0] if file_commits else None
            target_subject = (file_commits[0].split(' ', 1)[1] if file_commits and ' ' in file_commits[0] else '')

            if target_hash and target_hash == head_hash:
                print(f"\nAmending last commit '{target_subject}' to include version bump...")
                subprocess.run(['git', 'commit', '--amend', '--no-edit'], check=True)
                has_amended_head = True

        if not has_amended_head:
            for script in selected_scripts:
                if not script.get('version_updated') and script['main_version'] is not None:
                    continue

                subprocess.run(['git', 'add', str(script['rel_path'])], check=True)
                if not script['rel_path'].startswith('lib/'):
                    script_base_name = script['full_path'].name.replace('.user.js', '')
                    desc_rel_path = f"docs/descriptions/{script_base_name}.md"
                    if (repo_root / desc_rel_path).exists():
                        subprocess.run(['git', 'add', desc_rel_path], check=True)

                res = subprocess.run(['git', 'diff', '--cached', '--name-only', '--', str(script['rel_path'])], capture_output=True, text=True)
                if not res.stdout.strip():
                    continue

                slug = script['slug']
                new_ver = script.get('target_version', script['curr_version'])

                file_commits_out = get_git_stdout([
                    'git', 'log', f'{main_branch}..HEAD',
                    '--format=%H %s', '--', str(script['rel_path'])
                ]).strip()
                file_commits = [l.strip() for l in file_commits_out.splitlines() if l.strip()]

                if file_commits:
                    target_line = file_commits[0]
                    target_hash = target_line.split(' ', 1)[0]
                    target_subject = target_line.split(' ', 1)[1] if ' ' in target_line else ''
                    print(f"Creating fixup for '{target_subject}' to fold {script['name']} version bump...")
                    subprocess.run(['git', 'commit', '--fixup', target_hash], check=True)
                    fixup_targets.append(target_hash)
                else:
                    if script['main_version'] is None:
                        default_type = "feat"
                        default_desc = f"add {script['name']} userscript"
                    else:
                        default_type = "chore"
                        default_desc = f"bump version to {new_ver}"

                    commit_type = custom_commit_type or default_type
                    commit_desc = custom_commit_msg or default_desc
                    commit_msg = f"{commit_type}({slug}): {commit_desc}"
                    print(f"Committing new changes: '{commit_msg}'")
                    subprocess.run(['git', 'commit', '-m', commit_msg], check=True)
                    commits_created += 1

            if fixup_targets:
                print(f"\n{COLOR_CYAN}Folding version bumps into unreleased commits via atomic autosquash rebase...{COLOR_RESET}")
                subprocess.run([
                    'git', '-c', 'sequence.editor=true', 'rebase', '-i',
                    '--autosquash', '--autostash', main_branch
                ], check=True)
                print(f"{COLOR_GREEN}Version bumps successfully folded into commits (0 extra bump commits).{COLOR_RESET}")
    else:
        for script in selected_scripts:
            print(f"[DRY-RUN] Would fold version bump into unreleased commits for {script['name']}.")

    # Rebuild Markdown list of userscripts and commit it if changed
    print("\nRebuilding userscripts list (docs/USERSCRIPTS.md)...")
    do_build()

    list_changed = False
    if not dry_run:
        # Check if docs/USERSCRIPTS.md is modified
        list_changed = bool(run_cmd("git status --porcelain docs/USERSCRIPTS.md"))
        if list_changed:
            print("Staging and committing updated USERSCRIPTS.md...")
            subprocess.run(['git', 'add', 'docs/USERSCRIPTS.md'], check=True)
            subprocess.run(['git', 'commit', '-m', "chore(docs): update userscripts list"], check=True)
            commits_created += 1

    # Detect all changed files between main and HEAD
    all_changed_files = [f.strip() for f in get_git_stdout(['git', 'diff', '--name-only', f'{main_branch}..HEAD']).splitlines() if f.strip()]
    selected_rel_paths = {s['rel_path'] for s in selected_scripts}
    selected_desc_paths = {f"docs/descriptions/{s['full_path'].name.replace('.user.js', '')}.md" for s in selected_scripts if not s['rel_path'].startswith('lib/')}
    
    infra_changed_files = []
    for f in all_changed_files:
        if f in selected_rel_paths or f in selected_desc_paths or f == 'docs/USERSCRIPTS.md':
            continue
        infra_changed_files.append(f)

    is_full_release = (len(selected_scripts) == len(unreleased_info))

    mode_label = f"{COLOR_GREEN}[Fast-Forward Release]{COLOR_RESET}" if is_full_release else f"{COLOR_YELLOW}[Selective Rebase Release]{COLOR_RESET}"
    print(f"\n{COLOR_CYAN}{COLOR_BOLD}--- Finalizing Release Workflow {mode_label} ---{COLOR_RESET}")
    print(f"{COLOR_BOLD}Preview of actions to perform:{COLOR_RESET}")

    if is_full_release:
        print(f"\n  * Releasing all unreleased scripts and commits from '{release_branch}' into '{main_branch}'.")
        cmd = ['git', 'log', f'{main_branch}..HEAD', '--format=%H %s']
    else:
        print(f"\n  * Commits to cherry-pick into '{main_branch}':")
        paths = []
        for script in selected_scripts:
            paths.append(script['rel_path'])
            if not script['rel_path'].startswith('lib/'):
                script_base_name = script['full_path'].name.replace('.user.js', '')
                desc_rel_path = f"docs/descriptions/{script_base_name}.md"
                paths.append(desc_rel_path)

        if list_changed:
            paths.append('docs/USERSCRIPTS.md')

        if paths:
            cmd = ['git', 'log', f'{main_branch}..HEAD', '--format=%H %s', '--'] + paths
        else:
            cmd = ['git', 'log', f'{main_branch}..HEAD', '--format=%H %s']

    commit_lines = [line.strip() for line in get_git_stdout(cmd).splitlines() if line.strip()]
    commit_ids = [line.split(' ', 1)[0] for line in commit_lines]
    if commit_lines:
        for commit in commit_lines:
            print(f"      {COLOR_GREEN}{commit}{COLOR_RESET}")
    else:
        print(f"      {COLOR_YELLOW}No new commits ({release_branch} and {main_branch} are already in sync).{COLOR_RESET}")

    if deleted_scripts:
        if is_full_release:
            print(f"\n  * {COLOR_RED}{COLOR_BOLD}Deleted script(s) to be removed on {main_branch} ({len(deleted_scripts)} file(s)):{COLOR_RESET}")
            for d in deleted_scripts:
                print(f"      {COLOR_RED}* {d}{COLOR_RESET}")
        else:
            print(f"\n  * {COLOR_RED}{COLOR_BOLD}Deleted script(s) remaining on '{release_branch}' ({len(deleted_scripts)} file(s)):{COLOR_RESET}")
            for d in deleted_scripts:
                print(f"      {COLOR_RED}* {d}{COLOR_RESET}")

    if infra_changed_files:
        if is_full_release:
            print(f"\n  * {COLOR_YELLOW}{COLOR_BOLD}Non-userscript / Infrastructure files included in this release ({len(infra_changed_files)} file(s)):{COLOR_RESET}")
            for f in infra_changed_files:
                print(f"      {COLOR_YELLOW}* {f}{COLOR_RESET}")
        else:
            print(f"\n  * {COLOR_YELLOW}{COLOR_BOLD}Non-userscript / Infrastructure files remaining on '{release_branch}' ({len(infra_changed_files)} file(s)):{COLOR_RESET}")
            for f in infra_changed_files:
                print(f"      {COLOR_YELLOW}* {f}{COLOR_RESET}")

    # Show branch updates
    print(f"\n  * Git operations to run:")
    print(f"      {COLOR_CYAN}git checkout {main_branch}{COLOR_RESET}")
    if is_full_release:
        print(f"      {COLOR_CYAN}git merge --ff-only {release_branch}{COLOR_RESET}")
        print(f"      {COLOR_CYAN}git push {remote} {main_branch}{COLOR_RESET}")
        print(f"      {COLOR_CYAN}git checkout {release_branch}{COLOR_RESET}")
        print(f"      {COLOR_CYAN}git push {remote} {release_branch}{COLOR_RESET}\n")
    else:
        for commit_id in commit_ids:
            print(f"      {COLOR_CYAN}git cherry-pick {commit_id}{COLOR_RESET}")
        print(f"      {COLOR_CYAN}git push {remote} {main_branch}{COLOR_RESET}")
        print(f"      {COLOR_CYAN}git checkout {release_branch}{COLOR_RESET}")
        print(f"      {COLOR_CYAN}git rebase {main_branch}{COLOR_RESET}")
        print(f"      {COLOR_CYAN}git push {remote} {release_branch} --force-with-lease{COLOR_RESET}\n")

    if dry_run:
        print(f"\n{COLOR_GREEN}[DRY-RUN] Release workflow preview completed. No git branches were modified or pushed.{COLOR_RESET}\n")
        return

    auto_apply = 'y' if apply_push else ('n' if non_interactive else 'y')
    confirm = prompt_user(f"{COLOR_BOLD}Do you want to apply these operations and push changes? (y/N):{COLOR_RESET} ", default='y', non_interactive=non_interactive, auto_choice=auto_apply).lower()
    if confirm != 'y':
        print(f"\n{COLOR_YELLOW}Release finalized locally on current branch ('{release_branch}'). Merging and pushing to '{main_branch}' skipped (releasing to main requires human execution).{COLOR_RESET}")
        if commits_created > 0 and not non_interactive:
            undo_confirm = prompt_user(f"\n{COLOR_YELLOW}{COLOR_BOLD}Do you want to undo/revert the {commits_created} local commits created during this session? (y/N):{COLOR_RESET} ", default='n', non_interactive=non_interactive, auto_choice='n').lower()
            if undo_confirm == 'y':
                print(f"\n{COLOR_RED}Undoing last {commits_created} commits (git reset --soft)...{COLOR_RESET}")
                subprocess.run(['git', 'reset', '--soft', f'HEAD~{commits_created}'], check=True)

                # Revert auto-generated docs/USERSCRIPTS.md changes
                print(f"{COLOR_YELLOW}Reverting auto-generated changes to docs/USERSCRIPTS.md...{COLOR_RESET}")
                subprocess.run(['git', 'restore', '--staged', 'docs/USERSCRIPTS.md'], capture_output=True)
                subprocess.run(['git', 'restore', 'docs/USERSCRIPTS.md'], capture_output=True)

                # Unstage the script and description files that were released
                print(f"{COLOR_YELLOW}Unstaging released script files...{COLOR_RESET}")
                for script in selected_scripts:
                    subprocess.run(['git', 'restore', '--staged', str(script['rel_path'])], capture_output=True)
                    if not script['rel_path'].startswith('lib/'):
                        script_base_name = script['full_path'].name.replace('.user.js', '')
                        desc_rel_path = f"docs/descriptions/{script_base_name}.md"
                        subprocess.run(['git', 'restore', '--staged', desc_rel_path], capture_output=True)
                    if script.get('version_updated'):
                        print(f"{COLOR_YELLOW}Reverting version bump in {script['rel_path']} back to {script['curr_version']}...{COLOR_RESET}")
                        update_version_in_file(script['full_path'], script['curr_version'])

                print(f"{COLOR_GREEN}Commits reverted. Workspace changes preserved and unstaged.{COLOR_RESET}\n")
        return

    # Check if working tree has dirty/uncommitted changes
    dirty = run_cmd("git status --porcelain").strip()
    stashed = False

    try:
        if dirty:
            print(f"\n{COLOR_YELLOW}Working directory is dirty. Stashing local changes...{COLOR_RESET}")
            subprocess.run(['git', 'stash', '-u', '-m', 'workflow_release_stash'], check=True)
            stashed = True

        print(f"\n{COLOR_CYAN}Checking out {main_branch}...{COLOR_RESET}")
        subprocess.run(['git', 'checkout', main_branch], check=True)

        if is_full_release:
            print(f"\n{COLOR_CYAN}Fast-forward merging {release_branch} into {main_branch}...{COLOR_RESET}")
            subprocess.run(['git', 'merge', '--ff-only', release_branch], check=True)
        else:
            if commit_ids:
                print(f"\n{COLOR_CYAN}Cherry-picking selected release commits into {main_branch}...{COLOR_RESET}")
                for commit_id in commit_ids:
                    subprocess.run(['git', 'cherry-pick', commit_id], check=True)
            else:
                print(f"\n{COLOR_YELLOW}No commits selected for cherry-pick. Skipping release commit application.{COLOR_RESET}")

        print(f"\n{COLOR_CYAN}Pushing {main_branch} to {remote}...{COLOR_RESET}")
        subprocess.run(['git', 'push', remote, main_branch], check=True)

        print(f"\n{COLOR_CYAN}Checking out {release_branch}...{COLOR_RESET}")
        subprocess.run(['git', 'checkout', release_branch], check=True)

        print(f"\n{COLOR_CYAN}Syncing {release_branch} with {main_branch}...{COLOR_RESET}")
        if is_full_release:
            subprocess.run(['git', 'push', remote, release_branch, '--force-with-lease'], check=True)
        else:
            ff_res = subprocess.run(['git', 'merge', '--ff-only', main_branch], capture_output=True, text=True)
            if ff_res.returncode != 0:
                print(f"{COLOR_CYAN}Rebasing {release_branch} onto {main_branch} to maintain clean linear history...{COLOR_RESET}")
                subprocess.run(['git', 'rebase', main_branch], check=True)
                subprocess.run(['git', 'push', remote, release_branch, '--force-with-lease'], check=True)
            else:
                subprocess.run(['git', 'push', remote, release_branch], check=True)

        # Sync inlined dist branch for GreasyFork webhook support
        print(f"\n{COLOR_CYAN}Syncing inlined userscripts to 'dist' branch for GreasyFork...{COLOR_RESET}")
        script_dir = os.path.dirname(os.path.abspath(__file__))
        build_dist_path = os.path.join(script_dir, "build_dist.py")
        subprocess.run([sys.executable, build_dist_path, "--sync-branch", "--main-branch", main_branch], check=True)
        subprocess.run(['git', 'push', remote, 'dist'], check=True)

        print(f"\n{COLOR_GREEN}{COLOR_BOLD}Release completed successfully!{COLOR_RESET}\n")

        if merged_feature_branch:
            print(f"\n{COLOR_CYAN}Cleaning up merged feature branch '{merged_feature_branch}'...{COLOR_RESET}")
            script_dir = os.path.dirname(os.path.abspath(__file__))
            git_cleanup_path = os.path.join(script_dir, "git_cleanup.py")
            subprocess.run([sys.executable, git_cleanup_path, merged_feature_branch, main_branch])

    except subprocess.CalledProcessError as e:
        print(f"\n{COLOR_RED}{COLOR_BOLD}An error occurred during git operations: {e}{COLOR_RESET}")
        print(f"{COLOR_YELLOW}You may need to manually resolve branch status.{COLOR_RESET}\n")
    finally:
        # Ensure we are back on release_branch and pop stash if stashed
        curr_branch = run_cmd("git branch --show-current")
        if curr_branch != release_branch:
            print(f"\n{COLOR_CYAN}Returning to {release_branch} branch...{COLOR_RESET}")
            subprocess.run(['git', 'checkout', release_branch], check=True)
        if stashed:
            print(f"\n{COLOR_YELLOW}Restoring stashed local changes...{COLOR_RESET}")
            subprocess.run(['git', 'stash', 'pop'], check=True)
            print()

def do_bump(bump_type="patch", scripts_filter="all", json_output=False):
    repo_root = Path(__file__).resolve().parent.parent
    main_branch = get_main_branch_name()

    userscripts = get_unreleased_userscripts(repo_root=repo_root, main_branch=main_branch, check_workspace=True)

    if not userscripts:
        print(f"\n{COLOR_CYAN}No modified or unreleased scripts found in src/ or lib/.{COLOR_RESET}\n")
        return 0

    bumped_results = []
    for rel_path_str in userscripts:
        full_path = repo_root / rel_path_str
        if not full_path.exists():
            continue

        try:
            current_content = full_path.read_text(encoding='utf-8')
        except Exception:
            continue

        curr_ver, curr_name = extract_version_and_name(current_content)
        if not curr_ver:
            continue

        main_content = get_main_file_content(rel_path_str, main_branch)
        main_ver = None
        if main_content is not None:
            main_ver, _ = extract_version_and_name(main_content)

        # Determine target version
        base_ver = main_ver or curr_ver
        if curr_ver != main_ver:
            new_ver = bump_version(curr_ver, bump_type)
        else:
            new_ver = bump_version(base_ver, bump_type)

        if not new_ver:
            continue

        if update_version_in_file(full_path, new_ver):
            bumped_results.append({
                'rel_path': rel_path_str,
                'name': curr_name or full_path.name,
                'old_version': curr_ver,
                'new_version': new_ver
            })

    if json_output:
        print(json.dumps(bumped_results, indent=2))
    else:
        print(f"\n{COLOR_CYAN}{COLOR_BOLD}Batch {bump_type.upper()} Version Bump Results ({len(bumped_results)} scripts bumped):{COLOR_RESET}")
        for res in bumped_results:
            print(f"  * {res['name']} ({res['old_version']} -> {res['new_version']})")
        print()

    return 0

def resolve_command(arg):
    commands = ['check', 'cleanup', 'release', 'build', 'bump', 'build-dist']
    if arg in commands:
        return arg

    matches = [cmd for cmd in commands if cmd.startswith(arg)]
    if len(matches) == 1:
        return matches[0]
    elif len(matches) > 1:
        print(f"Ambiguous command '{arg}'. Matching commands: {', '.join(matches)}")
        sys.exit(2)
    return arg

def main():
    if len(sys.argv) > 1 and not sys.argv[1].startswith('-'):
        sys.argv[1] = resolve_command(sys.argv[1])

    parser = argparse.ArgumentParser(
        description="Unified git workflow and release assistant for MusicBrainz userscripts.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python tools/workflow.py check --json             # Fast diagnostic check for LLM / agents
  python tools/workflow.py check --concise          # Human-readable concise status
  python tools/workflow.py bump --bump-type patch   # Batch bump modified scripts & dependent libs
  python tools/workflow.py release --non-interactive -y -p  # Automated release to main & dist
  python tools/workflow.py build-dist --sync-branch # Synchronize standalone inlined scripts to dist
"""
    )
    subparsers = parser.add_subparsers(dest="command", help="Command to run", metavar="{check,release,bump,build,build-dist,cleanup}")

    # Subcommand: check
    check_parser = subparsers.add_parser("check", help="Check unreleased scripts, cascading dependency bumps, and docs")
    check_parser.add_argument("--json", action="store_true", help="Output token-efficient JSON format for automated LLM/agent usage")
    check_parser.add_argument("--concise", "-c", action="store_true", help="Output concise summary without commit logs")
    check_parser.add_argument("--main-branch", default=None, help="The repository main branch to compare against (default: auto-detected)")

    # Subcommand: cleanup
    cleanup_parser = subparsers.add_parser("cleanup", help="Clean up local/remote branches merged on GitHub")
    cleanup_parser.add_argument("branch", nargs="?", help="Specific feature branch to clean up")
    cleanup_parser.add_argument("--main-branch", default="main", help="The repository main branch (default: main)")

    # Subcommand: release
    release_parser = subparsers.add_parser("release", help="Interactive or automated release assistant with dist sync")
    release_parser.add_argument("--non-interactive", "-y", "--auto", action="store_true", help="Automated non-interactive mode for LLM/agent execution")
    release_parser.add_argument("--push", "--apply", "-p", action="store_true", help="Apply git merge/rebase and push operations to remote")
    release_parser.add_argument("--dry-run", "-n", action="store_true", help="Simulate release workflow without creating commits or modifying files")
    release_parser.add_argument("--json", action="store_true", help="Output JSON results")
    release_parser.add_argument("--bump-type", choices=["patch", "minor", "major", "none", "auto"], default="auto", help="Bump strategy in automated mode (default: auto)")
    release_parser.add_argument("--scripts", default="all", help="Comma-separated script numbers/paths or 'all' (default: all)")
    release_parser.add_argument("--commit-type", "-t", default=None, help="Custom commit type override for new commits (e.g. fix, feat, refactor)")
    release_parser.add_argument("--commit-msg", "-m", default=None, help="Custom commit description override for new commits")

    # Subcommand: bump
    bump_cmd_parser = subparsers.add_parser("bump", help="Batch bump version tags for modified/unreleased userscripts and dependent libs")
    bump_cmd_parser.add_argument("--bump-type", choices=["patch", "minor", "major"], default="patch", help="Bump strategy (default: patch)")
    bump_cmd_parser.add_argument("--scripts", default="all", help="Comma-separated script paths or 'all' (default: all)")
    bump_cmd_parser.add_argument("--json", action="store_true", help="Output JSON results")

    # Subcommand: build
    subparsers.add_parser("build", help="Rebuild docs/USERSCRIPTS.md markdown listing")

    # Subcommand: build-dist
    dist_parser = subparsers.add_parser("build-dist", help="Build standalone inlined scripts and sync to dist branch")
    dist_parser.add_argument("--sync-branch", action="store_true", help="Sync inlined scripts directly to dist branch")
    dist_parser.add_argument("--main-branch", default="main", help="Main branch name (default: main)")

    args = parser.parse_args()

    try:
        if not args.command or args.command == "check":
            json_flag = getattr(args, 'json', False)
            concise_flag = getattr(args, 'concise', False)
            main_branch_arg = getattr(args, 'main_branch', None)
            sys.exit(do_check(json_format=json_flag, concise=concise_flag, main_branch=main_branch_arg))
        elif args.command == "cleanup":
            do_cleanup(args.branch, args.main_branch)
        elif args.command == "bump":
            do_bump(bump_type=args.bump_type, scripts_filter=args.scripts, json_output=getattr(args, 'json', False))
        elif args.command == "release":
            do_release(
                non_interactive=args.non_interactive,
                json_output=args.json,
                bump_strategy=args.bump_type,
                scripts_filter=args.scripts,
                custom_commit_type=args.commit_type,
                custom_commit_msg=args.commit_msg,
                dry_run=args.dry_run,
                apply_push=args.push
            )
        elif args.command == "build":
            do_build()
        elif args.command == "build-dist":
            from build_dist import sync_dist_branch, build_all_inlined_scripts
            if getattr(args, 'sync_branch', False):
                sync_dist_branch(main_branch=args.main_branch)
            else:
                import tempfile
                with tempfile.TemporaryDirectory() as tmpdir:
                    res = build_all_inlined_scripts(tmpdir)
                    print("Build dry-run complete. Inlined dependencies summary:")
                    for script, libs in res.items():
                        if libs:
                            print(f"  * {script}: inlined {libs}")
                        else:
                            print(f"  * {script}: standalone (no local libs)")
    except KeyboardInterrupt:
        print(f"\n{COLOR_YELLOW}Aborted.{COLOR_RESET}\n")
        sys.exit(1)

if __name__ == "__main__":
    main()
