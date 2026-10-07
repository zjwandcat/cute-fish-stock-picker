# Cute Fish Stock Picker (可爱鱼儿选股指南)

> A local A-share and Hong Kong stock watchlist, scoring, signal, alert, and optional research tool. This README describes the current code and its verified boundaries; it is not a promise that every feature works without data permissions or external dependencies.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[简体中文](README.zh-CN.md) · **English**

[Download Windows 10 / 11](https://github.com/zjwandcat/cute-fish-stock-picker/releases/latest/download/cute-fish-stock-picker-windows.zip) · [Download macOS](https://github.com/zjwandcat/cute-fish-stock-picker/releases/latest/download/cute-fish-stock-picker-macos.zip) · [Download website](https://zjwandcat.github.io/cute-fish-stock-picker/)

Current repository version: **0.3.0**. Check the Releases page before relying on a download. The current published release contains Windows and macOS ZIP archives plus SHA-256 files.

## What Is Actually Included

The following features exist in the source and are reachable through the local application. “Available” does not mean that the required provider, permission, private dataset, or model key is included.

| Area | Current behavior | Requirement or boundary |
| --- | --- | --- |
| Watchlist | Add and remove A/H stocks while the process is running; quotes refresh about every 30 seconds | Watchlist pool mutations are in memory only and reset after restart |
| Quotes | Sina A/H quotes, Tencent Hong Kong quotes, Tushare history/basic data, and conservative fallbacks | Not an exchange feed; provider dates, permissions, cache state, and market hours matter |
| Daily K-lines | A-share daily bars from Tushare and Hong Kong daily bars from Tencent, with OHLC/date checks | Historical sources and adjustment conventions are not identical |
| Composite score | Value, quality, momentum, low-volatility, liquidity, size, and flow factors use cross-sectional Z-scores, fixed weights, and 3%-97% winsorization | Weights are engineering constants, not dynamically fitted IC weights; missing inputs are often filled with zero |
| Recommendations | `capital`, `tet`, `macdv`, and `double` modes; capital mode ranks the current local pool by composite score with stable code tie-breaking | This is a watchlist cross-section, not a full-market scan; `double` can be empty |
| TET / MACD-V | TET timing signals and volatility-normalized MACD-V signals are calculated for available daily data | MACD-V is not a volume-adjusted indicator in this implementation; signals are heuristics, not calibrated probabilities |
| Holdings | Add, edit, and remove holdings; TET/MACD-V sell-trigger evaluation and estimated P&L | Holdings and MACD-V settings persist locally; fees, taxes, and broker execution are not integrated |
| Alerts | Dip, bottom, rebound, volume, and target-price checks; manual analysis and periodic browser polling | History and target prices are process memory; browser notifications need permission and an open page |
| K-line/detail UI | Daily chart, moving averages, volume, top-10 holders, capital flow, dividends, and A/H comparison where data is available | News and announcement endpoints currently return empty arrays; they are placeholders, not live news feeds |
| Bagholder50 | Local Top-50 crowding signal calculated from four factors over a filtered A-share top-1000 market-cap sample | Not official CSI1000 membership, not Hong Kong coverage, not a proven future-return ranking |
| Market-data quality | Market-value source/date/currency/status reporting and `/api/data-quality` audit | The quality contract covers market value and selected quote/history checks, not every financial field |
| A/H comparison | Embedded A/H pair comparison with prices, FX, dividend context, and built-in cost/tax assumptions | Pair list is predefined; FX can fall back to an approximate 0.92 HKD/CNY rate; this is not risk-free arbitrage |
| AI research | Optional question/stock recognition, clarification, evidence snapshot, bounded specialist workflow, cancellation, citations, and explicit memory save | Requires a user-supplied model key and provider; no trades are executed |
| Monthly 10q | Optional local bridge for the external 10q `Trial 157` / `scheme_b` M0-M4 pipeline | Requires the separate 10q checkout, data, Python environment, and Tushare access; it is not included in the ZIP |
| Desktop UI | Local-only desktop workflow, light/dark themes, font-size setting, portable Windows and macOS launchers | macOS app is ad-hoc signed only, not Developer ID signed or notarized |

## Important Non-Claims

- A quote returned with HTTP 200, `success: true`, an empty array, or a zero value is not automatically usable data.
- The app does not provide a universal live quote for every detail, K-line, alert, or recommendation panel. Realtime injection requires a provider date that matches the current Shanghai date and passes plausibility checks.
- `ROE` in the scoring/detail path is an estimate derived from `PB / PE * 100`, not reported financial-statement ROE.
- Some Hong Kong valuation and turnover fields are approximations. A/H prices have different timestamps, currencies, share structures, trading rules, and costs.
- Top-10 holders and moneyflow are report-period or source-defined data. They do not identify current institutional ownership in real time.
- The green Bagholder50 marker means “crowding avoid signal”, not “buy”. Being absent from the list does not mean safe.
- Alert sound uses a tiny embedded WAV placeholder and is not certified as an audible notification on every browser or operating system.
- The API has no user-account system. `api/routes/auth.ts`, if present in the tree, is not a mounted authentication layer. The local server must not be exposed as a public production API.

## Portable Desktop Use

### Requirements

- Windows 10/11 x64, or macOS 11+ on Apple Silicon or Intel for the base app.
- Network access for market data.
- A valid Tushare token with the permissions required by the selected endpoints.
- No Node.js or npm installation is required for the released desktop ZIP.

### Start

1. Download the matching ZIP from the [release page](https://github.com/zjwandcat/cute-fish-stock-picker/releases/latest) or [download site](https://zjwandcat.github.io/cute-fish-stock-picker/).
2. Extract the complete archive. Do not run a launcher from inside the ZIP.
3. On Windows, run `启动选股指南.bat`. On macOS, open `可爱鱼儿选股指南.app`.
4. Enter the Tushare token on the first-run setup page.

The portable server binds to `127.0.0.1`, serves the built frontend and API, and prints the exact local URL. Use that printed URL. The standalone setup page and token write route are not part of the normal Vite development server. If the preferred port is occupied, the app reuses the same build when possible or chooses a free port without terminating an unrelated process.

### Data and credential storage

| Platform | Default data directory |
| --- | --- |
| Windows | `%APPDATA%\Cute Fish Stock Picker` |
| macOS | `~/Library/Application Support/Cute Fish Stock Picker` |
| Linux source run | `~/.local/share/Cute Fish Stock Picker` |

Set `CUTE_FISH_DATA_DIR` to override the directory. Holdings, MACD-V settings, AI settings, AI memory, and caches are stored there. The runtime watchlist pool is not persisted. `config.json` contains the Tushare token and, when configured, the AI API key in plaintext JSON; the code requests mode `0600` where the platform honors it, but this is not a keychain or encrypted vault. Backups therefore contain credentials.

macOS releases have an ad-hoc integrity signature only. If Gatekeeper blocks the first launch, verify the download source and use **System Settings > Privacy & Security > Open Anyway**. Do not disable Gatekeeper or remove quarantine attributes blindly.

## Source Development

### Prerequisites and install

- Node.js `>=22.23.2`
- npm `>=11.16.0`

```bash
git clone https://github.com/zjwandcat/cute-fish-stock-picker.git
cd cute-fish-stock-picker
npm ci
```

Create `.env` from `.env.example`:

```powershell
Copy-Item .env.example .env
```

```dotenv
TUSHARE_TOKEN=your_real_token_here
PORT=3001
```

### Run modes

```bash
# start Vite frontend at 5173 and source API at 3001
npm run dev

# frontend only
npm run client:dev

# source API only
npm run server:dev
# or
npm start
```

`npm start` and `npm run server:dev` do not serve the production frontend. `npm run preview` serves the frontend preview only. The Vite `/api` proxy is configured for `http://localhost:3001`; changing the backend `PORT` requires updating the proxy or using the standalone build.

For the full local desktop-shaped app:

```bash
npm run build:local
node build/server.mjs
```

The standalone build loads `.env`, then lets the persisted user token take precedence. It serves `dist/` and the API from `127.0.0.1`.

### Checks

```bash
npm run check
npm run lint
npm run build
npm run build:local
npm run test:local
py -3 -m unittest discover -s tests -p "test_monthly*.py"
```

The test commands use synthetic or controlled local fixtures unless explicitly stated otherwise. They do not prove current full-market data quality, paid-model output quality, or a complete private 10q run.

## Market Data and Scoring Boundaries

### Data sources

- Tushare Pro: A-share daily/basic data, selected holders, moneyflow, dividends, calendars, and other permission-gated data.
- Sina Finance: A/H realtime quote snapshots.
- Tencent: Hong Kong quote/history and selected market-value/FX fallbacks.
- Local caches: short-lived quote/data caches and longer-lived Bagholder50/monthly artifacts.

Quotes are polled snapshots, not exchange-level tick data. A-share date checks use the Tushare trading calendar. Hong Kong freshness uses a conservative age heuristic and is not a full HKEX calendar implementation.

### Quality states

Market-value records expose `value`, `source`, `as_of`, `currency`, `status`, `checked_at`, and comparison information. Statuses include `available`, `previous_close`, `stale`, `conflict`, and `missing`. Same-date source differences over 5% are treated as a conflict and the value is withheld. This threshold is an anomaly gate, not an accuracy guarantee.

Run the audit against an already running local app:

```bash
node scripts/audit-market-data.mjs http://127.0.0.1:3001
```

The audit writes JSON under `.test-output/market-audits/` and exits non-zero for missing, stale, or conflicting market values. It can make network requests.

### Recommendations

Recommendations are computed from the current mutable pool. The default response is five items, and the API caps `limit` at 20. The capital mode sorts the complete pool by the computed total score; equal scores are ordered by `ts_code`. TET, MACD-V, and double-resonance modes apply their signal-specific ranking and optional sector-diversification logic. The double-resonance mode requires both buy signals and can return no rows.

The composite score uses fixed factor constants, cross-sectional normalization, and 3%-97% winsorization. It is not trained online and is not a statistically calibrated probability of next-day return. The `next_day_adjust` field is a heuristic adjustment. Insufficient history, missing factor data, and provider failures can reduce information quality without causing every endpoint to fail closed.

## Bagholder50

The implementation builds a filtered A-share sample, takes a market-cap top-1000 universe, and calculates four equally weighted percentile-ranked crowding factors:

1. 20-day price-chase behavior
2. Turnover amplification
3. Dragon-Tiger list count
4. ELG net flow

The top 50 is a crowding/avoid signal. It is an engineering re-implementation, not an official index constituent list or proof that those stocks will underperform. Hong Kong stocks are not covered. Insufficient valid rows make the result unavailable; an empty upstream factor response can also be indistinguishable from an unavailable source, so this is not a complete provenance guarantee for every factor. Initial warmup can issue hundreds of provider requests; do not treat a fixed request count or runtime as a contract.

## Optional AI Research

AI is disabled until a user enables it and supplies an API key. The user supplies the model URL, protocol, and model name. HTTPS is required except for loopback HTTP URLs. OpenAI-compatible format is supported, but not every provider is certified.

The workflow can recognize and clarify stock references, fetch a read-only evidence snapshot, plan roles, show progress, cancel a run, validate evidence IDs, and let the user explicitly save memory. It accepts at most four A/H securities per request. There are 32 specialist roles plus bull, bear, risk-review, and chief-analyst roles. The configured modes are bounded approximately as follows:

| Mode | Specialist cap | Typical maximum including debate/review |
| --- | ---: | ---: |
| `quick` | 3 | 7 |
| `standard` | 11 | 15 |
| `deep` | 32 | 36 |

At most three roles run concurrently, and the app permits one active research run. Actual roles can be skipped when the market or evidence is not applicable. A role count is not the same as model-request count: planning, data tools, debate replies, and one citation repair can add requests. Provider results are labeled `deepseek-harness`, `fallback`, or `mixed`; fallback or mixed output must not be described as native Harness output.

News, announcements, industry, macro, and some financial-statement roles can report data gaps because the current local evidence adapters do not provide those datasets. AI does not place orders. Questions, selected evidence, and selected memory may be sent to the configured provider and may incur charges. Cancellation does not undo a request already accepted by a provider.

Relevant routes:

```text
GET/PUT  /api/ai/config
GET      /api/ai/capabilities
POST     /api/ai/research
GET      /api/ai/research/:sessionId/status
POST     /api/ai/stop
POST     /api/ai/research/:sessionId/memory
GET/POST /api/ai/memory
DELETE   /api/ai/memory/:id
```

Research memory is explicit, local, capped, and expiry-aware. It is not a long-term guarantee that an old investment conclusion remains true.

## Optional Monthly 10q Engine

The monthly page is a local bridge to a separate 10q project. It is not an LLM list and the portable ZIP does not contain the private data or Python dependencies.

Required inputs include:

- A 10q checkout selected with `TENQ_ROOT` or `TEN_Q_ROOT`.
- `output/21BB/p2/21BB_p2_study.db`.
- `21BB_p2_config.json` and a unique, `COMPLETE` Trial 157 with the required parameters.
- `scheme_b` M0 factor files and upstream modules.
- A writable data/cache directory and a Tushare token when M0 months must be filled.

The bridge determines the current month in `Asia/Shanghai`, checks the required continuous window, and runs one current M0-M4 window: 58 training months, 12 validation months, and one prediction month. Missing M0 months may be downloaded and generated through the upstream pipeline. A successful result must be current and contain exactly ten positions; stale or non-current output is discarded. `M3` is single-month new-position semantics, not a historical continuous-holding backtest. TreeSHAP-style contributions explain predicted scores; they are not realized returns or proof of strategy efficacy.

Windows:

```powershell
py -3.12 scripts/setup-monthly.py
py -3.12 scripts/setup-monthly.py --check
```

Python 3.11-3.14 is accepted; Python 3.12 is recommended. `TENQ_PYTHON` can point to an existing interpreter. `TENQ_DEVICE=auto|cpu|cuda` controls device selection; LightGBM remains CPU and CUDA acceleration is limited to supported XGBoost paths.

macOS monthly support targets macOS 14+ with native Python 3.12 and OpenMP. The environment lives outside the app bundle. The base portable app does not require Python or Homebrew. `CUTE_FISH_MONTHLY_AUTO=0` disables the background scheduler only; explicit page/API requests can still run the computation.

Historical real-data evidence is dated and scoped:

- Windows Trial 157 / 10q verification on 2026-09-17: real 71-month window and ten-position output, with score-contribution error reported as `2.19e-8`.
- This does not certify a fresh October 2026 run, every private upstream file, or macOS real-data execution.

## API Surface

All routes below are local application routes under `/api`. They do not provide public authentication or a hosted multi-user service.

| Method | Path | Behavior |
| --- | --- | --- |
| GET | `/api/health` | Local health/build status |
| GET | `/api/stocks` | Current watchlist quotes and derived fields |
| GET | `/api/stocks/search?q=` | Stock search |
| GET | `/api/stocks/:code/detail` | Detail, holders/flows/dividends where available, and comparison data |
| GET | `/api/stocks/:code/daily` | Daily bars |
| GET | `/api/stocks/:code/news` | Currently returns an empty news list |
| GET | `/api/stocks/:code/signals` | TET/MACD-V signals and verdict |
| GET | `/api/recommendations?mode=&limit=&offset=` | Daily recommendations |
| GET | `/api/recommendations/monthly?limit=&refresh=1` | Current-month 10q status/result |
| GET | `/api/data-quality` | Market-value quality records and provider status |
| GET | `/api/watchlist` | Configured pullback watchlist |
| GET | `/api/pullback-status` | Pool pullback state |
| GET | `/api/pool-scores` | Pool scores |
| POST | `/api/stocks/add` | Add a runtime-only pool item |
| DELETE | `/api/stocks/:code` | Remove a runtime-only pool item |
| GET/POST | `/api/holdings` | Read or update persisted holdings |
| GET | `/api/holdings/signals` | Holding-level signal evaluation |
| GET/POST | `/api/settings` | Persist MACD-V thresholds |
| GET | `/api/bagholder50` | Bagholder50 crowding result |
| GET | `/api/alerts` | Read in-memory alerts |
| POST | `/api/alerts/analyze` | Run alert analysis |
| GET/POST | `/api/alerts/targets` | Read or update in-memory target prices |
| DELETE | `/api/alerts` | Clear alerts |

## Project Structure

```text
.
├── api/                  # Express API and local production entry
│   ├── routes/            # stocks, alerts, AI routes
│   ├── services/          # data, scoring, signals, monthly, AI services
│   ├── app.ts             # source Express app
│   ├── local.ts           # standalone local-only server
│   └── server.ts          # source development server
├── src/                   # React frontend
├── public/                # static assets and download site files
├── scripts/               # local build, release, audit, and monthly tools
├── tests/                 # unit, contract, offline, and controlled integration tests
├── docs/                  # portable, data-quality, AI, monthly, and release notes
├── package.json
├── README.md
└── README.zh-CN.md
```

## Release and Deployment Boundaries

The release workflow uses native Windows, Apple Silicon macOS, and Intel macOS runners. It checks the tag/version match, builds the bundled Node runtime, packages archives, runs archive/startup/offline-AI tests, and publishes SHA-256 files only after the package jobs pass. This does not certify Gatekeeper approval, live provider permissions, paid model quality, or a complete real 10q run.

For a new release, create a new tag matching `package.json`; do not reuse the existing `v0.3.0` tag. The GitHub Pages site distributes downloads only. The local desktop workflow is not a supported Vercel-hosted quote, persistence, AI, or monthly service.

## Verification Snapshot

Checked against the working tree on **2026-10-07 (Asia/Shanghai)**:

| Check | Result | Scope |
| --- | --- | --- |
| `npm run check` | Passed | TypeScript type check |
| `npm run lint` | 0 errors, 14 existing warnings | 11 `any` warnings in `api/scripts/analyze5.ts`, 3 console warnings in `vite.config.ts` |
| `npm run build:local` | Passed | Production frontend and `build/server.mjs` |
| Monthly Python unit tests | 15 passed | Synthetic/mocked tests plus small CPU model contribution checks |
| `npm run test:local` | 45 passed, 2 failed, 1 skipped in the recorded run | One controlled Harness subprocess timed out during `sdk-minimal` initialization after 30 seconds and fell back; the other failure was the already-existing ignored Windows ZIP under `release/`, generated 2026-09-28 with a legacy-encoded launcher filename. The ZIP was not newly packaged in that run |
| Windows archive filename unit test | Passed | Current source packaging/extraction path uses UTF-8 names |
| Limited live quote smoke | Passed | Sina returned `600519.SH` and `00700.HK`; Tencent returned `00700.HK` and five HK daily bars |

The limited live smoke was checked at `2026-10-05T17:21:18.451Z` (`2026-10-06 01:21:18` Asia/Shanghai). It confirms small public-provider samples, not full-market correctness, current-day completeness, Tushare permission coverage, or the contents of a downloaded release archive. The current published release assets were reachable over HTTP on 2026-10-07, but this working-tree verification did not download and execute them.

Historical evidence is kept separate from current verification:

- AI: two real quick-mode Windows queries on 2026-09-25 used `deepseek-harness` and completed seven roles each; this was not a 36-role or macOS release test.
- Monthly: the real Windows 10q run on 2026-09-17 is documented in [`docs/MONTHLY-AUDIT.zh-CN.md`](docs/MONTHLY-AUDIT.zh-CN.md); it is not a fresh October result.

## FAQ

**Does the ZIP work without Node.js?**

The intended portable package includes a bundled Node runtime and does not require system Node.js/npm. Verify the archive checksum and use a freshly published release; the stale local archive noted above is not evidence against the current packaging code.

**Why is the watchlist gone after restart?**

The pool is deliberately runtime-only. Holdings and settings are persisted separately.

**Why is monthly status `unavailable`, `updating`, or `error`?**

The external 10q checkout, Trial 157 files, M0 data, Python dependencies, token, permissions, or current-month checks may be missing. The UI is designed not to show stale ten-stock output as current.

**Is this investment advice or an automatic trader?**

No. It does not place orders, and its scores/signals/research are not a guarantee of future returns.

## License

[MIT License](./LICENSE) © 2026 Cute Fish Stock Picker
