#!/usr/bin/env python3
"""Synchronize a bookmarklets.json manifest into lib/BookmarkletToolbarPacks.js."""

import argparse
import json
import urllib.request
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_SOURCE = REPO_ROOT.parent / "bookmarklets" / "bookmarklets.json"
DEFAULT_OUTPUT = REPO_ROOT / "lib" / "BookmarkletToolbarPacks.js"

USERSCRIPT_HEADER = """// ==UserScript==
// @name         Bookmarklet Toolbar Bundled Packs
// @namespace    https://musicbrainz.org/user/chaban
// @version      1.0.0
// @description  Bundled bookmarklet pack definitions for Site Bookmarklet Toolbar.
// @author       chaban
// @license      MIT
// ==/UserScript==
"""


def validate_manifest(data: dict) -> dict:
    """Validates a bookmarklets.json schemaVersion 1 manifest and returns it."""
    if not isinstance(data, dict):
        raise ValueError("Manifest root must be a JSON object.")

    if data.get("schemaVersion") != 1:
        raise ValueError(f"Unsupported or missing schemaVersion: {data.get('schemaVersion')!r} (expected 1).")

    for field in ("id", "name", "version"):
        val = data.get(field)
        if not isinstance(val, str) or not val.strip():
            raise ValueError(f"Manifest field '{field}' must be a non-empty string.")

    for opt_field in ("description", "homepage"):
        if opt_field in data and data[opt_field] is not None:
            if not isinstance(data[opt_field], str):
                raise ValueError(f"Manifest field '{opt_field}' must be a string.")

    scripts = data.get("scripts")
    if not isinstance(scripts, list) or not scripts:
        raise ValueError("Manifest 'scripts' must be a non-empty list.")

    seen_ids = set()
    for idx, script in enumerate(scripts):
        if not isinstance(script, dict):
            raise ValueError(f"scripts[{idx}] must be an object.")

        for req_str in ("id", "name", "code"):
            s_val = script.get(req_str)
            if not isinstance(s_val, str) or not s_val.strip():
                raise ValueError(f"scripts[{idx}].{req_str} must be a non-empty string.")

        script_id = script["id"]
        if script_id in seen_ids:
            raise ValueError(f"Duplicate script id '{script_id}' at scripts[{idx}].")
        seen_ids.add(script_id)

        for opt_str in ("label", "description", "folder"):
            if opt_str in script and script[opt_str] is not None:
                if not isinstance(script[opt_str], str):
                    raise ValueError(f"scripts[{idx}].{opt_str} must be a string.")

        match_patterns = script.get("match")
        if not isinstance(match_patterns, list) or not match_patterns:
            raise ValueError(f"scripts[{idx}].match must be a non-empty list of match pattern strings.")
        for m_idx, pattern in enumerate(match_patterns):
            if not isinstance(pattern, str) or not pattern.strip():
                raise ValueError(f"scripts[{idx}].match[{m_idx}] must be a non-empty string.")

    return data


def load_manifest(source: str | Path | None = None, url: str | None = None) -> dict:
    """Loads and validates a bookmarklets.json manifest from a file path or HTTP/HTTPS URL."""
    if url:
        req = urllib.request.Request(
            url,
            headers={"Accept": "application/json", "User-Agent": "userscripts-sync-bookmarklets-pack/1.0"},
        )
        with urllib.request.urlopen(req, timeout=30) as response:
            raw_text = response.read().decode("utf-8")
    else:
        src_path = Path(source) if source is not None else DEFAULT_SOURCE
        if not src_path.exists():
            raise FileNotFoundError(f"Manifest file not found: {src_path}")
        raw_text = src_path.read_text(encoding="utf-8")

    try:
        parsed = json.loads(raw_text)
    except json.JSONDecodeError as exc:
        raise ValueError(f"Invalid JSON in manifest: {exc}") from exc

    return validate_manifest(parsed)


def render_packs_module(manifests: list[dict]) -> str:
    """Renders validated bookmarklet manifests into the BookmarkletToolbarPacks.js module string."""
    if not isinstance(manifests, list) or not manifests:
        raise ValueError("manifests must be a non-empty list of manifest dicts.")

    validated = [validate_manifest(m) for m in manifests]
    serialized_packs = json.dumps(validated, indent=4, ensure_ascii=False)

    return (
        f"{USERSCRIPT_HEADER}\n"
        f"const BUNDLED_BOOKMARKLET_PACKS = {serialized_packs};\n\n"
        "try {\n"
        "    if (typeof module === 'object' && module && module.exports) {\n"
        "        module.exports = BUNDLED_BOOKMARKLET_PACKS;\n"
        "    }\n"
        "} catch {}\n"
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Sync a bookmarklets.json manifest into lib/BookmarkletToolbarPacks.js."
    )
    parser.add_argument(
        "--source",
        type=Path,
        default=DEFAULT_SOURCE,
        help="Path to local bookmarklets.json (default: ../bookmarklets/bookmarklets.json)",
    )
    parser.add_argument(
        "--url",
        default=None,
        help="HTTP/HTTPS URL to fetch bookmarklets.json from (overrides --source when provided)",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=DEFAULT_OUTPUT,
        help="Destination JS library path (default: lib/BookmarkletToolbarPacks.js)",
    )
    args = parser.parse_args(argv)

    manifest = load_manifest(source=args.source, url=args.url)
    js_content = render_packs_module([manifest])

    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(js_content, encoding="utf-8")
    print(
        f"Synced pack '{manifest['id']}' ({len(manifest['scripts'])} scripts) -> {output_path}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
