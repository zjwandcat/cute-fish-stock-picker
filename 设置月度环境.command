#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"

# Finder does not inherit a terminal's Homebrew PATH.
export PATH="/opt/homebrew/bin:/opt/homebrew/opt/python@3.12/bin:/usr/local/bin:$PATH"
python_command="${TENQ_PYTHON:-python3.12}"
if ! command -v "$python_command" >/dev/null 2>&1; then
  echo "请先安装原生 Python 3.12 和 libomp（Apple Silicon 使用 ARM 版本）。"
  echo "Homebrew: brew install python@3.12 libomp"
  read -r -p "按回车退出..." _
  exit 1
fi
if ! "$python_command" scripts/setup-monthly.py; then
  echo "月度环境安装失败，请查看上方错误。"
  echo "若缺少 libomp，请执行 brew install libomp。若架构不一致，请使用原生 ARM64 Python。"
  read -r -p "按回车退出..." _
  exit 1
fi
echo "月度环境已就绪。10q 项目默认放在 ~/10q 或 ~/10q/10q-202604gpu。"
read -r -p "按回车退出..." _
