import http.server
import json
import subprocess
import sys
import tempfile
import threading
import unittest
from pathlib import Path

TOOLS_DIR = Path(__file__).resolve().parent.parent / "tools"
if str(TOOLS_DIR) not in sys.path:
    sys.path.insert(0, str(TOOLS_DIR))

import sync_bookmarklets_pack  # noqa: E402


VALID_SAMPLE_MANIFEST = {
    "schemaVersion": 1,
    "id": "sample-bookmarklets",
    "name": "Sample Bookmarklets",
    "version": "2026.11.19",
    "description": "Sample collection of bookmarklets.",
    "homepage": "https://example.com/bookmarklets",
    "scripts": [
        {
            "id": "demo_action",
            "name": "Demo Action",
            "label": "Demo",
            "description": "Clicks a button.",
            "match": ["*://*.musicbrainz.org/*"],
            "folder": "Edit",
            "code": "(function demo() { console.log('demo'); })();",
        }
    ],
}


class SyncBookmarkletsPackTests(unittest.TestCase):
    def test_load_local_manifest_and_render_js_module(self) -> None:
        with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp:
            manifest_path = Path(tmp) / "bookmarklets.json"
            manifest_path.write_text(json.dumps(VALID_SAMPLE_MANIFEST), encoding="utf-8")

            loaded = sync_bookmarklets_pack.load_manifest(source=manifest_path)
            self.assertEqual(loaded["id"], "sample-bookmarklets")
            self.assertEqual(len(loaded["scripts"]), 1)

            rendered = sync_bookmarklets_pack.render_packs_module([loaded])
            self.assertIn("// ==UserScript==", rendered)
            self.assertIn("// ==/UserScript==", rendered)
            self.assertIn("const BUNDLED_BOOKMARKLET_PACKS =", rendered)
            self.assertIn('"sample-bookmarklets"', rendered)
            self.assertIn('"demo_action"', rendered)
            self.assertIn("module.exports = BUNDLED_BOOKMARKLET_PACKS;", rendered)

    def test_load_manifest_from_http_url(self) -> None:
        payload = json.dumps(VALID_SAMPLE_MANIFEST).encode("utf-8")

        class Handler(http.server.BaseHTTPRequestHandler):
            def do_GET(self):  # noqa: N802
                self.send_response(200)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)

            def log_message(self, format, *args):  # noqa: A002
                pass

        server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        port = server.server_address[1]
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            url = f"http://127.0.0.1:{port}/bookmarklets.json"
            loaded_url = sync_bookmarklets_pack.load_manifest(url=url)
            self.assertEqual(loaded_url, VALID_SAMPLE_MANIFEST)

            rendered_url = sync_bookmarklets_pack.render_packs_module([loaded_url])
            with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp:
                local_path = Path(tmp) / "bookmarklets.json"
                local_path.write_text(json.dumps(VALID_SAMPLE_MANIFEST), encoding="utf-8")
                loaded_local = sync_bookmarklets_pack.load_manifest(source=local_path)
                rendered_local = sync_bookmarklets_pack.render_packs_module([loaded_local])
            self.assertEqual(rendered_url, rendered_local)
        finally:
            server.shutdown()
            server.server_close()

    def test_validate_manifest_rejects_invalid_schema_version(self) -> None:
        bad = dict(VALID_SAMPLE_MANIFEST, schemaVersion=2)
        with self.assertRaises(ValueError):
            sync_bookmarklets_pack.validate_manifest(bad)

        missing = dict(VALID_SAMPLE_MANIFEST)
        missing.pop("schemaVersion")
        with self.assertRaises(ValueError):
            sync_bookmarklets_pack.validate_manifest(missing)

    def test_validate_manifest_rejects_empty_match_or_code(self) -> None:
        empty_match_script = dict(VALID_SAMPLE_MANIFEST["scripts"][0], match=[])
        bad_match = dict(VALID_SAMPLE_MANIFEST, scripts=[empty_match_script])
        with self.assertRaises(ValueError):
            sync_bookmarklets_pack.validate_manifest(bad_match)

        blank_match_script = dict(VALID_SAMPLE_MANIFEST["scripts"][0], match=[""])
        bad_blank_match = dict(VALID_SAMPLE_MANIFEST, scripts=[blank_match_script])
        with self.assertRaises(ValueError):
            sync_bookmarklets_pack.validate_manifest(bad_blank_match)

        empty_code_script = dict(VALID_SAMPLE_MANIFEST["scripts"][0], code="   ")
        bad_code = dict(VALID_SAMPLE_MANIFEST, scripts=[empty_code_script])
        with self.assertRaises(ValueError):
            sync_bookmarklets_pack.validate_manifest(bad_code)

    def test_rendered_js_parses_cleanly_in_node(self) -> None:
        rendered = sync_bookmarklets_pack.render_packs_module([VALID_SAMPLE_MANIFEST])
        with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp:
            js_path = Path(tmp) / "BookmarkletToolbarPacks.js"
            js_path.write_text(rendered, encoding="utf-8")

            node_check = (
                f"const packs = require({json.dumps(str(js_path))});"
                "if (!Array.isArray(packs) || packs.length !== 1 || packs[0].id !== 'sample-bookmarklets') {"
                "  process.exit(1);"
                "}"
            )
            res = subprocess.run(
                ["node", "-e", node_check],
                capture_output=True,
                text=True,
                encoding="utf-8",
            )
            self.assertEqual(res.returncode, 0, msg=res.stderr)

    def test_generated_bundled_packs_file_contains_25_scripts(self) -> None:
        lib_file = Path(__file__).resolve().parent.parent / "lib" / "BookmarkletToolbarPacks.js"
        self.assertTrue(lib_file.exists(), "lib/BookmarkletToolbarPacks.js must exist")
        node_check = (
            f"const packs = require({json.dumps(str(lib_file))});"
            "if (!Array.isArray(packs) || packs.length !== 1) process.exit(1);"
            "if (packs[0].id !== 'chaban-bookmarklets' || packs[0].scripts.length !== 25) process.exit(2);"
        )
        res = subprocess.run(
            ["node", "-e", node_check],
            capture_output=True,
            text=True,
            encoding="utf-8",
        )
        self.assertEqual(res.returncode, 0, msg=res.stderr)


if __name__ == "__main__":
    unittest.main()
