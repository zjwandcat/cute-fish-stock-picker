"""Run: py -3 -m unittest discover -s tests -p test_monthly.py"""
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from monthly_recommendation_runner import _attributions, _load_recent_m0, _next_month
from monthly_runtime import configure_device, write_cache


class MonthlyTests(unittest.TestCase):
    def test_real_cpu_tree_contributions_reconstruct_score(self):
        from types import SimpleNamespace
        import numpy as np
        import pandas as pd
        import lightgbm as lgb
        import xgboost as xgb
        rng = np.random.default_rng(157)
        values = rng.normal(size=(80, 4)).astype(np.float32)
        labels = values[:, 0] - values[:, 1] * 0.4
        left = lgb.train({"objective": "regression", "num_leaves": 4, "verbosity": -1,
                          "num_threads": 1, "seed": 157}, lgb.Dataset(values, label=labels), num_boost_round=8)
        right = xgb.train({"objective": "reg:squarederror", "max_depth": 2, "device": "cpu",
                           "nthread": 1, "seed": 157}, xgb.DMatrix(values, label=labels), num_boost_round=8)
        columns = [f"factor_{i}" for i in range(4)]
        frame = pd.DataFrame(values, columns=columns)
        frame["score"] = 0.65 * left.predict(values) + 0.35 * right.predict(xgb.DMatrix(values))
        predictor = SimpleNamespace(lgbm=SimpleNamespace(model_=left, best_iteration_=8),
                                    xgb=SimpleNamespace(model_=right, best_iteration_=0))
        _, details, error = _attributions(frame, frame.head(10), predictor, columns, {"lgbm_weight": 0.65})
        self.assertLess(error, 1e-5)
        for index, detail in details.items():
            reconstructed = detail["base_value"] + detail["other_contribution"] + sum(f["contribution"] for f in detail["factors"])
            self.assertAlmostEqual(reconstructed, frame.loc[index, "score"], places=5)

    def test_month_rollover(self):
        self.assertEqual(_next_month("202512"), "202601")
        self.assertEqual(_next_month("202601"), "202602")

    def test_cpu_never_probes_gpu(self):
        import types
        config = type("GPUConfig", (), {})
        module = types.ModuleType("m2_engine.gpu_detector")
        module.GPUConfig = config
        with patch.dict(os.environ, {"TENQ_DEVICE": "cpu"}), patch.dict("sys.modules", {"m2_engine.gpu_detector": module}), patch("subprocess.run") as run:
            result = configure_device()
        run.assert_not_called()
        self.assertEqual(result["xgb"], "cpu")
        self.assertFalse(config._instance._cuda_available)

    def test_macos_auto_stays_on_cpu_without_cuda_probe(self):
        import types
        config = type("GPUConfig", (), {})
        module = types.ModuleType("m2_engine.gpu_detector")
        module.GPUConfig = config
        with patch.dict(os.environ, {"TENQ_DEVICE": "auto"}), patch.dict("sys.modules", {"m2_engine.gpu_detector": module}), patch("sys.platform", "darwin"), patch("subprocess.run") as run:
            result = configure_device()
        run.assert_not_called()
        self.assertEqual(result["xgb"], "cpu")

    def test_atomic_cache_and_nonfinite_rejection(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "result.json"
            write_cache(path, {"success": True})
            with self.assertRaises(ValueError):
                write_cache(path, {"value": float("nan")})
            self.assertEqual(json.loads(path.read_text()), {"success": True})

    def test_missing_month_rejected(self):
        import types
        # Import native extensions outside patch.dict: restoring sys.modules
        # must not unload NumPy, which cannot be initialized twice in Python 3.14.
        import pandas  # noqa: F401
        module = types.ModuleType("m0_database.stock_filter")
        module.filter_stock_pool = lambda x: x
        with tempfile.TemporaryDirectory() as folder, patch.dict("sys.modules", {"m0_database.stock_filter": module}):
            pool = Path(folder) / "data/pool_v2_scheme_b"
            pool.mkdir(parents=True)
            for month in ("202501", "202503"):
                (pool / f"{month}.parquet").touch()
            with self.assertRaisesRegex(RuntimeError, "不连续"):
                _load_recent_m0(Path(folder), 2)


if __name__ == "__main__":
    unittest.main()
