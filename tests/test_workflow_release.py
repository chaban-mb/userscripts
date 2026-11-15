import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

WORKFLOW_PY = Path(__file__).resolve().parent.parent / "tools" / "workflow.py"

USERJS_TEMPLATE = """// ==UserScript==
// @name         {name}
// @namespace    https://github.com/test/userscripts
// @version      1.0.0
// @description  Test script
// @author       Test
// @match        https://example.com/*
// @grant        none
// ==/UserScript==

(function() {{
    'use strict';
    console.log('{name}', '{body}');
}})();
"""


class WorkflowReleaseTests(unittest.TestCase):
    def _run(self, cmd, cwd: Path, check: bool = True, input_text: str | None = None) -> subprocess.CompletedProcess:
        return subprocess.run(
            cmd,
            cwd=cwd,
            text=True,
            encoding="utf-8",
            capture_output=True,
            check=check,
            input=input_text,
        )

    def _setup_repo(self, tmp: Path) -> tuple[Path, Path]:
        remote = tmp / "origin.git"
        repo = tmp / "repo"
        self._run(["git", "init", "--bare", str(remote)], cwd=tmp)
        self._run(["git", "clone", str(remote), str(repo)], cwd=tmp)
        self._run(["git", "config", "user.email", "test@example.com"], cwd=repo)
        self._run(["git", "config", "user.name", "Test User"], cwd=repo)

        self._run(["git", "checkout", "-b", "main"], cwd=repo)
        (repo / "src").mkdir()
        (repo / "tools").mkdir()
        (repo / "src" / "script-a.user.js").write_text(
            USERJS_TEMPLATE.format(name="Script A", body="v1"), encoding="utf-8"
        )
        (repo / "src" / "script-b.user.js").write_text(
            USERJS_TEMPLATE.format(name="Script B", body="v1"), encoding="utf-8"
        )
        (repo / "tools" / "other.py").write_text("x = 1\n", encoding="utf-8")
        shutil.copy2(WORKFLOW_PY, repo / "tools" / "workflow.py")
        self._run(["git", "add", "."], cwd=repo)
        self._run(["git", "commit", "-m", "chore: initial"], cwd=repo)
        self._run(["git", "push", "-u", "origin", "main"], cwd=repo)

        self._run(["git", "checkout", "-b", "dev"], cwd=repo)
        self._run(["git", "push", "-u", "origin", "dev"], cwd=repo)
        return remote, repo

    def test_release_does_not_prompt_abort_on_unrelated_uncommitted_files(self) -> None:
        with tempfile.TemporaryDirectory(prefix="wf_rel_") as tmp_dir:
            _, repo = self._setup_repo(Path(tmp_dir))

            (repo / "src" / "script-a.user.js").write_text(
                USERJS_TEMPLATE.format(name="Script A", body="v2"), encoding="utf-8"
            )
            self._run(["git", "add", "src/script-a.user.js"], cwd=repo)
            self._run(["git", "commit", "-m", "fix(script-a): update a"], cwd=repo)

            (repo / "docs").mkdir()
            (repo / "docs" / "notes.md").write_text("wip notes\n", encoding="utf-8")

            # Interactive prompts: select script 1, patch bump 1, apply & push y.
            # If workflow.py prompts about uncommitted docs/notes.md first, '1' != 'y' and it aborts.
            res = self._run(
                [sys.executable, str(repo / "tools" / "workflow.py"), "release"],
                cwd=repo,
                check=False,
                input_text="1\n1\ny\n",
            )
            self.assertEqual(res.returncode, 0, res.stdout + res.stderr)
            self.assertNotIn("files not managed by the release workflow", res.stdout)
            self.assertEqual((repo / "docs" / "notes.md").read_text(encoding="utf-8"), "wip notes\n")
            main_a = self._run(["git", "show", "origin/main:src/script-a.user.js"], cwd=repo).stdout
            self.assertIn("'v2'", main_a)

    def test_release_single_script_with_infra_commits_keeps_infra_on_dev(self) -> None:
        with tempfile.TemporaryDirectory(prefix="wf_rel_") as tmp_dir:
            _, repo = self._setup_repo(Path(tmp_dir))

            (repo / "src" / "script-a.user.js").write_text(
                USERJS_TEMPLATE.format(name="Script A", body="v2"), encoding="utf-8"
            )
            self._run(["git", "add", "src/script-a.user.js"], cwd=repo)
            self._run(["git", "commit", "-m", "fix(script-a): update a"], cwd=repo)

            (repo / "tools" / "other.py").write_text("x = 2\n", encoding="utf-8")
            self._run(["git", "add", "tools/other.py"], cwd=repo)
            self._run(["git", "commit", "-m", "chore(tools): wip tool"], cwd=repo)

            res = self._run(
                [
                    sys.executable,
                    str(repo / "tools" / "workflow.py"),
                    "release",
                    "--non-interactive",
                    "--scripts",
                    "1",
                    "--bump-type",
                    "patch",
                    "--push",
                ],
                cwd=repo,
                check=False,
            )
            self.assertEqual(res.returncode, 0, res.stdout + res.stderr)
            main_a = self._run(["git", "show", "origin/main:src/script-a.user.js"], cwd=repo).stdout
            main_other = self._run(["git", "show", "origin/main:tools/other.py"], cwd=repo).stdout
            dev_other = self._run(["git", "show", "dev:tools/other.py"], cwd=repo).stdout
            self.assertIn("'v2'", main_a)
            self.assertEqual(main_other.strip(), "x = 1")
            self.assertEqual(dev_other.strip(), "x = 2")

    def test_release_selective_mixed_commit_does_not_leak_other_files_to_main(self) -> None:
        with tempfile.TemporaryDirectory(prefix="wf_rel_") as tmp_dir:
            _, repo = self._setup_repo(Path(tmp_dir))

            (repo / "src" / "script-a.user.js").write_text(
                USERJS_TEMPLATE.format(name="Script A", body="v2"), encoding="utf-8"
            )
            (repo / "tools" / "other.py").write_text("x = 2\n", encoding="utf-8")
            self._run(["git", "add", "src/script-a.user.js", "tools/other.py"], cwd=repo)
            self._run(["git", "commit", "-m", "fix(script-a): update a and touch other.py"], cwd=repo)

            (repo / "src" / "script-b.user.js").write_text(
                USERJS_TEMPLATE.format(name="Script B", body="v2"), encoding="utf-8"
            )
            self._run(["git", "add", "src/script-b.user.js"], cwd=repo)
            self._run(["git", "commit", "-m", "feat(script-b): update b"], cwd=repo)

            res = self._run(
                [
                    sys.executable,
                    str(repo / "tools" / "workflow.py"),
                    "release",
                    "--non-interactive",
                    "--scripts",
                    "1",
                    "--bump-type",
                    "patch",
                    "--push",
                ],
                cwd=repo,
                check=False,
            )
            self.assertEqual(res.returncode, 0, res.stdout + res.stderr)
            main_a = self._run(["git", "show", "origin/main:src/script-a.user.js"], cwd=repo).stdout
            main_b = self._run(["git", "show", "origin/main:src/script-b.user.js"], cwd=repo).stdout
            main_other = self._run(["git", "show", "origin/main:tools/other.py"], cwd=repo).stdout
            dev_other = self._run(["git", "show", "dev:tools/other.py"], cwd=repo).stdout
            self.assertIn("'v2'", main_a)
            self.assertIn("'v1'", main_b)
            self.assertEqual(main_other.strip(), "x = 1")
            self.assertEqual(dev_other.strip(), "x = 2")


if __name__ == "__main__":
    unittest.main()
