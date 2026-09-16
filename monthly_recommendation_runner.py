"""Run one real 10q monthly prediction window and emit JSON.

The application invokes this bridge on demand. It intentionally uses only the
latest M0 window needed by Trial 157 (58 train + 12 validation + 1 prediction
month), rather than replaying the historical backtest.
"""
from __future__ import annotations

import contextlib
import json
import logging
import os
import sys
import traceback
import time
from datetime import datetime
from pathlib import Path
from monthly_runtime import configure_threads, configure_device, fingerprint, cache_path, write_cache

configure_threads()


TRIAL_157 = {
    "lgbm_learning_rate": 0.0968409647470805,
    "lgbm_n_estimators": 484,
    "lgbm_max_depth": 2,
    "lgbm_colsample_bytree": 0.10536074884599608,
    "lgbm_reg_alpha": 1.9793887096495548,
    "lgbm_reg_lambda": 0.8666844111861742,
    "lgbm_min_split_gain": 0.018570276160395794,
    "lgbm_lr_mode": "decay",
    "lgbm_decay_every": 43,
    "lgbm_decay_factor": 0.898970990791654,
    "lgbm_depth_mode": "adaptive",
    "lgbm_early_stopping_rounds": 22,
    "xgb_learning_rate": 0.01810075692260063,
    "xgb_n_estimators": 295,
    "xgb_max_depth": 2,
    "xgb_colsample_bytree": 0.3020423874593625,
    "xgb_reg_alpha": 0.49297573130648986,
    "xgb_reg_lambda": 2.659211386778775,
    "xgb_gamma": 0.04184936519518901,
    "xgb_lr_mode": "decay",
    "xgb_decay_every": 63,
    "xgb_decay_factor": 0.6533733463319075,
    "xgb_early_stopping_rounds": 49,
    "lgbm_weight": 0.6499803211765002,
    "min_valid_rate": 0.3586135920144125,
    "max_corr": 0.9134699029459136,
    "min_ic_abs": 0.005532869719065366,
    "min_keep_factors": 114,
    "drop_short_term_noise": True,
    "train_months": 58,
}

FACTOR_LABELS = {
    "momentum_": "动量",
    "reversal_": "反转",
    "volatility_": "波动率",
    "quality_": "质量",
    "value_": "价值",
    "growth_": "成长",
    "technical_": "技术",
    "liquidity_": "流动性",
    "size_": "规模",
    "barra_": "Barra 风格",
    "aqr_": "AQR 风格",
    "jq_": "量化技术",
    "sup_": "增强",
    "alpha101_": "Alpha101",
    "macro_": "宏观",
}

TRIAL_INTEGER_PARAMS = {
    "lgbm_n_estimators",
    "lgbm_max_depth",
    "lgbm_decay_every",
    "lgbm_early_stopping_rounds",
    "xgb_n_estimators",
    "xgb_max_depth",
    "xgb_decay_every",
    "xgb_early_stopping_rounds",
    "min_keep_factors",
    "train_months",
}


def _find_root() -> Path | None:
    candidates = [
        os.environ.get("TENQ_ROOT", "").strip(),
        os.environ.get("TEN_Q_ROOT", "").strip(),
        str(Path(__file__).resolve().parent / "tenq"),
        str(Path.home() / "10q" / "10q-202604gpu"),
        str(Path.home() / "10q"),
        r"E:\10q\10q-202604gpu",
        r"D:\10q\10q-202604gpu",
    ]
    for raw in candidates:
        if not raw:
            continue
        root = Path(raw).expanduser()
        if (root / "config" / "config.yaml").exists() and (root / "data" / "pool_v2_scheme_b").is_dir():
            return root.resolve()
    return None


def _load_trial_157(root: Path):
    """Read Trial 157 from the project's p2 Optuna database.

    The checked-in parameter dictionary documents the expected parameter set,
    but the live run always uses the database row so a changed study cannot be
    silently replaced by copied values.
    """
    import sqlite3

    db_path = root / "output" / "21BB" / "p2" / "21BB_p2_study.db"
    if not db_path.exists():
        raise RuntimeError(f"找不到 Trial 157 数据库：{db_path}")
    with sqlite3.connect(db_path.as_uri() + "?mode=ro", uri=True) as connection:
        trials = connection.execute(
            "SELECT trial_id, state FROM trials WHERE number = ?",
            (157,),
        ).fetchall()
        if len(trials) != 1:
            raise RuntimeError("21BB p2 数据库中不存在 Trial 157")
        trial_id, state = trials[0]
        if state != "COMPLETE":
            raise RuntimeError(f"Trial 157 当前状态为 {state}，不是 COMPLETE")
        rows = connection.execute(
            "SELECT param_name, param_value, distribution_json "
            "FROM trial_params WHERE trial_id = ?",
            (trial_id,),
        ).fetchall()

    params = {}
    for name, raw_value, distribution_json in rows:
        if name not in TRIAL_157:
            continue
        distribution = json.loads(distribution_json or "{}")
        if distribution.get("name") == "CategoricalDistribution":
            choices = distribution.get("attributes", {}).get("choices", [])
            index = int(round(float(raw_value)))
            if index < 0 or index >= len(choices):
                raise RuntimeError(f"Trial 157 参数 {name} 的分类值无效")
            value = choices[index]
        elif name in TRIAL_INTEGER_PARAMS:
            value = int(round(float(raw_value)))
        else:
            value = float(raw_value)
        params[name] = value

    missing = sorted(set(TRIAL_157) - set(params))
    if missing:
        config_path = root / "output" / "21BB" / "p2" / "21BB_p2_config.json"
        try:
            config = json.loads(config_path.read_text(encoding="utf-8"))
            ranges = config.get("config", {}).get("param_ranges", {})
            for name in missing:
                fixed_default = ranges.get(name, {}).get("adjusted_default")
                if fixed_default is not None:
                    params[name] = int(fixed_default) if name in TRIAL_INTEGER_PARAMS else fixed_default
        except (OSError, json.JSONDecodeError) as exc:
            raise RuntimeError(f"读取 Trial 157 固定参数失败：{exc}") from exc
    missing = sorted(set(TRIAL_157) - set(params))
    if missing:
        raise RuntimeError(f"Trial 157 缺少参数：{', '.join(missing)}")
    fixed_source = root / "output" / "21BB" / "p2" / "21BB_p2_config.json"
    return params, f"{db_path} + {fixed_source}"


def _next_month(month: str) -> str:
    year, number = int(month[:4]), int(month[4:])
    if number == 12:
        return f"{year + 1}01"
    return f"{year}{number + 1:02d}"


def _factor_family(name: str) -> str:
    for prefix, label in FACTOR_LABELS.items():
        if name.startswith(prefix):
            return label
    return "综合"


def _finite(value, default=0.0) -> float:
    try:
        result = float(value)
        return result if result == result and abs(result) != float("inf") else default
    except (TypeError, ValueError):
        return default


def _json_value(value):
    if hasattr(value, "item"):
        value = value.item()
    if isinstance(value, float):
        return _finite(value)
    return value


def _assemble_params(trial_params):
    lgbm = {}
    xgb = {}
    feature = {}
    special_lgbm = {
        "lgbm_lr_mode": "lr_mode",
        "lgbm_decay_every": "decay_every",
        "lgbm_decay_factor": "decay_factor",
        "lgbm_depth_mode": "depth_mode",
        "lgbm_early_stopping_rounds": "early_stopping_rounds",
    }
    special_xgb = {
        "xgb_lr_mode": "lr_mode",
        "xgb_decay_every": "decay_every",
        "xgb_decay_factor": "decay_factor",
        "xgb_early_stopping_rounds": "early_stopping_rounds",
    }
    for name, value in trial_params.items():
        if name.startswith("lgbm_"):
            key = special_lgbm.get(name, name[5:])
            lgbm[key] = value
        elif name.startswith("xgb_"):
            key = special_xgb.get(name, name[4:])
            xgb[key] = value
        elif name in {"min_valid_rate", "max_corr", "min_ic_abs", "min_keep_factors", "drop_short_term_noise"}:
            feature[name] = value
    return lgbm, xgb, feature


def _load_recent_m0(root: Path, months_needed: int):
    import pandas as pd
    from m0_database.stock_filter import filter_stock_pool

    current = datetime.now().strftime("%Y%m")
    paths = sorted(p for p in (root / "data" / "pool_v2_scheme_b").glob("*.parquet")
                   if len(p.stem) == 6 and p.stem.isdigit() and p.stem < current)
    if len(paths) < months_needed:
        raise RuntimeError(f"scheme_b M0 仅有 {len(paths)} 个月，Trial 157 至少需要 {months_needed} 个月")
    selected = paths[-months_needed:]
    if any(_next_month(a.stem) != b.stem for a, b in zip(selected, selected[1:])):
        raise RuntimeError("M0 月份不连续，不能构建 Trial 157 窗口")
    frames = []
    for path in selected:
        part = pd.read_parquet(path)
        dates = pd.to_datetime(part["trade_date"])
        if dates.isna().any() or not dates.dt.strftime("%Y%m").eq(path.stem).all() or dates.nunique() != 1:
            raise RuntimeError(f"M0 月份与文件名不一致：{path.name}")
        if part["stock_code"].duplicated().any():
            raise RuntimeError(f"M0 股票重复：{path.name}")
        frames.append(part)
    frame = pd.concat(frames, ignore_index=True)
    frame["trade_date"] = pd.to_datetime(frame["trade_date"])
    frame = frame.sort_values("trade_date").reset_index(drop=True)
    return frame, paths[-1].stem, filter_stock_pool


def _attributions(pred_df, portfolio, predictor, feature_cols, trial_params):
    import numpy as np
    import xgboost as xgb

    values = pred_df.loc[portfolio.index, feature_cols].to_numpy(dtype=np.float32)
    left = predictor.lgbm.model_.predict(values, pred_contrib=True,
                                        num_iteration=predictor.lgbm.best_iteration_)
    # Match the upstream prediction iteration range exactly, including its
    # current exclusive upper bound. Do not silently change Trial 157 semantics.
    right = predictor.xgb.model_.predict(xgb.DMatrix(values), pred_contribs=True,
                                        iteration_range=(0, predictor.xgb.best_iteration_))
    combined = trial_params["lgbm_weight"] * left + (1 - trial_params["lgbm_weight"]) * right
    scores = pred_df.loc[portfolio.index, "score"].to_numpy()
    error = float(np.max(np.abs(combined.sum(axis=1) - scores)))
    if not np.isfinite(combined).all() or error > 1e-5:
        raise RuntimeError(f"模型贡献加和校验失败：{error}")
    contributions = combined[:, :-1]
    aggregate = np.nanmean(np.abs(contributions), axis=0)
    core_order = np.argsort(-aggregate)[:6]
    core = [
        {
            "name": feature_cols[index],
            "impact": round(_finite(aggregate[index]), 4),
            "description": f"{_factor_family(feature_cols[index])}因子，前十持仓平均绝对贡献",
        }
        for index in core_order
    ]
    result = {}
    for row_number, index in enumerate(portfolio.index):
        order = np.argsort(-np.abs(contributions[row_number]))[:12]
        details = []
        for factor_index in order:
            details.append({
                "name": feature_cols[factor_index],
                "value": round(_finite(values[row_number, factor_index]), 4),
                "contribution": round(_finite(contributions[row_number, factor_index]), 4),
            })
        result[index] = {"factors": details, "base_value": float(combined[row_number, -1]),
                         "other_contribution": float(contributions[row_number].sum() - sum(d["contribution"] for d in details))}
    return core, result, error


def _run(root: Path) -> dict:
    import numpy as np
    import pandas as pd
    import polars as pl
    from m1_engine.label_maker import LabelMaker
    from m1_engine.rolling_splitter import RollingSplitter
    from m2_engine.feature_store import FeatureStore
    from m2_engine.ensemble import EnsemblePredictor
    from m2_engine.portfolio_builder import PortfolioBuilder

    started = time.perf_counter()
    timings = {}
    trial_params, trial_source = _load_trial_157(root)
    device = configure_device()
    train_months = int(trial_params["train_months"])
    splitter = RollingSplitter(train_months=train_months)
    if splitter.valid_months != 12 or splitter.test_months != 1:
        raise RuntimeError("Trial 157 需要 12 个月验证和 1 个月预测")
    months_needed = splitter.window_size
    frame, latest_m0, stock_filter = _load_recent_m0(root, months_needed)
    timings["m0"] = round(time.perf_counter() - started, 3)
    mark = time.perf_counter()
    frame = LabelMaker().make_labels(frame)
    window = next(splitter.split(frame, copy=False))
    pred_raw = window["pred_df"]
    pred_df = stock_filter(pred_raw, verbose=False)
    timings["m1"] = round(time.perf_counter() - mark, 3)
    mark = time.perf_counter()
    if len(pred_df) < 15:
        raise RuntimeError(f"M0 stock_filter 后预测池仅 {len(pred_df)} 只股票，低于 M2 最低门槛")

    lgbm_params, xgb_params, feature_params = _assemble_params(trial_params)
    feature_store = FeatureStore(**feature_params)
    train_p, val_p, pred_p, feature_cols = feature_store.fit_transform(
        window["train_df"], window["val_df"], pred_df
    )
    predictor = EnsemblePredictor(
        lgbm_weight=trial_params["lgbm_weight"],
        xgb_weight=1 - trial_params["lgbm_weight"],
        lgbm_params=lgbm_params,
        xgb_params=xgb_params,
    )
    try:
        prediction = predictor.fit_predict(train_p, val_p, pred_p, feature_cols)
    except Exception as exc:
        if device["xgb"] != "cuda":
            raise
        device.update(xgb="cpu", reason=f"CUDA training failed; CPU retry: {type(exc).__name__}")
        predictor = EnsemblePredictor(lgbm_weight=trial_params["lgbm_weight"],
            xgb_weight=1 - trial_params["lgbm_weight"], lgbm_params=lgbm_params,
            xgb_params=xgb_params, strategy="cpu")
        prediction = predictor.fit_predict(train_p, val_p, pred_p, feature_cols)
    portfolio = PortfolioBuilder().build(
        prediction["pred_df_with_scores"],
        prediction["val_ic"],
        prediction["ic_gap"],
        prediction["is_penalized"],
        predictor.lgbm,
        feature_cols,
        prediction["pred_month"],
        compute_shap=False,
    )
    if portfolio is None or portfolio.empty:
        raise RuntimeError("M2 PortfolioBuilder 没有生成持仓")
    portfolio = portfolio[portfolio["is_holding"]].copy()
    if len(portfolio) != 10 or portfolio["stock_code"].nunique() != 10 or not np.isclose(portfolio["weight"].sum(), 1):
        raise RuntimeError("M2 必须生成十只不同股票，目标权重总和为 100%")
    timings["m2"] = round(time.perf_counter() - mark, 3)
    mark = time.perf_counter()

    # M3 is applied to the same one-month M2 output. It is a risk signal only;
    # the requested ten M2 holdings and their High/Low weights are preserved.
    m3_map = {}
    try:
        from m3_engine.tet_engine import M3Config, TETEngine
        m3_config = M3Config.from_yaml(root / "config" / "config_m3.yaml")
        m3_config.scheme = "scheme_b"
        m3 = TETEngine(m3_config)
        m3_output = m3.process_month(
            prediction["pred_month"],
            pl.from_pandas(portfolio[["stock_code", "stock_name", "trade_date", "weight", "pred_month"]]),
            pl.from_pandas(pred_df),
            m3_config.risk_free_rate_annual / 12,
        ).to_pandas()
        for _, row in m3_output.iterrows():
            m3_map[row["stock_code"]] = (str(row.get("m3_action", row.get("action", ""))), _finite(row.get("timing")), _finite(row.get("adj_weight")))
    except Exception as exc:
        raise RuntimeError(f"M3 风控失败：{exc}") from exc
    timings["m3"] = round(time.perf_counter() - mark, 3)
    mark = time.perf_counter()

    m4_status = "skipped"
    try:
        from m4_report.attribution import barra_attribution
        # Future returns do not exist at decision time. Expose only Barra
        # exposures, never zero-filled forward performance as realized returns.
        m4_result = barra_attribution(portfolio[["stock_code", "pred_month", "weight"]],
                                      factor_df=pred_df.drop(columns=["Target_Return_1M"], errors="ignore"))
        if m4_result.empty:
            raise RuntimeError("M4 未生成 Barra 暴露")
        m4_status = "ok"
    except Exception as exc:
        raise RuntimeError(f"M4 归因失败：{exc}") from exc

    core_factors, stock_attributions, attribution_error = _attributions(
        prediction["pred_df_with_scores"], portfolio, predictor, feature_cols, trial_params
    )
    score_series = prediction["pred_df_with_scores"]["score"]
    percentiles = score_series.rank(method="average", pct=True) * 100
    recommendations = []
    for index, row in portfolio.head(10).iterrows():
        raw_score = _finite(row.get("score"))
        percentile_score = round(float(percentiles.loc[index]), 1)
        explanation = stock_attributions[index]
        factors = explanation["factors"]
        factor_words = []
        for factor in factors[:3]:
            direction = "正向" if factor["contribution"] >= 0 else "负向"
            factor_words.append(f"{factor['name']} {direction}贡献 {factor['contribution']:+.4f}")
        m3_action, m3_timing, adjusted_weight = m3_map[row["stock_code"]]
        attribution = (
            f"{row.get('tier', 'Reserve')} 组，模型分位 {percentile_score:.1f}；"
            f"主要因子：{'、'.join(factor_words) if factor_words else '模型保留因子综合贡献'}。"
            f"M3 TET：{m3_action}。"
        )
        recommendations.append({
            "ts_code": str(row["stock_code"]),
            "name": str(row.get("stock_name", row["stock_code"])),
            "score": percentile_score,
            "raw_score": round(raw_score, 6),
            "tech_score": percentile_score,
            "fund_score": percentile_score,
            "capital_score": percentile_score,
            "next_day_adjust": 0,
            "risk_level": "medium" if m3_action == "HOLD" else "high",
            "reasons": [f["name"] for f in factors],
            "tier": str(row.get("tier", "Reserve")),
            "weight": _finite(row.get("weight")),
            "adjusted_weight": adjusted_weight,
            "rank": len(recommendations) + 1,
            "base_value": explanation["base_value"],
            "other_contribution": explanation["other_contribution"],
            "summary": f"综合排名第 {len(recommendations) + 1}；{_factor_family(factors[0]['name'])}因子{'推高' if factors[0]['contribution'] >= 0 else '压低'}评分。",
            "attribution": attribution,
            "factor_contributions": factors,
            "m3_action": m3_action,
            "m3_timing": round(m3_timing, 4),
        })

    recommendation_month = _next_month(prediction["pred_month"])
    current_month = datetime.now().strftime("%Y%m")
    status = "ready" if recommendation_month == current_month else "stale"
    message = None
    if status == "stale":
        message = (
            f"10q M0 scheme_b 最新数据截至 {prediction['pred_month']}，本次真实计算对应 {recommendation_month}；"
            f"当前月份是 {current_month}，请先更新 M0 到上月，系统才会标记为本月结果。"
        )
    high = [item for item in recommendations if item["tier"] == "High"]
    low = [item for item in recommendations if item["tier"] == "Low"]
    report = {
        "status": status,
        "model": "10q 21BB p2 Trial 157",
        "scheme": "scheme_b（Rank-Z + 行业/市值双重 OLS）",
        "pipeline": ["M0 stock_filter + 因子库", "M1 标签与滚动窗口", "M2 LightGBM/XGBoost 集成", "M3 TET 风控", "M4 机械因子归因"],
        "data_as_of": prediction["pred_month"],
        "recommendation_month": recommendation_month,
        "is_current": status == "ready",
        "config": {
            "trial": 157,
            "trial_source": trial_source,
            "train_months": train_months,
            "validation_months": 12,
            "lgbm_estimators": trial_params["lgbm_n_estimators"],
            "xgb_estimators": trial_params["xgb_n_estimators"],
            "lgbm_depth": trial_params["lgbm_max_depth"],
            "xgb_depth": trial_params["xgb_max_depth"],
            "lgbm_weight": trial_params["lgbm_weight"],
            "xgb_weight": 1 - trial_params["lgbm_weight"],
            "min_valid_rate": trial_params["min_valid_rate"],
            "max_corr": trial_params["max_corr"],
            "min_ic_abs": trial_params["min_ic_abs"],
            "min_keep_factors": trial_params["min_keep_factors"],
            "selected_factors": len(feature_cols),
            "stock_filter": "M0 stock_filter.py",
            "m4_attribution": m4_status,
            "attribution_method": "LightGBM + XGBoost TreeSHAP（模型原生贡献）",
            "attribution_max_error": attribution_error,
            "m3_mode": "单月新建仓 TET；不含历史锚定状态",
            "lgbm_device": device["lgbm"],
            "xgb_device": device["xgb"],
            "device_reason": device["reason"],
            "val_ic": prediction["val_ic"],
            "ic_gap": prediction["ic_gap"],
            "lgbm_best_iteration": predictor.lgbm.best_iteration_,
            "xgb_best_iteration": predictor.xgb.best_iteration_,
            "pool_before": len(pred_raw),
            "pool_after": len(pred_df),
            "llm": False,
        },
        "core_factors": core_factors,
        "barra_exposures": {k.removeprefix("expo_"): _finite(v) for k, v in m4_result.iloc[0].items() if k.startswith("expo_")},
        "high": high,
        "low": low,
        "message": message,
    }
    timings["m4"] = round(time.perf_counter() - mark, 3)
    timings["total"] = round(time.perf_counter() - started, 3)
    report["timings"] = timings
    report["generated_at"] = datetime.now().isoformat(timespec="seconds")
    return {"success": True, "data": recommendations, "report": report}


def main() -> None:
    # The Node bridge parses stdout as JSON. Keep all 10q progress and logs on stderr.
    sys.stdout.reconfigure(encoding="utf-8")
    root = _find_root()
    if root is None:
        print(json.dumps({"success": False, "data": [], "report": {
            "status": "unavailable", "model": "10q 21BB p2 Trial 157", "scheme": "scheme_b",
            "pipeline": [], "config": {"trial": 157, "llm": False}, "core_factors": [], "high": [], "low": [],
            "message": "未找到 10q 项目或 scheme_b M0 数据。请设置 TENQ_ROOT。"
        }, "error": "TENQ_ROOT_NOT_FOUND"}, ensure_ascii=False))
        return
    try:
        with contextlib.redirect_stdout(sys.stderr):
            sys.path.insert(0, str(root))
            os.chdir(root)
            params, _ = _load_trial_157(root)
            key = fingerprint(root, params)
            path = cache_path(key)
            result = None
            if "--refresh" not in sys.argv and path.exists():
                try:
                    result = json.loads(path.read_text(encoding="utf-8"))
                    if not result.get("success") or len(result.get("data", [])) != 10:
                        result = None
                except (OSError, ValueError):
                    pass
            hit = result is not None
            if result is None:
                result = _run(root)
                result["report"]["fingerprint"] = key
                write_cache(path, result)
            report = result["report"]
            report["cache_hit"] = hit
            report["is_current"] = report["recommendation_month"] == datetime.now().strftime("%Y%m")
            report["status"] = "ready" if report["is_current"] else "stale"
            report["message"] = None if report["is_current"] else f"数据截至 {report['data_as_of']}，仅对应 {report['recommendation_month']} 持仓；请更新 M0 至上月。"
        print(json.dumps(result, ensure_ascii=False, default=_json_value))
    except Exception as exc:
        logging.error("monthly 10q run failed: %s\n%s", exc, traceback.format_exc())
        print(json.dumps({"success": False, "data": [], "report": {
            "status": "error", "model": "10q 21BB p2 Trial 157", "scheme": "scheme_b",
            "pipeline": ["M0", "M1", "M2", "M3", "M4"], "config": {"trial": 157, "llm": False},
            "core_factors": [], "high": [], "low": [], "message": f"真实月度算法执行失败：{exc}"
        }, "error": type(exc).__name__}, ensure_ascii=False))


if __name__ == "__main__":
    main()
