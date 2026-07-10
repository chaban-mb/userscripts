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
    match = re.match(r'^(\d+)\.(\d+)\.(\d+)$', version_str)
    if match:
        return [int(x) for x in match.groups()]
    return None

def bump_version(version_str, bump_type):
    parts = parse_semver(version_str)
    if not parts:
        print(f"Error: Version '{version_str}' is not a valid Semantic Version (x.y.z). Please correct the '@version' tag in the script header.")
        return None
    major, minor, patch = parts
    if bump_type == 'patch':
        return f"{major}.{minor}.{patch + 1}"
    elif bump_type == 'minor':
        return f"{major}.{minor + 1}.0"
    elif bump_type == 'major':
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

def do_check():
    script_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'check_unreleased.py')
    res = subprocess.run([sys.executable, script_path])
    return res.returncode

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

def do_release():
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
        confirm = input(f"Do you want to proceed with the release anyway? (y/N): ").strip().lower()
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
        choice = input("Choice (default: 1): ").strip().lower() or '1'
        if choice == '1':
            print(f"\n{COLOR_CYAN}Checking out dev...{COLOR_RESET}")
            subprocess.run(['git', 'checkout', 'dev'], check=True)
            print(f"{COLOR_CYAN}Merging '{curr_branch}' into dev...{COLOR_RESET}")
            subprocess.run(['git', 'merge', curr_branch], check=True)
            release_branch = "dev"
            merged_feature_branch = curr_branch
        elif choice == '2':
            pass
        else:
            print(f"{COLOR_RED}Aborting.{COLOR_RESET}\n")
            return

    repo_root = Path(__file__).resolve().parent.parent
    
    diff_files = get_git_stdout(['git', 'diff', '--name-only', main_branch, '--', 'src/']).splitlines()
    untracked_files = get_git_stdout(['git', 'ls-files', '--others', '--exclude-standard', '--', 'src/']).splitlines()
    
    all_files = sorted(list(set(diff_files + untracked_files)))
    userscripts = [f for f in all_files if f.endswith('.user.js')]
    
    if not userscripts:
        print(f"\n{COLOR_CYAN}No unreleased changes found in src/ compared to {main_branch}.{COLOR_RESET}\n")
        return

    print("Checking unreleased userscripts...")
    unreleased_info = []
    
    mapping = parse_commit_scopes()
    
    for rel_path_str in userscripts:
        full_path = repo_root / rel_path_str
        if not full_path.exists():
            continue
            
        try:
            current_content = full_path.read_text(encoding='utf-8')
        except Exception as e:
            print(f"Error reading {rel_path_str}: {e}")
            continue
            
        curr_ver, curr_name = extract_version_and_name(current_content)
        display_name = curr_name or full_path.name
        
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
    
    choice = input(f"{COLOR_BOLD}Choice:{COLOR_RESET} ").strip().lower()
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
 
    for script in selected_scripts:
        print(f"\n{COLOR_CYAN}{COLOR_BOLD}Processing release for:{COLOR_RESET} {script['name']}")
        
        # Check description file existence and warn if missing
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
            current_version = input("Enter current/initial version (e.g. 1.0.0): ").strip()
            if not current_version:
                print(f"{COLOR_RED}Skipping due to invalid version.{COLOR_RESET}")
                continue
                
        if script['needs_bump']:
            print(f"Version bump required. Current version is {current_version}.")
            print("Select version bump type:")
            print("  1) Patch (bug fix/minor tweaks)")
            print("  2) Minor (backwards-compatible enhancements)")
            print("  3) Major (incompatible UI/behavior changes)")
            print("  4) Manual (custom version)")
            print("  5) Skip bump (release as-is)")
            
            bump_choice = input("Bump type (default: 1): ").strip()
            if not bump_choice:
                bump_choice = '1'
            new_version = None
            if bump_choice == '1':
                new_version = bump_version(current_version, 'patch')
            elif bump_choice == '2':
                new_version = bump_version(current_version, 'minor')
            elif bump_choice == '3':
                new_version = bump_version(current_version, 'major')
            elif bump_choice == '4':
                new_version = input("Enter new version: ").strip()
            elif bump_choice == '5':
                new_version = current_version
                
            if not new_version:
                print("Could not bump version. Skipping.")
                continue
        else:
            new_version = current_version
            if script['main_version'] is None:
                print(f"New script: releasing initial version {new_version}")
            else:
                print(f"Version is already bumped relative to main: {script['main_version']} -> {new_version}")
                
            print("Select action:")
            print("  k) Keep current version")
            print("  1) Patch (bug fix/minor tweaks)")
            print("  2) Minor (backwards-compatible enhancements)")
            print("  3) Major (incompatible UI/behavior changes)")
            print("  4) Custom version")
            
            confirm = input("Choice (default: k): ").strip().lower() or 'k'
            if confirm == '1':
                new_version = bump_version(new_version, 'patch')
            elif confirm == '2':
                new_version = bump_version(new_version, 'minor')
            elif confirm == '3':
                new_version = bump_version(new_version, 'major')
            elif confirm == '4':
                new_version = input("Enter new version: ").strip()

        # Update version in file if changed
        version_updated = False
        if new_version != current_version:
            print(f"Updating version in file to {new_version}...")
            if update_version_in_file(script['full_path'], new_version):
                print("File updated.")
                version_updated = True
            else:
                print("Failed to update version in file.")
                continue

        script['version_updated'] = version_updated

        # Automatically stage the script file and its description
        subprocess.run(['git', 'add', str(script['rel_path'])], check=True)
        
        script_base_name = script['full_path'].name.replace('.user.js', '')
        desc_rel_path = f"docs/descriptions/{script_base_name}.md"
        desc_full_path = repo_root / desc_rel_path
        if desc_full_path.exists():
            subprocess.run(['git', 'add', desc_rel_path], check=True)
            
        # Check if there are staged changes for this script or its description
        res = subprocess.run(['git', 'diff', '--cached', '--name-only', '--', str(script['rel_path']), str(desc_rel_path)], capture_output=True, text=True)
        staged_changes = res.stdout.strip()
        if staged_changes:
            slug = script['slug']
            
            # For new scripts, the commit type is always 'feat' and default description is adding the script.
            # Otherwise, if the version was updated during release, the default type is 'fix' and description is bumping version.
            if script['main_version'] is None:
                default_type = "feat"
                default_desc = f"add {script['name']} userscript"
            elif version_updated:
                default_type = "fix"
                default_desc = f"bump version to {new_version}"
            else:
                default_type = "feat"
                default_desc = f"release version {new_version}"

            # Check if the last commit was about this script (contains slug)
            last_commit_subject = run_cmd("git log -n 1 --format=%s").strip()
            suggest_amend = False
            if f"({slug})" in last_commit_subject:
                suggest_amend = True

            amend = False
            if suggest_amend:
                amend_choice = input(f"Last commit matches this script's slug. Amend the version bump to '{last_commit_subject}'? (Y/n): ").strip().lower() or 'y'
                if amend_choice == 'y':
                    amend = True

            if amend:
                print(f"Amending last commit to include version bump...")
                subprocess.run(['git', 'commit', '--amend', '--no-edit'], check=True)
            else:
                print(f"\nEnter commit message details for {script['name']}.")
                print(f"Format: <type>({slug}): <description>")
                commit_type = input(f"Commit type (fix/feat/chore/refactor/style, default: {default_type}): ").strip().lower() or default_type
                commit_desc = input(f"Description (default: {default_desc}): ").strip()

                commit_msg = f"{commit_type}({slug}): {commit_desc or default_desc}"

                print(f"Committing changes: '{commit_msg}'")
                subprocess.run(['git', 'commit', '-m', commit_msg], check=True)
                commits_created += 1
        else:
            print(f"No changes to commit for {script['name']}.")

    # Rebuild Markdown list of userscripts and commit it if changed
    print("\nRebuilding userscripts list (docs/USERSCRIPTS.md)...")
    do_build()
    
    # Check if docs/USERSCRIPTS.md is modified
    list_changed = run_cmd("git status --porcelain docs/USERSCRIPTS.md")
    if list_changed:
        print("Staging and committing updated USERSCRIPTS.md...")
        subprocess.run(['git', 'add', 'docs/USERSCRIPTS.md'], check=True)
        subprocess.run(['git', 'commit', '-m', "chore(docs): update userscripts list"], check=True)
        commits_created += 1

    print(f"\n{COLOR_CYAN}{COLOR_BOLD}--- Finalizing Release Workflow ---{COLOR_RESET}")
    print(f"{COLOR_BOLD}Preview of actions to perform:{COLOR_RESET}")
    
    # Show commits that will be merged into main_branch
    print(f"\n  * Commits to merge into '{main_branch}':")
    commits_to_merge = get_git_stdout(['git', 'log', f'{main_branch}..HEAD', '--oneline']).splitlines()
    if commits_to_merge:
        for commit in commits_to_merge:
            print(f"      {COLOR_GREEN}{commit}{COLOR_RESET}")
    else:
        print(f"      {COLOR_YELLOW}No new commits to merge ({release_branch} and {main_branch} are already in sync).{COLOR_RESET}")
        
    # Show branch updates
    print(f"\n  * Git operations to run:")
    print(f"      {COLOR_CYAN}git checkout {main_branch}{COLOR_RESET}")
    print(f"      {COLOR_CYAN}git merge {release_branch}{COLOR_RESET}")
    print(f"      {COLOR_CYAN}git push {remote} {main_branch}{COLOR_RESET}")
    print(f"      {COLOR_CYAN}git checkout {release_branch}{COLOR_RESET}")
    print(f"      {COLOR_CYAN}git merge {main_branch}{COLOR_RESET}")
    print(f"      {COLOR_CYAN}git push {remote} {release_branch}{COLOR_RESET}\n")
    
    confirm = input(f"{COLOR_BOLD}Do you want to merge '{release_branch}' into '{main_branch}' and push changes? (y/N):{COLOR_RESET} ").strip().lower()
    if confirm != 'y':
        print(f"\n{COLOR_YELLOW}Release finalized locally on current branch. Merging and pushing skipped.{COLOR_RESET}")
        if commits_created > 0:
            undo_confirm = input(f"\n{COLOR_YELLOW}{COLOR_BOLD}Do you want to undo/revert the {commits_created} local commits created during this session? (y/N):{COLOR_RESET} ").strip().lower()
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
        
        print(f"\n{COLOR_CYAN}Merging {release_branch} into {main_branch}...{COLOR_RESET}")
        subprocess.run(['git', 'merge', release_branch], check=True)
        
        print(f"\n{COLOR_CYAN}Pushing {main_branch} to {remote}...{COLOR_RESET}")
        subprocess.run(['git', 'push', remote, main_branch], check=True)
        
        print(f"\n{COLOR_CYAN}Checking out {release_branch}...{COLOR_RESET}")
        subprocess.run(['git', 'checkout', release_branch], check=True)
        
        print(f"\n{COLOR_CYAN}Syncing {release_branch} with {main_branch}...{COLOR_RESET}")
        subprocess.run(['git', 'merge', main_branch], check=True)
        subprocess.run(['git', 'push', remote, release_branch], check=True)
        
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

def resolve_command(arg):
    commands = ['check', 'cleanup', 'release', 'build']
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

    parser = argparse.ArgumentParser(description="Git helper for MusicBrainz userscripts repository.")
    subparsers = parser.add_subparsers(dest="command", help="Command to run")
    
    # Subcommand: check
    subparsers.add_parser("check", help="Check unreleased scripts and version bumps relative to main")
    
    # Subcommand: cleanup
    cleanup_parser = subparsers.add_parser("cleanup", help="Clean up local/remote branches merged on GitHub")
    cleanup_parser.add_argument("branch", nargs="?", help="Specific feature branch to clean up")
    cleanup_parser.add_argument("--main-branch", default="main", help="The repository main branch (default: main)")
    
    # Subcommand: release
    subparsers.add_parser("release", help="Interactive release assistant for version bumping, list rebuilding and branch syncing")
    
    # Subcommand: build
    subparsers.add_parser("build", help="Rebuild docs/USERSCRIPTS.md markdown listing")
    
    args = parser.parse_args()
    
    if not args.command:
        sys.exit(do_check())
    elif args.command == "check":
        sys.exit(do_check())
    elif args.command == "cleanup":
        do_cleanup(args.branch, args.main_branch)
    elif args.command == "release":
        do_release()
    elif args.command == "build":
        do_build()

if __name__ == "__main__":
    main()
