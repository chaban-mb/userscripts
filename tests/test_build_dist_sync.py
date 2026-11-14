import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

BUILD_DIST = Path(__file__).resolve().parent.parent / "tools" / "build_dist.py"


class BuildDistSyncVersionGuardTests(unittest.TestCase):
    def _init_repo(self, root: Path) -> None:
        subprocess.run(["git", "init", "-b", "main"], cwd=root, check=True, capture_output=True)
        subprocess.run(["git", "config", "user.name", "Test User"], cwd=root, check=True, capture_output=True)
        subprocess.run(["git", "config", "user.email", "test@example.com"], cwd=root, check=True, capture_output=True)

    def _commit_all(self, root: Path, message: str) -> None:
        subprocess.run(["git", "add", "-A"], cwd=root, check=True, capture_output=True)
        subprocess.run(["git", "commit", "-m", message], cwd=root, check=True, capture_output=True)

    def _run_sync(self, root: Path) -> subprocess.CompletedProcess:
        return subprocess.run(
            [sys.executable, str(BUILD_DIST), "--sync-branch", "--main-branch", "main", "--dist-branch", "dist"],
            cwd=root,
            capture_output=True,
            text=True,
            encoding="utf-8",
        )

    def _dist_rev(self, root: Path) -> str:
        return subprocess.run(
            ["git", "rev-parse", "dist"], cwd=root, check=True, capture_output=True, text=True
        ).stdout.strip()

    def _write_script(self, path: Path, name: str, version: str | None, body: str, require: str | None = None) -> None:
        lines = ["// ==UserScript==", f"// @name        {name}"]
        if version is not None:
            lines.append(f"// @version     {version}")
        if require is not None:
            lines.append(f"// @require     {require}")
        lines.append("// ==/UserScript==")
        lines.append(body)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("\n".join(lines) + "\n", encoding="utf-8")

    def test_fails_when_modified_source_script_has_unchanged_version(self) -> None:
        with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp:
            repo = Path(tmp)
            self._init_repo(repo)
            (repo / "src").mkdir()
            script = repo / "src" / "Demo Script.user.js"
            script.write_text(
                "// ==UserScript==\n"
                "// @name        Demo Script\n"
                "// @version     1.0.0\n"
                "// ==/UserScript==\n"
                "console.log('v1');\n",
                encoding="utf-8",
            )
            self._commit_all(repo, "feat(demo): initial script")

            initial_sync = self._run_sync(repo)
            self.assertEqual(initial_sync.returncode, 0, initial_sync.stderr)
            dist_before = subprocess.run(
                ["git", "rev-parse", "dist"], cwd=repo, check=True, capture_output=True, text=True
            ).stdout.strip()

            # Modify script body without bumping @version
            script.write_text(
                "// ==UserScript==\n"
                "// @name        Demo Script\n"
                "// @version     1.0.0\n"
                "// ==/UserScript==\n"
                "console.log('v2');\n",
                encoding="utf-8",
            )
            self._commit_all(repo, "fix(demo): change output without bump")

            res = self._run_sync(repo)
            self.assertNotEqual(res.returncode, 0, "Expected sync to fail for unbumped @version")
            self.assertIn("Demo Script.user.js", res.stdout + res.stderr)

            dist_after = subprocess.run(
                ["git", "rev-parse", "dist"], cwd=repo, check=True, capture_output=True, text=True
            ).stdout.strip()
            self.assertEqual(dist_before, dist_after, "dist branch must not be modified on guard failure")

    def test_fails_when_lib_changes_without_bumping_dependent_script(self) -> None:
        with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp:
            repo = Path(tmp)
            self._init_repo(repo)
            (repo / "src").mkdir()
            (repo / "lib").mkdir()
            lib_file = repo / "lib" / "helper.js"
            lib_file.write_text("const helper = () => 1;\n", encoding="utf-8")
            script = repo / "src" / "Dependent Script.user.js"
            script.write_text(
                "// ==UserScript==\n"
                "// @name        Dependent Script\n"
                "// @version     1.0.0\n"
                "// @require     ../lib/helper.js\n"
                "// ==/UserScript==\n"
                "(function () {\n"
                "    'use strict';\n"
                "    console.log(helper());\n"
                "})();\n",
                encoding="utf-8",
            )
            self._commit_all(repo, "feat(dep): initial script and lib")

            self.assertEqual(self._run_sync(repo).returncode, 0)
            dist_before = subprocess.run(
                ["git", "rev-parse", "dist"], cwd=repo, check=True, capture_output=True, text=True
            ).stdout.strip()

            # Modify lib without bumping Dependent Script's @version
            lib_file.write_text("const helper = () => 2;\n", encoding="utf-8")
            self._commit_all(repo, "fix(lib): update helper without bumping dependent script")

            res = self._run_sync(repo)
            self.assertNotEqual(res.returncode, 0)
            self.assertIn("Dependent Script.user.js", res.stdout + res.stderr)

            dist_after = subprocess.run(
                ["git", "rev-parse", "dist"], cwd=repo, check=True, capture_output=True, text=True
            ).stdout.strip()
            self.assertEqual(dist_before, dist_after)

    def test_succeeds_when_modified_script_has_bumped_version(self) -> None:
        with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp:
            repo = Path(tmp)
            self._init_repo(repo)
            (repo / "src").mkdir()
            script = repo / "src" / "Demo Script.user.js"
            script.write_text(
                "// ==UserScript==\n"
                "// @name        Demo Script\n"
                "// @version     1.0.0\n"
                "// ==/UserScript==\n"
                "console.log('v1');\n",
                encoding="utf-8",
            )
            self._commit_all(repo, "feat(demo): initial script")
            self.assertEqual(self._run_sync(repo).returncode, 0)

            script.write_text(
                "// ==UserScript==\n"
                "// @name        Demo Script\n"
                "// @version     1.0.1\n"
                "// ==/UserScript==\n"
                "console.log('v2');\n",
                encoding="utf-8",
            )
            self._commit_all(repo, "fix(demo): bump version to 1.0.1")

            res = self._run_sync(repo)
            self.assertEqual(res.returncode, 0, res.stderr)

            dist_script = subprocess.run(
                ["git", "show", "dist:src/Demo Script.user.js"],
                cwd=repo, check=True, capture_output=True, text=True
            ).stdout
            self.assertIn("@version     1.0.1", dist_script)
            self.assertIn("console.log('v2');", dist_script)

    def test_new_script_requires_valid_version_and_succeeds_when_present(self) -> None:
        with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp:
            repo = Path(tmp)
            self._init_repo(repo)
            existing = repo / "src" / "Existing.user.js"
            self._write_script(existing, "Existing", "1.0.0", "console.log('ok');")
            self._commit_all(repo, "feat(existing): initial script")
            self.assertEqual(self._run_sync(repo).returncode, 0)
            dist_before = self._dist_rev(repo)

            # New script without @version must fail
            new_script = repo / "src" / "New Script.user.js"
            self._write_script(new_script, "New Script", None, "console.log('new');")
            self._commit_all(repo, "feat(new): add script missing version")
            fail_res = self._run_sync(repo)
            self.assertNotEqual(fail_res.returncode, 0)
            self.assertIn("New Script.user.js", fail_res.stdout + fail_res.stderr)
            self.assertEqual(dist_before, self._dist_rev(repo))

            # Adding valid @version allows sync to succeed
            self._write_script(new_script, "New Script", "1.0.0", "console.log('new');")
            self._commit_all(repo, "fix(new): add initial version")
            ok_res = self._run_sync(repo)
            self.assertEqual(ok_res.returncode, 0, ok_res.stderr)
            dist_new = subprocess.run(
                ["git", "show", "dist:src/New Script.user.js"],
                cwd=repo, check=True, capture_output=True, text=True
            ).stdout
            self.assertIn("@version     1.0.0", dist_new)


if __name__ == "__main__":
    unittest.main()
