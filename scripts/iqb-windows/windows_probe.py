"""Verify the IQB bundle and inspect a real Windows application's desktop UI."""

import argparse
import ctypes
from ctypes import wintypes
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import platform
import subprocess
import sys
import time


def resolve_bundle_file(root, name):
    relative = str(name).replace("\\", "/")
    parts = relative.split("/")
    if any(part in ("", ".", "..") or ":" in part for part in parts):
        raise ValueError(f"Unsafe bundle path: {name}")
    target = root.joinpath(*parts).resolve()
    if not target.is_relative_to(root.resolve()):
        raise ValueError(f"Bundle file escapes bundle directory: {name}")
    return target


def sha256_file(target):
    with target.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def verify_application(root, application):
    files = application.get("files", [])
    names = [entry["path"] for entry in files]
    if not files or len(set(names)) != len(names):
        raise ValueError("Application must contain nonempty, unique file records")
    for required in (application["setup"], application["executable"]):
        if required not in names:
            raise ValueError(f"Executable is not covered by the bundle: {required}")
    for entry in files:
        target = resolve_bundle_file(root, entry["path"])
        if target.stat().st_size != entry["bytes"]:
            raise ValueError(f"Size mismatch: {entry['path']}")
        if sha256_file(target) != entry["sha256"]:
            raise ValueError(f"SHA-256 mismatch: {entry['path']}")
    return len(files)


def require_windows_desktop():
    if sys.platform != "win32":
        raise RuntimeError("Windows GUI tests require Windows; this host runs " + platform.system())
    user32 = ctypes.WinDLL("user32", use_last_error=True)
    user32.OpenInputDesktop.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    user32.OpenInputDesktop.restype = wintypes.HANDLE
    user32.CloseDesktop.argtypes = [wintypes.HANDLE]
    user32.CloseDesktop.restype = wintypes.BOOL
    user32.GetUserObjectInformationW.argtypes = [wintypes.HANDLE, ctypes.c_int,
                                              ctypes.c_void_p, wintypes.DWORD,
                                              ctypes.POINTER(wintypes.DWORD)]
    user32.GetUserObjectInformationW.restype = wintypes.BOOL
    desktop = user32.OpenInputDesktop(0, False, 1)
    if not desktop:
        raise RuntimeError("No accessible interactive desktop. Log in and unlock Windows.")
    try:
        name = ctypes.create_unicode_buffer(256)
        needed = wintypes.DWORD()
        if not user32.GetUserObjectInformationW(desktop, 2, name, ctypes.sizeof(name),
                                               ctypes.byref(needed)) or name.value != "Default":
            raise RuntimeError("Windows desktop is locked or shows a secure system prompt")
    finally:
        user32.CloseDesktop(desktop)
    import winreg
    with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE,
                        r"SOFTWARE\Microsoft\NET Framework Setup\NDP\v4\Full",
                        0, winreg.KEY_READ | winreg.KEY_WOW64_64KEY) as key:
        release = winreg.QueryValueEx(key, "Release")[0]
    if release < 528040:
        raise RuntimeError(".NET Framework 4.8 or newer is required")
    return {"inputDesktop": name.value, "dotNetRelease": release}


def process_image(pid):
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel32.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    kernel32.OpenProcess.restype = wintypes.HANDLE
    kernel32.QueryFullProcessImageNameW.argtypes = [wintypes.HANDLE, wintypes.DWORD,
                                                   wintypes.LPWSTR,
                                                   ctypes.POINTER(wintypes.DWORD)]
    kernel32.QueryFullProcessImageNameW.restype = wintypes.BOOL
    kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
    handle = kernel32.OpenProcess(0x1000, False, pid)
    if not handle:
        return None
    try:
        size = wintypes.DWORD(32768)
        image = ctypes.create_unicode_buffer(size.value)
        if kernel32.QueryFullProcessImageNameW(handle, 0, image, ctypes.byref(size)):
            return Path(image.value)
        return None
    finally:
        kernel32.CloseHandle(handle)


def find_shortcut(application):
    directories = [
        Path(os.environ["APPDATA"]) / "Microsoft/Windows/Start Menu/Programs",
        Path(os.environ["USERPROFILE"]) / "Desktop",
        Path(os.environ.get("OneDrive", os.environ["USERPROFILE"])) / "Desktop"
    ]
    for directory in directories:
        for candidate in directory.rglob("*.appref-ms"):
            if candidate.stem.casefold() == application["id"].casefold():
                return candidate
    raise RuntimeError("ClickOnce shortcut not found. First run Bootstrap-Windows.ps1 -Install "
                       "and complete the IQB installation dialogs.")


def matching_windows(desktop, executable_name, title_fragment=None):
    matches = []
    for window in desktop.windows(visible_only=True):
        try:
            image = process_image(window.element_info.process_id)
            if image and image.name.casefold() == executable_name.casefold() and (
                title_fragment is None or title_fragment.casefold() in window.window_text().casefold()
            ):
                matches.append((window, image))
        except (OSError, RuntimeError):
            continue
    return matches


def control_record(control):
    info = control.element_info
    rectangle = control.rectangle()
    return {
        "name": control.window_text(),
        "className": info.class_name,
        "controlType": getattr(info, "control_type", None),
        "automationId": getattr(info, "automation_id", None),
        "controlId": getattr(info, "control_id", None),
        "rectangle": [rectangle.left, rectangle.top, rectangle.right, rectangle.bottom]
    }


def inspect_application(root, application, output, launch_mode, timeout):
    from pywinauto import Application, Desktop
    expected_image = resolve_bundle_file(root, application["executable"])
    if matching_windows(Desktop(backend="uia"), expected_image.name):
        raise RuntimeError("Application is already open. Close it before the isolated probe.")
    launcher = find_shortcut(application) if launch_mode == "installed" else expected_image
    if launch_mode == "installed":
        os.startfile(str(launcher))
    else:
        subprocess.Popen([str(launcher)], cwd=str(launcher.parent))
    deadline = time.monotonic() + timeout
    result = {"launchMode": launch_mode, "launcher": str(launcher), "backends": {}}
    primary = None
    try:
        while time.monotonic() < deadline and primary is None:
            for backend in ("uia", "win32"):
                matches = matching_windows(Desktop(backend=backend), expected_image.name,
                                           application["id"].split("-")[-1])
                if matches:
                    primary = max(matches, key=lambda match:
                                  match[0].rectangle().width() * match[0].rectangle().height())
                    result["processId"] = primary[0].element_info.process_id
                    break
            if primary is None:
                time.sleep(0.5)
        if primary is None:
            raise RuntimeError("No visible IQB application window before timeout. "
                               "Inspect ClickOnce prompts and installation errors.")
        window, actual_image = primary
        if sha256_file(actual_image) != sha256_file(expected_image):
            raise RuntimeError("Running executable differs from the audited version. "
                               "The ClickOnce installation may have updated.")
        result["executable"] = str(actual_image)
        result["windowTitle"] = window.window_text()
        time.sleep(2)
        if not window.is_visible() or not process_image(result["processId"]):
            raise RuntimeError("Application disappeared immediately after startup")
        for backend in ("uia", "win32"):
            try:
                app = Application(backend=backend).connect(process=result["processId"])
                controls = []
                for top_window in app.windows():
                    controls.append(control_record(top_window))
                    controls.extend(control_record(control) for control in top_window.descendants())
                if len(controls) < 2:
                    raise RuntimeError("No child controls exposed by this backend")
                inventory = output / f"controls-{backend}.json"
                inventory.write_text(json.dumps(controls, ensure_ascii=True, indent=2), encoding="utf-8")
                result["backends"][backend] = {
                    "status": "passed", "controls": len(controls), "inventory": str(inventory)
                }
            except Exception as error:
                result["backends"][backend] = {"status": "failed", "error": str(error)}
        if not any(item["status"] == "passed" for item in result["backends"].values()):
            raise RuntimeError("Neither UIA nor Win32 exposes usable child controls")
        screenshot = output / "window.png"
        window.capture_as_image().save(screenshot)
        result["screenshot"] = str(screenshot)
        result["status"] = "passed"
        return result
    finally:
        if primary is not None:
            try:
                primary[0].close()
                deadline = time.monotonic() + 10
                while process_image(result["processId"]) and time.monotonic() < deadline:
                    time.sleep(0.2)
                if process_image(result["processId"]):
                    raise RuntimeError("Application did not exit after its main window was closed")
                result["shutdown"] = {"status": "passed"}
            except Exception as error:
                result["status"] = "failed"
                result["shutdown"] = {"status": "failed", "error": str(error)}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bundle", type=Path, required=True)
    parser.add_argument("--app", default="IQB-Kodieren")
    parser.add_argument("--output", type=Path, default=Path("artifacts/windows-probe"))
    parser.add_argument("--launch", choices=("installed", "bundle"), default="installed")
    parser.add_argument("--timeout", type=float, default=120)
    parser.add_argument("--verify-only", action="store_true")
    args = parser.parse_args(argv)
    args.output.mkdir(parents=True, exist_ok=True)
    report = {
        "checkedAt": datetime.now(timezone.utc).isoformat(),
        "host": {"system": platform.system(), "machine": platform.machine(),
                 "python": platform.python_version(),
                 "windowsArchitecture": os.environ.get("PROCESSOR_ARCHITEW6432",
                                                       os.environ.get("PROCESSOR_ARCHITECTURE"))},
        "application": args.app,
        "status": "blocked",
        "checks": {},
        "functionalTests": {"status": "not-run", "reason":
                            "Requires a valid anonymized coding job, expected results, "
                            "and selectors obtained from the real application"}
    }
    exit_code = 2
    try:
        bundle = json.loads((args.bundle / "bundle.json").read_text(encoding="utf-8"))
        candidates = [app for app in bundle["applications"] if app["id"] == args.app]
        if len(candidates) != 1:
            raise ValueError("Requested application is not uniquely present in the verified bundle")
        application = candidates[0]
        report["version"] = application["version"]
        report["checks"]["bundleIntegrity"] = {
            "status": "passed", "files": verify_application(args.bundle, application)
        }
        if args.verify_only:
            report["status"] = "bundle-verified"
        else:
            report["checks"]["desktop"] = require_windows_desktop()
            report["checks"]["startupAndInspection"] = inspect_application(
                args.bundle, application, args.output, args.launch, args.timeout)
            if report["checks"]["startupAndInspection"]["status"] != "passed":
                raise RuntimeError("Application startup/inspection/shutdown did not pass")
            report["status"] = "smoke-passed"
        exit_code = 0
    except Exception as error:
        report["error"] = str(error)
        if "bundleIntegrity" not in report["checks"]:
            report["checks"]["bundleIntegrity"] = {"status": "failed", "error": str(error)}
            report["status"] = "failed"
            exit_code = 1
        elif sys.platform == "win32":
            report["status"] = "failed"
            exit_code = 1
    finally:
        report_path = args.output / "probe.json"
        report_path.write_text(json.dumps(report, ensure_ascii=True, indent=2) + "\n", encoding="utf-8")
        print(f"{args.app}: {report['status']}\nReport: {report_path.resolve()}")
        if "error" in report:
            print(report["error"], file=sys.stderr)
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
