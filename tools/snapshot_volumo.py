"""
tools/snapshot_volumo.py

Captures Volumo API responses and __NEXT_DATA__ page blobs as reference
snapshots so that structural changes can be detected quickly via `git diff`.

Usage:
    python tools/snapshot_volumo.py <barcode>

    barcode: the numeric ICPN/barcode of the album, e.g. 8721466352961

Outputs (under snapshots/volumo/<barcode>/):
    api.json          - Pretty-printed response from /api/v1/album_by_icpn/{barcode}
    next_data.json    - Pretty-printed __NEXT_DATA__ blob extracted from the page HTML
    schema.txt        - Flat list of every unique JSON key path found in api.json

The __NEXT_DATA__ extraction uses the Requests + html.parser stack; it does NOT
require a browser because Next.js embeds the data in the initial server-rendered HTML.
"""

import argparse
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import urlopen, Request
from urllib.error import HTTPError, URLError
from html.parser import HTMLParser

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

BASE_URL = "https://volumo.com"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    "Accept": "application/json, text/html, */*",
    "Accept-Language": "en-US,en;q=0.9",
}

REPO_ROOT = Path(__file__).resolve().parent.parent
SNAPSHOTS_DIR = REPO_ROOT / "snapshots" / "volumo"


# ---------------------------------------------------------------------------
# __NEXT_DATA__ extractor (HTML parser — no browser needed)
# ---------------------------------------------------------------------------

class NextDataExtractor(HTMLParser):
    """Finds and captures the content of <script id="__NEXT_DATA__"> tags."""

    def __init__(self):
        super().__init__()
        self._capture = False
        self.data = None

    def handle_starttag(self, tag, attrs):
        if tag == "script":
            attrs_dict = dict(attrs)
            if attrs_dict.get("id") == "__NEXT_DATA__":
                self._capture = True

    def handle_data(self, data):
        if self._capture:
            self.data = data
            self._capture = False


# ---------------------------------------------------------------------------
# Key-path walker
# ---------------------------------------------------------------------------

def walk_keys(obj, prefix="", result=None):
    """Recursively collect all unique key paths from a JSON object."""
    if result is None:
        result = set()

    if isinstance(obj, dict):
        for k, v in obj.items():
            path = f"{prefix}.{k}" if prefix else k
            result.add(path)
            walk_keys(v, path, result)
    elif isinstance(obj, list) and obj:
        # Walk only the first element to represent the list item schema
        walk_keys(obj[0], f"{prefix}[]", result)

    return result


# ---------------------------------------------------------------------------
# HTTP helpers
# ---------------------------------------------------------------------------

def fetch_text(url: str) -> str:
    req = Request(url, headers=HEADERS)
    try:
        with urlopen(req, timeout=15) as resp:
            return resp.read().decode("utf-8")
    except HTTPError as e:
        print(f"  HTTP {e.code} for {url}", file=sys.stderr)
        raise
    except URLError as e:
        print(f"  Connection error for {url}: {e.reason}", file=sys.stderr)
        raise


def fetch_json(url: str) -> dict:
    return json.loads(fetch_text(url))


# ---------------------------------------------------------------------------
# Snapshot writing
# ---------------------------------------------------------------------------

def save_snapshot(out_dir: Path, filename: str, data: dict | str, *, is_json=True):
    """Write a snapshot file, pretty-printing JSON if requested."""
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / filename

    if is_json:
        content = json.dumps(data, indent=2, ensure_ascii=False)
    else:
        content = data

    path.write_text(content, encoding="utf-8")
    print(f"  Saved: {path.relative_to(REPO_ROOT)}")
    return path


def save_schema(out_dir: Path, api_data: dict):
    """Write a sorted flat key-path list derived from the API JSON."""
    keys = sorted(walk_keys(api_data))
    content_lines = [
        f"# Volumo API schema key paths",
        f"# Generated: {datetime.now(timezone.utc).isoformat()}",
        "",
        *keys,
        "",
    ]
    save_snapshot(out_dir, "schema.txt", "\n".join(content_lines), is_json=False)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def run(identifier: str):
    identifier = identifier.strip()

    # Determine type of identifier and extract parameters
    slug_or_id = None
    is_barcode = False

    if identifier.startswith("http://") or identifier.startswith("https://"):
        m = re.search(r"volumo\.com/album/([^/?#]+)", identifier)
        if m:
            slug_or_id = m.group(1)
        else:
            print(f"Error: Could not parse album slug/ID from URL: {identifier}", file=sys.stderr)
            sys.exit(1)
    else:
        if identifier.isdigit() and len(identifier) >= 12:
            is_barcode = True
        else:
            slug_or_id = identifier

    if is_barcode:
        barcode = identifier
        dir_name = barcode
        api_url = f"{BASE_URL}/api/v1/album_by_icpn/{barcode}"
        page_url = f"{BASE_URL}/album/{barcode}"
        print(f"\nSnapshoting barcode {barcode}")
    else:
        m = re.match(r"^(\d+)", slug_or_id)
        if not m:
            print(f"Error: Could not extract a numeric album ID from slug: {slug_or_id}", file=sys.stderr)
            sys.exit(1)
        album_id = m.group(1)
        dir_name = slug_or_id
        api_url = f"{BASE_URL}/api/v1/albums/{album_id}"
        page_url = f"{BASE_URL}/album/{slug_or_id}"
        print(f"\nSnapshoting album slug/ID {slug_or_id} (ID: {album_id})")

    out_dir = SNAPSHOTS_DIR / dir_name
    print(f"Output directory: {out_dir.relative_to(REPO_ROOT)}\n")

    # 1. Fetch API JSON
    print(f"[1/3] Fetching API response: {api_url}")
    api_data = fetch_json(api_url)

    # Normalize response (albums endpoint returns a list with a single album)
    if isinstance(api_data, list):
        if len(api_data) > 0:
            api_data = api_data[0]
        else:
            print(f"Error: API returned an empty list from: {api_url}", file=sys.stderr)
            sys.exit(1)

    save_snapshot(out_dir, "api.json", api_data)

    # 2. Fetch page HTML and extract __NEXT_DATA__
    print(f"\n[2/3] Fetching page HTML for __NEXT_DATA__: {page_url}")
    html = fetch_text(page_url)
    extractor = NextDataExtractor()
    extractor.feed(html)

    if extractor.data:
        try:
            next_data = json.loads(extractor.data)
            save_snapshot(out_dir, "next_data.json", next_data)
        except json.JSONDecodeError as e:
            print(f"  Warning: Failed to parse __NEXT_DATA__ as JSON: {e}", file=sys.stderr)
    else:
        print("  Warning: <script id=\"__NEXT_DATA__\"> not found in page HTML.", file=sys.stderr)
        print("  (Page may require JavaScript rendering – try loading manually and copy-pasting.)")

    # 3. Write schema summary
    print(f"\n[3/3] Generating schema summary")
    save_schema(out_dir, api_data)

    print(f"\nDone. To detect future changes run:")
    print(f"  git diff snapshots/volumo/{dir_name}/")


def main():
    parser = argparse.ArgumentParser(
        description="Snapshot Volumo album API and page data for development reference."
    )
    parser.add_argument(
        "identifier",
        help="Album identifier (barcode, slug, numeric ID, or Volumo album URL)",
    )
    args = parser.parse_args()
    run(args.identifier)


if __name__ == "__main__":
    main()
