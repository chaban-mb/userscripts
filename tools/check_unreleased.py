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

import sys
import json
import argparse

def main():
    parser = argparse.ArgumentParser(description="Check unreleased scripts and version bumps relative to main")
    parser.add_argument("--json", action="store_true", help="Output token-efficient JSON format for automated LLM usage")
    parser.add_argument("--concise", "-c", action="store_true", help="Output concise summary without commit logs")
    args = parser.parse_args()

    repo_root = Path(__file__).resolve().parent.parent
    
    # 1. Get tracked changes relative to main
    diff_files = get_git_stdout(['git', 'diff', '--name-only', 'main', '--', 'src/', 'lib/']).splitlines()
    # 2. Get untracked files
    untracked_files = get_git_stdout(['git', 'ls-files', '--others', '--exclude-standard', '--', 'src/', 'lib/']).splitlines()
    
    all_files = sorted(list(set(diff_files + untracked_files)))
    userscripts = [f for f in all_files if f.endswith('.user.js') or (f.startswith('lib/') and f.endswith('.js'))]
    
    if not userscripts:
        if args.json:
            print(json.dumps({"unreleased_count": 0, "bump_needed_count": 0, "scripts": []}))
        else:
            print("No unreleased changes found in src/ or lib/ compared to main.")
        return 0
 
    if not args.json and not args.concise:
        print(f"Found {len(userscripts)} modified/new userscript(s) or library file(s) relative to main:\n")
    
    bump_needed_count = 0
    script_data = []
    
    for rel_path_str in userscripts:
        full_path = repo_root / rel_path_str
        
        if not full_path.exists():
            if not args.json:
                print(f"[-] [DELETED] {rel_path_str}")
            script_data.append({"rel_path": rel_path_str, "status": "DELETED", "needs_bump": false})
            continue
            
        try:
            current_content = full_path.read_text(encoding='utf-8')
        except Exception as e:
            if not args.json:
                print(f"[!] [READ ERROR] {rel_path_str}: {e}")
            continue
            
        curr_ver, curr_name = extract_version_and_name(current_content)
        display_name = curr_name or full_path.name
        if rel_path_str.startswith('lib/'):
            display_name = f"[LIB] {display_name}"
        
        main_content = get_main_file_content(rel_path_str)
        git_path = rel_path_str.replace('\\', '/')
        commits = get_git_stdout(['git', 'log', 'main..HEAD', '--oneline', '--', git_path]).splitlines()
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
            if not args.json:
                if args.concise:
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

            if not args.json:
                if args.concise:
                    st_icon = "[!]" if needs_bump else "[*]"
                    print(f"{st_icon} [{status}] {display_name} ({rel_path_str}) v{main_ver} -> v{curr_ver}")
                else:
                    if needs_bump:
                        print(f"[!] [BUMP NEEDED] {display_name} ({rel_path_str})")
                        print(f"   Current version: {curr_ver} (Same as main)")
                    else:
                        print(f"[*] [BUMPED]      {display_name} ({rel_path_str})")
                        print(f"   Version: {main_ver} -> {curr_ver}")

        if not args.json and not args.concise:
            if not has_desc:
                print(f"   [!] [MISSING DESCRIPTION] Description file is missing")
            if commits or has_uncommitted:
                print("   Changes since main:")
                for c in commits:
                    print(f"     * {c}")
                if has_uncommitted:
                    print("     * [Uncommitted changes in workspace]")
            print()
        
    if args.json:
        print(json.dumps({
            "unreleased_count": len(script_data),
            "bump_needed_count": bump_needed_count,
            "scripts": script_data
        }, indent=2))
    elif not args.concise:
        if bump_needed_count > 0:
            print(f"[!] Action required: {bump_needed_count} script(s) need a version bump before release.")
        else:
            print("[*] All modified/new scripts have version bumps.")

    return 1 if bump_needed_count > 0 else 0

if __name__ == '__main__':
    sys.exit(main())

