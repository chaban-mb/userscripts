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

def get_main_file_content(rel_path_str):
    git_path = rel_path_str.replace('\\', '/')
    try:
        res = subprocess.run(['git', 'show', f'main:{git_path}'], capture_output=True, text=True, encoding='utf-8', check=True)
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
        return None
    major, minor, patch = parts
    if bump_type == 'patch':
        return f"{major}.{minor}.{patch + 1}"
    elif bump_type == 'minor':
        return f"{major}.{minor + 1}.0"
    elif bump_type == 'major':
        return f"{major + 1}.0.0"
    return None

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
    curr_branch = run_cmd("git branch --show-current")
    if curr_branch != "dev":
        print(f"Warning: Current branch is '{curr_branch}', but releases should normally start from the 'dev' branch.")
        confirm = input("Do you want to continue anyway? (y/N): ").strip().lower()
        if confirm != 'y':
            print("Aborting.")
            return

    repo_root = Path(__file__).resolve().parent.parent
    
    diff_files = get_git_stdout(['git', 'diff', '--name-only', 'main', '--', 'src/']).splitlines()
    untracked_files = get_git_stdout(['git', 'ls-files', '--others', '--exclude-standard', '--', 'src/']).splitlines()
    
    all_files = sorted(list(set(diff_files + untracked_files)))
    userscripts = [f for f in all_files if f.endswith('.user.js')]
    
    if not userscripts:
        print("No unreleased changes found in src/ compared to main.")
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
        
        main_content = get_main_file_content(rel_path_str)
        main_ver = None
        if main_content is not None:
            main_ver, _ = extract_version_and_name(main_content)
            
        needs_bump = (main_ver is None) or (curr_ver == main_ver)
        
        unreleased_info.append({
            'rel_path': rel_path_str,
            'full_path': full_path,
            'name': display_name,
            'curr_version': curr_ver,
            'main_version': main_ver,
            'needs_bump': needs_bump,
            'slug': get_slug(rel_path_str, mapping)
        })

    print("\nAvailable scripts for release:")
    for idx, info in enumerate(unreleased_info, 1):
        status_str = "[BUMP NEEDED]" if info['needs_bump'] else "[BUMPED]"
        ver_str = f"({info['main_version']} -> {info['curr_version']})" if info['main_version'] else f"(New: {info['curr_version']})"
        print(f"  {idx}) {status_str} {info['name']} {ver_str}")
        
    print("\nSelect scripts to release:")
    print("  Enter numbers separated by commas (e.g. 1,3)")
    print("  Enter 'all' to release all scripts")
    print("  Enter 'q' to quit")
    
    choice = input("Choice: ").strip().lower()
    if choice in ['q', 'quit', 'exit']:
        print("Aborting.")
        return
        
    selected_indices = []
    if choice in ['all', 'a'] or (choice == '' and len(unreleased_info) == 1):
        selected_indices = list(range(len(unreleased_info)))
    else:
        try:
            selected_indices = [int(i.strip()) - 1 for i in choice.split(',') if i.strip()]
        except ValueError:
            print("Invalid input. Aborting.")
            return
            
    selected_scripts = []
    for idx in selected_indices:
        if 0 <= idx < len(unreleased_info):
            selected_scripts.append(unreleased_info[idx])
        else:
            print(f"Invalid index {idx + 1}. Skipping.")
            
    if not selected_scripts:
        print("No scripts selected.")
        return

    for script in selected_scripts:
        print(f"\nProcessing release for: {script['name']}")
        current_version = script['curr_version']
        
        if not current_version:
            print(f"Warning: No version tag found for {script['name']}.")
            current_version = input("Enter current/initial version (e.g. 1.0.0): ").strip()
            if not current_version:
                print("Skipping due to invalid version.")
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
            print(f"Version is already bumped relative to main: {script['main_version']} -> {new_version}")
            confirm = input("Do you want to keep this version or bump it again? (k=keep, 1=patch, 2=minor, 3=major, 4=custom): ").strip().lower()
            if confirm == '1':
                new_version = bump_version(new_version, 'patch')
            elif confirm == '2':
                new_version = bump_version(new_version, 'minor')
            elif confirm == '3':
                new_version = bump_version(new_version, 'major')
            elif confirm == '4':
                new_version = input("Enter new version: ").strip()

        if new_version != current_version:
            print(f"Updating version in file to {new_version}...")
            if update_version_in_file(script['full_path'], new_version):
                print("File updated.")
                slug = script['slug']
                commit_msg = f"chore({slug}): bump version to {new_version}"
                print(f"Committing bump: '{commit_msg}'")
                subprocess.run(['git', 'add', str(script['rel_path'])], check=True)
                subprocess.run(['git', 'commit', '-m', commit_msg], check=True)
            else:
                print("Failed to update version in file.")
                continue
        else:
            print(f"No version changes to commit for {script['name']}.")

    # Rebuild Markdown list of userscripts and commit it if changed
    print("\nRebuilding userscripts list (docs/USERSCRIPTS.md)...")
    do_build()
    
    # Check if docs/USERSCRIPTS.md is modified
    list_changed = run_cmd("git status --porcelain docs/USERSCRIPTS.md")
    if list_changed:
        print("Staging and committing updated USERSCRIPTS.md...")
        subprocess.run(['git', 'add', 'docs/USERSCRIPTS.md'], check=True)
        subprocess.run(['git', 'commit', '-m', "chore(docs): update userscripts list"], check=True)

    print("\n--- Finalizing Release Workflow ---")
    print("Preview of actions to perform:")
    
    # Show commits that will be merged into main
    print("  * Commits to merge into 'main':")
    commits_to_merge = get_git_stdout(['git', 'log', 'main..HEAD', '--oneline']).splitlines()
    if commits_to_merge:
        for commit in commits_to_merge:
            print(f"      {commit}")
    else:
        print("      No new commits to merge (dev and main are already in sync).")
        
    # Show branch updates
    print("  * Git operations to run:")
    print("      git checkout main")
    print("      git merge dev")
    print("      git push origin main")
    print("      git checkout dev")
    print("      git merge main")
    print("      git push origin dev\n")
    
    confirm = input("Do you want to merge 'dev' into 'main' and push changes? (y/N): ").strip().lower()
    if confirm != 'y':
        print("Release finalized locally on current branch. Merging and pushing skipped.")
        return

    try:
        print("Checking out main...")
        subprocess.run(['git', 'checkout', 'main'], check=True)
        
        print("Merging dev into main...")
        subprocess.run(['git', 'merge', 'dev'], check=True)
        
        print("Pushing main to origin...")
        subprocess.run(['git', 'push', 'origin', 'main'], check=True)
        
        print("Checking out dev...")
        subprocess.run(['git', 'checkout', 'dev'], check=True)
        
        print("Syncing dev with main...")
        subprocess.run(['git', 'merge', 'main'], check=True)
        subprocess.run(['git', 'push', 'origin', 'dev'], check=True)
        
        print("\nRelease completed successfully!")
    except subprocess.CalledProcessError as e:
        print(f"\nAn error occurred during git operations: {e}")
        print("You may need to manually resolve branch status.")

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
