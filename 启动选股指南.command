#!/bin/bash

# 可爱鱼儿选股指南 - 启动脚本
# 双击即可运行

cd "$(dirname "$0")"

echo "========================================="
echo "  可爱鱼儿选股指南 - 启动中..."
echo "========================================="
echo ""

# 检查 Node.js
if [ ! -f "./.node/bin/node" ]; then
    echo "❌ 错误：未找到 Node.js"
    echo "请确保 .node 目录存在"
    exit 1
fi

# 设置 PATH
export PATH="$(pwd)/.node/bin:$PATH"

# 检查依赖
if [ ! -d "node_modules" ]; then
    echo "📦 首次运行，安装依赖..."
    npm install
fi

# 清理旧进程
echo "🧹 清理旧进程..."
lsof -ti:3001 2>/dev/null | xargs kill -9 2>/dev/null || true
lsof -ti:5173 2>/dev/null | xargs kill -9 2>/dev/null || true

# 启动服务
echo ""
echo "🚀 启动后端和前端服务..."
echo ""
echo "后端地址: http://localhost:3001"
echo "前端地址: http://localhost:5173"
echo ""
echo "========================================="
echo "  按 Ctrl+C 停止服务"
echo "========================================="
echo ""

# 等待 2 秒后打开浏览器
(sleep 3 && open http://localhost:5173) &

# 启动开发服务器
npm run dev
