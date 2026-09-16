"""Runtime policy and versioned disk cache for a single 10q window."""
from __future__ import annotations

import hashlib
import importlib.metadata
import json
import os
import platform
import subprocess
import sys
from datetime import datetime
from pathlib import Path


def configure_threads():
    count = max(1, min(4, (os.cpu_count() or 2) // 2))
    for name in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS",
                 "NUMEXPR_NUM_THREADS", "POLARS_MAX_THREADS"):
        os.environ.setdefault(name, str(count))
    return count


def configure_device():
    """Avoid upstream CUDA false positives when XGBoost silently falls back."""
    from m2_engine.gpu_detector import GPUConfig

    mode = os.environ.get("TENQ_DEVICE", "auto").lower()
    if mode not in {"auto", "cpu", "cuda"}:
        raise ValueError("TENQ_DEVICE must be auto, cpu or cuda")
    cuda = False
    reason = "CPU requested" if mode == "cpu" else "No usable CUDA runtime"
    if mode != "cpu" and sys.platform != "darwin":
        try:
            probe = subprocess.run(
                ["nvidia-smi", "--query-gpu=name", "--format=csv,noheader"],
                capture_output=True, text=True, timeout=8,
                creationflags=0x08000000 if sys.platform == "win32" else 0,
            )
            if probe.returncode == 0 and probe.stdout.strip():
                import numpy as np
                import xgboost as xgb
                rng = np.random.default_rng(42)
                data = xgb.DMatrix(rng.normal(size=(32, 4)), label=rng.normal(size=32))
                model = xgb.train({"device": "cuda", "tree_method": "hist", "max_depth": 1,
                                   "nthread": 1}, data, num_boost_round=1)
                actual = json.loads(model.save_config())["learner"]["generic_param"]["device"]
                cuda = actual.startswith("cuda")
                reason = probe.stdout.strip() if cuda else "XGBoost fell back to CPU"
        except Exception as exc:
            reason = f"CUDA unavailable: {type(exc).__name__}"
    # A bridge-local singleton avoids upstream's unconditional OpenCL probe.
    # LightGBM stays on its deterministic CPU path on Windows and Apple Silicon.
    config = object.__new__(GPUConfig)
    config._cuda_available = cuda
    config._opencl_available = False
    config._mode = "gpu" if cuda else "cpu"
    GPUConfig._instance = config
    return {"requested": mode, "lgbm": "cpu", "xgb": "cuda" if cuda else "cpu",
            "reason": reason, "platform": platform.platform(), "architecture": platform.machine()}


def fingerprint(root: Path, params: dict) -> str:
    digest = hashlib.sha256()
    digest.update(json.dumps(params, sort_keys=True).encode())
    digest.update(f"{sys.version}|{platform.machine()}|{os.getenv('TENQ_DEVICE', 'auto')}|{datetime.now():%Y%m}".encode())
    digest.update(str({key: os.environ.get(key) for key in (
        "OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS", "POLARS_MAX_THREADS")}).encode())
    for package in ("numpy", "pandas", "pyarrow", "polars", "lightgbm", "xgboost", "scipy"):
        digest.update(f"{package}:{importlib.metadata.version(package)}".encode())
    paths = [Path(__file__), Path(__file__).with_name("monthly_recommendation_runner.py")]
    for folder in ("config", "m0_database", "m1_engine", "m2_engine", "m3_engine", "m4_report"):
        paths.extend(p for p in (root / folder).rglob("*") if p.suffix in {".py", ".yaml"})
    paths.extend((root / "output/21BB/p2").glob("*config.json"))
    for path in sorted(paths):
        digest.update(str(path.resolve()).encode())
        digest.update(path.read_bytes())
    # M0 files are immutable monthly artifacts. Detect replacements and new months
    # without re-reading hundreds of MB on every cache hit.
    for path in sorted((root / "data/pool_v2_scheme_b").glob("*.parquet")):
        stat = path.stat()
        digest.update(f"{path.name}:{stat.st_size}:{stat.st_mtime_ns}".encode())
    return digest.hexdigest()


def cache_path(key: str) -> Path:
    base = os.environ.get("TENQ_CACHE_DIR")
    if not base:
        base = str(Path.home() / ".cute-fish" / "monthly")
    return Path(base) / f"{key}.json"


def write_cache(path: Path, result: dict):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(f".{os.getpid()}.tmp")
    temporary.write_text(json.dumps(result, ensure_ascii=False, allow_nan=False), encoding="utf-8")
    temporary.replace(path)
