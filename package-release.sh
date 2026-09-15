#!/bin/bash

set -euo pipefail

root_dir="$(cd "$(dirname "$0")" && pwd)"
output_dir="$root_dir/release"
mac_archive="$output_dir/cute-fish-stock-picker-macos.zip"
windows_archive="$output_dir/cute-fish-stock-picker-windows.zip"

rm -rf "$output_dir"
mkdir -p "$output_dir"

npm ci
npm run build

stage_release() {
  local target_dir="$1"
  local launcher="$2"

  mkdir -p "$target_dir"
  cp -R "$root_dir/api" "$root_dir/src" "$root_dir/public" "$target_dir/"
  cp "$root_dir/.env.example" "$root_dir/index.html" "$root_dir/package.json" "$root_dir/package-lock.json" "$root_dir/README.zh-CN.md" "$root_dir/vite.config.ts" "$root_dir/tsconfig.json" "$root_dir/tailwind.config.js" "$root_dir/postcss.config.js" "$target_dir/"
  cp "$root_dir/$launcher" "$target_dir/"
}

mac_stage="$output_dir/macos"
windows_stage="$output_dir/windows"
stage_release "$mac_stage" "启动选股指南.command"
stage_release "$windows_stage" "启动选股指南.bat"

(
  cd "$mac_stage"
  zip -rq "$mac_archive" .
)
(
  cd "$windows_stage"
  zip -rq "$windows_archive" .
)

rm -rf "$mac_stage" "$windows_stage"
