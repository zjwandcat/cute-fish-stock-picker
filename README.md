# 可爱鱼儿选股指南

> 基于 Tushare 与新浪实时行情的 A 股自选股盯盘、智能评分与告警提醒工具。

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

## 功能特性

- **自选股盯盘**:支持运行时增删股池,30 秒自动刷新行情
- **实时行情**:优先使用新浪财经实时报价,Tushare 作为回退
- **智能评分**:技术面(均线/MACD/量比)+ 基本面(PE/PB/ROE)+ 资金面三维综合评分
- **盯盘提醒**:跌深、底部、反弹、异动、目标价五类信号,支持浏览器通知与声音
- **K 线图**:日 K + 常规均线 + 大道七线 + 成交量
- **个股详情**:十大股东、资金流向、公告会议、除权除息、新闻
- **iOS 26 液态玻璃风格 UI**:支持深浅主题切换与字体大小调节

## 技术栈

| 模块 | 技术 |
| --- | --- |
| 前端 | React 18 + TypeScript 5 + Vite 6 + Tailwind CSS 3 |
| 状态 | Zustand 5 |
| 图表 | ECharts 5 + echarts-for-react |
| 路由 | React Router 7 |
| 后端 | Express 4 + TypeScript + tsx |
| 数据源 | Tushare Pro + 新浪财经 |
| 部署 | Vercel(Serverless) |

## 快速开始

### 环境要求

- Node.js ≥ 18
- npm ≥ 9

### 安装

```bash
git clone <repository-url>
cd 可爱鱼儿选股指南
npm install
```

### 配置

复制环境变量模板并填入真实 Token:

```bash
cp .env.example .env
```

编辑 `.env`:

```
TUSHARE_TOKEN=your_real_token_here
PORT=3001
```

> Token 申请:https://tushare.pro/register

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
```

### 一键启动(macOS)

双击项目根目录的 `启动选股指南.command` 即可启动。

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
| GET | `/api/stocks/:code/detail` | 个股详情 |
| GET | `/api/stocks/:code/daily` | 日 K 线 |
| GET | `/api/stocks/:code/news` | 公司新闻 |
| GET | `/api/recommendations` | 今日推荐 |
| POST | `/api/stocks/add` | 添加股票到股池 |
| DELETE | `/api/stocks/:code` | 从股池移除 |
| GET | `/api/alerts` | 获取告警列表 |
| POST | `/api/alerts/analyze` | 手动触发分析 |
| GET/POST | `/api/alerts/targets` | 目标价管理 |
| DELETE | `/api/alerts` | 清空告警 |

## 代码规范

- TypeScript 严格模式(`strict: true`)
- ESLint + typescript-eslint(对齐 Google TS Style Guide 与 Airbnb 风格)
- 单引号 / 2 空格缩进 / 行尾分号 / 多行尾逗号
- 统一 EditorConfig 配置(见 `.editorconfig`)
- `import type` 显式标注类型导入

## 风险提示

本项目仅供学习与技术研究,所有信号与评分均为算法输出,**不构成任何投资建议**。据此交易,风险自负。

## 许可证

[MIT License](./LICENSE) © 2026 可爱鱼儿选股指南
