#!/usr/bin/env python3
import subprocess
import re
from pathlib import Path

VERSION_RE = re.compile(r'//\s*@version\s+(\S+)')
NAME_RE = re.compile(r'//\s*@name\s+(.*)')

def get_git_stdout(args):
    try:
        res = subprocess.run(args, capture_output=True, text=True, encoding='utf-8', check=True)
        return res.stdout
    except subprocess.CalledProcessError:
        return ""

def extract_version_and_name(content):
    version_match = VERSION_RE.search(content)
    name_match = NAME_RE.search(content)
    
    version = version_match.group(1).strip() if version_match else None
    name = name_match.group(1).strip() if name_match else None
    return version, name

def get_main_file_content(rel_path_str):
    # Git paths use forward slashes
    git_path = rel_path_str.replace('\\', '/')
    try:
        res = subprocess.run(['git', 'show', f'main:{git_path}'], capture_output=True, text=True, encoding='utf-8', check=True)
        return res.stdout
    except subprocess.CalledProcessError:
        return None

def main():
    repo_root = Path(__file__).resolve().parent.parent
    
    # 1. Get tracked changes relative to main
    diff_files = get_git_stdout(['git', 'diff', '--name-only', 'main', '--', 'src/']).splitlines()
    # 2. Get untracked files
    untracked_files = get_git_stdout(['git', 'ls-files', '--others', '--exclude-standard', '--', 'src/']).splitlines()
    
    all_files = sorted(list(set(diff_files + untracked_files)))
    userscripts = [f for f in all_files if f.endswith('.user.js')]
    
    if not userscripts:
        print("No unreleased changes found in src/ compared to main.")
        return

    print(f"Found {len(userscripts)} modified/new userscript(s) relative to main:\n")
    
    bump_needed_count = 0
    
    for rel_path_str in userscripts:
        full_path = repo_root / rel_path_str
        
        # Determine status
        if not full_path.exists():
            # File was deleted
            print(f"[-] [DELETED] {rel_path_str}")
            continue
            
        # Read current content
        try:
            current_content = full_path.read_text(encoding='utf-8')
        except Exception as e:
            print(f"[!] [READ ERROR] {rel_path_str}: {e}")
            continue
            
        curr_ver, curr_name = extract_version_and_name(current_content)
        display_name = curr_name or full_path.name
        
        # Read main content
        main_content = get_main_file_content(rel_path_str)
        
        # Get history of changes since release
        git_path = rel_path_str.replace('\\', '/')
        commits = get_git_stdout(['git', 'log', 'main..HEAD', '--oneline', '--', git_path]).splitlines()
        has_uncommitted = bool(get_git_stdout(['git', 'status', '--porcelain', '--', git_path]).strip())
        
        if main_content is None:
            # New file
            print(f"[+] [NEW SCRIPT] {display_name} ({rel_path_str})")
            if curr_ver:
                print(f"   Version: {curr_ver} (Ready)")
            else:
                print(f"   [!] [BUMP NEEDED] No @version header found!")
                bump_needed_count += 1
        else:
            main_ver, _ = extract_version_and_name(main_content)
            
            if curr_ver == main_ver:
                print(f"[!] [BUMP NEEDED] {display_name} ({rel_path_str})")
                print(f"   Current version: {curr_ver} (Same as main)")
                bump_needed_count += 1
            else:
                print(f"[*] [BUMPED]      {display_name} ({rel_path_str})")
                print(f"   Version: {main_ver} -> {curr_ver}")

        # Check description file
        script_base_name = full_path.name.replace('.user.js', '')
        desc_rel_path = f"docs/descriptions/{script_base_name}.md"
        desc_full_path = repo_root / desc_rel_path
        if not desc_full_path.exists():
            print(f"   [!] [MISSING DESCRIPTION] Description file is missing: {desc_rel_path}")
        
        # Print changes since release
        if commits or has_uncommitted:
            print("   Changes since main:")
            for c in commits:
                print(f"     * {c}")
            if has_uncommitted:
                print("     * [Uncommitted changes in workspace]")
        print()
        
    if bump_needed_count > 0:
        print(f"[!] Action required: {bump_needed_count} script(s) need a version bump before release.")
    else:
        print("[*] All modified/new scripts have version bumps.")

if __name__ == '__main__':
    main()
