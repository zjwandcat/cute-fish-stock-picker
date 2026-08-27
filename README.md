# Cute Fish Stock Picker (可爱鱼儿选股指南)

> A stock-watchlist, scoring, and alerting tool for A-shares, powered by [Tushare](https://tushare.pro) and Sina real-time quotes. **Real-time intraday signals**, **TET + MACD-V dual-algorithm**, and a **glassmorphism** UI.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[简体中文](README.zh-CN.md) · **English**

## Features

- **Watchlist tracking** — add/remove stocks at runtime, auto-refresh quotes every 30 seconds
- **Real-time quotes** — prefers Sina Finance realtime feed, Tushare as fallback
- **Intelligent scoring** — technical (MA / MACD / volume ratio) + fundamental (PE / PB / ROE) + capital-flow, multi-factor Z-score normalized with IC weights and ±3σ winsorization
- **TET & MACD-V signals** — Trend-/Emotion-aligned timing (NAAIM 2025) and volume-adjusted momentum (MACD-V, SSRN #4099617); 11 sell-trigger mechanism for holdings (incl. crowding avoid)
- **Buy/sell recommendations** — per-stock overall verdict (buy / watch / sell), Top-4 sector-diversified daily picks with manual override support
- **Watchlist alerts** — five signal types (dip / bottom / rebound / volume / target), browser notification + sound, color-coded pullback status
- **K-line charts** — daily K + moving averages + volume
- **Stock detail** — top-10 shareholders, capital flow, announcements/dividends, news
- **Watchlist-backed signals** — `韭菜50` (Bagholder50) crowding avoid signal, a re-implementation of the bagholder50 index: four factors (20d price chase, turnover spike, dragon-tiger list count, ELG net flow) equally weighted via cross-sectional percentile ranks over the top-1000 A-share market cap universe; two states only (avoid = in Top50 / no signal). Locally cached with incremental daily updates; fail-closed when any of the four data sources is missing
- **iOS 26 liquid-glass UI** — light/dark themes and adjustable font size

## Tech Stack

| Layer | Tech |
| --- | --- |
| Frontend | React 18 + TypeScript 5 + Vite 6 + Tailwind CSS 3 |
| State | Zustand 5 |
| Charts | ECharts 5 + echarts-for-react |
| Router | React Router 7 |
| Backend | Express 4 + TypeScript + tsx |
| Data sources | Tushare Pro + Sina Finance |
| Deployment | Vercel (Serverless) |

## Quick Start

### Prerequisites

- Node.js ≥ 18
- npm ≥ 9

### Install

```bash
git clone <repository-url>
cd cute-fish-stock-picker
npm install
```

### Configure

Copy the environment template and fill in a real token:

```bash
cp .env.example .env
```

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
```

### One-click startup (macOS)

Double-click `启动选股指南.command` in the project root.

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
| GET | `/api/stocks/search?query=` | Smart stock search |
| GET | `/api/stocks/:code/detail` | Stock detail |
| GET | `/api/stocks/:code/daily` | Daily K-line |
| GET | `/api/stocks/:code/news` | Company news |
| GET | `/api/stocks/:code/signals` | TET+MACD-V signals & overall verdict |
| GET | `/api/recommendations?limit=&offset=` | Daily recommendations |
| GET | `/api/pullback-status` | Pullback status for the whole pool |
| GET | `/api/pool-scores` | Pool composite scores |
| POST | `/api/stocks/add` | Add stock to the pool |
| DELETE | `/api/stocks/:code` | Remove stock from the pool |
| GET/POST | `/api/holdings` | Read / update holdings |
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

> Runtime user data under `api/data/` (holdings, settings, bagholder50 cache) is gitignored and never committed. Configure the Tushare token via `.env` only. The bagholder50 cache performs a full build (~460 API calls, throttled at ~280 req/min with exponential backoff) on first use, then only ~10 incremental calls per day.

## Disclaimer

For learning and research purposes only. All signals and scores are algorithmic outputs and **do not constitute investment advice**. Trading is at your own risk.

## License

[MIT License](./LICENSE) © 2026 Cute Fish Stock Picker