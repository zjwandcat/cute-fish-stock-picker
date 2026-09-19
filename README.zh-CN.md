# 可爱鱼儿选股指南 (Cute Fish Stock Picker)

> 基于 [Tushare](https://tushare.pro)、新浪财经与腾讯行情的 A 股/港股自选股盯盘、智能评分与告警提醒工具。**盘中实时信号**、**TET + MACD-V 双算法**、**液态玻璃** UI。

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
**简体中文** · [English](README.md)

[**下载 Windows 10 / 11 版**](https://github.com/zjwandcat/cute-fish-stock-picker/releases/latest/download/cute-fish-stock-picker-windows.zip) · [**下载 macOS 版**](https://github.com/zjwandcat/cute-fish-stock-picker/releases/latest/download/cute-fish-stock-picker-macos.zip) · [**自动选择系统 / 下载网站**](https://zjwandcat.github.io/cute-fish-stock-picker/)

普通用户直接下载便携版，完整解压后双击启动文件即可；无需安装 Node.js。Windows 10/11 使用同一份 64 位程序，Mac 版自动支持 Apple 芯片与 Intel（macOS 11+）。

## 功能特性

- **自选股盯盘** — 运行时增删股池，30 秒自动刷新行情
- **实时行情** — 新浪财经提供 A/H 股盘中行情，Tushare/腾讯提供历史与基本面回退；只有确认供应商交易日为当天时，实时数据才会注入 K 线
- **智能评分** — 技术面（均线/MACD/量比）+ 基本面（PE/PB/ROE）+ 资金面三维；多因子 Z-score 归一化、IC 加权、±3σ 缩尾
- **TET & MACD-V 信号** — 趋势-情绪对齐择时（NAAIM 2025）与量价修正动量（MACD-V，SSRN #4099617）；持仓 11 项卖出信号机制（含拥挤避雷）
- **买卖建议** — 个股综合评估（值得买入/观察/建议卖出），今日推荐支持资金面/TET/MACD-V/双共振四种模式，并提供跨行业分散与当前手动 Top4 覆盖
- **本月推荐** — 可选的真实 10q M0 → M1 → M2 → M3 → M4 计算，使用 `21BB p2 Trial 157` 与 `scheme_b`，返回十只风控后持仓、进度、报告和因子归因；拒绝过期或非当前月份结果
- **盯盘提醒** — 跌深/底部/反弹/异动/目标价五类信号，浏览器通知 + 声音，回踩状态彩色标识
- **K 线图** — 日 K + 均线 + 成交量
- **个股详情** — 十大股东、资金流向、公告会议、除权除息、新闻
- **自选股池信号** — `韭菜50` 拥挤避雷第三信号（冷西西 bagholder50 指数算法复刻）：追涨热度/换手放大/龙虎榜次数/特大单流量四因子在 A 股市值前 1000 池内横截面百分位等权合成，选出最易跑输的 Top50；两态（进入名单=卖出避雷 / 无信号）。本地缓存 + 每日增量更新（首次全量构建约 460 次请求，节流 280 次/分钟 + 指数退避）；四因子数据源缺一即 fail-closed 停止生成
- **行情数据质量** — 市值由 Tushare 日基本面与腾讯行情择优，按交易日回退，明确人民币/港币、来源/日期和状态（`available`、`previous_close`、`stale`、`conflict`、`missing`），同日双源差异超过阈值时拒绝展示，并提供 `/api/data-quality` 审计接口
- **自选表格标记** — 自选股表格对进入 `韭菜50` 避雷名单的股票显示绿色嫩芽图标，对本月 10q 推荐股票显示红点；月度状态平时每 30 秒刷新，计算运行中提升到每 3 秒刷新
- **iOS 26 液态玻璃 UI** — 深浅主题切换与字体大小调节

## 技术栈

| 模块 | 技术 |
| --- | --- |
| 前端 | React 18 + TypeScript 5 + Vite 6 + Tailwind CSS 3 |
| 状态 | Zustand 5 |
| 图表 | ECharts 5 + echarts-for-react |
| 路由 | React Router 7 |
| 后端 | Express 4 + TypeScript + tsx |
| 数据源 | Tushare Pro + 新浪财经 + 腾讯行情 |
| 部署 | Vercel(Serverless) |

## 快速开始

### 环境要求

- Node.js ≥ 22（仅源码开发需要；下载版已内置）
- npm ≥ 9

### 安装

```bash
git clone https://github.com/zjwandcat/cute-fish-stock-picker.git
cd cute-fish-stock-picker
npm ci
```

### 配置

复制环境变量模板并填入真实 Token：

```bash
cp .env.example .env
```

Windows PowerShell 使用 `Copy-Item .env.example .env`。

编辑 `.env`：

```
TUSHARE_TOKEN=your_real_token_here
PORT=3001
```

> Token 申请：https://tushare.pro/register

### 开发

```bash
# 同时启动前端(5173)与后端(3001)
npm run dev

# 仅前端
npm run client:dev

# 仅后端
npm run server:dev
```

### 构建与检查

```bash
npm run build       # 类型检查 + 构建
npm run check       # 仅类型检查
npm run lint        # ESLint 检查
npm run lint:fix    # ESLint 自动修复
npm run build:local # 构建可独立运行的前后端
npm run test:local  # 本地启动、发布包及行情数据质量验证
```

### 月度推荐（可选）

月度页面调用本机真实 10q 项目 bridge，并非 LLM 生成名单。请设置 `TENQ_ROOT`（或使用默认目录），准备 `Trial 157` 研究文件、`scheme_b` M0 因子库，以及包含 pandas、pyarrow、polars、LightGBM、XGBoost 的 Python 环境。程序按 Asia/Shanghai 当前月份检查数据，通过 Tushare 补齐缺失 M0 月份，执行一次当前 M0–M4 窗口，缓存中间数据，并通过 `/api/recommendations/monthly` 返回进度。

Node.js 便携包不包含 10q 数据集或 Python 依赖。Windows 可运行 `py -3.12 scripts/setup-monthly.py` 创建 `.monthly-venv`；macOS Demo 面向原生 ARM64 CPU 环境。运行边界与算法限制见 [`docs/PORTABLE.zh-CN.md`](docs/PORTABLE.zh-CN.md) 和 [`docs/MONTHLY-AUDIT.zh-CN.md`](docs/MONTHLY-AUDIT.zh-CN.md)。

### 一键启动

从项目网站的“下载”按钮，或 [GitHub Releases](https://github.com/zjwandcat/cute-fish-stock-picker/releases/latest) 下载对应系统的 ZIP：Windows 10/11 下载 Windows 版，macOS 下载 macOS 版。完整解压后双击 `启动选股指南.bat`（Windows）或 `启动选股指南.command`（macOS）。便携包已经内置 Node.js，无需另行安装运行环境。

首次启动会自动打开设置页，填写 Tushare Token。Token、持仓、设置和缓存保存在系统用户目录，升级程序不会覆盖。详细步骤见 [`docs/PORTABLE.zh-CN.md`](docs/PORTABLE.zh-CN.md)。

仓库首页上方也提供直接下载链接。公共 [下载网站](https://zjwandcat.github.io/cute-fish-stock-picker/) 由 GitHub Pages 提供，只分发程序；实时选股服务在用户电脑上运行。部署已有 Vercel 项目后，应用导航栏同样包含下载入口。

### 发布桌面包

推送 `v*` 标签会由 GitHub Actions 在 Windows 与 macOS 原生 runner 上分别打包，并将两个 ZIP 与 SHA-256 校验文件发布到 Release。由于包内包含官方 Node.js 运行时，构建必须在对应系统 runner 上完成。

```bash
git tag v0.2.0
git push origin v0.2.0
```

## 项目结构

```
.
├── api/                # 后端 Express 服务
│   ├── routes/         # API 路由(stocks / alerts / auth)
│   ├── services/       # 业务服务(tushare / realtime / scoring / alertEngine ...)
│   ├── app.ts          # Express 应用入口
│   ├── index.ts        # Vercel Serverless 入口
│   └── server.ts       # 本地开发服务入口
├── src/                # 前端 React 应用
│   ├── components/     # 通用组件(Navbar / StockTable / DetailPanel ...)
│   ├── lib/            # 工具函数
│   ├── pages/          # 页面
│   ├── services/       # 前端服务层
│   ├── store/          # Zustand 状态管理
│   └── types/          # TypeScript 类型定义
├── public/             # 静态资源
├── LICENSE             # MIT 许可证
└── README.md           # 项目说明
```

## API 接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/health` | 健康检查 |
| GET | `/api/stocks` | 获取自选股实时行情 |
| GET | `/api/stocks/search?q=` | 智能选股搜索 |
| GET | `/api/stocks/:code/detail` | 个股详情 |
| GET | `/api/stocks/:code/daily` | 日 K 线 |
| GET | `/api/stocks/:code/news` | 公司新闻 |
| GET | `/api/stocks/:code/signals` | TET+MACD-V 信号与综合评估 |
| GET | `/api/recommendations?mode=&limit=&offset=` | 今日推荐（`capital`、`tet`、`macdv` 或 `double`） |
| GET | `/api/recommendations/monthly?limit=&refresh=1` | 当前月份 10q 持仓与计算报告 |
| GET | `/api/data-quality` | 市值来源、日期、币种、状态及 Tushare 健康信息 |
| GET | `/api/watchlist` | 配置的回踩监控列表及进场/止损状态 |
| GET | `/api/pullback-status` | 整股池回踩状态 |
| GET | `/api/pool-scores` | 股池综合评分 |
| POST | `/api/stocks/add` | 添加股票到股池 |
| DELETE | `/api/stocks/:code` | 从股池移除 |
| GET/POST | `/api/holdings` | 读取/更新持仓 |
| GET | `/api/holdings/signals` | 持仓 TET/MACD-V 与卖出信号评估 |
| GET/POST | `/api/settings` | MACD-V 阈值 |
| GET | `/api/bagholder50` | `韭菜50` Top50 拥挤避雷名单（bagholder50 指数算法复刻） |
| GET | `/api/alerts` | 获取告警列表 |
| POST | `/api/alerts/analyze` | 手动触发分析 |
| GET/POST | `/api/alerts/targets` | 目标价管理 |
| DELETE | `/api/alerts` | 清空告警 |

## 代码规范

- TypeScript 严格模式(`strict: true`)
- ESLint + typescript-eslint（对齐 Google TS Style Guide 与 Airbnb 风格）
- 单引号 / 2 空格缩进 / 行尾分号 / 多行尾逗号
- 统一 EditorConfig 配置（见 `.editorconfig`）
- `import type` 显式标注类型导入

> 源码开发的 `api/data/` 已加入 .gitignore；便携版数据位置详见使用说明。Token 使用设置页或开发用 `.env` 配置。韭菜50缓存首次构建约 460 次请求，节流 280 次/分钟，之后每日约 10 次增量请求；行情功能仍需要网络及相应 Tushare 权限。

## 风险提示

本项目仅供学习与技术研究，所有信号与评分均为算法输出，**不构成任何投资建议**。据此交易，风险自负。

## 许可证

[MIT License](./LICENSE) © 2026 可爱鱼儿选股指南
