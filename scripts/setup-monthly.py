"""Create an isolated native Python environment for the monthly engine."""
import argparse
import json
import os
import platform
import subprocess
import sys
from pathlib import Path


def check_environment(python: Path):
    probe = subprocess.run(
        [str(python), "-c", "import json,platform,sys; print(json.dumps({'system':platform.system(),'machine':platform.machine(),'version':list(sys.version_info[:2])}))"],
        capture_output=True, text=True, check=True,
    )
    actual = json.loads(probe.stdout)
    if actual["system"] != platform.system() or actual["machine"].lower() != platform.machine().lower():
        raise SystemExit("Monthly environment belongs to another OS or architecture. Rename .monthly-venv and rerun setup using native Python.")
    if not (3, 11) <= tuple(actual["version"]) <= (3, 14):
        raise SystemExit("Monthly environment needs Python 3.11-3.14; rename .monthly-venv and rerun setup.")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    root = Path(__file__).resolve().parent.parent
    if not (3, 11) <= sys.version_info[:2] <= (3, 14):
        raise SystemExit("Use native Python 3.11-3.14 (3.12 recommended).")
    if sys.platform == "darwin":
        translated = subprocess.run(["sysctl", "-in", "sysctl.proc_translated"], capture_output=True, text=True)
        if translated.stdout.strip() == "1":
            raise SystemExit("Use native arm64 Python, not Rosetta, on Apple Silicon.")
        if int(platform.mac_ver()[0].split(".")[0]) < 14:
            raise SystemExit("The monthly macOS demo targets macOS 14+ and current macOS releases.")
    environment = root / ".monthly-venv"
    python = environment / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
    if not args.check:
        if not python.exists():
            subprocess.run([sys.executable, "-m", "venv", str(environment)], check=True)
        check_environment(python)
        subprocess.run([str(python), "-m", "pip", "install", "--only-binary=:all:",
                        "-r", str(root / "requirements-monthly.txt")], check=True)
    if not python.exists():
        raise SystemExit("Monthly environment missing; run setup without --check.")
    if args.check:
        check_environment(python)
    subprocess.run([str(python), "-c", "import numpy,pandas,scipy,pyarrow,polars,yaml,lightgbm,xgboost,psutil,tushare,openpyxl; print('Monthly CPU dependencies: OK')"], check=True)
    print(f"Python: {python}")
    print("Set TENQ_ROOT to your 10q checkout with Trial 157 study files. Missing M0 months are downloaded automatically.")


if __name__ == "__main__":
    main()
