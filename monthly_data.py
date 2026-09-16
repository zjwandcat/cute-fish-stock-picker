"""Incremental, current-month M0 preparation using the actual 10q pipeline."""
from __future__ import annotations

import calendar
import contextlib
import json
import os
import pickle
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path


def current_month():
    return datetime.now(timezone(timedelta(hours=8))).strftime("%Y%m")


def shift_month(month, offset):
    number = int(month[:4]) * 12 + int(month[4:]) - 1 + offset
    return f"{number // 12:04d}{number % 12 + 1:02d}"


def required_months(month, train=58, validation=12):
    return [shift_month(month, offset) for offset in range(-(train + validation + 1), 0)]


def progress(stage, message, **extra):
    raw = os.environ.get("TENQ_PROGRESS_FILE")
    if not raw:
        return
    path = Path(raw)
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(f".{os.getpid()}.tmp")
    temp.write_text(json.dumps({"stage": stage, "message": message,
        "recommendation_month": current_month(), "updated_at": datetime.now().isoformat(), **extra}, ensure_ascii=False), encoding="utf-8")
    temp.replace(path)


@contextlib.contextmanager
def data_lock(root):
    path = root / "data" / ".monthly-update.lock"
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a+b") as handle:
        if path.stat().st_size == 0:
            handle.write(b"0")
            handle.flush()
        handle.seek(0)
        try:
            if os.name == "nt":
                import msvcrt
                msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError as exc:
            raise RuntimeError("另一个本机实例正在补齐月度数据，请稍后自动重试") from exc
        try:
            yield
        finally:
            handle.seek(0)
            if os.name == "nt":
                msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                fcntl.flock(handle, fcntl.LOCK_UN)


def select_announced(frame, as_of):
    if frame.empty:
        return {}
    if not {"ann_date", "end_date"}.issubset(frame.columns):
        raise RuntimeError("财报缺少公告日期，无法进行时点校验")
    announced = frame["ann_date"].astype(str)
    if "f_ann_date" in frame:
        actual = frame["f_ann_date"].fillna(frame["ann_date"]).astype(str)
        announced = announced.where(announced >= actual, actual)
    visible = frame[frame["ann_date"].notna() & (announced <= as_of)
                    & (frame["end_date"].astype(str) <= as_of)]
    if visible.empty:
        return {}
    visible = visible.assign(_visible_date=announced.loc[visible.index])
    return visible.sort_values(["end_date", "_visible_date"], ascending=False).drop(columns="_visible_date").iloc[0].to_dict()

def _fetcher(root, target, first_missing):
    import numpy as np
    import pandas as pd
    import tushare as ts
    from m0_database.data_fetcher import TushareFetcher

    class IncrementalFetcher(TushareFetcher):
        def __init__(self):
            super().__init__()
            token = os.environ.get("TUSHARE_TOKEN")
            if token:
                self.pro = ts.pro_api(token, timeout=30)
            self.as_of = target
            self.rate_lock = threading.Lock()
            self.finance = {}
            self.cache_dir = root / "data" / "monthly_live_cache"
            self.cache_dir.mkdir(parents=True, exist_ok=True)
            self.source_cache = root / "data" / "raw_cache"
            self.start = f"{int(first_missing[:4]) - 2}0101"

        def _rate_limit(self):
            with self.rate_lock:
                remaining = 0.32 - (time.monotonic() - self._last_call)
                if remaining > 0:
                    time.sleep(remaining)
                self._last_call = time.monotonic()

        def query(self, endpoint, **kwargs):
            for attempt in range(3):
                self._rate_limit()
                try:
                    return self.pro.query(endpoint, **kwargs)
                except Exception as exc:
                    # Never include credentials or HTTP request payloads in reports.
                    if attempt == 2:
                        raise RuntimeError(f"Tushare {endpoint} 数据获取失败；请检查网络及接口权限") from None
                    time.sleep(2 ** attempt)

        def _load_cache(self, key):
            try:
                cached = super()._load_cache(key)
            except (OSError, EOFError, ValueError, pickle.UnpicklingError):
                cached = None
            if cached is not None:
                return cached
            # Only reuse immutable historical date bars, never stale stock lists
            # or financial snapshots without announcement dates.
            if key.startswith("daily_by_date_"):
                path = self.source_cache / f"{key}.pkl"
                if path.exists():
                    try:
                        with path.open("rb") as handle:
                            return pickle.load(handle)
                    except (OSError, EOFError, ValueError, pickle.UnpicklingError):
                        return None
            return None

        def _save_cache(self, key, data):
            path = self._cache_path(key)
            temp = path.with_suffix(f".{os.getpid()}.{threading.get_ident()}.tmp")
            with temp.open("wb") as handle:
                pickle.dump(data, handle)
            temp.replace(path)

        def get_stock_basic(self):
            key = f"stock_basic_{current_month()}"
            cached = self._load_cache(key)
            if cached is not None:
                return cached
            frames = [self.query("stock_basic", exchange="", list_status=status,
                                 fields="ts_code,name,industry,list_date") for status in ("L", "D", "P")]
            frame = pd.concat(frames, ignore_index=True).drop_duplicates("ts_code")
            self._save_cache(key, frame)
            return frame

        def get_trade_calendar(self, start_date, end_date):
            year, month = int(end_date[:4]), int(end_date[4:6])
            end_date = end_date[:6] + f"{min(int(end_date[6:]), calendar.monthrange(year, month)[1]):02d}"
            key = f"calendar_{start_date}_{end_date}"
            cached = self._load_cache(key)
            if cached is not None:
                return cached
            frame = self.query("trade_cal", exchange="SSE", start_date=start_date, end_date=end_date, is_open=1)
            result = sorted(frame["cal_date"].tolist())
            if result:
                self._save_cache(key, result)
            return result

        def get_monthly_basic(self, trade_date):
            if trade_date > target:
                return pd.DataFrame()
            key = f"monthly_basic_{trade_date}"
            cached = self._load_cache(key)
            if cached is not None:
                return cached
            frame = self.query("daily_basic", trade_date=trade_date)
            if frame.empty or not frame["trade_date"].eq(trade_date).all():
                raise RuntimeError(f"{trade_date} 月末行情尚未完整发布")
            if frame["ts_code"].duplicated().any():
                raise RuntimeError(f"{trade_date} 行情股票重复")
            self._save_cache(key, frame)
            return frame

        def get_daily_valuation(self, trade_date):
            return self.get_monthly_basic(trade_date)

        def filter_pool(self, frame, verbose=False):
            from m0_database.stock_filter import filter_stock_pool
            as_of = str(frame["trade_date"].iloc[0])
            calendar_days = self.get_trade_calendar("19900101", as_of)
            listings = self.get_stock_basic().set_index("ts_code")["list_date"]
            frame = frame.copy()
            listed = frame["stock_code"].map(listings).fillna("99999999").astype(str).to_numpy()
            frame["days_listed"] = len(calendar_days) - np.searchsorted(np.asarray(calendar_days), listed)
            recent = calendar_days[-20:]
            progress("m0", f"{as_of[:6]}：校验近 20 交易日换手率与当月停牌")
            basics = pd.concat([self.get_monthly_basic(day) for day in recent], ignore_index=True)
            turnover = basics.groupby("ts_code")["turnover_rate"].sum(min_count=1) / 20 / 100
            frame["avg_turnover_rate"] = frame["stock_code"].map(turnover)
            month_days = [day for day in calendar_days if day[:6] == as_of[:6]]
            bars = pd.concat([self.get_daily_data_by_date(day) for day in month_days], ignore_index=True)
            traded = bars[bars["vol"] > 0].groupby("ts_code")["trade_date"].nunique()
            frame["suspend_days"] = len(month_days) - frame["stock_code"].map(traded).fillna(0)
            return filter_stock_pool(frame, verbose=verbose)

        def get_daily_data_by_date(self, trade_date):
            key = f"daily_by_date_{trade_date}"
            cached = self._load_cache(key)
            if cached is not None and not cached.empty:
                return cached
            frame = self.query("daily", trade_date=trade_date,
                               fields="ts_code,trade_date,open,high,low,close,vol,amount")
            if frame.empty:
                raise RuntimeError(f"交易日 {trade_date} 的日线缺失")
            self._save_cache(key, frame)
            return frame

        def _financial_history(self, code, endpoint):
            key = f"pit_{endpoint}_{code}_{self.start}_{target}"
            if key in self.finance:
                return self.finance[key]
            frame = self._load_cache(key)
            if frame is None:
                frame = self.query(endpoint, ts_code=code, start_date=self.start, end_date=target)
                self._save_cache(key, frame)
            self.finance[key] = frame
            return frame

        def get_financial_data(self, ts_code, period):
            return select_announced(self._financial_history(ts_code, "fina_indicator"), self.as_of)

        def get_balance_sheet(self, ts_code, period):
            return select_announced(self._financial_history(ts_code, "balancesheet"), self.as_of)

        def get_daily_data_batch(self, ts_codes, end_date, n_days=300, daily_basic_df=None):
            self.as_of = end_date
            progress("m0", f"{end_date[:6]}：获取 {len(ts_codes)} 只股票的日线与已公告财报")
            def prepare(code):
                self._financial_history(code, "fina_indicator")
                self._financial_history(code, "balancesheet")
            with ThreadPoolExecutor(max_workers=4) as pool:
                try:
                    for index, _ in enumerate(pool.map(prepare, ts_codes)):
                        if index % 50 == 0:
                            progress("m0", f"补齐历史 {end_date[:6]}：财报 {index + 1}/{len(ts_codes)}", completed=index + 1, total=len(ts_codes))
                except Exception:
                    pool.shutdown(wait=True, cancel_futures=True)
                    raise
            return super().get_daily_data_batch(ts_codes, end_date, n_days, daily_basic_df)

        def get_adj_factor_map(self, trade_date):
            key = f"adj_factor_{trade_date}"
            cached = self._load_cache(key)
            if cached is not None:
                return cached
            frame = self.query("adj_factor", trade_date=trade_date)
            if frame.empty:
                raise RuntimeError(f"{trade_date} 复权因子缺失")
            result = dict(zip(frame["ts_code"], frame["adj_factor"]))
            self._save_cache(key, result)
            return result

        def get_macro_data(self, trade_date):
            # Keep the upstream Tushare calculation; avoid an unbounded fallback
            # download from unrelated providers during monthly preparation.
            key = f"macro_{trade_date}"
            cached = self._load_cache(key)
            if cached is not None:
                return cached
            result = self._get_macro_data_tushare(trade_date)
            result = {k: v for k, v in result.items() if v is not None and np.isfinite(v) and abs(v) > 1e-10}
            self._save_cache(key, result)
            return result

    return IncrementalFetcher()


def _validate(path, month, needs_labels):
    import pandas as pd
    import pyarrow.parquet as pq
    try:
        schema = pq.read_schema(path)
        required = ["stock_code", "trade_date", "Target_Return_1M", "close_price"]
        if not all(name in schema.names for name in required):
            return False
        frame = pd.read_parquet(path, columns=required)
        return (len(frame) >= 15 and not frame["stock_code"].duplicated().any()
                and frame["trade_date"].nunique() == 1
                and pd.to_datetime(frame["trade_date"]).dt.strftime("%Y%m").eq(month).all()
                and len(schema.names) > 100
                and (not needs_labels or frame["Target_Return_1M"].notna().mean() >= 0.9))
    except (OSError, ValueError):
        return False


def ensure_current_m0(root, train_months, validation_months=12):
    import pandas as pd
    months = required_months(current_month(), train_months, validation_months)
    target_month = months[-1]
    folder = root / "data/pool_v2_scheme_b"
    folder.mkdir(parents=True, exist_ok=True)
    with data_lock(root):
        missing = [m for m in months if not _validate(folder / f"{m}.parquet", m, m != target_month)]
        if not missing:
            return months
        progress("m0", f"检查 {months[0]}–{target_month}：需要补齐 {len(missing)} 个月", missing_months=missing)
        (root / "logs/m0").mkdir(parents=True, exist_ok=True)
        from m0_database import pipeline
        end_day = calendar.monthrange(int(target_month[:4]), int(target_month[4:]))[1]
        target = f"{target_month}{end_day:02d}"
        fetcher = _fetcher(root, target, missing[0])
        calendar_days = fetcher.get_trade_calendar(target_month + "01", target)
        if not calendar_days:
            raise RuntimeError(f"{target_month} 交易日历尚未发布，稍后自动重试")
        last_trade = calendar_days[-1]
        fetcher.get_monthly_basic(last_trade)
        original_fetcher = pipeline.TushareFetcher
        original_filter = pipeline.filter_stock_pool
        original_config = pipeline.load_config
        original_calculator = pipeline.FactorCalculator
        class ProgressCalculator(original_calculator):
            def __init__(self):
                super().__init__()
                self.completed = 0

            def calculate_all(self, *args, **kwargs):
                if self.completed % 100 == 0:
                    progress("m0", f"{fetcher.as_of[:6]}：计算股票因子 {self.completed} 只已完成")
                result = super().calculate_all(*args, **kwargs)
                self.completed += 1
                return result
        staging = root / "data/.monthly-stage"
        staging.mkdir(parents=True, exist_ok=True)
        def staged_config():
            config = original_config()
            config["data"]["pool_dirs"]["scheme_b"] = str(staging)
            return config
        pipeline.TushareFetcher = lambda: fetcher
        pipeline.filter_stock_pool = fetcher.filter_pool
        pipeline.load_config = staged_config
        pipeline.FactorCalculator = ProgressCalculator
        try:
            for index, month in enumerate(missing):
                progress("m0", f"补齐 M0 {month}（{index + 1}/{len(missing)}）", missing_months=missing[index:])
                path = folder / f"{month}.parquet"
                if month != target_month and _validate(path, month, False):
                    # Mature the last unlabeled historical month without recomputing factors.
                    frame = pd.read_parquet(path)
                    curr = pd.to_datetime(frame["trade_date"]).max().strftime("%Y%m%d")
                    nxt = shift_month(month, 1)
                    end = calendar.monthrange(int(nxt[:4]), int(nxt[4:]))[1]
                    following = fetcher.get_trade_calendar(nxt + "01", f"{nxt}{end:02d}")[-1]
                    next_basic = fetcher.get_monthly_basic(following).set_index("ts_code")
                    adj_now, adj_next = fetcher.get_adj_factor_map(curr), fetcher.get_adj_factor_map(following)
                    codes = frame["stock_code"]
                    frame["Target_Return_1M"] = ((codes.map(next_basic["close"]) * codes.map(adj_next)) /
                        (frame["close_price"] * codes.map(adj_now)) - 1).clip(-0.5, 0.5)
                    temp = path.with_suffix(".tmp.parquet")
                    frame.to_parquet(temp, index=False)
                    if not _validate(temp, month, True):
                        raise RuntimeError(f"{month} 的训练标签覆盖不足 90%，停止推荐")
                    temp.replace(path)
                else:
                    staged_path = staging / path.name
                    if staged_path.exists():
                        staged_path.unlink()
                    pipeline.run_pipeline(schemes=["scheme_b"], months=[month], phase="full", force_rebuild=True)
                    if staged_path.exists() and month == target_month:
                        try:
                            frame = pd.read_parquet(staged_path)
                        except (OSError, ValueError):
                            raise RuntimeError(f"M0 {month} 写入不完整，已完成月份保留，下次自动续跑") from None
                        frame["Target_Return_1M"] = float("nan")
                        frame.to_parquet(staged_path, index=False)
                    if not _validate(staged_path, month, month != target_month):
                        raise RuntimeError(f"M0 {month} 未生成完整数据，已完成月份保留，下次自动续跑")
                    staged_path.replace(path)
                if not _validate(path, month, month != target_month):
                    raise RuntimeError(f"M0 {month} 未生成完整数据，已完成月份保留，下次自动续跑")
        finally:
            pipeline.TushareFetcher = original_fetcher
            pipeline.filter_stock_pool = original_filter
            pipeline.load_config = original_config
            pipeline.FactorCalculator = original_calculator
        progress("m1", f"M0 {months[0]}–{target_month} 已齐备，开始本月模型计算")
    return months
