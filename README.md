# Cute Fish Stock Picker (可爱鱼儿选股指南)

> A stock-watchlist, scoring, and alerting tool for A-shares and Hong Kong stocks, powered by [Tushare](https://tushare.pro), Sina Finance, and Tencent quotes. **Real-time intraday signals**, **TET + MACD-V dual-algorithm**, and a **glassmorphism** UI.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[简体中文](README.zh-CN.md) · **English**

[**Download for Windows 10 / 11**](https://github.com/zjwandcat/cute-fish-stock-picker/releases/latest/download/cute-fish-stock-picker-windows.zip) · [**Download for macOS**](https://github.com/zjwandcat/cute-fish-stock-picker/releases/latest/download/cute-fish-stock-picker-macos.zip) · [**Download website**](https://zjwandcat.github.io/cute-fish-stock-picker/)

Download a portable ZIP, extract it fully, and double-click the launcher. Node.js is included. Windows 10/11 share the x64 package; macOS 11+ supports both Apple Silicon and Intel automatically.

## Features

- **Watchlist tracking** — add/remove stocks at runtime, auto-refresh quotes every 30 seconds
- **Real-time quotes** — Sina Finance intraday quotes for A/H shares, with Tushare/HK historical fallbacks; realtime data is only injected into a K-line when its provider date is today
- **Intelligent scoring** — technical (MA / MACD / volume ratio) + fundamental (PE / PB / ROE) + capital-flow, multi-factor Z-score normalized with IC weights and ±3σ winsorization
- **TET & MACD-V signals** — Trend-/Emotion-aligned timing (NAAIM 2025) and volume-adjusted momentum (MACD-V, SSRN #4099617); 11 sell-trigger mechanism for holdings (incl. crowding avoid)
- **Buy/sell recommendations** — per-stock overall verdict (buy / watch / sell), four daily modes (capital / TET / MACD-V / double resonance), and sector-diversified picks with the current manual Top-4 override
- **Monthly 10q portfolio** — optional real M0 → M1 → M2 → M3 → M4 run using `21BB p2 Trial 157` and `scheme_b`; returns ten risk-controlled positions with progress, report, and factor attribution, and refuses stale or non-current output
- **Watchlist alerts** — five signal types (dip / bottom / rebound / volume / target), browser notification + sound, color-coded pullback status
- **K-line charts** — daily K + moving averages + volume
- **Stock detail** — top-10 shareholders, capital flow, announcements/dividends, news
- **Watchlist-backed signals** — `韭菜50` (Bagholder50) crowding avoid signal, a re-implementation of the bagholder50 index: four factors (20d price chase, turnover spike, dragon-tiger list count, ELG net flow) equally weighted via cross-sectional percentile ranks over the top-1000 A-share market cap universe; two states only (avoid = in Top50 / no signal). Locally cached with incremental daily updates; fail-closed when any of the four data sources is missing
- **Market-data quality** — market value is selected from Tushare daily fundamentals and Tencent quotes, with trading-date fallback, CNY/HKD labeling, source/date status (`available`, `previous_close`, `stale`, `conflict`, `missing`), same-date cross-source checks, and a `/api/data-quality` audit endpoint
- **Watchlist markers** — the watchlist table shows a green sprout for stocks on the `韭菜50` avoid list and a red dot for stocks in the current-month 10q portfolio; monthly status is polled every 30 seconds and every 3 seconds while the computation is running
- **iOS 26 liquid-glass UI** — light/dark themes and adjustable font size

## Tech Stack

| Layer | Tech |
| --- | --- |
| Frontend | React 18 + TypeScript 5 + Vite 6 + Tailwind CSS 3 |
| State | Zustand 5 |
| Charts | ECharts 5 + echarts-for-react |
| Router | React Router 7 |
| Backend | Express 4 + TypeScript + tsx |
| Data sources | Tushare Pro + Sina Finance + Tencent quotes |
| Deployment | Vercel (Serverless) |

## Quick Start

### Prerequisites

- Node.js ≥ 22 (source development only; portable downloads include it)
- npm ≥ 9

### Install

```bash
git clone https://github.com/zjwandcat/cute-fish-stock-picker.git
cd cute-fish-stock-picker
npm ci
```

### Configure

Copy the environment template and fill in a real token:

```bash
cp .env.example .env
```

In Windows PowerShell, use `Copy-Item .env.example .env`.

Edit `.env`:

```
TUSHARE_TOKEN=your_real_token_here
PORT=3001
```

> Get a token: https://tushare.pro/register

### Development

```bash
# start frontend (5173) + backend (3001)
npm run dev

# frontend only
npm run client:dev

# backend only
npm run server:dev
```

### Build & Checks

```bash
npm run build       # type-check + build
npm run check       # type-check only
npm run lint        # ESLint
npm run lint:fix    # ESLint autofix
npm run build:local # build standalone frontend and backend
npm run test:local  # local startup, release archive and data-quality tests
```

### Monthly recommendations (optional)

The monthly view is a real local bridge to the external 10q project; it is not an LLM-generated list. Set `TENQ_ROOT` (or place the checkout at the default location) and provide the `Trial 157` study files, `scheme_b` M0 factor data, and a Python environment with pandas, pyarrow, polars, LightGBM, and XGBoost. The bridge automatically checks the current Asia/Shanghai month, fills missing M0 months through Tushare, runs one current M0–M4 window, caches intermediate data, and exposes progress through `/api/recommendations/monthly`.

The Node.js portable package does not contain the 10q dataset or Python dependencies. The Windows flow can create `.monthly-venv` with `py -3.12 scripts/setup-monthly.py`; the macOS demo targets native ARM64 CPU environments. See [`docs/PORTABLE.zh-CN.md`](docs/PORTABLE.zh-CN.md) and [`docs/MONTHLY-AUDIT.zh-CN.md`](docs/MONTHLY-AUDIT.zh-CN.md) for the verified runtime boundary and algorithm limitations.

### One-click startup

Use the **Download** button on the project site or [GitHub Releases](https://github.com/zjwandcat/cute-fish-stock-picker/releases/latest): Windows 10/11 users download the Windows ZIP, and macOS users download the macOS ZIP. Extract it fully, then double-click `启动选股指南.bat` (Windows) or `启动选股指南.command` (macOS). The portable packages include Node.js, so no runtime installation is needed.

The first launch opens a setup page for your Tushare token. The token, holdings, settings, and cache are kept in the system user directory and survive upgrades. See [`docs/PORTABLE.zh-CN.md`](docs/PORTABLE.zh-CN.md) for details.

The public [download website](https://zjwandcat.github.io/cute-fish-stock-picker/) runs on GitHub Pages and distributes the program; stock services run on the user's computer. The existing Vercel app also shows a download menu after deployment.

### Publish desktop packages

Pushing a `v*` tag makes GitHub Actions package Windows and macOS on native runners, then publishes both ZIP files and SHA-256 checksums to the Release. Native runners are required because the archives include the official Node.js runtime.

```bash
git tag v0.2.0
git push origin v0.2.0
```

## Project Structure

```
.
├── api/                # Express backend
│   ├── routes/         # API routes (stocks / alerts / auth)
│   ├── services/       # services (tushare / realtime / scoring / alertEngine ...)
│   ├── app.ts          # Express app entry
│   ├── index.ts        # Vercel Serverless entry
│   └── server.ts       # local dev entry
├── src/                # React frontend
│   ├── components/     # shared components (Navbar / StockTable / DetailPanel ...)
│   ├── lib/            # utilities
│   ├── pages/          # pages
│   ├── services/       # frontend service layer
│   ├── store/          # Zustand stores
│   └── types/          # TypeScript types
├── public/             # static assets
├── LICENSE             # MIT license
└── README.md           # this file
```

## API

| Method | Path | Description |
| --- | --- | --- |
| GET | `/api/health` | Health check |
| GET | `/api/stocks` | Watchlist realtime quotes |
| GET | `/api/stocks/search?q=` | Smart stock search |
| GET | `/api/stocks/:code/detail` | Stock detail |
| GET | `/api/stocks/:code/daily` | Daily K-line |
| GET | `/api/stocks/:code/news` | Company news |
| GET | `/api/stocks/:code/signals` | TET+MACD-V signals & overall verdict |
| GET | `/api/recommendations?mode=&limit=&offset=` | Daily recommendations (`capital`, `tet`, `macdv`, or `double`) |
| GET | `/api/recommendations/monthly?limit=&refresh=1` | Current-month 10q portfolio and computation report |
| GET | `/api/data-quality` | Market-value sources, dates, currencies, statuses, and Tushare provider health |
| GET | `/api/watchlist` | Configured pullback watchlist with entry/stop status |
| GET | `/api/pullback-status` | Pullback status for the whole pool |
| GET | `/api/pool-scores` | Pool composite scores |
| POST | `/api/stocks/add` | Add stock to the pool |
| DELETE | `/api/stocks/:code` | Remove stock from the pool |
| GET/POST | `/api/holdings` | Read / update holdings |
| GET | `/api/holdings/signals` | Holding-level TET/MACD-V and sell-trigger evaluation |
| GET/POST | `/api/settings` | MACD-V thresholds |
| GET | `/api/bagholder50` | `韭菜50` Top50 crowding avoid list (Bagholder50 index re-implementation) |
| GET | `/api/alerts` | List alerts |
| POST | `/api/alerts/analyze` | Trigger manual analysis |
| GET/POST | `/api/alerts/targets` | Manage target prices |
| DELETE | `/api/alerts` | Clear alerts |

## Coding Standards

- TypeScript strict mode (`strict: true`)
- ESLint + typescript-eslint (aligned with Google TS Style Guide / Airbnb notes)
- Single quotes / 2-space indent / semicolons / trailing commas
- Unified EditorConfig (see `.editorconfig`)
- Explicit `import type` for type-only imports

> Development data under `api/data/` is gitignored; portable downloads use the system user directory. Configure the token on the setup page or through `.env` during development. Bagholder50 initially makes about 460 requests, throttled at 280/min, then about 10 incremental calls a day. Market data still requires network access and the relevant Tushare permissions.

## Disclaimer

For learning and research purposes only. All signals and scores are algorithmic outputs and **do not constitute investment advice**. Trading is at your own risk.

## License

[MIT License](./LICENSE) © 2026 Cute Fish Stock Picker
