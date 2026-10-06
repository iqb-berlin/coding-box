import contextlib
import hashlib
import io
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

from windows_probe import main, matching_windows, resolve_bundle_file, verify_application


class BundleIntegrityTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.application = {"id": "Example", "version": "1.0.0.0", "setup": "setup.exe",
                            "executable": "app/Example.exe", "files": []}
        for name in ("setup.exe", "app/Example.exe"):
            target = self.root / name
            target.parent.mkdir(parents=True, exist_ok=True)
            data = b"MZ" + bytes(126)
            target.write_bytes(data)
            self.application["files"].append({"path": name, "bytes": len(data),
                                              "sha256": hashlib.sha256(data).hexdigest()})
        (self.root / "bundle.json").write_text(
            json.dumps({"applications": [self.application]}), encoding="utf-8")

    def test_valid_bundle_and_same_size_corruption(self):
        self.assertEqual(verify_application(self.root, self.application), 2)
        (self.root / "app/Example.exe").write_bytes(bytes(128))
        with self.assertRaisesRegex(ValueError, "SHA-256 mismatch"):
            verify_application(self.root, self.application)

    def test_empty_duplicate_or_uncovered_files_are_rejected(self):
        for records in ([], self.application["files"] * 2, self.application["files"][:1]):
            with self.subTest(records=records), self.assertRaises(ValueError):
                verify_application(self.root, {**self.application, "files": records})

    def test_traversal_and_absolute_paths_are_rejected(self):
        for name in ("../outside", "/absolute", "C:\\absolute", "app/../outside", "app//file"):
            with self.subTest(name=name), self.assertRaises(ValueError):
                resolve_bundle_file(self.root, name)

    def test_verification_does_not_claim_functional_testing(self):
        output = self.root / "output"
        with contextlib.redirect_stdout(io.StringIO()):
            code = main(["--bundle", str(self.root), "--app", "Example", "--verify-only",
                         "--output", str(output)])
        self.assertEqual(code, 0)
        report = json.loads((output / "probe.json").read_text(encoding="utf-8"))
        self.assertEqual(report["status"], "bundle-verified")
        self.assertEqual(report["functionalTests"]["status"], "not-run")

    def test_corrupt_bundle_writes_a_failed_report_and_exits_nonzero(self):
        (self.root / "setup.exe").write_bytes(b"broken")
        output = self.root / "output"
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            code = main(["--bundle", str(self.root), "--app", "Example", "--verify-only",
                         "--output", str(output)])
        self.assertEqual(code, 1)
        report = json.loads((output / "probe.json").read_text(encoding="utf-8"))
        self.assertEqual(report["status"], "failed")

    def test_runtime_error_dialog_does_not_count_as_the_application_window(self):
        error_dialog = Mock(element_info=SimpleNamespace(process_id=12))
        error_dialog.window_text.return_value = "Microsoft .NET Framework"
        main_window = Mock(element_info=SimpleNamespace(process_id=12))
        main_window.window_text.return_value = "IQB-Kodieren - Testjobs"
        desktop = Mock()
        desktop.windows.return_value = [error_dialog, main_window]
        with patch("windows_probe.process_image", return_value=Path("IQB-Kodieren.exe")):
            matches = matching_windows(desktop, "IQB-Kodieren.exe", "Kodieren")
        self.assertEqual([match[0] for match in matches], [main_window])


if __name__ == "__main__":
    unittest.main()
