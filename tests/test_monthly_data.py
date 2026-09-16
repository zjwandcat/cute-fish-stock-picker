"""Current-month preparation: calendar, PIT financials and restart safety."""
import os
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch

import pandas as pd

from monthly_data import data_lock, ensure_current_m0, required_months, select_announced, _validate


def factor_frame(month, labeled=True):
    return pd.DataFrame({
        "stock_code": [f"{n:06d}.SZ" for n in range(15)],
        "trade_date": [pd.Timestamp(month + "01")] * 15,
        "close_price": [10.] * 15,
        "Target_Return_1M": [0.05 if labeled else float("nan")] * 15,
        **{f"factor_{n}": [float(n)] * 15 for n in range(101)},
    })


class MonthlyDataTests(unittest.TestCase):
    def test_exact_window_for_september_and_year_rollover(self):
        months = required_months("202609")
        self.assertEqual((months[0], months[-1], len(months)), ("202010", "202608", 71))
        self.assertEqual(required_months("202601")[-1], "202512")

    def test_financials_use_only_announced_reports_and_revisions(self):
        frame = pd.DataFrame([
            {"ann_date": "20260425", "end_date": "20260331", "roe": 3.},
            {"ann_date": "20260830", "end_date": "20260630", "roe": 6.},
            {"ann_date": "20260830", "f_ann_date": "20260910", "end_date": "20260630", "roe": 9.},
        ])
        self.assertEqual(select_announced(frame, "20260731")["roe"], 3.)
        self.assertEqual(select_announced(frame, "20260831")["roe"], 6.)
        self.assertEqual(select_announced(frame, "20260930")["roe"], 9.)
        self.assertEqual(select_announced(frame, "20260131"), {})
        with self.assertRaisesRegex(RuntimeError, "公告日期"):
            select_announced(frame.drop(columns="ann_date"), "20260831")

    def test_unlabeled_prediction_allowed_but_unlabeled_training_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "202608.parquet"
            factor_frame("202608", False).to_parquet(path)
            self.assertTrue(_validate(path, "202608", False))
            self.assertFalse(_validate(path, "202608", True))
            self.assertFalse(_validate(path, "202607", False))
            path.write_bytes(b"interrupted parquet")
            self.assertFalse(_validate(path, "202608", False))

    def test_completed_window_needs_no_network(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            pool = root / "data/pool_v2_scheme_b"
            pool.mkdir(parents=True)
            for month in ("202607", "202608"):
                factor_frame(month, month != "202608").to_parquet(pool / f"{month}.parquet")
            with patch("monthly_data.current_month", return_value="202609"), patch("monthly_data._fetcher") as fetcher:
                self.assertEqual(ensure_current_m0(root, 1, 0), ["202607", "202608"])
            fetcher.assert_not_called()

    def test_interrupted_build_keeps_completed_months_and_resumes(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            pipeline = types.ModuleType("m0_database.pipeline")
            pipeline.TushareFetcher = lambda: None
            pipeline.FactorCalculator = type("Calculator", (), {})
            pipeline.filter_stock_pool = lambda frame: frame
            pipeline.load_config = lambda: {"data": {"pool_dirs": {"scheme_b": "unused"}}}
            fetched = types.SimpleNamespace(get_trade_calendar=lambda *_: ["20260831"],
                get_monthly_basic=lambda *_: pd.DataFrame({"close": [10.]}), filter_pool=lambda frame: frame)
            built = []
            def build(**kwargs):
                month = kwargs["months"][0]
                built.append(month)
                out = Path(pipeline.load_config()["data"]["pool_dirs"]["scheme_b"]) / f"{month}.parquet"
                if len(built) == 2:
                    out.write_bytes(b"partial write")
                else:
                    factor_frame(month).to_parquet(out)
            pipeline.run_pipeline = build
            package = types.ModuleType("m0_database")
            package.pipeline = pipeline
            with patch.dict("sys.modules", {"m0_database": package, "m0_database.pipeline": pipeline}), \
                    patch("monthly_data.current_month", return_value="202609"), patch("monthly_data._fetcher", return_value=fetched):
                with self.assertRaisesRegex(RuntimeError, "已完成月份保留"):
                    ensure_current_m0(root, 1, 0)
                pool = root / "data/pool_v2_scheme_b"
                self.assertTrue((pool / "202607.parquet").exists())
                self.assertFalse((pool / "202608.parquet").exists())
                ensure_current_m0(root, 1, 0)
                self.assertEqual(built, ["202607", "202608", "202608"])
                self.assertTrue(pd.read_parquet(pool / "202608.parquet")["Target_Return_1M"].isna().all())

    def test_rollover_matures_only_historical_labels_with_adjusted_prices(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            pool = root / "data/pool_v2_scheme_b"
            pool.mkdir(parents=True)
            for month in ("202607", "202608"):
                factor_frame(month, False).to_parquet(pool / f"{month}.parquet")
            codes = factor_frame("202607")["stock_code"]
            pipeline = types.ModuleType("m0_database.pipeline")
            pipeline.TushareFetcher = lambda: None
            pipeline.FactorCalculator = type("Calculator", (), {})
            pipeline.filter_stock_pool = lambda frame: frame
            pipeline.load_config = lambda: {"data": {"pool_dirs": {"scheme_b": "unused"}}}
            pipeline.run_pipeline = lambda **_: self.fail("Existing factors must not be rebuilt")
            fetched = types.SimpleNamespace(
                get_trade_calendar=lambda start, _: [start[:6] + "28"],
                get_monthly_basic=lambda *_: pd.DataFrame({"ts_code": codes, "close": 6.}),
                get_adj_factor_map=lambda date: dict.fromkeys(codes, 1. if date[:6] == "202607" else 2.),
                filter_pool=lambda frame: frame,
            )
            package = types.ModuleType("m0_database")
            package.pipeline = pipeline
            with patch.dict("sys.modules", {"m0_database": package, "m0_database.pipeline": pipeline}), \
                    patch("monthly_data.current_month", return_value="202609"), patch("monthly_data._fetcher", return_value=fetched):
                ensure_current_m0(root, 1, 0)
            past = pd.read_parquet(pool / "202607.parquet")
            self.assertAlmostEqual(past["Target_Return_1M"].iloc[0], 0.2)
            self.assertTrue(pd.read_parquet(pool / "202608.parquet")["Target_Return_1M"].isna().all())

    @unittest.skipUnless(os.name == "nt", "Windows byte range locking")
    def test_concurrent_windows_update_rejected_and_lock_released(self):
        with tempfile.TemporaryDirectory() as tmp:
            with data_lock(Path(tmp)):
                with self.assertRaisesRegex(RuntimeError, "另一个本机实例"):
                    with data_lock(Path(tmp)):
                        pass
            with data_lock(Path(tmp)):
                pass


if __name__ == "__main__":
    unittest.main()
