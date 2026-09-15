#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"

architecture="$(uname -m)"
runtime="./runtime/darwin-${architecture}/bin/node"
if [ "$architecture" = "x86_64" ]; then
  runtime="./runtime/darwin-x64/bin/node"
fi

if [ -x "$runtime" ] && [ -f "./build/server.mjs" ]; then
  exec "$runtime" ./build/server.mjs
fi

# Source checkout: use a local or system Node.js installation.
if [ -x "./.node/bin/node" ]; then
  export PATH="$PWD/.node/bin:$PATH"
fi
if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "请从项目 Releases 下载 macOS 便携版（已内置运行环境）。"
  echo "源码运行需要安装 Node.js 22 或更高版本。"
  read -r -p "按回车退出..." _
  exit 1
fi
if [ ! -d node_modules ]; then npm ci; fi
npm run build:local
exec node ./build/server.mjs
