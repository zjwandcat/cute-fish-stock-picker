import importlib.util
import json
import subprocess
import unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("monthly_setup", Path(__file__).parents[1] / "scripts/setup-monthly.py")
setup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(setup)


class EnvironmentTests(unittest.TestCase):
    def check_machine(self, machine):
        result = subprocess.CompletedProcess([], 0, json.dumps({"system": "Darwin", "machine": machine, "version": [3, 12]}))
        with patch.object(setup.subprocess, "run", return_value=result), patch.object(setup.platform, "system", return_value="Darwin"), patch.object(setup.platform, "machine", return_value="arm64"):
            setup.check_environment(Path("python"))

    def test_native_arm_environment_accepted(self):
        self.check_machine("arm64")

    def test_copied_intel_environment_rejected(self):
        with self.assertRaisesRegex(SystemExit, "another OS or architecture"):
            self.check_machine("x86_64")
