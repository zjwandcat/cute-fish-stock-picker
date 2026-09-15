#!/bin/bash

cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "未检测到 Node.js。请安装 Node.js 18 或更高版本后重试。"
  exit 1
fi

if [ ! -f ".env" ]; then
  cp .env.example .env
  echo "已创建 .env，请填入 TUSHARE_TOKEN 后重新启动。"
  open -e .env
  exit 0
fi

if [ ! -d "node_modules" ]; then
  npm install
fi

(sleep 3 && open "http://localhost:5173") &
npm run dev
