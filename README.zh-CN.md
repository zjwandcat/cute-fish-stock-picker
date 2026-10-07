# 可爱鱼儿选股指南 (Cute Fish Stock Picker)

> 本项目是一个本机运行的 A 股/港股自选股、评分、信号、提醒和可选研究工具。本文档按当前代码和已完成的验证记录编写；“功能存在”不等于无需数据权限、外部项目或模型密钥即可成功运行。

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
**简体中文** · [English](README.md)

[下载 Windows 10 / 11 版](https://github.com/zjwandcat/cute-fish-stock-picker/releases/latest/download/cute-fish-stock-picker-windows.zip) · [下载 macOS 版](https://github.com/zjwandcat/cute-fish-stock-picker/releases/latest/download/cute-fish-stock-picker-macos.zip) · [下载网站](https://zjwandcat.github.io/cute-fish-stock-picker/)

当前仓库版本：**0.3.0**。依赖下载前仍应以 Releases 页面实际资产为准；当前发布页包含 Windows/macOS ZIP 和 SHA-256 校验文件。

## 功能实际状态

下表中的功能在源码中存在，并有对应本地入口。“可用”不代表程序自带供应商权限、私有数据集、Python 环境或模型密钥。

| 功能 | 当前真实行为 | 条件与边界 |
| --- | --- | --- |
| 自选股 | 运行期间增删 A/H 股票，行情约每 30 秒刷新 | 股池变更只在当前进程内存中生效，重启后恢复默认股池 |
| 行情 | 新浪 A/H 行情、腾讯港股行情、Tushare 历史/基本面及有限回退 | 不是交易所逐笔行情；交易日、权限、缓存和市场时段都会影响结果 |
| 日 K | A 股使用 Tushare，港股使用腾讯日线，并校验日期与 OHLC | 两个市场的数据源与复权口径不完全相同 |
| 综合评分 | 价值、质量、动量、低波、流动性、规模、资金流等因子横截面 Z-score、固定权重、3%-97% 缩尾 | 不是动态 IC 拟合；缺失因子经常以 0 参与计算 |
| 今日推荐 | `capital`、`tet`、`macdv`、`double` 四种模式；资金面模式按当前股池综合分稳定排序 | 只对本地股池横截面计算，不是全市场扫描；`double` 可以为空 |
| TET/MACD-V | 计算 TET 择时信号和波动率归一化 MACD-V 信号 | 本实现的 MACD-V 不是“成交量修正”；信号是启发式结果，不是校准后的概率 |
| 持仓 | 新增、编辑、删除持仓，计算 TET/MACD-V 卖出触发和估算盈亏 | 持仓与 MACD-V 设置会保存；没有接入券商、手续费、税费和真实成交 |
| 告警 | 跌深、底部、反弹、异动、目标价五类检查，支持手动分析和浏览器轮询 | 历史和目标价在进程内存；浏览器通知要求页面打开且已授权 |
| K 线/详情 | 日 K、均线、成交量、十大股东、资金流、分红、A/H 比价等可用数据 | 新闻与公告接口当前固定返回空数组，不应描述为实时新闻服务 |
| 韭菜50 | 在筛选后的 A 股市值前 1000 样本上，用四因子计算 Top50 拥挤避雷信号 | 不是官方中证 1000 成分，不覆盖港股，也不是未来收益排名证明 |
| 数据质量 | 输出市值来源、日期、币种、状态，并提供 `/api/data-quality` | 质量契约主要覆盖市值和部分行情/日线检查，不覆盖所有财务字段 |
| A/H 比价 | 内置 A+H 配对、价格、汇率、股息和成本/税费假设 | 配对表是预置的；汇率失败时可回退约 0.92 港元/人民币；不是无风险套利 |
| AI 研究 | 可选的问题/标的识别、澄清、证据快照、受限专家流程、取消、引用和显式保存记忆 | 需要用户自己的模型 API Key 和服务商；不会自动交易 |
| 月度 10q | 可选的外部 10q `Trial 157` / `scheme_b` M0-M4 本地桥接 | 需要独立 10q 项目、数据、Python 环境和 Tushare，ZIP 不包含这些内容 |
| 桌面 UI | 本机桌面工作流、深浅主题、字体大小、Windows/macOS 便携启动 | macOS 只有 ad-hoc 完整性签名，没有 Developer ID 签名或公证 |

## 明确不宣称的内容

- HTTP 200、`success: true`、空数组或 0 并不自动代表数据有效。
- 程序没有为每个详情、K 线、告警和推荐面板提供统一实时行情；只有供应商日期等于上海当天且通过合理性检查时，实时值才会注入 K 线。
- 评分/详情中的 `ROE` 是 `PB / PE * 100` 的估算值，不是财报中的 ROE。
- 部分港股估值和成交额是近似口径；A/H 价格存在时间、币种、股本、交易制度和成本差异。
- 十大股东和资金流通常是报告期或供应商口径数据，不代表实时机构持仓。
- 绿色 `韭菜50` 标记表示“拥挤避雷”，不是“买入”；不在名单中也不代表安全。
- 声音提醒使用极短的内置 WAV 占位音频，未保证每种浏览器和系统都能听见。
- 项目没有挂载通用用户账户系统。即使代码树中存在 `api/routes/auth.ts`，也不能据此宣传账号认证。不要把本地服务暴露为公共生产 API。

## 便携版使用

### 环境要求

- Windows 10/11 x64，或 macOS 11+（Apple 芯片和 Intel）运行基础应用。
- 行情联网。
- 有效的 Tushare Token，以及所使用接口对应的权限。
- 发布版 ZIP 已内置 Node.js，不需要另装 Node.js/npm。

### 启动步骤

1. 从 [Releases](https://github.com/zjwandcat/cute-fish-stock-picker/releases/latest) 或 [下载网站](https://zjwandcat.github.io/cute-fish-stock-picker/) 下载对应 ZIP。
2. 完整解压，不要直接在 ZIP 内运行启动文件。
3. Windows 运行 `启动选股指南.bat`；macOS 打开 `可爱鱼儿选股指南.app`。
4. 首次打开时在设置页面填写 Tushare Token。

便携版服务只监听 `127.0.0.1`，同时提供构建后的前端和 API，并在启动窗口打印准确地址。请使用窗口打印的地址。独立版的 `/setup` 和保存 Token 接口不属于普通 Vite 开发服务器。默认端口被同一版本占用时会复用；被其他程序占用时会选择空闲端口，不会结束无关进程。

### 数据与密钥位置

| 系统 | 默认目录 |
| --- | --- |
| Windows | `%APPDATA%\Cute Fish Stock Picker` |
| macOS | `~/Library/Application Support/Cute Fish Stock Picker` |
| Linux 源码运行 | `~/.local/share/Cute Fish Stock Picker` |

可用 `CUTE_FISH_DATA_DIR` 覆盖目录。持仓、MACD-V 设置、AI 设置、AI 记忆和缓存保存在该目录；运行时股池不保存。`config.json` 以明文 JSON 保存 Tushare Token 和（如已配置）AI API Key；代码会请求 `0600` 权限，但这不是系统钥匙串或加密保险库，备份目录也会包含密钥。

macOS 发布包只有 ad-hoc 完整性签名。若 Gatekeeper 首次拦截，请核对下载来源后在 **系统设置 → 隐私与安全性 → 仍要打开** 中批准。不要关闭 Gatekeeper，也不要随意移除隔离属性。

## 源码开发

### 环境与安装

- Node.js `>=22.23.2`
- npm `>=11.16.0`

```bash
git clone https://github.com/zjwandcat/cute-fish-stock-picker.git
cd cute-fish-stock-picker
npm ci
```

复制 `.env.example`：

```powershell
Copy-Item .env.example .env
```

编辑 `.env`：

```dotenv
TUSHARE_TOKEN=your_real_token_here
PORT=3001
```

### 启动方式

```bash
# Vite 前端 5173 + 源码 API 3001
npm run dev

# 仅前端
npm run client:dev

# 仅源码 API
npm run server:dev
# 或
npm start
```

`npm start` 和 `npm run server:dev` 不会提供生产构建后的前端；`npm run preview` 也只提供前端预览。Vite 的 `/api` 代理固定指向 `http://localhost:3001`，更改后端 `PORT` 时要同步修改代理，或改用独立构建。

构建完整本机应用：

```bash
npm run build:local
node build/server.mjs
```

独立构建会加载 `.env`，然后让用户目录中保存的 Token 优先；前端和 API 都由 `127.0.0.1` 提供。

### 检查命令

```bash
npm run check
npm run lint
npm run build
npm run build:local
npm run test:local
py -3 -m unittest discover -s tests -p "test_monthly*.py"
```

除特别注明外，测试使用合成数据、mock 数据或本机受控服务；测试通过不等于全市场行情、付费模型质量或完整私有 10q 计算已经验收。

## 行情与评分边界

### 数据来源

- Tushare Pro：A 股日线/基本面、部分股东、资金流、分红、交易日历及权限接口。
- 新浪财经：A/H 盘中行情快照。
- 腾讯行情：港股行情/历史以及部分市值和汇率回退。
- 本地缓存：短时行情缓存，以及韭菜50/月度产物缓存。

行情是轮询快照，不是交易所级逐笔数据。A 股日期检查使用 Tushare 交易日历；港股陈旧判断使用保守的时间年龄规则，不是完整 HKEX 交易日历。

### 数据质量状态

市值记录包含 `value`、`source`、`as_of`、`currency`、`status`、`checked_at` 和对比信息。状态包括 `available`、`previous_close`、`stale`、`conflict`、`missing`。同日双源差异超过 5% 时标为冲突并拒绝展示市值。5% 是异常筛查阈值，不是准确率保证。

对正在运行的本机应用执行审计：

```bash
node scripts/audit-market-data.mjs http://127.0.0.1:3001
```

审计 JSON 写入 `.test-output/market-audits/`；缺失、陈旧或冲突时返回非零退出码。该命令可能发起网络请求。

### 推荐逻辑

推荐使用当前可变股池。默认返回 5 只，API 的 `limit` 上限为 20。资金面模式对全部股池按综合分排序，同分按 `ts_code` 稳定排序。TET、MACD-V 和双共振模式使用各自的信号排序与可选行业分散。双共振要求两个买入信号同时成立，因此可以没有结果。

综合分使用固定因子常数、横截面标准化和 3%-97% 缩尾，不在线训练，也不是次日收益概率。`next_day_adjust` 是启发式调整分。历史不足、字段缺失和供应商失败可能降低信息质量，不会让所有接口统一 fail-closed。

## 韭菜50

实现先筛选 A 股，再取市值前 1000 样本，计算四个等权百分位拥挤因子：

1. 20 日追涨行为；
2. 换手放大；
3. 龙虎榜次数；
4. ELG 特大单净流量。

Top50 是拥挤/避雷信号，不是官方中证 1000 成分，也不是股票未来跑输的证明。港股不在覆盖范围。有效因子行数不足时结果不可用；上游空响应也可能表现为数据不可用，因此不能宣称每个因子都有完整的逐源 provenance。首次预热可能发起数百次供应商请求，不能把固定请求数或耗时当作接口合同。

## 可选 AI 研究

AI 默认关闭；必须由用户启用并填写 API Key、模型地址和模型名。除回环地址外要求 HTTPS。支持 OpenAI-compatible 格式，但没有对所有服务商逐一认证。

AI 可以识别和澄清标的，生成只读证据快照，规划角色，显示进度，取消任务，校验证据编号，并由用户显式保存记忆。每次最多 4 只 A/H 证券。系统包含 32 个专业角色，加多头、空头、风险审查和总编角色。模式上限如下：

| 模式 | 专业角色上限 | 含多空/审查的典型最大角色数 |
| --- | ---: | ---: |
| `quick` | 3 | 7 |
| `standard` | 11 | 15 |
| `deep` | 32 | 36 |

最多 3 个角色并发，应用同时只允许 1 个研究任务。角色可能因市场或证据不适用而跳过。角色数不等于模型请求数：入口识别、工具调用、多空回应和最多一次引用修正还会产生请求。运行时会标注 `deepseek-harness`、`fallback` 或 `mixed`；不能把 fallback/mixed 结果描述为原生 Harness 成功。

由于当前证据适配器的范围，新闻、公告、行业、宏观和部分财报角色可能报告数据缺口。AI 不下单。用户问题、选取证据和所选记忆可能发送给模型服务商并产生费用；取消不能撤销已经被服务商接受的请求。

相关接口：

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

研究记忆是显式保存、本地保存、数量有限且支持过期的记录，不保证旧结论在新数据下仍然成立。

## 可选月度 10q 引擎

“本月推荐”是对独立 10q 项目的本地桥接，不是 LLM 生成名单；便携 ZIP 不包含私有数据和 Python 依赖。

需要准备：

- 通过 `TENQ_ROOT` 或 `TEN_Q_ROOT` 指定的 10q 项目根目录；
- `output/21BB/p2/21BB_p2_study.db`；
- `21BB_p2_config.json`，以及唯一且状态为 `COMPLETE` 的 Trial 157 和完整参数；
- `scheme_b` M0 因子文件与上游模块；
- 可写的数据/缓存目录；缺少 M0 月份时还需要 Tushare Token。

程序按 `Asia/Shanghai` 当前月份检查连续窗口，并执行一次当前 M0-M4：58 个月训练、12 个月验证、1 个月预测。缺失 M0 月份可能通过上游流程联网补齐。结果必须是当前月份且正好十只持仓；过期或非当前结果会丢弃。M3 是单月新建仓语义，不是连续持仓历史回测。TreeSHAP 风格贡献用于解释预测分，不是实现收益，也不能证明策略有效。

Windows：

```powershell
py -3.12 scripts/setup-monthly.py
py -3.12 scripts/setup-monthly.py --check
```

接受 Python 3.11-3.14，推荐 3.12。已有解释器可用 `TENQ_PYTHON` 指定。`TENQ_DEVICE=auto|cpu|cuda` 控制设备；LightGBM 保持 CPU，CUDA 只用于支持的 XGBoost 路径。

macOS 月度扩展面向 macOS 14+、原生 Python 3.12 和 OpenMP，环境保存在 app 之外。基础便携版不要求 Python 或 Homebrew。`CUTE_FISH_MONTHLY_AUTO=0` 只关闭后台调度，页面/API 的显式请求仍可触发计算。

历史真实数据证据有明确范围：

- 2026-09-17 Windows Trial 157/10q 验收：真实 71 个月窗口和十只持仓，记录的分数贡献误差为 `2.19e-8`；
- 这不代表 2026 年 10 月新结果、所有私有上游文件或 macOS 真实数据运行已验收。

## API 接口

以下均为本机 `/api` 路由，不是公开认证、多用户托管服务。

| 方法 | 路径 | 行为 |
| --- | --- | --- |
| GET | `/api/health` | 本机健康与构建状态 |
| GET | `/api/stocks` | 当前股池行情及派生字段 |
| GET | `/api/stocks/search?q=` | 股票搜索 |
| GET | `/api/stocks/:code/detail` | 详情、可用的股东/资金/分红和比价 |
| GET | `/api/stocks/:code/daily` | 日线 |
| GET | `/api/stocks/:code/news` | 当前固定返回空新闻列表 |
| GET | `/api/stocks/:code/signals` | TET/MACD-V 信号和综合判断 |
| GET | `/api/recommendations?mode=&limit=&offset=` | 今日推荐 |
| GET | `/api/recommendations/monthly?limit=&refresh=1` | 当前月份 10q 状态/结果 |
| GET | `/api/data-quality` | 市值质量记录与供应商状态 |
| GET | `/api/watchlist` | 配置的回踩监控 |
| GET | `/api/pullback-status` | 全股池回踩状态 |
| GET | `/api/pool-scores` | 股池评分 |
| POST | `/api/stocks/add` | 添加仅运行时有效的股池股票 |
| DELETE | `/api/stocks/:code` | 删除仅运行时有效的股池股票 |
| GET/POST | `/api/holdings` | 读取/更新持久化持仓 |
| GET | `/api/holdings/signals` | 持仓级信号评估 |
| GET/POST | `/api/settings` | 持久化 MACD-V 阈值 |
| GET | `/api/bagholder50` | 韭菜50拥挤结果 |
| GET | `/api/alerts` | 读取进程内告警 |
| POST | `/api/alerts/analyze` | 执行告警分析 |
| GET/POST | `/api/alerts/targets` | 读取/更新进程内目标价 |
| DELETE | `/api/alerts` | 清空告警 |

## 项目结构

```text
.
├── api/                  # Express API 与本机生产入口
│   ├── routes/            # stocks、alerts、AI 路由
│   ├── services/          # 数据、评分、信号、月度、AI 服务
│   ├── app.ts             # 源码 Express 应用
│   ├── local.ts           # 仅本机访问的独立服务
│   └── server.ts          # 源码开发服务
├── src/                   # React 前端
├── public/                # 静态资源和下载站文件
├── scripts/               # 构建、发布、审计、月度工具
├── tests/                 # 单元、契约、离线和受控集成测试
├── docs/                  # 便携、数据质量、AI、月度和发布说明
├── package.json
├── README.md
└── README.zh-CN.md
```

## 发布与部署边界

发布工作流使用 Windows、Apple Silicon macOS 和 Intel macOS 原生 runner。它检查标签/版本一致性，构建内置 Node.js，打包 ZIP，执行归档/启动/离线 AI 测试，并在打包任务全部成功后发布 SHA-256。它不等于 Gatekeeper 批准、真实供应商权限、付费模型质量或完整真实 10q 验收。

新版本应创建与 `package.json` 一致的新标签，不要复用现有 `v0.3.0`。GitHub Pages 只负责分发程序；本机桌面流程不是受支持的 Vercel 行情、持久化、AI 或月度托管服务。

## 验证快照

针对当前工作树的检查日期：**2026-10-07（Asia/Shanghai）**。

| 检查 | 结果 | 范围 |
| --- | --- | --- |
| `npm run check` | 通过 | TypeScript 类型检查 |
| `npm run lint` | 0 错误，14 条已有警告 | `api/scripts/analyze5.ts` 11 条 `any`，`vite.config.ts` 3 条 console |
| `npm run build:local` | 通过 | 生产前端和 `build/server.mjs` |
| 月度 Python 单元测试 | 15 项通过 | 合成/mock 测试和小型 CPU 模型贡献测试 |
| `npm run test:local` | 记录结果为 45 通过、2 失败、1 跳过 | 一个受控 Harness 子进程在 `sdk-minimal` 初始化时等待 30 秒超时并回退；另一个失败是 `release/` 下已存在、于 2026-09-28 生成的旧 Windows ZIP 中文启动文件名编码问题。该轮没有重新打包该 ZIP |
| Windows 归档文件名单元测试 | 通过 | 当前源码打包/解压路径使用 UTF-8 文件名 |
| 有限实时行情 smoke | 通过 | 新浪返回 `600519.SH`、`00700.HK`；腾讯返回 `00700.HK` 及 5 根港股日线 |

有限实时 smoke 的检查时间为 `2026-10-05T17:21:18.451Z`，即北京时间 `2026-10-06 01:21:18`。它只证明少量公共接口样本可返回，不证明全市场正确性、当天完整性、Tushare 权限覆盖，或下载版 ZIP 内容。本次未下载并执行 GitHub 发布 ZIP。

历史证据与当前验证分开：

- AI：2026-09-25 Windows 两次真实快速模式查询均使用 `deepseek-harness`，每次完成 7 个角色；不是 36 角色或 macOS 发布包验收。
- 月度：2026-09-17 Windows 真实 10q 记录见 [`docs/MONTHLY-AUDIT.zh-CN.md`](docs/MONTHLY-AUDIT.zh-CN.md)，不是 2026 年 10 月新结果。

## 常见问题

**没有安装 Node.js，ZIP 能运行吗？**

设计目标是可以：发布包包含内置 Node.js，不依赖系统 Node.js/npm。请先核对校验值并使用新发布的归档；上面记录的旧本地 ZIP 不能代表当前打包代码。

**为什么重启后自选股没了？**

股池设计为仅运行时有效；持仓和设置单独保存。

**为什么月度状态是 `unavailable`、`updating` 或 `error`？**

可能缺少外部 10q 项目、Trial 157 文件、M0 数据、Python 依赖、Token 或权限。程序会拒绝把旧月份十只股票冒充当前月份结果。

**这是投资建议或自动交易工具吗？**

不是。程序不下单，评分、信号和研究都不保证未来收益。

## 风险提示

本项目仅供学习和技术研究。所有行情、评分、信号、月度结果和 AI 输出都可能因数据时点、权限、模型、缓存或实现假设而不完整，**不构成任何投资建议**。据此交易，风险自负。

## 许可证

[MIT License](./LICENSE) © 2026 可爱鱼儿选股指南
