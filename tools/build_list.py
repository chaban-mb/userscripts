import os
import re
from pathlib import Path
from typing import List, Dict, Any

# Constants
GITHUB_BASE = "https://github.com/chaban-mb/userscripts"
NAME_RE = re.compile(r'// @name\s+(.*)')
SCREENSHOT_RE = re.compile(r'!\[([^\]]*)\]\(([^)]+)\)')

def get_script_metadata(path: Path, repo_root: Path, descriptions_path: Path) -> Dict[str, Any]:
    """Extracts metadata and description for a single userscript."""
    rel_path = path.relative_to(repo_root)
    script_base_name = path.name.replace('.user.js', '')
    doc_file = descriptions_path / f"{script_base_name}.md"

    # Extract @name from script content
    content = path.read_text(encoding='utf-8')
    name_match = NAME_RE.search(content)
    header_name = name_match.group(1).strip() if name_match else script_base_name

    # Process description and screenshots
    description = ""
    if doc_file.exists():
        doc_lines = doc_file.read_text(encoding='utf-8').splitlines()
        processed_lines = []
        for line in doc_lines:
            # Convert ![alt](url) to [📷 View Screenshot](url)
            processed_line = SCREENSHOT_RE.sub(
                lambda m: f"[📷 View {m.group(1) or 'Screenshot'}]({m.group(2)})",
                line
            )
            processed_lines.append(processed_line)
        description = "\n".join(processed_lines).strip()

    # Generate URLs
    encoded_path = str(rel_path).replace('\\', '/').replace(' ', '%20')

    return {
        'header_name': header_name,
        'description': description,
        'install_url': f"{GITHUB_BASE}/raw/main/{encoded_path}",
        'source_url': f"{GITHUB_BASE}/blob/main/{encoded_path}",
        'is_lib_or_proto': any(part in rel_path.parts for part in ['lib', 'prototypes']),
        'name_for_sort': header_name.lower()
    }

def build():
    # Setup paths using pathlib
    tools_path = Path(__file__).resolve().parent
    repo_root = tools_path.parent
    docs_path = repo_root / 'docs'
    descriptions_path = docs_path / 'descriptions'
    src_path = repo_root / 'src'
    output_file = docs_path / 'USERSCRIPTS.md'

    if not src_path.exists():
        print(f"Error: {src_path} not found.")
        return

    # 1. Collect all scripts (only include files tracked by git to avoid unreleased drafts)
    tracked_paths = None
    try:
        import subprocess
        git_files = subprocess.check_output(
            ["git", "ls-files", "src/"],
            cwd=str(repo_root),
            text=True
        ).splitlines()
        tracked_paths = { (repo_root / p).resolve() for p in git_files }
    except Exception as e:
        print(f"Warning: Failed to query git tracked files: {e}")

    scripts_list = []
    for script_file in src_path.rglob('*.user.js'):
        if tracked_paths is not None and script_file.resolve() not in tracked_paths:
            continue
        metadata = get_script_metadata(script_file, repo_root, descriptions_path)
        scripts_list.append(metadata)

    # 2. Sort: main scripts first, then libs/protos
    scripts_list.sort(key=lambda x: (x['is_lib_or_proto'], x['name_for_sort']))

    # 3. Assemble Markdown
    md_parts = ["# Userscripts\n"]

    for s in scripts_list:
        # Skip internal/prototype/library scripts or deprecated ones
        if s['is_lib_or_proto'] or "DEPRECATED" in s['header_name'].upper():
            continue

        md_parts.append(f"## {s['header_name']}\n")
        md_parts.append(f"[![Install](https://img.shields.io/badge/Install-success.svg?style=for-the-badge&logo=tampermonkey)]({s['install_url']})")
        md_parts.append(f"[![Source](https://img.shields.io/badge/Source-grey.svg?style=for-the-badge&logo=github)]({s['source_url']})\n")

        if s['description']:
            md_parts.append(f"{s['description']}\n")
        else:
            md_parts.append("*No description provided.*\n")

    # 4. Write output
    output_file.write_text("\n".join(md_parts), encoding='utf-8')
    print(f"Built USERSCRIPTS.md successfully at {output_file}")

if __name__ == "__main__":
    build()
